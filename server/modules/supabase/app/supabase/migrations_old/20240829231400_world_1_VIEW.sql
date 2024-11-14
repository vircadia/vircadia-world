--
-- VIEWS
--

-- Create the visible_entities view using hierarchical structure
CREATE OR REPLACE VIEW visible_entities AS
SELECT e.*
FROM entities e
WHERE 
    -- Entity is visible if:
    (
        -- The accessing entity has full access
        EXISTS (
            SELECT 1 
            FROM entity_capabilities 
            WHERE entity_id = auth.uid() 
            AND has_full_access = true
        )
        OR
        -- The accessing entity has the required role (including parent roles)
        EXISTS (
            WITH RECURSIVE role_hierarchy AS (
                SELECT role_name, parent_role, hierarchy_path
                FROM roles
                WHERE role_name = e.view_role
                
                UNION
                
                SELECT r.role_name, r.parent_role, r.hierarchy_path
                FROM roles r
                JOIN role_hierarchy rh ON r.parent_role = rh.role_name
            )
            SELECT 1 
            FROM agent_roles ar
            JOIN role_hierarchy rh ON ar.role_name = rh.role_name
            WHERE ar.agent_id = auth.uid()
            AND ar.is_active = true
        )
        OR
        -- The accessing entity has permission through entity hierarchy
        EXISTS (
            WITH RECURSIVE entity_hierarchy AS (
                SELECT general__uuid, general__parent_entity_id
                FROM entities
                WHERE general__uuid = e.general__uuid
                
                UNION
                
                SELECT e2.general__uuid, e2.general__parent_entity_id
                FROM entities e2
                INNER JOIN entity_hierarchy eh 
                ON e2.general__uuid = eh.general__parent_entity_id
            )
            SELECT 1
            FROM entity_hierarchy eh
            JOIN entity_capabilities ec ON eh.general__uuid = ec.entity_id
            JOIN agent_roles ar ON ar.role_name = ec.can_view_role
            WHERE ar.agent_id = auth.uid()
            AND ar.is_active = true
        )
    );