--
-- AGENTS AND AUTH
--

-- Create auth schema
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE auth.agent_profiles (
    general__uuid UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile__username TEXT UNIQUE,
    auth__email TEXT UNIQUE,
    general__created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    general__updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE auth.agent_auth_providers (
    auth__agent_id UUID REFERENCES auth.agent_profiles(general__uuid) ON DELETE CASCADE,
    auth__provider_name TEXT NOT NULL,
    auth__provider_uid TEXT,
    auth__is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    general__created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (auth__agent_id, auth__provider_name)
);

CREATE TABLE auth.roles (
    auth__role_name TEXT PRIMARY KEY,
    meta__description TEXT,
    auth__is_system BOOLEAN NOT NULL DEFAULT FALSE,
    auth__entity__insert BOOLEAN NOT NULL DEFAULT FALSE,
    general__created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE auth.agent_roles (
    auth__agent_id UUID REFERENCES auth.agent_profiles(general__uuid) ON DELETE CASCADE,
    auth__role_name TEXT REFERENCES auth.roles(auth__role_name) ON DELETE CASCADE,
    auth__is_active BOOLEAN NOT NULL DEFAULT TRUE,
    auth__granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    auth__granted_by UUID REFERENCES auth.agent_profiles(general__uuid),
    PRIMARY KEY (auth__agent_id, auth__role_name)
);

CREATE TABLE auth.agent_sessions (
    general__session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth__agent_id UUID REFERENCES auth.agent_profiles(general__uuid) ON DELETE CASCADE,
    auth__provider_name TEXT NOT NULL,
    session__started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    session__last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    session__expires_at TIMESTAMPTZ NOT NULL,
    session__jwt TEXT,
    session__is_active BOOLEAN NOT NULL DEFAULT TRUE,
    stats__last_subscription_message JSONB DEFAULT NULL,
    stats__last_subscription_message_at TIMESTAMPTZ DEFAULT NULL
);

-- Enable RLS
ALTER TABLE auth.agent_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.agent_roles ENABLE ROW LEVEL SECURITY;

-- Indexes for Agent-related tables
CREATE INDEX idx_agent_roles_is_active ON auth.agent_roles(auth__is_active);
CREATE INDEX idx_agent_roles_auth__role_name ON auth.agent_roles(auth__role_name);
CREATE INDEX idx_agent_roles_auth__agent_id ON auth.agent_roles(auth__agent_id);
CREATE INDEX idx_agent_sessions_auth__agent_id ON auth.agent_sessions(auth__agent_id);
CREATE INDEX idx_agent_sessions_auth__provider_name ON auth.agent_sessions(auth__provider_name);
CREATE INDEX idx_agent_profiles_email ON auth.agent_profiles(auth__email);

CREATE OR REPLACE FUNCTION current_agent_id() 
RETURNS UUID AS $$
BEGIN
    RETURN COALESCE(
        current_setting('app.current_agent_id', true)::UUID,
        '00000000-0000-0000-0000-000000000001'::UUID
    );
END;
$$ LANGUAGE plpgsql;

-- Simplify admin check
CREATE OR REPLACE FUNCTION is_admin_agent()
RETURNS boolean AS $$
BEGIN
    RETURN (SELECT usesuper FROM pg_user WHERE usename = CURRENT_USER)
           OR EXISTS (
               SELECT 1 
               FROM auth.agent_roles ar
               WHERE ar.auth__agent_id = current_agent_id()
               AND ar.auth__role_name = 'admin'
               AND ar.auth__is_active = true
           );
END;
$$ LANGUAGE plpgsql;

-- Modify policies to use is_admin_agent
CREATE POLICY admin_access ON auth.agent_profiles
    TO PUBLIC
    USING (
        is_admin_agent()
    );

-- First, let's create better RLS policies
CREATE POLICY agent_view_own_profile ON auth.agent_profiles
    FOR SELECT
    TO PUBLIC
    USING (
        general__uuid = current_agent_id()  -- Agents can view their own profile
        OR is_admin_agent()                 -- Admins can view all profiles
    );

CREATE POLICY agent_update_own_profile ON auth.agent_profiles
    FOR UPDATE
    TO PUBLIC
    USING (
        general__uuid = current_agent_id()  -- Agents can update their own profile
        OR is_admin_agent()                 -- Admins can update all profiles
    );

-- Update function to only modify updated_at timestamp
CREATE OR REPLACE FUNCTION set_agent_timestamps()
RETURNS TRIGGER AS $$
BEGIN
    NEW.general__updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Update trigger to only fire on UPDATE (not INSERT)
CREATE TRIGGER set_agent_profile_timestamps
    BEFORE UPDATE ON auth.agent_profiles
    FOR EACH ROW
    EXECUTE FUNCTION set_agent_timestamps();

-- Function to get system agent id
CREATE OR REPLACE FUNCTION get_system_agent_id() 
RETURNS UUID AS $$
BEGIN
    RETURN '00000000-0000-0000-0000-000000000000'::UUID;
END;
$$ LANGUAGE plpgsql;

-- Function to get anon agent id
CREATE OR REPLACE FUNCTION get_anon_agent_id() 
RETURNS UUID AS $$
BEGIN
    RETURN '00000000-0000-0000-0000-000000000001'::UUID;
END;
$$ LANGUAGE plpgsql;

-- Seed default roles
INSERT INTO auth.roles 
    (auth__role_name, meta__description, auth__is_system, auth__entity__insert) 
VALUES 
    ('admin', 'System administrator with full access', 
     TRUE, TRUE),
    ('agent', 'Regular agent with basic access',
     TRUE, FALSE),
    ('anon', 'Anonymous user with limited access',
     TRUE, FALSE)
ON CONFLICT (auth__role_name) DO NOTHING;

-- Create system and anon agents with a known UUID
INSERT INTO auth.agent_profiles 
    (general__uuid, profile__username, auth__email) 
VALUES 
    (get_system_agent_id(), 'admin', 'system@internal'),
    (get_anon_agent_id(), 'anon', 'anon@internal')
ON CONFLICT (general__uuid) DO NOTHING;

-- Assign system role to the system agent and anon role for the anon agent
INSERT INTO auth.agent_roles 
    (auth__agent_id, auth__role_name, auth__is_active) 
VALUES 
    (get_system_agent_id(), 'admin', TRUE),
    (get_anon_agent_id(), 'anon', TRUE)
ON CONFLICT DO NOTHING;

-- Modify the get_system_permissions_requirements function
CREATE OR REPLACE FUNCTION debug_admin_agent()
RETURNS jsonb AS $$
DECLARE
    has_role_permission boolean;
    is_superuser boolean;
BEGIN
    has_role_permission := EXISTS (
        SELECT 1 
        FROM auth.agent_roles ar
        JOIN auth.roles r ON ar.auth__role_name = r.auth__role_name
        WHERE ar.auth__agent_id = current_agent_id()
        AND ar.auth__is_active = true
        AND r.auth__is_system = true
    );

    is_superuser := (SELECT usesuper FROM pg_user WHERE usename = CURRENT_USER);

    RETURN jsonb_build_object(
        'has_role_permission', has_role_permission,
        'is_superuser', is_superuser,
        'roles', (SELECT jsonb_agg(auth__role_name) FROM auth.agent_roles WHERE auth__agent_id = current_agent_id() AND auth__is_active = true)
    );
END;
$$ LANGUAGE plpgsql;

-- Add helper function to check if current user is anonymous
CREATE OR REPLACE FUNCTION is_anon_agent()
RETURNS boolean AS $$
BEGIN
    RETURN current_agent_id() = get_anon_agent_id();
END;
$$ LANGUAGE plpgsql;

-- Update create_agent_session to handle expiry and JWT
CREATE OR REPLACE FUNCTION create_agent_session(
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
    v_duration INTERVAL;
BEGIN
    -- Only admins can create sessions
    IF NOT is_admin_agent() THEN
        RAISE EXCEPTION 'Only administrators can create sessions';
    END IF;

    -- Get duration from config
    SELECT (value->>'jwt_session_duration')::INTERVAL 
    INTO v_duration 
    FROM config.config 
    WHERE key = 'auth_settings';
    
    v_expires_at := NOW() + v_duration;

    INSERT INTO auth.agent_sessions (
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
        auth.agent_sessions.general__session_id,
        auth.agent_sessions.session__expires_at,
        auth.agent_sessions.session__jwt
    INTO v_session_id, v_expires_at, p_jwt;

    RETURN QUERY SELECT v_session_id, v_expires_at, p_jwt;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update validate_session to be more secure
CREATE OR REPLACE FUNCTION validate_session(p_session_id UUID)
RETURNS TABLE (
    auth__agent_id UUID,
    is_valid BOOLEAN,
    session_token TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        s.auth__agent_id,
        TRUE as is_valid,
        s.session__jwt as session_token
    FROM auth.agent_sessions s
    WHERE s.general__session_id = p_session_id
        AND s.session__is_active = true
        AND s.session__expires_at > NOW()
    LIMIT 1;

    -- If no row was returned, return invalid result
    IF NOT FOUND THEN
        RETURN QUERY SELECT 
            NULL::UUID as auth__agent_id,
            FALSE as is_valid,
            NULL::TEXT as session_token;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create a new function to set agent context that requires both session ID and token
CREATE OR REPLACE FUNCTION set_agent_context(
    p_session_id UUID,
    p_session_token TEXT
) RETURNS BOOLEAN AS $$
DECLARE
    v_agent_id UUID;
    v_stored_token TEXT;
BEGIN
    -- Get the agent_id and stored token from the session
    SELECT auth__agent_id, session__jwt 
    INTO v_agent_id, v_stored_token
    FROM auth.agent_sessions 
    WHERE general__session_id = p_session_id
    AND session__is_active = true
    AND session__expires_at > NOW();

    -- Verify both session exists and token matches
    IF v_agent_id IS NULL OR v_stored_token IS NULL OR v_stored_token != p_session_token THEN
        -- Set to anonymous user if validation fails
        v_agent_id := get_anon_agent_id();
    END IF;

    -- Set the agent context
    PERFORM set_config('app.current_agent_id', v_agent_id::text, true);
    
    RETURN v_agent_id != get_anon_agent_id();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to cleanup old sessions
CREATE OR REPLACE FUNCTION cleanup_old_sessions()
RETURNS INTEGER AS $$
DECLARE
    v_max_age_ms INTEGER;
    v_count INTEGER;
BEGIN
    SELECT (value->>'max_session_age_ms')::INTEGER 
    INTO v_max_age_ms 
    FROM config.config 
    WHERE key = 'client__session';

    WITH updated_sessions AS (
        UPDATE auth.agent_sessions 
        SET session__is_active = false
        WHERE session__last_seen_at < (NOW() - (v_max_age_ms || ' milliseconds')::INTERVAL)
        AND session__is_active = true
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_count FROM updated_sessions;
    
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- Update set_session_context to use configuration
CREATE OR REPLACE FUNCTION set_session_context(p_session_id UUID)
RETURNS VOID AS $$
DECLARE
    v_agent_id UUID;
    v_max_age_ms INTEGER;
BEGIN
    SELECT (value->>'max_session_age_ms')::INTEGER 
    INTO v_max_age_ms 
    FROM config.config 
    WHERE key = 'client__session';

    -- Get the agent_id from the session
    SELECT auth__agent_id INTO v_agent_id
    FROM auth.agent_sessions 
    WHERE general__session_id = p_session_id
    AND session__is_active = true
    AND session__last_seen_at > (NOW() - (v_max_age_ms || ' milliseconds')::INTERVAL);

    IF v_agent_id IS NULL THEN
        v_agent_id := get_anon_agent_id(); -- Anonymous
    END IF;

    -- Set the session context
    PERFORM set_config('app.current_agent_id', v_agent_id::text, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to invalidate a single session by session ID
CREATE OR REPLACE FUNCTION invalidate_session(
    p_session_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
    v_rows_affected INTEGER;
BEGIN
    -- Check if user has permission (must be admin or the owner of the session)
    IF NOT is_admin_agent() AND 
       NOT EXISTS (
           SELECT 1 
           FROM auth.agent_sessions 
           WHERE general__session_id = p_session_id
           AND auth__agent_id = current_agent_id()
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

-- Function to invalidate all sessions for an agent
CREATE OR REPLACE FUNCTION invalidate_agent_sessions(
    p_agent_id UUID
) RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    -- Check if user has permission (must be admin or the agent themselves)
    IF NOT is_admin_agent() AND current_agent_id() != p_agent_id THEN
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

-- Function to cleanup system tokens
CREATE OR REPLACE FUNCTION cleanup_system_tokens()
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    WITH updated_sessions AS (
        UPDATE auth.agent_sessions 
        SET session__is_active = false
        WHERE auth__agent_id = get_system_agent_id()
        AND session__expires_at < NOW()
        AND session__is_active = true
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_count FROM updated_sessions;
    
    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Replace record_session_message function with simpler version
CREATE OR REPLACE FUNCTION record_session_message(
    p_session_id UUID,
    p_message JSONB
) RETURNS BOOLEAN AS $$
BEGIN
    -- Check if session exists and is active
    IF NOT EXISTS (
        SELECT 1 FROM auth.agent_sessions 
        WHERE general__session_id = p_session_id 
        AND session__is_active = true
    ) THEN
        RETURN FALSE;
    END IF;

    -- Update session with message info
    UPDATE auth.agent_sessions 
    SET 
        stats__last_subscription_message = p_message,
        stats__last_subscription_message_at = CURRENT_TIMESTAMP,
        session__last_seen_at = CURRENT_TIMESTAMP
    WHERE general__session_id = p_session_id;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update get_session_stats function to match new structure
CREATE OR REPLACE FUNCTION get_session_stats(
    p_session_id UUID
) RETURNS TABLE (
    session_id UUID,
    is_active BOOLEAN,
    last_message JSONB,
    last_message_at TIMESTAMPTZ,
    last_seen_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ
) AS $$
BEGIN
    -- Check permissions (must be admin or session owner)
    IF NOT is_admin_agent() AND 
       NOT EXISTS (
           SELECT 1 
           FROM auth.agent_sessions 
           WHERE general__session_id = p_session_id
           AND auth__agent_id = current_agent_id()
       ) THEN
        RAISE EXCEPTION 'Insufficient permissions to view session stats';
    END IF;

    RETURN QUERY
    SELECT 
        s.general__session_id,
        s.session__is_active,
        s.stats__last_subscription_message,
        s.stats__last_subscription_message_at,
        s.session__last_seen_at,
        s.session__expires_at
    FROM auth.agent_sessions s
    WHERE s.general__session_id = p_session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Revoke set_config from public
REVOKE ALL ON FUNCTION pg_catalog.set_config(text, text, boolean) FROM PUBLIC;

-- Only allow superuser to set config
-- Instead of granting to 'postgres' specifically, we'll grant to the current superuser
DO $$ 
BEGIN
    -- Grant to current user (assuming they're a superuser)
    EXECUTE format(
        'GRANT EXECUTE ON FUNCTION pg_catalog.set_config(text, text, boolean) TO %I',
        CURRENT_USER
    );
END $$;
