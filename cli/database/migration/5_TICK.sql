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
    tick__is_delayed boolean NOT NULL,
    tick__headroom_ms double precision,
    tick__time_since_last_tick_ms double precision,

    -- DB-specific metrics
    tick__db__start_time timestamptz,
    tick__db__end_time timestamptz,
    tick__db__duration_ms double precision,
    tick__db__is_delayed boolean,

    -- Manager-specific metrics
    tick__service__start_time timestamptz,
    tick__service__end_time timestamptz,
    tick__service__duration_ms double precision,
    tick__service__is_delayed boolean,

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

-- 2.3 ENTITY METADATA STATES TABLE
CREATE TABLE tick.entity_metadata_states (
    LIKE entity.entity_metadata INCLUDING DEFAULTS EXCLUDING CONSTRAINTS,

    -- Additional metadata for state tracking
    general__tick_id uuid NOT NULL,
    general__metadata_state_id uuid DEFAULT uuid_generate_v4(),

    -- Override the primary key
    CONSTRAINT entity_metadata_states_pkey PRIMARY KEY (general__metadata_state_id),

    -- Add foreign key constraint for sync_group
    CONSTRAINT entity_metadata_states_sync_group_fkey FOREIGN KEY (group__sync)
        REFERENCES auth.sync_groups(general__sync_group),

    -- Add foreign key constraint to world_ticks with cascade delete
    CONSTRAINT entity_metadata_states_tick_fkey FOREIGN KEY (general__tick_id)
        REFERENCES tick.world_ticks(general__tick_id) ON DELETE CASCADE
);

-- ============================================================================
-- 3. INDEXES
-- ============================================================================

-- 3.1 WORLD TICKS INDEXES
CREATE INDEX idx_world_ticks_sync_number ON tick.world_ticks (group__sync, tick__number DESC);
CREATE INDEX idx_world_ticks_sync_time ON tick.world_ticks (group__sync, tick__start_time DESC);

-- 3.2 ENTITY STATES INDEXES
CREATE INDEX entity_states_lookup_idx ON tick.entity_states (general__entity_name, general__tick_id);
CREATE INDEX entity_states_tick_idx ON tick.entity_states (general__tick_id);
CREATE INDEX entity_states_sync_group_tick_idx ON tick.entity_states (group__sync, general__tick_id DESC);
CREATE INDEX idx_entity_states_sync_tick_lookup ON tick.entity_states (group__sync, general__tick_id, general__entity_name);
CREATE INDEX idx_entity_states_sync_tick ON tick.entity_states (group__sync, general__tick_id);

-- Fast lookups of entity states by tick and entity ID
CREATE INDEX idx_entity_states_tick_entity_name ON tick.entity_states (general__tick_id, general__entity_name);

-- 3.3 ENTITY METADATA STATES INDEXES
CREATE INDEX entity_metadata_states_lookup_idx ON tick.entity_metadata_states (general__entity_name, metadata__key, general__tick_id);
CREATE INDEX entity_metadata_states_tick_idx ON tick.entity_metadata_states (general__tick_id);
CREATE INDEX entity_metadata_states_sync_group_tick_idx ON tick.entity_metadata_states (group__sync, general__tick_id DESC);
CREATE INDEX idx_entity_metadata_states_key ON tick.entity_metadata_states (metadata__key);
CREATE INDEX idx_entity_metadata_states_updated ON tick.entity_metadata_states (general__updated_at);

-- Optimized index for finding latest ticks by sync group with covering columns
CREATE INDEX idx_world_ticks_sync_number_covering ON tick.world_ticks
    (group__sync, tick__number DESC)
    INCLUDE (general__tick_id, tick__start_time);

-- Fast timestamp comparisons for entity changes
CREATE INDEX idx_entity_states_updated_at ON tick.entity_states
    (group__sync, general__updated_at DESC)
    INCLUDE (general__entity_name);

-- Space-efficient BRIN index for time-series data
CREATE INDEX idx_world_ticks_time_brin ON tick.world_ticks USING BRIN (tick__start_time);

-- Composite index for tick + sync group lookup patterns
CREATE INDEX idx_entity_states_sync_tick_composite ON tick.entity_states
    (group__sync, general__tick_id)
    INCLUDE (general__entity_name);

-- ============================================================================
-- 4. FUNCTIONS
-- ============================================================================

-- 4.1 TICK CAPTURE FUNCTION - Updated to include timestamp tracking columns
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
    -- Initialize timing variables (no global lock)
    v_start_time := clock_timestamp();
    v_db_start_time := v_start_time;  -- Database processing starts now

    -- Get max tick count buffer from sync group config
    SELECT server__tick__max_tick_count_buffer
    INTO v_max_tick_count_buffer
    FROM auth.sync_groups
    WHERE general__sync_group = p_sync_group;

    -- Shorter transaction for tick number acquisition
    BEGIN
        -- Get last tick information - lock only what we need
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
    END;

    -- Calculate time since last tick
    IF v_last_tick_time IS NOT NULL THEN
        v_time_since_last_tick_ms := EXTRACT(EPOCH FROM (v_start_time - v_last_tick_time)) * 1000;
    END IF;

    -- Clean up in a separate transaction using a more targeted approach
    BEGIN
        DELETE FROM tick.world_ticks wt
        WHERE wt.group__sync = p_sync_group
        AND wt.general__tick_id IN (
            SELECT wt2.general__tick_id
            FROM tick.world_ticks wt2
            WHERE wt2.group__sync = p_sync_group
            AND (
                SELECT COUNT(*)
                FROM tick.world_ticks wt3
                WHERE wt3.group__sync = wt2.group__sync
                  AND wt3.tick__number > wt2.tick__number
            ) >= v_max_tick_count_buffer
        );
    END;

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
        false,
        0,
        v_time_since_last_tick_ms,
        v_db_start_time,
        null,  -- Will update at the end
        0,
        false
    );

    -- Capture entity states and metadata states in a single CTE
    WITH entity_snapshot AS (
        INSERT INTO tick.entity_states (
            general__entity_name,
            general__semantic_version,
            group__load_priority,
            general__initialized_at,
            general__initialized_by,
            general__expiry__delete_since_updated_at_ms,
            general__expiry__delete_since_created_at_ms,
            group__sync,
            general__created_at,
            general__created_by,
            general__updated_at,
            general__updated_by,
            general__tick_id
        )
        SELECT
            e.general__entity_name,
            e.general__semantic_version,
            e.group__load_priority,
            e.general__initialized_at,
            e.general__initialized_by,
            e.general__expiry__delete_since_updated_at_ms,
            e.general__expiry__delete_since_created_at_ms,
            e.group__sync,
            e.general__created_at,
            e.general__created_by,
            e.general__updated_at,
            e.general__updated_by,
            v_tick_id
        FROM entity.entities e
        WHERE e.group__sync = p_sync_group
        RETURNING 1
    ),
    metadata_snapshot AS (
        INSERT INTO tick.entity_metadata_states (
            general__entity_name,
            metadata__key,
            metadata__value,
            group__sync,
            general__created_at,
            general__created_by,
            general__updated_at,
            general__updated_by,
            general__tick_id
        )
        SELECT
            em.general__entity_name,
            em.metadata__key,
            em.metadata__value,
            em.group__sync,
            em.general__created_at,
            em.general__created_by,
            em.general__updated_at,
            em.general__updated_by,
            v_tick_id
        FROM entity.entity_metadata em
        WHERE em.group__sync = p_sync_group
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_entity_states_processed 
    FROM (
        SELECT 1 FROM entity_snapshot
        UNION ALL
        SELECT 1 FROM metadata_snapshot
    ) combined;

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
        v_is_delayed,
        v_headroom_ms,
        v_time_since_last_tick_ms,
        v_db_start_time,
        v_db_end_time,
        v_db_duration_ms,
        v_db_is_delayed;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 5. TRIGGERS
-- ============================================================================

-- 5.1 ENABLE ROW LEVEL SECURITY ON ALL TABLES
ALTER TABLE tick.world_ticks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tick.entity_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE tick.entity_metadata_states ENABLE ROW LEVEL SECURITY;

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

-- 6.3 ENTITY METADATA STATES POLICIES
CREATE POLICY "entity_metadata_states_read_policy" ON tick.entity_metadata_states
    FOR SELECT
    USING (
        auth.is_admin_agent()
        OR auth.is_system_agent()
        OR EXISTS (
            SELECT 1
            FROM auth.active_sync_group_sessions sess
            WHERE sess.auth__agent_id = auth.current_agent_id()
              AND sess.group__sync = tick.entity_metadata_states.group__sync
        )
    );

CREATE POLICY "entity_metadata_states_update_policy" ON tick.entity_metadata_states
    FOR UPDATE
    USING (auth.is_admin_agent());

CREATE POLICY "entity_metadata_states_insert_policy" ON tick.entity_metadata_states
    FOR INSERT
    WITH CHECK (auth.is_admin_agent());

CREATE POLICY "entity_metadata_states_delete_policy" ON tick.entity_metadata_states
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
