--
-- ENTITY ASSETS
--

CREATE TABLE entity.entity_assets (
    general__asset_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    general__asset_name TEXT NOT NULL DEFAULT 'UNNAMED_ASSET',
    group__sync TEXT NOT NULL REFERENCES auth.sync_groups(general__sync_group) DEFAULT 'public.NORMAL',
    
    asset__data BYTEA,  -- Store asset binaries (GLBs, textures, etc.)
    meta__data JSONB DEFAULT '{}'::jsonb,

    CONSTRAINT fk_entity_assets_sync_group FOREIGN KEY (group__sync) REFERENCES auth.sync_groups(general__sync_group)
) INHERITS (entity._template);

-- Enable RLS
ALTER TABLE entity.entity_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "entity_assets_view_policy" ON entity.entity_assets
    FOR SELECT
    USING (
        auth.is_admin_agent()
        OR auth.is_system_agent()
        OR EXISTS (
            SELECT 1 
            FROM auth.active_sync_group_sessions sess 
            WHERE sess.auth__agent_id = auth.current_agent_id()
            AND sess.group__sync = entity.entity_assets.group__sync
        )
    );

CREATE POLICY "entity_assets_update_policy" ON entity.entity_assets
    FOR UPDATE
    USING (
        auth.is_admin_agent()
        OR auth.is_system_agent()
        OR EXISTS (
            SELECT 1 
            FROM auth.active_sync_group_sessions sess 
            WHERE sess.auth__agent_id = auth.current_agent_id()
            AND sess.group__sync = entity.entity_assets.group__sync
            AND sess.permissions__can_update = true
        )
    );

CREATE POLICY "entity_assets_insert_policy" ON entity.entity_assets
    FOR INSERT
    WITH CHECK (
        auth.is_admin_agent()
        OR auth.is_system_agent()
        OR EXISTS (
            SELECT 1 
            FROM auth.active_sync_group_sessions sess 
            WHERE sess.auth__agent_id = auth.current_agent_id()
            AND sess.group__sync = entity.entity_assets.group__sync
            AND sess.permissions__can_insert = true
        )
    );

CREATE POLICY "entity_assets_delete_policy" ON entity.entity_assets
    FOR DELETE
    USING (
        auth.is_admin_agent()
        OR auth.is_system_agent()
        OR EXISTS (
            SELECT 1 
            FROM auth.active_sync_group_sessions sess 
            WHERE sess.auth__agent_id = auth.current_agent_id()
            AND sess.group__sync = entity.entity_assets.group__sync
            AND sess.permissions__can_delete = true
        )
    );

CREATE TRIGGER update_audit_columns
    BEFORE UPDATE ON entity.entity_assets
    FOR EACH ROW
    EXECUTE FUNCTION entity.update_audit_columns();
