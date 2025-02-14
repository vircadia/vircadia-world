-- Function to get ALL entity states from the latest tick in a sync group
CREATE OR REPLACE FUNCTION tick.get_all_entity_states_at_latest_tick(
    p_sync_group text
) RETURNS TABLE (
    general__entity_id uuid,
    general__name text,
    general__semantic_version text,
    general__load_priority integer,
    general__initialized_at timestamptz,
    general__initialized_by uuid,
    meta__data jsonb,
    scripts__ids uuid[],
    scripts__status entity_status_enum,
    validation__log jsonb,
    group__sync text,
    general__created_at timestamptz,
    general__created_by uuid,
    general__updated_at timestamptz,
    general__updated_by uuid,
    sync_group_session_ids uuid[]
) AS $$
BEGIN
    RETURN QUERY
    WITH latest_tick AS (
        SELECT general__tick_id
        FROM tick.world_ticks wt
        WHERE wt.group__sync = p_sync_group
        ORDER BY tick__number DESC
        LIMIT 1
    )
    SELECT 
        es.general__entity_id,
        es.general__name,
        es.general__semantic_version,
        es.general__load_priority,
        es.general__initialized_at,
        es.general__initialized_by,
        es.meta__data,
        es.scripts__ids,
        es.scripts__status,
        es.validation__log,
        es.group__sync,
        es.general__created_at,
        es.general__created_by,
        es.general__updated_at,
        es.general__updated_by,
        coalesce(auth.get_sync_group_session_ids(es.group__sync), '{}')
    FROM tick.entity_states es
    JOIN latest_tick lt ON es.general__tick_id = lt.general__tick_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get CHANGED entity states between latest ticks
CREATE OR REPLACE FUNCTION tick.get_changed_entity_states_between_latest_ticks(
    p_sync_group text
) RETURNS TABLE (
    general__entity_id uuid,
    operation operation_enum,
    changes jsonb,
    sync_group_session_ids uuid[]
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
            WHEN ps.general__entity_id IS NULL THEN 'INSERT'::operation_enum
            WHEN cs.general__entity_id IS NULL THEN 'DELETE'::operation_enum
            ELSE 'UPDATE'::operation_enum
        END,
        CASE 
            WHEN ps.general__entity_id IS NULL THEN 
                jsonb_build_object(
                    'general__entity_id', cs.general__entity_id,
                    'general__name', cs.general__name,
                    'general__semantic_version', cs.general__semantic_version,
                    'general__load_priority', cs.general__load_priority,
                    'general__initialized_at', cs.general__initialized_at,
                    'general__initialized_by', cs.general__initialized_by,
                    'meta__data', cs.meta__data,
                    'scripts__ids', cs.scripts__ids,
                    'scripts__status', cs.scripts__status,
                    'validation__log', cs.validation__log,
                    'group__sync', cs.group__sync,
                    'general__created_at', cs.general__created_at,
                    'general__created_by', cs.general__created_by,
                    'general__updated_at', cs.general__updated_at,
                    'general__updated_by', cs.general__updated_by
                )
            WHEN cs.general__entity_id IS NULL THEN NULL::jsonb
            ELSE jsonb_strip_nulls(jsonb_build_object(
                'general__name', 
                    CASE WHEN cs.general__name IS DISTINCT FROM ps.general__name 
                    THEN cs.general__name END,
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
        END,
        coalesce(auth.get_sync_group_session_ids(coalesce(cs.group__sync, ps.group__sync)), '{}')
    FROM current_states cs
    FULL OUTER JOIN previous_states ps ON cs.general__entity_id = ps.general__entity_id
    WHERE cs IS DISTINCT FROM ps;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to capture the current tick state
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
    v_end_time timestamptz;
    v_duration_ms double precision;
    v_headroom_ms double precision;
    v_is_delayed boolean;
    v_time_since_last_tick_ms double precision;
    v_tick_id uuid;
    v_buffer_duration_ms integer;
BEGIN
    -- Acquire lock to avoid duplicate tick_number when multiple calls occur
    LOCK TABLE tick.world_ticks IN SHARE ROW EXCLUSIVE MODE;

    -- Get start time
    v_start_time := clock_timestamp();

    -- Get buffer duration from sync group config
    SELECT server__tick__max_ticks_buffer * server__tick__rate_ms 
    INTO v_buffer_duration_ms
    FROM auth.sync_groups
    WHERE general__sync_group = p_sync_group;

    -- Efficient cleanup of old ticks using a single DELETE
    -- This will cascade to entity_states
    DELETE FROM tick.world_ticks wt
    WHERE wt.group__sync = p_sync_group
    AND wt.tick__start_time < (v_start_time - (v_buffer_duration_ms || ' milliseconds')::interval);

    -- Get last tick info
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

    -- Calculate new tick number
    IF v_tick_number IS NULL THEN
        v_tick_number := 1;
    ELSE
        v_tick_number := v_tick_number + 1;
    END IF;

    -- Calculate time since last tick
    IF v_last_tick_time IS NOT NULL THEN
        v_time_since_last_tick_ms := EXTRACT(EPOCH FROM (v_start_time - v_last_tick_time)) * 1000;
    END IF;

    -- Generate new tick ID
    v_tick_id := uuid_generate_v4();

    -- Create the world tick record first
    INSERT INTO tick.world_ticks (
        general__tick_id,
        tick__number,
        group__sync,
        tick__start_time,
        tick__end_time,
        tick__duration_ms,
        tick__entity_states_processed,
        tick__script_states_processed,
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
        false,
        0,
        v_time_since_last_tick_ms
    );

    -- Now capture entity states
    WITH entity_snapshot AS (
        INSERT INTO tick.entity_states (
            general__entity_id,
            general__name,
            general__semantic_version,
            general__load_priority,
            general__initialized_at,
            general__initialized_by,
            meta__data,
            scripts__ids,
            scripts__status,
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
            e.general__name,
            e.general__semantic_version,
            e.general__load_priority,
            e.general__initialized_at,
            e.general__initialized_by,
            e.meta__data,
            e.scripts__ids,
            e.scripts__status,
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

    -- Count scripts that were modified since last tick for script state processing metric
    SELECT COUNT(DISTINCT sa.general__script_id)
    INTO v_script_states_processed
    FROM audit.script_audit_log sa
    WHERE sa.group__sync = p_sync_group
    AND sa.operation_timestamp > v_last_tick_time 
    AND sa.operation_timestamp <= v_start_time;

    -- Get end time and calculate duration
    v_end_time := clock_timestamp();
    v_duration_ms := EXTRACT(EPOCH FROM (v_end_time - v_start_time)) * 1000;

    -- Calculate if tick is delayed or rate limited based on configuration
    SELECT 
        v_duration_ms > sg.server__tick__rate_ms AS is_delayed,
        sg.server__tick__rate_ms - v_duration_ms AS headroom_ms
    INTO v_is_delayed, v_headroom_ms
    FROM auth.sync_groups sg
    WHERE sg.general__sync_group = p_sync_group;

    -- Update the world tick record with final values
    UPDATE tick.world_ticks wt
    SET 
        tick__end_time = v_end_time,
        tick__duration_ms = v_duration_ms,
        tick__entity_states_processed = v_entity_states_processed,
        tick__script_states_processed = v_script_states_processed,
        tick__is_delayed = v_is_delayed,
        tick__headroom_ms = v_headroom_ms
    WHERE wt.general__tick_id = v_tick_id;

    -- Return the tick record
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
        v_is_delayed,
        v_headroom_ms,
        v_time_since_last_tick_ms;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get ALL script states from the latest tick in a sync group
CREATE OR REPLACE FUNCTION tick.get_all_script_states_at_latest_tick(
    p_sync_group text
) RETURNS TABLE (
    general__script_id uuid,
    group__sync text,
    source__repo__entry_path text,
    source__repo__url text,
    compiled__node__script text,
    compiled__node__script_sha256 text,
    compiled__node__status script_compilation_status,
    compiled__node__updated_at timestamptz,
    compiled__bun__script text,
    compiled__bun__script_sha256 text,
    compiled__bun__status script_compilation_status,
    compiled__bun__updated_at timestamptz,
    compiled__browser__script text,
    compiled__browser__script_sha256 text,
    compiled__browser__status script_compilation_status,
    compiled__browser__updated_at timestamptz,
    general__created_at timestamptz,
    general__created_by uuid,
    general__updated_at timestamptz,
    general__updated_by uuid,
    sync_group_session_ids uuid[]
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        es.general__script_id,
        es.group__sync,
        es.source__repo__entry_path,
        es.source__repo__url,
        es.compiled__node__script,
        es.compiled__node__script_sha256,
        es.compiled__node__status,
        es.compiled__node__updated_at,
        es.compiled__bun__script,
        es.compiled__bun__script_sha256,
        es.compiled__bun__status,
        es.compiled__bun__updated_at,
        es.compiled__browser__script,
        es.compiled__browser__script_sha256,
        es.compiled__browser__status,
        es.compiled__browser__updated_at,
        es.general__created_at,
        es.general__created_by,
        es.general__updated_at,
        es.general__updated_by,
        coalesce(auth.get_sync_group_session_ids(es.group__sync), '{}')
    FROM entity.entity_scripts es
    WHERE es.group__sync = p_sync_group;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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


