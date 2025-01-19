--
-- AGENTS AND AUTH
--

-- Create auth schema
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE auth.agent_profiles (
    general__uuid UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile__username TEXT UNIQUE,
    auth__email TEXT UNIQUE,
    auth__password_hash TEXT,
    general__created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    general__updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    auth__password_last_changed TIMESTAMPTZ
);

CREATE TABLE auth.auth_providers (
    auth__provider_name TEXT PRIMARY KEY,
    meta__description TEXT,
    auth__is_active BOOLEAN NOT NULL DEFAULT TRUE,
    general__created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE auth.agent_auth_providers (
    auth__agent_id UUID REFERENCES auth.agent_profiles(general__uuid) ON DELETE CASCADE,
    auth__provider_name TEXT REFERENCES auth.auth_providers(auth__provider_name) ON DELETE CASCADE,
    auth__provider_uid TEXT,
    auth__is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    general__created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (auth__agent_id, auth__provider_name)
);

CREATE TABLE auth.roles (
    auth__role_name TEXT PRIMARY KEY,
    meta__description TEXT,
    auth__is_system BOOLEAN NOT NULL DEFAULT FALSE,
    auth__is_active BOOLEAN NOT NULL DEFAULT TRUE,
    auth__entity__object__can_insert BOOLEAN NOT NULL DEFAULT FALSE,
    auth__entity__script__full BOOLEAN NOT NULL DEFAULT FALSE,
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
    auth__provider_name TEXT REFERENCES auth.auth_providers(auth__provider_name),
    session__started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    session__last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    meta__metadata JSONB,
    session__is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE auth.auth_provider_roles (
    auth__provider_name TEXT REFERENCES auth.auth_providers(auth__provider_name) ON DELETE CASCADE,
    auth__provider_role_name TEXT NOT NULL,
    auth__local_role_name TEXT REFERENCES auth.roles(auth__role_name) ON DELETE CASCADE,
    general__created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (auth__provider_name, auth__provider_role_name)
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
CREATE INDEX idx_auth_provider_roles_local_role ON auth.auth_provider_roles(auth__local_role_name);

-- Replace current_agent_id function that was using Supabase's auth.uid()
CREATE OR REPLACE FUNCTION current_agent_id() 
RETURNS UUID AS $$
DECLARE
    session_agent_id UUID;
BEGIN
    -- Get the agent_id from the current active session
    SELECT auth__agent_id INTO session_agent_id
    FROM auth.agent_sessions
    WHERE session__is_active = true
    AND session__last_seen_at > (NOW() - INTERVAL '24 hours')
    ORDER BY session__last_seen_at DESC
    LIMIT 1;
    
    RETURN session_agent_id;
END;
$$ LANGUAGE plpgsql;

-- Make the auth_uid() function more secure
CREATE OR REPLACE FUNCTION auth_uid() 
RETURNS UUID AS $$
BEGIN
    -- Only allow setting auth.uid_internal through verified sessions
    RETURN NULLIF(current_setting('auth.uid_internal', true), '')::UUID;
EXCEPTION
    -- Return anonymous user if no valid session
    WHEN OTHERS THEN
        RETURN '00000000-0000-0000-0000-000000000001'::UUID;
END;
$$ LANGUAGE plpgsql;

-- Create a secure function to set the auth context
CREATE OR REPLACE FUNCTION set_auth_uid(agent_id UUID)
RETURNS void AS $$
BEGIN
    -- Only superusers can call this function
    IF NOT (SELECT usesuper FROM pg_user WHERE usename = CURRENT_USER) THEN
        RAISE EXCEPTION 'Permission denied: Only superusers can set auth context';
    END IF;
    
    -- Verify the agent exists (except for anonymous and system users)
    IF agent_id NOT IN ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000001') THEN
        IF NOT EXISTS (SELECT 1 FROM auth.agent_profiles WHERE general__uuid = agent_id) THEN
            RAISE EXCEPTION 'Invalid agent_id';
        END IF;
    END IF;

    PERFORM set_config('auth.uid_internal', agent_id::text, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Revoke direct set_config privileges
REVOKE ALL ON FUNCTION set_config(text, text, boolean) FROM PUBLIC;

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

-- Seed default roles
INSERT INTO auth.roles 
    (auth__role_name, meta__description, auth__is_system, auth__is_active, auth__entity__object__can_insert, auth__entity__script__full) 
VALUES 
    ('admin', 'System administrator with full access', TRUE, TRUE, TRUE, TRUE),
    ('agent', 'Regular agent with basic access', TRUE, TRUE, FALSE, FALSE),
    ('anon', 'Anonymous user with limited access', TRUE, TRUE, FALSE, FALSE)
ON CONFLICT (auth__role_name) DO NOTHING;

-- Create system and anon agents with a known UUID
INSERT INTO auth.agent_profiles 
    (general__uuid, profile__username, auth__email, auth__password_hash) 
VALUES 
    ('00000000-0000-0000-0000-000000000000', 'admin', 'system@internal', NULL),
    ('00000000-0000-0000-0000-000000000001', 'anon', 'anon@internal', NULL)
ON CONFLICT (general__uuid) DO NOTHING;

-- Assign system role to the system agent and anon role for the anon agent
INSERT INTO auth.agent_roles 
    (auth__agent_id, auth__role_name, auth__is_active) 
VALUES 
    ('00000000-0000-0000-0000-000000000000', 'admin', TRUE),
    ('00000000-0000-0000-0000-000000000001', 'anon', TRUE)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION is_admin_agent()
RETURNS boolean AS $$
BEGIN
    RETURN (
        -- Check if the user is a database superuser
        (SELECT usesuper FROM pg_user WHERE usename = CURRENT_USER)
        OR
        -- Check if the user has the admin role in our application
        EXISTS (
            SELECT 1 
            FROM auth.agent_roles ar
            JOIN auth.roles r ON ar.auth__role_name = r.auth__role_name
            WHERE ar.auth__agent_id = auth_uid()
            AND ar.auth__is_active = true
            AND r.auth__role_name = 'admin'
        )
    );
END;
$$ LANGUAGE plpgsql;

-- Modify policies to use is_admin_agent
CREATE POLICY admin_access ON auth.agent_profiles
    TO PUBLIC
    USING (
        is_admin_agent()
    );

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
        WHERE ar.auth__agent_id = auth_uid()
        AND ar.auth__is_active = true
        AND r.auth__is_system = true
    );

    is_superuser := (SELECT usesuper FROM pg_user WHERE usename = CURRENT_USER);

    RETURN jsonb_build_object(
        'has_role_permission', has_role_permission,
        'is_superuser', is_superuser,
        'roles', (SELECT jsonb_agg(auth__role_name) FROM auth.agent_roles WHERE auth__agent_id = auth_uid() AND auth__is_active = true)
    );
END;
$$ LANGUAGE plpgsql;

-- Add helper function to check if current user is anonymous
CREATE OR REPLACE FUNCTION is_anon_agent()
RETURNS boolean AS $$
BEGIN
    RETURN auth_uid() = '00000000-0000-0000-0000-000000000001'::UUID;
END;
$$ LANGUAGE plpgsql;

-- Add function to create a new session
CREATE OR REPLACE FUNCTION create_agent_session(
    p_agent_id UUID,
    p_provider_name TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_session_id UUID;
BEGIN
    -- Only admins can create sessions
    IF NOT is_admin_agent() THEN
        RAISE EXCEPTION 'Only administrators can create sessions';
    END IF;

    INSERT INTO auth.agent_sessions (
        auth__agent_id,
        auth__provider_name
    ) VALUES (
        p_agent_id,
        p_provider_name
    ) RETURNING general__session_id INTO v_session_id;

    RETURN v_session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;