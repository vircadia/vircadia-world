--
-- AGENTS AND AUTH
--

-- Create auth schema
CREATE SCHEMA IF NOT EXISTS auth;

-- Function to get system agent id (needed for current_agent_id)
CREATE OR REPLACE FUNCTION auth.get_system_agent_id() 
RETURNS UUID AS $$
BEGIN
    RETURN '00000000-0000-0000-0000-000000000000'::UUID;
END;
$$ LANGUAGE plpgsql;

-- Function to get anon agent id (needed for current_agent_id)
CREATE OR REPLACE FUNCTION auth.get_anon_agent_id() 
RETURNS UUID AS $$
BEGIN
    RETURN '00000000-0000-0000-0000-000000000001'::UUID;
END;
$$ LANGUAGE plpgsql;

-- Create current_agent_id function before it's used in template
CREATE OR REPLACE FUNCTION auth.current_agent_id() 
RETURNS UUID AS $$
BEGIN
    -- First try to get the setting
    IF current_setting('app.current_agent_id', true) IS NULL OR 
       TRIM(current_setting('app.current_agent_id', true)) = '' OR
       TRIM(current_setting('app.current_agent_id', true)) = 'NULL' OR
       LENGTH(TRIM(current_setting('app.current_agent_id', true))) != 36 THEN  -- UUID length check
        -- Return anonymous user if no context is set or invalid format
        RETURN auth.get_anon_agent_id();
    END IF;

    -- Try to cast to UUID, return anon if invalid
    BEGIN
        RETURN TRIM(current_setting('app.current_agent_id', true))::UUID;
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Invalid UUID in app.current_agent_id setting: %', current_setting('app.current_agent_id', true);
        RETURN auth.get_anon_agent_id();
    END;
END;
$$ LANGUAGE plpgsql;

-- Create a template table for common columns
CREATE TABLE auth._template (
    general__created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    general__created_by UUID DEFAULT auth.current_agent_id(),
    general__updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    general__updated_by UUID DEFAULT auth.current_agent_id()
);

-- Update agent_profiles to be simpler
CREATE TABLE auth.agent_profiles (
    general__agent_profile_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile__username TEXT UNIQUE,
    auth__email TEXT UNIQUE,
    auth__is_admin BOOLEAN NOT NULL DEFAULT FALSE
) INHERITS (auth._template);

CREATE TABLE auth.agent_auth_providers (
    auth__agent_id UUID REFERENCES auth.agent_profiles(general__agent_profile_id) ON DELETE CASCADE,
    auth__provider_name TEXT NOT NULL,
    auth__provider_uid TEXT NOT NULL,  -- Provider's unique ID for the user (e.g., Google's sub)
    auth__refresh_token TEXT,          -- Provider's refresh token (if available)
    auth__provider_email TEXT,         -- Email from the provider (for verification)
    auth__is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    auth__metadata JSONB,              -- Additional provider-specific data
    PRIMARY KEY (auth__agent_id, auth__provider_name),
    UNIQUE (auth__provider_name, auth__provider_uid)  -- Prevent duplicate provider accounts
) INHERITS (auth._template);

CREATE TABLE auth.agent_sessions (
    general__session_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auth__agent_id UUID REFERENCES auth.agent_profiles(general__agent_profile_id) ON DELETE CASCADE,
    auth__provider_name TEXT NOT NULL,
    session__started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    session__last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    session__expires_at TIMESTAMPTZ NOT NULL,
    session__jwt TEXT,
    session__is_active BOOLEAN NOT NULL DEFAULT TRUE
) INHERITS (auth._template);


-- Enable RLS
ALTER TABLE auth.agent_profiles ENABLE ROW LEVEL SECURITY;

-- Indexes for Agent-related tables
CREATE INDEX idx_agent_sessions_auth__agent_id ON auth.agent_sessions(auth__agent_id);
CREATE INDEX idx_agent_sessions_auth__provider_name ON auth.agent_sessions(auth__provider_name);
CREATE INDEX idx_agent_profiles_email ON auth.agent_profiles(auth__email);

-- Add optimized indexes for session-based entity change distribution
CREATE INDEX idx_agent_sessions_active_lookup ON auth.agent_sessions 
    (session__is_active, session__expires_at) 
    WHERE session__is_active = true;

-- Add composite index for session validation
CREATE INDEX idx_agent_sessions_validation ON auth.agent_sessions 
    (general__session_id, session__is_active, session__expires_at) 
    WHERE session__is_active = true;

-- Update is_admin_agent() to check the flag directly
CREATE OR REPLACE FUNCTION auth.is_admin_agent()
RETURNS boolean AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 
        FROM auth.agent_profiles
        WHERE general__agent_profile_id = auth.current_agent_id()
        AND auth__is_admin = true
    );
END;
$$ LANGUAGE plpgsql;

-- Add new function to check for superuser status
CREATE OR REPLACE FUNCTION auth.is_super_admin()
RETURNS boolean AS $$
BEGIN
    RETURN (SELECT usesuper FROM pg_user WHERE usename = CURRENT_USER);
END;
$$ LANGUAGE plpgsql;

-- Simplify agent profile policies to use sync groups
CREATE POLICY agent_view_own_profile ON auth.agent_profiles
    FOR SELECT
    TO PUBLIC
    USING (
        general__agent_profile_id = auth.current_agent_id()  -- Agents can view their own profile
        OR auth.is_admin_agent()                            -- Admins can view all profiles
    );

CREATE POLICY agent_update_own_profile ON auth.agent_profiles
    FOR UPDATE
    TO PUBLIC
    USING (
        general__agent_profile_id = auth.current_agent_id()  -- Agents can update their own profile
        OR auth.is_admin_agent()                            -- Admins can update all profiles
    );

-- Update function to modify both updated_at and updated_by timestamps
CREATE OR REPLACE FUNCTION auth.set_agent_timestamps()
RETURNS TRIGGER AS $$
BEGIN
    NEW.general__updated_at = CURRENT_TIMESTAMP;
    NEW.general__updated_by = auth.current_agent_id();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Update trigger to only fire on UPDATE (not INSERT)
CREATE TRIGGER set_agent_profile_timestamps
    BEFORE UPDATE ON auth.agent_profiles
    FOR EACH ROW
    EXECUTE FUNCTION auth.set_agent_timestamps();

-- Keep system and anon agent creation
INSERT INTO auth.agent_profiles 
    (general__agent_profile_id, profile__username, auth__email, auth__is_admin) 
VALUES 
    (auth.get_system_agent_id(), 'admin', 'system@internal', true),
    (auth.get_anon_agent_id(), 'anon', 'anon@internal', false)

ON CONFLICT (general__agent_profile_id) DO NOTHING;

CREATE OR REPLACE FUNCTION auth.is_anon_agent()
RETURNS boolean AS $$
BEGIN
    RETURN auth.current_agent_id() = auth.get_anon_agent_id();
END;
$$ LANGUAGE plpgsql;

-- Simplify session creation to not check roles
CREATE OR REPLACE FUNCTION auth.create_agent_session(
    p_agent_id UUID,
    p_provider_name TEXT DEFAULT NULL,
    p_jwt TEXT DEFAULT NULL
) RETURNS TABLE (
    general__session_id UUID,
    session__expires_at TIMESTAMPTZ,
    session__jwt TEXT
) AS $$
DECLARE
    v_session_id UUID;
    v_expires_at TIMESTAMPTZ;
    v_duration BIGINT;
    v_max_sessions INTEGER;
    v_current_sessions INTEGER;
BEGIN
    -- Allow both admin agents and superusers to create sessions
    IF NOT (auth.is_admin_agent() OR auth.is_super_admin()) THEN
        RAISE EXCEPTION 'Only administrators can create sessions';
    END IF;

    -- Get max sessions per agent from config
    SELECT general__value::INTEGER 
    INTO v_max_sessions 
    FROM config.config 
    WHERE general__key = 'session__max_sessions_per_agent';

    -- Count current active sessions for this agent
    SELECT COUNT(*) 
    INTO v_current_sessions 
    FROM auth.agent_sessions s
    WHERE s.auth__agent_id = p_agent_id 
    AND s.session__is_active = true 
    AND s.session__expires_at > NOW();

    -- Check if max sessions would be exceeded
    IF v_current_sessions >= v_max_sessions THEN
        -- Invalidate oldest session if limit reached
        UPDATE auth.agent_sessions target_session
        SET session__is_active = false,
            session__expires_at = NOW()
        WHERE target_session.general__session_id = (
            SELECT oldest_session.general__session_id 
            FROM auth.agent_sessions oldest_session
            WHERE oldest_session.auth__agent_id = p_agent_id 
            AND oldest_session.session__is_active = true 
            ORDER BY oldest_session.session__started_at ASC 
            LIMIT 1
        );
    END IF;

    -- Get duration from config
    SELECT general__value::BIGINT 
    INTO v_duration 
    FROM config.config 
    WHERE general__key = 'auth__session_duration_ms';
    
    v_expires_at := NOW() + (v_duration || ' milliseconds')::INTERVAL;

    INSERT INTO auth.agent_sessions AS s (
        auth__agent_id,
        auth__provider_name,
        session__expires_at,
        session__jwt
    ) VALUES (
        p_agent_id,
        p_provider_name,
        v_expires_at,
        p_jwt
    ) RETURNING 
        s.general__session_id,
        s.session__expires_at,
        s.session__jwt
    INTO v_session_id, v_expires_at, p_jwt;

    RETURN QUERY SELECT v_session_id, v_expires_at, p_jwt;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Consolidate session validation logic
CREATE OR REPLACE FUNCTION auth.validate_session_internal(
    p_session_id UUID,
    p_session_token TEXT DEFAULT NULL
) RETURNS TABLE (
    auth__agent_id UUID,
    is_valid BOOLEAN,
    session_token TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        s.auth__agent_id,
        CASE WHEN 
            s.session__is_active 
            AND s.session__expires_at > NOW()
            AND (p_session_token IS NULL OR TRIM(s.session__jwt) = TRIM(p_session_token))
        THEN TRUE ELSE FALSE END as is_valid,
        s.session__jwt as session_token
    FROM auth.agent_sessions s
    WHERE s.general__session_id = p_session_id
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN QUERY SELECT 
            NULL::UUID, FALSE, NULL::TEXT;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update existing functions to use the new helper
CREATE OR REPLACE FUNCTION auth.validate_session(p_session_id UUID)
RETURNS TABLE (auth__agent_id UUID, is_valid BOOLEAN, session_token TEXT) AS $$
BEGIN
    RETURN QUERY SELECT * FROM auth.validate_session_internal(p_session_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION auth.set_agent_context(
    p_session_id UUID,
    p_session_token TEXT
) RETURNS BOOLEAN AS $$
DECLARE
    v_validation RECORD;
BEGIN
    SELECT * INTO v_validation 
    FROM auth.validate_session_internal(p_session_id, p_session_token);

    IF NOT v_validation.is_valid THEN
        PERFORM auth.clear_agent_context();
        RETURN FALSE;
    END IF;

    PERFORM set_config('app.current_agent_id', v_validation.auth__agent_id::text, false);
    
    UPDATE auth.agent_sessions 
    SET session__last_seen_at = NOW()
    WHERE general__session_id = p_session_id;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION auth.clear_agent_context()
RETURNS VOID AS $$
BEGIN
    -- Explicitly set to anon agent ID instead of NULL or empty string
    PERFORM set_config('app.current_agent_id', auth.get_anon_agent_id()::text, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION auth.cleanup_old_sessions()
RETURNS INTEGER AS $$
DECLARE
    v_max_age_ms INTEGER;
    v_count INTEGER;
BEGIN
    SELECT general__value::INTEGER 
    INTO v_max_age_ms 
    FROM config.config 
    WHERE general__key = 'session__max_age_ms';

    WITH updated_sessions AS (
        UPDATE auth.agent_sessions 
        SET session__is_active = false
        WHERE (
            -- Check both expiration and last seen conditions
            session__expires_at < NOW() 
            OR session__last_seen_at < (NOW() - (v_max_age_ms || ' milliseconds')::INTERVAL)
        )
        AND session__is_active = true
        RETURNING 1
    )
    SELECT COALESCE(COUNT(*)::INTEGER, 0) INTO v_count FROM updated_sessions;
    
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION auth.invalidate_session(
    p_session_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
    v_rows_affected INTEGER;
BEGIN
    -- Check if user has permission (must be admin or the owner of the session)
    IF NOT auth.is_admin_agent() AND 
       NOT EXISTS (
           SELECT 1 
           FROM auth.agent_sessions 
           WHERE general__session_id = p_session_id
           AND auth__agent_id = auth.current_agent_id()
       ) THEN
        RAISE EXCEPTION 'Insufficient permissions to invalidate session';
    END IF;

    UPDATE auth.agent_sessions 
    SET 
        session__is_active = false,
        session__expires_at = NOW()
    WHERE 
        general__session_id = p_session_id
        AND session__is_active = true;

    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
    RETURN v_rows_affected > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION auth.invalidate_agent_sessions(
    p_agent_id UUID
) RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    -- Check if user has permission (must be admin or the agent themselves)
    IF NOT auth.is_admin_agent() AND auth.current_agent_id() != p_agent_id THEN
        RAISE EXCEPTION 'Insufficient permissions to invalidate agent sessions';
    END IF;

    WITH updated_sessions AS (
        UPDATE auth.agent_sessions 
        SET 
            session__is_active = false,
            session__expires_at = NOW()
        WHERE 
            auth__agent_id = p_agent_id
            AND session__is_active = true
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_count FROM updated_sessions;
    
    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION auth.cleanup_system_tokens()
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    WITH updated_sessions AS (
        UPDATE auth.agent_sessions 
        SET session__is_active = false
        WHERE auth__agent_id = auth.get_system_agent_id()
        AND session__expires_at < NOW()
        AND session__is_active = true
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_count FROM updated_sessions;
    
    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Revoke set_config from public
REVOKE ALL ON FUNCTION pg_catalog.set_config(text, text, boolean) FROM PUBLIC;

-- Grant to current user
DO $$ 
BEGIN
    -- Grant to current user
    EXECUTE format(
        'GRANT EXECUTE ON FUNCTION pg_catalog.set_config(text, text, boolean) TO %I',
        CURRENT_USER
    );
END $$;

-- Create triggers for updating timestamps
CREATE TRIGGER update_agent_auth_providers_updated_at
    BEFORE UPDATE ON auth.agent_auth_providers
    FOR EACH ROW
    EXECUTE FUNCTION auth.set_agent_timestamps();

CREATE TRIGGER update_agent_sessions_updated_at
    BEFORE UPDATE ON auth.agent_sessions
    FOR EACH ROW
    EXECUTE FUNCTION auth.set_agent_timestamps();

--
-- SYNC GROUPS
--

-- Create sync groups table
CREATE TABLE auth.sync_groups (
    general__sync_group TEXT PRIMARY KEY,
    general__description TEXT,
    
    server__tick__rate_ms INTEGER NOT NULL,
    server__tick__buffer INTEGER NOT NULL,
    
    client__render_delay_ms INTEGER NOT NULL,
    client__max_prediction_time_ms INTEGER NOT NULL,
    
    network__packet_timing_variance_ms INTEGER NOT NULL
) INHERITS (auth._template);

-- Create agent sync group roles table
CREATE TABLE auth.agent_sync_group_roles (
    auth__agent_id UUID NOT NULL REFERENCES auth.agent_profiles(general__agent_profile_id) ON DELETE CASCADE,
    group__sync TEXT NOT NULL REFERENCES auth.sync_groups(general__sync_group) ON DELETE CASCADE,
    permissions__can_insert BOOLEAN NOT NULL DEFAULT false,
    permissions__can_update BOOLEAN NOT NULL DEFAULT false,
    permissions__can_delete BOOLEAN NOT NULL DEFAULT false,
    PRIMARY KEY (auth__agent_id, group__sync)
) INHERITS (auth._template);

-- Insert default sync groups
INSERT INTO auth.sync_groups (
    general__sync_group,
    general__description,
    server__tick__rate_ms,
    server__tick__buffer,
    client__render_delay_ms,
    client__max_prediction_time_ms,
    network__packet_timing_variance_ms
) VALUES
    -- Public zone
    ('public.REALTIME', 'Public realtime entities', 16, 2, 50, 100, 25),
    ('public.NORMAL', 'Public normal-priority entities', 50, 1, 100, 150, 50),
    ('public.BACKGROUND', 'Public background entities', 200, 1, 200, 300, 100),
    ('public.STATIC', 'Public static entities', 2000, 1, 500, 1000, 200),
    
    -- Admin zone (mirroring public zone structure)
    ('admin.REALTIME', 'Admin-only realtime entities', 16, 2, 50, 100, 25),
    ('admin.NORMAL', 'Admin-only normal-priority entities', 50, 1, 100, 150, 50),
    ('admin.BACKGROUND', 'Admin-only background entities', 200, 1, 200, 300, 100),
    ('admin.STATIC', 'Admin-only static entities', 2000, 1, 500, 1000, 200);

-- Enable RLS
ALTER TABLE auth.sync_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.agent_sync_group_roles ENABLE ROW LEVEL SECURITY;

-- Sync groups policies
CREATE POLICY "Allow viewing sync groups" ON auth.sync_groups
    FOR SELECT
    USING (true);

CREATE POLICY "Allow admin sync group modifications" ON auth.sync_groups
    FOR ALL
    USING (auth.is_admin_agent() OR auth.is_super_admin());

-- Sync group roles policies
CREATE POLICY "Allow viewing sync group roles" ON auth.agent_sync_group_roles
    FOR SELECT
    USING (true);

CREATE POLICY "Allow admin sync group role modifications" ON auth.agent_sync_group_roles
    FOR ALL
    USING (auth.is_admin_agent() OR auth.is_super_admin());

-- Permission check functions
CREATE OR REPLACE FUNCTION auth.has_sync_group_read_access(p_sync_group TEXT) 
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1
        FROM auth.agent_sync_group_roles
        WHERE auth__agent_id = auth.current_agent_id()
        AND group__sync = p_sync_group
    );
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION auth.has_sync_group_insert_access(p_sync_group TEXT) 
RETURNS BOOLEAN AS $$
    SELECT auth.is_super_admin() OR EXISTS (
        SELECT 1
        FROM auth.agent_sync_group_roles
        WHERE auth__agent_id = auth.current_agent_id()
        AND group__sync = p_sync_group
        AND permissions__can_insert
    );
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION auth.has_sync_group_update_access(p_sync_group TEXT) 
RETURNS BOOLEAN AS $$
    SELECT auth.is_super_admin() OR EXISTS (
        SELECT 1
        FROM auth.agent_sync_group_roles
        WHERE auth__agent_id = auth.current_agent_id()
        AND group__sync = p_sync_group
        AND permissions__can_update
    );
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION auth.has_sync_group_delete_access(p_sync_group TEXT) 
RETURNS BOOLEAN AS $$
    SELECT auth.is_super_admin() OR EXISTS (
        SELECT 1
        FROM auth.agent_sync_group_roles
        WHERE auth__agent_id = auth.current_agent_id()
        AND group__sync = p_sync_group
        AND permissions__can_delete
    );
$$ LANGUAGE sql STABLE;

-- Add timestamps trigger
CREATE TRIGGER update_sync_groups_updated_at
    BEFORE UPDATE ON auth.sync_groups
    FOR EACH ROW
    EXECUTE FUNCTION auth.set_agent_timestamps();

CREATE TRIGGER update_agent_sync_group_roles_updated_at
    BEFORE UPDATE ON auth.agent_sync_group_roles
    FOR EACH ROW
    EXECUTE FUNCTION auth.set_agent_timestamps();

-- Create materialized view for active sessions per sync group
CREATE MATERIALIZED VIEW auth.active_sync_group_sessions AS
SELECT DISTINCT
    asgr.group__sync,
    array_agg(s.general__session_id) FILTER (WHERE s.session__is_active = true AND s.session__expires_at > NOW()) as active_session_ids
FROM auth.agent_sync_group_roles asgr
JOIN auth.agent_sessions s ON s.auth__agent_id = asgr.auth__agent_id
GROUP BY asgr.group__sync;

-- Create index on the materialized view
CREATE INDEX idx_active_sync_group_sessions_lookup 
ON auth.active_sync_group_sessions (group__sync);

-- Function to refresh the materialized view
CREATE OR REPLACE FUNCTION auth.refresh_active_sessions()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY auth.active_sync_group_sessions;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get active session IDs for a sync group
CREATE OR REPLACE FUNCTION auth.get_sync_group_session_ids(p_sync_group text)
RETURNS uuid[] AS $$
BEGIN
    RETURN (
        SELECT active_session_ids 
        FROM auth.active_sync_group_sessions
        WHERE group__sync = p_sync_group
    );
END;
$$ LANGUAGE plpgsql STABLE;

-- Create a trigger function to refresh the materialized view when sessions change
CREATE OR REPLACE FUNCTION auth.refresh_active_sessions_trigger()
RETURNS trigger AS $$
BEGIN
    -- Queue a refresh of the materialized view
    -- Using pg_notify to avoid blocking the transaction
    PERFORM pg_notify('refresh_active_sessions', '');
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create triggers to refresh the view when sessions or roles change
CREATE TRIGGER refresh_active_sessions_on_session_change
    AFTER INSERT OR UPDATE OR DELETE ON auth.agent_sessions
    FOR EACH STATEMENT
    EXECUTE FUNCTION auth.refresh_active_sessions_trigger();

CREATE TRIGGER refresh_active_sessions_on_role_change
    AFTER INSERT OR UPDATE OR DELETE ON auth.agent_sync_group_roles
    FOR EACH STATEMENT
    EXECUTE FUNCTION auth.refresh_active_sessions_trigger();
