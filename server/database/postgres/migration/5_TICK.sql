-- ============================================================================
-- 1. SCHEMA CREATION AND INITIAL PERMISSIONS
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS tick;

-- Initial revocations (we'll grant specific permissions at the end)
REVOKE ALL ON SCHEMA tick FROM PUBLIC, vircadia_agent_proxy;
GRANT USAGE ON SCHEMA tick TO vircadia_agent_proxy;

-- ============================================================================
-- 2. BASE TABLES
-- ============================================================================

-- 2.1 WORLD TICKS TABLE
CREATE TABLE tick.world_ticks (
    general__tick_id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
    tick__number bigint NOT NULL,
    group__sync TEXT NOT NULL REFERENCES auth.sync_groups(general__sync_group),
    tick__start_time timestamptz NOT NULL,
    tick__end_time timestamptz NOT NULL,
    tick__duration_ms double precision NOT NULL,
    tick__entity_states_processed int NOT NULL,
    tick__script_states_processed int NOT NULL,
    tick__asset_states_processed int NOT NULL,
    tick__is_delayed boolean NOT NULL,
    tick__headroom_ms double precision,
    tick__time_since_last_tick_ms double precision,
    
    -- Add unique constraint for sync_group + tick number combination
    UNIQUE (group__sync, tick__number)
);

-- 2.2 ENTITY STATES TABLE
CREATE TABLE tick.entity_states (
    LIKE entity.entities INCLUDING DEFAULTS EXCLUDING CONSTRAINTS,

    -- Additional metadata for state tracking
    general__tick_id uuid NOT NULL,
    general__entity_state_id uuid DEFAULT uuid_generate_v4(),

    -- Override the primary key to allow multiple states per entity
    CONSTRAINT entity_states_pkey PRIMARY KEY (general__entity_state_id),

    -- Add foreign key constraint for sync_group
    CONSTRAINT entity_states_sync_group_fkey FOREIGN KEY (group__sync) 
        REFERENCES auth.sync_groups(general__sync_group),

    -- Add foreign key constraint to world_ticks with cascade delete
    CONSTRAINT entity_states_tick_fkey FOREIGN KEY (general__tick_id)
        REFERENCES tick.world_ticks(general__tick_id) ON DELETE CASCADE
);

-- 2.3 SCRIPT AUDIT LOG TABLE
CREATE TABLE tick.script_audit_log (
    general__asset_audit_id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
    general__script_id uuid NOT NULL,
    group__sync text NOT NULL
        REFERENCES auth.sync_groups(general__sync_group),
    operation config.operation_enum NOT NULL,
    operation_timestamp timestamptz DEFAULT clock_timestamp(),
    performed_by uuid DEFAULT auth.current_agent_id()
);

-- 2.4 ASSET AUDIT LOG TABLE
CREATE TABLE tick.asset_audit_log (
    general__asset_audit_id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
    general__asset_id uuid NOT NULL,
    group__sync TEXT NOT NULL REFERENCES auth.sync_groups(general__sync_group),
    operation config.operation_enum NOT NULL,
    operation_timestamp timestamptz DEFAULT clock_timestamp(),
    performed_by uuid DEFAULT auth.current_agent_id()
);

-- ============================================================================
-- 3. INDEXES
-- ============================================================================

-- 3.1 WORLD TICKS INDEXES
CREATE INDEX idx_world_ticks_sync_number ON tick.world_ticks (group__sync, tick__number DESC);
CREATE INDEX idx_world_ticks_sync_time ON tick.world_ticks (group__sync, tick__start_time DESC);

-- 3.2 ENTITY STATES INDEXES
CREATE INDEX entity_states_lookup_idx ON tick.entity_states (general__entity_id, general__tick_id);
CREATE INDEX entity_states_tick_idx ON tick.entity_states (general__tick_id);
CREATE INDEX entity_states_sync_group_tick_idx ON tick.entity_states (group__sync, general__tick_id DESC);
CREATE INDEX idx_entity_states_sync_tick_lookup ON tick.entity_states (group__sync, general__tick_id, general__entity_id);
CREATE INDEX idx_entity_states_sync_tick ON tick.entity_states (group__sync, general__tick_id);

-- 3.3 SCRIPT AUDIT LOG INDEXES
CREATE INDEX idx_script_audit_log_timestamp 
    ON tick.script_audit_log (group__sync, operation_timestamp DESC);
CREATE INDEX idx_script_audit_log_script_id
    ON tick.script_audit_log (general__script_id);

-- 3.4 ASSET AUDIT LOG INDEXES
CREATE INDEX idx_asset_audit_log_timestamp 
    ON tick.asset_audit_log (group__sync, operation_timestamp DESC);
CREATE INDEX idx_asset_audit_log_asset_id 
    ON tick.asset_audit_log (general__asset_id);

-- ============================================================================
-- 4. FUNCTIONS
-- ============================================================================

-- 4.1 TICK CAPTURE FUNCTIONS
CREATE OR REPLACE FUNCTION tick.capture_tick_state(
    p_sync_group text
) RETURNS TABLE (
    general__tick_id uuid,
    tick__number bigint,
    group__sync text,
    tick__start_time timestamptz,
    tick__end_time timestamptz,
    tick__duration_ms double precision,
    tick__entity_states_processed int,
    tick__script_states_processed int,
    tick__asset_states_processed int,
    tick__is_delayed boolean,
    tick__headroom_ms double precision,
    tick__time_since_last_tick_ms double precision
) AS $$
DECLARE
    v_start_time timestamptz;
    v_last_tick_time timestamptz;
    v_tick_number bigint;
    v_entity_states_processed int;
    v_script_states_processed int;
    v_asset_states_processed int;
    v_end_time timestamptz;
    v_duration_ms double precision;
    v_headroom_ms double precision;
    v_is_delayed boolean;
    v_time_since_last_tick_ms double precision;
    v_tick_id uuid;
    v_buffer_duration_ms integer;
BEGIN
    -- Acquire lock & initialize timing variables
    LOCK TABLE tick.world_ticks IN SHARE ROW EXCLUSIVE MODE;
    v_start_time := clock_timestamp();

    -- Get buffer duration from sync group config
    SELECT server__tick__max_ticks_buffer * server__tick__rate_ms 
    INTO v_buffer_duration_ms
    FROM auth.sync_groups
    WHERE general__sync_group = p_sync_group;

    -- Cleanup old ticks
    DELETE FROM tick.world_ticks wt
    WHERE wt.group__sync = p_sync_group
      AND wt.tick__start_time < (v_start_time - (v_buffer_duration_ms || ' milliseconds')::interval);

    -- Get last tick information (for tick number & metrics)
    SELECT 
        wt.tick__start_time,
        wt.tick__number
    INTO 
        v_last_tick_time,
        v_tick_number
    FROM tick.world_ticks wt
    WHERE wt.group__sync = p_sync_group
    ORDER BY wt.tick__number DESC
    LIMIT 1
    FOR UPDATE;

    IF v_tick_number IS NULL THEN
        v_tick_number := 1;
    ELSE
        v_tick_number := v_tick_number + 1;
    END IF;

    IF v_last_tick_time IS NOT NULL THEN
        v_time_since_last_tick_ms := EXTRACT(EPOCH FROM (v_start_time - v_last_tick_time)) * 1000;
    END IF;

    -- Insert new tick record (initial)
    v_tick_id := uuid_generate_v4();
    INSERT INTO tick.world_ticks (
        general__tick_id,
        tick__number,
        group__sync,
        tick__start_time,
        tick__end_time,
        tick__duration_ms,
        tick__entity_states_processed,
        tick__script_states_processed,
        tick__asset_states_processed,
        tick__is_delayed,
        tick__headroom_ms,
        tick__time_since_last_tick_ms
    ) VALUES (
        v_tick_id,
        v_tick_number,
        p_sync_group,
        v_start_time,
        clock_timestamp(),
        0,
        0,
        0,
        0,
        false,
        0,
        v_time_since_last_tick_ms
    );

    -- Capture entity states
    WITH entity_snapshot AS (
        INSERT INTO tick.entity_states (
            general__entity_id,
            general__entity_name,
            general__semantic_version,
            general__load_priority,
            general__initialized_at,
            general__initialized_by,
            meta__data,
            scripts__ids,
            scripts__status,
            assets__ids,
            validation__log,
            group__sync,
            general__created_at,
            general__created_by,
            general__updated_at,
            general__updated_by,
            general__tick_id
        )
        SELECT 
            e.general__entity_id,
            e.general__entity_name,
            e.general__semantic_version,
            e.general__load_priority,
            e.general__initialized_at,
            e.general__initialized_by,
            e.meta__data,
            e.scripts__ids,
            e.scripts__status,
            e.assets__ids,
            e.validation__log,
            e.group__sync,
            e.general__created_at,
            e.general__created_by,
            e.general__updated_at,
            e.general__updated_by,
            v_tick_id
        FROM entity.entities e
        WHERE e.group__sync = p_sync_group
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_entity_states_processed FROM entity_snapshot;

    -- Process script & asset state metrics
    SELECT COUNT(DISTINCT sa.general__script_id)
    INTO v_script_states_processed
    FROM tick.script_audit_log sa
    WHERE sa.group__sync = p_sync_group
      AND sa.operation_timestamp > v_last_tick_time 
      AND sa.operation_timestamp <= v_start_time;

    SELECT COUNT(DISTINCT aa.general__asset_id)
    INTO v_asset_states_processed
    FROM tick.asset_audit_log aa
    WHERE aa.group__sync = p_sync_group
      AND aa.operation_timestamp > v_last_tick_time
      AND aa.operation_timestamp <= v_start_time;

    -- Calculate tick duration, delay & headroom, then update tick record
    v_end_time := clock_timestamp();
    v_duration_ms := EXTRACT(EPOCH FROM (v_end_time - v_start_time)) * 1000;

    SELECT 
        v_duration_ms > sg.server__tick__rate_ms AS is_delayed,
        sg.server__tick__rate_ms - v_duration_ms AS headroom_ms
    INTO v_is_delayed, v_headroom_ms
    FROM auth.sync_groups sg
    WHERE sg.general__sync_group = p_sync_group;

    UPDATE tick.world_ticks wt
    SET 
        tick__end_time = v_end_time,
        tick__duration_ms = v_duration_ms,
        tick__entity_states_processed = v_entity_states_processed,
        tick__script_states_processed = v_script_states_processed,
        tick__asset_states_processed = v_asset_states_processed,
        tick__is_delayed = v_is_delayed,
        tick__headroom_ms = v_headroom_ms
    WHERE wt.general__tick_id = v_tick_id;

    -- Return the captured tick record
    RETURN QUERY
    SELECT
        v_tick_id,
        v_tick_number,
        p_sync_group,
        v_start_time,
        v_end_time,
        v_duration_ms,
        v_entity_states_processed,
        v_script_states_processed,
        v_asset_states_processed,
        v_is_delayed,
        v_headroom_ms,
        v_time_since_last_tick_ms;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4.2 ENTITY STATE FUNCTIONS
CREATE OR REPLACE FUNCTION tick.get_changed_entity_states_between_latest_ticks(
    p_sync_group text
) RETURNS TABLE (
    general__entity_id uuid,
    operation config.operation_enum,
    changes jsonb
) AS $$
DECLARE
    v_current_tick_id uuid;
    v_previous_tick_id uuid;
BEGIN
    -- Get the latest two tick IDs
    WITH ordered_ticks AS (
        SELECT general__tick_id
        FROM tick.world_ticks wt
        WHERE wt.group__sync = p_sync_group
        ORDER BY tick__number DESC
        LIMIT 2
    )
    SELECT
        (SELECT general__tick_id FROM ordered_ticks LIMIT 1),
        (SELECT general__tick_id FROM ordered_ticks OFFSET 1 LIMIT 1)
    INTO v_current_tick_id, v_previous_tick_id;

    -- Return changes between these ticks
    RETURN QUERY
    WITH current_states AS (
        SELECT es.*
        FROM tick.entity_states es
        WHERE es.general__tick_id = v_current_tick_id
    ),
    previous_states AS (
        SELECT es.*
        FROM tick.entity_states es
        WHERE es.general__tick_id = v_previous_tick_id
    )
    SELECT 
        COALESCE(cs.general__entity_id, ps.general__entity_id),
        CASE 
            WHEN ps.general__entity_id IS NULL THEN 'INSERT'::config.operation_enum
            WHEN cs.general__entity_id IS NULL THEN 'DELETE'::config.operation_enum
            ELSE 'UPDATE'::config.operation_enum
        END,
        CASE 
            WHEN ps.general__entity_id IS NULL THEN 
                jsonb_build_object(
                    'general__entity_id', cs.general__entity_id,
                    'general__entity_name', cs.general__entity_name,
                    'general__semantic_version', cs.general__semantic_version,
                    'general__load_priority', cs.general__load_priority,
                    'general__initialized_at', cs.general__initialized_at,
                    'general__initialized_by', cs.general__initialized_by,
                    'meta__data', cs.meta__data,
                    'scripts__ids', cs.scripts__ids,
                    'scripts__status', cs.scripts__status,
                    'assets__ids', cs.assets__ids,
                    'validation__log', cs.validation__log,
                    'group__sync', cs.group__sync,
                    'general__created_at', cs.general__created_at,
                    'general__created_by', cs.general__created_by,
                    'general__updated_at', cs.general__updated_at,
                    'general__updated_by', cs.general__updated_by
                )
            WHEN cs.general__entity_id IS NULL THEN NULL::jsonb
            ELSE jsonb_strip_nulls(jsonb_build_object(
                'general__entity_name', 
                    CASE WHEN cs.general__entity_name IS DISTINCT FROM ps.general__entity_name 
                    THEN cs.general__entity_name END,
                'general__semantic_version', 
                    CASE WHEN cs.general__semantic_version IS DISTINCT FROM ps.general__semantic_version 
                    THEN cs.general__semantic_version END,
                'general__load_priority', 
                    CASE WHEN cs.general__load_priority IS DISTINCT FROM ps.general__load_priority 
                    THEN cs.general__load_priority END,
                'general__initialized_at', 
                    CASE WHEN cs.general__initialized_at IS DISTINCT FROM ps.general__initialized_at 
                    THEN cs.general__initialized_at END,
                'general__initialized_by', 
                    CASE WHEN cs.general__initialized_by IS DISTINCT FROM ps.general__initialized_by 
                    THEN cs.general__initialized_by END,
                'meta__data', 
                    CASE WHEN cs.meta__data IS DISTINCT FROM ps.meta__data 
                    THEN cs.meta__data END,
                'scripts__ids', 
                    CASE WHEN cs.scripts__ids IS DISTINCT FROM ps.scripts__ids 
                    THEN cs.scripts__ids END,
                'scripts__status', 
                    CASE WHEN cs.scripts__status IS DISTINCT FROM ps.scripts__status 
                    THEN cs.scripts__status END,
                'assets__ids',
                    CASE WHEN cs.assets__ids IS DISTINCT FROM ps.assets__ids 
                    THEN cs.assets__ids END,
                'validation__log', 
                    CASE WHEN cs.validation__log IS DISTINCT FROM ps.validation__log 
                    THEN cs.validation__log END,
                'group__sync', 
                    CASE WHEN cs.group__sync IS DISTINCT FROM ps.group__sync 
                    THEN cs.group__sync END,
                'general__created_at', 
                    CASE WHEN cs.general__created_at IS DISTINCT FROM ps.general__created_at 
                    THEN cs.general__created_at END,
                'general__created_by', 
                    CASE WHEN cs.general__created_by IS DISTINCT FROM ps.general__created_by 
                    THEN cs.general__created_by END,
                'general__updated_at', 
                    CASE WHEN cs.general__updated_at IS DISTINCT FROM ps.general__updated_at 
                    THEN cs.general__updated_at END,
                'general__updated_by', 
                    CASE WHEN cs.general__updated_by IS DISTINCT FROM ps.general__updated_by 
                    THEN cs.general__updated_by END
            ))
        END
    FROM current_states cs
    FULL OUTER JOIN previous_states ps ON cs.general__entity_id = ps.general__entity_id
    WHERE cs IS DISTINCT FROM ps;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4.3 SCRIPT FUNCTIONS
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

-- TODO: Every time we use log_script_change we should run this. Same should be done for assets, and entities (if not already).
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


CREATE OR REPLACE FUNCTION tick.get_changed_script_states_between_latest_ticks(
    p_sync_group text
) RETURNS TABLE (
    general__script_id uuid,
    operation config.operation_enum,
    changes jsonb
) AS $$
DECLARE
    v_latest_tick_id uuid;
    v_previous_tick_id uuid;
    v_latest_tick_time timestamptz;
    v_previous_tick_time timestamptz;
BEGIN
    -- Get the latest two tick IDs and timestamps
    WITH ordered_ticks AS (
        SELECT general__tick_id, tick__start_time, tick__number
        FROM tick.world_ticks wt
        WHERE wt.group__sync = p_sync_group
        ORDER BY tick__number DESC
        LIMIT 2
    )
    SELECT
        (SELECT general__tick_id FROM ordered_ticks ORDER BY tick__number DESC LIMIT 1),
        (SELECT general__tick_id FROM ordered_ticks ORDER BY tick__number DESC OFFSET 1 LIMIT 1),
        (SELECT tick__start_time FROM ordered_ticks ORDER BY tick__number DESC LIMIT 1),
        (SELECT tick__start_time FROM ordered_ticks ORDER BY tick__number DESC OFFSET 1 LIMIT 1)
    INTO v_latest_tick_id, v_previous_tick_id, v_latest_tick_time, v_previous_tick_time;

    -- If we don't have enough ticks, return empty result
    IF v_previous_tick_id IS NULL THEN
        RETURN;
    END IF;

    -- Return changes between ticks using the audit log
    RETURN QUERY
    WITH script_changes AS (
        SELECT DISTINCT ON (sal.general__script_id)
            sal.general__script_id,
            sal.operation,
            sal.operation_timestamp
        FROM tick.script_audit_log sal
        WHERE sal.group__sync = p_sync_group
          AND sal.operation_timestamp > v_previous_tick_time
          AND sal.operation_timestamp <= v_latest_tick_time
        ORDER BY sal.general__script_id, sal.operation_timestamp DESC
    ),
    current_scripts AS (
        SELECT s.*
        FROM entity.entity_scripts s
        JOIN script_changes sc ON s.general__script_id = sc.general__script_id
        WHERE sc.operation != 'DELETE'
    ),
    -- Get previous script states from before this change
    previous_scripts AS (
        SELECT s.*
        FROM entity.entity_scripts s
        JOIN script_changes sc ON s.general__script_id = sc.general__script_id
        WHERE sc.operation = 'UPDATE'
        AND s.general__updated_at <= v_previous_tick_time
    )
    SELECT
        sc.general__script_id,
        sc.operation,
        CASE
            -- Handle INSERT operations - include all fields
            WHEN sc.operation = 'INSERT' THEN 
                jsonb_strip_nulls(jsonb_build_object(
                    'general__script_name', cs.general__script_name,
                    'group__sync', cs.group__sync,
                    'source__repo__entry_path', cs.source__repo__entry_path,
                    'source__repo__url', cs.source__repo__url,
                    'compiled__node__script', cs.compiled__node__script,
                    'compiled__node__script_sha256', cs.compiled__node__script_sha256,
                    'compiled__node__status', cs.compiled__node__status,
                    'compiled__node__updated_at', cs.compiled__node__updated_at,
                    'compiled__bun__script', cs.compiled__bun__script,
                    'compiled__bun__script_sha256', cs.compiled__bun__script_sha256,
                    'compiled__bun__status', cs.compiled__bun__status,
                    'compiled__bun__updated_at', cs.compiled__bun__updated_at,
                    'compiled__browser__script', cs.compiled__browser__script,
                    'compiled__browser__script_sha256', cs.compiled__browser__script_sha256,
                    'compiled__browser__status', cs.compiled__browser__status,
                    'compiled__browser__updated_at', cs.compiled__browser__updated_at
                ))
            -- Handle DELETE operations    
            WHEN sc.operation = 'DELETE' THEN NULL
            -- Handle UPDATE operations with field comparison
            ELSE
                jsonb_strip_nulls(jsonb_build_object(
                    'general__script_name', 
                        CASE WHEN cs.general__script_name IS DISTINCT FROM ps.general__script_name 
                        THEN cs.general__script_name END,
                    'group__sync', 
                        CASE WHEN cs.group__sync IS DISTINCT FROM ps.group__sync 
                        THEN cs.group__sync END,
                    'source__repo__entry_path', 
                        CASE WHEN cs.source__repo__entry_path IS DISTINCT FROM ps.source__repo__entry_path 
                        THEN cs.source__repo__entry_path END,
                    'source__repo__url', 
                        CASE WHEN cs.source__repo__url IS DISTINCT FROM ps.source__repo__url 
                        THEN cs.source__repo__url END,
                    'compiled__node__status', 
                        CASE WHEN cs.compiled__node__status IS DISTINCT FROM ps.compiled__node__status 
                        THEN cs.compiled__node__status END,
                    'compiled__browser__status', 
                        CASE WHEN cs.compiled__browser__status IS DISTINCT FROM ps.compiled__browser__status 
                        THEN cs.compiled__browser__status END
                ))
        END
    FROM script_changes sc
    LEFT JOIN current_scripts cs ON sc.general__script_id = cs.general__script_id
    LEFT JOIN previous_scripts ps ON sc.general__script_id = ps.general__script_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4.4 ASSET FUNCTIONS
CREATE OR REPLACE FUNCTION tick.log_asset_change()
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

CREATE OR REPLACE FUNCTION tick.get_changed_asset_states_between_latest_ticks(
    p_sync_group text
) RETURNS TABLE (
    general__asset_id uuid,
    operation config.operation_enum,
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

-- ============================================================================
-- 5. TRIGGERS
-- ============================================================================

-- 5.1 ENABLE ROW LEVEL SECURITY ON ALL TABLES
ALTER TABLE tick.world_ticks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tick.entity_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE tick.script_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE tick.asset_audit_log ENABLE ROW LEVEL SECURITY;

-- 5.2 SCRIPT TRIGGERS
CREATE TRIGGER log_script_changes
    AFTER INSERT OR UPDATE OR DELETE ON entity.entity_scripts
    FOR EACH ROW
    EXECUTE FUNCTION tick.log_script_change();

-- 5.3 ASSET TRIGGERS
CREATE TRIGGER log_asset_changes
    AFTER INSERT OR UPDATE OR DELETE ON entity.entity_assets
    FOR EACH ROW
    EXECUTE FUNCTION tick.log_asset_change();

-- ============================================================================
-- 6. POLICIES
-- ============================================================================

-- 6.1 WORLD TICKS POLICIES
CREATE POLICY "world_ticks_read_policy" ON tick.world_ticks
    FOR SELECT
    USING (
        auth.is_admin_agent()
        OR auth.is_system_agent()
    );

CREATE POLICY "world_ticks_update_policy" ON tick.world_ticks
    FOR UPDATE
    USING (
        auth.is_admin_agent()
        OR auth.is_system_agent()
    );

CREATE POLICY "world_ticks_insert_policy" ON tick.world_ticks
    FOR INSERT
    WITH CHECK (
        auth.is_admin_agent()
        OR auth.is_system_agent()
    );

CREATE POLICY "world_ticks_delete_policy" ON tick.world_ticks
    FOR DELETE
    USING (
        auth.is_admin_agent()
        OR auth.is_system_agent()
    );

-- 6.2 ENTITY STATES POLICIES
CREATE POLICY "entity_states_read_policy" ON tick.entity_states
    FOR SELECT
    USING (
        auth.is_admin_agent()
        OR auth.is_system_agent()
        OR EXISTS (
            SELECT 1 
            FROM auth.active_sync_group_sessions sess 
            WHERE sess.auth__agent_id = auth.current_agent_id()
              AND sess.group__sync = tick.entity_states.group__sync
        )
    );

CREATE POLICY "entity_states_update_policy" ON tick.entity_states
    FOR UPDATE
    USING (auth.is_admin_agent());

CREATE POLICY "entity_states_insert_policy" ON tick.entity_states
    FOR INSERT
    WITH CHECK (auth.is_admin_agent());

CREATE POLICY "entity_states_delete_policy" ON tick.entity_states
    FOR DELETE
    USING (auth.is_admin_agent());

-- 6.3 SCRIPT AUDIT LOG POLICIES
CREATE POLICY "script_audit_log_read_policy" ON tick.script_audit_log
    FOR SELECT USING (
        auth.is_admin_agent()
        OR auth.is_system_agent()
        OR EXISTS (
            SELECT 1 
            FROM auth.active_sync_group_sessions sess 
            WHERE sess.auth__agent_id = auth.current_agent_id()
              AND sess.group__sync = tick.script_audit_log.group__sync
        )
    );

CREATE POLICY "script_audit_log_insert_policy" ON tick.script_audit_log
    FOR INSERT
    WITH CHECK (auth.is_admin_agent());

CREATE POLICY "script_audit_log_update_policy" ON tick.script_audit_log
    FOR UPDATE
    USING (auth.is_admin_agent());

CREATE POLICY "script_audit_log_delete_policy" ON tick.script_audit_log
    FOR DELETE
    USING (auth.is_admin_agent());

-- 6.4 ASSET AUDIT LOG POLICIES
CREATE POLICY "asset_audit_log_read_policy" ON tick.asset_audit_log
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

-- ============================================================================
-- 7. PERMISSIONS
-- ============================================================================

-- Revoke all permissions first
REVOKE ALL ON SCHEMA tick FROM PUBLIC, vircadia_agent_proxy;

-- Grant schema usage
GRANT USAGE ON SCHEMA tick TO vircadia_agent_proxy;

-- Grant table permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA tick TO vircadia_agent_proxy;

-- Grant function permissions
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA tick TO vircadia_agent_proxy;
