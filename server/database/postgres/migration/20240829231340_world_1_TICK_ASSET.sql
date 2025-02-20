--
-- ENTITY ASSET AUDIT LOG
--

-- Create the asset audit log table
CREATE TABLE tick.asset_audit_log (
    general__asset_audit_id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
    general__asset_id uuid NOT NULL,
    group__sync TEXT NOT NULL REFERENCES auth.sync_groups(general__sync_group),
    operation operation_enum NOT NULL,
    operation_timestamp timestamptz DEFAULT clock_timestamp(),
    performed_by uuid DEFAULT auth.current_agent_id()
);

-- Indexes for efficient querying
CREATE INDEX idx_asset_audit_log_timestamp ON tick.asset_audit_log (group__sync, operation_timestamp DESC);
CREATE INDEX idx_asset_audit_log_asset_id ON tick.asset_audit_log (general__asset_id);

-- Enable Row-Level Security on the audit log table
ALTER TABLE tick.asset_audit_log ENABLE ROW LEVEL SECURITY;

-- RLS policies for secure access
CREATE POLICY "asset_audit_log_view_policy" ON tick.asset_audit_log
    FOR SELECT USING (
        auth.is_admin_agent()
        OR auth.is_system_agent()
        OR EXISTS (
            SELECT 1 
            FROM auth.active_sync_group_sessions sess 
            WHERE sess.auth__agent_id = auth.current_agent_id()
            AND sess.group__sync = tick.asset_audit_log.group__sync
        )
    );
    
CREATE POLICY "asset_audit_log_insert_policy" ON tick.asset_audit_log
    FOR INSERT WITH CHECK (auth.is_admin_agent());

CREATE POLICY "asset_audit_log_update_policy" ON tick.asset_audit_log
    FOR UPDATE USING (auth.is_admin_agent());

CREATE POLICY "asset_audit_log_delete_policy" ON tick.asset_audit_log
    FOR DELETE USING (auth.is_admin_agent());

-- Trigger function to log asset changes
CREATE OR REPLACE FUNCTION entity.log_asset_change()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO tick.asset_audit_log (
            general__asset_id,
            group__sync,
            operation
        ) VALUES (
            NEW.general__asset_id,
            NEW.group__sync,
            'INSERT'
        );
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO tick.asset_audit_log (
            general__asset_id,
            group__sync,
            operation
        ) VALUES (
            NEW.general__asset_id,
            NEW.group__sync,
            'UPDATE'
        );
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO tick.asset_audit_log (
            general__asset_id,
            group__sync,
            operation
        ) VALUES (
            OLD.general__asset_id,
            OLD.group__sync,
            'DELETE'
        );
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add trigger to entity_assets table to capture audits
CREATE TRIGGER log_asset_changes
    AFTER INSERT OR UPDATE OR DELETE ON entity.entity_assets
    FOR EACH ROW
    EXECUTE FUNCTION entity.log_asset_change();

-- 
-- ENTITY ASSETS TICK FUNCTIONS
-- 

-- Function to get CHANGED asset states between latest ticks
CREATE OR REPLACE FUNCTION tick.get_changed_asset_states_between_latest_ticks(
    p_sync_group text
) RETURNS TABLE (
    general__asset_id uuid,
    operation operation_enum,
    changes jsonb
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
    -- Get all changes from asset audit log
    WITH asset_changes AS (
        SELECT DISTINCT ON (aal.general__asset_id)
            aal.general__asset_id,
            aal.operation,
            aal.operation_timestamp,
            ea.general__created_at,
            ea.general__asset_name,
            ea.meta__data,
            ea.asset__data,
            ea.group__sync
        FROM tick.asset_audit_log aal
        LEFT JOIN entity.entity_assets ea ON aal.general__asset_id = ea.general__asset_id
        WHERE aal.group__sync = p_sync_group
          AND aal.operation_timestamp > v_previous_tick_time 
          AND aal.operation_timestamp <= v_latest_tick_time
        ORDER BY aal.general__asset_id, aal.operation_timestamp DESC
    )
    SELECT 
        ac.general__asset_id,
        ac.operation,
        CASE 
            WHEN ac.operation = 'DELETE' THEN NULL::jsonb
            ELSE jsonb_strip_nulls(jsonb_build_object(
                'general__asset_name', ac.general__asset_name,
                'meta__data', ac.meta__data,
                'asset__data', CASE WHEN ac.asset__data IS NOT NULL THEN encode(ac.asset__data, 'hex') ELSE NULL END,
                'group__sync', ac.group__sync
            ))
        END AS changes
    FROM asset_changes ac;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;