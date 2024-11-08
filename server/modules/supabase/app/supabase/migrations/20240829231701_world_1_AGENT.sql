--
-- 
-- AGENTS
--
--

-- Base agent profiles table
CREATE TABLE public.agent_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    password_last_changed TIMESTAMPTZ
);

-- Auth providers table
CREATE TABLE public.auth_providers (
    provider_name TEXT PRIMARY KEY,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert default providers
INSERT INTO public.auth_providers (provider_name, description) VALUES
    ('email', 'Email and password authentication'),
    ('anonymous', 'Anonymous authentication'),
    ('google', 'Google OAuth'),
    ('github', 'GitHub OAuth'),
    ('discord', 'Discord OAuth');

-- Agent auth providers junction
CREATE TABLE public.agent_auth_providers (
    agent_id UUID REFERENCES public.agent_profiles(id) ON DELETE CASCADE,
    provider_name TEXT REFERENCES public.auth_providers(provider_name) ON DELETE CASCADE,
    provider_uid TEXT,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (agent_id, provider_name)
);

-- Roles table
CREATE TABLE public.roles (
    role_name TEXT PRIMARY KEY,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert default roles
INSERT INTO public.roles (role_name, description) VALUES
    ('guest', 'Default role for all users'),
    ('user', 'Authenticated user role'),
    ('admin', 'Administrative role');

-- Agent roles junction
CREATE TABLE public.agent_roles (
    agent_id UUID REFERENCES public.agent_profiles(id) ON DELETE CASCADE,
    role_name TEXT REFERENCES public.roles(role_name) ON DELETE CASCADE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    granted_by UUID REFERENCES public.agent_profiles(id),
    PRIMARY KEY (agent_id, role_name)
);

-- Sessions table
CREATE TABLE public.agent_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID REFERENCES public.agent_profiles(id) ON DELETE CASCADE,
    provider_name TEXT REFERENCES public.auth_providers(provider_name),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

-- Helper function to check roles
CREATE OR REPLACE FUNCTION has_role(p_role TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM agent_roles 
    WHERE agent_id = auth.uid() 
    AND role_name = p_role 
    AND is_active = TRUE
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Trigger to automatically grant guest role and anonymous provider to new users
CREATE OR REPLACE FUNCTION handle_new_agent()
RETURNS TRIGGER AS $$
BEGIN
    -- Grant anonymous provider
    INSERT INTO agent_auth_providers (agent_id, provider_name, is_primary)
    VALUES (NEW.id, 'anonymous', TRUE);
    
    -- Grant guest role
    INSERT INTO agent_roles (agent_id, role_name, granted_by)
    VALUES (NEW.id, 'guest', NEW.id);
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_agent_created
    AFTER INSERT ON agent_profiles
    FOR EACH ROW
    EXECUTE FUNCTION handle_new_agent();

-- Enable RLS on all tables
ALTER TABLE auth_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_auth_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_sessions ENABLE ROW LEVEL SECURITY;

-- Basic RLS policies
CREATE POLICY "Public read for auth providers" ON auth_providers 
    FOR SELECT USING (true);

CREATE POLICY "Public read for agent auth providers" ON agent_auth_providers 
    FOR SELECT USING (true);

CREATE POLICY "Public read for roles" ON roles 
    FOR SELECT USING (true);

CREATE POLICY "Public read for agent roles" ON agent_roles 
    FOR SELECT USING (true);

CREATE POLICY "Users can read their own sessions" ON agent_sessions 
    FOR SELECT USING (agent_id = auth.uid());

-- Indexes for better performance
CREATE INDEX idx_agent_sessions_agent_id ON agent_sessions(agent_id);
CREATE INDEX idx_agent_sessions_active ON agent_sessions(is_active);
CREATE INDEX idx_agent_roles_agent_id ON agent_roles(agent_id);
CREATE INDEX idx_agent_roles_active ON agent_roles(is_active);
CREATE INDEX idx_agent_auth_providers_agent_id ON agent_auth_providers(agent_id);
