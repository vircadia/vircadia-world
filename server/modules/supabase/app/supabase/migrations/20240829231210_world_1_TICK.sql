-- Lag compensation state history table
CREATE TABLE entity_states (
    LIKE entities INCLUDING DEFAULTS INCLUDING CONSTRAINTS,
    
    -- Additional metadata for state tracking
    entity_id uuid NOT NULL REFERENCES entities(general__uuid) ON DELETE CASCADE,
    timestamp timestamptz DEFAULT now(),
    tick_number bigint NOT NULL,
    tick_start_time timestamptz,
    tick_end_time timestamptz,
    tick_duration_ms double precision,
    
    -- Override the primary key
    CONSTRAINT entity_states_pkey PRIMARY KEY (general__uuid)
);

-- Performance metrics table
CREATE TABLE tick_metrics (
    id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
    tick_number bigint NOT NULL,
    start_time timestamptz NOT NULL,
    end_time timestamptz NOT NULL,
    duration_ms double precision NOT NULL,
    states_processed int NOT NULL,
    is_delayed boolean NOT NULL,
    created_at timestamptz DEFAULT now(),
    headroom_ms double precision,
    rate_limited boolean DEFAULT false,
    time_since_last_tick_ms double precision
);

-- Indexes for fast state lookups
CREATE INDEX entity_states_lookup_idx ON entity_states (entity_id, tick_number);
CREATE INDEX entity_states_timestamp_idx ON entity_states (timestamp);

-- Enable RLS on entity_states table
ALTER TABLE entity_states ENABLE ROW LEVEL SECURITY;

-- View policy for entity_states (matching the entity read permissions)
CREATE POLICY "entity_states_view_policy" ON entity_states
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 
            FROM entities e
            JOIN agent_roles ar ON ar.role_name = ANY(e.permissions__can_view_roles)
            WHERE e.general__uuid = entity_states.entity_id
            AND ar.agent_id = auth.uid()
            AND ar.is_active = true
        )
    );

-- Update/Insert/Delete policies for entity_states (system users only)
CREATE POLICY "entity_states_update_policy" ON entity_states
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 
            FROM agent_roles ar
            JOIN roles r ON ar.role_name = r.role_name
            WHERE ar.agent_id = auth.uid()
            AND ar.is_active = true
            AND r.is_system = true
        )
    );

CREATE POLICY "entity_states_insert_policy" ON entity_states
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 
            FROM agent_roles ar
            JOIN roles r ON ar.role_name = r.role_name
            WHERE ar.agent_id = auth.uid()
            AND ar.is_active = true
            AND r.is_system = true
        )
    );

CREATE POLICY "entity_states_delete_policy" ON entity_states
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 
            FROM agent_roles ar
            JOIN roles r ON ar.role_name = r.role_name
            WHERE ar.agent_id = auth.uid()
            AND ar.is_active = true
            AND r.is_system = true
        )
    );

-- Function to capture entity state
CREATE OR REPLACE FUNCTION capture_tick_state()
RETURNS void AS $$
DECLARE
    current_tick bigint;
    tick_start timestamptz;
    tick_end timestamptz;
    tick_duration double precision;
    inserted_count int;
    is_delayed boolean;
    tick_rate_ms int;
    headroom double precision;
BEGIN
    -- Get configured tick rate
    SELECT (value#>>'{}'::text[])::int INTO tick_rate_ms 
    FROM world_config 
    WHERE key = 'tick_rate_ms';
    
    tick_start := clock_timestamp();
    
    SELECT FLOOR(EXTRACT(EPOCH FROM tick_start) * 1000 / tick_rate_ms)::bigint INTO current_tick
    FROM world_config 
    WHERE key = 'tick_rate_ms';
    
    -- Insert new states with timing information
    WITH inserted AS (
        INSERT INTO entity_states (
            entity_id,
            tick_number,
            tick_start_time,
            tick_end_time,
            tick_duration_ms,
            name,
            type,
            position_x,
            position_y,
            position_z,
            rotation_x,
            rotation_y,
            rotation_z,
            rotation_w,
            scale_x,
            scale_y,
            scale_z,
            velocity_x,
            velocity_y,
            velocity_z,
            angular_velocity_x,
            angular_velocity_y,
            angular_velocity_z,
            mass,
            restitution,
            friction,
            is_static
        )
        SELECT 
            general__uuid AS entity_id,
            current_tick,
            tick_start,
            clock_timestamp(),
            EXTRACT(EPOCH FROM (clock_timestamp() - tick_start))::double precision * 1000,
            general__name,
            general__type,
            babylonjs__transform_position_x,
            babylonjs__transform_position_y,
            babylonjs__transform_position_z,
            babylonjs__transform_rotation_x,
            babylonjs__transform_rotation_y,
            babylonjs__transform_rotation_z,
            babylonjs__transform_rotation_w,
            babylonjs__transform_scale_x,
            babylonjs__transform_scale_y,
            babylonjs__transform_scale_z,
            babylonjs__physics_velocity_x,
            babylonjs__physics_velocity_y,
            babylonjs__physics_velocity_z,
            babylonjs__physics_angular_velocity_x,
            babylonjs__physics_angular_velocity_y,
            babylonjs__physics_angular_velocity_z,
            babylonjs__physics_mass,
            babylonjs__physics_restitution,
            babylonjs__physics_friction,
            babylonjs__physics_is_static
        FROM entities e
        RETURNING *
    )
    SELECT COUNT(*) INTO inserted_count FROM inserted;

    tick_end := clock_timestamp();
    
    -- More precise duration calculation using microseconds
    tick_duration := EXTRACT(EPOCH FROM (tick_end - tick_start)) * 1000.0;
    is_delayed := tick_duration > tick_rate_ms;
    headroom := GREATEST(tick_rate_ms - tick_duration, 0.0);  -- Ensure headroom isn't negative

    -- Always record frame metrics for each tick
    INSERT INTO tick_metrics (
        tick_number,
        start_time,
        end_time,
        duration_ms,
        states_processed,
        is_delayed,
        headroom_ms
    ) VALUES (
        current_tick,
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
$$ LANGUAGE plpgsql;

-- Function to get entity state at a specific timestamp
CREATE OR REPLACE FUNCTION get_entity_state_at_timestamp(
    target_timestamp timestamptz
) RETURNS TABLE (
    entity_id uuid,
    position_x float,
    position_y float,
    position_z float,
    rotation_x float,
    rotation_y float,
    rotation_z float,
    rotation_w float,
    velocity_x float,
    velocity_y float,
    velocity_z float,
    angular_velocity_x float,
    angular_velocity_y float,
    angular_velocity_z float
) AS $$
BEGIN
    RETURN QUERY
    WITH closest_states AS (
        SELECT 
            es.*,
            ROW_NUMBER() OVER (PARTITION BY es.entity_id 
                              ORDER BY ABS(EXTRACT(EPOCH FROM (es.timestamp - target_timestamp)))) as rn
        FROM entity_states es
        WHERE es.timestamp BETWEEN target_timestamp - interval '1 second' 
                              AND target_timestamp + interval '1 second'
    )
    SELECT 
        entity_id,
        position_x, position_y, position_z,
        rotation_x, rotation_y, rotation_z, rotation_w,
        velocity_x, velocity_y, velocity_z,
        angular_velocity_x, angular_velocity_y, angular_velocity_z
    FROM closest_states
    WHERE rn = 1;
END;
$$ LANGUAGE plpgsql;

-- Function to get current server time
CREATE OR REPLACE FUNCTION get_server_time()
RETURNS timestamptz AS $$
BEGIN
    RETURN CURRENT_TIMESTAMP;
END;
$$ LANGUAGE plpgsql;

-- Update trigger_frame_capture to use frame_metrics
CREATE OR REPLACE FUNCTION trigger_tick_capture()
RETURNS trigger AS $$
DECLARE
    now_time timestamptz;
    last_time timestamptz;
    time_since_last_ms double precision;
    current_tick bigint;
    tick_rate_ms int;
BEGIN
    now_time := clock_timestamp();
    
    -- Get last frame time from frame_metrics
    SELECT end_time INTO last_time 
    FROM tick_metrics 
    ORDER BY end_time DESC 
    LIMIT 1;
    
    -- Calculate time since last frame
    time_since_last_ms := CASE 
        WHEN last_time IS NOT NULL THEN 
            EXTRACT(EPOCH FROM (now_time - last_time)) * 1000
        ELSE NULL 
    END;

    -- Get tick rate and calculate current tick
    SELECT (value#>>'{}'::text[])::int INTO tick_rate_ms 
    FROM world_config 
    WHERE key = 'tick_rate_ms';
    
    current_tick := FLOOR(EXTRACT(EPOCH FROM now_time) * 1000 / tick_rate_ms)::bigint;
    
    -- Insert new frame metrics entry
    INSERT INTO tick_metrics (
        tick_number,
        start_time,
        end_time,
        duration_ms,
        states_processed,
        is_delayed,
        headroom_ms,
        time_since_last_tick_ms
    ) VALUES (
        current_tick,
        now_time,
        now_time,
        0,  -- Duration will be updated by capture_entity_state()
        0,  -- States processed will be updated by capture_entity_state()
        false,  -- Is delayed will be updated by capture_entity_state()
        0,  -- Headroom will be updated by capture_entity_state()
        time_since_last_ms
    );
    
    -- Capture the frame
    PERFORM capture_tick_state();
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to cleanup old entity states (runs more frequently due to shorter retention)
CREATE OR REPLACE FUNCTION cleanup_old_entity_states()
RETURNS void AS $$
DECLARE
    states_cleaned integer;
BEGIN
    WITH deleted_states AS (
        DELETE FROM entity_states 
        WHERE timestamp < (now() - (
            SELECT (value#>>'{}'::text[])::int * interval '1 millisecond' 
            FROM world_config 
            WHERE key = 'tick_buffer_duration_ms'
        ))
        RETURNING *
    )
    SELECT COUNT(*) INTO states_cleaned FROM deleted_states;
    
    -- Log cleanup results if anything was cleaned
    IF states_cleaned > 0 THEN
        RAISE NOTICE 'Entity states cleanup completed: % states removed', states_cleaned;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Function to cleanup old frame metrics (runs less frequently due to longer retention)
CREATE OR REPLACE FUNCTION cleanup_old_tick_metrics()
RETURNS void AS $$
DECLARE
    metrics_cleaned integer;
BEGIN
    WITH deleted_metrics AS (
        DELETE FROM tick_metrics 
        WHERE created_at < (now() - (
            SELECT (value#>>'{}'::text[])::int * interval '1 millisecond' 
            FROM world_config 
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
$$ LANGUAGE plpgsql;

-- Enable RLS on tick_metrics table
ALTER TABLE tick_metrics ENABLE ROW LEVEL SECURITY;

-- All policies for tick_metrics (system users only)
CREATE POLICY "tick_metrics_view_policy" ON tick_metrics
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 
            FROM agent_roles ar
            JOIN roles r ON ar.role_name = r.role_name
            WHERE ar.agent_id = auth.uid()
            AND ar.is_active = true
            AND r.is_system = true
        )
    );

CREATE POLICY "tick_metrics_update_policy" ON tick_metrics
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 
            FROM agent_roles ar
            JOIN roles r ON ar.role_name = r.role_name
            WHERE ar.agent_id = auth.uid()
            AND ar.is_active = true
            AND r.is_system = true
        )
    );

CREATE POLICY "tick_metrics_insert_policy" ON tick_metrics
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 
            FROM agent_roles ar
            JOIN roles r ON ar.role_name = r.role_name
            WHERE ar.agent_id = auth.uid()
            AND ar.is_active = true
            AND r.is_system = true
        )
    );

CREATE POLICY "tick_metrics_delete_policy" ON tick_metrics
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 
            FROM agent_roles ar
            JOIN roles r ON ar.role_name = r.role_name
            WHERE ar.agent_id = auth.uid()
            AND ar.is_active = true
            AND r.is_system = true
        )
    );
