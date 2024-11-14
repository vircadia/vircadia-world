--
-- MUTATIONS AND ACTIONS
--
CREATE TABLE mutations (
    LIKE script_sources INCLUDING ALL,
    mutation_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    mutation_type mutation_type NOT NULL,
    update_category update_category NOT NULL,
    required_role TEXT REFERENCES roles(role_name),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE actions (
    action_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    mutation_id UUID REFERENCES mutations(mutation_id) NOT NULL,
    status action_status NOT NULL DEFAULT 'PENDING',
    claimed_by UUID REFERENCES agent_profiles(id),
    target_entities UUID[] NOT NULL,
    action_data JSONB,
    last_heartbeat TIMESTAMPTZ,
    timeout_duration INTERVAL NOT NULL DEFAULT '5 minutes'::INTERVAL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
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
CREATE INDEX idx_actions_metadata ON actions USING GIN (metadata jsonb_path_ops);
