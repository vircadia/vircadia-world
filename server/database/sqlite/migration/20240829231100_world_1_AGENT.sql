--
-- AGENTS AND AUTH
--
CREATE TABLE agent_profiles (
    general__uuid TEXT PRIMARY KEY,  -- Changed from UUID to TEXT
    profile__username TEXT UNIQUE,
    general__created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    general__updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (general__uuid) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE auth_providers (
    auth__provider_name TEXT PRIMARY KEY,
    meta__description TEXT,
    auth__is_active INTEGER NOT NULL DEFAULT 1,  -- Changed BOOLEAN to INTEGER
    general__created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE agent_auth_providers (
    auth__agent_id TEXT,  -- Changed from UUID to TEXT
    auth__provider_name TEXT,
    auth__provider_uid TEXT,
    auth__is_primary INTEGER NOT NULL DEFAULT 0,  -- Changed BOOLEAN to INTEGER
    general__created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (auth__agent_id, auth__provider_name),
    FOREIGN KEY (auth__agent_id) REFERENCES agent_profiles(general__uuid) ON DELETE CASCADE,
    FOREIGN KEY (auth__provider_name) REFERENCES auth_providers(auth__provider_name) ON DELETE CASCADE
);

CREATE TABLE roles (
    auth__role_name TEXT PRIMARY KEY,
    meta__description TEXT,
    auth__is_system INTEGER NOT NULL DEFAULT 0,  -- Changed BOOLEAN to INTEGER
    auth__is_active INTEGER NOT NULL DEFAULT 1,  -- Changed BOOLEAN to INTEGER
    auth__entity__object__can_insert INTEGER NOT NULL DEFAULT 0,  -- Changed BOOLEAN to INTEGER
    auth__entity__script__full INTEGER NOT NULL DEFAULT 0,  -- Changed BOOLEAN to INTEGER
    general__created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE agent_roles (
    auth__agent_id TEXT,  -- Changed from UUID to TEXT
    auth__role_name TEXT,
    auth__is_active INTEGER NOT NULL DEFAULT 1,  -- Changed BOOLEAN to INTEGER
    auth__granted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    auth__granted_by TEXT,  -- Changed from UUID to TEXT
    PRIMARY KEY (auth__agent_id, auth__role_name),
    FOREIGN KEY (auth__agent_id) REFERENCES agent_profiles(general__uuid) ON DELETE CASCADE,
    FOREIGN KEY (auth__role_name) REFERENCES roles(auth__role_name) ON DELETE CASCADE,
    FOREIGN KEY (auth__granted_by) REFERENCES agent_profiles(general__uuid)
);

CREATE TABLE agent_sessions (
    general__session_id TEXT PRIMARY KEY,  -- Changed from UUID to TEXT
    auth__agent_id TEXT,  -- Changed from UUID to TEXT
    auth__provider_name TEXT,
    session__started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    session__last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    meta__metadata TEXT,  -- Changed JSONB to TEXT for JSON storage
    session__is_active INTEGER NOT NULL DEFAULT 1,  -- Changed BOOLEAN to INTEGER
    FOREIGN KEY (auth__agent_id) REFERENCES agent_profiles(general__uuid) ON DELETE CASCADE,
    FOREIGN KEY (auth__provider_name) REFERENCES auth_providers(auth__provider_name)
);


CREATE TABLE auth_provider_role_mappings (
    auth__provider_name TEXT,
    auth__provider_role_id TEXT,     -- External role/group ID (e.g., Azure AD Group ID)
    auth__provider_role_name TEXT,   -- Human readable name of the external role
    auth__internal_role_name TEXT,   -- Our internal role name
    auth__is_active INTEGER NOT NULL DEFAULT 1,
    general__created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (auth__provider_name, auth__provider_role_id),
    FOREIGN KEY (auth__provider_name) REFERENCES auth_providers(auth__provider_name) ON DELETE CASCADE,
    FOREIGN KEY (auth__internal_role_name) REFERENCES roles(auth__role_name) ON DELETE CASCADE
);

-- Indexes for Agent-related tables
CREATE INDEX idx_agent_roles_is_active ON agent_roles(auth__is_active);
CREATE INDEX idx_agent_roles_auth__role_name ON agent_roles(auth__role_name);
CREATE INDEX idx_agent_roles_auth__agent_id ON agent_roles(auth__agent_id);
CREATE INDEX idx_agent_sessions_auth__agent_id ON agent_sessions(auth__agent_id);
CREATE INDEX idx_agent_sessions_auth__provider_name ON agent_sessions(auth__provider_name);

CREATE INDEX idx_auth_provider_role_mappings_role ON auth_provider_role_mappings(auth__internal_role_name);