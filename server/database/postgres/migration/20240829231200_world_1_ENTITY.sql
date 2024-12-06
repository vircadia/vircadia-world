-- 
-- PERMISSIONS
--

CREATE TABLE permissions (
    permissions__roles__view TEXT[],
    permissions__roles__full TEXT[]
);

--
-- ENTITY SCRIPTS
--

-- Create enum for script compilation status
CREATE TYPE script_compilation_status AS ENUM ('PENDING', 'COMPILED', 'FAILED');

CREATE TABLE entity_scripts (
    general__script_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    general__created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    general__updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    general__created_by UUID DEFAULT auth_uid(),

    compiled__web__node__script TEXT,
    compiled__web__node__script_sha256 TEXT,
    compiled__web__node__script_status script_compilation_status,
    compiled__web__bun__script TEXT,
    compiled__web__bun__script_sha256 TEXT,
    compiled__web__bun__script_status script_compilation_status,
    compiled__web__browser__script TEXT,
    compiled__web__browser__script_sha256 TEXT,
    compiled__web__browser__script_status script_compilation_status,

    source__git__repo_entry_path TEXT,
    source__git__repo_url TEXT
) INHERITS (permissions);

-- Enable RLS
ALTER TABLE entity_scripts ENABLE ROW LEVEL SECURITY;

-- Create policy for viewing scripts
CREATE POLICY "Allow viewing scripts with proper role and IP" ON entity_scripts
    FOR SELECT
    USING (
        is_system_agent(current_setting('client.ip', TRUE)) AND
        (
            -- Check for script management role
            EXISTS (
                SELECT 1 FROM agent_roles ar
                JOIN roles r ON ar.auth__role_name = r.auth__role_name
                WHERE ar.auth__agent_id = auth_uid()
                AND ar.auth__is_active = true
                AND (r.auth__entity__script__can_insert = true OR r.auth__is_system = true)
            )
        ) OR (
            -- Check for view/full permission roles
            EXISTS (
                SELECT 1 FROM agent_roles ar
                WHERE ar.auth__agent_id = auth_uid()
                AND ar.auth__is_active = true
                AND ar.auth__role_name = ANY(permissions__roles__view || permissions__roles__full)
            )
        ) OR (
            -- Allow creator to view their own scripts
            general__created_by = auth_uid()
        )
    );

-- Create policy for inserting scripts
CREATE POLICY "Allow inserting scripts with proper role" ON entity_scripts
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM agent_roles ar
            JOIN roles r ON ar.auth__role_name = r.auth__role_name
            WHERE ar.auth__agent_id = auth_uid()
            AND ar.auth__is_active = true
            AND (r.auth__entity__script__can_insert = true OR r.auth__is_system = true)
        )
    );

-- Create policy for updating scripts
CREATE POLICY "Allow updating scripts with proper role" ON entity_scripts
    FOR UPDATE
    USING (
        (
            -- Check for script management role
            EXISTS (
                SELECT 1 FROM agent_roles ar
                JOIN roles r ON ar.auth__role_name = r.auth__role_name
                WHERE ar.auth__agent_id = auth_uid()
                AND ar.auth__is_active = true
                AND (r.auth__entity__script__can_insert = true OR r.auth__is_system = true)
            )
        ) OR (
            -- Check for full permission roles
            EXISTS (
                SELECT 1 FROM agent_roles ar
                WHERE ar.auth__agent_id = auth_uid()
                AND ar.auth__is_active = true
                AND ar.auth__role_name = ANY(permissions__roles__full)
            )
        ) OR (
            -- Allow creator to update their own scripts
            general__created_by = auth_uid()
        )
    );

-- Create policy for deleting scripts
CREATE POLICY "Allow deleting scripts with proper role" ON entity_scripts
    FOR DELETE
    USING (
        (
            -- Check for script management role
            EXISTS (
                SELECT 1 FROM agent_roles ar
                JOIN roles r ON ar.auth__role_name = r.auth__role_name
                WHERE ar.auth__agent_id = auth_uid()
                AND ar.auth__is_active = true
                AND (r.auth__entity__script__can_insert = true OR r.auth__is_system = true)
            )
        ) OR (
            -- Check for full permission roles
            EXISTS (
                SELECT 1 FROM agent_roles ar
                WHERE ar.auth__agent_id = auth_uid()
                AND ar.auth__is_active = true
                AND ar.auth__role_name = ANY(permissions__roles__full)
            )
        ) OR (
            -- Allow creator to delete their own scripts
            general__created_by = auth_uid()
        )
    );

--
-- ENTITIES
--

CREATE TABLE entities (
    general__uuid UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    general__name VARCHAR(255) NOT NULL,
    general__semantic_version TEXT NOT NULL DEFAULT '1.0.0',
    general__created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    general__created_by UUID DEFAULT auth_uid(),
    general__updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    general__tags TEXT[] DEFAULT '{}',
    type__babylonjs TEXT NOT NULL,
    scripts__ids UUID[] DEFAULT '{}',
    performance__server__tick_rate_ms NUMERIC DEFAULT 16,
    performance__client__updated_at_sync_ms NUMERIC DEFAULT 100,
    performance__client__keyframe_down_sync_ms NUMERIC DEFAULT 1000,
    general__load_priority INTEGER
) INHERITS (permissions);

CREATE UNIQUE INDEX unique_seed_order_idx ON entities(general__load_priority) WHERE general__load_priority IS NOT NULL;

-- Entities indexes
CREATE INDEX idx_entities_permissions__roles__view ON entities USING GIN (permissions__roles__view);
CREATE INDEX idx_entities_permissions__roles__full ON entities USING GIN (permissions__roles__full);
CREATE INDEX idx_entities_created_at ON entities(general__created_at);
CREATE INDEX idx_entities_updated_at ON entities(general__updated_at);
CREATE INDEX idx_entities_semantic_version ON entities(general__semantic_version);
CREATE INDEX idx_entities_type_babylonjs ON entities(type__babylonjs);
CREATE INDEX idx_entities_scripts_ids ON entities USING GIN (scripts__ids);
CREATE INDEX idx_entities_general_tags ON entities USING GIN (general__tags);

-- Enable RLS on entities table
ALTER TABLE entities ENABLE ROW LEVEL SECURITY;

-- Entities policies
CREATE POLICY "entities_view_policy" ON entities
    FOR SELECT
    USING (
        is_system_agent(current_setting('client.ip', TRUE))
        OR general__created_by = auth_uid()
        OR EXISTS (
            SELECT 1 
            FROM agent_roles ar
            WHERE ar.auth__agent_id = auth_uid()
            AND ar.auth__is_active = true
            AND (
                ar.auth__role_name = ANY(entities.permissions__roles__view)
                OR ar.auth__role_name = ANY(entities.permissions__roles__full)
            )
        )
    );

CREATE POLICY "entities_update_policy" ON entities
    FOR UPDATE
    USING (
        is_system_agent(current_setting('client.ip', TRUE))
        OR general__created_by = auth_uid()
        OR EXISTS (
            SELECT 1 
            FROM agent_roles ar
            WHERE ar.auth__agent_id = auth_uid()
            AND ar.auth__is_active = true
            AND ar.auth__role_name = ANY(entities.permissions__roles__full)
        )
    );

CREATE POLICY "entities_insert_policy" ON entities
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 
            FROM agent_roles ar
            JOIN roles r ON r.auth__role_name = ar.auth__role_name
            WHERE ar.auth__agent_id = auth_uid()
            AND ar.auth__is_active = true
            AND r.auth__is_active = true
            AND r.auth__entity__object__can_insert = true
        )
    );

CREATE POLICY "entities_delete_policy" ON entities
    FOR DELETE
    USING (
        is_system_agent(current_setting('client.ip', TRUE))
        OR general__created_by = auth_uid()
        OR EXISTS (
            SELECT 1 
            FROM agent_roles ar
            WHERE ar.auth__agent_id = auth_uid()
            AND ar.auth__is_active = true
            AND ar.auth__role_name = ANY(entities.permissions__roles__full)
        )
    );

CREATE POLICY "entities_admin_policy" ON entities
    FOR ALL
    USING (is_system_agent(current_setting('client.ip', TRUE)));

--
-- ENTITIES METADATA
--

CREATE TABLE entities_metadata (
    general__metadata_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    general__entity_id UUID NOT NULL REFERENCES entities(general__uuid) ON DELETE CASCADE,
    general__name TEXT NOT NULL,
    general__created_at TIMESTAMPTZ DEFAULT NOW(),
    general__created_by UUID DEFAULT auth_uid(),
    general__updated_at TIMESTAMPTZ DEFAULT NOW(),
    values__text TEXT[],
    values__numeric NUMERIC[],
    values__boolean BOOLEAN[],
    values__timestamp TIMESTAMPTZ[],

    UNIQUE (general__entity_id, general__name)
);

-- Enable RLS on entities_metadata table
ALTER TABLE entities_metadata ENABLE ROW LEVEL SECURITY;

-- Add index for faster metadata lookups
CREATE INDEX idx_entities_general__name_entity ON entities_metadata(general__name, general__entity_id);

-- Entities metadata policies
CREATE POLICY "entities_metadata_view_policy" ON entities_metadata
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 
            FROM entities e
            WHERE e.general__uuid = entities_metadata.general__entity_id
            AND (
                e.general__created_by = auth_uid()
                OR EXISTS (
                    SELECT 1
                    FROM agent_roles ar
                    WHERE ar.auth__agent_id = auth_uid()
                    AND ar.auth__is_active = true
                    AND (
                        ar.auth__role_name = ANY(e.permissions__roles__view)
                        OR ar.auth__role_name = ANY(e.permissions__roles__full)
                    )
                )
            )
        )
    );

CREATE POLICY "entities_metadata_update_policy" ON entities_metadata
    FOR UPDATE
    USING (
        is_system_agent(current_setting('client.ip', TRUE))
        AND EXISTS (
            SELECT 1 
            FROM entities e
            WHERE e.general__uuid = entities_metadata.general__entity_id
            AND (
                e.general__created_by = auth_uid()
                OR EXISTS (
                    SELECT 1
                    FROM agent_roles ar
                    WHERE ar.auth__agent_id = auth_uid()
                    AND ar.auth__is_active = true
                    AND ar.auth__role_name = ANY(e.permissions__roles__full)
                )
            )
        )
    );

CREATE POLICY "entities_metadata_insert_policy" ON entities_metadata
    FOR INSERT
    WITH CHECK (
        is_system_agent(current_setting('client.ip', TRUE))
    );

CREATE POLICY "entities_metadata_delete_policy" ON entities_metadata
    FOR DELETE
    USING (
        is_system_agent(current_setting('client.ip', TRUE))
        AND EXISTS (
            SELECT 1 
            FROM entities e
            WHERE e.general__uuid = entities_metadata.general__entity_id
            AND (
                e.general__created_by = auth_uid()
                OR EXISTS (
                    SELECT 1
                    FROM agent_roles ar
                    WHERE ar.auth__agent_id = auth_uid()
                    AND ar.auth__is_active = true
                    AND ar.auth__role_name = ANY(e.permissions__roles__full)
                )
            )
        )
    );

--
-- ENTITY ACTIONS
--

CREATE TYPE entity_action_status AS ENUM (
    'PENDING',
    'IN_PROGRESS',
    'COMPLETED',
    'FAILED',
    'REJECTED',
    'EXPIRED',
    'CANCELLED'
);

CREATE TABLE entity_actions (
    general__action_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    general__entity_script_id UUID REFERENCES entity_scripts(general__script_id) NOT NULL,
    general__action_status entity_action_status NOT NULL DEFAULT 'PENDING',
    general__claimed_by UUID REFERENCES agent_profiles(general__uuid),
    general__action_query JSONB NOT NULL,
    general__last_heartbeat TIMESTAMPTZ,
    general__created_at TIMESTAMPTZ DEFAULT NOW(),
    general__created_by UUID DEFAULT auth_uid()
);

-- Entity Action Functions
CREATE OR REPLACE FUNCTION execute_entity_action(
    p_entity_script_id UUID,
    p_sql_query TEXT,
    p_action_input JSONB
) RETURNS VOID AS $$
BEGIN
    -- Validate script exists and user has permission (using RLS)
    IF NOT EXISTS (
        SELECT 1 
        FROM entity_scripts 
        WHERE general__script_id = p_entity_script_id
    ) THEN
        RAISE EXCEPTION 'Invalid general__script_id or insufficient permissions';
    END IF;

    EXECUTE p_sql_query;

    INSERT INTO entity_actions (
        general__entity_script_id,
        general__action_status,
        general__action_query,
        general__created_by
    ) VALUES (
        p_entity_script_id,
        'COMPLETED',
        p_action_input,
        auth_uid()
    );
END;
$$ LANGUAGE plpgsql;

-- Action Indexes
CREATE INDEX idx_entity_actions_status ON entity_actions(general__action_status);
CREATE INDEX idx_entity_actions_claimed_by ON entity_actions(general__claimed_by);
CREATE INDEX idx_entity_actions_heartbeat ON entity_actions(general__last_heartbeat) 
    WHERE general__action_status = 'IN_PROGRESS';

-- Enable RLS
ALTER TABLE entity_actions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY entity_actions_read_creator_and_system ON entity_actions
    FOR SELECT TO PUBLIC
    USING (
        is_system_agent(current_setting('client.ip', TRUE))
        OR auth_uid() = general__created_by
        OR EXISTS (
            SELECT 1 FROM agent_roles ar
            WHERE ar.auth__agent_id = auth_uid()
            AND ar.auth__role_name IN (
                SELECT auth__role_name FROM roles 
                WHERE auth__is_system = true AND auth__is_active = true
            )
            AND ar.auth__is_active = true
        )
    );

CREATE POLICY entity_actions_create_system ON entity_actions
    FOR INSERT TO PUBLIC
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM agent_roles ar
            WHERE ar.auth__agent_id = auth_uid()
            AND ar.auth__role_name IN (
                SELECT auth__role_name FROM roles 
                WHERE auth__is_system = true AND auth__is_active = true
                OR auth__entity__object__can_insert = true AND auth__is_active = true
            )
            AND ar.auth__is_active = true
        )
    );

CREATE POLICY entity_actions_update_status_claimed ON entity_actions
    FOR UPDATE TO PUBLIC
    USING (
        EXISTS (
            SELECT 1 FROM agent_roles ar
            WHERE ar.auth__agent_id = auth_uid()
            AND ar.auth__role_name IN (
                SELECT auth__role_name FROM roles 
                WHERE auth__is_system = true AND auth__is_active = true
            )
            AND ar.auth__is_active = true
        )
    )
    WITH CHECK (
        (general__action_status IS DISTINCT FROM entity_actions.general__action_status 
         OR 
         general__claimed_by IS DISTINCT FROM entity_actions.general__claimed_by)
        AND
        EXISTS (
            SELECT 1 FROM agent_roles ar
            WHERE ar.auth__agent_id = auth_uid()
            AND ar.auth__role_name IN (
                SELECT auth__role_name FROM roles 
                WHERE auth__is_system = true AND auth__is_active = true
            )
            AND ar.auth__is_active = true
        )
    );

-- Utility Functions
CREATE OR REPLACE FUNCTION expire_abandoned_entity_actions(threshold_ms INTEGER)
RETURNS void AS $$
BEGIN
    UPDATE entity_actions
    SET general__action_status = 'EXPIRED'
    WHERE general__action_status = 'IN_PROGRESS'
    AND general__last_heartbeat < NOW() - (threshold_ms * interval '1 millisecond');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION cleanup_inactive_entity_actions(retain_count INTEGER)
RETURNS void AS $$
BEGIN
    DELETE FROM entity_actions
    WHERE general__action_id IN (
        SELECT general__action_id
        FROM (
            SELECT general__action_id,
                   ROW_NUMBER() OVER (
                       PARTITION BY (general__action_status IN ('COMPLETED', 'FAILED', 'REJECTED', 'EXPIRED', 'CANCELLED'))
                       ORDER BY general__created_at DESC
                   ) as rn
            FROM entity_actions
            WHERE general__action_status IN ('COMPLETED', 'FAILED', 'REJECTED', 'EXPIRED', 'CANCELLED')
        ) ranked
        WHERE rn > retain_count
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions on functions
GRANT EXECUTE ON FUNCTION execute_entity_action TO PUBLIC;
GRANT EXECUTE ON FUNCTION expire_abandoned_entity_actions TO PUBLIC;
GRANT EXECUTE ON FUNCTION cleanup_inactive_entity_actions TO PUBLIC;

-- Now create the trigger functions that reference the entities table
CREATE OR REPLACE FUNCTION validate_entity_scripts()
RETURNS TRIGGER AS $$
BEGIN
    -- Validate that all script IDs exist
    IF EXISTS (
        SELECT 1
        FROM unnest(NEW.scripts__ids) script_id
        WHERE NOT EXISTS (
            SELECT 1 FROM entity_scripts WHERE general__script_id = script_id
        )
    ) THEN
        RAISE EXCEPTION 'One or more script IDs do not exist in entity_scripts table';
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION cleanup_deleted_script_references()
RETURNS TRIGGER AS $$
BEGIN
    -- Remove the deleted script ID from all entities
    UPDATE entities
    SET scripts__ids = array_remove(scripts__ids, OLD.general__script_id)
    WHERE OLD.general__script_id = ANY(scripts__ids);
    
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Create triggers after both the table and functions exist
CREATE TRIGGER validate_entity_scripts_trigger
    BEFORE INSERT OR UPDATE OF scripts__ids ON entities
    FOR EACH ROW
    EXECUTE FUNCTION validate_entity_scripts();

CREATE TRIGGER cleanup_script_references_trigger
    BEFORE DELETE ON entity_scripts
    FOR EACH ROW
    EXECUTE FUNCTION cleanup_deleted_script_references();

