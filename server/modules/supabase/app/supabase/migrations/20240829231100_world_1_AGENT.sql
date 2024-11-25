--
-- AGENTS AND AUTH
--
CREATE TABLE public.agent_profiles (
    general__uuid UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    profile__username TEXT UNIQUE,
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
    auth__can_insert BOOLEAN NOT NULL DEFAULT FALSE,
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

-- Indexes for Agent-related tables
CREATE INDEX idx_agent_roles_is_active ON agent_roles(auth__is_active);
CREATE INDEX idx_agent_roles_auth__role_name ON agent_roles(auth__role_name);
CREATE INDEX idx_agent_roles_auth__agent_id ON agent_roles(auth__agent_id);
CREATE INDEX idx_agent_sessions_auth__agent_id ON agent_sessions(auth__agent_id);
CREATE INDEX idx_agent_sessions_auth__provider_name ON agent_sessions(auth__provider_name);
