-- Indexes for Agent-related tables
CREATE INDEX idx_agent_sessions_auth__agent_id ON auth.agent_sessions(auth__agent_id);
CREATE INDEX idx_agent_sessions_auth__provider_name ON auth.agent_sessions(auth__provider_name);
CREATE INDEX idx_agent_profiles_email ON auth.agent_profiles(auth__email);

-- Add optimized indexes for session-based entity change distribution
CREATE INDEX idx_agent_sessions_active_lookup ON auth.agent_sessions 
    (session__is_active, session__expires_at) 
    WHERE session__is_active = true;
-- Add composite index for session validation
CREATE INDEX idx_agent_sessions_validation ON auth.agent_sessions 
    (general__session_id, session__is_active, session__expires_at) 
    WHERE session__is_active = true;
-- Add index for session cleanup
CREATE INDEX idx_agent_sessions_last_seen ON auth.agent_sessions(session__last_seen_at) 
WHERE session__is_active = true;
CREATE UNIQUE INDEX idx_active_sync_group_sessions_lookup 
ON auth.active_sync_group_sessions (group__sync);

-- Create triggers for updating timestamps
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