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
        general__action_data ? 'operation' AND
        general__action_data ? 'entity_id' AND
        general__action_data ? 'action_input' AND
        (general__action_data->>'operation' IN ('INSERT', 'UPDATE', 'DELETE'))
    )
);

-- Entity Mutation Functions
CREATE OR REPLACE FUNCTION create_entity_with_action(
    p_entity_script_id UUID,
    p_action_input JSONB,
    p_entity_data JSONB
) RETURNS UUID AS $$
DECLARE
    v_entity_id UUID;
BEGIN
    -- Validate script exists
    IF NOT EXISTS (SELECT 1 FROM entity_scripts WHERE entity_script_id = p_entity_script_id) THEN
        RAISE EXCEPTION 'Invalid entity_script_id';
    END IF;

    -- Create the entity
    INSERT INTO entities (
        general__uuid,
        general__name,
        babylonjs__type,
        permissions__can_view_roles,
        general__created_at,
        general__updated_at
    )
    SELECT 
        coalesce(p_entity_data->>'general__uuid', uuid_generate_v4()),
        p_entity_data->>'general__name',
        (p_entity_data->>'babylonjs__type')::general_type_enum,
        (p_entity_data->'permissions__can_view_roles')::text[],
        NOW(),
        NOW()
    RETURNING general__uuid INTO v_entity_id;

    -- Create the action record
    INSERT INTO actions (
        general__entity_script_id,
        general__action_status,
        general__action_data,
        general__created_by
    ) 
    SELECT
        p_entity_script_id,
        'COMPLETED',
        jsonb_build_object(
            'operation', 'INSERT',
            'entity_id', v_entity_id,
            'action_input', p_action_input,
            'resulting_entity', row_to_json(e)::jsonb
        ),
        auth.uid()
    FROM entities e WHERE e.general__uuid = v_entity_id;

    RETURN v_entity_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION update_entity_with_action(
    p_entity_id UUID,
    p_entity_script_id UUID,
    p_action_input JSONB,
    p_entity_data JSONB
) RETURNS VOID AS $$
DECLARE
    v_old_data JSONB;
    v_new_data JSONB;
BEGIN
    -- Capture old state
    SELECT row_to_json(e)::jsonb INTO v_old_data 
    FROM entities e WHERE e.general__uuid = p_entity_id;

    IF v_old_data IS NULL THEN
        RAISE EXCEPTION 'Entity not found';
    END IF;

    -- Update the entity
    UPDATE entities
    SET
        general__name = COALESCE(p_entity_data->>'general__name', general__name),
        babylonjs__type = COALESCE((p_entity_data->>'babylonjs__type')::general_type_enum, babylonjs__type),
        permissions__can_view_roles = COALESCE((p_entity_data->'permissions__can_view_roles')::text[], permissions__can_view_roles),
        general__updated_at = NOW()
    WHERE general__uuid = p_entity_id;

    -- Get updated entity data
    SELECT row_to_json(e)::jsonb INTO v_new_data
    FROM entities e WHERE e.general__uuid = p_entity_id;

    -- Create action record
    INSERT INTO actions (
        general__entity_script_id,
        general__action_status,
        general__action_data,
        general__created_by
    ) VALUES (
        p_entity_script_id,
        'COMPLETED',
        jsonb_build_object(
            'operation', 'UPDATE',
            'entity_id', p_entity_id,
            'action_input', p_action_input,
            'old_entity', v_old_data,
            'resulting_entity', v_new_data
        ),
        auth.uid()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION delete_entity_with_action(
    p_entity_id UUID,
    p_entity_script_id UUID,
    p_action_input JSONB
) RETURNS VOID AS $$
DECLARE
    v_old_data JSONB;
BEGIN
    -- Capture old state
    SELECT row_to_json(e)::jsonb INTO v_old_data 
    FROM entities e WHERE e.general__uuid = p_entity_id;

    IF v_old_data IS NULL THEN
        RAISE EXCEPTION 'Entity not found';
    END IF;

    -- Delete the entity
    DELETE FROM entities WHERE general__uuid = p_entity_id;

    -- Create action record
    INSERT INTO actions (
        general__entity_script_id,
        general__action_status,
        general__action_data,
        general__created_by
    ) VALUES (
        p_entity_script_id,
        'COMPLETED',
        jsonb_build_object(
            'operation', 'DELETE',
            'entity_id', p_entity_id,
            'action_input', p_action_input,
            'deleted_entity', v_old_data
        ),
        auth.uid()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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
GRANT EXECUTE ON FUNCTION create_entity_with_action TO PUBLIC;
GRANT EXECUTE ON FUNCTION update_entity_with_action TO PUBLIC;
GRANT EXECUTE ON FUNCTION delete_entity_with_action TO PUBLIC;
GRANT EXECUTE ON FUNCTION expire_abandoned_actions TO PUBLIC;
GRANT EXECUTE ON FUNCTION cleanup_inactive_actions TO PUBLIC;
