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
    general__script_name TEXT PRIMARY KEY,
    group__sync TEXT NOT NULL REFERENCES auth.sync_groups(general__sync_group) DEFAULT 'public.NORMAL',
    CONSTRAINT fk_entity_scripts_sync_group FOREIGN KEY (group__sync) REFERENCES auth.sync_groups(general__sync_group),

    script__type TEXT NOT NULL DEFAULT 'BABYLON_BROWSER',
    CONSTRAINT chk_script_type CHECK (script__type IN ('BABYLON_NODE', 'BABYLON_BUN', 'BABYLON_BROWSER')),

    -- Source fields
    script__source__repo__entry_path TEXT,
    script__source__repo__url TEXT,

    script__source__data TEXT,
    script__source__sha256 TEXT,
    script__source__updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    script__compiled__data TEXT,
    script__compiled__sha256 TEXT,
    script__compiled__status TEXT NOT NULL DEFAULT 'PENDING',
    CONSTRAINT chk_script_compiled_status CHECK (script__compiled__status IN ('PENDING', 'COMPILING', 'COMPILED', 'FAILED')),
    script__compiled__updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
) INHERITS (entity._template);

ALTER TABLE entity.entity_scripts ENABLE ROW LEVEL SECURITY;


-- 4.2 ENTITY ASSETS TABLE
-- ============================================================================
CREATE TABLE entity.entity_assets (
    general__asset_name TEXT PRIMARY KEY,
    group__sync TEXT NOT NULL REFERENCES auth.sync_groups(general__sync_group) DEFAULT 'public.NORMAL',
    CONSTRAINT fk_entity_assets_sync_group FOREIGN KEY (group__sync) REFERENCES auth.sync_groups(general__sync_group),
    
    asset__data BYTEA,  -- Store asset binaries (GLBs, textures, etc.)
    asset__type TEXT,
    CONSTRAINT chk_asset_type CHECK (asset__type IN (
        -- 3D Models
        'GLB', 'GLTF', 'OBJ', 'FBX', 'DAE', 'STL', 'STEP', 'IGES', 'BLEND', 'X3D', 'VRML', 'BVH',
        -- Textures
        'PNG', 'JPEG', 'JPG', 'TIFF', 'TIF', 'GIF', 'WEBP', 'BMP', 'TGA', 'HDR', 'EXR', 'KTX2',
        -- Video
        'WEBM', 'MP4', 'MOV', 'AVI',
        -- Audio
        'MP3', 'WAV', 'OGG', 'AAC', 'FLAC',
        -- Material
        'MTL', 'MAT', 
        -- Shaders
        'GLSL', 'HLSL', 'WGSL', 'SPIRV', 'COMP', 'FRAG', 'VERT', 'SHADERPAK'
    ))
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
    script__names TEXT[] DEFAULT '{}',
    asset__names TEXT[] DEFAULT '{}',
    group__sync TEXT NOT NULL REFERENCES auth.sync_groups(general__sync_group) DEFAULT 'public.NORMAL',
    group__load_priority INTEGER,

    CONSTRAINT fk_entities_sync_group FOREIGN KEY (group__sync) REFERENCES auth.sync_groups(general__sync_group)
) INHERITS (entity._template);

CREATE UNIQUE INDEX unique_seed_order_idx ON entity.entities(group__load_priority) WHERE group__load_priority IS NOT NULL;
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
    SET script__names = array_remove(script__names, OLD.general__script_name)
    WHERE OLD.general__script_name = ANY(script__names);
    
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