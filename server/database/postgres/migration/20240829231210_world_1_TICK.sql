-- Create tick schema
CREATE SCHEMA IF NOT EXISTS tick;

-- Lag compensation state history table
CREATE TABLE tick.entity_states (
    LIKE entity.entities INCLUDING DEFAULTS INCLUDING CONSTRAINTS,
    
    -- Additional metadata for state tracking
    general__entity_state_id uuid DEFAULT uuid_generate_v4(),
    timestamp timestamptz DEFAULT now(),
    tick_number bigint NOT NULL,
    tick_start_time timestamptz,
    tick_end_time timestamptz,
    tick_duration_ms double precision,

    -- Override the primary key to allow multiple states per entity
    CONSTRAINT entity_states_pkey PRIMARY KEY (general__entity_state_id)
);

-- Performance metrics table
CREATE TABLE tick.tick_metrics (
    general__tick_metrics_id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
    tick_number bigint NOT NULL,
    sync_group TEXT NOT NULL,
    start_time timestamptz NOT NULL,
    end_time timestamptz NOT NULL,
    duration_ms double precision NOT NULL,
    states_processed int NOT NULL,
    is_delayed boolean NOT NULL,
    general__created_at timestamptz DEFAULT now(),
    headroom_ms double precision,
    rate_limited boolean DEFAULT false,
    time_since_last_tick_ms double precision
);

-- Indexes for fast state lookups
CREATE INDEX entity_states_lookup_idx ON tick.entity_states (general__entity_id, tick_number, timestamp);
CREATE INDEX entity_states_timestamp_idx ON tick.entity_states (timestamp);

-- Enable RLS on entity_states table
ALTER TABLE tick.entity_states ENABLE ROW LEVEL SECURITY;

CREATE TYPE operation_enum AS ENUM ('INSERT', 'UPDATE', 'DELETE');

-- Add function to get changes since last tick
CREATE OR REPLACE FUNCTION tick.get_entity_changes(
    p_sync_group text,
    p_last_tick bigint
) RETURNS TABLE (
    entity_id uuid,
    operation operation_enum,
    changes jsonb,
    roles text[]
) AS $$
BEGIN
    RETURN QUERY
    WITH current_states AS (
        SELECT * FROM tick.entity_states 
        WHERE tick_number = (
            SELECT MAX(tick_number) 
            FROM tick.entity_states
            WHERE performance__sync_group = p_sync_group
        )
        AND performance__sync_group = p_sync_group
    ),
    previous_states AS (
        SELECT * FROM tick.entity_states 
        WHERE tick_number = p_last_tick
        AND performance__sync_group = p_sync_group
    )
    -- Handle updates and inserts
    SELECT 
        cs.general__entity_id,
        CASE 
            WHEN ps.general__entity_id IS NULL THEN 'INSERT'
            ELSE 'UPDATE'
        END as operation,
        jsonb_build_object(
            'general', CASE 
                WHEN ps.general__entity_id IS NULL OR (
                    cs.general__name IS DISTINCT FROM ps.general__name OR
                    cs.general__semantic_version IS DISTINCT FROM ps.general__semantic_version OR
                    cs.general__created_at IS DISTINCT FROM ps.general__created_at OR
                    cs.general__created_by IS DISTINCT FROM ps.general__created_by OR
                    cs.general__updated_at IS DISTINCT FROM ps.general__updated_at OR
                    cs.general__updated_by IS DISTINCT FROM ps.general__updated_by OR
                    cs.general__load_priority IS DISTINCT FROM ps.general__load_priority OR
                    cs.general__initialized_at IS DISTINCT FROM ps.general__initialized_at OR
                    cs.general__initialized_by IS DISTINCT FROM ps.general__initialized_by
                ) THEN 
                    jsonb_build_object(
                        'name', cs.general__name,
                        'semantic_version', cs.general__semantic_version,
                        'created_at', cs.general__created_at,
                        'created_by', cs.general__created_by,
                        'updated_at', cs.general__updated_at,
                        'updated_by', cs.general__updated_by,
                        'load_priority', cs.general__load_priority,
                        'initialized_at', cs.general__initialized_at,
                        'initialized_by', cs.general__initialized_by
                    )
                ELSE NULL 
            END,
            'meta', CASE 
                WHEN ps.general__entity_id IS NULL OR 
                     cs.meta__data IS DISTINCT FROM ps.meta__data THEN 
                    cs.meta__data 
                ELSE NULL 
            END,
            'scripts', CASE 
                WHEN ps.general__entity_id IS NULL OR
                     cs.scripts__ids IS DISTINCT FROM ps.scripts__ids OR
                     cs.validation__log IS DISTINCT FROM ps.validation__log THEN 
                    jsonb_build_object(
                        'ids', cs.scripts__ids,
                        'validation_log', cs.validation__log
                    )
                ELSE NULL 
            END,
            'permissions', CASE 
                WHEN ps.general__entity_id IS NULL OR
                     cs.permissions__roles__view IS DISTINCT FROM ps.permissions__roles__view OR
                     cs.permissions__roles__full IS DISTINCT FROM ps.permissions__roles__full THEN 
                    jsonb_build_object(
                        'roles_view', cs.permissions__roles__view,
                        'roles_full', cs.permissions__roles__full
                    )
                ELSE NULL 
            END,
            'performance', CASE 
                WHEN ps.general__entity_id IS NULL OR
                     cs.performance__sync_group IS DISTINCT FROM ps.performance__sync_group THEN 
                    jsonb_build_object(
                        'sync_group', cs.performance__sync_group
                    )
                ELSE NULL 
            END
        ),
        cs.permissions__roles__view
    FROM current_states cs
    LEFT JOIN previous_states ps ON cs.general__entity_id = ps.general__entity_id
    WHERE ps.general__entity_id IS NULL  -- New entities
       OR cs.general__name IS DISTINCT FROM ps.general__name
       OR cs.general__semantic_version IS DISTINCT FROM ps.general__semantic_version
       OR cs.meta__data IS DISTINCT FROM ps.meta__data
       OR cs.scripts__ids IS DISTINCT FROM ps.scripts__ids
       OR cs.validation__log IS DISTINCT FROM ps.validation__log
       OR cs.permissions__roles__view IS DISTINCT FROM ps.permissions__roles__view
       OR cs.permissions__roles__full IS DISTINCT FROM ps.permissions__roles__full
       OR cs.performance__sync_group IS DISTINCT FROM ps.performance__sync_group;

    UNION ALL

    -- Handle deletes (entities that existed in previous tick but not in current)
    SELECT 
        ps.general__entity_id,
        'DELETE' as operation,
        NULL as changes,
        ps.permissions__roles__view
    FROM previous_states ps
    LEFT JOIN current_states cs ON ps.general__entity_id = cs.general__entity_id
    WHERE cs.general__entity_id IS NULL;
END;
$$ LANGUAGE plpgsql;

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

-- Modified capture_tick_state function to remove hash generation
CREATE OR REPLACE FUNCTION tick.capture_tick_state(sync_group_name text)
RETURNS void AS $$
DECLARE
    current_tick bigint;
    tick_start timestamptz;
    tick_end timestamptz;
    tick_duration double precision;
    inserted_count int;
    metadata_inserted_count int;
    is_delayed boolean;
    headroom double precision;
    sync_groups jsonb;
    tick_rate_ms int;
BEGIN
    IF NOT auth.is_admin_agent() THEN
        RAISE EXCEPTION 'Permission denied: Admin permission required';
    END IF;

    -- Get sync groups configuration
    SELECT value INTO sync_groups 
    FROM config.config 
    WHERE key = 'sync_groups';
    
    -- Validate sync group exists
    IF NOT sync_groups ? sync_group_name THEN
        RAISE EXCEPTION 'Invalid sync group: %', sync_group_name;
    END IF;

    -- Get tick rate for this sync group
    tick_rate_ms := (sync_groups #>> ARRAY[sync_group_name, 'server_tick_rate_ms'])::int;
    
    tick_start := clock_timestamp();
    
    -- Calculate current tick for this sync group
    current_tick := FLOOR(EXTRACT(EPOCH FROM tick_start) * 1000 / tick_rate_ms)::bigint;
    
    -- Modified insert statement to remove hashes
    WITH inserted AS (
        INSERT INTO tick.entity_states (
            -- Base entity fields
            general__entity_state_id,
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
            -- Performance fields
            performance__sync_group,
            -- Permission fields
            permissions__roles__view,
            permissions__roles__full,
            -- Tick-specific fields
            tick_number,
            tick_start_time,
            tick_end_time,
            tick_duration_ms
        )
        SELECT 
            -- Base entity fields
            general__entity_state_id,
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
            -- Performance fields
            performance__sync_group,
            -- Permission fields
            permissions__roles__view,
            permissions__roles__full,
            -- Tick-specific fields
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
                AND es.tick_number = current_tick
            )
        RETURNING *
    )
    SELECT COUNT(*) INTO inserted_count FROM inserted;

    tick_end := clock_timestamp();
    
    -- More precise duration calculation using microseconds
    tick_duration := EXTRACT(EPOCH FROM (tick_end - tick_start)) * 1000.0;
    is_delayed := tick_duration > tick_rate_ms;
    headroom := GREATEST(
        tick_rate_ms - tick_duration, 
        0.0
    );

    -- Always record frame metrics for each tick
    INSERT INTO tick.tick_metrics (
        tick_number,
        sync_group,
        start_time,
        end_time,
        duration_ms,
        states_processed,
        is_delayed,
        headroom_ms
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

    -- Raise warning if tick took too long
    IF is_delayed THEN
        RAISE WARNING 'Tick % exceeded target duration: %.3fms (target: %ms)',
            current_tick, tick_duration, tick_rate_ms;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Simple utility function - no special privileges needed
CREATE OR REPLACE FUNCTION tick.get_server_time()
RETURNS timestamptz AS $$
BEGIN
    RETURN CURRENT_TIMESTAMP;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

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
        WHERE timestamp < (now() - (
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
ON tick.entity_states (performance__sync_group, tick_number DESC);

-- Remove the generate_entity_field_hashes function as it's no longer needed
DROP FUNCTION IF EXISTS tick.generate_entity_field_hashes;
