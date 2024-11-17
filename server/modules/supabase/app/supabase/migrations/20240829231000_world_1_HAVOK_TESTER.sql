-- Required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "ltree";

-- Configuration table
CREATE TABLE world_config (
    key text PRIMARY KEY,
    value jsonb NOT NULL,
    description text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Insert default configuration
INSERT INTO world_config (key, value, description) VALUES
('tick_rate_ms', '50'::jsonb, 'Server tick rate in milliseconds (20 ticks per second)'),
('tick_buffer_duration_ms', '1000'::jsonb, 'How long to keep tick history in milliseconds'),
('frame_metrics_history_seconds', '3600'::jsonb, 'How long to keep frame metrics history in seconds (1 hour default)');

-- Core tables for physics testing
CREATE TABLE entities (
    id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
    name text,
    type text NOT NULL,  -- 'Box', 'Sphere', etc.
    
    -- Position
    position_x float DEFAULT 0,
    position_y float DEFAULT 0,
    position_z float DEFAULT 0,
    
    -- Rotation (quaternion)
    rotation_x float DEFAULT 0,
    rotation_y float DEFAULT 0,
    rotation_z float DEFAULT 0,
    rotation_w float DEFAULT 1,
    
    -- Scale
    scale_x float DEFAULT 1,
    scale_y float DEFAULT 1,
    scale_z float DEFAULT 1,
    
    -- Physics properties
    mass float DEFAULT 1,
    restitution float DEFAULT 0.2,
    friction float DEFAULT 0.5,
    is_static boolean DEFAULT false,
    
    -- Metadata
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    last_edited_by uuid
);

-- Lag compensation state history table
CREATE TABLE entity_states (
    id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
    entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    timestamp timestamptz DEFAULT now(),
    frame_number bigint NOT NULL,
    
    -- Position
    position_x float,
    position_y float,
    position_z float,
    
    -- Rotation (quaternion)
    rotation_x float,
    rotation_y float,
    rotation_z float,
    rotation_w float,
    
    -- Velocity
    velocity_x float DEFAULT 0,
    velocity_y float DEFAULT 0,
    velocity_z float DEFAULT 0,
    
    -- Angular velocity
    angular_velocity_x float DEFAULT 0,
    angular_velocity_y float DEFAULT 0,
    angular_velocity_z float DEFAULT 0,
    
    -- Frame timing information
    frame_start_time timestamptz,
    frame_end_time timestamptz,
    frame_duration_ms float
);

-- Performance metrics table
CREATE TABLE frame_metrics (
    id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
    frame_number bigint NOT NULL,
    start_time timestamptz NOT NULL,
    end_time timestamptz NOT NULL,
    duration_ms float NOT NULL,
    states_processed int NOT NULL,
    is_delayed boolean NOT NULL,
    created_at timestamptz DEFAULT now(),
    headroom_ms float
);

-- Indexes for fast state lookups
CREATE INDEX entity_states_lookup_idx ON entity_states (entity_id, frame_number);
CREATE INDEX entity_states_timestamp_idx ON entity_states (timestamp);

-- Function to capture entity state
CREATE OR REPLACE FUNCTION capture_entity_state()
RETURNS void AS $$
DECLARE
    current_tick bigint;
    tick_start timestamptz;
    tick_end timestamptz;
    tick_duration float;
    deleted_tick_count int;
    inserted_count int;
    cleaned_old_count int;
    cleaned_metrics_count int;
    is_delayed boolean;
    tick_rate_ms int;
    headroom float;
BEGIN
    -- Get configured tick rate
    SELECT (value#>>'{}'::text[])::int INTO tick_rate_ms 
    FROM world_config 
    WHERE key = 'tick_rate_ms';
    
    tick_start := transaction_timestamp();
    
    -- Calculate current tick number using database time instead of client time
    SELECT FLOOR(EXTRACT(EPOCH FROM tick_start) * 1000 / tick_rate_ms)::bigint INTO current_tick
    FROM world_config 
    WHERE key = 'tick_rate_ms';
    
    -- Delete old states for this tick number (circular buffer)
    WITH deleted AS (
        DELETE FROM entity_states 
        WHERE frame_number = current_tick
        RETURNING *
    )
    SELECT COUNT(*) INTO deleted_tick_count FROM deleted;
    
    -- Insert new states with timing information
    WITH inserted AS (
        INSERT INTO entity_states (
            entity_id, 
            frame_number,  -- Using frame_number for tick_number (keeping column name for compatibility)
            position_x, position_y, position_z,
            rotation_x, rotation_y, rotation_z, rotation_w,
            velocity_x, velocity_y, velocity_z,
            angular_velocity_x, angular_velocity_y, angular_velocity_z,
            frame_start_time,  -- Using frame_* for tick_* (keeping column names for compatibility)
            frame_end_time,
            frame_duration_ms
        )
        SELECT 
            id, current_tick,
            position_x, position_y, position_z,
            rotation_x, rotation_y, rotation_z, rotation_w,
            0, 0, 0,  -- Initial velocities
            0, 0, 0,  -- Initial angular velocities
            tick_start,
            transaction_timestamp(),
            EXTRACT(EPOCH FROM (transaction_timestamp() - tick_start)) * 1000
        FROM entities
        RETURNING *
    )
    SELECT COUNT(*) INTO inserted_count FROM inserted;
    
    -- Cleanup old states beyond our buffer window
    WITH cleaned AS (
        DELETE FROM entity_states 
        WHERE timestamp < (now() - (
            SELECT (value#>>'{}'::text[])::int * interval '1 millisecond' 
            FROM world_config 
            WHERE key = 'tick_buffer_duration_ms'
        ))
        RETURNING *
    )
    SELECT COUNT(*) INTO cleaned_old_count FROM cleaned;

    -- Cleanup old frame metrics
    WITH cleaned_metrics AS (
        DELETE FROM frame_metrics 
        WHERE created_at < (now() - (
            SELECT (value#>>'{}'::text[])::int * interval '1 second' 
            FROM world_config 
            WHERE key = 'frame_metrics_history_seconds'
        ))
        RETURNING *
    )
    SELECT COUNT(*) INTO cleaned_metrics_count FROM cleaned_metrics;

    tick_end := transaction_timestamp();
    tick_duration := EXTRACT(EPOCH FROM (tick_end - tick_start)) * 1000;
    is_delayed := tick_duration > tick_rate_ms;

    -- Calculate headroom
    headroom := tick_rate_ms - tick_duration;

    -- Update metrics recording with headroom
    INSERT INTO frame_metrics (
        frame_number,
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
        RAISE WARNING 'Tick % exceeded target duration: %.2fms (target: %ms)',
            current_tick, tick_duration, tick_rate_ms;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Function to get performance statistics
CREATE OR REPLACE FUNCTION get_frame_performance_stats(
    window_seconds int DEFAULT 60
)
RETURNS TABLE (
    avg_duration_ms float,
    max_duration_ms float,
    min_duration_ms float,
    delayed_frames_count bigint,
    total_frames bigint
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        AVG(duration_ms)::float as avg_duration_ms,
        MAX(duration_ms)::float as max_duration_ms,
        MIN(duration_ms)::float as min_duration_ms,
        COUNT(*) FILTER (WHERE is_delayed) as delayed_frames_count,
        COUNT(*) as total_frames
    FROM frame_metrics
    WHERE created_at > now() - (window_seconds || ' seconds')::interval;
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