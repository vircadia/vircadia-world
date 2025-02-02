-- Create tick schema
CREATE SCHEMA IF NOT EXISTS tick;

-- Lag compensation state history table
CREATE TABLE tick.entity_states (
    LIKE entity.entities INCLUDING DEFAULTS INCLUDING CONSTRAINTS,
    
    -- Additional metadata for state tracking
    general__entity_state_id uuid DEFAULT uuid_generate_v4(),
    tick__timestamp timestamptz DEFAULT now(),
    tick__number bigint NOT NULL,
    tick__start_time timestamptz,
    tick__end_time timestamptz,
    tick__duration_ms double precision,

    -- Override the primary key to allow multiple states per entity
    CONSTRAINT entity_states_pkey PRIMARY KEY (general__entity_state_id),
    
    -- Add foreign key constraint for sync_group
    CONSTRAINT entity_states_sync_group_fkey FOREIGN KEY (performance__sync_group) 
        REFERENCES entity.entity_sync_groups(sync_group)
);

-- Performance metrics table
CREATE TABLE tick.tick_metrics (
    general__tick_metrics_id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
    tick__number bigint NOT NULL,
    performance__sync_group TEXT NOT NULL REFERENCES entity.entity_sync_groups(sync_group),
    tick__start_time timestamptz NOT NULL,
    tick__end_time timestamptz NOT NULL,
    tick__duration_ms double precision NOT NULL,
    tick__states_processed int NOT NULL,
    tick__is_delayed boolean NOT NULL,
    general__created_at timestamptz DEFAULT now(),
    tick__headroom_ms double precision,
    tick__rate_limited boolean DEFAULT false,
    tick__time_since_last_tick_ms double precision
);

-- Indexes for fast state lookups
CREATE INDEX entity_states_lookup_idx ON tick.entity_states (general__entity_id, tick__number, tick__timestamp);
CREATE INDEX entity_states_timestamp_idx ON tick.entity_states (tick__timestamp);

-- Enable RLS on entity_states table
ALTER TABLE tick.entity_states ENABLE ROW LEVEL SECURITY;

CREATE TYPE operation_enum AS ENUM ('INSERT', 'UPDATE', 'DELETE');

-- Add entity status type
CREATE TYPE entity_status_enum AS ENUM ('ACTIVE', 'AWAITING_SCRIPTS');

-- Add function to get changes since last tick
CREATE OR REPLACE FUNCTION tick.get_entity_changes(
    p_sync_group text,
    p_last_tick bigint,
    p_current_tick bigint
) RETURNS TABLE (
    entity_id uuid,
    operation operation_enum,
    entity_changes jsonb,
    session_ids uuid[],
    entity_status entity_status_enum
) AS $$
BEGIN
    RETURN QUERY
    WITH RECURSIVE 
    changed_entities AS (
        WITH current_states AS (
            SELECT * FROM tick.entity_states 
            WHERE tick__number = p_current_tick
            AND performance__sync_group = p_sync_group
        ),
        previous_states AS (
            SELECT * FROM tick.entity_states 
            WHERE tick__number = p_last_tick
            AND performance__sync_group = p_sync_group
        )
        SELECT 
            cs.general__entity_id as entity_id,
            CASE 
                WHEN ps.general__entity_id IS NULL THEN 'INSERT'::operation_enum
                ELSE 'UPDATE'::operation_enum
            END as operation,
            CASE
                WHEN ps.general__entity_id IS NULL THEN
                    -- For INSERTs, return all fields as a JSONB object
                    jsonb_build_object(
                        'general__name', cs.general__name,
                        'general__semantic_version', cs.general__semantic_version,
                        'general__created_at', cs.general__created_at,
                        'general__created_by', cs.general__created_by,
                        'general__updated_at', cs.general__updated_at,
                        'general__updated_by', cs.general__updated_by,
                        'general__load_priority', cs.general__load_priority,
                        'general__initialized_at', cs.general__initialized_at,
                        'general__initialized_by', cs.general__initialized_by,
                        'meta__data', cs.meta__data,
                        'scripts__ids', cs.scripts__ids,
                        'validation__log', cs.validation__log,
                        'performance__sync_group', cs.performance__sync_group,
                        'permissions__roles__view', cs.permissions__roles__view,
                        'permissions__roles__full', cs.permissions__roles__full
                    )
                ELSE
                    -- For UPDATEs, only include fields that have changed
                    jsonb_strip_nulls(jsonb_build_object(
                        'general__name', 
                            CASE WHEN cs.general__name IS DISTINCT FROM ps.general__name 
                            THEN cs.general__name ELSE NULL END,
                        'general__semantic_version', 
                            CASE WHEN cs.general__semantic_version IS DISTINCT FROM ps.general__semantic_version 
                            THEN cs.general__semantic_version ELSE NULL END,
                        'general__created_at',
                            CASE WHEN cs.general__created_at IS DISTINCT FROM ps.general__created_at 
                            THEN cs.general__created_at ELSE NULL END,
                        'general__created_by',
                            CASE WHEN cs.general__created_by IS DISTINCT FROM ps.general__created_by 
                            THEN cs.general__created_by ELSE NULL END,
                        'general__updated_at',
                            CASE WHEN cs.general__updated_at IS DISTINCT FROM ps.general__updated_at 
                            THEN cs.general__updated_at ELSE NULL END,
                        'general__updated_by',
                            CASE WHEN cs.general__updated_by IS DISTINCT FROM ps.general__updated_by 
                            THEN cs.general__updated_by ELSE NULL END,
                        'general__load_priority',
                            CASE WHEN cs.general__load_priority IS DISTINCT FROM ps.general__load_priority 
                            THEN cs.general__load_priority ELSE NULL END,
                        'general__initialized_at',
                            CASE WHEN cs.general__initialized_at IS DISTINCT FROM ps.general__initialized_at 
                            THEN cs.general__initialized_at ELSE NULL END,
                        'general__initialized_by',
                            CASE WHEN cs.general__initialized_by IS DISTINCT FROM ps.general__initialized_by 
                            THEN cs.general__initialized_by ELSE NULL END,
                        'meta__data', 
                            CASE WHEN cs.meta__data IS DISTINCT FROM ps.meta__data 
                            THEN cs.meta__data ELSE NULL END,
                        'scripts__ids', 
                            CASE WHEN cs.scripts__ids IS DISTINCT FROM ps.scripts__ids 
                            THEN cs.scripts__ids ELSE NULL END,
                        'validation__log', 
                            CASE WHEN cs.validation__log IS DISTINCT FROM ps.validation__log 
                            THEN cs.validation__log ELSE NULL END,
                        'permissions__roles__view', 
                            CASE WHEN cs.permissions__roles__view IS DISTINCT FROM ps.permissions__roles__view 
                            THEN cs.permissions__roles__view ELSE NULL END,
                        'permissions__roles__full', 
                            CASE WHEN cs.permissions__roles__full IS DISTINCT FROM ps.permissions__roles__full 
                            THEN cs.permissions__roles__full ELSE NULL END,
                        'performance__sync_group', 
                            CASE WHEN cs.performance__sync_group IS DISTINCT FROM ps.performance__sync_group 
                            THEN cs.performance__sync_group ELSE NULL END
                    ))
            END as entity_changes,
            cs.permissions__roles__view
        FROM current_states cs
        LEFT JOIN previous_states ps ON cs.general__entity_id = ps.general__entity_id
        WHERE ps.general__entity_id IS NULL  -- New entities
           OR cs.general__name IS DISTINCT FROM ps.general__name
           OR cs.general__semantic_version IS DISTINCT FROM ps.general__semantic_version
           OR cs.general__created_at IS DISTINCT FROM ps.general__created_at
           OR cs.general__created_by IS DISTINCT FROM ps.general__created_by
           OR cs.general__updated_at IS DISTINCT FROM ps.general__updated_at
           OR cs.general__updated_by IS DISTINCT FROM ps.general__updated_by
           OR cs.general__load_priority IS DISTINCT FROM ps.general__load_priority
           OR cs.general__initialized_at IS DISTINCT FROM ps.general__initialized_at
           OR cs.general__initialized_by IS DISTINCT FROM ps.general__initialized_by
           OR cs.meta__data IS DISTINCT FROM ps.meta__data
           OR cs.scripts__ids IS DISTINCT FROM ps.scripts__ids
           OR cs.validation__log IS DISTINCT FROM ps.validation__log
           OR cs.permissions__roles__view IS DISTINCT FROM ps.permissions__roles__view
           OR cs.permissions__roles__full IS DISTINCT FROM ps.permissions__roles__full
           OR cs.performance__sync_group IS DISTINCT FROM ps.performance__sync_group

        UNION ALL

        -- Handle deletes
        SELECT 
            ps.general__entity_id,
            'DELETE'::operation_enum,
            NULL,
            ps.permissions__roles__view
        FROM previous_states ps
        LEFT JOIN current_states cs ON ps.general__entity_id = cs.general__entity_id
        WHERE cs.general__entity_id IS NULL
    ),
    -- Materialize active sessions with their roles for reuse
    active_sessions AS MATERIALIZED (
        SELECT 
            s.general__session_id,
            array_agg(DISTINCT ar.auth__role_name) as session_roles
        FROM auth.agent_sessions s
        JOIN auth.agent_roles ar ON 
            ar.auth__agent_id = s.auth__agent_id AND 
            ar.auth__is_active = true
        WHERE s.session__is_active = true 
        AND s.session__expires_at > NOW()
        GROUP BY s.general__session_id
    ),
    -- Add script status check
    entity_script_status AS (
        SELECT 
            ce.entity_id,
            CASE
                WHEN jsonb_array_length(ce.entity_changes->'scripts__ids') IS NULL THEN 'ACTIVE'::entity_status_enum
                WHEN EXISTS (
                    SELECT 1 
                    FROM entity.entity_scripts es 
                    WHERE es.general__script_id = ANY(
                        ARRAY(
                            SELECT jsonb_array_elements_text(
                                COALESCE(ce.entity_changes->'scripts__ids', '[]'::jsonb)
                            )::uuid
                        )
                    )
                    AND (
                        es.script__compiled__node__script_status = 'PENDING' OR
                        es.script__compiled__bun__script_status = 'PENDING' OR
                        es.script__compiled__browser__script_status = 'PENDING'
                    )
                ) THEN 'AWAITING_SCRIPTS'::entity_status_enum
                ELSE 'ACTIVE'::entity_status_enum
            END as status
        FROM changed_entities ce
    )
    -- Final result
    SELECT 
        ce.entity_id,
        ce.operation,
        ce.entity_changes,
        CASE 
            -- When permissions are empty/null, include all active session IDs
            WHEN ce.permissions__roles__view IS NULL OR ce.permissions__roles__view = '{}' THEN
                array_agg(DISTINCT as_sess.general__session_id)
            -- Otherwise only include sessions with matching roles
            ELSE
                array_agg(DISTINCT as_sess.general__session_id) FILTER (
                    WHERE as_sess.session_roles && ce.permissions__roles__view
                )
        END as session_ids,
        ess.status as entity_status
    FROM changed_entities ce
    CROSS JOIN active_sessions as_sess
    JOIN entity_script_status ess ON ce.entity_id = ess.entity_id
    GROUP BY ce.entity_id, ce.operation, ce.entity_changes, ess.status, ce.permissions__roles__view;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- View policy for entity_states (matching the entity read permissions)
CREATE POLICY "entity_states_view_policy" ON tick.entity_states
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 
            FROM entity.entities e
            JOIN auth.agent_roles ar ON ar.auth__role_name = ANY(e.permissions__roles__view)
            WHERE e.general__entity_id = tick.entity_states.general__entity_id
            AND ar.auth__agent_id = auth.current_agent_id()
            AND ar.auth__is_active = true
        )
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

-- Separate function to get script changes
CREATE OR REPLACE FUNCTION tick.get_script_changes(
    p_last_tick bigint,
    p_current_tick bigint
) RETURNS TABLE (
    script_id uuid,
    operation operation_enum,
    script_changes jsonb,
    session_ids uuid[]
) AS $$
BEGIN
    RETURN QUERY
    WITH current_scripts AS (
        SELECT 
            general__script_id,
            general__created_at,
            general__created_by,
            general__updated_at,
            general__updated_by,
            script__source__node__repo__entry_path,
            script__source__node__repo__url,
            script__compiled__node__script,
            script__compiled__node__script_sha256,
            script__compiled__node__script_status,
            script__compiled__node__updated_at,
            script__source__bun__repo__entry_path,
            script__source__bun__repo__url,
            script__compiled__bun__script,
            script__compiled__bun__script_sha256,
            script__compiled__bun__script_status,
            script__compiled__bun__updated_at,
            script__source__browser__repo__entry_path,
            script__source__browser__repo__url,
            script__compiled__browser__script,
            script__compiled__browser__script_sha256,
            script__compiled__browser__script_status,
            script__compiled__browser__updated_at
        FROM entity.entity_scripts es
        WHERE es.general__updated_at >= (
            SELECT tick__start_time 
            FROM tick.tick_metrics 
            WHERE tick__number = p_last_tick 
            LIMIT 1
        )
    ),
    previous_scripts AS (
        SELECT 
            general__script_id,
            general__created_at,
            general__created_by,
            general__updated_at,
            general__updated_by,
            script__source__node__repo__entry_path,
            script__source__node__repo__url,
            script__compiled__node__script,
            script__compiled__node__script_sha256,
            script__compiled__node__script_status,
            script__compiled__node__updated_at,
            script__source__bun__repo__entry_path,
            script__source__bun__repo__url,
            script__compiled__bun__script,
            script__compiled__bun__script_sha256,
            script__compiled__bun__script_status,
            script__compiled__bun__updated_at,
            script__source__browser__repo__entry_path,
            script__source__browser__repo__url,
            script__compiled__browser__script,
            script__compiled__browser__script_sha256,
            script__compiled__browser__script_status,
            script__compiled__browser__updated_at
        FROM entity.entity_scripts es
        WHERE es.general__updated_at < (
            SELECT tick__start_time 
            FROM tick.tick_metrics 
            WHERE tick__number = p_last_tick 
            LIMIT 1
        )
    ),
    -- Get all active sessions
    active_sessions AS (
        SELECT array_agg(general__session_id) as active_session_ids
        FROM auth.agent_sessions
        WHERE session__is_active = true 
        AND session__expires_at > NOW()
    )
    SELECT 
        cs.general__script_id,
        CASE 
            WHEN ps.general__script_id IS NULL THEN 'INSERT'::operation_enum
            ELSE 'UPDATE'::operation_enum
        END as operation,
        CASE 
            WHEN ps.general__script_id IS NULL THEN
                -- For INSERTs, return all fields including NULLs
                jsonb_build_object(
                    'general__script_id', cs.general__script_id,
                    'general__created_at', cs.general__created_at,
                    'general__created_by', cs.general__created_by,
                    'general__updated_at', cs.general__updated_at,
                    'general__updated_by', cs.general__updated_by,
                    'script__source__node__repo__entry_path', cs.script__source__node__repo__entry_path,
                    'script__source__node__repo__url', cs.script__source__node__repo__url,
                    'script__compiled__node__script', cs.script__compiled__node__script,
                    'script__compiled__node__script_sha256', cs.script__compiled__node__script_sha256,
                    'script__compiled__node__script_status', cs.script__compiled__node__script_status,
                    'script__compiled__node__updated_at', cs.script__compiled__node__updated_at,
                    'script__source__bun__repo__entry_path', cs.script__source__bun__repo__entry_path,
                    'script__source__bun__repo__url', cs.script__source__bun__repo__url,
                    'script__compiled__bun__script', cs.script__compiled__bun__script,
                    'script__compiled__bun__script_sha256', cs.script__compiled__bun__script_sha256,
                    'script__compiled__bun__script_status', cs.script__compiled__bun__script_status,
                    'script__compiled__bun__updated_at', cs.script__compiled__bun__updated_at,
                    'script__source__browser__repo__entry_path', cs.script__source__browser__repo__entry_path,
                    'script__source__browser__repo__url', cs.script__source__browser__repo__url,
                    'script__compiled__browser__script', cs.script__compiled__browser__script,
                    'script__compiled__browser__script_sha256', cs.script__compiled__browser__script_sha256,
                    'script__compiled__browser__script_status', cs.script__compiled__browser__script_status,
                    'script__compiled__browser__updated_at', cs.script__compiled__browser__updated_at
                )
            ELSE
                -- For UPDATEs, only return changed fields (including NULLs)
                jsonb_strip_nulls(jsonb_build_object(
                    'general__script_id',
                        CASE WHEN cs.general__script_id IS DISTINCT FROM ps.general__script_id 
                        THEN cs.general__script_id ELSE NULL END,
                    'general__created_at',
                        CASE WHEN cs.general__created_at IS DISTINCT FROM ps.general__created_at 
                        THEN cs.general__created_at ELSE NULL END,
                    'general__created_by',
                        CASE WHEN cs.general__created_by IS DISTINCT FROM ps.general__created_by 
                        THEN cs.general__created_by ELSE NULL END,
                    'general__updated_at',
                        CASE WHEN cs.general__updated_at IS DISTINCT FROM ps.general__updated_at 
                        THEN cs.general__updated_at ELSE NULL END,
                    'general__updated_by',
                        CASE WHEN cs.general__updated_by IS DISTINCT FROM ps.general__updated_by 
                        THEN cs.general__updated_by ELSE NULL END,
                    'script__source__node__repo__entry_path',
                        CASE WHEN cs.script__source__node__repo__entry_path IS DISTINCT FROM ps.script__source__node__repo__entry_path 
                        THEN cs.script__source__node__repo__entry_path ELSE NULL END,
                    'script__source__node__repo__url',
                        CASE WHEN cs.script__source__node__repo__url IS DISTINCT FROM ps.script__source__node__repo__url 
                        THEN cs.script__source__node__repo__url ELSE NULL END,
                    'script__compiled__node__script',
                        CASE WHEN cs.script__compiled__node__script IS DISTINCT FROM ps.script__compiled__node__script 
                        THEN cs.script__compiled__node__script ELSE NULL END,
                    'script__compiled__node__script_sha256',
                        CASE WHEN cs.script__compiled__node__script_sha256 IS DISTINCT FROM ps.script__compiled__node__script_sha256 
                        THEN cs.script__compiled__node__script_sha256 ELSE NULL END,
                    'script__compiled__node__script_status',
                        CASE WHEN cs.script__compiled__node__script_status IS DISTINCT FROM ps.script__compiled__node__script_status 
                        THEN cs.script__compiled__node__script_status ELSE NULL END,
                    'script__compiled__node__updated_at',
                        CASE WHEN cs.script__compiled__node__updated_at IS DISTINCT FROM ps.script__compiled__node__updated_at 
                        THEN cs.script__compiled__node__updated_at ELSE NULL END,
                    'script__source__bun__repo__entry_path',
                        CASE WHEN cs.script__source__bun__repo__entry_path IS DISTINCT FROM ps.script__source__bun__repo__entry_path 
                        THEN cs.script__source__bun__repo__entry_path ELSE NULL END,
                    'script__source__bun__repo__url',
                        CASE WHEN cs.script__source__bun__repo__url IS DISTINCT FROM ps.script__source__bun__repo__url 
                        THEN cs.script__source__bun__repo__url ELSE NULL END,
                    'script__compiled__bun__script',
                        CASE WHEN cs.script__compiled__bun__script IS DISTINCT FROM ps.script__compiled__bun__script 
                        THEN cs.script__compiled__bun__script ELSE NULL END,
                    'script__compiled__bun__script_sha256',
                        CASE WHEN cs.script__compiled__bun__script_sha256 IS DISTINCT FROM ps.script__compiled__bun__script_sha256 
                        THEN cs.script__compiled__bun__script_sha256 ELSE NULL END,
                    'script__compiled__bun__script_status',
                        CASE WHEN cs.script__compiled__bun__script_status IS DISTINCT FROM ps.script__compiled__bun__script_status 
                        THEN cs.script__compiled__bun__script_status ELSE NULL END,
                    'script__compiled__bun__updated_at',
                        CASE WHEN cs.script__compiled__bun__updated_at IS DISTINCT FROM ps.script__compiled__bun__updated_at 
                        THEN cs.script__compiled__bun__updated_at ELSE NULL END,
                    'script__source__browser__repo__entry_path',
                        CASE WHEN cs.script__source__browser__repo__entry_path IS DISTINCT FROM ps.script__source__browser__repo__entry_path 
                        THEN cs.script__source__browser__repo__entry_path ELSE NULL END,
                    'script__source__browser__repo__url',
                        CASE WHEN cs.script__source__browser__repo__url IS DISTINCT FROM ps.script__source__browser__repo__url 
                        THEN cs.script__source__browser__repo__url ELSE NULL END,
                    'script__compiled__browser__script',
                        CASE WHEN cs.script__compiled__browser__script IS DISTINCT FROM ps.script__compiled__browser__script 
                        THEN cs.script__compiled__browser__script ELSE NULL END,
                    'script__compiled__browser__script_sha256',
                        CASE WHEN cs.script__compiled__browser__script_sha256 IS DISTINCT FROM ps.script__compiled__browser__script_sha256 
                        THEN cs.script__compiled__browser__script_sha256 ELSE NULL END,
                    'script__compiled__browser__script_status',
                        CASE WHEN cs.script__compiled__browser__script_status IS DISTINCT FROM ps.script__compiled__browser__script_status 
                        THEN cs.script__compiled__browser__script_status ELSE NULL END,
                    'script__compiled__browser__updated_at',
                        CASE WHEN cs.script__compiled__browser__updated_at IS DISTINCT FROM ps.script__compiled__browser__updated_at 
                        THEN cs.script__compiled__browser__updated_at ELSE NULL END
                ))
        END as script_changes,
        (SELECT active_session_ids FROM active_sessions)
    FROM current_scripts cs
    LEFT JOIN previous_scripts ps ON cs.general__script_id = ps.general__script_id
    WHERE ps.general__script_id IS NULL  -- New scripts
       OR cs.script__compiled__node__script IS DISTINCT FROM ps.script__compiled__node__script
       OR cs.script__compiled__bun__script IS DISTINCT FROM ps.script__compiled__bun__script
       OR cs.script__compiled__browser__script IS DISTINCT FROM ps.script__compiled__browser__script
       OR cs.script__compiled__node__script_status IS DISTINCT FROM ps.script__compiled__node__script_status
       OR cs.script__compiled__bun__script_status IS DISTINCT FROM ps.script__compiled__bun__script_status
       OR cs.script__compiled__browser__script_status IS DISTINCT FROM ps.script__compiled__browser__script_status

    UNION ALL

    -- Handle deletes
    SELECT 
        ps.general__script_id,
        'DELETE'::operation_enum as operation,
        NULL as script_changes,
        (SELECT active_session_ids FROM active_sessions)
    FROM previous_scripts ps
    LEFT JOIN current_scripts cs ON ps.general__script_id = cs.general__script_id
    WHERE cs.general__script_id IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add a type to differentiate between entity and tick-only updates
CREATE TYPE tick_update_type AS ENUM ('ENTITY', 'TICK_ONLY');

-- Create composite types for our return values
CREATE TYPE tick.tick_metadata AS (
    tick_number bigint,
    tick_start_time timestamptz,
    tick_end_time timestamptz,
    tick_duration_ms double precision,
    is_delayed boolean,
    headroom_ms double precision,
    delta_time_ms double precision,
    time_until_next_tick_ms double precision,
    tick_lag int
);

CREATE TYPE tick.entity_update AS (
    entity_id uuid,
    operation operation_enum,
    entity_changes jsonb,
    session_ids uuid[],
    entity_status entity_status_enum
);

CREATE TYPE tick.script_update AS (
    script_id uuid,
    operation operation_enum,
    script_changes jsonb,
    session_ids uuid[]
);

-- Function to capture tick and return metadata and changes
CREATE OR REPLACE FUNCTION tick.capture_tick_state(sync_group_name text)
RETURNS TABLE (
    tick_data tick.tick_metadata,
    entity_updates tick.entity_update[],
    script_updates tick.script_update[]
) AS $$
DECLARE
    current_tick bigint;
    tick_start timestamptz;
    tick_end timestamptz;
    tick_duration double precision;
    inserted_count int;
    is_delayed boolean;
    headroom double precision;
    sync_groups jsonb;
    tick_rate_ms int;
    last_tick bigint;
    last_tick_time timestamptz;
    time_since_last_tick double precision;
    v_tick_data tick.tick_metadata;
    v_entity_updates tick.entity_update[];
    v_script_updates tick.script_update[];
BEGIN
    -- Initialize tick data
    tick_start := clock_timestamp();
    
    -- Get sync groups configuration
    SELECT server__tick__rate_ms INTO tick_rate_ms 
    FROM entity.entity_sync_groups 
    WHERE sync_group = sync_group_name;
    
    -- Validate sync group exists
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid sync group: %', sync_group_name;
    END IF;

    -- Calculate current tick for this sync group
    current_tick := FLOOR(EXTRACT(EPOCH FROM tick_start) * 1000 / tick_rate_ms)::bigint;
    
    -- Get the last tick number for this sync group
    SELECT COALESCE(MAX(tick__number), current_tick - 1) INTO last_tick
    FROM tick.entity_states
    WHERE performance__sync_group = sync_group_name;

    -- Get the last tick's timestamp
    SELECT tick__end_time INTO last_tick_time
    FROM tick.tick_metrics
    WHERE performance__sync_group = sync_group_name
    AND tick__number = last_tick;

    -- Calculate time since last tick
    time_since_last_tick := CASE 
        WHEN last_tick_time IS NOT NULL 
        THEN EXTRACT(EPOCH FROM (tick_start - last_tick_time)) * 1000 
        ELSE tick_rate_ms 
    END;

    -- Modified insert statement to match inherited column structure
    WITH inserted AS (
        INSERT INTO tick.entity_states (
            -- Use the inherited columns directly
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
            validation__log,
            performance__sync_group,
            permissions__roles__view,
            permissions__roles__full,
            
            -- Tick-specific fields
            general__entity_state_id,
            tick__number,
            tick__start_time,
            tick__end_time,
            tick__duration_ms
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
            e.validation__log,
            e.performance__sync_group,
            e.permissions__roles__view,
            e.permissions__roles__full,
            
            -- Tick-specific fields
            uuid_generate_v4(),  -- new state ID
            current_tick,
            tick_start,
            clock_timestamp(),
            EXTRACT(EPOCH FROM (clock_timestamp() - tick_start))::double precision * 1000
        FROM entity.entities e
        WHERE 
            -- Only process entities in this sync group
            COALESCE(e.performance__sync_group, 'NORMAL') = sync_group_name
            -- And only if they need an update
            AND NOT EXISTS (
                SELECT 1 
                FROM tick.entity_states es
                WHERE es.general__entity_id = e.general__entity_id
                AND es.tick__number = current_tick
            )
        RETURNING *
    )
    SELECT COUNT(*) INTO inserted_count FROM inserted;

    tick_end := clock_timestamp();
    tick_duration := EXTRACT(EPOCH FROM (tick_end - tick_start)) * 1000.0;
    is_delayed := tick_duration > tick_rate_ms;
    headroom := GREATEST(tick_rate_ms - tick_duration, 0.0);

    -- Build tick metadata
    SELECT ROW(
        current_tick,
        tick_start,
        tick_end,
        tick_duration,
        is_delayed,
        headroom,
        time_since_last_tick,
        GREATEST(tick_rate_ms - tick_duration, 0.0),
        (current_tick - last_tick)::int
    )::tick.tick_metadata INTO v_tick_data;

    -- Get entity updates with explicit casting
    SELECT COALESCE(array_agg(
        (entity_id, operation, entity_changes, session_ids, entity_status)::tick.entity_update
    ), ARRAY[]::tick.entity_update[])
    FROM tick.get_entity_changes(sync_group_name, last_tick, current_tick)
    INTO v_entity_updates;

    -- Get script updates with explicit casting
    SELECT COALESCE(array_agg(
        (script_id, operation, script_changes, session_ids)::tick.script_update
    ), ARRAY[]::tick.script_update[])
    FROM tick.get_script_changes(last_tick, current_tick)
    INTO v_script_updates;

    -- Insert tick metrics
    INSERT INTO tick.tick_metrics (
        tick__number,
        performance__sync_group,
        tick__start_time,
        tick__end_time,
        tick__duration_ms,
        tick__states_processed,
        tick__is_delayed,
        tick__headroom_ms
    ) VALUES (
        current_tick,
        sync_group_name,
        tick_start,
        tick_end,
        tick_duration,
        inserted_count,
        is_delayed,
        headroom
    );

    -- Return all data
    RETURN QUERY 
    SELECT v_tick_data, v_entity_updates, v_script_updates;

    EXCEPTION
        WHEN OTHERS THEN
            RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Example usage function showing how to handle the return values
CREATE OR REPLACE FUNCTION tick.example_tick_handler(sync_group_name text)
RETURNS jsonb AS $$
DECLARE
    tick_result record;
BEGIN
    SELECT * INTO tick_result FROM tick.capture_tick_state(sync_group_name);
    
    RETURN jsonb_build_object(
        'tick', to_jsonb(tick_result.tick_data),
        'entities', to_jsonb(tick_result.entity_updates),
        'scripts', to_jsonb(tick_result.script_updates)
    );
END;
$$ LANGUAGE plpgsql;

-- Cleanup functions need SECURITY DEFINER to bypass RLS
CREATE OR REPLACE FUNCTION tick.cleanup_old_entity_states()
RETURNS void AS $$
DECLARE
    states_cleaned integer;
BEGIN
    -- Replace system role check with is_admin_agent()
    IF NOT auth.is_admin_agent() THEN
        RAISE EXCEPTION 'Permission denied: Admin permission required';
    END IF;

    -- Clean entity states
    WITH deleted_states AS (
        DELETE FROM tick.entity_states 
        WHERE tick__timestamp < (now() - (
            SELECT (value#>>'{}'::text[])::int * interval '1 millisecond' 
            FROM config.config 
            WHERE key = 'tick_buffer_duration_ms'
        ))
        RETURNING *
    )
    SELECT COUNT(*) INTO states_cleaned FROM deleted_states;
    
    -- Log cleanup results if anything was cleaned
    IF states_cleaned > 0 THEN
        RAISE NOTICE 'Cleanup completed: % entity states removed', states_cleaned;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION tick.cleanup_old_tick_metrics()
RETURNS void AS $$
DECLARE
    metrics_cleaned integer;
BEGIN
    -- Replace system role check with is_admin_agent()
    IF NOT auth.is_admin_agent() THEN
        RAISE EXCEPTION 'Permission denied: Admin permission required';
    END IF;

    WITH deleted_metrics AS (
        DELETE FROM tick.tick_metrics 
        WHERE general__created_at < (now() - (
            SELECT (value#>>'{}'::text[])::int * interval '1 millisecond' 
            FROM config.config 
            WHERE key = 'tick_metrics_history_ms'
        ))
        RETURNING *
    )
    SELECT COUNT(*) INTO metrics_cleaned FROM deleted_metrics;
    
    -- Log cleanup results if anything was cleaned
    IF metrics_cleaned > 0 THEN
        RAISE NOTICE 'Tick metrics cleanup completed: % metrics removed', metrics_cleaned;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Enable RLS on tick_metrics table
ALTER TABLE tick.tick_metrics ENABLE ROW LEVEL SECURITY;

-- All policies for tick_metrics (system users only)
CREATE POLICY "tick_metrics_view_policy" ON tick.tick_metrics
    FOR SELECT
    USING (auth.is_admin_agent());

CREATE POLICY "tick_metrics_update_policy" ON tick.tick_metrics
    FOR UPDATE
    USING (auth.is_admin_agent());

CREATE POLICY "tick_metrics_insert_policy" ON tick.tick_metrics
    FOR INSERT
    WITH CHECK (auth.is_admin_agent());

CREATE POLICY "tick_metrics_delete_policy" ON tick.tick_metrics
    FOR DELETE
    USING (auth.is_admin_agent());

-- Add index for sync group queries
CREATE INDEX entity_states_sync_group_tick_idx 
ON tick.entity_states (performance__sync_group, tick__number DESC);

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

CREATE TRIGGER update_tick_metrics_updated_at
    BEFORE UPDATE ON tick.tick_metrics
    FOR EACH ROW
    EXECUTE FUNCTION tick.update_updated_at();

-- Add optimized indexes for the tick system
CREATE INDEX idx_entity_states_sync_tick_lookup 
ON tick.entity_states (performance__sync_group, tick__number, general__entity_id);

CREATE INDEX idx_entity_states_roles 
ON tick.entity_states USING GIN (permissions__roles__view);
