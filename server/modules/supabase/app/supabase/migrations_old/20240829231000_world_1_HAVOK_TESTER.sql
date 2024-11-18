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
