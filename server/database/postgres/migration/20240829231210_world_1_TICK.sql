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
    tick__rate_limited boolean DEFAULT false,
    tick__time_since_last_tick_ms double precision,

    -- Add unique constraint for sync_group + tick number combination
    UNIQUE (group__sync, tick__number)

);

-- Lag compensation state history table (now references world_ticks)
CREATE TABLE tick.entity_states (
    LIKE entity.entities INCLUDING DEFAULTS INCLUDING CONSTRAINTS,
    
    -- Additional metadata for state tracking
    general__tick_id uuid NOT NULL REFERENCES tick.world_ticks(general__tick_id),
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

-- Update script states table to match new single-table structure
CREATE TABLE tick.entity_script_states (
    LIKE entity.entity_scripts INCLUDING DEFAULTS INCLUDING CONSTRAINTS,
    
    -- Additional metadata for state tracking
    general__tick_id uuid NOT NULL REFERENCES tick.world_ticks(general__tick_id),
    general__script_state_id uuid DEFAULT uuid_generate_v4(),
    
    -- Override the primary key
    CONSTRAINT entity_script_states_pkey PRIMARY KEY (general__script_state_id),
    
    -- Add foreign key constraint for sync_group
    CONSTRAINT entity_script_states_sync_group_fkey FOREIGN KEY (group__sync) 
        REFERENCES auth.sync_groups(general__sync_group),
        
    -- Add foreign key constraint to world_ticks with cascade delete
    CONSTRAINT entity_script_states_tick_fkey FOREIGN KEY (general__tick_id)
        REFERENCES tick.world_ticks(general__tick_id) ON DELETE CASCADE
);

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
    general__updated_by uuid
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
        es.general__updated_by
    FROM tick.entity_states es
    JOIN latest_tick lt ON es.general__tick_id = lt.general__tick_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get ONLY CHANGED entity states between latest ticks
CREATE OR REPLACE FUNCTION tick.get_changed_entity_states_between_latest_ticks(
    p_sync_group text
) RETURNS TABLE (
    general__entity_id uuid,
    operation operation_enum,
    changes jsonb,
    session_ids uuid[]
) AS $$
DECLARE
    v_current_tick_id uuid;
    v_previous_tick_id uuid;
BEGIN
    -- Get the latest two tick IDs
    SELECT general__tick_id INTO v_current_tick_id
    FROM tick.world_ticks
    WHERE group__sync = p_sync_group
    ORDER BY tick__number DESC
    LIMIT 1;

    SELECT general__tick_id INTO v_previous_tick_id
    FROM tick.world_ticks
    WHERE group__sync = p_sync_group
    AND general__tick_id != v_current_tick_id
    ORDER BY tick__number DESC
    LIMIT 1;

    -- Return changes between these ticks
    RETURN QUERY
    WITH current_states AS (
        SELECT *
        FROM tick.entity_states
        WHERE general__tick_id = v_current_tick_id
    ),
    previous_states AS (
        SELECT *
        FROM tick.entity_states
        WHERE general__tick_id = v_previous_tick_id
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
        auth.get_sync_group_session_ids(p_sync_group)
    FROM current_states cs
    FULL OUTER JOIN previous_states ps ON cs.general__entity_id = ps.general__entity_id
    WHERE cs IS DISTINCT FROM ps;
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
            WHERE general__key = 'tick__buffer_duration_ms'
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
    general__updated_by uuid
) AS $$
BEGIN
    RETURN QUERY
    WITH latest_tick AS (
        SELECT general__tick_id
        FROM tick.world_ticks
        WHERE group__sync = p_sync_group
        ORDER BY tick__number DESC
        LIMIT 1
    )
    SELECT 
        ss.general__script_id,
        ss.group__sync,
        ss.source__repo__entry_path,
        ss.source__repo__url,
        ss.compiled__node__script,
        ss.compiled__node__script_sha256,
        ss.compiled__node__status,
        ss.compiled__node__updated_at,
        ss.compiled__bun__script,
        ss.compiled__bun__script_sha256,
        ss.compiled__bun__status,
        ss.compiled__bun__updated_at,
        ss.compiled__browser__script,
        ss.compiled__browser__script_sha256,
        ss.compiled__browser__status,
        ss.compiled__browser__updated_at,
        ss.general__created_at,
        ss.general__created_by,
        ss.general__updated_at,
        ss.general__updated_by
    FROM tick.entity_script_states ss
    JOIN latest_tick lt ON ss.general__tick_id = lt.general__tick_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get ONLY CHANGED script states between latest two ticks
CREATE OR REPLACE FUNCTION tick.get_changed_script_states_between_latest_ticks(
    p_sync_group text
) RETURNS TABLE (
    script_id uuid,
    operation operation_enum,
    changes jsonb,
    session_ids uuid[]
) AS $$
DECLARE
    v_current_tick_id uuid;
    v_previous_tick_id uuid;
BEGIN
    -- Get the latest two tick IDs
    WITH ordered_ticks AS (
        SELECT general__tick_id
        FROM tick.world_ticks
        WHERE group__sync = p_sync_group
        ORDER BY tick__number DESC
        LIMIT 2
    )
    SELECT general__tick_id INTO v_current_tick_id
    FROM ordered_ticks LIMIT 1;

    SELECT general__tick_id INTO v_previous_tick_id
    FROM ordered_ticks OFFSET 1 LIMIT 1;

    -- Return changes between these ticks
    RETURN QUERY
    WITH current_states AS (
        SELECT *
        FROM tick.entity_script_states
        WHERE general__tick_id = v_current_tick_id
    ),
    previous_states AS (
        SELECT *
        FROM tick.entity_script_states
        WHERE general__tick_id = v_previous_tick_id
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
                    'general__script_id', cs.general__script_id,
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
                    'compiled__browser__updated_at', cs.compiled__browser__updated_at,
                    'general__created_at', cs.general__created_at,
                    'general__created_by', cs.general__created_by,
                    'general__updated_at', cs.general__updated_at,
                    'general__updated_by', cs.general__updated_by
                )
            WHEN cs.general__script_id IS NULL THEN NULL::jsonb
            ELSE jsonb_strip_nulls(jsonb_build_object(
                'source__repo__entry_path', 
                    CASE WHEN cs.source__repo__entry_path IS DISTINCT FROM ps.source__repo__entry_path 
                    THEN cs.source__repo__entry_path END,
                'source__repo__url', 
                    CASE WHEN cs.source__repo__url IS DISTINCT FROM ps.source__repo__url 
                    THEN cs.source__repo__url END,
                'compiled__node__script', 
                    CASE WHEN cs.compiled__node__script IS DISTINCT FROM ps.compiled__node__script 
                    THEN cs.compiled__node__script END,
                'compiled__node__script_sha256', 
                    CASE WHEN cs.compiled__node__script_sha256 IS DISTINCT FROM ps.compiled__node__script_sha256 
                    THEN cs.compiled__node__script_sha256 END,
                'compiled__node__status', 
                    CASE WHEN cs.compiled__node__status IS DISTINCT FROM ps.compiled__node__status 
                    THEN cs.compiled__node__status END,
                'compiled__node__updated_at', 
                    CASE WHEN cs.compiled__node__updated_at IS DISTINCT FROM ps.compiled__node__updated_at 
                    THEN cs.compiled__node__updated_at END,
                'compiled__bun__script', 
                    CASE WHEN cs.compiled__bun__script IS DISTINCT FROM ps.compiled__bun__script 
                    THEN cs.compiled__bun__script END,
                'compiled__bun__script_sha256', 
                    CASE WHEN cs.compiled__bun__script_sha256 IS DISTINCT FROM ps.compiled__bun__script_sha256 
                    THEN cs.compiled__bun__script_sha256 END,
                'compiled__bun__status', 
                    CASE WHEN cs.compiled__bun__status IS DISTINCT FROM ps.compiled__bun__status 
                    THEN cs.compiled__bun__status END,
                'compiled__bun__updated_at', 
                    CASE WHEN cs.compiled__bun__updated_at IS DISTINCT FROM ps.compiled__bun__updated_at 
                    THEN cs.compiled__bun__updated_at END,
                'compiled__browser__script', 
                    CASE WHEN cs.compiled__browser__script IS DISTINCT FROM ps.compiled__browser__script 
                    THEN cs.compiled__browser__script END,
                'compiled__browser__script_sha256', 
                    CASE WHEN cs.compiled__browser__script_sha256 IS DISTINCT FROM ps.compiled__browser__script_sha256 
                    THEN cs.compiled__browser__script_sha256 END,
                'compiled__browser__status', 
                    CASE WHEN cs.compiled__browser__status IS DISTINCT FROM ps.compiled__browser__status 
                    THEN cs.compiled__browser__status END,
                'compiled__browser__updated_at', 
                    CASE WHEN cs.compiled__browser__updated_at IS DISTINCT FROM ps.compiled__browser__updated_at 
                    THEN cs.compiled__browser__updated_at END,
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
        auth.get_sync_group_session_ids(p_sync_group)
    FROM current_states cs
    FULL OUTER JOIN previous_states ps ON cs.general__script_id = ps.general__script_id
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
    tick__rate_limited boolean,
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
    v_rate_limited boolean;
    v_time_since_last_tick_ms double precision;
    v_tick_id uuid;
BEGIN
    -- Get start time
    v_start_time := clock_timestamp();
    
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
    LIMIT 1;

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
        tick__rate_limited,
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
        false,
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

    -- Now capture script states
    WITH script_snapshot AS (
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
            general__tick_id
        )
        SELECT 
            s.general__script_id,
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

    -- Get end time and calculate duration
    v_end_time := clock_timestamp();
    v_duration_ms := EXTRACT(EPOCH FROM (v_end_time - v_start_time)) * 1000;

    -- Calculate if tick is delayed or rate limited based on configuration
    SELECT 
        v_duration_ms > sg.server__tick__rate_ms AS is_delayed,
        v_duration_ms > sg.server__tick__rate_ms * 1.5 AS rate_limited,
        sg.server__tick__rate_ms - v_duration_ms AS headroom_ms
    INTO v_is_delayed, v_rate_limited, v_headroom_ms
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
        tick__headroom_ms = v_headroom_ms,
        tick__rate_limited = v_rate_limited
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
        v_rate_limited,
        v_time_since_last_tick_ms;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

