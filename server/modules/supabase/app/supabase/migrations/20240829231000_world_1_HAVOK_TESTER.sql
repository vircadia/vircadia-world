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
('physics_framerate', '60'::jsonb, 'Target physics framerate (frames per second)'),
('physics_frame_duration_ms', '16.67'::jsonb, 'Target duration per physics frame in milliseconds');

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
    created_at timestamptz DEFAULT now()
);

-- Indexes for fast state lookups
CREATE INDEX entity_states_lookup_idx ON entity_states (entity_id, frame_number);
CREATE INDEX entity_states_timestamp_idx ON entity_states (timestamp);

-- Function to capture entity state
CREATE OR REPLACE FUNCTION capture_entity_state()
RETURNS void AS $$
DECLARE
    current_frame bigint;
    frame_start timestamptz;
    frame_end timestamptz;
    frame_duration float;
    deleted_frame_count int;
    inserted_count int;
    cleaned_old_count int;
    is_delayed boolean;
    target_fps float;
    target_interval_ms float;
BEGIN
    -- Get configured framerate
    SELECT (value#>>'{}'::text[])::float INTO target_fps 
    FROM world_config 
    WHERE key = 'physics_framerate';
    
    SELECT (value#>>'{}'::text[])::float INTO target_interval_ms 
    FROM world_config 
    WHERE key = 'physics_frame_duration_ms';
    
    frame_start := clock_timestamp();
    
    -- Get current frame number
    SELECT FLOOR(EXTRACT(EPOCH FROM frame_start) * target_fps) % target_fps INTO current_frame;
    
    -- Delete old states for this frame number (circular buffer)
    WITH deleted AS (
        DELETE FROM entity_states 
        WHERE frame_number = current_frame
        RETURNING *
    )
    SELECT COUNT(*) INTO deleted_frame_count FROM deleted;
    
    -- Insert new states with timing information
    WITH inserted AS (
        INSERT INTO entity_states (
            entity_id, frame_number,
            position_x, position_y, position_z,
            rotation_x, rotation_y, rotation_z, rotation_w,
            velocity_x, velocity_y, velocity_z,
            angular_velocity_x, angular_velocity_y, angular_velocity_z,
            frame_start_time,
            frame_end_time,
            frame_duration_ms
        )
        SELECT 
            id, current_frame,
            position_x, position_y, position_z,
            rotation_x, rotation_y, rotation_z, rotation_w,
            0, 0, 0,
            0, 0, 0,
            frame_start,
            clock_timestamp(),
            EXTRACT(EPOCH FROM (clock_timestamp() - frame_start)) * 1000
        FROM entities
        RETURNING *
    )
    SELECT COUNT(*) INTO inserted_count FROM inserted;
    
    -- Cleanup old states beyond our 1-second window
    WITH cleaned AS (
        DELETE FROM entity_states 
        WHERE timestamp < (now() - interval '1 second')
        RETURNING *
    )
    SELECT COUNT(*) INTO cleaned_old_count FROM cleaned;

    frame_end := clock_timestamp();
    frame_duration := EXTRACT(EPOCH FROM (frame_end - frame_start)) * 1000;
    is_delayed := frame_duration > target_interval_ms;

    -- Record metrics
    INSERT INTO frame_metrics (
        frame_number,
        start_time,
        end_time,
        duration_ms,
        states_processed,
        is_delayed
    ) VALUES (
        current_frame,
        frame_start,
        frame_end,
        frame_duration,
        inserted_count,
        is_delayed
    );

    -- Raise warning if frame took too long
    IF is_delayed THEN
        RAISE WARNING 'Frame % exceeded target duration: %.2fms (target: %.2fms)',
            current_frame, frame_duration, target_interval_ms;
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