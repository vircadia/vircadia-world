-- Create tick schema
CREATE SCHEMA IF NOT EXISTS tick;

-- World ticks table (make this the authoritative table)
CREATE TABLE tick.world_ticks (
    general__tick_id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
    tick__number bigint NOT NULL,
    group__sync TEXT NOT NULL REFERENCES auth.sync_groups(general__sync_group),
    tick__start_time timestamptz NOT NULL,
    tick__end_time timestamptz NOT NULL,
    tick__duration_ms double precision NOT NULL,
    tick__entity_states_processed int NOT NULL,
    tick__script_states_processed int NOT NULL,
    tick__is_delayed boolean NOT NULL,
    tick__headroom_ms double precision,
    tick__time_since_last_tick_ms double precision,

    -- Add unique constraint for sync_group + tick number combination
    UNIQUE (group__sync, tick__number)

);

-- Lag compensation state history table (now references world_ticks)
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

-- View policy for entity_states (using sync groups instead of roles)
CREATE POLICY "entity_states_view_policy" ON tick.entity_states
    FOR SELECT
    USING (
        auth.is_admin_agent()
        OR auth.has_sync_group_read_access(group__sync)
    );

-- Update/Insert/Delete policies for entity_states (system users only)
CREATE POLICY "entity_states_update_policy" ON tick.entity_states
    FOR UPDATE
    USING (auth.is_admin_agent());

CREATE POLICY "entity_states_insert_policy" ON tick.entity_states
    FOR INSERT
    WITH CHECK (auth.is_admin_agent());

CREATE POLICY "entity_states_delete_policy" ON tick.entity_states
    FOR DELETE
    USING (auth.is_admin_agent());

-- Updated indexes for fast state lookups
CREATE INDEX entity_states_lookup_idx ON tick.entity_states (general__entity_id, general__tick_id);
CREATE INDEX entity_states_tick_idx ON tick.entity_states (general__tick_id);

-- Enable RLS on entity_states table
ALTER TABLE tick.entity_states ENABLE ROW LEVEL SECURITY;

CREATE TYPE operation_enum AS ENUM ('INSERT', 'UPDATE', 'DELETE');

-- Function to get ALL entity states from the latest tick in a sync group
CREATE OR REPLACE FUNCTION tick.get_all_entity_states_at_latest_tick(
    p_sync_group text
) RETURNS TABLE (
    general__entity_id uuid,
    general__name varchar(255),
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
    SELECT server__tick__buffer * server__tick__rate_ms 
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
    SELECT COUNT(*)
    INTO v_script_states_processed
    FROM entity.entity_scripts s
    WHERE s.group__sync = p_sync_group
    AND s.general__updated_at > v_last_tick_time
    AND s.general__updated_at <= v_start_time;

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

-- Enable RLS on world_ticks table
ALTER TABLE tick.world_ticks ENABLE ROW LEVEL SECURITY;

-- All policies for world_ticks (system users only)
CREATE POLICY "world_ticks_view_policy" ON tick.world_ticks
    FOR SELECT
    USING (auth.is_admin_agent());

CREATE POLICY "world_ticks_update_policy" ON tick.world_ticks
    FOR UPDATE
    USING (auth.is_admin_agent());

CREATE POLICY "world_ticks_insert_policy" ON tick.world_ticks
    FOR INSERT
    WITH CHECK (auth.is_admin_agent());

CREATE POLICY "world_ticks_delete_policy" ON tick.world_ticks
    FOR DELETE
    USING (auth.is_admin_agent());

-- Add index for sync group queries
CREATE INDEX entity_states_sync_group_tick_idx 
ON tick.entity_states (group__sync, general__tick_id DESC);

-- Add optimized indexes for the tick system
CREATE INDEX idx_entity_states_sync_tick_lookup 
    ON tick.entity_states (group__sync, general__tick_id, general__entity_id);

-- Add optimized indexes instead
CREATE INDEX idx_world_ticks_sync_number ON tick.world_ticks (group__sync, tick__number DESC);
CREATE INDEX idx_entity_states_sync_tick ON tick.entity_states (group__sync, general__tick_id);

-- Add index to support timestamp-based queries
CREATE INDEX idx_world_ticks_sync_time 
    ON tick.world_ticks (group__sync, tick__start_time DESC);

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
    SELECT 
        es.general__script_id,
        CASE 
            WHEN es.general__created_at >= v_previous_tick_time THEN 'INSERT'::operation_enum
            ELSE 'UPDATE'::operation_enum
        END as operation,
        jsonb_strip_nulls(jsonb_build_object(
            'source__repo__entry_path', es.source__repo__entry_path,
            'source__repo__url', es.source__repo__url,
            'compiled__node__script', es.compiled__node__script,
            'compiled__node__script_sha256', es.compiled__node__script_sha256,
            'compiled__node__status', es.compiled__node__status,
            'compiled__node__updated_at', es.compiled__node__updated_at,
            'compiled__bun__script', es.compiled__bun__script,
            'compiled__bun__script_sha256', es.compiled__bun__script_sha256,
            'compiled__bun__status', es.compiled__bun__status,
            'compiled__bun__updated_at', es.compiled__bun__updated_at,
            'compiled__browser__script', es.compiled__browser__script,
            'compiled__browser__script_sha256', es.compiled__browser__script_sha256,
            'compiled__browser__status', es.compiled__browser__status,
            'compiled__browser__updated_at', es.compiled__browser__updated_at,
            'group__sync', es.group__sync
        )) as changes,
        coalesce(auth.get_sync_group_session_ids(es.group__sync), '{}') as sync_group_session_ids
    FROM entity.entity_scripts es
    WHERE es.group__sync = p_sync_group
    AND es.general__updated_at > v_previous_tick_time
    AND es.general__updated_at <= v_latest_tick_time

    UNION ALL

    -- Handle deleted scripts
    SELECT 
        es.general__script_id,
        'DELETE'::operation_enum as operation,
        NULL::jsonb as changes,
        coalesce(auth.get_sync_group_session_ids(p_sync_group), '{}') as sync_group_session_ids
    FROM entity.entity_scripts_audit_log es
    WHERE es.group__sync = p_sync_group
    AND es.operation = 'DELETE'
    AND es.operation_timestamp > v_previous_tick_time
    AND es.operation_timestamp <= v_latest_tick_time;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


