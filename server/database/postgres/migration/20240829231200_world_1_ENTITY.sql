-- Create entity schema
CREATE SCHEMA IF NOT EXISTS entity;

-- 
-- PERMISSIONS
--

CREATE TABLE entity.permissions (
    permissions__roles__view TEXT[],
    permissions__roles__full TEXT[]
);

CREATE TABLE entity.performance (
    performance__sync_group TEXT DEFAULT 'NORMAL' NOT NULL
);

--
-- ENTITY SCRIPTS
--

-- Create enum for script compilation status
CREATE TYPE script_compilation_status AS ENUM ('PENDING', 'COMPILED', 'FAILED');

CREATE TABLE entity.entity_scripts (
    general__script_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    general__created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    general__created_by UUID DEFAULT current_agent_id(),
    general__updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    general__updated_by UUID DEFAULT current_agent_id(),

    compiled__web__node__script TEXT,
    compiled__web__node__script_sha256 TEXT,
    compiled__web__node__script_status script_compilation_status,
    compiled__web__bun__script TEXT,
    compiled__web__bun__script_sha256 TEXT,
    compiled__web__bun__script_status script_compilation_status,
    compiled__web__browser__script TEXT,
    compiled__web__browser__script_sha256 TEXT,
    compiled__web__browser__script_status script_compilation_status,

    source__git__repo_entry_path TEXT,
    source__git__repo_url TEXT
) INHERITS (entity.performance);

-- Enable RLS
ALTER TABLE entity.entity_scripts ENABLE ROW LEVEL SECURITY;

-- Allow all users to view scripts
CREATE POLICY "Allow viewing scripts" ON entity.entity_scripts
    FOR SELECT
    USING (true);

-- Create policy for inserting scripts
CREATE POLICY "Allow inserting scripts with proper role" ON entity.entity_scripts
    FOR INSERT
    WITH CHECK (
        is_admin_agent()
        OR EXISTS (
            SELECT 1 FROM auth.agent_roles ar
            JOIN auth.roles r ON ar.auth__role_name = r.auth__role_name
            WHERE ar.auth__agent_id = current_agent_id()
            AND ar.auth__is_active = true
        )
    );

-- Create policy for updating scripts
CREATE POLICY "Allow updating scripts with proper role" ON entity.entity_scripts
    FOR UPDATE
    USING (
        is_admin_agent()
        OR EXISTS (
            SELECT 1 FROM auth.agent_roles ar
            JOIN auth.roles r ON ar.auth__role_name = r.auth__role_name
            WHERE ar.auth__agent_id = current_agent_id()
            AND ar.auth__is_active = true
        )
    );

-- Create policy for deleting scripts
CREATE POLICY "Allow deleting scripts with proper role" ON entity.entity_scripts
    FOR DELETE
    USING (
        is_admin_agent()
        OR EXISTS (
            SELECT 1 FROM auth.agent_roles ar
            JOIN auth.roles r ON ar.auth__role_name = r.auth__role_name
            WHERE ar.auth__agent_id = current_agent_id()
            AND ar.auth__is_active = true
        )
    );

--
-- ENTITIES
--

CREATE TABLE entity.entities (
    general__uuid UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    general__name VARCHAR(255) NOT NULL,
    general__semantic_version TEXT NOT NULL DEFAULT '1.0.0',
    general__created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    general__created_by UUID DEFAULT current_agent_id(),
    general__updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    general__updated_by UUID DEFAULT current_agent_id(),
    general__load_priority INTEGER,
    general__initialized_at TIMESTAMPTZ DEFAULT NULL,
    general__initialized_by UUID DEFAULT NULL,
    meta__data HSTORE DEFAULT ''::hstore,
    scripts__ids UUID[] DEFAULT '{}',
    validation__log JSONB DEFAULT '[]'::jsonb
) INHERITS (entity.performance, entity.permissions);

CREATE UNIQUE INDEX unique_seed_order_idx ON entity.entities(general__load_priority) WHERE general__load_priority IS NOT NULL;

-- Entities indexes
CREATE INDEX idx_entities_permissions__roles__view ON entity.entities USING GIN (permissions__roles__view);
CREATE INDEX idx_entities_permissions__roles__full ON entity.entities USING GIN (permissions__roles__full);
CREATE INDEX idx_entities_created_at ON entity.entities(general__created_at);
CREATE INDEX idx_entities_updated_at ON entity.entities(general__updated_at);
CREATE INDEX idx_entities_semantic_version ON entity.entities(general__semantic_version);
CREATE INDEX idx_entities_scripts_ids ON entity.entities USING GIN (scripts__ids);
CREATE INDEX idx_entities_validation_log ON entity.entities USING GIN (validation__log);

-- Enable RLS on entities table
ALTER TABLE entity.entities ENABLE ROW LEVEL SECURITY;

-- Entities policies
CREATE POLICY "entities_view_policy" ON entity.entities
    FOR SELECT
    USING (
        is_admin_agent()
        OR general__created_by = current_agent_id()
        OR EXISTS (
            SELECT 1 
            FROM auth.agent_roles ar
            WHERE ar.auth__agent_id = current_agent_id()
            AND ar.auth__is_active = true
            AND (
                ar.auth__role_name = ANY(entity.entities.permissions__roles__view)
                OR ar.auth__role_name = ANY(entity.entities.permissions__roles__full)
            )
        )
    );

CREATE POLICY "entities_update_policy" ON entity.entities
    FOR UPDATE
    USING (
        is_admin_agent()
        OR general__created_by = current_agent_id()
        OR EXISTS (
            SELECT 1 
            FROM auth.agent_roles ar
            WHERE ar.auth__agent_id = current_agent_id()
            AND ar.auth__is_active = true
            AND ar.auth__role_name = ANY(entity.entities.permissions__roles__full)
        )
    );

CREATE POLICY "entities_insert_policy" ON entity.entities
    FOR INSERT
    WITH CHECK (
        is_admin_agent()
        OR EXISTS (
            SELECT 1 
            FROM auth.agent_roles ar
            JOIN auth.roles r ON r.auth__role_name = ar.auth__role_name
            WHERE ar.auth__agent_id = current_agent_id()
            AND ar.auth__is_active = true
            AND r.auth__entity__insert = true
        )
    );

CREATE POLICY "entities_delete_policy" ON entity.entities
    FOR DELETE
    USING (
        is_admin_agent()
        OR general__created_by = current_agent_id()
        OR EXISTS (
            SELECT 1 
            FROM auth.agent_roles ar
            WHERE ar.auth__agent_id = current_agent_id()
            AND ar.auth__is_active = true
            AND ar.auth__role_name = ANY(entity.entities.permissions__roles__full)
        )
    );

-- 
-- NOTIFICATION FUNCTIONS
--

-- Entity changes notification
CREATE OR REPLACE FUNCTION notify_entity_changes() RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify(
        'entity_changes',
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

-- Entity metadata changes notification
CREATE OR REPLACE FUNCTION notify_entity_metadata_changes() RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify(
        'entity_changes',
        json_build_object(
            'type', 'metadata',
            'operation', TG_OP,
            'entity_id', NEW.general__entity_id,
            'metadata_id', NEW.general__metadata_id,
            'timestamp', CURRENT_TIMESTAMP
        )::text
    );
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

-- Entity script changes notification
CREATE OR REPLACE FUNCTION notify_entity_script_changes() RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify(
        'entity_changes',
        json_build_object(
            'type', 'script',
            'operation', TG_OP,
            'script_id', NEW.general__script_id,
            'timestamp', CURRENT_TIMESTAMP
        )::text
    );
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for notifications
CREATE TRIGGER entity_changes_notify
    AFTER INSERT OR UPDATE OR DELETE ON entity.entities
    FOR EACH ROW
    EXECUTE FUNCTION notify_entity_changes();

CREATE TRIGGER entity_script_changes_notify
    AFTER INSERT OR UPDATE ON entity.entity_scripts
    FOR EACH ROW
    EXECUTE FUNCTION notify_entity_script_changes();

-- Function to validate the validation log format
CREATE OR REPLACE FUNCTION validate_validation_log() RETURNS TRIGGER AS $$
BEGIN
    -- Check if validation_log is an array
    IF NOT jsonb_typeof(NEW.validation__log) = 'array' THEN
        RAISE EXCEPTION 'validation__log must be a JSONB array';
    END IF;

    -- Validate each entry in the array
    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(NEW.validation__log) AS entry
        WHERE NOT (
            -- Check required fields exist and have correct types
            (entry->>'timestamp') IS NOT NULL 
            AND (entry->>'timestamp')::timestamptz IS NOT NULL
            AND (entry->>'agent_id') IS NOT NULL 
            AND (entry->>'agent_id')::uuid IS NOT NULL
            AND (entry->>'entity_script_id') IS NOT NULL 
            AND (entry->>'entity_script_id')::uuid IS NOT NULL
            AND (entry->>'query') IS NOT NULL 
            AND jsonb_typeof(entry->>'query') = 'string'
            -- Ensure no extra fields
            AND (
                SELECT count(*)
                FROM jsonb_object_keys(entry) AS k
            ) = 4
        )
    ) THEN
        RAISE EXCEPTION 'Invalid validation log entry format. Required format: {"timestamp": "<timestamptz>", "agent_id": "<uuid>", "entity_script_id": "<uuid>", "query": "<string>"}';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for validation log format enforcement
CREATE TRIGGER enforce_validation_log_format
    BEFORE UPDATE OF validation__log ON entity.entities
    FOR EACH ROW
    EXECUTE FUNCTION validate_validation_log();
