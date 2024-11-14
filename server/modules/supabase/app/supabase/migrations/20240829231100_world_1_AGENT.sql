--
-- AGENTS AND AUTH
--
CREATE TABLE public.agent_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    password_last_changed TIMESTAMPTZ
);

CREATE TABLE public.auth_providers (
    provider_name TEXT PRIMARY KEY,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.agent_auth_providers (
    agent_id UUID REFERENCES public.agent_profiles(id) ON DELETE CASCADE,
    provider_name TEXT REFERENCES public.auth_providers(provider_name) ON DELETE CASCADE,
    provider_uid TEXT,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (agent_id, provider_name)
);

CREATE TABLE public.roles (
    role_name TEXT PRIMARY KEY,
    description TEXT,
    is_system BOOLEAN NOT NULL DEFAULT FALSE,
    parent_role TEXT REFERENCES roles(role_name),
    hierarchy_path ltree,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.agent_roles (
    agent_id UUID REFERENCES public.agent_profiles(id) ON DELETE CASCADE,
    role_name TEXT REFERENCES public.roles(role_name) ON DELETE CASCADE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    granted_by UUID REFERENCES public.agent_profiles(id),
    PRIMARY KEY (agent_id, role_name)
);

CREATE TABLE public.agent_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID REFERENCES public.agent_profiles(id) ON DELETE CASCADE,
    provider_name TEXT REFERENCES public.auth_providers(provider_name),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

-- Indexes for Agent-related tables
CREATE INDEX idx_roles_parent_role ON roles(parent_role);
CREATE INDEX idx_roles_hierarchy_path ON roles USING GIST (hierarchy_path);
CREATE INDEX idx_agent_roles_is_active ON agent_roles(is_active);
