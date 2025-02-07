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

-- Update the get_entity_changes function to use the new session lookup
CREATE OR REPLACE FUNCTION tick.get_entity_changes(
    p_sync_group text,
    p_last_tick bigint,
    p_current_tick bigint
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
        -- Get the current entity state from the main table, only in the relevant sync group
        SELECT *
        FROM entity.entities
        WHERE group__sync = p_sync_group
    ),
    previous_entities AS (
        -- Get the previous entity state (from the entity_states table) for that same sync group/tick
        SELECT es.*
        FROM tick.entity_states es
        JOIN tick.world_ticks wt ON es.general__tick_id = wt.general__tick_id
        WHERE es.group__sync = p_sync_group
          AND wt.tick__number = p_last_tick
    ),
    changed_entities AS (
        SELECT 
            /* If ce is NULL => DELETE; if pe is NULL => INSERT; otherwise check changes => UPDATE */
            COALESCE(ce.general__entity_id, pe.general__entity_id) AS entity_id,
            CASE 
                WHEN pe.general__entity_id IS NULL THEN 'INSERT'::operation_enum
                WHEN ce.general__entity_id IS NULL THEN 'DELETE'::operation_enum
                WHEN (
                    ce.general__name IS DISTINCT FROM pe.general__name OR
                    ce.general__semantic_version IS DISTINCT FROM pe.general__semantic_version OR
                    ce.general__created_at IS DISTINCT FROM pe.general__created_at OR
                    ce.general__created_by IS DISTINCT FROM pe.general__created_by OR
                    ce.general__updated_at IS DISTINCT FROM pe.general__updated_at OR
                    ce.general__updated_by IS DISTINCT FROM pe.general__updated_by OR
                    ce.general__load_priority IS DISTINCT FROM pe.general__load_priority OR
                    ce.general__initialized_at IS DISTINCT FROM pe.general__initialized_at OR
                    ce.general__initialized_by IS DISTINCT FROM pe.general__initialized_by OR
                    ce.meta__data IS DISTINCT FROM pe.meta__data OR
                    ce.scripts__ids IS DISTINCT FROM pe.scripts__ids OR
                    ce.scripts__status IS DISTINCT FROM pe.scripts__status OR
                    ce.validation__log IS DISTINCT FROM pe.validation__log OR
                    ce.group__sync IS DISTINCT FROM pe.group__sync
                ) THEN 'UPDATE'::operation_enum
            END AS operation,

            /*
              Instead of ce.* and pe.* (which would cause duplicate column names),
              give each column a unique alias.
            */

            -- "ce" columns (the current state)
            ce.general__entity_id         AS ce_general__entity_id,
            ce.general__name              AS ce_general__name,
            ce.general__semantic_version  AS ce_general__semantic_version,
            ce.general__created_at        AS ce_general__created_at,
            ce.general__created_by        AS ce_general__created_by,
            ce.general__updated_at        AS ce_general__updated_at,
            ce.general__updated_by        AS ce_general__updated_by,
            ce.general__load_priority     AS ce_general__load_priority,
            ce.general__initialized_at    AS ce_general__initialized_at,
            ce.general__initialized_by    AS ce_general__initialized_by,
            ce.meta__data                 AS ce_meta__data,
            ce.scripts__ids               AS ce_scripts__ids,
            ce.scripts__status            AS ce_scripts__status,
            ce.validation__log            AS ce_validation__log,
            ce.group__sync    AS ce_group__sync,

            -- "pe" columns (the previous state)
            pe.general__entity_id         AS pe_general__entity_id,
            pe.general__name              AS pe_general__name,
            pe.general__semantic_version  AS pe_general__semantic_version,
            pe.general__created_at        AS pe_general__created_at,
            pe.general__created_by        AS pe_general__created_by,
            pe.general__updated_at        AS pe_general__updated_at,
            pe.general__updated_by        AS pe_general__updated_by,
            pe.general__load_priority     AS pe_general__load_priority,
            pe.general__initialized_at    AS pe_general__initialized_at,
            pe.general__initialized_by    AS pe_general__initialized_by,
            pe.meta__data                 AS pe_meta__data,
            pe.scripts__ids               AS pe_scripts__ids,
            pe.scripts__status            AS pe_scripts__status,
            pe.validation__log            AS pe_validation__log,
            pe.group__sync    AS pe_group__sync

        FROM current_entities ce
        FULL OUTER JOIN previous_entities pe 
            ON ce.general__entity_id = pe.general__entity_id
        WHERE
            /* We want rows for inserts (pe == NULL), deletes (ce == NULL), or anything changed */
            pe.general__entity_id IS NULL
            OR ce.general__entity_id IS NULL
            OR ce.general__name IS DISTINCT FROM pe.general__name
            OR ce.general__semantic_version IS DISTINCT FROM pe.general__semantic_version
            OR ce.general__created_at IS DISTINCT FROM pe.general__creat3ed_at
            OR ce.general__created_by IS DISTINCT FROM pe.general__created_by
            OR ce.general__updated_at IS DISTINCT FROM pe.general__updated_at
            OR ce.general__updated_by IS DISTINCT FROM pe.general__updated_by
            OR ce.general__load_priority IS DISTINCT FROM pe.general__load_priority
            OR ce.general__initialized_at IS DISTINCT FROM pe.general__initialized_at
            OR ce.general__initialized_by IS DISTINCT FROM pe.general__initialized_by
            OR ce.meta__data IS DISTINCT FROM pe.meta__data
            OR ce.scripts__ids IS DISTINCT FROM pe.scripts__ids
            OR ce.scripts__status IS DISTINCT FROM pe.scripts__status
            OR ce.validation__log IS DISTINCT FROM pe.validation__log
            OR ce.group__sync IS DISTINCT FROM pe.group__sync
    )
    SELECT
        changed_entities.entity_id,
        changed_entities.operation,
        CASE changed_entities.operation
            WHEN 'INSERT' THEN jsonb_build_object(
                'general__name',              changed_entities.ce_general__name,
                'general__semantic_version',   changed_entities.ce_general__semantic_version,
                'general__created_at',         changed_entities.ce_general__created_at,
                'general__created_by',         changed_entities.ce_general__created_by,
                'general__updated_at',         changed_entities.ce_general__updated_at,
                'general__updated_by',         changed_entities.ce_general__updated_by,
                'general__load_priority',      changed_entities.ce_general__load_priority,
                'general__initialized_at',     changed_entities.ce_general__initialized_at,
                'general__initialized_by',     changed_entities.ce_general__initialized_by,
                'meta__data',                  changed_entities.ce_meta__data,
                'scripts__ids',                changed_entities.ce_scripts__ids,
                'scripts__status',             changed_entities.ce_scripts__status,
                'validation__log',             changed_entities.ce_validation__log,
                'group__sync',     changed_entities.ce_group__sync
            )
            WHEN 'DELETE' THEN NULL
            ELSE jsonb_strip_nulls(jsonb_build_object(
                'general__name',              NULLIF(changed_entities.ce_general__name, changed_entities.pe_general__name),
                'general__semantic_version',   NULLIF(changed_entities.ce_general__semantic_version, changed_entities.pe_general__semantic_version),
                'general__created_at',         NULLIF(changed_entities.ce_general__created_at, changed_entities.pe_general__created_at),
                'general__created_by',         NULLIF(changed_entities.ce_general__created_by, changed_entities.pe_general__created_by),
                'general__updated_at',         NULLIF(changed_entities.ce_general__updated_at, changed_entities.pe_general__updated_at),
                'general__updated_by',         NULLIF(changed_entities.ce_general__updated_by, changed_entities.pe_general__updated_by),
                'general__load_priority',      NULLIF(changed_entities.ce_general__load_priority, changed_entities.pe_general__load_priority),
                'general__initialized_at',     NULLIF(changed_entities.ce_general__initialized_at, changed_entities.pe_general__initialized_at),
                'general__initialized_by',     NULLIF(changed_entities.ce_general__initialized_by, changed_entities.pe_general__initialized_by),
                'meta__data',                  NULLIF(changed_entities.ce_meta__data, changed_entities.pe_meta__data),
                'scripts__ids',                NULLIF(changed_entities.ce_scripts__ids, changed_entities.pe_scripts__ids),
                'scripts__status',             NULLIF(changed_entities.ce_scripts__status, changed_entities.pe_scripts__status),
                'validation__log',             NULLIF(changed_entities.ce_validation__log, changed_entities.pe_validation__log),
                'group__sync',   NULLIF(changed_entities.ce_group__sync, changed_entities.pe_group__sync)
            ))
        END AS entity_changes,
        auth.get_sync_group_session_ids(p_sync_group)
    FROM changed_entities;
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

-- Update the get_script_changes function to use simplified structure
CREATE OR REPLACE FUNCTION tick.get_script_changes(
    p_sync_group text,
    p_last_tick bigint,
    p_current_tick bigint
) 
RETURNS TABLE (
    script_id uuid,
    operation operation_enum,
    script_changes jsonb,
    session_ids uuid[]
) AS $$
BEGIN
    RETURN QUERY
    WITH current_scripts AS (
        SELECT *
          FROM entity.entity_scripts
         WHERE group__sync = p_sync_group
    ),
    previous_scripts AS (
        SELECT ess.*
          FROM tick.entity_script_states ess
          JOIN tick.world_ticks wt 
            ON ess.general__tick_id = wt.general__tick_id
         WHERE ess.group__sync = p_sync_group
           AND wt.tick__number = p_last_tick
    ),
    changed_scripts AS (
        SELECT 
            COALESCE(cs.general__script_id, ps.general__script_id) AS script_id,
            CASE 
                WHEN ps.general__script_id IS NULL THEN 'INSERT'::operation_enum
                WHEN cs.general__script_id IS NULL THEN 'DELETE'::operation_enum
                WHEN (
                    cs.general__created_at IS DISTINCT FROM ps.general__created_at OR
                    cs.general__created_by IS DISTINCT FROM ps.general__created_by OR
                    cs.general__updated_at IS DISTINCT FROM ps.general__updated_at OR
                    cs.general__updated_by IS DISTINCT FROM ps.general__updated_by OR
                    cs.group__sync IS DISTINCT FROM ps.group__sync OR
                    cs.source__repo__entry_path IS DISTINCT FROM ps.source__repo__entry_path OR
                    cs.source__repo__url IS DISTINCT FROM ps.source__repo__url OR
                    cs.compiled__node__script IS DISTINCT FROM ps.compiled__node__script OR
                    cs.compiled__node__script_sha256 IS DISTINCT FROM ps.compiled__node__script_sha256 OR
                    cs.compiled__node__status IS DISTINCT FROM ps.compiled__node__status OR
                    cs.compiled__node__updated_at IS DISTINCT FROM ps.compiled__node__updated_at OR
                    cs.compiled__bun__script IS DISTINCT FROM ps.compiled__bun__script OR
                    cs.compiled__bun__script_sha256 IS DISTINCT FROM ps.compiled__bun__script_sha256 OR
                    cs.compiled__bun__status IS DISTINCT FROM ps.compiled__bun__status OR
                    cs.compiled__bun__updated_at IS DISTINCT FROM ps.compiled__bun__updated_at OR
                    cs.compiled__browser__script IS DISTINCT FROM ps.compiled__browser__script OR
                    cs.compiled__browser__script_sha256 IS DISTINCT FROM ps.compiled__browser__script_sha256 OR
                    cs.compiled__browser__status IS DISTINCT FROM ps.compiled__browser__status OR
                    cs.compiled__browser__updated_at IS DISTINCT FROM ps.compiled__browser__updated_at
                ) THEN 'UPDATE'::operation_enum
            END AS operation,

            -- Current script columns
            cs.*,
            -- Previous script columns
            ps.*

        FROM current_scripts cs
        FULL OUTER JOIN previous_scripts ps 
          ON cs.general__script_id = ps.general__script_id
        WHERE 
            ps.general__script_id IS NULL 
         OR cs.general__script_id IS NULL 
         OR cs.general__created_at IS DISTINCT FROM ps.general__created_at
         OR cs.general__created_by IS DISTINCT FROM ps.general__created_by
         OR cs.general__updated_at IS DISTINCT FROM ps.general__updated_at
         OR cs.general__updated_by IS DISTINCT FROM ps.general__updated_by
         OR cs.group__sync IS DISTINCT FROM ps.group__sync
         OR cs.source__repo__entry_path IS DISTINCT FROM ps.source__repo__entry_path
         OR cs.source__repo__url IS DISTINCT FROM ps.source__repo__url
         OR cs.compiled__node__script IS DISTINCT FROM ps.compiled__node__script
         OR cs.compiled__node__script_sha256 IS DISTINCT FROM ps.compiled__node__script_sha256
         OR cs.compiled__node__status IS DISTINCT FROM ps.compiled__node__status
         OR cs.compiled__node__updated_at IS DISTINCT FROM ps.compiled__node__updated_at
         OR cs.compiled__bun__script IS DISTINCT FROM ps.compiled__bun__script
         OR cs.compiled__bun__script_sha256 IS DISTINCT FROM ps.compiled__bun__script_sha256
         OR cs.compiled__bun__status IS DISTINCT FROM ps.compiled__bun__status
         OR cs.compiled__bun__updated_at IS DISTINCT FROM ps.compiled__bun__updated_at
         OR cs.compiled__browser__script IS DISTINCT FROM ps.compiled__browser__script
         OR cs.compiled__browser__script_sha256 IS DISTINCT FROM ps.compiled__browser__script_sha256
         OR cs.compiled__browser__status IS DISTINCT FROM ps.compiled__browser__status
         OR cs.compiled__browser__updated_at IS DISTINCT FROM ps.compiled__browser__updated_at
    )
    SELECT 
        changed_scripts.script_id,
        changed_scripts.operation,
        CASE changed_scripts.operation
            WHEN 'INSERT' THEN jsonb_build_object(
                'general__created_at', cs.general__created_at,
                'general__created_by', cs.general__created_by,
                'general__updated_at', cs.general__updated_at,
                'general__updated_by', cs.general__updated_by,
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
            )
            WHEN 'DELETE' THEN NULL
            ELSE jsonb_strip_nulls(jsonb_build_object(
                'general__created_at', NULLIF(cs.general__created_at, ps.general__created_at),
                'general__created_by', NULLIF(cs.general__created_by, ps.general__created_by),
                'general__updated_at', NULLIF(cs.general__updated_at, ps.general__updated_at),
                'general__updated_by', NULLIF(cs.general__updated_by, ps.general__updated_by),
                'group__sync', NULLIF(cs.group__sync, ps.group__sync),
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
                'compiled__browser__updated_at', NULLIF(cs.compiled__browser__updated_at, ps.compiled__browser__updated_at)
            ))
        END AS script_changes,
        auth.get_sync_group_session_ids(p_sync_group)
    FROM changed_scripts;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update the capture_tick_state function to handle simplified script structure
CREATE OR REPLACE FUNCTION tick.capture_tick_state(p_sync_group text)
RETURNS jsonb AS $$
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
    v_entity_updates jsonb;
    v_script_updates jsonb;
    v_tick_id uuid;
BEGIN
    -- Add sync group validation at the start
    IF NOT EXISTS (
        SELECT 1 FROM entity.entity_sync_groups 
        WHERE sync_group = p_sync_group
    ) THEN
        RAISE EXCEPTION 'Invalid sync group: %', p_sync_group;
    END IF;

    -- Initialize tick data
    tick_start := clock_timestamp();
    
    -- Get sync groups configuration
    SELECT server__tick__rate_ms INTO tick_rate_ms 
    FROM entity.entity_sync_groups 
    WHERE sync_group = p_sync_group;
    
    -- Calculate current tick number
    SELECT COALESCE(MAX(tick__number), 0) + 1 INTO current_tick
    FROM tick.world_ticks
    WHERE group__sync = p_sync_group;
    
    -- Get the last tick number for this sync group
    SELECT COALESCE(MAX(wt.tick__number), current_tick - 1) INTO last_tick
    FROM tick.entity_states es
    JOIN tick.world_ticks wt ON es.general__tick_id = wt.general__tick_id
    WHERE es.group__sync = p_sync_group;

    -- Get the last tick's timestamp
    SELECT tick__end_time INTO last_tick_time
    FROM tick.world_ticks
    WHERE group__sync = p_sync_group
    AND tick__number = last_tick;

    -- Calculate time since last tick
    time_since_last_tick := CASE 
        WHEN last_tick_time IS NOT NULL 
        THEN EXTRACT(EPOCH FROM (tick_start - last_tick_time)) * 1000 
        ELSE tick_rate_ms 
    END;

    -- Create new tick record with all required fields
    INSERT INTO tick.world_ticks (
        tick__number,
        group__sync,
        tick__start_time,
        tick__end_time,
        tick__duration_ms,
        tick__states_processed,
        tick__is_delayed
    ) VALUES (
        current_tick,
        p_sync_group,
        tick_start,
        tick_start, -- Temporary value, will be updated
        0,         -- Temporary value, will be updated
        0,         -- Temporary value, will be updated
        false      -- Temporary value, will be updated
    ) RETURNING general__tick_id INTO v_tick_id;

    -- Insert new entity states
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
            (SELECT general__tick_id FROM tick.world_ticks WHERE tick__number = current_tick AND group__sync = p_sync_group)
        FROM entity.entities e
        WHERE e.group__sync = p_sync_group
        RETURNING 1
    )
    SELECT COUNT(*) INTO entity_states_inserted FROM inserted_entities;

    -- Insert new script states with simplified structure
    WITH inserted_scripts AS (
        INSERT INTO tick.entity_script_states (
            general__script_id,
            general__created_at,
            general__created_by,
            general__updated_at,
            general__updated_by,
            group__sync,
            platform,
            source__repo__entry_path,
            source__repo__url,
            compiled__node__script,
            compiled__node__script_sha256,
            compiled__node__status,
            compiled__node__updated_at,
            general__script_state_id,
            general__tick_id
        )
        SELECT 
            js.general__script_id,
            js.general__created_at,
            js.general__created_by,
            js.general__updated_at,
            js.general__updated_by,
            js.group__sync,
            js.platform,
            js.source__repo__entry_path,
            js.source__repo__url,
            js.compiled__node__script,
            js.compiled__node__script_sha256,
            js.compiled__node__status,
            js.compiled__node__updated_at,
            uuid_generate_v4(),
            v_tick_id
        FROM entity.entity_scripts js
        WHERE js.group__sync = p_sync_group
        RETURNING 1
    )
    SELECT COUNT(*) INTO script_states_inserted FROM inserted_scripts;

    -- Calculate tick metrics
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

    -- Get entity updates as JSONB
    SELECT jsonb_agg(
        jsonb_build_object(
            'entityId', entity_id,
            'operation', operation,
            'entityChanges', entity_changes,
            'sessionIds', to_jsonb(session_ids)
        )
    )
    FROM tick.get_entity_changes(p_sync_group, last_tick, current_tick)
    INTO v_entity_updates;

    -- Get script updates as JSONB
    SELECT jsonb_agg(
        jsonb_build_object(
            'scriptId', script_id,
            'operation', operation,
            'scriptChanges', script_changes,
            'sessionIds', to_jsonb(session_ids)
        )
    )
    FROM tick.get_script_changes(p_sync_group, last_tick, current_tick)
    INTO v_script_updates;

    -- Return the complete tick state as JSONB
    RETURN jsonb_build_object(
        'tick_data', jsonb_build_object(
            'tick_number', current_tick,
            'tick_start_time', tick_start,
            'tick_end_time', tick_end,
            'tick_duration_ms', tick_duration,
            'is_delayed', is_delayed,
            'headroom_ms', headroom,
            'delta_time_ms', time_since_last_tick,
            'time_until_next_tick_ms', GREATEST(tick_rate_ms - tick_duration, 0.0),
            'tick_lag', (current_tick - last_tick)::int,
            'entity_states_processed', entity_states_inserted,
            'script_states_processed', script_states_inserted,
            'rate_limited', (tick_duration > tick_rate_ms)
        ),
        'entity_updates', COALESCE(v_entity_updates, '[]'::jsonb),
        'script_updates', COALESCE(v_script_updates, '[]'::jsonb)
    );
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

-- Update materialized view creation function to use prefixed column names
CREATE OR REPLACE FUNCTION tick.create_sync_group_change_views() 
RETURNS void AS $$
DECLARE
    v_sync_group text;
    v_view_name text;
    v_create_view text;
BEGIN
    FOR v_sync_group IN 
        SELECT sync_group FROM entity.entity_sync_groups
    LOOP
        v_view_name := 'tick.latest_changes_' || replace(replace(v_sync_group, '.', '_'), '-', '_');
        
        EXECUTE 'DROP MATERIALIZED VIEW IF EXISTS ' || v_view_name;
        
        v_create_view := format(
            'CREATE MATERIALIZED VIEW %s AS
            WITH latest_ticks AS (
                SELECT tick__number, general__tick_id
                FROM tick.world_ticks
                WHERE group__sync = %L
                ORDER BY tick__number DESC
                LIMIT 2
            ),
            changes AS (
                SELECT 
                    es.general__entity_id,
                    es.group__sync,
                    CASE 
                        WHEN prev_es.general__entity_id IS NULL THEN ''INSERT''
                        WHEN curr_es.general__entity_id IS NULL THEN ''DELETE''
                        ELSE ''UPDATE''
                    END as operation,
                    jsonb_strip_nulls(
                        CASE WHEN prev_es.general__entity_id IS NULL THEN
                            jsonb_build_object(
                                ''general__name'', curr_es.general__name,
                                ''meta__data'', curr_es.meta__data
                            )
                        ELSE
                            jsonb_build_object(
                                ''general__name'', 
                                    NULLIF(curr_es.general__name, prev_es.general__name),
                                ''meta__data'', 
                                    NULLIF(curr_es.meta__data, prev_es.meta__data)
                            )
                        END
                    ) as changes
                FROM (
                    SELECT * FROM latest_ticks ORDER BY tick__number DESC LIMIT 1
                ) curr_tick
                LEFT JOIN tick.entity_states curr_es 
                    ON curr_es.general__tick_id = curr_tick.general__tick_id
                FULL OUTER JOIN (
                    SELECT * FROM latest_ticks ORDER BY tick__number DESC OFFSET 1 LIMIT 1
                ) prev_tick ON true
                LEFT JOIN tick.entity_states prev_es 
                    ON prev_es.general__tick_id = prev_tick.general__tick_id
                    AND prev_es.general__entity_id = curr_es.general__entity_id
                WHERE curr_es IS DISTINCT FROM prev_es
            )
            SELECT * FROM changes
            WHERE changes IS NOT NULL',
            v_view_name,
            v_sync_group
        );
        
        EXECUTE v_create_view;
        
        -- Simple index on sync_group
        EXECUTE format(
            'CREATE INDEX %s_sync_group_idx ON %s (group__sync)',
            replace(replace(v_sync_group, '.', '_'), '-', '_'),
            v_view_name
        );
    END LOOP;
END;
$$ LANGUAGE plpgsql;
