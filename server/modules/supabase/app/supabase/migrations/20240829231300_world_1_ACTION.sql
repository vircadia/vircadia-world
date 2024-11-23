--
-- ACTIONS
--

CREATE TYPE action_status AS ENUM (
    'PENDING',
    'IN_PROGRESS',
    'COMPLETED',
    'FAILED',
    'REJECTED',
    'EXPIRED',
    'CANCELLED'
);

CREATE TABLE actions (
    general__action_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    general__entity_script_id UUID REFERENCES entity_scripts(entity_script_id) NOT NULL,
    general__action_status action_status NOT NULL DEFAULT 'PENDING',
    general__claimed_by UUID REFERENCES agent_profiles(id),
    general__action_data JSONB NOT NULL,
    general__last_heartbeat TIMESTAMPTZ,
    general__created_at TIMESTAMPTZ DEFAULT NOW(),
    general__created_by UUID DEFAULT auth.uid(),
    CONSTRAINT check_action_data_format CHECK (
        general__action_data ? 'operations' AND
        general__action_data ? 'action_input' AND
        general__action_data ? 'sql_query' AND
        jsonb_typeof(general__action_data->'operations') = 'array'
    )
);

-- Add a trigger to validate operations array content
CREATE OR REPLACE FUNCTION validate_action_operations()
RETURNS TRIGGER AS $$
BEGIN
    IF NOT (
        SELECT bool_and(
            operation->>'operation' IN ('INSERT', 'UPDATE', 'DELETE') AND
            operation ? 'entity_id'
        )
        FROM jsonb_array_elements(NEW.general__action_data->'operations') as operation
    ) THEN
        RAISE EXCEPTION 'Invalid operations array format';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER validate_action_operations_trigger
    BEFORE INSERT OR UPDATE ON actions
    FOR EACH ROW
    EXECUTE FUNCTION validate_action_operations();

-- Entity Mutation Functions
CREATE OR REPLACE FUNCTION execute_entity_action(
    p_entity_script_id UUID,
    p_action_input JSONB,
    p_sql_query TEXT
) RETURNS JSONB AS $$
DECLARE
    v_affected_entities JSONB[];
    v_old_data JSONB;
    v_new_data JSONB;
    v_entity_id UUID;
    v_operation TEXT;
    v_result JSONB;
BEGIN
    -- Validate script exists
    IF NOT EXISTS (SELECT 1 FROM entity_scripts WHERE entity_script_id = p_entity_script_id) THEN
        RAISE EXCEPTION 'Invalid entity_script_id';
    END IF;

    -- Validate system role
    IF NOT EXISTS (
        SELECT 1 FROM agent_roles ar
        WHERE ar.agent_id = auth.uid()
        AND ar.role_name IN (
            SELECT role_name FROM roles 
            WHERE is_system = true AND is_active = true
        )
        AND ar.is_active = true
    ) THEN
        RAISE EXCEPTION 'Insufficient permissions';
    END IF;

    -- Execute the provided SQL query and capture the results
    -- The query should return a table with columns: operation, entity_id
    CREATE TEMP TABLE action_results ON COMMIT DROP AS
    EXECUTE p_sql_query;

    -- Process each affected entity
    FOR v_operation, v_entity_id IN 
        SELECT operation, entity_id::UUID FROM action_results
    LOOP
        -- For updates and deletes, capture old state
        IF v_operation IN ('UPDATE', 'DELETE') THEN
            SELECT row_to_json(e)::jsonb INTO v_old_data 
            FROM entities e WHERE e.general__uuid = v_entity_id;
        END IF;

        -- For inserts and updates, capture new state
        IF v_operation IN ('INSERT', 'UPDATE') THEN
            SELECT row_to_json(e)::jsonb INTO v_new_data
            FROM entities e WHERE e.general__uuid = v_entity_id;
        END IF;

        -- Build result object for this operation
        v_result = jsonb_build_object(
            'operation', v_operation,
            'entity_id', v_entity_id
        );

        -- Add appropriate entity data based on operation
        CASE v_operation
            WHEN 'INSERT' THEN
                v_result = v_result || jsonb_build_object('resulting_entity', v_new_data);
            WHEN 'UPDATE' THEN
                v_result = v_result || jsonb_build_object(
                    'old_entity', v_old_data,
                    'resulting_entity', v_new_data
                );
            WHEN 'DELETE' THEN
                v_result = v_result || jsonb_build_object('deleted_entity', v_old_data);
        END CASE;

        v_affected_entities = array_append(v_affected_entities, v_result);
    END LOOP;

    -- Create the action record
    INSERT INTO actions (
        general__entity_script_id,
        general__action_status,
        general__action_data,
        general__created_by
    ) VALUES (
        p_entity_script_id,
        'COMPLETED',
        jsonb_build_object(
            'operations', to_jsonb(v_affected_entities),
            'action_input', p_action_input,
            'sql_query', p_sql_query
        ),
        auth.uid()
    );

    RETURN to_jsonb(v_affected_entities);
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

-- Action Indexes
CREATE INDEX idx_actions_status ON actions(general__action_status);
CREATE INDEX idx_actions_claimed_by ON actions(general__claimed_by);
CREATE INDEX idx_actions_heartbeat ON actions(general__last_heartbeat) 
    WHERE general__action_status = 'IN_PROGRESS';

-- Enable RLS
ALTER TABLE actions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY actions_read_creator_and_system ON actions
    FOR SELECT TO PUBLIC
    USING (
        auth.uid() = general__created_by
        OR 
        EXISTS (
            SELECT 1 FROM agent_roles ar
            WHERE ar.agent_id = auth.uid()
            AND ar.role_name IN (
                SELECT role_name FROM roles 
                WHERE is_system = true AND is_active = true
            )
            AND ar.is_active = true
        )
    );

CREATE POLICY actions_create_system ON actions
    FOR INSERT TO PUBLIC
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM agent_roles ar
            WHERE ar.agent_id = auth.uid()
            AND ar.role_name IN (
                SELECT role_name FROM roles 
                WHERE is_system = true AND is_active = true
            )
            AND ar.is_active = true
        )
    );

CREATE POLICY actions_update_status_claimed ON actions
    FOR UPDATE TO PUBLIC
    USING (
        EXISTS (
            SELECT 1 FROM agent_roles ar
            WHERE ar.agent_id = auth.uid()
            AND ar.role_name IN (
                SELECT role_name FROM roles 
                WHERE is_system = true AND is_active = true
            )
            AND ar.is_active = true
        )
    )
    WITH CHECK (
        (general__action_status IS DISTINCT FROM actions.general__action_status 
         OR 
         general__claimed_by IS DISTINCT FROM actions.general__claimed_by)
        AND
        EXISTS (
            SELECT 1 FROM agent_roles ar
            WHERE ar.agent_id = auth.uid()
            AND ar.role_name IN (
                SELECT role_name FROM roles 
                WHERE is_system = true AND is_active = true
            )
            AND ar.is_active = true
        )
    );

-- Utility Functions
CREATE OR REPLACE FUNCTION expire_abandoned_actions(threshold_ms INTEGER)
RETURNS void AS $$
BEGIN
    UPDATE actions
    SET general__action_status = 'EXPIRED'
    WHERE general__action_status = 'IN_PROGRESS'
    AND general__last_heartbeat < NOW() - (threshold_ms * interval '1 millisecond');
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION cleanup_inactive_actions(retain_count INTEGER)
RETURNS void AS $$
BEGIN
    DELETE FROM actions
    WHERE general__action_id IN (
        SELECT general__action_id
        FROM (
            SELECT general__action_id,
                   ROW_NUMBER() OVER (
                       PARTITION BY (general__action_status IN ('COMPLETED', 'FAILED', 'REJECTED', 'EXPIRED', 'CANCELLED'))
                       ORDER BY general__created_at DESC
                   ) as rn
            FROM actions
            WHERE general__action_status IN ('COMPLETED', 'FAILED', 'REJECTED', 'EXPIRED', 'CANCELLED')
        ) ranked
        WHERE rn > retain_count
    );
END;
$$ LANGUAGE plpgsql;

-- Grant execute permissions on functions
GRANT EXECUTE ON FUNCTION execute_entity_action TO PUBLIC;
GRANT EXECUTE ON FUNCTION expire_abandoned_actions TO PUBLIC;
GRANT EXECUTE ON FUNCTION cleanup_inactive_actions TO PUBLIC;
