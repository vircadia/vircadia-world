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
        OR general__created_by = auth.current_agent_id()
        OR auth.has_sync_group_read_access(group__sync)
    );

CREATE POLICY "entity_assets_update_policy" ON entity.entity_assets
    FOR UPDATE
    USING (
        auth.is_admin_agent()
        OR general__created_by = auth.current_agent_id()
        OR auth.has_sync_group_update_access(group__sync)
    );

CREATE POLICY "entity_assets_insert_policy" ON entity.entity_assets
    FOR INSERT
    WITH CHECK (
        auth.is_admin_agent()
        OR auth.has_sync_group_insert_access(group__sync)
    );

CREATE POLICY "entity_assets_delete_policy" ON entity.entity_assets
    FOR DELETE
    USING (
        auth.is_admin_agent()
        OR general__created_by = auth.current_agent_id()
        OR auth.has_sync_group_delete_access(group__sync)
    );

CREATE TRIGGER update_audit_columns
    BEFORE UPDATE ON entity.entity_assets
    FOR EACH ROW
    EXECUTE FUNCTION entity.update_audit_columns();
