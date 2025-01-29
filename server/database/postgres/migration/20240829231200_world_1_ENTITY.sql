-- TODO: We need to make it so notifications are tracked by number or ID or date, or SOMETHING so client can track its own reflected notifications and also so we can do appropriate client-server lag compensation in tandem with tick (validate this method with AI)

-- Create entity schema
CREATE SCHEMA IF NOT EXISTS entity;

-- 
-- PERMISSIONS
--

CREATE TABLE entity.permissions (
    permissions__roles__view TEXT[],
    permissions__roles__full TEXT[]
);

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

    compiled__web__node__script TEXT,
    compiled__web__node__script_sha256 TEXT,
    compiled__web__node__script_status script_compilation_status NOT NULL DEFAULT 'PENDING',
    compiled__web__bun__script TEXT,
    compiled__web__bun__script_sha256 TEXT,
    compiled__web__bun__script_status script_compilation_status NOT NULL DEFAULT 'PENDING',
    compiled__web__browser__script TEXT,
    compiled__web__browser__script_sha256 TEXT,
    compiled__web__browser__script_status script_compilation_status NOT NULL DEFAULT 'PENDING',

    source__git__repo_entry_path TEXT,
    source__git__repo_url TEXT
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
    performance__sync_group TEXT DEFAULT 'NORMAL' NOT NULL
) INHERITS (entity.permissions);

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

-- 
-- NOTIFICATION FUNCTIONS
--

-- Shared notification function to reduce code duplication
CREATE OR REPLACE FUNCTION entity.get_changed_columns() RETURNS TEXT[] AS $$
DECLARE
    old_rec RECORD;
    new_rec RECORD;
    col_name TEXT;
    changed_cols TEXT[] := '{}';
    changed BOOLEAN;
BEGIN
    old_rec := OLD;
    new_rec := NEW;
    
    FOR col_name IN (SELECT column_name 
                    FROM information_schema.columns 
                    WHERE table_schema = TG_TABLE_SCHEMA 
                    AND table_name = TG_TABLE_NAME) 
    LOOP
        IF old_rec IS NULL OR new_rec IS NULL OR 
           old_rec.* IS DISTINCT FROM new_rec.* THEN
            -- For INSERT/DELETE, include all columns
            changed_cols := array_append(changed_cols, col_name);
        ELSIF old_rec IS NOT NULL AND new_rec IS NOT NULL THEN
            -- For UPDATE, check each column
            EXECUTE format('SELECT ($1).%I IS DISTINCT FROM ($2).%I', 
                         col_name, col_name)
            INTO STRICT changed
            USING old_rec, new_rec;
            
            IF changed THEN
                changed_cols := array_append(changed_cols, col_name);
            END IF;
        END IF;
    END LOOP;
    
    RETURN changed_cols;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION entity.send_change_notification(
    notification_type TEXT,
    record_id UUID,
    operation TEXT,
    sync_group TEXT DEFAULT NULL,
    changed_columns TEXT[] DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
    notification_payload JSONB;

    session_record RECORD;
BEGIN
    -- Build notification payload with all possible fields
    notification_payload := jsonb_build_object(
        'type', notification_type,
        'id', record_id,
        'operation', operation,
        'timestamp', CURRENT_TIMESTAMP,
        'sync_group', sync_group,
        'changed_columns', changed_columns
    );

    -- Notify all active sessions
    FOR session_record IN 
        SELECT general__session_id
        FROM auth.agent_sessions 
        WHERE session__is_active = true
    LOOP
        -- Send notification
        PERFORM pg_notify(
            session_record.general__session_id::text,
            notification_payload::text
        );

        -- Update session metadata
        UPDATE auth.agent_sessions
        SET 
            stats__last_subscription_message = notification_payload,
            stats__last_subscription_message_at = CURRENT_TIMESTAMP,
            session__last_seen_at = CURRENT_TIMESTAMP
        WHERE general__session_id = session_record.general__session_id;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Update entity changes notification
CREATE OR REPLACE FUNCTION entity.notify_entity_changes() RETURNS TRIGGER AS $$
DECLARE
    changed_cols TEXT[];
BEGIN
    IF TG_OP = 'UPDATE' THEN
        changed_cols := entity.get_changed_columns();
    END IF;

    PERFORM entity.send_change_notification(
        'entity',
        CASE WHEN TG_OP = 'DELETE' THEN OLD.general__entity_id ELSE NEW.general__entity_id END,
        TG_OP,
        CASE WHEN TG_OP = 'DELETE' THEN OLD.performance__sync_group ELSE NEW.performance__sync_group END,
        changed_cols
    );
    
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

-- Update script changes notification
CREATE OR REPLACE FUNCTION entity.notify_entity_script_changes() RETURNS TRIGGER AS $$
DECLARE
    changed_cols TEXT[];
BEGIN
    IF TG_OP = 'UPDATE' THEN
        changed_cols := entity.get_changed_columns();
    END IF;

    PERFORM entity.send_change_notification(
        'entity_script',
        CASE WHEN TG_OP = 'DELETE' THEN OLD.general__script_id ELSE NEW.general__script_id END,
        TG_OP,
        NULL,
        changed_cols
    );
    
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for notifications
CREATE TRIGGER entity_changes_notify
    AFTER INSERT OR UPDATE OR DELETE ON entity.entities
    FOR EACH ROW
    EXECUTE FUNCTION entity.notify_entity_changes();

CREATE OR REPLACE TRIGGER entity_script_changes_notify
    AFTER INSERT OR UPDATE OR DELETE ON entity.entity_scripts
    FOR EACH ROW
    EXECUTE FUNCTION entity.notify_entity_script_changes();

-- Grand replication / listen / notify perms

-- Grant schema permissions for notifications (not replication)
GRANT USAGE ON SCHEMA entity TO PUBLIC;
GRANT SELECT ON ALL TABLES IN SCHEMA entity TO PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA entity 
    GRANT SELECT ON TABLES TO PUBLIC;

-- Create publication only for entity_scripts table
CREATE PUBLICATION entity_scripts_pub FOR TABLE entity.entity_scripts;
