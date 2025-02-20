-- 1. Create schema
CREATE SCHEMA IF NOT EXISTS auth;

-- 2. Initial schema-level permissions (needed for object creation)
REVOKE ALL ON SCHEMA auth FROM PUBLIC, vircadia_agent_proxy;
GRANT USAGE ON SCHEMA auth TO vircadia_agent_proxy;

-- 3. Create all objects
CREATE TABLE auth.agent_profiles (
    general__agent_profile_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile__username TEXT UNIQUE,
    auth__email TEXT UNIQUE,
    auth__is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    auth__is_anon BOOLEAN NOT NULL DEFAULT FALSE
) INHERITS (auth._template);
ALTER TABLE auth.agent_profiles ENABLE ROW LEVEL SECURITY;

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
ALTER TABLE auth.agent_auth_providers ENABLE ROW LEVEL SECURITY;

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
ALTER TABLE auth.agent_sessions ENABLE ROW LEVEL SECURITY;

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

CREATE TABLE auth.agent_sync_group_roles (
    auth__agent_id UUID NOT NULL REFERENCES auth.agent_profiles(general__agent_profile_id) ON DELETE CASCADE,
    group__sync TEXT NOT NULL REFERENCES auth.sync_groups(general__sync_group) ON DELETE CASCADE,
    permissions__can_insert BOOLEAN NOT NULL DEFAULT false,
    permissions__can_update BOOLEAN NOT NULL DEFAULT false,
    permissions__can_delete BOOLEAN NOT NULL DEFAULT false,
    PRIMARY KEY (auth__agent_id, group__sync)
) INHERITS (auth._template);
ALTER TABLE auth.agent_sync_group_roles ENABLE ROW LEVEL SECURITY;

-- 4. Create all functions
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
    SELECT auth_config__session_max_per_agent
    INTO v_max_sessions 
    FROM config.auth_config;

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
    SELECT auth_config__default_session_duration_jwt_string
    INTO v_duration 
    FROM config.auth_config;

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
        auth_config__default_session_max_age_ms,
        auth_config__session_inactive_expiry_ms
    INTO 
        v_max_age_ms,
        v_inactive_timeout_ms
    FROM config.auth_config;

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

-- Replace the async cleanup with direct cleanup
CREATE OR REPLACE FUNCTION auth.cleanup_trigger()
RETURNS trigger AS $$ 
DECLARE
    v_max_age_ms INTEGER;
    v_inactive_timeout_ms INTEGER;
BEGIN
    -- Get configuration values
    SELECT 
        auth_config__default_session_max_age_ms,
        auth_config__session_inactive_expiry_ms
    INTO 
        v_max_age_ms,
        v_inactive_timeout_ms
    FROM config.auth_config;

    -- Directly cleanup old sessions
    UPDATE auth.agent_sessions 
    SET session__is_active = false
    WHERE (
        session__expires_at < NOW() 
        OR session__started_at < (NOW() - (v_max_age_ms || ' milliseconds')::INTERVAL)
        OR session__last_seen_at < (NOW() - (v_inactive_timeout_ms || ' milliseconds')::INTERVAL)
    )
    AND session__is_active = true;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to run after session updates
CREATE TRIGGER trigger_cleanup
    AFTER UPDATE OF session__last_seen_at ON auth.agent_sessions
    FOR EACH STATEMENT
    EXECUTE FUNCTION auth.cleanup_trigger();

-- First, add the materialized view before the triggers section
CREATE MATERIALIZED VIEW IF NOT EXISTS auth.active_sync_group_sessions AS
SELECT DISTINCT
    s.general__session_id,
    s.auth__agent_id,
    s.session__started_at,
    s.session__last_seen_at,
    s.session__expires_at,
    s.session__is_active,
    r.group__sync,
    r.permissions__can_insert,
    r.permissions__can_update,
    r.permissions__can_delete,
    ap.auth__is_admin,
    ap.auth__is_anon
FROM auth.agent_sessions s
JOIN auth.agent_profiles ap ON s.auth__agent_id = ap.general__agent_profile_id
LEFT JOIN auth.agent_sync_group_roles r ON s.auth__agent_id = r.auth__agent_id
WHERE 
    s.session__is_active = true 
    AND s.session__expires_at > NOW()
WITH DATA;

-- Create index for better performance
CREATE UNIQUE INDEX IF NOT EXISTS active_sync_group_sessions_session_group 
ON auth.active_sync_group_sessions (general__session_id, group__sync);

-- Replace the notification-based trigger function with direct refresh
CREATE OR REPLACE FUNCTION auth.refresh_active_sessions_trigger()
RETURNS trigger AS $$ 
BEGIN
    REFRESH MATERIALIZED VIEW auth.active_sync_group_sessions;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 5. Create all policies
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

-- 6. Create all triggers
CREATE TRIGGER refresh_active_sessions_on_session_change
    AFTER INSERT OR UPDATE OR DELETE ON auth.agent_sessions
    FOR EACH STATEMENT
    EXECUTE FUNCTION auth.refresh_active_sessions_trigger();

CREATE TRIGGER refresh_active_sessions_on_role_change
    AFTER INSERT OR UPDATE OR DELETE ON auth.agent_sync_group_roles
    FOR EACH STATEMENT
    EXECUTE FUNCTION auth.refresh_active_sessions_trigger();

-- 7. THEN do comprehensive revocation for all objects
REVOKE ALL ON ALL TABLES IN SCHEMA auth FROM PUBLIC, vircadia_agent_proxy;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA auth FROM PUBLIC, vircadia_agent_proxy;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA auth FROM PUBLIC, vircadia_agent_proxy;
REVOKE ALL ON ALL PROCEDURES IN SCHEMA auth FROM PUBLIC, vircadia_agent_proxy;
REVOKE ALL ON ALL ROUTINES IN SCHEMA auth FROM PUBLIC, vircadia_agent_proxy;

-- 8. THEN grant specific permissions
GRANT SELECT ON auth.agent_profiles TO vircadia_agent_proxy;
GRANT SELECT ON auth.sync_groups TO vircadia_agent_proxy;
GRANT EXECUTE ON FUNCTION auth.is_anon_agent TO vircadia_agent_proxy;

-- 9. Finally do data inserts
-- Create a profile for the system agent
INSERT INTO auth.agent_profiles 
    (general__agent_profile_id, profile__username, auth__email, auth__is_admin) 
VALUES 
    (auth.get_system_agent_id(), 'admin', 'system@internal', true)
ON CONFLICT (general__agent_profile_id) DO NOTHING;

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