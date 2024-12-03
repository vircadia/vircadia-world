--
-- SEED SCRIPTS
--

CREATE TABLE seed_scripts (
    general__seed_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    general__script_id UUID NOT NULL REFERENCES entity_scripts(general__script_id) ON DELETE CASCADE,
    general__order INTEGER NOT NULL,
    general__is_active BOOLEAN DEFAULT true,
    general__created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    general__created_by UUID DEFAULT auth_uid(),
    general__updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(general__order, general__is_active)
);

-- Enable RLS
ALTER TABLE seed_scripts ENABLE ROW LEVEL SECURITY;

-- View policy - Allow viewing if user has proper role
DROP POLICY IF EXISTS "seed_scripts_view_policy" ON seed_scripts;
CREATE POLICY "seed_scripts_view_policy" ON seed_scripts
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 
            FROM agent_roles ar
            WHERE ar.auth__agent_id = auth_uid()
            AND ar.auth__is_active = true
        )
    );

-- Insert/Update/Delete policies - Only allow through functions
DROP POLICY IF EXISTS "seed_scripts_insert_policy" ON seed_scripts;
CREATE POLICY "seed_scripts_insert_policy" ON seed_scripts
    FOR INSERT
    WITH CHECK (current_setting('role') = 'rls_definer');

DROP POLICY IF EXISTS "seed_scripts_update_policy" ON seed_scripts;
CREATE POLICY "seed_scripts_update_policy" ON seed_scripts
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 
            FROM agent_roles ar
            JOIN roles r ON r.auth__role_name = ar.auth__role_name
            WHERE ar.auth__agent_id = auth_uid()
            AND ar.auth__is_active = true
            AND r.auth__is_system = true
        )
        OR current_setting('role') = 'rls_definer'
    );

DROP POLICY IF EXISTS "seed_scripts_delete_policy" ON seed_scripts;
CREATE POLICY "seed_scripts_delete_policy" ON seed_scripts
    FOR DELETE
    USING (current_setting('role') = 'rls_definer');

-- Indexes
CREATE INDEX idx_seed_scripts_order ON seed_scripts(general__order) WHERE general__is_active = true;
CREATE INDEX idx_seed_scripts_script_id ON seed_scripts(general__script_id);

