-- TODO: We need to make it so notifications are tracked by number or ID or date, or SOMETHING so client can track its own reflected notifications and also so we can do appropriate client-server lag compensation in tandem with tick (validate this method with AI)

-- Create entity schema
CREATE SCHEMA IF NOT EXISTS entity;

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
CREATE POLICY "Allow inserting scripts with proper role" ON entity.entity_scripts
    FOR INSERT
    WITH CHECK (
        auth.is_admin_agent()
        OR EXISTS (
            SELECT 1 FROM auth.agent_roles ar
            JOIN auth.roles r ON ar.auth__role_name = r.auth__role_name
            WHERE ar.auth__agent_id = auth.current_agent_id()
            AND ar.auth__is_active = true
        )
    );

-- Create policy for updating scripts
CREATE POLICY "Allow updating scripts with proper role" ON entity.entity_scripts
    FOR UPDATE
    USING (
        auth.is_admin_agent()
        OR EXISTS (
            SELECT 1 FROM auth.agent_roles ar
            JOIN auth.roles r ON ar.auth__role_name = r.auth__role_name
            WHERE ar.auth__agent_id = auth.current_agent_id()
            AND ar.auth__is_active = true
        )
    );

-- Create policy for deleting scripts
CREATE POLICY "Allow deleting scripts with proper role" ON entity.entity_scripts
    FOR DELETE
    USING (
        auth.is_admin_agent()
        OR EXISTS (
            SELECT 1 FROM auth.agent_roles ar
            JOIN auth.roles r ON ar.auth__role_name = r.auth__role_name
            WHERE ar.auth__agent_id = auth.current_agent_id()
            AND ar.auth__is_active = true
        )
    );

--
-- ENTITY SYNC GROUPS
--

-- Create a table to track protected sync groups first
CREATE TABLE entity.protected_sync_groups (
    sync_group TEXT PRIMARY KEY,
    description TEXT NOT NULL
);

-- Enable RLS on protected sync groups
ALTER TABLE entity.protected_sync_groups ENABLE ROW LEVEL SECURITY;

-- Only allow admins to view/modify protected sync groups list
CREATE POLICY "Allow admin protected sync groups access" ON entity.protected_sync_groups
    FOR ALL
    USING (auth.is_admin_agent());

-- Insert the protected (required) sync groups
INSERT INTO entity.protected_sync_groups (sync_group, description) VALUES
    ('REALTIME', 'High-frequency updates for real-time interactions'),
    ('NORMAL', 'Standard update frequency for most entities'),
    ('BACKGROUND', 'Low-frequency updates for background processes');

-- Now create entity_sync_groups table and insert default values
CREATE TABLE entity.entity_sync_groups (
    sync_group TEXT PRIMARY KEY,
    server__tick__rate_ms INTEGER NOT NULL,
    server__tick__buffer INTEGER NOT NULL,
    network__interpolation_buffer_ms INTEGER NOT NULL,    -- How far behind to render for smoothing
    network__max_extrapolation_ms INTEGER NOT NULL,       -- Maximum prediction time
    network__jitter_threshold_ms INTEGER NOT NULL,        -- Maximum acceptable jitter
    general__created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    general__updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    general__created_by UUID DEFAULT auth.current_agent_id(),
    general__updated_by UUID DEFAULT auth.current_agent_id()
);

-- Insert default sync groups with their network and performance settings
INSERT INTO entity.entity_sync_groups (
    sync_group, 
    server__tick__rate_ms, 
    server__tick__buffer,
    network__interpolation_buffer_ms,
    network__max_extrapolation_ms,
    network__jitter_threshold_ms
) VALUES
    ('REALTIME', 16, 2, 50, 100, 25),    -- Tighter performance and network requirements for realtime
    ('NORMAL', 50, 1, 100, 150, 50),     -- Standard performance and network requirements
    ('BACKGROUND', 200, 1, 200, 300, 100); -- More relaxed performance and network requirements

-- Enable RLS
ALTER TABLE entity.entity_sync_groups ENABLE ROW LEVEL SECURITY;

-- Allow all users to view sync groups
CREATE POLICY "Allow viewing sync groups" ON entity.entity_sync_groups
    FOR SELECT
    USING (true);

-- Only allow admins to modify sync groups
CREATE POLICY "Allow admin sync group modifications" ON entity.entity_sync_groups
    FOR ALL
    USING (auth.is_admin_agent());

-- Function to prevent deletion of protected sync groups
CREATE OR REPLACE FUNCTION entity.protect_default_sync_groups()
RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM entity.protected_sync_groups
        WHERE sync_group = OLD.sync_group
    ) THEN
        RAISE EXCEPTION 'Cannot delete protected sync group: %', OLD.sync_group;
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Function to ensure protected sync groups always exist
CREATE OR REPLACE FUNCTION entity.ensure_protected_sync_groups()
RETURNS TRIGGER AS $$
BEGIN
    -- Insert any missing protected sync groups with default values
    INSERT INTO entity.entity_sync_groups (
        sync_group, 
        server__tick__rate_ms, 
        server__tick__buffer,
        network__interpolation_buffer_ms,
        network__max_extrapolation_ms,
        network__jitter_threshold_ms
    )
    SELECT 
        p.sync_group,
        CASE p.sync_group
            WHEN 'REALTIME' THEN 16
            WHEN 'NORMAL' THEN 50
            WHEN 'BACKGROUND' THEN 200
        END as server__tick__rate_ms,
        CASE p.sync_group
            WHEN 'REALTIME' THEN 2
            WHEN 'NORMAL' THEN 1
            WHEN 'BACKGROUND' THEN 1
        END as server__tick__buffer,
        CASE p.sync_group
            WHEN 'REALTIME' THEN 50
            WHEN 'NORMAL' THEN 100
            WHEN 'BACKGROUND' THEN 200
        END as network__interpolation_buffer_ms,
        CASE p.sync_group
            WHEN 'REALTIME' THEN 100
            WHEN 'NORMAL' THEN 150
            WHEN 'BACKGROUND' THEN 300
        END as network__max_extrapolation_ms,
        CASE p.sync_group
            WHEN 'REALTIME' THEN 25
            WHEN 'NORMAL' THEN 50
            WHEN 'BACKGROUND' THEN 100
        END as network__jitter_threshold_ms
    FROM entity.protected_sync_groups p
    WHERE NOT EXISTS (
        SELECT 1 FROM entity.entity_sync_groups e
        WHERE e.sync_group = p.sync_group
    );
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to prevent deletion of protected sync groups
CREATE TRIGGER protect_default_sync_groups
    BEFORE DELETE ON entity.entity_sync_groups
    FOR EACH ROW
    EXECUTE FUNCTION entity.protect_default_sync_groups();

-- Create trigger to ensure protected sync groups exist
CREATE TRIGGER ensure_protected_sync_groups
    AFTER INSERT OR UPDATE OR DELETE ON entity.entity_sync_groups
    FOR STATEMENT
    EXECUTE FUNCTION entity.ensure_protected_sync_groups();

-- 
-- ENTITIES
-- 

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
    validation__log JSONB DEFAULT '[]'::jsonb,
    performance__sync_group TEXT DEFAULT 'NORMAL' REFERENCES entity.entity_sync_groups(sync_group),
    permissions__roles__view TEXT[],
    permissions__roles__full TEXT[]
);

CREATE UNIQUE INDEX unique_seed_order_idx ON entity.entities(general__load_priority) WHERE general__load_priority IS NOT NULL;

-- Entities indexes
CREATE INDEX idx_entities_permissions__roles__view ON entity.entities USING GIN (permissions__roles__view);
CREATE INDEX idx_entities_permissions__roles__full ON entity.entities USING GIN (permissions__roles__full);
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
        OR EXISTS (
            SELECT 1 
            FROM auth.agent_roles ar
            WHERE ar.auth__agent_id = auth.current_agent_id()
            AND ar.auth__is_active = true
            AND (
                ar.auth__role_name = ANY(entity.entities.permissions__roles__view)
                OR ar.auth__role_name = ANY(entity.entities.permissions__roles__full)
            )
        )
    );

CREATE POLICY "entities_update_policy" ON entity.entities
    FOR UPDATE
    USING (
        auth.is_admin_agent()
        OR general__created_by = auth.current_agent_id()
        OR EXISTS (
            SELECT 1 
            FROM auth.agent_roles ar
            WHERE ar.auth__agent_id = auth.current_agent_id()
            AND ar.auth__is_active = true
            AND ar.auth__role_name = ANY(entity.entities.permissions__roles__full)
        )
    );

CREATE POLICY "entities_insert_policy" ON entity.entities
    FOR INSERT
    WITH CHECK (
        auth.is_admin_agent()
        OR EXISTS (
            SELECT 1 
            FROM auth.agent_roles ar
            JOIN auth.roles r ON r.auth__role_name = ar.auth__role_name
            WHERE ar.auth__agent_id = auth.current_agent_id()
            AND ar.auth__is_active = true
            AND r.auth__entity__insert = true
        )
    );

CREATE POLICY "entities_delete_policy" ON entity.entities
    FOR DELETE
    USING (
        auth.is_admin_agent()
        OR general__created_by = auth.current_agent_id()
        OR EXISTS (
            SELECT 1 
            FROM auth.agent_roles ar
            WHERE ar.auth__agent_id = auth.current_agent_id()
            AND ar.auth__is_active = true
            AND ar.auth__role_name = ANY(entity.entities.permissions__roles__full)
        )
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
