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
    general__entity_script_id UUID REFERENCES entity_scripts(general__script_id) NOT NULL,
    general__action_status action_status NOT NULL DEFAULT 'PENDING',
    general__claimed_by UUID REFERENCES agent_profiles(general__uuid),
    general__action_query JSONB NOT NULL,
    general__last_heartbeat TIMESTAMPTZ,
    general__created_at TIMESTAMPTZ DEFAULT NOW(),
    general__created_by UUID DEFAULT auth_uid()
);

-- Entity Mutation Functions
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

    -- Execute the query - RLS will automatically check permissions
    -- since we're using SECURITY INVOKER (default)
    EXECUTE p_sql_query;

    -- Record the action
    INSERT INTO actions (
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
$$ LANGUAGE plpgsql;  -- Using SECURITY INVOKER by default

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
        auth_uid() = general__created_by
        OR 
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

CREATE POLICY actions_create_system ON actions
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

CREATE POLICY actions_update_status_claimed ON actions
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
        (general__action_status IS DISTINCT FROM actions.general__action_status 
         OR 
         general__claimed_by IS DISTINCT FROM actions.general__claimed_by)
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

-- Utility Functions - These need SECURITY DEFINER since they bypass RLS
CREATE OR REPLACE FUNCTION expire_abandoned_actions(threshold_ms INTEGER)
RETURNS void AS $$
BEGIN
    UPDATE actions
    SET general__action_status = 'EXPIRED'
    WHERE general__action_status = 'IN_PROGRESS'
    AND general__last_heartbeat < NOW() - (threshold_ms * interval '1 millisecond');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions on functions
GRANT EXECUTE ON FUNCTION execute_entity_action TO PUBLIC;
GRANT EXECUTE ON FUNCTION expire_abandoned_actions TO PUBLIC;
GRANT EXECUTE ON FUNCTION cleanup_inactive_actions TO PUBLIC;
