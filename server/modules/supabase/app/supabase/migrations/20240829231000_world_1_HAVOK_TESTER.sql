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
    
    -- Velocity
    velocity_x float DEFAULT 0,
    velocity_y float DEFAULT 0,
    velocity_z float DEFAULT 0,
    
    -- Angular velocity
    angular_velocity_x float DEFAULT 0,
    angular_velocity_y float DEFAULT 0,
    angular_velocity_z float DEFAULT 0,
    
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
    LIKE entities INCLUDING DEFAULTS INCLUDING CONSTRAINTS,
    
    -- Additional metadata for state tracking
    entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    timestamp timestamptz DEFAULT now(),
    frame_number bigint NOT NULL,
    frame_start_time timestamptz,
    frame_end_time timestamptz,
    frame_duration_ms double precision,
    
    -- Override the primary key
    CONSTRAINT entity_states_pkey PRIMARY KEY (id)
);

-- Performance metrics table
CREATE TABLE frame_metrics (
    id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
    frame_number bigint NOT NULL,
    start_time timestamptz NOT NULL,
    end_time timestamptz NOT NULL,
    duration_ms double precision NOT NULL,
    states_processed int NOT NULL,
    is_delayed boolean NOT NULL,
    created_at timestamptz DEFAULT now(),
    headroom_ms double precision,
    rate_limited boolean DEFAULT false,
    time_since_last_frame_ms double precision
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
    tick_duration double precision;
    deleted_tick_count int;
    inserted_count int;
    cleaned_old_count int;
    cleaned_metrics_count int;
    is_delayed boolean;
    tick_rate_ms int;
    headroom double precision;
BEGIN
    -- Get configured tick rate
    SELECT (value#>>'{}'::text[])::int INTO tick_rate_ms 
    FROM world_config 
    WHERE key = 'tick_rate_ms';
    
    tick_start := clock_timestamp();
    
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
            frame_duration_ms,
            type,  -- Added missing type column
            scale_x, scale_y, scale_z,  -- Added scale columns if they exist in entities
            mass,  -- Added mass if it exists in entities
            is_static,  -- Added is_static if it exists in entities
            is_kinematic  -- Added is_kinematic if it exists in entities
        )
        SELECT 
            id, current_tick,
            position_x, position_y, position_z,
            rotation_x, rotation_y, rotation_z, rotation_w,
            0, 0, 0,  -- Initial velocities
            0, 0, 0,  -- Initial angular velocities
            tick_start,
            transaction_timestamp(),
            EXTRACT(EPOCH FROM (transaction_timestamp() - tick_start))::double precision * 1000,
            type,  -- Selected from entities
            scale_x, scale_y, scale_z,  -- Selected from entities
            mass,  -- Selected from entities
            is_static,  -- Selected from entities
            is_kinematic  -- Selected from entities
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

    tick_end := clock_timestamp();
    
    -- More precise duration calculation using microseconds
    tick_duration := EXTRACT(EPOCH FROM (tick_end - tick_start)) * 1000.0;
    is_delayed := tick_duration > tick_rate_ms;
    headroom := GREATEST(tick_rate_ms - tick_duration, 0.0);  -- Ensure headroom isn't negative

    -- Only clean metrics occasionally (e.g., every 100 ticks)
    IF current_tick % 100 = 0 THEN
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
    END IF;

    -- Always record frame metrics for each tick
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

-- Update should_capture_frame to use frame_metrics
CREATE OR REPLACE FUNCTION should_capture_frame()
RETURNS boolean AS $$
DECLARE
    now_time timestamptz;
    last_time timestamptz;
    tick_rate_ms int;
BEGIN
    now_time := clock_timestamp();
    
    -- Get configured tick rate
    SELECT (value#>>'{}'::text[])::int INTO tick_rate_ms 
    FROM world_config 
    WHERE key = 'tick_rate_ms';
    
    -- Get last frame time from frame_metrics
    SELECT end_time INTO last_time 
    FROM frame_metrics 
    ORDER BY end_time DESC 
    LIMIT 1;
    
    -- If no last frame time, allow capture
    IF last_time IS NULL THEN
        RETURN true;
    END IF;
    
    -- Check if enough time has passed since last frame
    RETURN EXTRACT(EPOCH FROM (now_time - last_time)) * 1000 >= tick_rate_ms;
END;
$$ LANGUAGE plpgsql;

-- Update trigger_frame_capture to use frame_metrics
CREATE OR REPLACE FUNCTION trigger_frame_capture()
RETURNS trigger AS $$
DECLARE
    now_time timestamptz;
    last_time timestamptz;
    tick_rate_ms int;
    time_since_last_ms double precision;
BEGIN
    now_time := clock_timestamp();
    
    -- Get last frame time from frame_metrics
    SELECT end_time INTO last_time 
    FROM frame_metrics 
    ORDER BY end_time DESC 
    LIMIT 1;
    
    -- Calculate time since last frame
    time_since_last_ms := CASE 
        WHEN last_time IS NOT NULL THEN 
            EXTRACT(EPOCH FROM (now_time - last_time)) * 1000
        ELSE NULL 
    END;
    
    -- Only capture frame if we haven't exceeded our rate limit
    IF should_capture_frame() THEN
        -- Capture the frame
        PERFORM capture_entity_state();
        
        -- Update the most recent frame_metrics entry with rate limiting info
        UPDATE frame_metrics 
        SET rate_limited = false,
            time_since_last_frame_ms = time_since_last_ms
        WHERE id = (
            SELECT id 
            FROM frame_metrics 
            ORDER BY created_at DESC 
            LIMIT 1
        );
    ELSE
        -- Log skipped frame in metrics
        INSERT INTO frame_metrics (
            frame_number,
            start_time,
            end_time,
            duration_ms,
            states_processed,
            is_delayed,
            headroom_ms,
            rate_limited,
            time_since_last_frame_ms
        ) VALUES (
            -- Calculate frame number same way as capture_entity_state()
            FLOOR(EXTRACT(EPOCH FROM now_time) * 1000 / (
                SELECT (value#>>'{}'::text[])::int 
                FROM world_config 
                WHERE key = 'tick_rate_ms'
            ))::bigint,
            now_time,
            now_time,
            0,  -- Duration is 0 for skipped frames
            0,  -- No states processed
            false,
            0,  -- No headroom calculation needed
            true,  -- Was rate limited
            time_since_last_ms
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to capture state on entity changes
CREATE TRIGGER entity_state_capture
AFTER INSERT OR UPDATE ON entities
FOR EACH ROW
EXECUTE FUNCTION trigger_frame_capture();
