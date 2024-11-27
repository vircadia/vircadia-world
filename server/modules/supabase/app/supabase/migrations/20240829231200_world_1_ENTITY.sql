--
-- ENTITIES AND CAPABILITIES
--

CREATE TABLE entities (
    general__uuid UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    general__name VARCHAR(255) NOT NULL,
    general__semantic_version TEXT NOT NULL DEFAULT '1.0.0',
    general__created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    general__created_by UUID DEFAULT auth.uid(),
    general__updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    general__permissions__roles__view TEXT[],
    general__permissions__roles__full TEXT[],

    type__babylonjs TEXT NOT NULL
);

CREATE TABLE entities_metadata (
    general__metadata_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    general__entity_id UUID NOT NULL REFERENCES entities(general__uuid) ON DELETE CASCADE,
    key__name TEXT NOT NULL,
    values__text TEXT[],
    values__numeric NUMERIC[],
    values__boolean BOOLEAN[],
    values__timestamp TIMESTAMPTZ[],
    general__created_at TIMESTAMPTZ DEFAULT NOW(),
    general__created_by UUID DEFAULT auth.uid(),
    general__updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (general__entity_id, key__name)
);

--
-- ENTITY SCRIPTS
--

CREATE TABLE entity_scripts (
    general__entity_id UUID NOT NULL REFERENCES entities(general__uuid) ON DELETE CASCADE,
    general__script_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    web__compiled__node__script TEXT,
    web__compiled__node__script_sha256 TEXT,
    web__compiled__node__script_status TEXT,
    web__compiled__bun__script TEXT,
    web__compiled__bun__script_sha256 TEXT,
    web__compiled__bun__script_status TEXT,
    web__compiled__browser__script TEXT,
    web__compiled__browser__script_sha256 TEXT,
    web__compiled__browser__script_status TEXT,
    source__git__repo_entry_path TEXT,
    source__git__repo_url TEXT,
    general__created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    general__updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP

    CONSTRAINT check_script_compilation_status CHECK (
        (web__compiled__node__script_status IS NULL OR 
         web__compiled__node__script_status IN ('PENDING', 'COMPILED', 'FAILED')) AND
        (web__compiled__bun__script_status IS NULL OR 
         web__compiled__bun__script_status IN ('PENDING', 'COMPILED', 'FAILED')) AND
        (web__compiled__browser__script_status IS NULL OR 
         web__compiled__browser__script_status IN ('PENDING', 'COMPILED', 'FAILED'))
    )
);

--
-- INDEXES
--

CREATE INDEX idx_entities_general__permissions__roles__view ON entities USING GIN (general__permissions__roles__view);
CREATE INDEX idx_entities_general__permissions__roles__full ON entities USING GIN (general__permissions__roles__full);
CREATE INDEX idx_entities_created_at ON entities(general__created_at);
CREATE INDEX idx_entities_updated_at ON entities(general__updated_at);
CREATE INDEX idx_entities_semantic_version ON entities(general__semantic_version);
CREATE INDEX idx_entities_type_babylonjs ON entities(type__babylonjs);

-- Enable RLS on entities table
ALTER TABLE entities ENABLE ROW LEVEL SECURITY;

-- View policy - Allow viewing if user has proper role OR is the creator
DROP POLICY IF EXISTS "entities_view_policy" ON entities;
CREATE POLICY "entities_view_policy" ON entities
    FOR SELECT
    USING (
        general__created_by = auth.uid()
        OR EXISTS (
            SELECT 1 
            FROM agent_roles ar
            WHERE ar.auth__agent_id = auth.uid()
            AND ar.auth__is_active = true
            AND (
                ar.auth__role_name = ANY(entities.general__permissions__roles__view)
                OR ar.auth__role_name = ANY(entities.general__permissions__roles__full)
            )
        )
    );

-- Update policy - Allow updates if user has full permissions OR is the creator
DROP POLICY IF EXISTS "entities_update_policy" ON entities;
CREATE POLICY "entities_update_policy" ON entities
    FOR UPDATE
    USING (
        current_setting('role') = 'rls_definer'
        AND (
            general__created_by = auth.uid()
            OR EXISTS (
                SELECT 1 
                FROM agent_roles ar
                WHERE ar.auth__agent_id = auth.uid()
                AND ar.auth__is_active = true
                AND ar.auth__role_name = ANY(entities.general__permissions__roles__full)
            )
        )
    );

-- Insert policy - Only through functions AND with proper role
DROP POLICY IF EXISTS "entities_insert_policy" ON entities;
CREATE POLICY "entities_insert_policy" ON entities
    FOR INSERT
    WITH CHECK (
        current_setting('role') = 'rls_definer'
        AND EXISTS (
            SELECT 1 
            FROM agent_roles ar
            JOIN roles r ON r.auth__role_name = ar.auth__role_name
            WHERE ar.auth__agent_id = auth.uid()
            AND ar.auth__is_active = true
            AND r.auth__is_active = true
            AND r.auth__can_insert = true
        )
    );

-- Delete policy - Allow deletion if user has full permissions OR is the creator
DROP POLICY IF EXISTS "entities_delete_policy" ON entities;
CREATE POLICY "entities_delete_policy" ON entities
    FOR DELETE
    USING (
        current_setting('role') = 'rls_definer'
        AND (
            general__created_by = auth.uid()
            OR EXISTS (
                SELECT 1 
                FROM agent_roles ar
                WHERE ar.auth__agent_id = auth.uid()
                AND ar.auth__is_active = true
                AND ar.auth__role_name = ANY(entities.general__permissions__roles__full)
            )
        )
    );

-- Trigger function to enforce foreign key constraint on array elements
CREATE OR REPLACE FUNCTION check_entity_permissions_roles()
RETURNS TRIGGER AS $$
BEGIN
    -- Check each role in the permissions__can_view_roles array
    PERFORM 1
    FROM unnest(NEW.permissions__can_view_roles) AS role
    WHERE NOT EXISTS (
        SELECT 1 FROM roles WHERE role_name = role
    );

    IF FOUND THEN
        RAISE EXCEPTION 'Role not found in roles table';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for entities table
CREATE TRIGGER enforce_entities_permissions_roles
BEFORE INSERT OR UPDATE ON entities
FOR EACH ROW EXECUTE FUNCTION check_entity_permissions_roles();

-- Trigger for entity_scripts table
CREATE TRIGGER enforce_entity_scripts_permissions_roles
BEFORE INSERT OR UPDATE ON entity_scripts
FOR EACH ROW EXECUTE FUNCTION check_entity_permissions_roles();

-- Enable RLS on entities_metadata table
ALTER TABLE entities_metadata ENABLE ROW LEVEL SECURITY;

-- View policy for entities_metadata - Allow if user has proper role OR is the creator of the parent entity
DROP POLICY IF EXISTS "entities_metadata_view_policy" ON entities_metadata;
CREATE POLICY "entities_metadata_view_policy" ON entities_metadata
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 
            FROM entities e
            WHERE e.general__uuid = entities_metadata.general__entity_id
            AND (
                e.general__created_by = auth.uid()
                OR EXISTS (
                    SELECT 1
                    FROM agent_roles ar
                    WHERE ar.auth__agent_id = auth.uid()
                    AND ar.auth__is_active = true
                    AND (
                        ar.auth__role_name = ANY(e.general__permissions__roles__view)
                        OR ar.auth__role_name = ANY(e.general__permissions__roles__full)
                    )
                )
            )
        )
    );

-- Update policy for entities_metadata - Allow if user has full permissions OR is the creator
DROP POLICY IF EXISTS "entities_metadata_update_policy" ON entities_metadata;
CREATE POLICY "entities_metadata_update_policy" ON entities_metadata
    FOR UPDATE
    USING (
        current_setting('role') = 'rls_definer'
        AND EXISTS (
            SELECT 1 
            FROM entities e
            WHERE e.general__uuid = entities_metadata.general__entity_id
            AND (
                e.general__created_by = auth.uid()
                OR EXISTS (
                    SELECT 1
                    FROM agent_roles ar
                    WHERE ar.auth__agent_id = auth.uid()
                    AND ar.auth__is_active = true
                    AND ar.auth__role_name = ANY(e.general__permissions__roles__full)
                )
            )
        )
    );

DROP POLICY IF EXISTS "entities_metadata_insert_policy" ON entities_metadata;
CREATE POLICY "entities_metadata_insert_policy" ON entities_metadata
    FOR INSERT
    WITH CHECK (
        current_setting('role') = 'rls_definer'
    );

-- Delete policy for entities_metadata - Allow if user has full permissions OR is the creator
DROP POLICY IF EXISTS "entities_metadata_delete_policy" ON entities_metadata;
CREATE POLICY "entities_metadata_delete_policy" ON entities_metadata
    FOR DELETE
    USING (
        current_setting('role') = 'rls_definer'
        AND EXISTS (
            SELECT 1 
            FROM entities e
            WHERE e.general__uuid = entities_metadata.general__entity_id
            AND (
                e.general__created_by = auth.uid()
                OR EXISTS (
                    SELECT 1
                    FROM agent_roles ar
                    WHERE ar.auth__agent_id = auth.uid()
                    AND ar.auth__is_active = true
                    AND ar.auth__role_name = ANY(e.general__permissions__roles__full)
                )
            )
        )
    );

-- Add index for faster metadata lookups by key__name and general__entity_id
CREATE INDEX idx_entities_key__name_entity ON entities_metadata(key__name, general__entity_id);

