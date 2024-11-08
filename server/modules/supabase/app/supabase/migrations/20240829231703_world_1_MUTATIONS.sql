-- Enums
CREATE TYPE mutation_type AS ENUM ('INSERT', 'UPDATE', 'DELETE');
CREATE TYPE update_category AS ENUM ('FORCE', 'PROPERTY');
CREATE TYPE mutation_status AS ENUM ('PENDING', 'PROCESSED', 'REJECTED');

-- Base mutations table (for tracking all mutations)
CREATE TABLE mutations (
    mutation_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_id UUID NOT NULL REFERENCES entities(general__uuid) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES agent_profiles(id) ON DELETE CASCADE,
    mutation_type mutation_type NOT NULL,
    update_category update_category NOT NULL,
    mutation_data JSONB,
    allowed_groups TEXT[], -- Must match script permissions__groups__mutations
    simulate_optimistically BOOLEAN DEFAULT false,
    status mutation_status NOT NULL DEFAULT 'PENDING',
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Entity creation mutations
CREATE TABLE entity_creation_mutations (
    LIKE mutations INCLUDING ALL,
    initial_properties JSONB NOT NULL,
    parent_id UUID REFERENCES entities(general__uuid) ON DELETE CASCADE
) INHERITS (mutations);

-- Entity update mutations
CREATE TABLE entity_update_mutations (
    LIKE mutations INCLUDING ALL,
    property_path TEXT[], -- For specific property updates
    previous_value JSONB  -- For rollback capability
) INHERITS (mutations);

-- Entity deletion mutations
CREATE TABLE entity_deletion_mutations (
    LIKE mutations INCLUDING ALL,
    cascade_delete BOOLEAN DEFAULT false,
    backup_data JSONB,    -- Store entity state before deletion
    dependent_entities UUID[], -- List of entities that will be affected
    verification_hash TEXT -- Hash of entity state to ensure it hasn't changed
) INHERITS (mutations);

-- Pending mutations tracking
CREATE TABLE entity_pending_mutations (
    LIKE mutations INCLUDING ALL,
    priority INTEGER DEFAULT 0,
    retry_count INTEGER DEFAULT 0,
    next_retry_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT
) INHERITS (mutations);

-- Rejected mutations tracking
CREATE TABLE entity_rejected_mutations (
    LIKE mutations INCLUDING ALL,
    rejection_reason TEXT,
    rejected_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    original_mutation_data JSONB -- Store the original mutation attempt
) INHERITS (mutations);

-- Create mutation validation function
CREATE OR REPLACE FUNCTION validate_mutation_groups()
RETURNS TRIGGER AS $$
BEGIN
    -- Check if mutation groups match any of the entity's script permissions
    IF NOT EXISTS (
        SELECT 1 
        FROM entity_scripts es
        WHERE es.entity_id = NEW.entity_id
        AND es.permissions__groups__mutations ?| NEW.allowed_groups
    ) THEN
        RAISE EXCEPTION 'Mutation groups do not match any script permissions';
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers
CREATE TRIGGER validate_mutation_groups_trigger
    BEFORE INSERT OR UPDATE ON mutations
    FOR EACH ROW
    EXECUTE FUNCTION validate_mutation_groups();

-- Enable RLS
ALTER TABLE entity_pending_mutations ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_rejected_mutations ENABLE ROW LEVEL SECURITY;
ALTER TABLE mutations ENABLE ROW LEVEL SECURITY;

-- Create indexes
CREATE INDEX idx_mutations_entity_id ON mutations(entity_id);
CREATE INDEX idx_mutations_agent_id ON mutations(agent_id);
CREATE INDEX idx_mutations_created_at ON mutations(created_at);
CREATE INDEX idx_mutations_type ON mutations(mutation_type);
CREATE INDEX idx_mutations_category ON mutations(update_category);
CREATE INDEX idx_mutations_status ON mutations(status);
CREATE INDEX idx_mutations_data ON mutations USING GIN (mutation_data);
CREATE INDEX idx_mutations_groups ON mutations USING GIN (allowed_groups);
CREATE INDEX idx_mutations_expires_at ON mutations(expires_at);

-- Specific indexes for pending mutations
CREATE INDEX idx_pending_mutations_priority ON entity_pending_mutations(priority);
CREATE INDEX idx_pending_mutations_next_retry ON entity_pending_mutations(next_retry_at);

-- Specific indexes for entity operations
CREATE INDEX idx_entity_creation_mutations_parent ON entity_creation_mutations(parent_id);
CREATE INDEX idx_entity_creation_mutations_properties ON entity_creation_mutations USING GIN (initial_properties);
CREATE INDEX idx_entity_update_mutations_path ON entity_update_mutations USING GIN (property_path);
CREATE INDEX idx_entity_deletion_mutations_cascade ON entity_deletion_mutations(cascade_delete);
CREATE INDEX idx_entity_deletion_mutations_dependents ON entity_deletion_mutations USING GIN (dependent_entities);

-- Composite indexes for common queries
CREATE INDEX idx_mutations_entity_created ON mutations(entity_id, created_at);
CREATE INDEX idx_mutations_agent_created ON mutations(agent_id, created_at);

-- RLS Policies
CREATE POLICY mutations_select_policy ON mutations
    FOR SELECT USING (can_read(entity_id));

-- Create new insert policy with conditional checks
CREATE POLICY mutations_insert_policy ON mutations
    FOR INSERT WITH CHECK (
        CASE 
            -- For creation mutations, only check allowed_groups
            WHEN mutation_type = 'INSERT' THEN
                EXISTS (
                    SELECT 1 
                    FROM entity_scripts es
                    WHERE es.entity_id = entity_id
                    AND es.permissions__groups__mutations && allowed_groups
                )
            -- For update/delete mutations, check write permission and allowed_groups
            ELSE 
                can_write(entity_id) AND 
                EXISTS (
                    SELECT 1 FROM entities e 
                    WHERE e.general__uuid = entity_id 
                    AND EXISTS (
                        SELECT 1 
                        FROM entity_scripts es
                        WHERE es.entity_id = e.general__uuid
                        AND es.permissions__groups__mutations && allowed_groups
                    )
                )
        END
    );

-- Apply policies to child tables
CREATE POLICY entity_creation_mutations_select_policy ON entity_creation_mutations FOR SELECT USING (can_read(entity_id));
CREATE POLICY entity_update_mutations_select_policy ON entity_update_mutations FOR SELECT USING (can_read(entity_id));
CREATE POLICY entity_deletion_mutations_select_policy ON entity_deletion_mutations FOR SELECT USING (can_read(entity_id));
CREATE POLICY entity_pending_mutations_select_policy ON entity_pending_mutations FOR SELECT USING (can_read(entity_id));
CREATE POLICY entity_rejected_mutations_select_policy ON entity_rejected_mutations FOR SELECT USING (can_read(entity_id));

-- Create cleanup function for expired mutations
CREATE OR REPLACE FUNCTION cleanup_expired_mutations()
RETURNS void AS $$
BEGIN
    -- Clean up expired mutations
    DELETE FROM mutations 
    WHERE expires_at < NOW() 
    OR (status = 'PROCESSED' AND created_at < NOW() - INTERVAL '30 days');
    
    -- Clean up rejected mutations older than 7 days
    DELETE FROM entity_rejected_mutations 
    WHERE rejected_at < NOW() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;

