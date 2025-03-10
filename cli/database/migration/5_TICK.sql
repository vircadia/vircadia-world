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
    
    -- DB-specific metrics
    tick__db__start_time timestamptz,
    tick__db__end_time timestamptz,
    tick__db__duration_ms double precision,
    tick__db__is_delayed boolean,
    
    -- Manager-specific metrics
    tick__manager__start_time timestamptz,
    tick__manager__end_time timestamptz,
    tick__manager__duration_ms double precision,
    tick__manager__is_delayed boolean,
    
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

-- 2.3 SCRIPT STATES TABLE - Replacing script_audit_log
CREATE TABLE tick.script_states (
    LIKE entity.entity_scripts INCLUDING DEFAULTS EXCLUDING CONSTRAINTS,

    -- Additional metadata for state tracking
    general__tick_id uuid NOT NULL,
    general__script_state_id uuid DEFAULT uuid_generate_v4(),

    -- Override the primary key to allow multiple states per script
    CONSTRAINT script_states_pkey PRIMARY KEY (general__script_state_id),

    -- Add foreign key constraint for sync_group
    CONSTRAINT script_states_sync_group_fkey FOREIGN KEY (group__sync) 
        REFERENCES auth.sync_groups(general__sync_group),
    
    -- Add foreign key constraint to world_ticks with cascade delete
    CONSTRAINT script_states_tick_fkey FOREIGN KEY (general__tick_id)
        REFERENCES tick.world_ticks(general__tick_id) ON DELETE CASCADE
);

-- 2.4 ASSET STATES TABLE - Replacing asset_audit_log
CREATE TABLE tick.asset_states (
    LIKE entity.entity_assets INCLUDING DEFAULTS EXCLUDING CONSTRAINTS,

    -- Additional metadata for state tracking
    general__tick_id uuid NOT NULL,
    general__asset_state_id uuid DEFAULT uuid_generate_v4(),

    -- Override the primary key to allow multiple states per asset
    CONSTRAINT asset_states_pkey PRIMARY KEY (general__asset_state_id),

    -- Add foreign key constraint for sync_group
    CONSTRAINT asset_states_sync_group_fkey FOREIGN KEY (group__sync) 
        REFERENCES auth.sync_groups(general__sync_group),
    
    -- Add foreign key constraint to world_ticks with cascade delete
    CONSTRAINT asset_states_tick_fkey FOREIGN KEY (general__tick_id)
        REFERENCES tick.world_ticks(general__tick_id) ON DELETE CASCADE
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

-- 3.3 SCRIPT STATES INDEXES
CREATE INDEX script_states_lookup_idx ON tick.script_states (general__script_id, general__tick_id);
CREATE INDEX script_states_tick_idx ON tick.script_states (general__tick_id);
CREATE INDEX script_states_sync_group_tick_idx ON tick.script_states (group__sync, general__tick_id DESC);
CREATE INDEX idx_script_states_sync_tick_lookup ON tick.script_states (group__sync, general__tick_id, general__script_id);
CREATE INDEX idx_script_states_sync_tick ON tick.script_states (group__sync, general__tick_id);

-- 3.4 ASSET STATES INDEXES
CREATE INDEX asset_states_lookup_idx ON tick.asset_states (general__asset_id, general__tick_id);
CREATE INDEX asset_states_tick_idx ON tick.asset_states (general__tick_id);
CREATE INDEX asset_states_sync_group_tick_idx ON tick.asset_states (group__sync, general__tick_id DESC);
CREATE INDEX idx_asset_states_sync_tick_lookup ON tick.asset_states (group__sync, general__tick_id, general__asset_id);
CREATE INDEX idx_asset_states_sync_tick ON tick.asset_states (group__sync, general__tick_id);

-- ============================================================================
-- 4. FUNCTIONS
-- ============================================================================

-- 4.1 TICK CAPTURE FUNCTION - Updated to include script and asset states
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
    tick__time_since_last_tick_ms double precision,
    tick__db__start_time timestamptz,
    tick__db__end_time timestamptz,
    tick__db__duration_ms double precision,
    tick__db__is_delayed boolean
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
    v_max_tick_count_buffer integer;
    v_db_start_time timestamptz;
    v_db_end_time timestamptz;
    v_db_duration_ms double precision;
    v_db_is_delayed boolean;
BEGIN
    -- Acquire lock & initialize timing variables
    LOCK TABLE tick.world_ticks IN SHARE ROW EXCLUSIVE MODE;
    v_start_time := clock_timestamp();
    v_db_start_time := v_start_time;  -- Database processing starts now

    -- Get max tick count buffer from sync group config
    SELECT server__tick__max_tick_count_buffer 
    INTO v_max_tick_count_buffer
    FROM auth.sync_groups
    WHERE general__sync_group = p_sync_group;

    -- Cleanup old ticks based on count
    DELETE FROM tick.world_ticks wt
    WHERE wt.general__tick_id IN (
        SELECT wt2.general__tick_id
        FROM tick.world_ticks wt2
        WHERE wt2.group__sync = p_sync_group
        ORDER BY wt2.tick__number DESC
        OFFSET v_max_tick_count_buffer
    );

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
        tick__time_since_last_tick_ms,
        tick__db__start_time,
        tick__db__end_time,
        tick__db__duration_ms,
        tick__db__is_delayed
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
        v_time_since_last_tick_ms,
        v_db_start_time,
        null,  -- Will update at the end
        0,
        false
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

    -- Capture script states
    WITH script_snapshot AS (
        INSERT INTO tick.script_states (
            general__script_id,
            general__script_name,
            group__sync,
            source__repo__entry_path,
            source__repo__url,
            compiled__node__script,
            compiled__node__script_sha256,
            compiled__node__status,
            compiled__node__updated_at,
            compiled__bun__script,
            compiled__bun__script_sha256,
            compiled__bun__status,
            compiled__bun__updated_at,
            compiled__browser__script,
            compiled__browser__script_sha256,
            compiled__browser__status,
            compiled__browser__updated_at,
            general__created_at,
            general__created_by,
            general__updated_at,
            general__updated_by,
            general__tick_id
        )
        SELECT 
            s.general__script_id,
            s.general__script_name,
            s.group__sync,
            s.source__repo__entry_path,
            s.source__repo__url,
            s.compiled__node__script,
            s.compiled__node__script_sha256,
            s.compiled__node__status,
            s.compiled__node__updated_at,
            s.compiled__bun__script,
            s.compiled__bun__script_sha256,
            s.compiled__bun__status,
            s.compiled__bun__updated_at,
            s.compiled__browser__script,
            s.compiled__browser__script_sha256,
            s.compiled__browser__status,
            s.compiled__browser__updated_at,
            s.general__created_at,
            s.general__created_by,
            s.general__updated_at,
            s.general__updated_by,
            v_tick_id
        FROM entity.entity_scripts s
        WHERE s.group__sync = p_sync_group
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_script_states_processed FROM script_snapshot;

    -- Capture asset states
    WITH asset_snapshot AS (
        INSERT INTO tick.asset_states (
            general__asset_id,
            general__asset_name,
            group__sync,
            asset__data,
            meta__data,
            general__created_at,
            general__created_by,
            general__updated_at,
            general__updated_by,
            general__tick_id
        )
        SELECT 
            a.general__asset_id,
            a.general__asset_name,
            a.group__sync,
            a.asset__data,
            a.meta__data,
            a.general__created_at,
            a.general__created_by,
            a.general__updated_at,
            a.general__updated_by,
            v_tick_id
        FROM entity.entity_assets a
        WHERE a.group__sync = p_sync_group
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_asset_states_processed FROM asset_snapshot;

    -- Calculate tick duration, delay & headroom
    v_end_time := clock_timestamp();
    v_duration_ms := EXTRACT(EPOCH FROM (v_end_time - v_start_time)) * 1000;
    
    -- Calculate DB-specific metrics
    v_db_end_time := v_end_time;
    v_db_duration_ms := EXTRACT(EPOCH FROM (v_db_end_time - v_db_start_time)) * 1000;

    SELECT 
        v_duration_ms > sg.server__tick__rate_ms AS is_delayed,
        sg.server__tick__rate_ms - v_duration_ms AS headroom_ms,
        v_db_duration_ms > sg.server__tick__rate_ms AS db_is_delayed
    INTO v_is_delayed, v_headroom_ms, v_db_is_delayed
    FROM auth.sync_groups sg
    WHERE sg.general__sync_group = p_sync_group;

    -- Update tick record with final metrics
    UPDATE tick.world_ticks wt
    SET 
        tick__end_time = v_end_time,
        tick__duration_ms = v_duration_ms,
        tick__entity_states_processed = v_entity_states_processed,
        tick__script_states_processed = v_script_states_processed,
        tick__asset_states_processed = v_asset_states_processed,
        tick__is_delayed = v_is_delayed,
        tick__headroom_ms = v_headroom_ms,
        tick__db__end_time = v_db_end_time,
        tick__db__duration_ms = v_db_duration_ms,
        tick__db__is_delayed = v_db_is_delayed
    WHERE wt.general__tick_id = v_tick_id;

    -- Send notification that a tick has been captured
    PERFORM pg_notify(
        'tick_captured', 
        json_build_object(
            'syncGroup', p_sync_group,
            'tickId', v_tick_id,
            'tickNumber', v_tick_number
        )::text
    );

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
        v_time_since_last_tick_ms,
        v_db_start_time,
        v_db_end_time,
        v_db_duration_ms,
        v_db_is_delayed;
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

-- 4.3 SCRIPT STATE FUNCTIONS - Updated to use state comparison instead of audit logs
CREATE OR REPLACE FUNCTION tick.get_changed_script_states_between_latest_ticks(
    p_sync_group text
) RETURNS TABLE (
    general__script_id uuid,
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

    -- If we don't have enough ticks, return empty result
    IF v_previous_tick_id IS NULL THEN
        RETURN;
    END IF;

    -- Return changes between these ticks
    RETURN QUERY
    WITH current_states AS (
        SELECT ss.*
        FROM tick.script_states ss
        WHERE ss.general__tick_id = v_current_tick_id
    ),
    previous_states AS (
        SELECT ss.*
        FROM tick.script_states ss
        WHERE ss.general__tick_id = v_previous_tick_id
    )
    SELECT 
        COALESCE(cs.general__script_id, ps.general__script_id),
        CASE 
            WHEN ps.general__script_id IS NULL THEN 'INSERT'::config.operation_enum
            WHEN cs.general__script_id IS NULL THEN 'DELETE'::config.operation_enum
            ELSE 'UPDATE'::config.operation_enum
        END,
        CASE 
            WHEN ps.general__script_id IS NULL THEN 
                jsonb_build_object(
                    'general__script_id', cs.general__script_id,
                    'general__script_name', cs.general__script_name,
                    'group__sync', cs.group__sync,
                    'source__repo__entry_path', cs.source__repo__entry_path,
                    'source__repo__url', cs.source__repo__url,
                    'compiled__node__status', cs.compiled__node__status,
                    'compiled__node__updated_at', cs.compiled__node__updated_at,
                    'compiled__bun__status', cs.compiled__bun__status,
                    'compiled__bun__updated_at', cs.compiled__bun__updated_at,
                    'compiled__browser__status', cs.compiled__browser__status,
                    'compiled__browser__updated_at', cs.compiled__browser__updated_at,
                    'general__created_at', cs.general__created_at,
                    'general__updated_at', cs.general__updated_at
                )
            WHEN cs.general__script_id IS NULL THEN NULL::jsonb
            ELSE jsonb_strip_nulls(jsonb_build_object(
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
                'compiled__node__updated_at', 
                    CASE WHEN cs.compiled__node__updated_at IS DISTINCT FROM ps.compiled__node__updated_at 
                    THEN cs.compiled__node__updated_at END,
                'compiled__bun__status', 
                    CASE WHEN cs.compiled__bun__status IS DISTINCT FROM ps.compiled__bun__status 
                    THEN cs.compiled__bun__status END,
                'compiled__bun__updated_at', 
                    CASE WHEN cs.compiled__bun__updated_at IS DISTINCT FROM ps.compiled__bun__updated_at 
                    THEN cs.compiled__bun__updated_at END,
                'compiled__browser__status', 
                    CASE WHEN cs.compiled__browser__status IS DISTINCT FROM ps.compiled__browser__status 
                    THEN cs.compiled__browser__status END,
                'compiled__browser__updated_at', 
                    CASE WHEN cs.compiled__browser__updated_at IS DISTINCT FROM ps.compiled__browser__updated_at 
                    THEN cs.compiled__browser__updated_at END,
                'general__updated_at', 
                    CASE WHEN cs.general__updated_at IS DISTINCT FROM ps.general__updated_at 
                    THEN cs.general__updated_at END
            ))
        END
    FROM current_states cs
    FULL OUTER JOIN previous_states ps ON cs.general__script_id = ps.general__script_id
    WHERE cs IS DISTINCT FROM ps;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4.4 ASSET STATE FUNCTIONS - Updated to use state comparison instead of audit logs
CREATE OR REPLACE FUNCTION tick.get_changed_asset_states_between_latest_ticks(
    p_sync_group text
) RETURNS TABLE (
    general__asset_id uuid,
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

    -- If we don't have enough ticks, return empty result
    IF v_previous_tick_id IS NULL THEN
        RETURN;
    END IF;

    -- Return changes between these ticks
    RETURN QUERY
    WITH current_states AS (
        SELECT ast.*
        FROM tick.asset_states ast
        WHERE ast.general__tick_id = v_current_tick_id
    ),
    previous_states AS (
        SELECT ast.*
        FROM tick.asset_states ast
        WHERE ast.general__tick_id = v_previous_tick_id
    )
    SELECT 
        COALESCE(cs.general__asset_id, ps.general__asset_id),
        CASE 
            WHEN ps.general__asset_id IS NULL THEN 'INSERT'::config.operation_enum
            WHEN cs.general__asset_id IS NULL THEN 'DELETE'::config.operation_enum
            ELSE 'UPDATE'::config.operation_enum
        END,
        CASE 
            WHEN ps.general__asset_id IS NULL THEN 
                jsonb_build_object(
                    'general__asset_id', cs.general__asset_id,
                    'general__asset_name', cs.general__asset_name,
                    'group__sync', cs.group__sync,
                    'meta__data', cs.meta__data,
                    'asset__data', CASE WHEN cs.asset__data IS NOT NULL THEN true ELSE false END,
                    'general__created_at', cs.general__created_at,
                    'general__updated_at', cs.general__updated_at
                )
            WHEN cs.general__asset_id IS NULL THEN NULL::jsonb
            ELSE jsonb_strip_nulls(jsonb_build_object(
                'general__asset_name', 
                    CASE WHEN cs.general__asset_name IS DISTINCT FROM ps.general__asset_name 
                    THEN cs.general__asset_name END,
                'group__sync', 
                    CASE WHEN cs.group__sync IS DISTINCT FROM ps.group__sync 
                    THEN cs.group__sync END,
                'meta__data', 
                    CASE WHEN cs.meta__data IS DISTINCT FROM ps.meta__data 
                    THEN cs.meta__data END,
                'asset__data', 
                    CASE WHEN cs.asset__data IS DISTINCT FROM ps.asset__data 
                    THEN true END,
                'general__updated_at', 
                    CASE WHEN cs.general__updated_at IS DISTINCT FROM ps.general__updated_at 
                    THEN cs.general__updated_at END
            ))
        END
    FROM current_states cs
    FULL OUTER JOIN previous_states ps ON cs.general__asset_id = ps.general__asset_id
    WHERE cs IS DISTINCT FROM ps;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 5. TRIGGERS
-- ============================================================================

-- 5.1 ENABLE ROW LEVEL SECURITY ON ALL TABLES
ALTER TABLE tick.world_ticks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tick.entity_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE tick.script_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE tick.asset_states ENABLE ROW LEVEL SECURITY;

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

-- 6.3 SCRIPT STATES POLICIES
CREATE POLICY "script_states_read_policy" ON tick.script_states
    FOR SELECT
    USING (
        auth.is_admin_agent()
        OR auth.is_system_agent()
        OR EXISTS (
            SELECT 1 
            FROM auth.active_sync_group_sessions sess 
            WHERE sess.auth__agent_id = auth.current_agent_id()
              AND sess.group__sync = tick.script_states.group__sync
        )
    );

CREATE POLICY "script_states_update_policy" ON tick.script_states
    FOR UPDATE
    USING (auth.is_admin_agent());

CREATE POLICY "script_states_insert_policy" ON tick.script_states
    FOR INSERT
    WITH CHECK (auth.is_admin_agent());

CREATE POLICY "script_states_delete_policy" ON tick.script_states
    FOR DELETE
    USING (auth.is_admin_agent());

-- 6.4 ASSET STATES POLICIES
CREATE POLICY "asset_states_read_policy" ON tick.asset_states
    FOR SELECT
    USING (
        auth.is_admin_agent()
        OR auth.is_system_agent()
        OR EXISTS (
            SELECT 1 
            FROM auth.active_sync_group_sessions sess 
            WHERE sess.auth__agent_id = auth.current_agent_id()
              AND sess.group__sync = tick.asset_states.group__sync
        )
    );

CREATE POLICY "asset_states_update_policy" ON tick.asset_states
    FOR UPDATE
    USING (auth.is_admin_agent());

CREATE POLICY "asset_states_insert_policy" ON tick.asset_states
    FOR INSERT
    WITH CHECK (auth.is_admin_agent());

CREATE POLICY "asset_states_delete_policy" ON tick.asset_states
    FOR DELETE
    USING (auth.is_admin_agent());

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
