-- 
-- ENTITY SCRIPTS
-- 

-- Create script audit log table
CREATE TABLE tick.script_audit_log (
    general__asset_audit_id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
    general__script_id uuid NOT NULL,
    group__sync text NOT NULL
        REFERENCES auth.sync_groups(general__sync_group),
    operation operation_enum NOT NULL,
    operation_timestamp timestamptz DEFAULT clock_timestamp(),
    performed_by uuid DEFAULT auth.current_agent_id()
);

-- Add indexes for efficient querying
CREATE INDEX idx_script_audit_log_timestamp 
    ON tick.script_audit_log (group__sync, operation_timestamp DESC);
CREATE INDEX idx_script_audit_log_script_id
    ON tick.script_audit_log (general__script_id);

-- Enable RLS
ALTER TABLE tick.script_audit_log ENABLE ROW LEVEL SECURITY;

-- Add RLS policies (system only)
CREATE POLICY "script_audit_log_view_policy" ON tick.script_audit_log
    FOR SELECT USING (auth.is_admin_agent());

CREATE POLICY "script_audit_log_insert_policy" ON tick.script_audit_log
    FOR INSERT
    WITH CHECK (auth.is_admin_agent());

CREATE POLICY "script_audit_log_update_policy" ON tick.script_audit_log
    FOR UPDATE
    USING (auth.is_admin_agent());

CREATE POLICY "script_audit_log_delete_policy" ON tick.script_audit_log
    FOR DELETE
    USING (auth.is_admin_agent());
    
-- Trigger function to log script changes
CREATE OR REPLACE FUNCTION tick.log_script_change()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO tick.script_audit_log (
            general__script_id,
            group__sync,
            operation
        ) VALUES (
            NEW.general__script_id,
            NEW.group__sync,
            'INSERT'
        );
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO tick.script_audit_log (
            general__script_id,
            group__sync,
            operation
        ) VALUES (
            NEW.general__script_id,
            NEW.group__sync,
            'UPDATE'
        );
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO tick.script_audit_log (
            general__script_id,
            group__sync,
            operation
        ) VALUES (
            OLD.general__script_id,
            OLD.group__sync,
            'DELETE'
        );
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add triggers to entity.entity_scripts
CREATE TRIGGER log_script_changes
    AFTER INSERT OR UPDATE OR DELETE ON entity.entity_scripts
    FOR EACH ROW
    EXECUTE FUNCTION tick.log_script_change();

-- Cleanup function for audit logs
CREATE OR REPLACE FUNCTION tick.cleanup_old_script_audit_logs() 
RETURNS void AS $$
BEGIN
    DELETE FROM tick.script_audit_log sal
    WHERE EXISTS (
        SELECT 1 
        FROM auth.sync_groups sg
        WHERE sg.general__sync_group = sal.group__sync
        AND sal.operation_timestamp < (
            NOW() - ((sg.server__tick__buffer * sg.server__tick__rate_ms) || ' milliseconds')::interval
        )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 
-- ENTITY SCRIPTS TICK FUNCTIONS
-- 

-- Function to get CHANGED script states between latest tick (modified to use entity.entity_scripts)
CREATE OR REPLACE FUNCTION tick.get_changed_script_states_between_latest_ticks(
    p_sync_group text
) RETURNS TABLE (
    script_id uuid,
    operation operation_enum,
    changes jsonb,
    sync_group_session_ids uuid[]
) AS $$
DECLARE
    v_latest_tick_time timestamptz;
    v_previous_tick_time timestamptz;
BEGIN
    -- Get the latest two tick timestamps
    SELECT 
        tick__start_time,
        LAG(tick__start_time) OVER (ORDER BY tick__number DESC)
    INTO v_latest_tick_time, v_previous_tick_time
    FROM tick.world_ticks
    WHERE group__sync = p_sync_group
    ORDER BY tick__number DESC
    LIMIT 2;

    RETURN QUERY
    -- Get all changes from audit log
    WITH script_changes AS (
        SELECT DISTINCT ON (sa.general__script_id)
            sa.general__script_id,
            sa.operation,
            sa.operation_timestamp,
            es.general__created_at,
            es.*
        FROM audit.script_audit_log sa
        LEFT JOIN entity.entity_scripts es ON sa.general__script_id = es.general__script_id
        WHERE sa.group__sync = p_sync_group
        AND sa.operation_timestamp > v_previous_tick_time 
        AND sa.operation_timestamp <= v_latest_tick_time
        ORDER BY sa.general__script_id, sa.operation_timestamp DESC
    )
    SELECT 
        sc.general__script_id,
        sc.operation,
        CASE 
            WHEN sc.operation = 'DELETE' THEN NULL::jsonb
            ELSE jsonb_strip_nulls(jsonb_build_object(
                'general__script_name', sc.general__script_name,
                'source__repo__entry_path', sc.source__repo__entry_path,
                'source__repo__url', sc.source__repo__url,
                'compiled__node__script', sc.compiled__node__script,
                'compiled__node__script_sha256', sc.compiled__node__script_sha256,
                'compiled__node__status', sc.compiled__node__status,
                'compiled__node__updated_at', sc.compiled__node__updated_at,
                'compiled__bun__script', sc.compiled__bun__script,
                'compiled__bun__script_sha256', sc.compiled__bun__sha256,
                'compiled__bun__status', sc.compiled__bun__status,
                'compiled__bun__updated_at', sc.compiled__bun__updated_at,
                'compiled__browser__script', sc.compiled__browser__script,
                'compiled__browser__script_sha256', sc.compiled__browser__script_sha256,
                'compiled__browser__status', sc.compiled__browser__status,
                'compiled__browser__updated_at', sc.compiled__browser__updated_at,
                'group__sync', sc.group__sync
            ))
        END as changes,
        coalesce(auth.get_sync_group_session_ids(p_sync_group), '{}') as sync_group_session_ids
    FROM script_changes sc;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
