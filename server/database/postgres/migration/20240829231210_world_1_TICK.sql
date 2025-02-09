-- Create tick schema
CREATE SCHEMA IF NOT EXISTS tick;

-- Performance metrics table (make this the authoritative table)
CREATE TABLE tick.world_ticks (
    general__tick_id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
    tick__number bigint NOT NULL,
    group__sync TEXT NOT NULL REFERENCES auth.sync_groups(general__sync_group),
    tick__start_time timestamptz NOT NULL,
    tick__end_time timestamptz NOT NULL,
    tick__duration_ms double precision NOT NULL,
    tick__states_processed int NOT NULL,
    tick__is_delayed boolean NOT NULL,
    tick__headroom_ms double precision,
    tick__rate_limited boolean DEFAULT false,
    tick__time_since_last_tick_ms double precision,

    general__created_at timestamptz DEFAULT now(),
    general__updated_at timestamptz DEFAULT now(),
    general__created_by UUID DEFAULT auth.current_agent_id(),
    general__updated_by UUID DEFAULT auth.current_agent_id(),

    -- Add unique constraint for sync_group + tick number combination
    UNIQUE (group__sync, tick__number)

);

-- State template table
CREATE TABLE tick.entity_state_template (
    general__tick_id uuid NOT NULL
);

-- Lag compensation state history table (now references world_ticks)
CREATE TABLE tick.entity_states (
    LIKE entity.entities INCLUDING DEFAULTS INCLUDING CONSTRAINTS,
    
    -- Additional metadata for state tracking
    general__entity_state_id uuid DEFAULT uuid_generate_v4(),
    
    -- Override the primary key to allow multiple states per entity
    CONSTRAINT entity_states_pkey PRIMARY KEY (general__entity_state_id),
    
    -- Add foreign key constraint for sync_group
    CONSTRAINT entity_states_sync_group_fkey FOREIGN KEY (group__sync) 
        REFERENCES auth.sync_groups(general__sync_group),
        
    -- Add foreign key constraint to world_ticks with cascade delete
    CONSTRAINT entity_states_tick_fkey FOREIGN KEY (general__tick_id)
        REFERENCES tick.world_ticks(general__tick_id) ON DELETE CASCADE
) INHERITS (tick.entity_state_template);

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

-- Modified function to get entity changes using timestamps
CREATE OR REPLACE FUNCTION tick.get_entity_changes(
    p_sync_group text,
    p_from_time timestamptz DEFAULT NULL,  
    p_to_time timestamptz DEFAULT now()    
) 
RETURNS TABLE (
    entity_id uuid,
    operation operation_enum,
    entity_changes jsonb,
    session_ids uuid[]
)
AS $$
BEGIN
    RETURN QUERY
    WITH current_entities AS (
        SELECT *
        FROM entity.entities
        WHERE group__sync = p_sync_group
    ),
    previous_entities AS (
        SELECT *
        FROM tick.entity_states es
        WHERE es.group__sync = p_sync_group
          AND es.general__tick_id = (
              SELECT general__tick_id 
              FROM tick.world_ticks
              WHERE group__sync = p_sync_group
                AND tick__start_time <= p_from_time
              ORDER BY tick__start_time DESC
              LIMIT 1
          )
    ),
    changed_entities AS (
        SELECT 
            COALESCE(ce.general__entity_id, pe.general__entity_id) AS entity_id,
            CASE 
                WHEN pe.general__entity_id IS NULL THEN 'INSERT'::operation_enum
                WHEN ce.general__entity_id IS NULL THEN 'DELETE'::operation_enum
                ELSE 'UPDATE'::operation_enum
            END AS operation,
            ce.general__name AS current_name,
            ce.general__semantic_version AS current_version,
            ce.general__load_priority AS current_priority,
            ce.general__initialized_at AS current_init_at,
            ce.general__initialized_by AS current_init_by,
            ce.meta__data AS current_meta,
            ce.scripts__ids AS current_scripts,
            ce.scripts__status AS current_status,
            ce.validation__log AS current_log,
            ce.group__sync AS current_sync,
            ce.general__created_at AS current_created_at,
            ce.general__created_by AS current_created_by,
            ce.general__updated_at AS current_updated_at,
            ce.general__updated_by AS current_updated_by,
            pe.general__name AS prev_name,
            pe.general__semantic_version AS prev_version,
            pe.general__load_priority AS prev_priority,
            pe.general__initialized_at AS prev_init_at,
            pe.general__initialized_by AS prev_init_by,
            pe.meta__data AS prev_meta,
            pe.scripts__ids AS prev_scripts,
            pe.scripts__status AS prev_status,
            pe.validation__log AS prev_log,
            pe.group__sync AS prev_sync,
            pe.general__created_at AS prev_created_at,
            pe.general__created_by AS prev_created_by,
            pe.general__updated_at AS prev_updated_at,
            pe.general__updated_by AS prev_updated_by
        FROM current_entities ce
        FULL OUTER JOIN previous_entities pe 
            ON ce.general__entity_id = pe.general__entity_id
        WHERE
            pe.general__entity_id IS NULL
            OR ce.general__entity_id IS NULL
            OR ce.general__name IS DISTINCT FROM pe.general__name
            OR ce.general__semantic_version IS DISTINCT FROM pe.general__semantic_version
            OR ce.general__load_priority IS DISTINCT FROM pe.general__load_priority
            OR ce.general__initialized_at IS DISTINCT FROM pe.general__initialized_at
            OR ce.general__initialized_by IS DISTINCT FROM pe.general__initialized_by
            OR ce.meta__data IS DISTINCT FROM pe.meta__data
            OR ce.scripts__ids IS DISTINCT FROM pe.scripts__ids
            OR ce.scripts__status IS DISTINCT FROM pe.scripts__status
            OR ce.validation__log IS DISTINCT FROM pe.validation__log
            OR ce.group__sync IS DISTINCT FROM pe.group__sync
            OR ce.general__created_at IS DISTINCT FROM pe.general__created_at
            OR ce.general__created_by IS DISTINCT FROM pe.general__created_by
            OR ce.general__updated_at IS DISTINCT FROM pe.general__updated_at
            OR ce.general__updated_by IS DISTINCT FROM pe.general__updated_by
    )
    SELECT
        ce.entity_id,
        ce.operation,
        CASE ce.operation
            WHEN 'INSERT' THEN jsonb_build_object(
                'general__name', ce.current_name,
                'general__semantic_version', ce.current_version,
                'general__load_priority', ce.current_priority,
                'general__initialized_at', ce.current_init_at,
                'general__initialized_by', ce.current_init_by,
                'meta__data', ce.current_meta,
                'scripts__ids', ce.current_scripts,
                'scripts__status', ce.current_status,
                'validation__log', ce.current_log,
                'group__sync', ce.current_sync,
                'general__created_at', ce.current_created_at,
                'general__created_by', ce.current_created_by,
                'general__updated_at', ce.current_updated_at,
                'general__updated_by', ce.current_updated_by
            )
            WHEN 'DELETE' THEN NULL
            ELSE jsonb_strip_nulls(jsonb_build_object(
                'general__name', NULLIF(ce.current_name, ce.prev_name),
                'general__semantic_version', NULLIF(ce.current_version, ce.prev_version),
                'general__load_priority', NULLIF(ce.current_priority, ce.prev_priority),
                'general__initialized_at', NULLIF(ce.current_init_at, ce.prev_init_at),
                'general__initialized_by', NULLIF(ce.current_init_by, ce.prev_init_by),
                'meta__data', NULLIF(ce.current_meta, ce.prev_meta),
                'scripts__ids', NULLIF(ce.current_scripts, ce.prev_scripts),
                'scripts__status', NULLIF(ce.current_status, ce.prev_status),
                'validation__log', NULLIF(ce.current_log, ce.prev_log),
                'group__sync', NULLIF(ce.current_sync, ce.prev_sync),
                'general__created_at', NULLIF(ce.current_created_at, ce.prev_created_at),
                'general__created_by', NULLIF(ce.current_created_by, ce.prev_created_by),
                'general__updated_at', NULLIF(ce.current_updated_at, ce.prev_updated_at),
                'general__updated_by', NULLIF(ce.current_updated_by, ce.prev_updated_by)
            ))
        END AS entity_changes,
        auth.get_sync_group_session_ids(p_sync_group)
    FROM changed_entities ce;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update script states table to match new single-table structure
CREATE TABLE tick.entity_script_states (
    LIKE entity.entity_scripts INCLUDING DEFAULTS INCLUDING CONSTRAINTS,
    
    -- Additional metadata for state tracking
    general__script_state_id uuid DEFAULT uuid_generate_v4(),
    
    -- Override the primary key
    CONSTRAINT entity_script_states_pkey PRIMARY KEY (general__script_state_id),
    
    -- Add foreign key constraint for sync_group
    CONSTRAINT entity_script_states_sync_group_fkey FOREIGN KEY (group__sync) 
        REFERENCES auth.sync_groups(general__sync_group),
        
    -- Add foreign key constraint to world_ticks with cascade delete
    CONSTRAINT entity_script_states_tick_fkey FOREIGN KEY (general__tick_id)
        REFERENCES tick.world_ticks(general__tick_id) ON DELETE CASCADE
) INHERITS (tick.entity_state_template);

-- Create indexes for script states
CREATE INDEX entity_script_states_lookup_idx ON tick.entity_script_states (general__script_id, general__tick_id);
CREATE INDEX entity_script_states_tick_idx ON tick.entity_script_states (general__tick_id);
CREATE INDEX entity_script_states_sync_group_tick_idx 
    ON tick.entity_script_states (group__sync, general__tick_id DESC);

-- Enable RLS on script states
ALTER TABLE tick.entity_script_states ENABLE ROW LEVEL SECURITY;

-- Add policies for script states (matching entity_scripts policies)
CREATE POLICY "script_states_view_policy" ON tick.entity_script_states
    FOR SELECT
    USING (
        auth.is_admin_agent()
        OR auth.has_sync_group_read_access(group__sync)
    );

CREATE POLICY "script_states_update_policy" ON tick.entity_script_states
    FOR UPDATE
    USING (auth.is_admin_agent());

CREATE POLICY "script_states_insert_policy" ON tick.entity_script_states
    FOR INSERT
    WITH CHECK (auth.is_admin_agent());

CREATE POLICY "script_states_delete_policy" ON tick.entity_script_states
    FOR DELETE
    USING (auth.is_admin_agent());

-- Similarly modify script changes function
CREATE OR REPLACE FUNCTION tick.get_script_changes(
    p_sync_group text,
    p_from_time timestamptz DEFAULT NULL,
    p_to_time timestamptz DEFAULT now()
) 
RETURNS TABLE (
    script_id uuid,
    operation operation_enum,
    script_changes jsonb,
    session_ids uuid[]
) AS $$
DECLARE
    v_from_tick_id uuid;
    v_to_tick_id uuid;
BEGIN
    -- Get the nearest tick IDs based on timestamps
    SELECT general__tick_id INTO v_to_tick_id
    FROM tick.world_ticks
    WHERE group__sync = p_sync_group
      AND tick__start_time <= p_to_time
    ORDER BY tick__start_time DESC
    LIMIT 1;

    IF p_from_time IS NOT NULL THEN
        SELECT general__tick_id INTO v_from_tick_id
        FROM tick.world_ticks
        WHERE group__sync = p_sync_group
          AND tick__start_time <= p_from_time
        ORDER BY tick__start_time DESC
        LIMIT 1;
    END IF;

    -- If no from_tick specified, get changes since last tick
    IF v_from_tick_id IS NULL THEN
        SELECT general__tick_id INTO v_from_tick_id
        FROM tick.world_ticks
        WHERE group__sync = p_sync_group
          AND general__tick_id != v_to_tick_id
        ORDER BY tick__start_time DESC
        LIMIT 1;
    END IF;

    RETURN QUERY
    SELECT * FROM tick.get_script_state_changes(p_sync_group, v_from_tick_id, v_to_tick_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 1. Simplified capture_tick_state function (just captures current state)
CREATE OR REPLACE FUNCTION tick.capture_tick_state(p_sync_group text)
RETURNS uuid AS $$
DECLARE
    current_tick bigint;
    tick_start timestamptz;
    tick_end timestamptz;
    tick_duration double precision;
    entity_states_inserted int;
    script_states_inserted int;
    is_delayed boolean;
    headroom double precision;
    tick_rate_ms int;
    last_tick bigint;
    last_tick_time timestamptz;
    time_since_last_tick double precision;
    v_tick_id uuid;
BEGIN
    -- Validate sync group
    IF NOT EXISTS (
        SELECT 1 FROM auth.sync_groups 
        WHERE general__sync_group = p_sync_group
    ) THEN
        RAISE EXCEPTION 'Invalid sync group: %', p_sync_group;
    END IF;

    tick_start := clock_timestamp();
    
    -- Get sync group configuration
    SELECT server__tick__rate_ms INTO tick_rate_ms 
    FROM auth.sync_groups 
    WHERE general__sync_group = p_sync_group;
    
    -- Calculate current tick number
    SELECT COALESCE(MAX(tick__number), 0) + 1 INTO current_tick
    FROM tick.world_ticks
    WHERE group__sync = p_sync_group;
    
    -- Get last tick info
    SELECT 
        tick__number,
        tick__end_time
    INTO last_tick, last_tick_time
    FROM tick.world_ticks
    WHERE group__sync = p_sync_group
    ORDER BY tick__number DESC
    LIMIT 1;

    -- Calculate time since last tick
    time_since_last_tick := CASE 
        WHEN last_tick_time IS NOT NULL 
        THEN EXTRACT(EPOCH FROM (tick_start - last_tick_time)) * 1000 
        ELSE tick_rate_ms 
    END;

    -- Create new tick record with explicit type cast for tick__number
    INSERT INTO tick.world_ticks (
        tick__number,
        group__sync,
        tick__start_time,
        tick__end_time,
        tick__duration_ms,
        tick__states_processed,
        tick__is_delayed
    ) VALUES (
        current_tick::bigint,  -- Explicit cast to bigint
        p_sync_group,
        tick_start,
        tick_start,
        0,
        0,
        false
    ) RETURNING general__tick_id INTO v_tick_id;

    -- Capture entity states
    WITH inserted_entities AS (
        INSERT INTO tick.entity_states (
            general__entity_id,
            general__name,
            general__semantic_version,
            general__created_at,
            general__created_by,
            general__updated_at,
            general__updated_by,
            general__load_priority,
            general__initialized_at,
            general__initialized_by,
            meta__data,
            scripts__ids,
            scripts__status,
            validation__log,
            group__sync,
            general__entity_state_id,
            general__tick_id
        )
        SELECT 
            e.general__entity_id,
            e.general__name,
            e.general__semantic_version,
            e.general__created_at,
            e.general__created_by,
            e.general__updated_at,
            e.general__updated_by,
            e.general__load_priority,
            e.general__initialized_at,
            e.general__initialized_by,
            e.meta__data,
            e.scripts__ids,
            e.scripts__status,
            e.validation__log,
            e.group__sync,
            uuid_generate_v4(),
            v_tick_id
        FROM entity.entities e
        WHERE e.group__sync = p_sync_group
        RETURNING 1
    )
    SELECT COUNT(*) INTO entity_states_inserted FROM inserted_entities;

    -- Capture script states
    WITH inserted_scripts AS (
        INSERT INTO tick.entity_script_states (
            general__script_id,
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
            general__script_state_id,
            general__tick_id
        )
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
            uuid_generate_v4(),
            v_tick_id
        FROM entity.entity_scripts es
        WHERE es.group__sync = p_sync_group
        RETURNING 1
    )
    SELECT COUNT(*) INTO script_states_inserted FROM inserted_scripts;

    -- Update tick metrics
    tick_end := clock_timestamp();
    tick_duration := EXTRACT(EPOCH FROM (tick_end - tick_start)) * 1000.0;
    is_delayed := tick_duration > tick_rate_ms;
    headroom := GREATEST(tick_rate_ms - tick_duration, 0.0);

    -- Update tick record with final metrics
    UPDATE tick.world_ticks SET
        tick__end_time = tick_end,
        tick__duration_ms = tick_duration,
        tick__states_processed = entity_states_inserted + script_states_inserted,
        tick__is_delayed = is_delayed,
        tick__headroom_ms = headroom,
        tick__time_since_last_tick_ms = time_since_last_tick,
        tick__rate_limited = (tick_duration > tick_rate_ms)
    WHERE general__tick_id = v_tick_id;

    RETURN v_tick_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. New function to get entity state changes between ticks
CREATE OR REPLACE FUNCTION tick.get_entity_state_changes(
    p_sync_group text,
    p_from_tick_id uuid,
    p_to_tick_id uuid
)
RETURNS TABLE (
    entity_id uuid,
    operation operation_enum,
    entity_changes jsonb,
    session_ids uuid[]
) AS $$
BEGIN
    RETURN QUERY
    WITH current_states AS (
        SELECT *
        FROM tick.entity_states
        WHERE general__tick_id = p_to_tick_id
    ),
    previous_states AS (
        SELECT *
        FROM tick.entity_states
        WHERE general__tick_id = p_from_tick_id
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
                    'general__name', cs.general__name,
                    'meta__data', cs.meta__data
                    -- Add other fields as needed
                )
            WHEN cs.general__entity_id IS NULL THEN 
                NULL
            ELSE 
                jsonb_strip_nulls(jsonb_build_object(
                    'general__name', NULLIF(cs.general__name, ps.general__name),
                    'meta__data', NULLIF(cs.meta__data, ps.meta__data)
                    -- Add other fields as needed
                ))
        END,
        auth.get_sync_group_session_ids(p_sync_group)
    FROM current_states cs
    FULL OUTER JOIN previous_states ps ON cs.general__entity_id = ps.general__entity_id
    WHERE cs IS DISTINCT FROM ps;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. New function to get script state changes between ticks
CREATE OR REPLACE FUNCTION tick.get_script_state_changes(
    p_sync_group text,
    p_from_tick_id uuid,
    p_to_tick_id uuid
)
RETURNS TABLE (
    script_id uuid,
    operation operation_enum,
    script_changes jsonb,
    session_ids uuid[]
) AS $$
BEGIN
    RETURN QUERY
    WITH current_states AS (
        SELECT *
        FROM tick.entity_script_states
        WHERE general__tick_id = p_to_tick_id
    ),
    previous_states AS (
        SELECT *
        FROM tick.entity_script_states
        WHERE general__tick_id = p_from_tick_id
    )
    SELECT 
        COALESCE(cs.general__script_id, ps.general__script_id),
        CASE 
            WHEN ps.general__script_id IS NULL THEN 'INSERT'::operation_enum
            WHEN cs.general__script_id IS NULL THEN 'DELETE'::operation_enum
            ELSE 'UPDATE'::operation_enum
        END,
        CASE 
            WHEN ps.general__script_id IS NULL THEN 
                jsonb_build_object(
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
                    'compiled__browser__updated_at', cs.compiled__browser__updated_at,
                    'group__sync', cs.group__sync
                )
            WHEN cs.general__script_id IS NULL THEN 
                NULL
            ELSE 
                jsonb_strip_nulls(jsonb_build_object(
                    'source__repo__entry_path', NULLIF(cs.source__repo__entry_path, ps.source__repo__entry_path),
                    'source__repo__url', NULLIF(cs.source__repo__url, ps.source__repo__url),
                    'compiled__node__script', NULLIF(cs.compiled__node__script, ps.compiled__node__script),
                    'compiled__node__script_sha256', NULLIF(cs.compiled__node__script_sha256, ps.compiled__node__script_sha256),
                    'compiled__node__status', NULLIF(cs.compiled__node__status, ps.compiled__node__status),
                    'compiled__node__updated_at', NULLIF(cs.compiled__node__updated_at, ps.compiled__node__updated_at),
                    'compiled__bun__script', NULLIF(cs.compiled__bun__script, ps.compiled__bun__script),
                    'compiled__bun__script_sha256', NULLIF(cs.compiled__bun__script_sha256, ps.compiled__bun__script_sha256),
                    'compiled__bun__status', NULLIF(cs.compiled__bun__status, ps.compiled__bun__status),
                    'compiled__bun__updated_at', NULLIF(cs.compiled__bun__updated_at, ps.compiled__bun__updated_at),
                    'compiled__browser__script', NULLIF(cs.compiled__browser__script, ps.compiled__browser__script),
                    'compiled__browser__script_sha256', NULLIF(cs.compiled__browser__script_sha256, ps.compiled__browser__script_sha256),
                    'compiled__browser__status', NULLIF(cs.compiled__browser__status, ps.compiled__browser__status),
                    'compiled__browser__updated_at', NULLIF(cs.compiled__browser__updated_at, ps.compiled__browser__updated_at),
                    'group__sync', NULLIF(cs.group__sync, ps.group__sync)
                ))
        END,
        auth.get_sync_group_session_ids(p_sync_group)
    FROM current_states cs
    FULL OUTER JOIN previous_states ps ON cs.general__script_id = ps.general__script_id
    WHERE cs IS DISTINCT FROM ps;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Modified function to get latest entity states for a sync group
CREATE OR REPLACE FUNCTION tick.get_latest_entity_states(
    p_sync_group text,
    p_at_time timestamptz DEFAULT now()
) RETURNS TABLE (
    entity_id uuid,
    entity_state jsonb
) AS $$
BEGIN
    RETURN QUERY
    WITH latest_tick AS (
        SELECT general__tick_id
        FROM tick.world_ticks
        WHERE group__sync = p_sync_group
          AND tick__start_time <= p_at_time
        ORDER BY tick__start_time DESC
        LIMIT 1
    )
    SELECT 
        es.general__entity_id,
        jsonb_build_object(
            'general__name', es.general__name,
            'meta__data', es.meta__data,
            'scripts__ids', es.scripts__ids,
            'scripts__status', es.scripts__status
            -- Add other fields as needed
        ) AS entity_state
    FROM tick.entity_states es
    JOIN latest_tick lt ON es.general__tick_id = lt.general__tick_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Modified function to get latest script states
CREATE OR REPLACE FUNCTION tick.get_latest_entity_script_states(
    p_sync_group text,
    p_at_time timestamptz DEFAULT now()
) RETURNS TABLE (
    script_id uuid,
    script_state jsonb
) AS $$
BEGIN
    RETURN QUERY
    WITH latest_tick AS (
        SELECT general__tick_id
        FROM tick.world_ticks
        WHERE group__sync = p_sync_group
          AND tick__start_time <= p_at_time
        ORDER BY tick__start_time DESC
        LIMIT 1
    )
    SELECT 
        ess.general__script_id,
        jsonb_build_object(
            'source__repo__entry_path', ess.source__repo__entry_path,
            'source__repo__url', ess.source__repo__url,
            'compiled__node__script', ess.compiled__node__script,
            'compiled__node__script_sha256', ess.compiled__node__script_sha256,
            'compiled__node__status', ess.compiled__node__status,
            'compiled__node__updated_at', ess.compiled__node__updated_at,
            'compiled__bun__script', ess.compiled__bun__script,
            'compiled__bun__script_sha256', ess.compiled__bun__script_sha256,
            'compiled__bun__status', ess.compiled__bun__status,
            'compiled__bun__updated_at', ess.compiled__bun__updated_at,
            'compiled__browser__script', ess.compiled__browser__script,
            'compiled__browser__script_sha256', ess.compiled__browser__script_sha256,
            'compiled__browser__status', ess.compiled__browser__status,
            'compiled__browser__updated_at', ess.compiled__browser__updated_at,
            'group__sync', ess.group__sync,
            'general__created_at', ess.general__created_at,
            'general__created_by', ess.general__created_by,
            'general__updated_at', ess.general__updated_at,
            'general__updated_by', ess.general__updated_by
        ) AS script_state
    FROM tick.entity_script_states ess
    JOIN latest_tick lt ON ess.general__tick_id = lt.general__tick_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Replace both cleanup functions with a single, simpler function
CREATE OR REPLACE FUNCTION tick.cleanup_old_ticks()
RETURNS void AS $$
DECLARE
    ticks_cleaned integer;
BEGIN
    -- Replace system role check with is_admin_agent()
    IF NOT auth.is_admin_agent() THEN
        RAISE EXCEPTION 'Permission denied: Admin permission required';
    END IF;

    -- Clean old ticks (entity states will be cleaned via CASCADE)
    WITH deleted_ticks AS (
        DELETE FROM tick.world_ticks 
        WHERE general__created_at < (now() - (
            SELECT (value#>>'{}'::text[])::int * interval '1 millisecond' 
            FROM config.config 
            WHERE key = 'world_ticks_history_ms'
        ))
        RETURNING *
    )
    SELECT COUNT(*) INTO ticks_cleaned FROM deleted_ticks;
    
    -- Log cleanup results if anything was cleaned
    IF ticks_cleaned > 0 THEN
        RAISE NOTICE 'Tick cleanup completed: % ticks removed (entity states cascade deleted)', ticks_cleaned;
    END IF;
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

-- Create function to update timestamp
CREATE OR REPLACE FUNCTION tick.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.general__updated_at = CURRENT_TIMESTAMP;
    NEW.general__updated_by = auth.current_agent_id();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for entity_sync_groups
CREATE TRIGGER update_entity_states_updated_at
    BEFORE UPDATE ON tick.entity_states
    FOR EACH ROW
    EXECUTE FUNCTION tick.update_updated_at();

CREATE TRIGGER update_world_ticks_updated_at
    BEFORE UPDATE ON tick.world_ticks
    FOR EACH ROW
    EXECUTE FUNCTION tick.update_updated_at();

-- Add optimized indexes for the tick system
CREATE INDEX idx_entity_states_sync_tick_lookup 
    ON tick.entity_states (group__sync, general__tick_id, general__entity_id);

-- Add optimized indexes instead
CREATE INDEX idx_world_ticks_sync_number ON tick.world_ticks (group__sync, tick__number DESC);
CREATE INDEX idx_entity_states_sync_tick ON tick.entity_states (group__sync, general__tick_id);
CREATE INDEX idx_script_states_sync_tick ON tick.entity_script_states (group__sync, general__tick_id);

-- Add index to support timestamp-based queries
CREATE INDEX idx_world_ticks_sync_time 
    ON tick.world_ticks (group__sync, tick__start_time DESC);
