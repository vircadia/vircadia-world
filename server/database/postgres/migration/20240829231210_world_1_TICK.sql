-- Create tick schema
CREATE SCHEMA IF NOT EXISTS tick;

-- Lag compensation state history table
CREATE TABLE tick.entity_states (
    LIKE entity.entities INCLUDING DEFAULTS INCLUDING CONSTRAINTS,
    
    -- Additional metadata for state tracking
    general__entity_id uuid NOT NULL REFERENCES entity.entities(general__uuid) ON DELETE CASCADE,
    timestamp timestamptz DEFAULT now(),
    tick_number bigint NOT NULL,
    tick_start_time timestamptz,
    tick_end_time timestamptz,
    tick_duration_ms double precision,

    -- Field hashes
    hash__general text,
    hash__meta text,
    hash__scripts text,
    hash__permissions text,
    hash__performance text,

    -- Override the primary key
    CONSTRAINT entity_states_pkey PRIMARY KEY (general__uuid)
);

-- Performance metrics table
CREATE TABLE tick.tick_metrics (
    id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
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
CREATE INDEX entity_states_lookup_idx ON tick.entity_states (general__entity_id, tick_number);
CREATE INDEX entity_states_timestamp_idx ON tick.entity_states (timestamp);

-- Enable RLS on entity_states table
ALTER TABLE tick.entity_states ENABLE ROW LEVEL SECURITY;

-- View policy for entity_states (matching the entity read permissions)
CREATE POLICY "entity_states_view_policy" ON tick.entity_states
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 
            FROM entity.entities e
            JOIN auth.agent_roles ar ON ar.auth__role_name = ANY(e.permissions__roles__view)
            WHERE e.general__uuid = tick.entity_states.general__entity_id
            AND ar.auth__agent_id = current_agent_id()
            AND ar.auth__is_active = true
        )
    );

-- Update/Insert/Delete policies for entity_states (system users only)
CREATE POLICY "entity_states_update_policy" ON tick.entity_states
    FOR UPDATE
    USING (is_admin_agent());

CREATE POLICY "entity_states_insert_policy" ON tick.entity_states
    FOR INSERT
    WITH CHECK (is_admin_agent());

CREATE POLICY "entity_states_delete_policy" ON tick.entity_states
    FOR DELETE
    USING (is_admin_agent());

-- Function to generate consistent field group hashes
CREATE OR REPLACE FUNCTION generate_entity_field_hashes(
    general_fields jsonb,
    meta_fields jsonb,
    scripts_fields jsonb,
    permissions_fields jsonb,
    performance_fields jsonb
) RETURNS table (
    hash_general text,
    hash_meta text,
    hash_scripts text,
    hash_permissions text,
    hash_performance text
) AS $$
BEGIN
    RETURN QUERY SELECT 
        md5(general_fields::text) as hash_general,
        md5(meta_fields::text) as hash_meta,
        md5(scripts_fields::text) as hash_scripts,
        md5(permissions_fields::text) as hash_permissions,
        md5(performance_fields::text) as hash_performance;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to capture entity state - needs SECURITY DEFINER to bypass RLS
CREATE OR REPLACE FUNCTION capture_tick_state(sync_group_name text)
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
    -- Replace system permission check with is_admin_agent()
    IF NOT is_admin_agent() THEN
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
    
    -- Modified insert statement to include hashes
    WITH inserted AS (
        INSERT INTO tick.entity_states (
            -- Base entity fields
            general__entity_id,
            general__uuid,
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
            tick_duration_ms,
            hash__general,
            hash__meta,
            hash__scripts,
            hash__permissions,
            hash__performance
        )
        SELECT 
            -- Base entity fields
            general__uuid AS general__entity_id,
            general__uuid,
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
            EXTRACT(EPOCH FROM (clock_timestamp() - tick_start))::double precision * 1000,
            h.hash_general,
            h.hash_meta,
            h.hash_scripts,
            h.hash_permissions,
            h.hash_performance
        FROM entity.entities e
        CROSS JOIN LATERAL generate_entity_field_hashes(
            -- General fields
            jsonb_build_object(
                'uuid', e.general__uuid,
                'name', e.general__name,
                'semantic_version', e.general__semantic_version,
                'created_at', e.general__created_at,
                'created_by', e.general__created_by,
                'updated_at', e.general__updated_at,
                'updated_by', e.general__updated_by,
                'load_priority', e.general__load_priority,
                'initialized_at', e.general__initialized_at,
                'initialized_by', e.general__initialized_by
            ),
            -- Meta fields
            jsonb_build_object(
                'data', e.meta__data
            ),
            -- Scripts fields
            jsonb_build_object(
                'ids', e.scripts__ids,
                'validation_log', e.validation__log
            ),
            -- Permissions fields
            jsonb_build_object(
                'roles_view', e.permissions__roles__view,
                'roles_full', e.permissions__roles__full
            ),
            -- Performance fields
            jsonb_build_object(
                'sync_group', e.performance__sync_group
            )
        ) h
        WHERE 
            -- Only process entities in this sync group
            COALESCE(e.performance__sync_group, 'NORMAL') = sync_group_name
            -- And only if they need an update
            AND NOT EXISTS (
                SELECT 1 
                FROM tick.entity_states es
                WHERE es.general__entity_id = e.general__uuid
                AND es.timestamp > (tick_start - (tick_rate_ms * interval '1 millisecond'))
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
CREATE OR REPLACE FUNCTION get_server_time()
RETURNS timestamptz AS $$
BEGIN
    RETURN CURRENT_TIMESTAMP;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

-- Modified trigger function without arguments
CREATE OR REPLACE FUNCTION trigger_tick_capture()
RETURNS trigger AS $$
DECLARE
    now_time timestamptz;
    last_time timestamptz;
    time_since_last_ms double precision;
    current_tick bigint;
    sync_groups jsonb;
    sync_group_name text;
BEGIN
    -- Get sync_group_name from NEW record or another source
    sync_group_name := NEW.sync_group; -- Assuming the sync_group is passed in the NEW record
    
    -- Replace system role check with is_admin_agent()
    IF NOT is_admin_agent() THEN
        RAISE EXCEPTION 'Permission denied: Admin permission required';
    END IF;

    -- Validate sync_group_name
    SELECT value INTO sync_groups 
    FROM config.config 
    WHERE key = 'sync_groups';
    
    IF NOT sync_groups ? sync_group_name THEN
        RAISE EXCEPTION 'Invalid sync group: %', sync_group_name;
    END IF;

    now_time := clock_timestamp();
    
    -- Get last frame time for this sync group
    SELECT end_time INTO last_time 
    FROM tick.tick_metrics 
    WHERE sync_group = sync_group_name
    ORDER BY end_time DESC 
    LIMIT 1;
    
    -- Calculate time since last frame
    time_since_last_ms := CASE 
        WHEN last_time IS NOT NULL THEN 
            EXTRACT(EPOCH FROM (now_time - last_time)) * 1000
        ELSE NULL 
    END;

    -- Calculate current tick based on sync group's tick rate
    current_tick := FLOOR(EXTRACT(EPOCH FROM now_time) * 1000 / 
        (sync_groups #>> ARRAY[sync_group_name, 'server_tick_rate_ms'])::int)::bigint;
    
    -- Insert new frame metrics entry for this sync group
    INSERT INTO tick.tick_metrics (
        tick_number,
        sync_group,
        start_time,
        end_time,
        duration_ms,
        states_processed,
        is_delayed,
        headroom_ms,
        time_since_last_tick_ms
    ) VALUES (
        current_tick,
        sync_group_name,
        now_time,
        now_time,
        0,
        0,
        false,
        0,
        time_since_last_ms
    );
    
    -- Capture the frame states for this sync group
    PERFORM capture_tick_state(sync_group_name);
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Cleanup functions need SECURITY DEFINER to bypass RLS
CREATE OR REPLACE FUNCTION cleanup_old_entity_states()
RETURNS void AS $$
DECLARE
    states_cleaned integer;
BEGIN
    -- Replace system role check with is_admin_agent()
    IF NOT is_admin_agent() THEN
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

CREATE OR REPLACE FUNCTION cleanup_old_tick_metrics()
RETURNS void AS $$
DECLARE
    metrics_cleaned integer;
BEGIN
    -- Replace system role check with is_admin_agent()
    IF NOT is_admin_agent() THEN
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
    USING (is_admin_agent());

CREATE POLICY "tick_metrics_update_policy" ON tick.tick_metrics
    FOR UPDATE
    USING (is_admin_agent());

CREATE POLICY "tick_metrics_insert_policy" ON tick.tick_metrics
    FOR INSERT
    WITH CHECK (is_admin_agent());

CREATE POLICY "tick_metrics_delete_policy" ON tick.tick_metrics
    FOR DELETE
    USING (is_admin_agent());
