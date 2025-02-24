-- =============================================================================
-- 1. BASE TABLES
-- =============================================================================
-- Agent Profiles Table
CREATE TABLE auth.agent_profiles (
    general__agent_profile_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile__username TEXT UNIQUE,
    auth__email TEXT UNIQUE,
    auth__is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    auth__is_anon BOOLEAN NOT NULL DEFAULT FALSE,
    auth__is_system BOOLEAN NOT NULL DEFAULT FALSE
) INHERITS (auth._template);
ALTER TABLE auth.agent_profiles ENABLE ROW LEVEL SECURITY;

-- Sessions Table
CREATE TABLE auth.agent_sessions (
    general__session_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auth__agent_id UUID NOT NULL REFERENCES auth.agent_profiles(general__agent_profile_id) ON DELETE CASCADE,
    auth__provider_name TEXT NOT NULL,
    session__started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    session__last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    session__expires_at TIMESTAMPTZ NOT NULL,
    session__jwt TEXT,
    session__is_active BOOLEAN NOT NULL DEFAULT TRUE
) INHERITS (auth._template);
ALTER TABLE auth.agent_sessions ENABLE ROW LEVEL SECURITY;


-- =============================================================================
-- 2. AUTH PROVIDER TABLES
-- =============================================================================
-- Auth Provider Configurations Table
CREATE TABLE auth.auth_providers (
    provider__name TEXT PRIMARY KEY,                -- Provider identifier (e.g., 'google', 'github')
    provider__display_name TEXT NOT NULL,           -- Human-readable name
    provider__enabled BOOLEAN NOT NULL DEFAULT false,
    provider__client_id TEXT,                       -- OAuth client ID
    provider__client_secret TEXT,                   -- OAuth client secret
    provider__auth_url TEXT,                        -- OAuth authorization endpoint
    provider__token_url TEXT,                       -- OAuth token endpoint
    provider__userinfo_url TEXT,                    -- OAuth userinfo endpoint
    provider__scope TEXT[],                         -- Required OAuth scopes
    provider__metadata JSONB,                       -- Additional provider-specific configuration
    provider__icon_url TEXT,                        -- URL to provider's icon
    provider__jwt_secret TEXT NOT NULL,             -- JWT signing secret for this provider
    provider__session_max_per_agent INTEGER NOT NULL DEFAULT 1,
    provider__session_duration_jwt_string TEXT NOT NULL DEFAULT '24h',
    provider__session_duration_ms BIGINT NOT NULL DEFAULT 86400000,
    provider__session_max_age_ms BIGINT NOT NULL DEFAULT 86400000,
    provider__session_inactive_expiry_ms BIGINT NOT NULL DEFAULT 3600000
) INHERITS (auth._template);
ALTER TABLE auth.auth_providers ENABLE ROW LEVEL SECURITY;

-- Auth Providers Association Table
CREATE TABLE auth.agent_auth_providers (
    -- Core fields
    auth__agent_id UUID NOT NULL REFERENCES auth.agent_profiles(general__agent_profile_id) ON DELETE CASCADE,
    auth__provider_name TEXT NOT NULL REFERENCES auth.auth_providers(provider__name) ON DELETE RESTRICT,
    
    -- Provider-specific identifiers
    auth__provider_uid TEXT NOT NULL,              -- Provider's unique ID for the user
    auth__provider_email TEXT,                     -- Email from the provider
    
    -- OAuth tokens
    auth__access_token TEXT,                       -- Current access token
    auth__refresh_token TEXT,                      -- Refresh token (if available)
    auth__token_expires_at TIMESTAMPTZ,            -- When the access token expires
    
    -- Account status
    auth__is_verified BOOLEAN NOT NULL DEFAULT FALSE, -- Has email been verified
    auth__last_login_at TIMESTAMPTZ,               -- Track last successful login
    
    -- Additional data
    auth__metadata JSONB,                          -- Provider-specific data/claims

    -- Constraints
    PRIMARY KEY (auth__agent_id, auth__provider_name),
    UNIQUE (auth__provider_name, auth__provider_uid)
) INHERITS (auth._template);
ALTER TABLE auth.agent_auth_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.agent_sessions ADD CONSTRAINT agent_sessions_auth__provider_name_fkey
    FOREIGN KEY (auth__provider_name) REFERENCES auth.auth_providers(provider__name) ON DELETE CASCADE;


-- =============================================================================
-- 3. SYNC GROUP TABLES
-- =============================================================================
-- Sync Groups Table
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

-- Sync Group Roles Table
CREATE TABLE auth.agent_sync_group_roles (
    auth__agent_id UUID NOT NULL REFERENCES auth.agent_profiles(general__agent_profile_id) ON DELETE CASCADE,
    group__sync TEXT NOT NULL REFERENCES auth.sync_groups(general__sync_group) ON DELETE CASCADE,
    permissions__can_read BOOLEAN NOT NULL DEFAULT true,
    permissions__can_insert BOOLEAN NOT NULL DEFAULT false,
    permissions__can_update BOOLEAN NOT NULL DEFAULT false,
    permissions__can_delete BOOLEAN NOT NULL DEFAULT false,
    PRIMARY KEY (auth__agent_id, group__sync)
) INHERITS (auth._template);
ALTER TABLE auth.agent_sync_group_roles ENABLE ROW LEVEL SECURITY;


-- =============================================================================
-- 4. AUTHENTICATION FUNCTIONS
-- =============================================================================
-- Non-system agent Status Functions
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

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
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- =============================================================================
-- 5. SESSION MANAGEMENT FUNCTIONS
-- =============================================================================

CREATE OR REPLACE FUNCTION auth.validate_session(
    p_session_id UUID,
    p_session_token TEXT DEFAULT NULL
) RETURNS UUID AS $$ 
DECLARE
    v_session RECORD;
BEGIN
    SELECT *
      INTO v_session
    FROM auth.agent_sessions
    WHERE general__session_id = p_session_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Session not found for id: %', p_session_id;
    END IF;
    
    IF NOT v_session.session__is_active THEN
        RAISE EXCEPTION 'Session % is inactive', p_session_id;
    END IF;
    
    IF v_session.session__expires_at < NOW() THEN
        RAISE EXCEPTION 'Session % has expired on %', p_session_id, v_session.session__expires_at;
    END IF;
    
    IF p_session_token IS NOT NULL AND v_session.session__jwt != p_session_token THEN
        RAISE EXCEPTION 'Session token mismatch for session id: %', p_session_id;
    END IF;
    
    RETURN v_session.auth__agent_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Session Cleanup Functions
CREATE OR REPLACE FUNCTION auth.cleanup_old_sessions()
RETURNS trigger AS $$ 
BEGIN
    -- Delete expired sessions based on provider settings
    DELETE FROM auth.agent_sessions AS s
    USING auth.auth_providers AS p
    WHERE s.auth__provider_name = p.provider__name
    AND (
        -- Manual invalidation checks
        NOT s.session__is_active 
        OR s.session__expires_at < NOW()
        -- Provider-based timeout checks
        OR s.session__started_at < (NOW() - (p.provider__session_max_age_ms || ' milliseconds')::INTERVAL)
        OR s.session__last_seen_at < (NOW() - (p.provider__session_inactive_expiry_ms || ' milliseconds')::INTERVAL)
    );
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION auth.enforce_session_limit()
RETURNS TRIGGER AS $$
DECLARE
  v_current_sessions INTEGER;
  v_provider_record auth.auth_providers%ROWTYPE;
  v_oldest_session RECORD;
BEGIN
  -- Check that the provider exists and is enabled (already partly enforced by FK)
  SELECT * INTO v_provider_record
  FROM auth.auth_providers
  WHERE provider__name = NEW.auth__provider_name;

  -- Count active sessions
  SELECT COUNT(*) INTO v_current_sessions
  FROM auth.agent_sessions
  WHERE auth__agent_id = NEW.auth__agent_id
    AND auth__provider_name = NEW.auth__provider_name
    AND session__is_active = true
    AND session__expires_at > NOW();
  
  IF v_current_sessions > v_provider_record.provider__session_max_per_agent THEN
      -- Deactivate oldest session if limit reached
      SELECT general__session_id
      INTO v_oldest_session
      FROM auth.agent_sessions
      WHERE auth__agent_id = NEW.auth__agent_id
        AND auth__provider_name = NEW.auth__provider_name
        AND session__is_active = true
      ORDER BY session__started_at ASC
      LIMIT 1;
      
      IF FOUND THEN
          UPDATE auth.agent_sessions
          SET session__is_active = false,
              session__expires_at = NOW()
          WHERE general__session_id = v_oldest_session.general__session_id;
      END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION auth.set_agent_context_from_session_id(p_session_id UUID)
RETURNS void AS $$
DECLARE
    v_agent_id UUID;
BEGIN
    -- Only allow the vircadia_agent_proxy role to set the agent context
    IF NOT auth.is_proxy_agent() THEN
        RAISE EXCEPTION 'Only the proxy agent can set the agent context';
    END IF;

    -- Validate the session and get corresponding agent id.
    v_agent_id := auth.validate_session(p_session_id, NULL);

    -- Prevent changing the context if it has already been set
    IF current_setting('app.current_agent_id', true) IS NOT NULL
       AND TRIM(current_setting('app.current_agent_id', true)) <> ''
       AND TRIM(current_setting('app.current_agent_id', true)) <> 'NULL' THEN
        RAISE EXCEPTION 'Agent context already set, a new transaction must be created';
    END IF;

    -- Set the validated agent ID for the session (transaction-local)
    PERFORM set_config('app.current_agent_id', v_agent_id::text, true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- =============================================================================
-- 6. MATERIALIZED VIEWS AND RELATED FUNCTIONS
-- =============================================================================
-- Active Sessions View
CREATE MATERIALIZED VIEW IF NOT EXISTS auth.active_sync_group_sessions AS
SELECT DISTINCT
    s.general__session_id,
    s.auth__agent_id,
    s.session__started_at,
    s.session__last_seen_at,
    s.session__expires_at,
    s.session__is_active,
    r.group__sync,
    r.permissions__can_read,
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

-- Additional indexes for materialized view
CREATE UNIQUE INDEX idx_active_sync_group_sessions_lookup 
ON auth.active_sync_group_sessions (group__sync);


-- View Refresh Functions
CREATE OR REPLACE FUNCTION auth.refresh_active_sessions_trigger()
RETURNS trigger AS $$ 
BEGIN
    REFRESH MATERIALIZED VIEW auth.active_sync_group_sessions;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- =============================================================================
-- 7. INDEXES
-- =============================================================================
-- Agent Profile Indexes
CREATE INDEX idx_agent_profiles_email ON auth.agent_profiles(auth__email);

-- Agent Session Indexes
CREATE INDEX idx_agent_sessions_auth__agent_id ON auth.agent_sessions(auth__agent_id);
CREATE INDEX idx_agent_sessions_auth__provider_name ON auth.agent_sessions(auth__provider_name);
CREATE INDEX idx_agent_sessions_active_lookup ON auth.agent_sessions 
    (session__is_active, session__expires_at) 
    WHERE session__is_active = true;
CREATE INDEX idx_agent_sessions_validation ON auth.agent_sessions 
    (general__session_id, session__is_active, session__expires_at) 
    WHERE session__is_active = true;
CREATE INDEX idx_agent_sessions_last_seen ON auth.agent_sessions(session__last_seen_at) 
    WHERE session__is_active = true;


-- =============================================================================
-- 8. ROW LEVEL SECURITY POLICIES
-- =============================================================================
-- Agent Profile Policies
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

-- Sync Group Policies
CREATE POLICY "Allow viewing sync groups" ON auth.sync_groups
    FOR SELECT
    TO PUBLIC
    USING (true);

CREATE POLICY "Allow admin sync group modifications" ON auth.sync_groups
    FOR ALL
    TO PUBLIC
    USING (
        auth.is_admin_agent() 
        OR auth.is_system_agent() 
    );

-- Sync Group Role Policies
CREATE POLICY "Allow viewing sync group roles" ON auth.agent_sync_group_roles
    FOR SELECT
    TO PUBLIC
    USING (true);

CREATE POLICY "Allow admin sync group role modifications" ON auth.agent_sync_group_roles
    FOR ALL
    TO PUBLIC
    USING (
        auth.is_admin_agent() 
        OR auth.is_system_agent() 
    );

-- Agent Auth Providers Policies
CREATE POLICY "Users can view their own provider connections" ON auth.agent_auth_providers
    FOR SELECT
    TO PUBLIC
    USING (
        auth__agent_id = auth.current_agent_id()
        OR auth.is_admin_agent()
        OR auth.is_system_agent()
    );

CREATE POLICY "Only admins can manage provider connections" ON auth.agent_auth_providers
    FOR ALL
    TO PUBLIC
    USING (
        auth.is_admin_agent()
        OR auth.is_system_agent()
    );

CREATE POLICY "Only admins can manage auth providers" ON auth.auth_providers
    FOR ALL
    TO PUBLIC
    USING (
        auth.is_admin_agent()
        OR auth.is_system_agent()
    );

CREATE POLICY "Admins can manage agent sessions" ON auth.agent_sessions
    FOR ALL
    TO PUBLIC
    USING (
        auth.is_admin_agent() 
        OR auth.is_system_agent()
    );


-- =============================================================================
-- 9. TRIGGERS
-- =============================================================================
-- Session Management Triggers
CREATE TRIGGER trigger_cleanup
    AFTER INSERT OR UPDATE ON auth.agent_sessions
    FOR EACH STATEMENT
    EXECUTE FUNCTION auth.cleanup_old_sessions();

CREATE TRIGGER trigger_enforce_max_sessions
    AFTER INSERT ON auth.agent_sessions
    FOR EACH ROW
    EXECUTE FUNCTION auth.enforce_session_limit();

CREATE TRIGGER refresh_active_sessions_on_session_change
    AFTER INSERT OR UPDATE OR DELETE ON auth.agent_sessions
    FOR EACH STATEMENT
    EXECUTE FUNCTION auth.refresh_active_sessions_trigger();

CREATE TRIGGER refresh_active_sessions_on_role_change
    AFTER INSERT OR UPDATE OR DELETE ON auth.agent_sync_group_roles
    FOR EACH STATEMENT
    EXECUTE FUNCTION auth.refresh_active_sessions_trigger();

-- Audit Trail Triggers
CREATE TRIGGER update_agent_profile_timestamps
    BEFORE UPDATE ON auth.agent_profiles
    FOR EACH ROW
    EXECUTE FUNCTION auth.update_audit_columns();

CREATE TRIGGER update_agent_auth_providers_updated_at
    BEFORE UPDATE ON auth.agent_auth_providers
    FOR EACH ROW
    EXECUTE FUNCTION auth.update_audit_columns();

CREATE TRIGGER update_agent_sessions_updated_at
    BEFORE UPDATE ON auth.agent_sessions
    FOR EACH ROW
    EXECUTE FUNCTION auth.update_audit_columns();

CREATE TRIGGER update_sync_groups_updated_at
    BEFORE UPDATE ON auth.sync_groups
    FOR EACH ROW
    EXECUTE FUNCTION auth.update_audit_columns();

CREATE TRIGGER update_agent_sync_group_roles_updated_at
    BEFORE UPDATE ON auth.agent_sync_group_roles
    FOR EACH ROW
    EXECUTE FUNCTION auth.update_audit_columns();


-- =============================================================================
-- 10. PERMISSIONS
-- =============================================================================
-- Revoke All Permissions
REVOKE ALL ON ALL TABLES IN SCHEMA auth FROM PUBLIC, vircadia_agent_proxy;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA auth FROM PUBLIC, vircadia_agent_proxy;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA auth FROM PUBLIC, vircadia_agent_proxy;
REVOKE ALL ON ALL PROCEDURES IN SCHEMA auth FROM PUBLIC, vircadia_agent_proxy;
REVOKE ALL ON ALL ROUTINES IN SCHEMA auth FROM PUBLIC, vircadia_agent_proxy;

-- Grant Specific Permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON auth.agent_profiles TO vircadia_agent_proxy;
GRANT SELECT, INSERT, UPDATE, DELETE ON auth.agent_auth_providers TO vircadia_agent_proxy;

GRANT SELECT, INSERT, UPDATE, DELETE ON auth.sync_groups TO vircadia_agent_proxy;
GRANT SELECT, INSERT, UPDATE, DELETE ON auth.agent_sync_group_roles TO vircadia_agent_proxy;

GRANT SELECT, INSERT, UPDATE, DELETE ON auth.agent_sessions TO vircadia_agent_proxy;

GRANT SELECT ON auth.active_sync_group_sessions TO vircadia_agent_proxy;

GRANT EXECUTE ON FUNCTION auth.is_anon_agent() TO vircadia_agent_proxy;
GRANT EXECUTE ON FUNCTION auth.is_admin_agent() TO vircadia_agent_proxy;
GRANT EXECUTE ON FUNCTION auth.is_system_agent() TO vircadia_agent_proxy;
GRANT EXECUTE ON FUNCTION auth.is_proxy_agent() TO vircadia_agent_proxy;
GRANT EXECUTE ON FUNCTION auth.current_agent_id() TO vircadia_agent_proxy;
GRANT EXECUTE ON FUNCTION auth.get_system_agent_id() TO vircadia_agent_proxy;
GRANT EXECUTE ON FUNCTION auth.validate_session(UUID, TEXT) TO vircadia_agent_proxy;
GRANT EXECUTE ON FUNCTION auth.set_agent_context_from_session_id(UUID) TO vircadia_agent_proxy;


-- =============================================================================
-- 11. GLOBAL FUNCTION PERMISSIONS
-- =============================================================================

GRANT EXECUTE ON FUNCTION uuid_generate_v4() TO vircadia_agent_proxy;

-- =============================================================================
-- 12. INITIAL DATA
-- =============================================================================
-- System Agent Profile
INSERT INTO auth.agent_profiles 
    (general__agent_profile_id, profile__username, auth__email, auth__is_system) 
VALUES 
    (auth.get_system_agent_id(), 'admin', 'system@internal', true)
ON CONFLICT (general__agent_profile_id) DO NOTHING;

-- Default Sync Groups
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

-- Add system provider to auth_providers table if not exists
INSERT INTO auth.auth_providers (
    provider__name,
    provider__display_name,
    provider__enabled,
    provider__jwt_secret,
    provider__session_max_per_agent,
    provider__session_duration_jwt_string,
    provider__session_duration_ms,
    provider__session_max_age_ms,
    provider__session_inactive_expiry_ms
) VALUES (
    'system',
    'System Authentication',
    true,
    'CHANGE_ME!',
    100,
    '24h',
    86400000,
    86400000,
    3600000
) ON CONFLICT (provider__name) DO NOTHING;

-- Add anonymous provider to auth_providers table if not exists
INSERT INTO auth.auth_providers (
    provider__name,
    provider__display_name,
    provider__enabled,
    provider__jwt_secret,
    provider__session_max_per_agent,
    provider__session_duration_jwt_string,
    provider__session_duration_ms,
    provider__session_max_age_ms,
    provider__session_inactive_expiry_ms
) VALUES (
    'anon',
    'Anonymous Authentication',
    true,
    'CHANGE_ME!',
    1,
    '24h',
    86400000,
    86400000,
    3600000
) ON CONFLICT (provider__name) DO NOTHING;