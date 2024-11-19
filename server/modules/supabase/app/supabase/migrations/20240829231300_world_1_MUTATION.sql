--
-- MUTATIONS AND ACTIONS
--

CREATE TYPE mutation_type AS ENUM ('INSERT', 'UPDATE', 'DELETE');
CREATE TYPE update_category AS ENUM ('FORCE', 'PROPERTY');
CREATE TYPE action_status AS ENUM (
    'PENDING',
    'IN_PROGRESS',
    'COMPLETED',
    'FAILED',
    'REJECTED',
    'EXPIRED',
    'CANCELLED'
);

CREATE TABLE mutations (
    LIKE script_sources INCLUDING ALL,
    general__mutation_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    general__mutation_type mutation_type NOT NULL,
    general__update_category update_category NOT NULL,
    permissions__required_role TEXT[] NOT NULL
);

-- Trigger function to enforce foreign key constraint on array elements
CREATE OR REPLACE FUNCTION check_required_roles()
RETURNS TRIGGER AS $$
BEGIN
    -- Check each role in the required_role array
    PERFORM 1
    FROM unnest(NEW.required_role) AS role
    WHERE NOT EXISTS (
        SELECT 1 FROM roles WHERE role_name = role
    );

    IF FOUND THEN
        RAISE EXCEPTION 'Role not found in roles table';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to call the function on insert or update
CREATE TRIGGER enforce_required_roles
BEFORE INSERT OR UPDATE ON mutations
FOR EACH ROW EXECUTE FUNCTION check_required_roles();

CREATE TABLE actions (
    general__action_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    general__mutation_id UUID REFERENCES mutations(general__mutation_id) NOT NULL,
    general__action_status action_status NOT NULL DEFAULT 'PENDING',
    general__claimed_by UUID REFERENCES agent_profiles(id),
    general__target_entities UUID[] NOT NULL,
    general__action_data JSONB,
    general__last_heartbeat TIMESTAMPTZ,
    general__timeout_duration INTERVAL NOT NULL DEFAULT '5 minutes'::INTERVAL,
    general__created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Mutation and Action Indexes
CREATE INDEX idx_mutations_required_role ON mutations(permissions__required_role);
CREATE INDEX idx_mutations_type ON mutations(general__mutation_type);
CREATE INDEX idx_actions_status ON actions(general__action_status);
CREATE INDEX idx_actions_claimed_by ON actions(general__claimed_by);
CREATE INDEX idx_actions_heartbeat ON actions(general__last_heartbeat) 
    WHERE general__action_status = 'IN_PROGRESS';
CREATE INDEX idx_actions_mutation_id ON actions(general__mutation_id);
CREATE INDEX idx_actions_target_entities ON actions USING GIN (general__target_entities);
CREATE INDEX idx_actions_metadata ON actions USING GIN (general__action_data jsonb_path_ops);

-- Enable RLS
ALTER TABLE mutations ENABLE ROW LEVEL SECURITY;
ALTER TABLE actions ENABLE ROW LEVEL SECURITY;

-- Mutations policies
CREATE POLICY mutations_read_all ON mutations
    FOR SELECT TO PUBLIC
    USING (true);

CREATE POLICY mutations_modify_system ON mutations
    FOR ALL TO PUBLIC
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
    );

-- Actions policies
CREATE POLICY actions_read_all ON actions
    FOR SELECT TO PUBLIC
    USING (true);

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
    -- Delete excess inactive actions, keeping the most recent ones
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
