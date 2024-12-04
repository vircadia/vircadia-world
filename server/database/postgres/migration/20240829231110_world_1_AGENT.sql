--
-- AGENTS AND AUTH
--

CREATE TABLE public.agent_profiles (
    general__uuid UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile__username TEXT UNIQUE,
    auth__email TEXT UNIQUE,
    auth__password_hash TEXT,
    general__created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    general__updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    auth__password_last_changed TIMESTAMPTZ
);

CREATE TABLE public.auth_providers (
    auth__provider_name TEXT PRIMARY KEY,
    meta__description TEXT,
    auth__is_active BOOLEAN NOT NULL DEFAULT TRUE,
    general__created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.agent_auth_providers (
    auth__agent_id UUID REFERENCES public.agent_profiles(general__uuid) ON DELETE CASCADE,
    auth__provider_name TEXT REFERENCES public.auth_providers(auth__provider_name) ON DELETE CASCADE,
    auth__provider_uid TEXT,
    auth__is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    general__created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (auth__agent_id, auth__provider_name)
);

CREATE TABLE public.roles (
    auth__role_name TEXT PRIMARY KEY,
    meta__description TEXT,
    auth__is_system BOOLEAN NOT NULL DEFAULT FALSE,
    auth__is_active BOOLEAN NOT NULL DEFAULT TRUE,
    auth__entity__object__can_insert BOOLEAN NOT NULL DEFAULT FALSE,
    auth__entity__script__can_insert BOOLEAN NOT NULL DEFAULT FALSE,
    general__created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.agent_roles (
    auth__agent_id UUID REFERENCES public.agent_profiles(general__uuid) ON DELETE CASCADE,
    auth__role_name TEXT REFERENCES public.roles(auth__role_name) ON DELETE CASCADE,
    auth__is_active BOOLEAN NOT NULL DEFAULT TRUE,
    auth__granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    auth__granted_by UUID REFERENCES public.agent_profiles(general__uuid),
    PRIMARY KEY (auth__agent_id, auth__role_name)
);

CREATE TABLE public.agent_sessions (
    general__session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth__agent_id UUID REFERENCES public.agent_profiles(general__uuid) ON DELETE CASCADE,
    auth__provider_name TEXT REFERENCES public.auth_providers(auth__provider_name),
    session__started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    session__last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    meta__metadata JSONB,
    session__is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE public.auth_provider_roles (
    auth__provider_name TEXT REFERENCES public.auth_providers(auth__provider_name) ON DELETE CASCADE,
    auth__provider_role_name TEXT NOT NULL,
    auth__local_role_name TEXT REFERENCES public.roles(auth__role_name) ON DELETE CASCADE,
    general__created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (auth__provider_name, auth__provider_role_name)
);

-- Enable RLS
ALTER TABLE agent_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_roles ENABLE ROW LEVEL SECURITY;

-- Indexes for Agent-related tables
CREATE INDEX idx_agent_roles_is_active ON agent_roles(auth__is_active);
CREATE INDEX idx_agent_roles_auth__role_name ON agent_roles(auth__role_name);
CREATE INDEX idx_agent_roles_auth__agent_id ON agent_roles(auth__agent_id);
CREATE INDEX idx_agent_sessions_auth__agent_id ON agent_sessions(auth__agent_id);
CREATE INDEX idx_agent_sessions_auth__provider_name ON agent_sessions(auth__provider_name);
CREATE INDEX idx_agent_profiles_email ON agent_profiles(auth__email);
CREATE INDEX idx_auth_provider_roles_local_role ON auth_provider_roles(auth__local_role_name);

-- Replace current_agent_id function that was using Supabase's auth.uid()
CREATE OR REPLACE FUNCTION current_agent_id() 
RETURNS UUID AS $$
DECLARE
    session_agent_id UUID;
BEGIN
    -- Get the agent_id from the current active session
    SELECT auth__agent_id INTO session_agent_id
    FROM agent_sessions
    WHERE session__is_active = true
    AND session__last_seen_at > (NOW() - INTERVAL '24 hours')
    ORDER BY session__last_seen_at DESC
    LIMIT 1;
    
    RETURN session_agent_id;
END;
$$ LANGUAGE plpgsql;

-- Add a function to replace auth.uid() calls
CREATE OR REPLACE FUNCTION auth_uid() 
RETURNS UUID AS $$
BEGIN
    RETURN current_agent_id();
END;
$$ LANGUAGE plpgsql;

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
    BEFORE UPDATE ON agent_profiles
    FOR EACH ROW
    EXECUTE FUNCTION set_agent_timestamps();

-- Function to check if an IP is in the admin whitelist
CREATE OR REPLACE FUNCTION is_system_agent(check_ip text)
RETURNS boolean AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 
        FROM world_config 
        WHERE key = 'admin_ips' 
        AND check_ip = ANY (SELECT jsonb_array_elements_text(value))
    );
END;
$$ LANGUAGE plpgsql;

-- Function to get system agent id
CREATE OR REPLACE FUNCTION get_system_agent_id() 
RETURNS UUID AS $$
BEGIN
    RETURN '00000000-0000-0000-0000-000000000000'::UUID;
END;
$$ LANGUAGE plpgsql;

-- Modify policies to use is_system_agent
CREATE POLICY admin_access ON agent_profiles
    TO PUBLIC
    USING (
        is_system_agent(current_setting('client.ip', TRUE)) 
        OR EXISTS (
            SELECT 1 FROM agent_roles 
            WHERE auth__agent_id = current_agent_id() 
            AND auth__role_name = 'admin'
        )
    );

-- Seed default roles
INSERT INTO public.roles 
    (auth__role_name, meta__description, auth__is_system, auth__is_active, auth__entity__object__can_insert, auth__entity__script__can_insert) 
VALUES 
    ('admin', 'System administrator with full access', TRUE, TRUE, TRUE, TRUE),
    ('agent', 'Regular agent with basic access', TRUE, TRUE, FALSE, FALSE)
ON CONFLICT (auth__role_name) DO NOTHING;

-- Create system agent with a known UUID
INSERT INTO public.agent_profiles 
    (general__uuid, profile__username, auth__email, auth__password_hash) 
VALUES 
    ('00000000-0000-0000-0000-000000000000', 'admin', 'system@internal', NULL)
ON CONFLICT (general__uuid) DO NOTHING;

-- Assign system role to the system agent
INSERT INTO public.agent_roles 
    (auth__agent_id, auth__role_name, auth__is_active) 
VALUES 
    ('00000000-0000-0000-0000-000000000000', 'admin', TRUE)
ON CONFLICT DO NOTHING;
