-- ============================================================================
-- 1. SCHEMA CREATION AND INITIAL PERMISSIONS
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS entity;

REVOKE ALL ON SCHEMA entity FROM vircadia_agent_proxy;
GRANT USAGE ON SCHEMA entity TO vircadia_agent_proxy;

-- ============================================================================
-- 3. BASE TEMPLATES
-- ============================================================================
-- Audit Template Table
CREATE TABLE entity._template (
    general__created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    general__created_by UUID NOT NULL DEFAULT auth.current_agent_id(),
    general__updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    general__updated_by UUID NOT NULL DEFAULT auth.current_agent_id()
);


-- ============================================================================
-- 4. CORE TABLES
-- ============================================================================

-- 4.1 ENTITY SCRIPTS TABLE
-- ============================================================================
CREATE TABLE entity.entity_scripts (
    general__script_file_name TEXT PRIMARY KEY,
    group__sync TEXT NOT NULL REFERENCES auth.sync_groups(general__sync_group) DEFAULT 'public.NORMAL',
    CONSTRAINT fk_entity_scripts_sync_group FOREIGN KEY (group__sync) REFERENCES auth.sync_groups(general__sync_group),

    script__platform TEXT NOT NULL DEFAULT 'BABYLON_BROWSER',
    CONSTRAINT chk_script_platform CHECK (script__platform IN ('BABYLON_NODE', 'BABYLON_BUN', 'BABYLON_BROWSER')),

    -- Source fields
    script__source__repo__entry_path TEXT NOT NULL DEFAULT '',
    script__source__repo__url TEXT NOT NULL DEFAULT '',
    script__source__data TEXT NOT NULL DEFAULT '',
    script__source__updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    script__compiled__data TEXT NOT NULL DEFAULT '',
    script__compiled__status TEXT NOT NULL DEFAULT 'PENDING',
    CONSTRAINT chk_script_compiled_status CHECK (script__compiled__status IN ('PENDING', 'COMPILING', 'COMPILED', 'FAILED')),
    script__compiled__updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    script__source__data_updated_at timestamptz NOT NULL DEFAULT now(),
    script__compiled__data_updated_at timestamptz NOT NULL DEFAULT now(),
    script__compiled__status_updated_at timestamptz NOT NULL DEFAULT now(),
    script__source__repo__url_updated_at timestamptz NOT NULL DEFAULT now(),
    script__source__repo__entry_path_updated_at timestamptz NOT NULL DEFAULT now()
) INHERITS (entity._template);

ALTER TABLE entity.entity_scripts ENABLE ROW LEVEL SECURITY;


-- 4.2 ENTITY ASSETS TABLE
-- ============================================================================
CREATE TABLE entity.entity_assets (
    general__asset_file_name TEXT PRIMARY KEY,
    group__sync TEXT NOT NULL REFERENCES auth.sync_groups(general__sync_group) DEFAULT 'public.NORMAL',
    CONSTRAINT fk_entity_assets_sync_group FOREIGN KEY (group__sync) REFERENCES auth.sync_groups(general__sync_group),
    
    asset__data__base64 TEXT,  -- Store asset binaries (GLBs, textures, etc.) as base64 encoded string
    asset__data__bytea BYTEA,  -- Store asset binaries (GLBs, textures, etc.) as bytea
    asset__type TEXT DEFAULT NULL,

    asset__data__base64_updated_at timestamptz DEFAULT now(),
    asset__data__bytea_updated_at timestamptz DEFAULT now()
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
    meta__data JSONB NOT NULL DEFAULT '{}'::jsonb,
    script__names TEXT[] NOT NULL DEFAULT '{}',
    asset__names TEXT[] NOT NULL DEFAULT '{}',
    group__sync TEXT NOT NULL REFERENCES auth.sync_groups(general__sync_group) DEFAULT 'public.NORMAL',
    group__load_priority INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT fk_entities_sync_group FOREIGN KEY (group__sync) REFERENCES auth.sync_groups(general__sync_group),

    meta_data_updated_at timestamptz NOT NULL DEFAULT now(),
    script_names_updated_at timestamptz NOT NULL DEFAULT now(),
    asset_names_updated_at timestamptz NOT NULL DEFAULT now(),
    position_updated_at timestamptz NOT NULL DEFAULT now()
) INHERITS (entity._template);

CREATE INDEX idx_entities_load_priority ON entity.entities(group__load_priority) WHERE group__load_priority IS NOT NULL;
CREATE INDEX idx_entities_created_at ON entity.entities(general__created_at);
CREATE INDEX idx_entities_updated_at ON entity.entities(general__updated_at);
CREATE INDEX idx_entities_semantic_version ON entity.entities(general__semantic_version);
CREATE INDEX idx_entities_scripts_names ON entity.entities USING GIN (script__names);
CREATE INDEX idx_entities_assets_names ON entity.entities USING GIN (asset__names);

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


-- 5.3 ENTITY FUNCTIONS
-- ============================================================================

-- Function to remove deleted script references from entities
CREATE OR REPLACE FUNCTION entity.remove_deleted_script_references()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE entity.entities
    SET script__names = array_remove(script__names, OLD.general__script_file_name)
    WHERE OLD.general__script_file_name = ANY(script__names);
    
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Function to remove deleted asset references from entities
CREATE OR REPLACE FUNCTION entity.remove_deleted_asset_references()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE entity.entities
    SET asset__names = array_remove(asset__names, OLD.general__asset_file_name)
    WHERE OLD.general__asset_file_name = ANY(asset__names);
    
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


-- 6.2 ENTITY ASSET TRIGGERS
-- ============================================================================

-- Update audit columns trigger for entity_assets
CREATE TRIGGER update_audit_columns
    BEFORE UPDATE ON entity.entity_assets
    FOR EACH ROW
    EXECUTE FUNCTION entity.update_audit_columns();


-- 6.3 ENTITY TRIGGERS
-- ============================================================================

-- Trigger for updating audit columns
CREATE TRIGGER update_audit_columns
    BEFORE UPDATE ON entity.entities
    FOR EACH ROW
    EXECUTE FUNCTION entity.update_audit_columns();

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

-- ============================================================================
-- TRIGGERS TO UPDATE TIMESTAMPS WHEN SPECIFIC COLUMNS CHANGE
-- ============================================================================

-- 1. Trigger for entity.entities
CREATE OR REPLACE FUNCTION entity.update_entity_timestamps()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.meta__data IS DISTINCT FROM OLD.meta__data THEN
            NEW.meta_data_updated_at = now();
        END IF;
        IF NEW.script__names IS DISTINCT FROM OLD.script__names THEN
            NEW.script_names_updated_at = now();
        END IF;
        IF NEW.asset__names IS DISTINCT FROM OLD.asset__names THEN
            NEW.asset_names_updated_at = now();
        END IF;
        -- Add position_updated_at if you have position columns
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_entity_timestamps
BEFORE UPDATE ON entity.entities
FOR EACH ROW EXECUTE FUNCTION entity.update_entity_timestamps();

-- 2. Trigger for entity.entity_scripts
CREATE OR REPLACE FUNCTION entity.update_script_timestamps()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.script__source__data IS DISTINCT FROM OLD.script__source__data THEN
            NEW.script__source__data_updated_at = now();
        END IF;
        IF NEW.script__compiled__data IS DISTINCT FROM OLD.script__compiled__data THEN
            NEW.script__compiled__data_updated_at = now();
        END IF;
        IF NEW.script__compiled__status IS DISTINCT FROM OLD.script__compiled__status THEN
            NEW.script__compiled__status_updated_at = now();
        END IF;
        IF NEW.script__source__repo__url IS DISTINCT FROM OLD.script__source__repo__url THEN
            NEW.script__source__repo__url_updated_at = now();
        END IF;
        IF NEW.script__source__repo__entry_path IS DISTINCT FROM OLD.script__source__repo__entry_path THEN
            NEW.script__source__repo__entry_path_updated_at = now();
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_script_timestamps
BEFORE UPDATE ON entity.entity_scripts
FOR EACH ROW EXECUTE FUNCTION entity.update_script_timestamps();

-- 3. Trigger for entity.entity_assets
CREATE OR REPLACE FUNCTION entity.update_asset_timestamps()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.asset__data__base64 IS DISTINCT FROM OLD.asset__data__base64 THEN
            NEW.asset__data__base64_updated_at = now();
        END IF;
        IF NEW.asset__data__bytea IS DISTINCT FROM OLD.asset__data__bytea THEN
            NEW.asset__data__bytea_updated_at = now();
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_asset_timestamps
BEFORE UPDATE ON entity.entity_assets
FOR EACH ROW EXECUTE FUNCTION entity.update_asset_timestamps();

-- ============================================================================
-- INDEXES FOR TIMESTAMP-BASED QUERIES
-- ============================================================================

-- 1. Composite index for entity changes
CREATE INDEX idx_entity_timestamp_changes ON entity.entities 
    (group__sync, 
     GREATEST(
        meta_data_updated_at, 
        script_names_updated_at, 
        asset_names_updated_at, 
        general__updated_at
     ))
    INCLUDE (general__entity_id, general__entity_name);

-- 2. Composite index for script changes
CREATE INDEX idx_script_timestamp_changes ON entity.entity_scripts
    (group__sync,
     GREATEST(
        script__source__data_updated_at,
        script__compiled__data_updated_at,
        script__compiled__status_updated_at,
        script__source__repo__url_updated_at,
        script__source__repo__entry_path_updated_at,
        general__updated_at
     ))
    INCLUDE (general__script_file_name);

-- 3. Composite index for asset changes
CREATE INDEX idx_asset_timestamp_changes ON entity.entity_assets
    (group__sync,
     GREATEST(
        asset__data__base64_updated_at,
        general__updated_at
     ))
    INCLUDE (general__asset_file_name);