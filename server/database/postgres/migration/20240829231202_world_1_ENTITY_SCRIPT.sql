--
-- ENTITY SCRIPTS
--

-- Create enum for script compilation status
CREATE TYPE script_compilation_status AS ENUM ('PENDING', 'COMPILED', 'FAILED');

CREATE TABLE entity_scripts (
    general__script_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    general__created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    general__updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    general__created_by UUID DEFAULT auth_uid(),

    compiled__web__node__script TEXT,
    compiled__web__node__script_sha256 TEXT,
    compiled__web__node__script_status script_compilation_status,
    compiled__web__bun__script TEXT,
    compiled__web__bun__script_sha256 TEXT,
    compiled__web__bun__script_status script_compilation_status,
    compiled__web__browser__script TEXT,
    compiled__web__browser__script_sha256 TEXT,
    compiled__web__browser__script_status script_compilation_status,

    source__git__repo_entry_path TEXT,
    source__git__repo_url TEXT
) INHERITS (permissions);

-- Enable RLS
ALTER TABLE entity_scripts ENABLE ROW LEVEL SECURITY;

-- Create policy for viewing scripts
CREATE POLICY "Allow viewing scripts with proper role and IP" ON entity_scripts
    FOR SELECT
    USING (
        is_system_agent(current_setting('client.ip', TRUE)) AND
        (
            -- Check for script management role
            EXISTS (
                SELECT 1 FROM agent_roles ar
                JOIN roles r ON ar.auth__role_name = r.auth__role_name
                WHERE ar.auth__agent_id = auth_uid()
                AND ar.auth__is_active = true
                AND (r.auth__entity__script__can_insert = true OR r.auth__is_system = true)
            )
        ) OR (
            -- Check for view/full permission roles
            EXISTS (
                SELECT 1 FROM agent_roles ar
                WHERE ar.auth__agent_id = auth_uid()
                AND ar.auth__is_active = true
                AND ar.auth__role_name = ANY(permissions__roles__view || permissions__roles__full)
            )
        ) OR (
            -- Allow creator to view their own scripts
            general__created_by = auth_uid()
        )
    );

-- Create policy for inserting scripts
CREATE POLICY "Allow inserting scripts with proper role" ON entity_scripts
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM agent_roles ar
            JOIN roles r ON ar.auth__role_name = r.auth__role_name
            WHERE ar.auth__agent_id = auth_uid()
            AND ar.auth__is_active = true
            AND (r.auth__entity__script__can_insert = true OR r.auth__is_system = true)
        )
    );

-- Create policy for updating scripts
CREATE POLICY "Allow updating scripts with proper role" ON entity_scripts
    FOR UPDATE
    USING (
        (
            -- Check for script management role
            EXISTS (
                SELECT 1 FROM agent_roles ar
                JOIN roles r ON ar.auth__role_name = r.auth__role_name
                WHERE ar.auth__agent_id = auth_uid()
                AND ar.auth__is_active = true
                AND (r.auth__entity__script__can_insert = true OR r.auth__is_system = true)
            )
        ) OR (
            -- Check for full permission roles
            EXISTS (
                SELECT 1 FROM agent_roles ar
                WHERE ar.auth__agent_id = auth_uid()
                AND ar.auth__is_active = true
                AND ar.auth__role_name = ANY(permissions__roles__full)
            )
        ) OR (
            -- Allow creator to update their own scripts
            general__created_by = auth_uid()
        )
    );

-- Create policy for deleting scripts
CREATE POLICY "Allow deleting scripts with proper role" ON entity_scripts
    FOR DELETE
    USING (
        (
            -- Check for script management role
            EXISTS (
                SELECT 1 FROM agent_roles ar
                JOIN roles r ON ar.auth__role_name = r.auth__role_name
                WHERE ar.auth__agent_id = auth_uid()
                AND ar.auth__is_active = true
                AND (r.auth__entity__script__can_insert = true OR r.auth__is_system = true)
            )
        ) OR (
            -- Check for full permission roles
            EXISTS (
                SELECT 1 FROM agent_roles ar
                WHERE ar.auth__agent_id = auth_uid()
                AND ar.auth__is_active = true
                AND ar.auth__role_name = ANY(permissions__roles__full)
            )
        ) OR (
            -- Allow creator to delete their own scripts
            general__created_by = auth_uid()
        )
    );

-- Create trigger function to validate script IDs and clean up deleted ones
CREATE OR REPLACE FUNCTION validate_entity_scripts()
RETURNS TRIGGER AS $$
BEGIN
    -- Validate that all script IDs exist
    IF EXISTS (
        SELECT 1
        FROM unnest(NEW.scripts__ids) script_id
        WHERE NOT EXISTS (
            SELECT 1 FROM entity_scripts WHERE general__script_id = script_id
        )
    ) THEN
        RAISE EXCEPTION 'One or more script IDs do not exist in entity_scripts table';
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger function to clean up deleted script references
CREATE OR REPLACE FUNCTION cleanup_deleted_script_references()
RETURNS TRIGGER AS $$
BEGIN
    -- Remove the deleted script ID from all entities
    UPDATE entities
    SET scripts__ids = array_remove(scripts__ids, OLD.general__script_id)
    WHERE OLD.general__script_id = ANY(scripts__ids);
    
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Add trigger to validate script IDs when inserting/updating entities
CREATE TRIGGER validate_entity_scripts_trigger
    BEFORE INSERT OR UPDATE OF scripts__ids ON entities
    FOR EACH ROW
    EXECUTE FUNCTION validate_entity_scripts();

-- Add trigger to clean up references when a script is deleted
CREATE TRIGGER cleanup_script_references_trigger
    BEFORE DELETE ON entity_scripts
    FOR EACH ROW
    EXECUTE FUNCTION cleanup_deleted_script_references();

