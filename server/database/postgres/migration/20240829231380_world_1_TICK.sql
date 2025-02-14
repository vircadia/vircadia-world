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

    -- Now capture entity states
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
    FROM tick.script_audit_log sa
    WHERE sa.group__sync = p_sync_group
    AND sa.operation_timestamp > v_last_tick_time 
    AND sa.operation_timestamp <= v_start_time;

    -- Count assets that were modified since last tick for asset state processing metric
    SELECT COUNT(DISTINCT aa.general__asset_id)
    INTO v_asset_states_processed
    FROM tick.asset_audit_log aa
    WHERE aa.group__sync = p_sync_group
    AND aa.operation_timestamp > v_last_tick_time
    AND aa.operation_timestamp <= v_start_time;

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
        tick__asset_states_processed = v_asset_states_processed,
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
        v_asset_states_processed,
        v_is_delayed,
        v_headroom_ms,
        v_time_since_last_tick_ms;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
