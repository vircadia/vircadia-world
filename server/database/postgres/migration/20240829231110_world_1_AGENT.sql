--
-- AGENTS AND AUTH
--

-- Create auth schema
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE auth.agent_profiles (
    general__agent_profile_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile__username TEXT UNIQUE,
    auth__email TEXT UNIQUE,
    general__created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    general__updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE auth.agent_auth_providers (
    auth__agent_id UUID REFERENCES auth.agent_profiles(general__agent_profile_id) ON DELETE CASCADE,
    auth__provider_name TEXT NOT NULL,
    auth__provider_uid TEXT,
    auth__is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    general__created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    general__updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (auth__agent_id, auth__provider_name)
);

CREATE TABLE auth.roles (
    auth__role_name TEXT PRIMARY KEY,
    meta__description TEXT,
    auth__is_system BOOLEAN NOT NULL DEFAULT FALSE,
    auth__entity__insert BOOLEAN NOT NULL DEFAULT FALSE,
    general__created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    general__updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE auth.agent_roles (
    auth__agent_id UUID REFERENCES auth.agent_profiles(general__agent_profile_id) ON DELETE CASCADE,
    auth__role_name TEXT REFERENCES auth.roles(auth__role_name) ON DELETE CASCADE,
    auth__is_active BOOLEAN NOT NULL DEFAULT TRUE,
    auth__granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    auth__granted_by UUID REFERENCES auth.agent_profiles(general__agent_profile_id),
    general__created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    general__updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (auth__agent_id, auth__role_name)
);

CREATE TABLE auth.agent_sessions (
    general__session_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auth__agent_id UUID REFERENCES auth.agent_profiles(general__agent_profile_id) ON DELETE CASCADE,
    auth__provider_name TEXT NOT NULL,
    session__started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    session__last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    session__expires_at TIMESTAMPTZ NOT NULL,
    session__jwt TEXT,
    session__is_active BOOLEAN NOT NULL DEFAULT TRUE,
    stats__last_subscription_message JSONB DEFAULT NULL,
    stats__last_subscription_message_at TIMESTAMPTZ DEFAULT NULL,
    general__created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    general__updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

-- Add optimized indexes for session-based entity change distribution
CREATE INDEX idx_agent_sessions_active_lookup ON auth.agent_sessions 
    (session__is_active, session__expires_at) 
    WHERE session__is_active = true;

CREATE INDEX idx_agent_roles_active_lookup ON auth.agent_roles 
    (auth__agent_id, auth__role_name) 
    WHERE auth__is_active = true;

-- Add composite index for session validation
CREATE INDEX idx_agent_sessions_validation ON auth.agent_sessions 
    (general__session_id, session__is_active, session__expires_at) 
    WHERE session__is_active = true;

-- Move functions to auth schema
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

CREATE OR REPLACE FUNCTION auth.is_admin_agent()
RETURNS boolean AS $$
BEGIN
    RETURN (SELECT usesuper FROM pg_user WHERE usename = CURRENT_USER)
           OR EXISTS (
               SELECT 1 
               FROM auth.agent_roles ar
               WHERE ar.auth__agent_id = auth.current_agent_id()
               AND ar.auth__role_name = 'admin'
               AND ar.auth__is_active = true
           );
END;
$$ LANGUAGE plpgsql;

-- Modify policies to use is_admin_agent
CREATE POLICY admin_access ON auth.agent_profiles
    TO PUBLIC
    USING (
        auth.is_admin_agent()
    );

-- First, let's create better RLS policies
CREATE POLICY agent_view_own_profile ON auth.agent_profiles
    FOR SELECT
    TO PUBLIC
    USING (
        general__agent_profile_id = auth.current_agent_id()  -- Agents can view their own profile
        OR auth.is_admin_agent()                 -- Admins can view all profiles
    );

CREATE POLICY agent_update_own_profile ON auth.agent_profiles
    FOR UPDATE
    TO PUBLIC
    USING (
        general__agent_profile_id = auth.current_agent_id()  -- Agents can update their own profile
        OR auth.is_admin_agent()                 -- Admins can update all profiles
    );

-- Update function to only modify updated_at timestamp
CREATE OR REPLACE FUNCTION auth.set_agent_timestamps()
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
    EXECUTE FUNCTION auth.set_agent_timestamps();

-- Function to get system agent id
CREATE OR REPLACE FUNCTION auth.get_system_agent_id() 
RETURNS UUID AS $$
BEGIN
    RETURN '00000000-0000-0000-0000-000000000000'::UUID;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION auth.get_anon_agent_id() 
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
    (general__agent_profile_id, profile__username, auth__email) 
VALUES 
    (auth.get_system_agent_id(), 'admin', 'system@internal'),
    (auth.get_anon_agent_id(), 'anon', 'anon@internal')
ON CONFLICT (general__agent_profile_id) DO NOTHING;

-- Assign system role to the system agent and anon role for the anon agent
INSERT INTO auth.agent_roles 
    (auth__agent_id, auth__role_name, auth__is_active) 
VALUES 
    (auth.get_system_agent_id(), 'admin', TRUE),
    (auth.get_anon_agent_id(), 'anon', TRUE)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION auth.is_anon_agent()
RETURNS boolean AS $$
BEGIN
    RETURN auth.current_agent_id() = auth.get_anon_agent_id();
END;
$$ LANGUAGE plpgsql;

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
    -- Only admins can create sessions
    IF NOT auth.is_admin_agent() THEN
        RAISE EXCEPTION 'Only administrators can create sessions';
    END IF;

    -- Get max sessions per agent from config
    SELECT (general__value->>'max_sessions_per_agent')::INTEGER 
    INTO v_max_sessions 
    FROM config.config 
    WHERE general__key = 'client_settings';

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
        UPDATE auth.agent_sessions 
        SET session__is_active = false,
            session__expires_at = NOW()
        WHERE general__session_id = (
            SELECT general__session_id 
            FROM auth.agent_sessions 
            WHERE auth__agent_id = p_agent_id 
            AND session__is_active = true 
            ORDER BY session__started_at ASC 
            LIMIT 1
        );
    END IF;

    -- Get duration from config
    SELECT (general__value->'auth'->>'session_duration_ms')::BIGINT 
    INTO v_duration 
    FROM config.config 
    WHERE general__key = 'client_settings';
    
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

CREATE OR REPLACE FUNCTION auth.validate_session(p_session_id UUID)
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

-- Add new function to explicitly clear agent context
CREATE OR REPLACE FUNCTION auth.clear_agent_context()
RETURNS VOID AS $$
BEGIN
    -- Explicitly set to anon agent ID instead of NULL or empty string
    PERFORM set_config('app.current_agent_id', auth.get_anon_agent_id()::text, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update set_agent_context to be more strict
CREATE OR REPLACE FUNCTION auth.set_agent_context(
    p_session_id UUID,
    p_session_token TEXT
) RETURNS BOOLEAN AS $$
DECLARE
    v_agent_id UUID;
    v_stored_token TEXT;
    v_is_active BOOLEAN;
    v_expires_at TIMESTAMPTZ;
    v_result TEXT;
BEGIN
    -- Get the agent_id and stored token from the session
    SELECT 
        auth__agent_id, 
        session__jwt,
        session__is_active,
        session__expires_at
    INTO 
        v_agent_id, 
        v_stored_token,
        v_is_active,
        v_expires_at
    FROM auth.agent_sessions 
    WHERE general__session_id = p_session_id;

    -- Add debug logging
    RAISE NOTICE 'Session check: agent_id %, stored_token %, active %, expires %', 
        v_agent_id, SUBSTRING(v_stored_token, 1, 10), v_is_active, v_expires_at;
    RAISE NOTICE 'Provided token: %', SUBSTRING(p_session_token, 1, 10);

    -- Verify session exists, is active, not expired, and token matches
    IF v_agent_id IS NULL OR 
       v_stored_token IS NULL OR 
       TRIM(v_stored_token) != TRIM(p_session_token) OR
       NOT v_is_active OR
       v_expires_at <= NOW() THEN
        -- Set to anonymous user if validation fails
        RAISE NOTICE 'Validation failed: exists=%, token_match=%, active=%, not_expired=%',
            v_agent_id IS NOT NULL,
            CASE WHEN v_stored_token IS NOT NULL THEN TRIM(v_stored_token) = TRIM(p_session_token) ELSE FALSE END,
            v_is_active,
            v_expires_at > NOW();
        
        -- Call clear_agent_context instead of direct assignment
        PERFORM auth.clear_agent_context();
        RETURN FALSE;
    END IF;

    -- Set the agent context with local = false to make it persist
    SELECT set_config('app.current_agent_id', v_agent_id::text, false) INTO v_result;
    RAISE NOTICE 'Set config result: %', v_result;
    
    -- Update last seen timestamp for valid sessions
    UPDATE auth.agent_sessions 
    SET session__last_seen_at = NOW()
    WHERE general__session_id = p_session_id;

    -- Verify the setting was applied
    RAISE NOTICE 'Current agent ID after set: %', current_setting('app.current_agent_id', true);

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION auth.cleanup_old_sessions()
RETURNS INTEGER AS $$
DECLARE
    v_max_age_ms INTEGER;
    v_count INTEGER;
BEGIN
    SELECT (general__value->'session'->>'max_age_ms')::INTEGER 
    INTO v_max_age_ms 
    FROM config.config 
    WHERE general__key = 'client_settings';

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

CREATE OR REPLACE FUNCTION auth.set_session_context(p_session_id UUID)
RETURNS VOID AS $$
DECLARE
    v_agent_id UUID;
    v_max_age_ms INTEGER;
BEGIN
    SELECT (general__value->'session'->>'max_age_ms')::INTEGER 
    INTO v_max_age_ms 
    FROM config.config 
    WHERE general__key = 'client_settings';

    -- Get the agent_id from the session
    SELECT auth__agent_id INTO v_agent_id
    FROM auth.agent_sessions 
    WHERE general__session_id = p_session_id
    AND session__is_active = true
    AND session__last_seen_at > (NOW() - (v_max_age_ms || ' milliseconds')::INTERVAL);

    IF v_agent_id IS NULL THEN
        v_agent_id := auth.get_anon_agent_id(); -- Anonymous
    END IF;

    -- Set the session context
    PERFORM set_config('app.current_agent_id', v_agent_id::text, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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

CREATE OR REPLACE FUNCTION auth.record_session_message(
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

CREATE OR REPLACE FUNCTION auth.get_session_stats(
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
    IF NOT auth.is_admin_agent() AND 
       NOT EXISTS (
           SELECT 1 
           FROM auth.agent_sessions 
           WHERE general__session_id = p_session_id
           AND auth__agent_id = auth.current_agent_id()
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

CREATE TRIGGER update_agent_roles_updated_at
    BEFORE UPDATE ON auth.agent_roles
    FOR EACH ROW
    EXECUTE FUNCTION auth.set_agent_timestamps();

CREATE TRIGGER update_agent_sessions_updated_at
    BEFORE UPDATE ON auth.agent_sessions
    FOR EACH ROW
    EXECUTE FUNCTION auth.set_agent_timestamps();

CREATE TRIGGER update_roles_updated_at
    BEFORE UPDATE ON auth.roles
    FOR EACH ROW
    EXECUTE FUNCTION auth.set_agent_timestamps();
