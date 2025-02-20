--
-- ENTITY SCRIPTS
--

-- ============================================================================ 
-- 1. ENTITY SCRIPTS TABLE
-- ============================================================================ 

CREATE TABLE entity.entity_scripts (
    general__script_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    general__script_name TEXT NOT NULL DEFAULT 'UNNAMED',
    group__sync TEXT NOT NULL REFERENCES auth.sync_groups(general__sync_group) DEFAULT 'public.NORMAL',
    
    -- Source fields
    source__repo__entry_path TEXT,
    source__repo__url TEXT,
    
    -- Node platform
    compiled__node__script TEXT,
    compiled__node__script_sha256 TEXT,
    compiled__node__status script_compilation_status_enum NOT NULL DEFAULT 'PENDING',
    compiled__node__updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    
    -- Bun platform
    compiled__bun__script TEXT,
    compiled__bun__script_sha256 TEXT,
    compiled__bun__status script_compilation_status_enum NOT NULL DEFAULT 'PENDING',
    compiled__bun__updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    
    -- Browser platform
    compiled__browser__script TEXT,
    compiled__browser__script_sha256 TEXT,
    compiled__browser__status script_compilation_status_enum NOT NULL DEFAULT 'PENDING',
    compiled__browser__updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_entity_scripts_sync_group FOREIGN KEY (group__sync) REFERENCES auth.sync_groups(general__sync_group)
) INHERITS (entity._template);

ALTER TABLE entity.entity_scripts ENABLE ROW LEVEL SECURITY;

-- ============================================================================ 
-- 2. ENTITY SCRIPTS POLICIES
-- ============================================================================ 

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

-- ============================================================================ 
-- 3. ENTITY SCRIPTS FUNCTIONS
-- ============================================================================ 

CREATE OR REPLACE FUNCTION entity.cleanup_stalled_compilations()
RETURNS trigger AS $$
DECLARE
    timeout_ms INTEGER;
BEGIN
    SELECT entity_config__script_compilation_timeout_ms
    INTO timeout_ms
    FROM config.entity_config;

    -- Check if this compilation has stalled
    IF NEW.compiled__node__status = 'COMPILING' 
       AND NEW.compiled__node__updated_at < (NOW() - (timeout_ms || ' milliseconds')::interval) THEN
        NEW.compiled__node__status := 'FAILED';
        NEW.compiled__bun__status := 'FAILED';
        NEW.compiled__browser__status := 'FAILED';
        NEW.compiled__node__updated_at := NULL;
        NEW.compiled__bun__updated_at := NULL;
        NEW.compiled__browser__updated_at := NULL;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================ 
-- 4. ENTITY SCRIPTS TRIGGERS
-- ============================================================================ 

-- Update audit columns trigger
CREATE TRIGGER update_audit_columns
    BEFORE UPDATE ON entity.entity_scripts
    FOR EACH ROW
    EXECUTE FUNCTION entity.update_audit_columns();

-- Trigger to cleanup stalled compilations
CREATE TRIGGER cleanup_stalled_compilations_trigger
    BEFORE UPDATE OF compiled__node__status, compiled__node__updated_at ON entity.entity_scripts
    FOR EACH ROW
    EXECUTE FUNCTION entity.cleanup_stalled_compilations();
