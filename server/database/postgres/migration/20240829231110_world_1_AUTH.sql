--
-- AGENTS AND AUTH
--

-- Update agent_profiles to be simpler
CREATE TABLE auth.agent_profiles (
    general__agent_profile_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile__username TEXT UNIQUE,
    auth__email TEXT UNIQUE,
    auth__is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    auth__is_anon BOOLEAN NOT NULL DEFAULT FALSE
) INHERITS (auth._template);

-- Enable RLS
ALTER TABLE auth.agent_profiles ENABLE ROW LEVEL SECURITY;

-- Create a profile for the system agent
INSERT INTO auth.agent_profiles 
    (general__agent_profile_id, profile__username, auth__email, auth__is_admin) 
VALUES 
    (auth.get_system_agent_id(), 'admin', 'system@internal', true)
ON CONFLICT (general__agent_profile_id) DO NOTHING;

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

CREATE OR REPLACE FUNCTION auth.is_anon_agent()
RETURNS boolean AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1
        FROM auth.agent_profiles AS ap
        WHERE ap.general__agent_profile_id = auth.current_agent_id()
          AND ap.auth__is_anon = true
    );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION auth.is_admin_agent()
RETURNS boolean AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1
        FROM auth.agent_profiles AS ap
        WHERE ap.general__agent_profile_id = auth.current_agent_id()
          AND ap.auth__is_admin = true
    );
END;
$$ LANGUAGE plpgsql;

-- Function to check system agent status (since this is a special case)
CREATE OR REPLACE FUNCTION auth.is_system_agent()
RETURNS BOOLEAN AS $$ 
BEGIN
    RETURN auth.get_system_agent_id() = auth.current_agent_id();
END;
$$ LANGUAGE plpgsql STABLE;

-- Simplify agent profile policies to use sync groups
CREATE POLICY agent_view_own_profile ON auth.agent_profiles
    FOR SELECT
    TO PUBLIC
    USING (
        general__agent_profile_id = auth.current_agent_id()  -- Agents can view their own profile
        OR auth.is_admin_agent()                            -- Admins can view all profiles
        OR auth.is_system_agent()                           -- System agent can view all profiles
    );

CREATE POLICY agent_update_own_profile ON auth.agent_profiles
    FOR UPDATE
    TO PUBLIC
    USING (
        general__agent_profile_id = auth.current_agent_id()  -- Agents can update their own profile
        OR auth.is_admin_agent()                            -- Admins can update all profiles
        OR auth.is_system_agent()                           -- System agent can update all profiles
    );

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
    v_duration TEXT;
    v_max_sessions INTEGER;
    v_current_sessions INTEGER;
BEGIN
    -- Allow both admin agents and superusers to create sessions
    IF NOT (
        auth.is_admin_agent() 
        OR auth.is_system_agent() 
    ) THEN
        RAISE EXCEPTION 'Only administrators can create sessions';
    END IF;

    -- Get max sessions per agent from config
    SELECT (general__value -> 'session_max_per_agent')::INTEGER 
    INTO v_max_sessions 
    FROM config.config 
    WHERE general__key = 'auth';

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

    -- Use session duration from config (no separate admin duration)
    SELECT general__value ->> 'default_session_duration_jwt_string'
    INTO v_duration 
    FROM config.config 
    WHERE general__key = 'auth';

    IF v_duration IS NULL THEN
        RAISE EXCEPTION 'Session duration not found in config';
    END IF;

    v_expires_at := NOW() + v_duration::INTERVAL;

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
CREATE OR REPLACE FUNCTION auth.validate_session(
    p_session_id UUID,
    p_session_token TEXT DEFAULT NULL
) RETURNS UUID AS $$ 
DECLARE
    v_agent_id UUID;
    v_is_valid BOOLEAN;
BEGIN
    SELECT 
        s.auth__agent_id,
        (CASE 
            WHEN s.general__session_id IS NULL THEN false
            WHEN NOT s.session__is_active THEN false
            WHEN s.session__expires_at < NOW() THEN false
            WHEN p_session_token IS NOT NULL AND s.session__jwt != p_session_token THEN false
            ELSE true
        END) INTO v_agent_id, v_is_valid
    FROM auth.agent_sessions s
    WHERE s.general__session_id = p_session_id;

    IF v_agent_id IS NULL OR NOT v_is_valid THEN
        RAISE EXCEPTION 'Invalid session';
    END IF;

    RETURN v_agent_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION auth.cleanup_old_sessions()
RETURNS INTEGER AS $$ 
DECLARE
    v_max_age_ms INTEGER;
    v_inactive_timeout_ms INTEGER;
    v_count INTEGER;
BEGIN
    IF NOT (
        auth.is_admin_agent()
        OR auth.is_system_agent()
    ) THEN
        RAISE EXCEPTION 'Only admin agents can clean up old sessions';
    END IF;

    -- Get configuration values
    SELECT 
        (general__value ->> 'max_age_ms')::INTEGER,
        (general__value ->> 'inactive_timeout_ms')::INTEGER
    INTO 
        v_max_age_ms,
        v_inactive_timeout_ms
    FROM config.config 
    WHERE general__key = 'auth';

    WITH updated_sessions AS (
        UPDATE auth.agent_sessions 
        SET session__is_active = false
        WHERE (
            -- Session is expired
            session__expires_at < NOW() 
            -- OR session is too old
            OR session__started_at < (NOW() - (v_max_age_ms || ' milliseconds')::INTERVAL)
            -- OR session is inactive
            OR session__last_seen_at < (NOW() - (v_inactive_timeout_ms || ' milliseconds')::INTERVAL)
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
    IF NOT (
        auth.is_admin_agent() 
        OR auth.is_system_agent()
    )
       AND NOT EXISTS (
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
    IF NOT (
        auth.is_admin_agent() 
        OR auth.is_system_agent()
    )
       AND auth.current_agent_id() != p_agent_id THEN
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

-- Create async cleanup trigger function
CREATE OR REPLACE FUNCTION auth.async_cleanup_trigger()
RETURNS trigger AS $$ 
BEGIN
    -- Queue cleanup asynchronously
    PERFORM pg_notify('cleanup_old_sessions', '');
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to run after session validations
CREATE TRIGGER trigger_async_cleanup
    AFTER UPDATE OF session__last_seen_at ON auth.agent_sessions
    FOR EACH STATEMENT
    EXECUTE FUNCTION auth.async_cleanup_trigger();

--
-- SYNC GROUPS
--

-- Create sync groups table
CREATE TABLE auth.sync_groups (
    general__sync_group TEXT PRIMARY KEY,
    general__description TEXT,
    
    server__tick__rate_ms INTEGER NOT NULL,
    server__tick__max_ticks_buffer INTEGER NOT NULL,
    
    client__render_delay_ms INTEGER NOT NULL,
    client__max_prediction_time_ms INTEGER NOT NULL,
    
    network__packet_timing_variance_ms INTEGER NOT NULL
) INHERITS (auth._template);

ALTER TABLE auth.sync_groups ENABLE ROW LEVEL SECURITY;

-- Create agent sync group roles table
CREATE TABLE auth.agent_sync_group_roles (
    auth__agent_id UUID NOT NULL REFERENCES auth.agent_profiles(general__agent_profile_id) ON DELETE CASCADE,
    group__sync TEXT NOT NULL REFERENCES auth.sync_groups(general__sync_group) ON DELETE CASCADE,
    permissions__can_insert BOOLEAN NOT NULL DEFAULT false,
    permissions__can_update BOOLEAN NOT NULL DEFAULT false,
    permissions__can_delete BOOLEAN NOT NULL DEFAULT false,
    PRIMARY KEY (auth__agent_id, group__sync)
) INHERITS (auth._template);

ALTER TABLE auth.agent_sync_group_roles ENABLE ROW LEVEL SECURITY;

-- Insert default sync groups
INSERT INTO auth.sync_groups (
    general__sync_group,
    general__description,
    server__tick__rate_ms,
    server__tick__max_ticks_buffer,
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

-- Sync groups policies
CREATE POLICY "Allow viewing sync groups" ON auth.sync_groups
    FOR SELECT
    USING (true);

CREATE POLICY "Allow admin sync group modifications" ON auth.sync_groups
    FOR ALL
    USING (
        auth.is_admin_agent() 
        OR auth.is_system_agent() 
    );

-- Sync group roles policies
CREATE POLICY "Allow viewing sync group roles" ON auth.agent_sync_group_roles
    FOR SELECT
    USING (true);

CREATE POLICY "Allow admin sync group role modifications" ON auth.agent_sync_group_roles
    FOR ALL
    USING (
        auth.is_admin_agent() 
        OR auth.is_system_agent() 
    );
-- Permission check functions
CREATE OR REPLACE FUNCTION auth.has_sync_group_read_access(p_sync_group TEXT)
RETURNS BOOLEAN AS $$ 
BEGIN
    -- If user is admin, they have access to everything
    IF (
        auth.is_admin_agent() 
        OR auth.is_system_agent() 
    ) THEN
        RETURN true;
    END IF;

    -- Check if user has any role for this sync group
    -- Having any role implies read access
    RETURN EXISTS (
        SELECT 1
        FROM auth.agent_sync_group_roles AS roles
        WHERE roles.auth__agent_id = auth.current_agent_id()
          AND roles.group__sync = p_sync_group
    );
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION auth.has_sync_group_insert_access(p_sync_group TEXT)
RETURNS BOOLEAN AS $$ 
BEGIN
    -- Admins have all permissions
    IF (
        auth.is_admin_agent() 
        OR auth.is_system_agent()
    ) THEN
        RETURN true;
    END IF;

    RETURN EXISTS (
        SELECT 1
        FROM auth.agent_sync_group_roles AS roles
        WHERE roles.auth__agent_id = auth.current_agent_id()
          AND roles.group__sync = p_sync_group
          AND roles.permissions__can_insert = true
    );
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION auth.has_sync_group_update_access(p_sync_group TEXT) 
RETURNS BOOLEAN AS $$ 
BEGIN
    -- Admins have all permissions
    IF (
        auth.is_admin_agent() OR
        auth.is_system_agent()
    ) THEN
        RETURN true;
    END IF;

    RETURN EXISTS (
        SELECT 1
        FROM auth.agent_sync_group_roles AS roles
        WHERE roles.auth__agent_id = auth.current_agent_id()
          AND roles.group__sync = p_sync_group
          AND roles.permissions__can_update = true
    );
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION auth.has_sync_group_delete_access(p_sync_group TEXT) 
RETURNS BOOLEAN AS $$ 
BEGIN
    -- Admins have all permissions
    IF (
        auth.is_admin_agent() 
        OR auth.is_system_agent()
    ) THEN
        RETURN true;
    END IF;

    RETURN EXISTS (
        SELECT 1
        FROM auth.agent_sync_group_roles AS roles
        WHERE roles.auth__agent_id = auth.current_agent_id()
          AND roles.group__sync = p_sync_group
          AND roles.permissions__can_delete = true
    );
END;
$$ LANGUAGE plpgsql STABLE;

-- Create materialized view for active sessions per sync group
CREATE MATERIALIZED VIEW auth.active_sync_group_sessions AS
SELECT DISTINCT
    asgr.group__sync,
    array_agg(s.general__session_id) FILTER (WHERE s.session__is_active = true AND s.session__expires_at > NOW()) as active_session_ids
FROM auth.agent_sync_group_roles asgr
JOIN auth.agent_sessions s ON s.auth__agent_id = asgr.auth__agent_id
GROUP BY asgr.group__sync;

-- Function to refresh the materialized view
CREATE OR REPLACE FUNCTION auth.refresh_active_sessions()
RETURNS void AS $$ 
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY auth.active_sync_group_sessions;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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

CREATE OR REPLACE FUNCTION auth.set_agent_context(
    p_session_id UUID,
    p_session_token TEXT
) RETURNS BOOLEAN AS $$
DECLARE
    v_agent_id UUID;
BEGIN
    -- Verify the session token first
    v_agent_id := auth.validate_session(p_session_id, p_session_token);
    
    -- If verification failed, return false
    IF v_agent_id IS NULL THEN
        RETURN FALSE;
    END IF;
    
    -- Set the context
    PERFORM set_config('app.current_agent_id', v_agent_id::text, false);
    PERFORM set_config('app.current_session_id', p_session_id::text, false);
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION auth.clear_agent_context() 
RETURNS VOID AS $$
BEGIN
    PERFORM set_config('app.current_agent_id', NULL, false);
    PERFORM set_config('app.current_session_id', NULL, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;