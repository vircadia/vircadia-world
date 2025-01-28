-- Create tick schema
CREATE SCHEMA IF NOT EXISTS tick;

-- Lag compensation state history table
CREATE TABLE tick.entity_states (
    LIKE entity.entities INCLUDING DEFAULTS INCLUDING CONSTRAINTS,
    
    -- Additional metadata for state tracking (remove general__entity_id since it's already included)
    general__entity_state_id uuid DEFAULT uuid_generate_v4(),
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

-- Function to generate consistent field group hashes
CREATE OR REPLACE FUNCTION tick.generate_entity_field_hashes(
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
    -- Replace system permission check with is_admin_agent()
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
    
    -- Modified insert statement to include hashes
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
            tick_duration_ms,
            hash__general,
            hash__meta,
            hash__scripts,
            hash__permissions,
            hash__performance
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
            EXTRACT(EPOCH FROM (clock_timestamp() - tick_start))::double precision * 1000,
            h.hash_general,
            h.hash_meta,
            h.hash_scripts,
            h.hash_permissions,
            h.hash_performance
        FROM entity.entities e
        CROSS JOIN LATERAL tick.generate_entity_field_hashes(
            -- General fields
            jsonb_build_object(
                'uuid', e.general__entity_id,
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
