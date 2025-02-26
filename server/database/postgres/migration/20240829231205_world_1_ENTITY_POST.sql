-- =============================================================================
-- 2. ENTITY SCHEMA POLICIES AND PERMISSIONS
-- =============================================================================

-- Revoke all permissions from PUBLIC and vircadia_agent_proxy (to start with a clean slate)
REVOKE ALL ON ALL TABLES IN SCHEMA entity FROM PUBLIC, vircadia_agent_proxy;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA entity FROM PUBLIC, vircadia_agent_proxy;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA entity FROM PUBLIC, vircadia_agent_proxy;
REVOKE ALL ON ALL PROCEDURES IN SCHEMA entity FROM PUBLIC, vircadia_agent_proxy;
REVOKE ALL ON ALL ROUTINES IN SCHEMA entity FROM PUBLIC, vircadia_agent_proxy;


-- =============================================================================
-- 2. ENTITY SCRIPTS GRANTS AND POLICIES
-- =============================================================================

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

-- =============================================================================
-- 3. ENTITY ASSETS GRANTS AND POLICIES
-- =============================================================================

-- Grant table permissions to vircadia_agent_proxy for entity_assets
GRANT SELECT, INSERT, UPDATE, DELETE ON entity.entity_assets TO vircadia_agent_proxy;

-- Policy: allow view only if the agent is a member of the asset's sync group with view permission
CREATE POLICY "Group can view entity assets" ON entity.entity_assets
    FOR SELECT
    TO PUBLIC
    USING (
        EXISTS (
            SELECT 1
            FROM auth.agent_sync_group_roles AS ar
            WHERE ar.auth__agent_id = auth.current_agent_id()
              AND ar.group__sync = entity.entity_assets.group__sync
              AND ar.permissions__can_read = true
        )
    );

-- Policy: allow insert only if the agent is a member of the asset's sync group with insert permission
CREATE POLICY "Group can insert entity assets" ON entity.entity_assets
    FOR INSERT
    TO PUBLIC
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM auth.agent_sync_group_roles AS ar
            WHERE ar.auth__agent_id = auth.current_agent_id()
              AND ar.group__sync = entity.entity_assets.group__sync
              AND ar.permissions__can_insert = true
        )
    );

-- Policy: allow update only if the agent is a member of the asset's sync group with update permission
CREATE POLICY "Group can update entity assets" ON entity.entity_assets
    FOR UPDATE
    TO PUBLIC
    USING (
        EXISTS (
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
        EXISTS (
            SELECT 1
            FROM auth.agent_sync_group_roles AS ar
            WHERE ar.auth__agent_id = auth.current_agent_id()
              AND ar.group__sync = entity.entity_assets.group__sync
              AND ar.permissions__can_delete = true
        )
    );



-- =============================================================================
-- 3. ENTITY ENTITIES GRANTS AND POLICIES
-- =============================================================================

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
