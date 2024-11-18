--
-- MUTATIONS AND ACTIONS
--

CREATE TYPE mutation_type AS ENUM ('INSERT', 'UPDATE', 'DELETE');
CREATE TYPE update_category AS ENUM ('FORCE', 'PROPERTY');
CREATE TYPE mutation_status AS ENUM ('PENDING', 'PROCESSED', 'REJECTED');
CREATE TYPE action_status AS ENUM (
    'PENDING',
    'IN_PROGRESS',
    'COMPLETED',
    'FAILED',
    'EXPIRED',
    'CANCELLED'
);

CREATE TABLE mutations (
    LIKE script_sources INCLUDING ALL,
    mutation_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    mutation_type mutation_type NOT NULL,
    update_category update_category NOT NULL,
    required_role TEXT[] NOT NULL
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
    action_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    mutation_id UUID REFERENCES mutations(mutation_id) NOT NULL,
    status action_status NOT NULL DEFAULT 'PENDING',
    claimed_by UUID REFERENCES agent_profiles(id),
    target_entities UUID[] NOT NULL,
    action_data JSONB,
    last_heartbeat TIMESTAMPTZ,
    timeout_duration INTERVAL NOT NULL DEFAULT '5 minutes'::INTERVAL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Mutation and Action Indexes
CREATE INDEX idx_mutations_required_role ON mutations(required_role);
CREATE INDEX idx_mutations_type ON mutations(mutation_type);
CREATE INDEX idx_actions_status ON actions(status);
CREATE INDEX idx_actions_claimed_by ON actions(claimed_by);
CREATE INDEX idx_actions_heartbeat ON actions(last_heartbeat) 
    WHERE status = 'IN_PROGRESS';
CREATE INDEX idx_actions_mutation_id ON actions(mutation_id);
CREATE INDEX idx_actions_target_entities ON actions USING GIN (target_entities);
CREATE INDEX idx_actions_metadata ON actions USING GIN (action_data jsonb_path_ops);

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
        (status IS DISTINCT FROM actions.status 
         OR 
         claimed_by IS DISTINCT FROM actions.claimed_by)
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
