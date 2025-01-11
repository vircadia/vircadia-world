-- Create test tables with the same structure but different names
CREATE TABLE test_permissions (LIKE permissions INCLUDING ALL);
CREATE TABLE test_performance (LIKE performance INCLUDING ALL);
CREATE TABLE test_entity_scripts (LIKE entity_scripts INCLUDING ALL);
CREATE TABLE test_entities (LIKE entities INCLUDING ALL);
CREATE TABLE test_entities_metadata (LIKE entities_metadata INCLUDING ALL);
CREATE TABLE test_entity_actions (LIKE entity_actions INCLUDING ALL);

-- Agent-related test tables
CREATE TABLE test_agent_profiles (LIKE agent_profiles INCLUDING ALL);
CREATE TABLE test_agent_roles (LIKE agent_roles INCLUDING ALL);
CREATE TABLE test_roles (LIKE roles INCLUDING ALL);

-- Copy indexes (with adjusted names)
CREATE UNIQUE INDEX test_unique_seed_order_idx ON test_entities(general__load_priority) 
    WHERE general__load_priority IS NOT NULL;

CREATE INDEX test_idx_entities_permissions__roles__view 
    ON test_entities USING GIN (permissions__roles__view);
CREATE INDEX test_idx_entities_permissions__roles__full 
    ON test_entities USING GIN (permissions__roles__full);
CREATE INDEX test_idx_entities_created_at ON test_entities(general__created_at);
CREATE INDEX test_idx_entities_updated_at ON test_entities(general__updated_at);
CREATE INDEX test_idx_entities_semantic_version ON test_entities(general__semantic_version);
CREATE INDEX test_idx_entities_scripts_ids ON test_entities USING GIN (scripts__ids);

-- Metadata indexes
CREATE INDEX test_idx_entities_general__name_entity 
    ON test_entities_metadata(general__name, general__entity_id);

-- Action indexes
CREATE INDEX test_idx_entity_actions_status 
    ON test_entity_actions(general__action_status);
CREATE INDEX test_idx_entity_actions_claimed_by 
    ON test_entity_actions(general__claimed_by);
CREATE INDEX test_idx_entity_actions_heartbeat 
    ON test_entity_actions(general__last_heartbeat) 
    WHERE general__action_status = 'IN_PROGRESS';

-- Agent-related indexes
CREATE INDEX test_idx_agent_roles_is_active ON test_agent_roles(auth__is_active);
CREATE INDEX test_idx_agent_roles_auth__role_name ON test_agent_roles(auth__role_name);
CREATE INDEX test_idx_agent_roles_auth__agent_id ON test_agent_roles(auth__agent_id);
CREATE INDEX test_idx_agent_profiles_email ON test_agent_profiles(auth__email);

-- Enable RLS on test tables
ALTER TABLE test_entity_scripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_entities_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_entity_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_agent_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_agent_roles ENABLE ROW LEVEL SECURITY;

-- Create test-specific functions for notifications
CREATE OR REPLACE FUNCTION notify_test_entity_changes() RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify(
        'test_entity_changes',
        json_build_object(
            'type', 'entity',
            'operation', TG_OP,
            'entity_id', CASE WHEN TG_OP = 'DELETE' THEN OLD.general__uuid ELSE NEW.general__uuid END,
            'sync_group', CASE WHEN TG_OP = 'DELETE' THEN OLD.performance__sync_group ELSE NEW.performance__sync_group END,
            'timestamp', CURRENT_TIMESTAMP
        )::text
    );
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for test notifications
CREATE TRIGGER test_entity_changes_notify
    AFTER INSERT OR UPDATE OR DELETE ON test_entities
    FOR EACH ROW
    EXECUTE FUNCTION notify_test_entity_changes();

-- Copy policies with adjusted names and tables
CREATE POLICY "test_entities_view_policy" ON test_entities FOR SELECT
    USING (
        is_admin_agent()
        OR general__created_by = auth_uid()
        OR EXISTS (
            SELECT 1 
            FROM test_agent_roles ar
            WHERE ar.auth__agent_id = auth_uid()
            AND ar.auth__is_active = true
            AND (
                ar.auth__role_name = ANY(test_entities.permissions__roles__view)
                OR ar.auth__role_name = ANY(test_entities.permissions__roles__full)
            )
        )
    );
