-- ============================================================================
-- 1. CAPTURE TICK STATE FUNCTION DECLARATION & VARIABLE INITIALIZATION
-- ============================================================================

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
    -- ============================================================================
    -- 1.1. ACQUIRE LOCK & INITIALIZE TIMING VARIABLES
    -- ============================================================================
    LOCK TABLE tick.world_ticks IN SHARE ROW EXCLUSIVE MODE;
    v_start_time := clock_timestamp();

    -- ============================================================================
    -- 1.2. GET BUFFER DURATION FROM SYNC GROUP CONFIG
    -- ============================================================================
    SELECT server__tick__max_ticks_buffer * server__tick__rate_ms 
    INTO v_buffer_duration_ms
    FROM auth.sync_groups
    WHERE general__sync_group = p_sync_group;

    -- ============================================================================
    -- 2. CLEANUP OLD TICKS
    -- ============================================================================
    DELETE FROM tick.world_ticks wt
    WHERE wt.group__sync = p_sync_group
      AND wt.tick__start_time < (v_start_time - (v_buffer_duration_ms || ' milliseconds')::interval);

    -- ============================================================================
    -- 3. GET LAST TICK INFORMATION (FOR TICK NUMBER & METRICS)
    -- ============================================================================
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

    -- ============================================================================
    -- 4. INSERT NEW TICK RECORD (INITIAL)
    -- ============================================================================
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

    -- ============================================================================
    -- 5. CAPTURE ENTITY STATES
    -- ============================================================================
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

    -- ============================================================================
    -- 6. PROCESS SCRIPT & ASSET STATE METRICS
    -- ============================================================================
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

    -- ============================================================================
    -- 7. CALCULATE TICK DURATION, DELAY & HEADROOM, THEN UPDATE TICK RECORD
    -- ============================================================================
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

    -- ============================================================================
    -- 8. RETURN THE CAPTURED TICK RECORD
    -- ============================================================================
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
