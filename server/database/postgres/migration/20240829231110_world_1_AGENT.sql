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
