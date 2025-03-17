-- ============================================================================
-- 1. SCHEMA CREATION AND INITIAL PERMISSIONS
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS entity;

REVOKE ALL ON SCHEMA entity FROM vircadia_agent_proxy;
GRANT USAGE ON SCHEMA entity TO vircadia_agent_proxy;


-- ============================================================================
-- 2. CORE ENTITY ENUMS
-- ============================================================================
CREATE TYPE entity.script_status_enum AS ENUM ('ACTIVE', 'AWAITING_SCRIPTS', 'INACTIVE');
CREATE TYPE entity.script_compilation_status_enum AS ENUM ('PENDING', 'COMPILING', 'COMPILED', 'FAILED');


-- ============================================================================
-- 3. BASE TEMPLATES
-- ============================================================================
-- Audit Template Table
CREATE TABLE entity._template (
    general__created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    general__created_by UUID DEFAULT auth.current_agent_id(),
    general__updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    general__updated_by UUID DEFAULT auth.current_agent_id()
);


-- ============================================================================
-- 4. CORE TABLES
-- ============================================================================

-- 4.1 ENTITY SCRIPTS TABLE
-- ============================================================================
CREATE TABLE entity.entity_scripts (
    general__script_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    general__script_name TEXT NOT NULL DEFAULT 'UNNAMED',
    group__sync TEXT NOT NULL REFERENCES auth.sync_groups(general__sync_group) DEFAULT 'public.NORMAL',
    
    -- Source fields
    source__repo__entry_path TEXT,
    source__repo__url TEXT,
    
    -- Node platform
    compiled__node__script TEXT,
    compiled__node__script_sha256 TEXT,
    compiled__node__status entity.script_compilation_status_enum NOT NULL DEFAULT 'PENDING',
    compiled__node__updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    
    -- Bun platform
    compiled__bun__script TEXT,
    compiled__bun__script_sha256 TEXT,
    compiled__bun__status entity.script_compilation_status_enum NOT NULL DEFAULT 'PENDING',
    compiled__bun__updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    
    -- Browser platform
    compiled__browser__script TEXT,
    compiled__browser__script_sha256 TEXT,
    compiled__browser__status entity.script_compilation_status_enum NOT NULL DEFAULT 'PENDING',
    compiled__browser__updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_entity_scripts_sync_group FOREIGN KEY (group__sync) REFERENCES auth.sync_groups(general__sync_group)
) INHERITS (entity._template);

ALTER TABLE entity.entity_scripts ENABLE ROW LEVEL SECURITY;


-- 4.2 ENTITY ASSETS TABLE
-- ============================================================================
CREATE TABLE entity.entity_assets (
    general__asset_name TEXT PRIMARY KEY,
    group__sync TEXT NOT NULL REFERENCES auth.sync_groups(general__sync_group) DEFAULT 'public.NORMAL',
    
    asset__data BYTEA,  -- Store asset binaries (GLBs, textures, etc.)
    meta__data JSONB DEFAULT '{}'::jsonb,
    
    CONSTRAINT fk_entity_assets_sync_group FOREIGN KEY (group__sync) REFERENCES auth.sync_groups(general__sync_group)
) INHERITS (entity._template);

ALTER TABLE entity.entity_assets ENABLE ROW LEVEL SECURITY;


-- 4.3 ENTITIES TABLE
-- ============================================================================
CREATE TABLE entity.entities (
    general__entity_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    general__entity_name TEXT NOT NULL,
    general__semantic_version TEXT NOT NULL DEFAULT '1.0.0',
    general__initialized_at TIMESTAMPTZ DEFAULT NULL,
    general__initialized_by UUID DEFAULT NULL,
    meta__data JSONB DEFAULT '{}'::jsonb,
    script__ids UUID[] DEFAULT '{}',
    script__statuses entity.script_status_enum DEFAULT 'ACTIVE'::entity.script_status_enum NOT NULL,
    asset__names TEXT[] DEFAULT '{}',
    validation__log JSONB DEFAULT '[]'::jsonb,
    group__sync TEXT NOT NULL REFERENCES auth.sync_groups(general__sync_group) DEFAULT 'public.NORMAL',
    group__load_priority INTEGER,

    CONSTRAINT fk_entities_sync_group FOREIGN KEY (group__sync) REFERENCES auth.sync_groups(general__sync_group)
) INHERITS (entity._template);

CREATE UNIQUE INDEX unique_seed_order_idx ON entity.entities(group__load_priority) WHERE group__load_priority IS NOT NULL;
CREATE INDEX idx_entities_created_at ON entity.entities(general__created_at);
CREATE INDEX idx_entities_updated_at ON entity.entities(general__updated_at);
CREATE INDEX idx_entities_semantic_version ON entity.entities(general__semantic_version);
CREATE INDEX idx_entities_scripts_ids ON entity.entities USING GIN (script__ids);
CREATE INDEX idx_entities_assets_ids ON entity.entities USING GIN (asset__names);
CREATE INDEX idx_entities_validation_log ON entity.entities USING GIN (validation__log);

ALTER TABLE entity.entities ENABLE ROW LEVEL SECURITY;


-- ============================================================================
-- 5. FUNCTIONS
-- ============================================================================

-- 5.1 CORE UTILITY FUNCTIONS
-- ============================================================================

-- Audit Column Update Function
CREATE OR REPLACE FUNCTION entity.update_audit_columns()
RETURNS TRIGGER AS $$
BEGIN
    NEW.general__updated_at = CURRENT_TIMESTAMP;
    NEW.general__updated_by = auth.current_agent_id();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- 5.2 ENTITY SCRIPT FUNCTIONS
-- ============================================================================

CREATE OR REPLACE FUNCTION entity.cleanup_stalled_compilations()
RETURNS trigger AS $$
DECLARE
    timeout_ms INTEGER;
BEGIN
    SELECT entity_config__script_compilation_timeout_ms
    INTO timeout_ms
    FROM config.entity_config;

    -- Check if this compilation has stalled
    IF NEW.compiled__node__status = 'COMPILING' 
       AND NEW.compiled__node__updated_at < (NOW() - (timeout_ms || ' milliseconds')::interval) THEN
        NEW.compiled__node__status := 'FAILED';
        NEW.compiled__bun__status := 'FAILED';
        NEW.compiled__browser__status := 'FAILED';
        NEW.compiled__node__updated_at := NULL;
        NEW.compiled__bun__updated_at := NULL;
        NEW.compiled__browser__updated_at := NULL;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- 5.3 ENTITY FUNCTIONS
-- ============================================================================

-- Function to validate the validation log format
CREATE OR REPLACE FUNCTION entity.validate_validation_log() RETURNS TRIGGER AS $$
BEGIN
    IF NOT jsonb_typeof(NEW.validation__log) = 'array' THEN
        RAISE EXCEPTION 'validation__log must be a JSONB array';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(NEW.validation__log) AS entry
        WHERE NOT (
            (entry->>'timestamp') IS NOT NULL 
            AND (entry->>'timestamp')::timestamptz IS NOT NULL
            AND (entry->>'agent_id') IS NOT NULL 
            AND (entry->>'agent_id')::uuid IS NOT NULL
            AND (entry->>'entity_script_id') IS NOT NULL 
            AND (entry->>'entity_script_id')::uuid IS NOT NULL
            AND (entry->>'query') IS NOT NULL 
            AND jsonb_typeof(entry->>'query') = 'string'
            AND (SELECT count(*) FROM jsonb_object_keys(entry)) = 4
        )
    ) THEN
        RAISE EXCEPTION 'Invalid validation log entry format. Required format: {"timestamp": "<timestamptz>", "agent_id": "<uuid>", "entity_script_id": "<uuid>", "query": "<string>"}';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to update entity status based on script references
CREATE OR REPLACE FUNCTION entity.update_entity_status_based_on_scripts()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.script__ids IS NULL OR NEW.script__ids = '{}' THEN
        NEW.script__statuses = 'ACTIVE'::entity.script_status_enum;
    ELSE
        IF EXISTS (
            SELECT 1 
            FROM entity.entity_scripts es
            WHERE es.general__script_id = ANY(NEW.script__ids)
              AND (
                  es.compiled__node__status = 'PENDING' OR
                  es.compiled__bun__status = 'PENDING' OR
                  es.compiled__browser__status = 'PENDING'
              )
        ) THEN
            NEW.script__statuses = 'AWAITING_SCRIPTS'::entity.script_status_enum;
        ELSE
            NEW.script__statuses = 'ACTIVE'::entity.script_status_enum;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to propagate script status changes to entities
CREATE OR REPLACE FUNCTION entity.propagate_script_changes_to_entities()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND (
        OLD.compiled__node__status != NEW.compiled__node__status OR
        OLD.compiled__bun__status != NEW.compiled__bun__status OR
        OLD.compiled__browser__status != NEW.compiled__browser__status
    ) THEN
        UPDATE entity.entities
        SET general__updated_at = general__updated_at
        WHERE NEW.general__script_id = ANY(script__ids);
        UPDATE entity.entities
        SET script__ids = script__ids
        WHERE NEW.general__script_id = ANY(script__ids);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to validate entity metadata structure
CREATE OR REPLACE FUNCTION entity.validate_entity_metadata()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.meta__data IS NULL OR NEW.meta__data = '{}'::jsonb THEN
        RETURN NEW;
    END IF;

    IF jsonb_typeof(NEW.meta__data) != 'object' THEN
        RAISE EXCEPTION 'meta__data must be a JSONB object';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM jsonb_each(NEW.meta__data) AS entry
        WHERE jsonb_typeof(entry.value) != 'object'
    ) THEN
        RAISE EXCEPTION 'All values in meta__data must be objects';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to remove deleted script references from entities
CREATE OR REPLACE FUNCTION entity.remove_deleted_script_references()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE entity.entities
    SET script__ids = array_remove(script__ids, OLD.general__script_id)
    WHERE OLD.general__script_id = ANY(script__ids);
    
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Function to remove deleted asset references from entities
CREATE OR REPLACE FUNCTION entity.remove_deleted_asset_references()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE entity.entities
    SET asset__names = array_remove(asset__names, OLD.general__asset_name)
    WHERE OLD.general__asset_name = ANY(asset__names);
    
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- 6. TRIGGERS
-- ============================================================================

-- 6.1 ENTITY SCRIPT TRIGGERS
-- ============================================================================

-- Update audit columns trigger for entity_scripts
CREATE TRIGGER update_audit_columns
    BEFORE UPDATE ON entity.entity_scripts
    FOR EACH ROW
    EXECUTE FUNCTION entity.update_audit_columns();

-- Trigger to cleanup stalled compilations
CREATE TRIGGER cleanup_stalled_compilations_trigger
    BEFORE UPDATE OF compiled__node__status, compiled__node__updated_at ON entity.entity_scripts
    FOR EACH ROW
    EXECUTE FUNCTION entity.cleanup_stalled_compilations();


-- 6.2 ENTITY ASSET TRIGGERS
-- ============================================================================

-- Update audit columns trigger for entity_assets
CREATE TRIGGER update_audit_columns
    BEFORE UPDATE ON entity.entity_assets
    FOR EACH ROW
    EXECUTE FUNCTION entity.update_audit_columns();


-- 6.3 ENTITY TRIGGERS
-- ============================================================================

-- Trigger for enforcing validation log format
CREATE TRIGGER enforce_validation_log_format
    BEFORE UPDATE OF validation__log ON entity.entities
    FOR EACH ROW
    EXECUTE FUNCTION entity.validate_validation_log();

-- Trigger to propagate script changes to entities
CREATE TRIGGER propagate_script_changes_to_entities
    AFTER UPDATE ON entity.entity_scripts
    FOR EACH ROW
    EXECUTE FUNCTION entity.propagate_script_changes_to_entities();

-- Trigger for updating entity status based on script references
CREATE TRIGGER update_entity_status_based_on_scripts
    BEFORE INSERT OR UPDATE OF script__ids ON entity.entities
    FOR EACH ROW
    EXECUTE FUNCTION entity.update_entity_status_based_on_scripts();

-- Trigger for updating audit columns
CREATE TRIGGER update_audit_columns
    BEFORE UPDATE ON entity.entities
    FOR EACH ROW
    EXECUTE FUNCTION entity.update_audit_columns();

-- Trigger for enforcing entity metadata structure
CREATE TRIGGER enforce_script_metadata_structure
    BEFORE INSERT OR UPDATE OF meta__data ON entity.entities
    FOR EACH ROW
    EXECUTE FUNCTION entity.validate_entity_metadata();

-- Trigger to remove deleted script references from entities
CREATE TRIGGER remove_deleted_script_references
    BEFORE DELETE ON entity.entity_scripts
    FOR EACH ROW
    EXECUTE FUNCTION entity.remove_deleted_script_references();

-- Trigger to remove deleted asset references from entities
CREATE TRIGGER remove_deleted_asset_references
    BEFORE DELETE ON entity.entity_assets
    FOR EACH ROW
    EXECUTE FUNCTION entity.remove_deleted_asset_references();


-- ============================================================================
-- 7. POLICIES AND PERMISSIONS
-- ============================================================================

-- 7.1 INITIAL REVOCATIONS
-- ============================================================================
-- Revoke all permissions from PUBLIC and vircadia_agent_proxy (to start with a clean slate)
REVOKE ALL ON ALL TABLES IN SCHEMA entity FROM PUBLIC, vircadia_agent_proxy;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA entity FROM PUBLIC, vircadia_agent_proxy;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA entity FROM PUBLIC, vircadia_agent_proxy;
REVOKE ALL ON ALL PROCEDURES IN SCHEMA entity FROM PUBLIC, vircadia_agent_proxy;
REVOKE ALL ON ALL ROUTINES IN SCHEMA entity FROM PUBLIC, vircadia_agent_proxy;


-- 7.2 ENTITY SCRIPT POLICIES
-- ============================================================================
-- Grant table permissions to vircadia_agent_proxy
GRANT SELECT, INSERT, UPDATE, DELETE ON entity.entity_scripts TO vircadia_agent_proxy;

-- Grant execute permissions for the cleanup function to vircadia_agent_proxy
GRANT EXECUTE ON FUNCTION entity.cleanup_stalled_compilations() TO vircadia_agent_proxy;

-- Policy to explicitly allow the proxy agent to view entity scripts
CREATE POLICY "All can view entity scripts" ON entity.entity_scripts
    FOR SELECT
    TO PUBLIC
    USING (true);

-- Policy to explicitly allow the proxy agent to insert entity scripts
CREATE POLICY "Only admins can insert entity scripts" ON entity.entity_scripts
    FOR INSERT
    TO PUBLIC
    WITH CHECK (
        auth.is_admin_agent()
        OR auth.is_system_agent()
    );

-- Policy to explicitly allow the proxy agent to update entity scripts
CREATE POLICY "Only admins can update entity scripts" ON entity.entity_scripts
    FOR UPDATE
    TO PUBLIC
    USING (
        auth.is_admin_agent()
        OR auth.is_system_agent()
    );

-- Policy to explicitly allow the proxy agent to delete entity scripts
CREATE POLICY "Only admins can delete entity scripts" ON entity.entity_scripts
    FOR DELETE
    TO PUBLIC
    USING (
        auth.is_admin_agent()
        OR auth.is_system_agent()
    );


-- 7.3 ENTITY ASSET POLICIES
-- ============================================================================
-- Grant table permissions to vircadia_agent_proxy for entity_assets
GRANT SELECT, INSERT, UPDATE, DELETE ON entity.entity_assets TO vircadia_agent_proxy;

-- Policy: allow insert only if the agent is a member of the asset's sync group with insert permission
CREATE POLICY "Group can insert entity assets" ON entity.entity_assets
    FOR INSERT
    TO PUBLIC
    WITH CHECK (
        auth.is_admin_agent()
        OR auth.is_system_agent()
        OR EXISTS (
            SELECT 1
            FROM auth.agent_sync_group_roles AS ar
            WHERE ar.auth__agent_id = auth.current_agent_id()
              AND ar.group__sync = entity.entity_assets.group__sync
              AND ar.permissions__can_insert = true
        )
    );

-- Policy: allow view only if the agent is a member of the asset's sync group with view permission
CREATE POLICY "Group can view entity assets" ON entity.entity_assets
    FOR SELECT
    TO PUBLIC
    USING (
        auth.is_admin_agent()
        OR auth.is_system_agent()
        OR EXISTS (
            SELECT 1
            FROM auth.agent_sync_group_roles AS ar
            WHERE ar.auth__agent_id = auth.current_agent_id()
              AND ar.group__sync = entity.entity_assets.group__sync
              AND ar.permissions__can_read = true
        )
    );

-- Policy: allow update only if the agent is a member of the asset's sync group with update permission
CREATE POLICY "Group can update entity assets" ON entity.entity_assets
    FOR UPDATE
    TO PUBLIC
    USING (
        auth.is_admin_agent()
        OR auth.is_system_agent()
        OR EXISTS (
            SELECT 1
            FROM auth.agent_sync_group_roles AS ar
            WHERE ar.auth__agent_id = auth.current_agent_id()
              AND ar.group__sync = entity.entity_assets.group__sync
              AND ar.permissions__can_update = true
        )
    );

-- Policy: allow delete only if the agent is a member of the asset's sync group with delete permission
CREATE POLICY "Group can delete entity assets" ON entity.entity_assets
    FOR DELETE
    TO PUBLIC
    USING (
        auth.is_admin_agent()
        OR auth.is_system_agent()
        OR EXISTS (
            SELECT 1
            FROM auth.agent_sync_group_roles AS ar
            WHERE ar.auth__agent_id = auth.current_agent_id()
              AND ar.group__sync = entity.entity_assets.group__sync
              AND ar.permissions__can_delete = true
        )
    );


-- 7.4 ENTITY POLICIES
-- ============================================================================
-- Grant table permissions to vircadia_agent_proxy for entities
GRANT SELECT, INSERT, UPDATE, DELETE ON entity.entities TO vircadia_agent_proxy;

CREATE POLICY "entities_read_policy" ON entity.entities
    FOR SELECT
    TO PUBLIC
    USING (
        auth.is_admin_agent()
        OR auth.is_system_agent()
        OR EXISTS (
            SELECT 1 
            FROM auth.active_sync_group_sessions sess 
            WHERE sess.auth__agent_id = auth.current_agent_id()
              AND sess.group__sync = entity.entities.group__sync
              AND sess.permissions__can_read = true
        )
    );

CREATE POLICY "entities_update_policy" ON entity.entities
    FOR UPDATE
    TO PUBLIC
    USING (
        auth.is_admin_agent()
        OR auth.is_system_agent()
        OR EXISTS (
            SELECT 1 
            FROM auth.active_sync_group_sessions sess 
            WHERE sess.auth__agent_id = auth.current_agent_id()
              AND sess.group__sync = entity.entities.group__sync
              AND sess.permissions__can_update = true
        )
    );

CREATE POLICY "entities_insert_policy" ON entity.entities
    FOR INSERT
    TO PUBLIC
    WITH CHECK (
        auth.is_admin_agent()
        OR auth.is_system_agent()
        OR EXISTS (
            SELECT 1 
            FROM auth.active_sync_group_sessions sess 
            WHERE sess.auth__agent_id = auth.current_agent_id()
              AND sess.group__sync = entity.entities.group__sync
              AND sess.permissions__can_insert = true
        )
    );

CREATE POLICY "entities_delete_policy" ON entity.entities
    FOR DELETE
    TO PUBLIC
    USING (
        auth.is_admin_agent()
        OR auth.is_system_agent()
        OR EXISTS (
            SELECT 1 
            FROM auth.active_sync_group_sessions sess 
            WHERE sess.auth__agent_id = auth.current_agent_id()
              AND sess.group__sync = entity.entities.group__sync
              AND sess.permissions__can_delete = true
        )
    );