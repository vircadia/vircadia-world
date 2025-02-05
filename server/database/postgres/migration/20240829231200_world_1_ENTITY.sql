-- TODO: We need to make it so notifications are tracked by number or ID or date, or SOMETHING so client can track its own reflected notifications and also so we can do appropriate client-server lag compensation in tandem with tick (validate this method with AI)

-- Create entity schema
CREATE SCHEMA IF NOT EXISTS entity;

--
-- ENTITY SYNC GROUPS
--

-- Modify entity_sync_groups table creation and default values (keeping just the defaults)
CREATE TABLE entity.entity_sync_groups (
    sync_group TEXT PRIMARY KEY,
    general__description TEXT,
    permissions__admin_role TEXT NOT NULL,
    permissions__is_admin BOOLEAN NOT NULL DEFAULT false,
    
    server__tick__rate_ms INTEGER NOT NULL,
    server__tick__buffer INTEGER NOT NULL,
    
    client__render_delay_ms INTEGER NOT NULL,
    client__max_prediction_time_ms INTEGER NOT NULL,
    
    network__packet_timing_variance_ms INTEGER NOT NULL,
    
    server__keyframe__interval_ticks INTEGER NOT NULL,
    
    general__created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    general__updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    general__created_by UUID DEFAULT auth.current_agent_id(),
    general__updated_by UUID DEFAULT auth.current_agent_id()
);

-- Insert sync groups with prefixed columns
INSERT INTO entity.entity_sync_groups (
    sync_group,
    general__description,
    permissions__admin_role,
    permissions__is_admin,
    server__tick__rate_ms,
    server__tick__buffer,
    client__render_delay_ms,
    client__max_prediction_time_ms,
    network__packet_timing_variance_ms,
    server__keyframe__interval_ticks
) VALUES
    -- Public zone
    ('public.REALTIME', 'Public realtime entities', 'admin', false, 16, 2, 50, 100, 25, 50),
    ('public.NORMAL', 'Public normal-priority entities', 'admin', false, 50, 1, 100, 150, 50, 40),
    ('public.BACKGROUND', 'Public background entities', 'admin', false, 200, 1, 200, 300, 100, 15),
    ('public.STATIC', 'Public static entities', 'admin', false, 2000, 1, 500, 1000, 200, 3),
    
    -- Admin zone
    ('admin.REALTIME', 'Admin-only realtime entities', 'admin', true, 16, 2, 50, 100, 25, 50),
    ('admin.NORMAL', 'Admin-only normal-priority entities', 'admin', true, 50, 1, 100, 150, 50, 40),
    
    -- Game zone example
    ('game1.REALTIME', 'Game 1 realtime entities', 'game1_admin', false, 16, 2, 50, 100, 25, 50),
    ('game1.NORMAL', 'Game 1 normal-priority entities', 'game1_admin', false, 50, 1, 100, 150, 50, 40),
    ('game1.BACKGROUND', 'Game 1 background entities', 'game1_admin', false, 200, 1, 200, 300, 100, 15);

-- Enable RLS and keep the basic policies
ALTER TABLE entity.entity_sync_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow viewing sync groups" ON entity.entity_sync_groups
    FOR SELECT
    USING (true);

CREATE POLICY "Allow admin sync group modifications" ON entity.entity_sync_groups
    FOR ALL
    USING (auth.is_admin_agent());

--
-- ENTITY SCRIPTS
--

-- Create enum for script compilation status
CREATE TYPE script_compilation_status AS ENUM ('PENDING', 'COMPILED', 'FAILED');

CREATE TABLE entity.entity_scripts (
    general__script_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    general__created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    general__created_by UUID DEFAULT auth.current_agent_id(),
    general__updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    general__updated_by UUID DEFAULT auth.current_agent_id(),

    group__sync TEXT NOT NULL REFERENCES entity.entity_sync_groups(sync_group) DEFAULT 'public.STATIC',

    script__source__node__repo__entry_path TEXT,
    script__source__node__repo__url TEXT,
    script__compiled__node__script TEXT,
    script__compiled__node__script_sha256 TEXT,
    script__compiled__node__script_status script_compilation_status NOT NULL DEFAULT 'PENDING',
    script__compiled__node__updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    
    script__source__bun__repo__entry_path TEXT,
    script__source__bun__repo__url TEXT,
    script__compiled__bun__script TEXT,
    script__compiled__bun__script_sha256 TEXT,
    script__compiled__bun__script_status script_compilation_status NOT NULL DEFAULT 'PENDING',
    script__compiled__bun__updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    
    script__source__browser__repo__entry_path TEXT,
    script__source__browser__repo__url TEXT,
    script__compiled__browser__script TEXT,
    script__compiled__browser__script_sha256 TEXT,
    script__compiled__browser__script_status script_compilation_status NOT NULL DEFAULT 'PENDING',
    script__compiled__browser__updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Enable RLS
ALTER TABLE entity.entity_scripts ENABLE ROW LEVEL SECURITY;

-- Allow all users to view scripts
CREATE POLICY "Allow viewing scripts" ON entity.entity_scripts
    FOR SELECT
    USING (true);

-- Create policy for inserting scripts
CREATE POLICY "Allow inserting scripts with proper access" ON entity.entity_scripts
    FOR INSERT
    WITH CHECK (
        auth.is_admin_agent()
    );

-- Create policy for updating scripts
CREATE POLICY "Allow updating scripts with proper access" ON entity.entity_scripts
    FOR UPDATE
    USING (
        auth.is_admin_agent()
    );

-- Create policy for deleting scripts
CREATE POLICY "Allow deleting scripts with proper access" ON entity.entity_scripts
    FOR DELETE
    USING (
        auth.is_admin_agent()
    );

-- 
-- ENTITIES
-- 

-- Create entity status enum
CREATE TYPE entity_status_enum AS ENUM ('ACTIVE', 'AWAITING_SCRIPTS', 'INACTIVE');

CREATE TABLE entity.entities (
    general__entity_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    general__name VARCHAR(255) NOT NULL,
    general__semantic_version TEXT NOT NULL DEFAULT '1.0.0',
    general__created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    general__created_by UUID DEFAULT auth.current_agent_id(),
    general__updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    general__updated_by UUID DEFAULT auth.current_agent_id(),
    general__load_priority INTEGER,
    general__initialized_at TIMESTAMPTZ DEFAULT NULL,
    general__initialized_by UUID DEFAULT NULL,
    meta__data JSONB DEFAULT '{}'::jsonb,
    scripts__ids UUID[] DEFAULT '{}',
    scripts__status entity_status_enum DEFAULT 'ACTIVE'::entity_status_enum NOT NULL,
    validation__log JSONB DEFAULT '[]'::jsonb,
    group__sync TEXT DEFAULT 'NORMAL' REFERENCES entity.entity_sync_groups(sync_group)
);

CREATE UNIQUE INDEX unique_seed_order_idx ON entity.entities(general__load_priority) WHERE general__load_priority IS NOT NULL;

-- Entities indexes
CREATE INDEX idx_entities_created_at ON entity.entities(general__created_at);
CREATE INDEX idx_entities_updated_at ON entity.entities(general__updated_at);
CREATE INDEX idx_entities_semantic_version ON entity.entities(general__semantic_version);
CREATE INDEX idx_entities_scripts_ids ON entity.entities USING GIN (scripts__ids);
CREATE INDEX idx_entities_validation_log ON entity.entities USING GIN (validation__log);

-- Enable RLS on entities table
ALTER TABLE entity.entities ENABLE ROW LEVEL SECURITY;

-- Entities policies
CREATE POLICY "entities_view_policy" ON entity.entities
    FOR SELECT
    USING (
        auth.is_admin_agent()
        OR general__created_by = auth.current_agent_id()
        OR auth.has_sync_group_access(group__sync)
    );

CREATE POLICY "entities_update_policy" ON entity.entities
    FOR UPDATE
    USING (
        auth.is_admin_agent()
        OR general__created_by = auth.current_agent_id()
        OR auth.has_sync_group_access(group__sync)
    );

CREATE POLICY "entities_insert_policy" ON entity.entities
    FOR INSERT
    WITH CHECK (
        auth.is_admin_agent()
        OR auth.has_sync_group_access(group__sync)
    );

CREATE POLICY "entities_delete_policy" ON entity.entities
    FOR DELETE
    USING (
        auth.is_admin_agent()
        OR general__created_by = auth.current_agent_id()
        OR auth.has_sync_group_access(group__sync)
    );

-- Function to validate the validation log format
CREATE OR REPLACE FUNCTION entity.validate_validation_log() RETURNS TRIGGER AS $$
BEGIN
    -- Check if validation_log is an array
    IF NOT jsonb_typeof(NEW.validation__log) = 'array' THEN
        RAISE EXCEPTION 'validation__log must be a JSONB array';
    END IF;

    -- Validate each entry in the array
    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(NEW.validation__log) AS entry
        WHERE NOT (
            -- Check required fields exist and have correct types
            (entry->>'timestamp') IS NOT NULL 
            AND (entry->>'timestamp')::timestamptz IS NOT NULL
            AND (entry->>'agent_id') IS NOT NULL 
            AND (entry->>'agent_id')::uuid IS NOT NULL
            AND (entry->>'entity_script_id') IS NOT NULL 
            AND (entry->>'entity_script_id')::uuid IS NOT NULL
            AND (entry->>'query') IS NOT NULL 
            AND jsonb_typeof(entry->>'query') = 'string'
            -- Ensure no extra fields
            AND (
                SELECT count(*)
                FROM jsonb_object_keys(entry) AS k
            ) = 4
        )
    ) THEN
        RAISE EXCEPTION 'Invalid validation log entry format. Required format: {"timestamp": "<timestamptz>", "agent_id": "<uuid>", "entity_script_id": "<uuid>", "query": "<string>"}';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for validation log format enforcement
CREATE TRIGGER enforce_validation_log_format
    BEFORE UPDATE OF validation__log ON entity.entities
    FOR EACH ROW
    EXECUTE FUNCTION entity.validate_validation_log();

-- Add validation function for meta__data structure
CREATE OR REPLACE FUNCTION entity.validate_entity_metadata() RETURNS TRIGGER AS $$
BEGIN
    -- Validate required fields and their types
    IF NOT (
        jsonb_typeof(NEW.meta__data->'babylon_js') = 'object'
        AND jsonb_typeof(NEW.meta__data->'babylon_js'->'model_url') = 'string'
        AND jsonb_typeof(NEW.meta__data->'babylon_js'->'position') = 'object'
        AND jsonb_typeof(NEW.meta__data->'babylon_js'->'rotation') = 'object'
        AND jsonb_typeof(NEW.meta__data->'babylon_js'->'scale') = 'object'
    ) THEN
        RAISE EXCEPTION 'meta__data must contain babylon_js object with model_url, position, rotation, and scale with correct types';
    END IF;

    -- Validate position structure
    IF NOT (
        jsonb_typeof(NEW.meta__data->'babylon_js'->'position'->'x') = 'number'
        AND jsonb_typeof(NEW.meta__data->'babylon_js'->'position'->'y') = 'number'
        AND jsonb_typeof(NEW.meta__data->'babylon_js'->'position'->'z') = 'number'
    ) THEN
        RAISE EXCEPTION 'babylon_js.position must contain numeric x, y, z values';
    END IF;

    -- Validate rotation structure
    IF NOT (
        jsonb_typeof(NEW.meta__data->'babylon_js'->'rotation'->'x') = 'number'
        AND jsonb_typeof(NEW.meta__data->'babylon_js'->'rotation'->'y') = 'number'
        AND jsonb_typeof(NEW.meta__data->'babylon_js'->'rotation'->'z') = 'number'
        AND jsonb_typeof(NEW.meta__data->'babylon_js'->'rotation'->'w') = 'number'
    ) THEN
        RAISE EXCEPTION 'babylon_js.rotation must contain numeric x, y, z, w values';
    END IF;

    -- Validate scale structure
    IF NOT (
        jsonb_typeof(NEW.meta__data->'babylon_js'->'scale'->'x') = 'number'
        AND jsonb_typeof(NEW.meta__data->'babylon_js'->'scale'->'y') = 'number'
        AND jsonb_typeof(NEW.meta__data->'babylon_js'->'scale'->'z') = 'number'
    ) THEN
        RAISE EXCEPTION 'babylon_js.scale must contain numeric x, y, z values';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for metadata validation
CREATE TRIGGER enforce_entity_metadata_format
    BEFORE INSERT OR UPDATE OF meta__data ON entity.entities
    FOR EACH ROW
    EXECUTE FUNCTION entity.validate_entity_metadata();

-- Create function to update timestamp
CREATE OR REPLACE FUNCTION entity.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.general__updated_at = CURRENT_TIMESTAMP;
    NEW.general__updated_by = auth.current_agent_id();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for entity_sync_groups
CREATE TRIGGER update_entity_sync_groups_updated_at
    BEFORE UPDATE ON entity.entity_sync_groups
    FOR EACH ROW
    EXECUTE FUNCTION entity.update_updated_at();

-- Create trigger for entities
CREATE TRIGGER update_entities_updated_at
    BEFORE UPDATE ON entity.entities
    FOR EACH ROW
    EXECUTE FUNCTION entity.update_updated_at();

-- Create function to update script status
CREATE OR REPLACE FUNCTION entity.update_script_status()
RETURNS TRIGGER AS $$
BEGIN
    -- Only check script status if scripts exist
    IF NEW.scripts__ids IS NULL OR NEW.scripts__ids = '{}' THEN
        NEW.scripts__status = 'ACTIVE'::entity_status_enum;
    ELSE
        -- Check if any scripts are pending
        IF EXISTS (
            SELECT 1 
            FROM entity.entity_scripts es 
            WHERE es.general__script_id = ANY(NEW.scripts__ids)
            AND (
                es.script__compiled__node__script_status = 'PENDING' OR
                es.script__compiled__bun__script_status = 'PENDING' OR
                es.script__compiled__browser__script_status = 'PENDING'
            )
        ) THEN
            NEW.scripts__status = 'AWAITING_SCRIPTS'::entity_status_enum;
        ELSE
            NEW.scripts__status = 'ACTIVE'::entity_status_enum;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers to update script status
CREATE TRIGGER update_entity_script_status
    BEFORE INSERT OR UPDATE OF scripts__ids ON entity.entities
    FOR EACH ROW
    EXECUTE FUNCTION entity.update_script_status();

-- Create trigger to update entities when scripts are updated
CREATE OR REPLACE FUNCTION entity.propagate_script_status_changes()
RETURNS TRIGGER AS $$
BEGIN
    -- If script status changed, update affected entities
    IF TG_OP = 'UPDATE' AND (
        OLD.script__compiled__node__script_status != NEW.script__compiled__node__script_status OR
        OLD.script__compiled__bun__script_status != NEW.script__compiled__bun__script_status OR
        OLD.script__compiled__browser__script_status != NEW.script__compiled__browser__script_status
    ) THEN
        -- Touch entities to trigger their status update
        UPDATE entity.entities
        SET general__updated_at = general__updated_at
        WHERE NEW.general__script_id = ANY(scripts__ids);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on entity_scripts
CREATE TRIGGER propagate_script_status_changes
    AFTER UPDATE ON entity.entity_scripts
    FOR EACH ROW
    EXECUTE FUNCTION entity.propagate_script_status_changes();

-- Update has_sync_group_access function to not use auth.roles
CREATE OR REPLACE FUNCTION auth.has_sync_group_access(p_sync_group TEXT) 
RETURNS BOOLEAN AS $$
BEGIN
    -- Check if the agent is an admin
    IF auth.is_admin_agent() THEN
        RETURN true;
    END IF;

    -- Check if the sync group exists and agent has access
    RETURN EXISTS (
        SELECT 1 
        FROM entity.entity_sync_groups sg
        WHERE sg.sync_group = p_sync_group
        AND (
            -- Public access if no admin role required
            sg.permissions__admin_role IS NULL
            OR sg.permissions__admin_role = ''
            OR sg.permissions__is_admin = false
        )
    );
END;
$$ LANGUAGE plpgsql;
