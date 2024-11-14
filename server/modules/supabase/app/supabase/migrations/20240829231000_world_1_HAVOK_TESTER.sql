-- Required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "ltree";
CREATE EXTENSION IF NOT EXISTS "pg_cron";  -- For automatic cleanup

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
    angular_velocity_z float DEFAULT 0
);

-- Indexes for fast state lookups
CREATE INDEX entity_states_lookup_idx ON entity_states (entity_id, frame_number);
CREATE INDEX entity_states_timestamp_idx ON entity_states (timestamp);

-- Function to capture entity state
CREATE OR REPLACE FUNCTION capture_entity_state()
RETURNS void AS $$
DECLARE
    current_frame bigint;
BEGIN
    -- Get current frame number (60fps means we wrap around every 60 frames)
    SELECT FLOOR(EXTRACT(EPOCH FROM now()) * 60) % 60 INTO current_frame;
    
    -- Delete old states for this frame number (circular buffer)
    DELETE FROM entity_states WHERE frame_number = current_frame;
    
    -- Insert new states
    INSERT INTO entity_states (
        entity_id, frame_number,
        position_x, position_y, position_z,
        rotation_x, rotation_y, rotation_z, rotation_w,
        velocity_x, velocity_y, velocity_z,
        angular_velocity_x, angular_velocity_y, angular_velocity_z
    )
    SELECT 
        id, current_frame,
        position_x, position_y, position_z,
        rotation_x, rotation_y, rotation_z, rotation_w,
        0, 0, 0, -- Initial velocities (you'll update these from your physics engine)
        0, 0, 0  -- Initial angular velocities
    FROM entities;
    
    -- Cleanup old states beyond our 1-second window
    DELETE FROM entity_states 
    WHERE timestamp < (now() - interval '1 second');
END;
$$ LANGUAGE plpgsql;

-- Schedule state capture every 1/60th of a second (approximately)
SELECT cron.schedule(
    'capture_entity_states',  -- job name
    '* * * * * *',           -- every second
    $$SELECT capture_entity_state()$$
);

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