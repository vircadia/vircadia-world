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
    general__expiry__delete_since_updated_at_ms BIGINT DEFAULT NULL, -- Time in milliseconds after which the entity will be deleted if it is inactive
    general__expiry__delete_since_created_at_ms BIGINT DEFAULT NULL, -- Time in milliseconds after which the entity will be deleted even if it is active
    group__sync TEXT NOT NULL REFERENCES auth.sync_groups(general__sync_group) DEFAULT 'public.NORMAL',
    group__channel TEXT DEFAULT NULL,
    group__load_priority INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT fk_entities_sync_group FOREIGN KEY (group__sync) REFERENCES auth.sync_groups(general__sync_group)
) INHERITS (entity._template);

CREATE INDEX idx_entities_load_priority ON entity.entities(group__load_priority) WHERE group__load_priority IS NOT NULL;
CREATE INDEX idx_entities_created_at ON entity.entities(general__created_at);
CREATE INDEX idx_entities_updated_at ON entity.entities(general__updated_at);
CREATE INDEX idx_entities_semantic_version ON entity.entities(general__semantic_version);
CREATE INDEX idx_entities_channel ON entity.entities(group__channel) WHERE group__channel IS NOT NULL;

ALTER TABLE entity.entities ENABLE ROW LEVEL SECURITY;


-- 4.4 ENTITY METADATA TABLE
-- ============================================================================
-- TODO: Enable metadata to have metadata_jsonb, metadata_bytea, metadata_int, metadata_float, metadata_boolean, metadata_string, metadata_array, metadata_object, metadata_null, etc. (or whatever is allowed with postgres) so we can create optimization strategies.
CREATE TABLE entity.entity_metadata (
    general__entity_name TEXT NOT NULL,
    metadata__key TEXT NOT NULL,
    ro__group__sync TEXT NOT NULL,
    ro__group__channel TEXT DEFAULT NULL,
    metadata__jsonb JSONB DEFAULT NULL,
    metadata__text TEXT DEFAULT NULL,
    metadata__int BIGINT DEFAULT NULL,
    metadata__float DOUBLE PRECISION DEFAULT NULL,
    metadata__bool BOOLEAN DEFAULT NULL,
    metadata__bytea BYTEA DEFAULT NULL,
    general__expiry__delete_since_updated_at_ms BIGINT DEFAULT NULL, -- Time in milliseconds after which the metadata will be deleted if it is inactive
    general__expiry__delete_since_created_at_ms BIGINT DEFAULT NULL, -- Time in milliseconds after which the metadata will be deleted even if it is active
    CONSTRAINT entity_metadata_one_value CHECK (
        ((metadata__jsonb IS NOT NULL)::int +
         (metadata__text IS NOT NULL)::int +
         (metadata__int IS NOT NULL)::int +
         (metadata__float IS NOT NULL)::int +
         (metadata__bool IS NOT NULL)::int +
         (metadata__bytea IS NOT NULL)::int) = 1
    ),
    
    PRIMARY KEY (general__entity_name, metadata__key),
    CONSTRAINT fk_entity_metadata_entity FOREIGN KEY (general__entity_name) 
        REFERENCES entity.entities(general__entity_name) ON DELETE CASCADE
) INHERITS (entity._template);

-- Indexes for efficient queries
CREATE INDEX idx_entity_metadata_key ON entity.entity_metadata(metadata__key);
CREATE INDEX idx_entity_metadata_updated ON entity.entity_metadata(general__updated_at);
CREATE INDEX idx_entity_metadata_entity_updated ON entity.entity_metadata(general__entity_name, general__updated_at);
CREATE INDEX idx_entity_metadata_jsonb_gin ON entity.entity_metadata USING gin(metadata__jsonb);
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


-- 5.2 ENTITY METADATA -> ENTITY TOUCH FUNCTIONS (STATEMENT-LEVEL)
-- ============================================================================

-- Touch parent entities for INSERT/UPDATE using transition NEW TABLE
CREATE OR REPLACE FUNCTION entity.touch_entity_on_metadata_change_from_new()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE entity.entities e
    SET general__updated_at = now(),
        general__updated_by = auth.current_agent_id()
    FROM (
        SELECT DISTINCT general__entity_name FROM new_table
    ) d
    WHERE e.general__entity_name = d.general__entity_name;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = entity, public, pg_temp;

-- 5.3 ENTITY METADATA GROUP MIRROR FUNCTIONS
-- ============================================================================

CREATE OR REPLACE FUNCTION entity.set_metadata_group_fields_from_parent()
RETURNS TRIGGER AS $$
DECLARE
    v_sync TEXT;
    v_channel TEXT;
BEGIN
    SELECT group__sync, group__channel
    INTO v_sync, v_channel
    FROM entity.entities
    WHERE general__entity_name = NEW.general__entity_name;

    IF v_sync IS NULL THEN
        RAISE EXCEPTION 'Entity % not found when syncing metadata group fields', NEW.general__entity_name;
    END IF;

    NEW.ro__group__sync = v_sync;
    NEW.ro__group__channel = v_channel;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = entity, auth, public, pg_temp;

CREATE OR REPLACE FUNCTION entity.sync_metadata_group_fields_from_parent()
RETURNS TRIGGER AS $$
BEGIN
    IF (OLD.group__sync IS DISTINCT FROM NEW.group__sync)
        OR (OLD.group__channel IS DISTINCT FROM NEW.group__channel) THEN
        UPDATE entity.entity_metadata
        SET ro__group__sync = NEW.group__sync,
            ro__group__channel = NEW.group__channel
        WHERE general__entity_name = NEW.general__entity_name;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = entity, public, pg_temp;

-- 5.4 CHANGE NOTIFICATION FUNCTIONS (REPLACED BY LOGICAL REPLICATION)
-- ==========================================================================
-- Functions removed in favor of logical replication


-- 5.5 AGENT LAST-SEEN TOUCH HELPERS
-- =========================================================================

-- Helper to bump the current agent's last seen timestamp once per statement/transaction
CREATE OR REPLACE FUNCTION entity.touch_current_agent_last_seen()
RETURNS void AS $$
BEGIN
    UPDATE auth.agent_profiles
    SET profile__last_seen_at = now()
    WHERE general__agent_profile_id = auth.current_agent_id()
      AND (profile__last_seen_at IS NULL OR profile__last_seen_at < now());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = entity, auth, public, pg_temp;

-- Guard function for invocation inside RLS USING expressions (evaluates to true)
CREATE OR REPLACE FUNCTION entity.touch_current_agent_last_seen_guard()
RETURNS boolean AS $$
DECLARE
    v_flag TEXT;
BEGIN
    v_flag := current_setting('app.did_touch_agent_last_seen', true);
    IF v_flag IS NULL OR v_flag = '' OR v_flag = 'false' THEN
        PERFORM entity.touch_current_agent_last_seen();
        PERFORM set_config('app.did_touch_agent_last_seen', 'true', true);
    END IF;
    RETURN true;
EXCEPTION WHEN OTHERS THEN
    -- Never block access due to heartbeat update failures
    RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = entity, auth, public, pg_temp;

-- Trigger wrapper to touch last seen for DML (statement-level)
CREATE OR REPLACE FUNCTION entity.touch_current_agent_last_seen_trg()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM entity.touch_current_agent_last_seen();
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = entity, auth, public, pg_temp;

-- Touch parent entities for DELETE using transition OLD TABLE
CREATE OR REPLACE FUNCTION entity.touch_entity_on_metadata_change_from_old()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE entity.entities e
    SET general__updated_at = now(),
        general__updated_by = auth.current_agent_id()
    FROM (
        SELECT DISTINCT general__entity_name FROM old_table
    ) d
    WHERE e.general__entity_name = d.general__entity_name;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = entity, public, pg_temp;

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

-- Touch current agent last-seen for any asset DML
DROP TRIGGER IF EXISTS touch_agent_last_seen_on_assets_ins ON entity.entity_assets;
DROP TRIGGER IF EXISTS touch_agent_last_seen_on_assets_upd ON entity.entity_assets;
DROP TRIGGER IF EXISTS touch_agent_last_seen_on_assets_del ON entity.entity_assets;
CREATE TRIGGER touch_agent_last_seen_on_assets_ins
    AFTER INSERT ON entity.entity_assets
    FOR EACH STATEMENT
    EXECUTE FUNCTION entity.touch_current_agent_last_seen_trg();
CREATE TRIGGER touch_agent_last_seen_on_assets_upd
    AFTER UPDATE ON entity.entity_assets
    FOR EACH STATEMENT
    EXECUTE FUNCTION entity.touch_current_agent_last_seen_trg();
CREATE TRIGGER touch_agent_last_seen_on_assets_del
    AFTER DELETE ON entity.entity_assets
    FOR EACH STATEMENT
    EXECUTE FUNCTION entity.touch_current_agent_last_seen_trg();

-- 6.3 ENTITY TRIGGERS
-- ============================================================================

-- Trigger for updating audit columns
CREATE TRIGGER update_audit_columns
    BEFORE UPDATE ON entity.entities
    FOR EACH ROW
    EXECUTE FUNCTION entity.update_audit_columns();

-- Touch current agent last-seen for any entity DML
DROP TRIGGER IF EXISTS touch_agent_last_seen_on_entities_ins ON entity.entities;
DROP TRIGGER IF EXISTS touch_agent_last_seen_on_entities_upd ON entity.entities;
DROP TRIGGER IF EXISTS touch_agent_last_seen_on_entities_del ON entity.entities;
CREATE TRIGGER touch_agent_last_seen_on_entities_ins
    AFTER INSERT ON entity.entities
    FOR EACH STATEMENT
    EXECUTE FUNCTION entity.touch_current_agent_last_seen_trg();
CREATE TRIGGER touch_agent_last_seen_on_entities_upd
    AFTER UPDATE ON entity.entities
    FOR EACH STATEMENT
    EXECUTE FUNCTION entity.touch_current_agent_last_seen_trg();
CREATE TRIGGER touch_agent_last_seen_on_entities_del
    AFTER DELETE ON entity.entities
    FOR EACH STATEMENT
    EXECUTE FUNCTION entity.touch_current_agent_last_seen_trg();

-- Keep metadata mirrors synchronized with their parent entity groups
CREATE TRIGGER sync_metadata_group_fields_from_entity
    AFTER UPDATE OF group__sync, group__channel ON entity.entities
    FOR EACH ROW
    EXECUTE FUNCTION entity.sync_metadata_group_fields_from_parent();

-- Trigger removed: notify_entity_change

-- 6.4 ENTITY METADATA TRIGGERS
-- ============================================================================

-- Update audit columns trigger for entity_metadata
CREATE TRIGGER update_audit_columns
    BEFORE UPDATE ON entity.entity_metadata
    FOR EACH ROW
    EXECUTE FUNCTION entity.update_audit_columns();

-- Mirror parent entity group fields on metadata writes
CREATE TRIGGER entity_metadata_set_ro_group_fields_ins
    BEFORE INSERT ON entity.entity_metadata
    FOR EACH ROW
    EXECUTE FUNCTION entity.set_metadata_group_fields_from_parent();

CREATE TRIGGER entity_metadata_set_ro_group_fields_upd
    BEFORE UPDATE ON entity.entity_metadata
    FOR EACH ROW
    EXECUTE FUNCTION entity.set_metadata_group_fields_from_parent();

-- Touch current agent last-seen for any metadata DML
DROP TRIGGER IF EXISTS touch_agent_last_seen_on_meta_ins ON entity.entity_metadata;
DROP TRIGGER IF EXISTS touch_agent_last_seen_on_meta_upd ON entity.entity_metadata;
DROP TRIGGER IF EXISTS touch_agent_last_seen_on_meta_del ON entity.entity_metadata;
CREATE TRIGGER touch_agent_last_seen_on_meta_ins
    AFTER INSERT ON entity.entity_metadata
    FOR EACH STATEMENT
    EXECUTE FUNCTION entity.touch_current_agent_last_seen_trg();
CREATE TRIGGER touch_agent_last_seen_on_meta_upd
    AFTER UPDATE ON entity.entity_metadata
    FOR EACH STATEMENT
    EXECUTE FUNCTION entity.touch_current_agent_last_seen_trg();
CREATE TRIGGER touch_agent_last_seen_on_meta_del
    AFTER DELETE ON entity.entity_metadata
    FOR EACH STATEMENT
    EXECUTE FUNCTION entity.touch_current_agent_last_seen_trg();

-- Trigger removed: notify_entity_metadata_change

-- 6.5 TOUCH PARENT ENTITY ON METADATA CHANGE (STATEMENT-LEVEL)
-- ==========================================================================

-- Consolidated parent update for INSERT/UPDATE
-- INSERT: transition NEW TABLE
CREATE TRIGGER touch_parent_entity_on_meta_change_stmt_ins
    AFTER INSERT ON entity.entity_metadata
    REFERENCING NEW TABLE AS new_table
    FOR EACH STATEMENT
    EXECUTE FUNCTION entity.touch_entity_on_metadata_change_from_new();

-- UPDATE: transition NEW TABLE
CREATE TRIGGER touch_parent_entity_on_meta_change_stmt_upd
    AFTER UPDATE ON entity.entity_metadata
    REFERENCING NEW TABLE AS new_table
    FOR EACH STATEMENT
    EXECUTE FUNCTION entity.touch_entity_on_metadata_change_from_new();

-- Consolidated parent update for DELETE
CREATE TRIGGER touch_parent_entity_on_meta_change_stmt_del
    AFTER DELETE ON entity.entity_metadata
    REFERENCING OLD TABLE AS old_table
    FOR EACH STATEMENT
    EXECUTE FUNCTION entity.touch_entity_on_metadata_change_from_old();

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

-- Allow proxy to call last-seen functions
GRANT EXECUTE ON FUNCTION entity.touch_current_agent_last_seen() TO vircadia_agent_proxy;
GRANT EXECUTE ON FUNCTION entity.touch_current_agent_last_seen_guard() TO vircadia_agent_proxy;
GRANT EXECUTE ON FUNCTION entity.touch_current_agent_last_seen_trg() TO vircadia_agent_proxy;


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
        entity.touch_current_agent_last_seen_guard() AND
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
        entity.touch_current_agent_last_seen_guard() AND
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
        entity.touch_current_agent_last_seen_guard() AND (
            auth.is_admin_agent()
            OR auth.is_system_agent()
            OR EXISTS (
                SELECT 1
                FROM auth.active_sync_group_sessions AS sess
                JOIN entity.entities AS e
                  ON e.general__entity_name = entity.entity_metadata.general__entity_name
                WHERE sess.auth__agent_id = auth.current_agent_id()
                  AND sess.group__sync = e.group__sync
                  AND sess.permissions__can_read = true
            )
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
            FROM auth.active_sync_group_sessions AS sess
            JOIN entity.entities AS e
              ON e.general__entity_name = entity.entity_metadata.general__entity_name
            WHERE sess.auth__agent_id = auth.current_agent_id()
              AND sess.group__sync = e.group__sync
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
            FROM auth.active_sync_group_sessions AS sess
            JOIN entity.entities AS e
              ON e.general__entity_name = entity.entity_metadata.general__entity_name
            WHERE sess.auth__agent_id = auth.current_agent_id()
              AND sess.group__sync = e.group__sync
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
            FROM auth.active_sync_group_sessions AS sess
            JOIN entity.entities AS e
              ON e.general__entity_name = entity.entity_metadata.general__entity_name
            WHERE sess.auth__agent_id = auth.current_agent_id()
              AND sess.group__sync = e.group__sync
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
-- Removed: group__sync no longer exists on entity_metadata; rely on other indexes

-- 3. Composite index for asset changes
CREATE INDEX idx_asset_timestamp_changes ON entity.entity_assets
    (group__sync,
     GREATEST(
        general__updated_at
     ))
    INCLUDE (general__asset_file_name);

-- 4. Specialized index for joint metadata timestamp queries
-- Optimizes queries like: WHERE entity_name = ? AND key LIKE 'joint:%' AND updated_at > ?
CREATE INDEX idx_entity_metadata_joint_timestamp ON entity.entity_metadata
    (general__entity_name, metadata__key, general__updated_at)
    WHERE metadata__key LIKE 'joint:%' AND metadata__jsonb->>'type' = 'avatarJoint';

-- ============================================================================
-- 8. LOGICAL REPLICATION SETUP
-- ============================================================================

-- Enable FULL replica identity to capture old values for channel migration logic
ALTER TABLE entity.entities REPLICA IDENTITY FULL;
ALTER TABLE entity.entity_metadata REPLICA IDENTITY FULL;

-- Create publication for entity tables
CREATE PUBLICATION entity_pub FOR TABLE entity.entities, entity.entity_metadata;
