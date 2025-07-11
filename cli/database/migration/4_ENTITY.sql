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

-- 4.2 ENTITY ASSETS TABLE
-- ============================================================================
CREATE TABLE entity.entity_assets (
    general__asset_file_name TEXT PRIMARY KEY,
    group__sync TEXT NOT NULL REFERENCES auth.sync_groups(general__sync_group) DEFAULT 'public.NORMAL',
    CONSTRAINT fk_entity_assets_sync_group FOREIGN KEY (group__sync) REFERENCES auth.sync_groups(general__sync_group),

    asset__data__bytea BYTEA,  -- Store asset binaries (GLBs, textures, etc.) as bytea
    asset__mime_type TEXT DEFAULT NULL,

    asset__data__bytea_updated_at timestamptz DEFAULT now()
) INHERITS (entity._template);

ALTER TABLE entity.entity_assets ENABLE ROW LEVEL SECURITY;


-- 4.3 ENTITIES TABLE
-- ============================================================================
CREATE TABLE entity.entities (
    general__entity_name TEXT PRIMARY KEY,
    general__semantic_version TEXT NOT NULL DEFAULT '1.0.0',
    general__initialized_at TIMESTAMPTZ DEFAULT NULL,
    general__initialized_by UUID DEFAULT NULL,
    meta__data JSONB DEFAULT NULL,
    general__expiry__delete_since_updated_at_ms BIGINT DEFAULT NULL, -- Time in milliseconds after which the entity will be deleted if it is inactive
    general__expiry__delete_since_created_at_ms BIGINT DEFAULT NULL, -- Time in milliseconds after which the entity will be deleted even if it is active
    group__sync TEXT NOT NULL REFERENCES auth.sync_groups(general__sync_group) DEFAULT 'public.NORMAL',
    group__load_priority INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT fk_entities_sync_group FOREIGN KEY (group__sync) REFERENCES auth.sync_groups(general__sync_group)
) INHERITS (entity._template);

CREATE INDEX idx_entities_load_priority ON entity.entities(group__load_priority) WHERE group__load_priority IS NOT NULL;
CREATE INDEX idx_entities_created_at ON entity.entities(general__created_at);
CREATE INDEX idx_entities_updated_at ON entity.entities(general__updated_at);
CREATE INDEX idx_entities_semantic_version ON entity.entities(general__semantic_version);

ALTER TABLE entity.entities ENABLE ROW LEVEL SECURITY;


-- 4.4 ENTITY METADATA TABLE
-- ============================================================================
CREATE TABLE entity.entity_metadata (
    general__entity_name TEXT NOT NULL,
    metadata__key TEXT NOT NULL,
    metadata__value JSONB NOT NULL,
    group__sync TEXT NOT NULL,
    general__expiry__delete_since_updated_at_ms BIGINT DEFAULT NULL, -- Time in milliseconds after which the metadata will be deleted if it is inactive
    general__expiry__delete_since_created_at_ms BIGINT DEFAULT NULL, -- Time in milliseconds after which the metadata will be deleted even if it is active
    
    PRIMARY KEY (general__entity_name, metadata__key),
    CONSTRAINT fk_entity_metadata_entity FOREIGN KEY (general__entity_name) 
        REFERENCES entity.entities(general__entity_name) ON DELETE CASCADE,
    CONSTRAINT fk_entity_metadata_sync_group FOREIGN KEY (group__sync) 
        REFERENCES auth.sync_groups(general__sync_group)
) INHERITS (entity._template);

-- Indexes for efficient queries
CREATE INDEX idx_entity_metadata_key ON entity.entity_metadata(metadata__key);
CREATE INDEX idx_entity_metadata_updated ON entity.entity_metadata(general__updated_at);
CREATE INDEX idx_entity_metadata_entity_updated ON entity.entity_metadata(general__entity_name, general__updated_at);
CREATE INDEX idx_entity_metadata_sync_group ON entity.entity_metadata(group__sync);
CREATE INDEX idx_entity_metadata_value_gin ON entity.entity_metadata USING gin(metadata__value);
CREATE INDEX idx_entity_metadata_expiry_updated ON entity.entity_metadata(general__expiry__delete_since_updated_at_ms) WHERE general__expiry__delete_since_updated_at_ms IS NOT NULL;
CREATE INDEX idx_entity_metadata_expiry_created ON entity.entity_metadata(general__expiry__delete_since_created_at_ms) WHERE general__expiry__delete_since_created_at_ms IS NOT NULL;

ALTER TABLE entity.entity_metadata ENABLE ROW LEVEL SECURITY;


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


-- ============================================================================
-- 6. TRIGGERS
-- ============================================================================

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


-- 6.4 ENTITY METADATA TRIGGERS
-- ============================================================================

-- Update audit columns trigger for entity_metadata
CREATE TRIGGER update_audit_columns
    BEFORE UPDATE ON entity.entity_metadata
    FOR EACH ROW
    EXECUTE FUNCTION entity.update_audit_columns();


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


-- 7.5 ENTITY METADATA POLICIES
-- ============================================================================
-- Grant table permissions to vircadia_agent_proxy for entity_metadata
GRANT SELECT, INSERT, UPDATE, DELETE ON entity.entity_metadata TO vircadia_agent_proxy;

CREATE POLICY "entity_metadata_read_policy" ON entity.entity_metadata
    FOR SELECT
    TO PUBLIC
    USING (
        auth.is_admin_agent()
        OR auth.is_system_agent()
        OR EXISTS (
            SELECT 1
            FROM auth.active_sync_group_sessions sess
            WHERE sess.auth__agent_id = auth.current_agent_id()
              AND sess.group__sync = entity.entity_metadata.group__sync
              AND sess.permissions__can_read = true
        )
    );

CREATE POLICY "entity_metadata_update_policy" ON entity.entity_metadata
    FOR UPDATE
    TO PUBLIC
    USING (
        auth.is_admin_agent()
        OR auth.is_system_agent()
        OR EXISTS (
            SELECT 1
            FROM auth.active_sync_group_sessions sess
            WHERE sess.auth__agent_id = auth.current_agent_id()
              AND sess.group__sync = entity.entity_metadata.group__sync
              AND sess.permissions__can_update = true
        )
    );

CREATE POLICY "entity_metadata_insert_policy" ON entity.entity_metadata
    FOR INSERT
    TO PUBLIC
    WITH CHECK (
        auth.is_admin_agent()
        OR auth.is_system_agent()
        OR EXISTS (
            SELECT 1
            FROM auth.active_sync_group_sessions sess
            WHERE sess.auth__agent_id = auth.current_agent_id()
              AND sess.group__sync = entity.entity_metadata.group__sync
              AND sess.permissions__can_insert = true
        )
    );

CREATE POLICY "entity_metadata_delete_policy" ON entity.entity_metadata
    FOR DELETE
    TO PUBLIC
    USING (
        auth.is_admin_agent()
        OR auth.is_system_agent()
        OR EXISTS (
            SELECT 1
            FROM auth.active_sync_group_sessions sess
            WHERE sess.auth__agent_id = auth.current_agent_id()
              AND sess.group__sync = entity.entity_metadata.group__sync
              AND sess.permissions__can_delete = true
        )
    );

-- ============================================================================
-- TRIGGERS TO UPDATE TIMESTAMPS WHEN SPECIFIC COLUMNS CHANGE
-- ============================================================================

-- 1. Trigger for entity.entity_assets
CREATE OR REPLACE FUNCTION entity.update_asset_timestamps()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
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

-- 1. Index for entity changes
CREATE INDEX idx_entity_timestamp_changes ON entity.entities
    (group__sync, general__updated_at)
    INCLUDE (general__entity_name);

-- 2. Index for metadata changes
CREATE INDEX idx_entity_metadata_changes ON entity.entity_metadata
    (group__sync, general__updated_at)
    INCLUDE (general__entity_name, metadata__key);

-- 3. Composite index for asset changes
CREATE INDEX idx_asset_timestamp_changes ON entity.entity_assets
    (group__sync,
     GREATEST(
        general__updated_at
     ))
    INCLUDE (general__asset_file_name);