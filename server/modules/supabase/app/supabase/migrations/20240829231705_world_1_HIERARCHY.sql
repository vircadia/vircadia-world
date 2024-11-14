--
-- FUNCTIONS AND TRIGGERS FOR HIERARCHY MANAGEMENT
--

-- Function to get descendants with depth limit
CREATE OR REPLACE FUNCTION get_descendant_entities(
    p_entity_id UUID,
    p_max_depth INTEGER DEFAULT 50
) RETURNS TABLE (
    entity_id UUID,
    depth INTEGER
) AS $$
WITH RECURSIVE descendants AS (
    SELECT 
        general__uuid,
        general__parent_entity_id,
        1 AS depth
    FROM entities
    WHERE general__parent_entity_id = p_entity_id
    
    UNION
    
    SELECT 
        e.general__uuid,
        e.general__parent_entity_id,
        d.depth + 1
    FROM entities e
    INNER JOIN descendants d ON d.general__uuid = e.general__parent_entity_id
    WHERE d.depth < p_max_depth
)
SELECT general__uuid, depth 
FROM descendants;
$$ LANGUAGE sql;

-- Function to get ancestors with depth limit
CREATE OR REPLACE FUNCTION get_ancestor_entities(
    p_entity_id UUID,
    p_max_depth INTEGER DEFAULT 50
) RETURNS TABLE (
    entity_id UUID,
    depth INTEGER
) AS $$
WITH RECURSIVE ancestors AS (
    SELECT 
        general__uuid,
        general__parent_entity_id,
        1 AS depth
    FROM entities
    WHERE general__uuid = (
        SELECT general__parent_entity_id
        FROM entities
        WHERE general__uuid = p_entity_id
    )
    
    UNION
    
    SELECT 
        e.general__uuid,
        e.general__parent_entity_id,
        a.depth + 1
    FROM entities e
    INNER JOIN ancestors a ON a.general__parent_entity_id = e.general__uuid
    WHERE a.depth < p_max_depth
)
SELECT general__uuid, depth 
FROM ancestors;
$$ LANGUAGE sql;

-- Function to check for hierarchy cycles
CREATE OR REPLACE FUNCTION check_entity_hierarchy_cycle(
    p_entity_id UUID,
    p_new_parent_id UUID
) RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1
        FROM get_descendant_entities(p_entity_id)
        WHERE entity_id = p_new_parent_id
    );
END;
$$ LANGUAGE plpgsql;

-- Trigger function to prevent circular references
CREATE OR REPLACE FUNCTION prevent_circular_hierarchy()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.general__parent_entity_id IS NOT NULL THEN
        IF NEW.general__uuid = NEW.general__parent_entity_id THEN
            RAISE EXCEPTION 'An entity cannot be its own parent';
        END IF;
        
        IF check_entity_hierarchy_cycle(NEW.general__uuid, NEW.general__parent_entity_id) THEN
            RAISE EXCEPTION 'Circular reference detected in entity hierarchy';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prevent_circular_hierarchy_trigger
    BEFORE INSERT OR UPDATE ON entities
    FOR EACH ROW
    EXECUTE FUNCTION prevent_circular_hierarchy();

-- Trigger function to maintain role hierarchy paths
CREATE OR REPLACE FUNCTION update_role_path()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.parent_role IS NULL THEN
        NEW.hierarchy_path = text2ltree(NEW.role_name);
    ELSE
        SELECT hierarchy_path || text2ltree(NEW.role_name)
        INTO NEW.hierarchy_path
        FROM roles
        WHERE role_name = NEW.parent_role;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER role_path_trig
    BEFORE INSERT OR UPDATE ON roles
    FOR EACH ROW
    EXECUTE FUNCTION update_role_path();