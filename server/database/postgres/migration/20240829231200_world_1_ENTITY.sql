-- ============================================================================
-- 1. ENTITIES TABLE & INDEXES
-- ============================================================================

CREATE TABLE entity.entities (
    general__entity_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    general__entity_name TEXT NOT NULL,
    general__semantic_version TEXT NOT NULL DEFAULT '1.0.0',
    general__load_priority INTEGER,
    general__initialized_at TIMESTAMPTZ DEFAULT NULL,
    general__initialized_by UUID DEFAULT NULL,
    meta__data JSONB DEFAULT '{}'::jsonb,
    scripts__ids UUID[] DEFAULT '{}',
    scripts__status entity.script_status_enum DEFAULT 'ACTIVE'::entity.script_status_enum NOT NULL,
    assets__ids UUID[] DEFAULT '{}',
    validation__log JSONB DEFAULT '[]'::jsonb,
    group__sync TEXT NOT NULL REFERENCES auth.sync_groups(general__sync_group) DEFAULT 'public.NORMAL',

    CONSTRAINT fk_entities_sync_group FOREIGN KEY (group__sync) REFERENCES auth.sync_groups(general__sync_group)
) INHERITS (entity._template);

CREATE UNIQUE INDEX unique_seed_order_idx ON entity.entities(general__load_priority) WHERE general__load_priority IS NOT NULL;
CREATE INDEX idx_entities_created_at ON entity.entities(general__created_at);
CREATE INDEX idx_entities_updated_at ON entity.entities(general__updated_at);
CREATE INDEX idx_entities_semantic_version ON entity.entities(general__semantic_version);
CREATE INDEX idx_entities_scripts_ids ON entity.entities USING GIN (scripts__ids);
CREATE INDEX idx_entities_assets_ids ON entity.entities USING GIN (assets__ids);
CREATE INDEX idx_entities_validation_log ON entity.entities USING GIN (validation__log);

ALTER TABLE entity.entities ENABLE ROW LEVEL SECURITY;


-- ============================================================================
-- 2. ENTITIES POLICIES
-- ============================================================================

CREATE POLICY "entities_view_policy" ON entity.entities
    FOR SELECT
    USING (
        auth.is_admin_agent()
        OR auth.is_system_agent()
        OR EXISTS (
            SELECT 1 
            FROM auth.active_sync_group_sessions sess 
            WHERE sess.auth__agent_id = auth.current_agent_id()
              AND sess.group__sync = entity.entities.group__sync
        )
    );

CREATE POLICY "entities_update_policy" ON entity.entities
    FOR UPDATE
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


-- ============================================================================
-- 3. ENTITIES FUNCTIONS
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
    IF NEW.scripts__ids IS NULL OR NEW.scripts__ids = '{}' THEN
        NEW.scripts__status = 'ACTIVE'::entity.script_status_enum;
    ELSE
        IF EXISTS (
            SELECT 1 
            FROM entity.entity_scripts es
            WHERE es.general__script_id = ANY(NEW.scripts__ids)
              AND (
                  es.compiled__node__status = 'PENDING' OR
                  es.compiled__bun__status = 'PENDING' OR
                  es.compiled__browser__status = 'PENDING'
              )
        ) THEN
            NEW.scripts__status = 'AWAITING_SCRIPTS'::entity.script_status_enum;
        ELSE
            NEW.scripts__status = 'ACTIVE'::entity.script_status_enum;
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
        WHERE NEW.general__script_id = ANY(scripts__ids);
        UPDATE entity.entities
        SET scripts__ids = scripts__ids
        WHERE NEW.general__script_id = ANY(scripts__ids);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to update audit columns
CREATE OR REPLACE FUNCTION entity.update_audit_columns()
RETURNS TRIGGER AS $$
BEGIN
    NEW.general__updated_at = CURRENT_TIMESTAMP;
    NEW.general__updated_by = auth.current_agent_id();
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
    SET scripts__ids = array_remove(scripts__ids, OLD.general__script_id)
    WHERE OLD.general__script_id = ANY(scripts__ids);
    
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Function to remove deleted asset references from entities
CREATE OR REPLACE FUNCTION entity.remove_deleted_asset_references()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE entity.entities
    SET assets__ids = array_remove(assets__ids, OLD.general__asset_id)
    WHERE OLD.general__asset_id = ANY(assets__ids);
    
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- 4. ENTITIES TRIGGERS
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
    BEFORE INSERT OR UPDATE OF scripts__ids ON entity.entities
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
