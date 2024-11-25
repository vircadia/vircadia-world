--
-- CORE TYPES
--
CREATE TYPE color4 AS (
    r NUMERIC,
    g NUMERIC,
    b NUMERIC,
    a NUMERIC
);

CREATE TYPE vector3 AS (
    x NUMERIC,
    y NUMERIC,
    z NUMERIC
);

CREATE TYPE quaternion AS (
    x NUMERIC,
    y NUMERIC,
    z NUMERIC,
    w NUMERIC
);

CREATE TYPE joint AS (
    name TEXT,
    index INTEGER,
    position vector3,
    rotation quaternion,
    scale vector3,
    inverse_bind_matrix NUMERIC[16],
    parent_index INTEGER
);

CREATE TYPE transform AS (
    position vector3,
    rotation vector3,
    scale vector3
);

CREATE TYPE entity_type_babylonjs_enum AS ENUM (
    -- Core object types
    'MESH',
    'LIGHT',
    'CAMERA',
    'MATERIAL',
    
    -- Additional mesh types
    'INSTANCE_MESH',
    'GROUND_MESH',
    'BOX_MESH', 
    'SPHERE_MESH',
    'CYLINDER_MESH',
    'PLANE_MESH',
    'DISC_MESH',
    'TORUS_MESH',
    'CAPSULE_MESH',
    
    -- Special mesh types
    'SPRITE',
    'PARTICLE_SYSTEM',
    'GLTF_MESH',
    'VOLUME',
    'SKELETAL_MESH',
    'MORPH_MESH',
    'INSTANCED_MESH',
    
    -- Scene components
    'TRANSFORM_NODE',
    'BONE_NODE',
    'PHYSICS_BODY',
    'COLLISION_MESH',
    
    -- Effects & Environment
    'SKYBOX',
    'ENVIRONMENT',
    'POST_PROCESS',
    'LENS_FLARE',
    'REFLECTION_PROBE',
    
    -- Controls & UI
    'GUI_ELEMENT',
    'CONTROL',
    
    -- Audio
    'SOUND',
    
    -- Animation
    'ANIMATION',
    'ANIMATION_GROUP'
);

CREATE TYPE babylonjs__lod_mode_enum AS ENUM ('distance', 'size');
CREATE TYPE babylonjs__lod_level_enum AS ENUM ('LOD0', 'LOD1', 'LOD2', 'LOD3', 'LOD4');
CREATE TYPE babylonjs__billboard_mode_enum AS ENUM (
    'BILLBOARDMODE_NONE',
    'BILLBOARDMODE_X',
    'BILLBOARDMODE_Y',
    'BILLBOARDMODE_Z',
    'BILLBOARDMODE_ALL'
);
CREATE TYPE babylonjs__light_type_enum AS ENUM ('POINT', 'DIRECTIONAL', 'SPOT', 'HEMISPHERIC');
CREATE TYPE babylonjs__light_mode_enum AS ENUM ('default', 'shadowsOnly', 'specular');
CREATE TYPE babylonjs__shadow_quality_enum AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE babylonjs__texture_color_space_enum AS ENUM ('linear', 'sRGB', 'gamma');

--
-- ENTITIES AND CAPABILITIES
--

CREATE TABLE entities (
    general__uuid UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    general__name VARCHAR(255) NOT NULL,
    general__semantic_version TEXT NOT NULL DEFAULT '1.0.0',
    general__created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    general__updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    general__parent_entity_id UUID REFERENCES entities(general__uuid) ON DELETE CASCADE,
    general__permissions__roles__view TEXT[],

    babylonjs__type entity_type_babylonjs_enum NOT NULL,

    babylonjs__transform_position_x FLOAT DEFAULT 0,
    babylonjs__transform_position_y FLOAT DEFAULT 0,
    babylonjs__transform_position_z FLOAT DEFAULT 0,
    babylonjs__transform_rotation_x FLOAT DEFAULT 0,
    babylonjs__transform_rotation_y FLOAT DEFAULT 0,
    babylonjs__transform_rotation_z FLOAT DEFAULT 0,
    babylonjs__transform_rotation_w FLOAT DEFAULT 1,
    babylonjs__transform_scale_x FLOAT DEFAULT 1,
    babylonjs__transform_scale_y FLOAT DEFAULT 1,
    babylonjs__transform_scale_z FLOAT DEFAULT 1,

    babylonjs__mesh_is_instance BOOLEAN DEFAULT FALSE,
    babylonjs__mesh_instance_of_id UUID REFERENCES entities(general__uuid) ON DELETE CASCADE,
    babylonjs__mesh_material_id UUID REFERENCES entities(general__uuid) ON DELETE CASCADE,
    babylonjs__mesh_gltf_file_path VARCHAR(255),
    babylonjs__mesh_gltf_data JSONB,
    babylonjs__mesh_physics_properties JSON,
    babylonjs__mesh_joints joint[],
    babylonjs__mesh_check_collisions BOOLEAN DEFAULT FALSE,
    babylonjs__mesh_is_pickable BOOLEAN DEFAULT FALSE,
    babylonjs__mesh_is_visible BOOLEAN DEFAULT TRUE,
    babylonjs__mesh_receive_shadows BOOLEAN DEFAULT FALSE,
    babylonjs__mesh_visibility FLOAT DEFAULT 1.0,
    babylonjs__mesh_rendering_group_id INTEGER,
    babylonjs__mesh_has_vertex_alpha BOOLEAN DEFAULT FALSE,
    babylonjs__mesh_use_vertex_colors BOOLEAN DEFAULT TRUE,
    babylonjs__mesh_overlay_color color4,
    babylonjs__mesh_overlay_alpha FLOAT,
    babylonjs__mesh_infinite_distance BOOLEAN DEFAULT FALSE,
    babylonjs__mesh_show_bounding_box BOOLEAN DEFAULT FALSE,
    babylonjs__mesh_show_subMeshes_bounding_box BOOLEAN DEFAULT FALSE,
    babylonjs__mesh_alpha_index INTEGER DEFAULT 1000,

    babylonjs__lod_mode babylonjs__lod_mode_enum,
    babylonjs__lod_level babylonjs__lod_level_enum,
    babylonjs__lod_auto BOOLEAN,
    babylonjs__lod_distance NUMERIC,
    babylonjs__lod_size NUMERIC,
    babylonjs__lod_hide NUMERIC,

    babylonjs__billboard_mode babylonjs__billboard_mode_enum,

    babylonjs__light_type babylonjs__light_type_enum,
    babylonjs__light_mode babylonjs__light_mode_enum,
    babylonjs__light_intensity FLOAT,
    babylonjs__light_range FLOAT,
    babylonjs__light_radius FLOAT,
    babylonjs__light_diffuse color4,
    babylonjs__light_specular color4,
    babylonjs__light_direction vector3,
    babylonjs__light_angle FLOAT,
    babylonjs__light_exponent FLOAT,
    babylonjs__light_ground_color color4,
    babylonjs__light_intensity_mode TEXT,
    babylonjs__light_falloff_type TEXT,
    babylonjs__light_shadow_min_z FLOAT,
    babylonjs__light_shadow_max_z FLOAT,
    babylonjs__light_projection_texture_matrix NUMERIC[16],
    babylonjs__light_custom_projection_texture TEXT,
    babylonjs__light_exclude_mesh_ids TEXT[],
    babylonjs__light_include_only_mesh_ids TEXT[],

    babylonjs__shadow_enabled BOOLEAN,
    babylonjs__shadow_bias FLOAT,
    babylonjs__shadow_blur_kernel FLOAT,
    babylonjs__shadow_darkness FLOAT,
    babylonjs__shadow_frustum_size FLOAT,
    babylonjs__shadow_map_size INTEGER,
    babylonjs__shadow_quality babylonjs__shadow_quality_enum,

    babylonjs__material_type TEXT,
    babylonjs__material_ambient color4,
    babylonjs__material_diffuse color4,
    babylonjs__material_specular color4,
    babylonjs__material_emissive color4,
    babylonjs__material_alpha FLOAT,
    babylonjs__material_backFaceCulling BOOLEAN,
    babylonjs__material_wireframe BOOLEAN,
    babylonjs__material_diffuse_texture TEXT,
    babylonjs__material_diffuse_texture_color_space babylonjs__texture_color_space_enum,
    babylonjs__material_ambient_texture TEXT,
    babylonjs__material_ambient_texture_color_space babylonjs__texture_color_space_enum,
    babylonjs__material_opacity_texture TEXT,
    babylonjs__material_opacity_texture_color_space babylonjs__texture_color_space_enum,
    babylonjs__material_reflection_texture TEXT,
    babylonjs__material_reflection_texture_color_space babylonjs__texture_color_space_enum,
    babylonjs__material_emissive_texture TEXT,
    babylonjs__material_emissive_texture_color_space babylonjs__texture_color_space_enum,
    babylonjs__material_specular_texture TEXT,
    babylonjs__material_specular_texture_color_space babylonjs__texture_color_space_enum,
    babylonjs__material_bump_texture TEXT,
    babylonjs__material_bump_texture_color_space babylonjs__texture_color_space_enum,
    babylonjs__material_lightmap_texture TEXT,
    babylonjs__material_lightmap_texture_color_space babylonjs__texture_color_space_enum,
    babylonjs__material_refraction_texture TEXT,
    babylonjs__material_refraction_texture_color_space babylonjs__texture_color_space_enum,
    babylonjs__material_specular_power FLOAT,
    babylonjs__material_use_alpha_from_diffuse_texture BOOLEAN,
    babylonjs__material_use_emissive_as_illumination BOOLEAN,
    babylonjs__material_use_lightmap_as_shadowmap BOOLEAN,
    babylonjs__material_roughness FLOAT,
    babylonjs__material_metallic FLOAT,
    babylonjs__material_use_roughness_from_metallic_texture_alpha BOOLEAN,
    babylonjs__material_use_roughness_from_metallic_texture_green BOOLEAN,
    babylonjs__material_use_metallness_from_metallic_texture_blue BOOLEAN,
    babylonjs__material_enable_specular_anti_aliasing BOOLEAN,
    babylonjs__material_environment_intensity FLOAT,
    babylonjs__material_index_of_refraction FLOAT,
    babylonjs__material_direct_intensity FLOAT,
    babylonjs__material_environment_texture TEXT,
    babylonjs__material_environment_texture_color_space babylonjs__texture_color_space_enum,
    babylonjs__material_reflectivity_texture TEXT,
    babylonjs__material_reflectivity_texture_color_space babylonjs__texture_color_space_enum,
    babylonjs__material_metallic_texture TEXT,
    babylonjs__material_metallic_texture_color_space babylonjs__texture_color_space_enum,
    babylonjs__material_microsurface_texture TEXT,
    babylonjs__material_microsurface_texture_color_space babylonjs__texture_color_space_enum,
    babylonjs__material_ambient_texture_strength FLOAT,
    babylonjs__material_ambient_texture_impact_on_analytical_lights FLOAT,
    babylonjs__material_metallic_f0_factor FLOAT,
    babylonjs__material_metallic_reflectance_color color4,
    babylonjs__material_reflection_color color4,
    babylonjs__material_reflectivity_color color4,
    babylonjs__material_microsurface FLOAT,
    babylonjs__material_use_microsurface_from_reflectivity_map_alpha BOOLEAN,
    babylonjs__material_use_auto_microsurface_from_reflectivity_map BOOLEAN,
    babylonjs__material_use_radiance_over_alpha BOOLEAN,
    babylonjs__material_use_specular_over_alpha BOOLEAN,
    babylonjs__material_use_physical_light_falloff BOOLEAN,
    babylonjs__material_use_gltf_light_falloff BOOLEAN,
    babylonjs__material_force_normal_forward BOOLEAN,
    babylonjs__material_enable_irradiance_map BOOLEAN,
    babylonjs__material_shader_code TEXT,
    babylonjs__material_shader_parameters JSON,
    babylonjs__material_custom_properties JSON,
    babylonjs__material_fresnel_parameters JSON,
    babylonjs__material_parallax_scale FLOAT,
    babylonjs__material_parallax_bias FLOAT,
    babylonjs__material_use_parallax BOOLEAN DEFAULT FALSE,
    babylonjs__material_use_parallax_occlusion BOOLEAN DEFAULT FALSE,
    babylonjs__material_disable_lighting BOOLEAN DEFAULT FALSE,
    babylonjs__material_max_simultaneous_lights INTEGER DEFAULT 4,
    babylonjs__material_use_horizon_occlusion BOOLEAN DEFAULT TRUE,
    babylonjs__material_use_radiance_occlusion BOOLEAN DEFAULT TRUE,

    babylonjs__physics_motion_type TEXT,
    babylonjs__physics_mass FLOAT DEFAULT 1,
    babylonjs__physics_friction FLOAT DEFAULT 0.5,
    babylonjs__physics_restitution FLOAT DEFAULT 0.2,
    babylonjs__physics_linear_velocity vector3,
    babylonjs__physics_angular_velocity vector3,
    babylonjs__physics_linear_damping FLOAT,
    babylonjs__physics_angular_damping FLOAT,
    babylonjs__physics_collision_filter_group INTEGER,
    babylonjs__physics_collision_filter_mask INTEGER,
    babylonjs__physics_shape_type TEXT,
    babylonjs__physics_shape_data JSON,
    babylonjs__physics_velocity_x FLOAT DEFAULT 0,
    babylonjs__physics_velocity_y FLOAT DEFAULT 0,
    babylonjs__physics_velocity_z FLOAT DEFAULT 0,
    babylonjs__physics_angular_velocity_x FLOAT DEFAULT 0,
    babylonjs__physics_angular_velocity_y FLOAT DEFAULT 0,
    babylonjs__physics_angular_velocity_z FLOAT DEFAULT 0,
    babylonjs__physics_is_static BOOLEAN DEFAULT false,
    babylonjs__physics_center_of_mass vector3,
    babylonjs__physics_inertia_tensor vector3,
    babylonjs__physics_sleeping_threshold_linear FLOAT,
    babylonjs__physics_sleeping_threshold_angular FLOAT,
    babylonjs__physics_collision_response BOOLEAN DEFAULT TRUE,
    babylonjs__physics_collision_retry_count INTEGER DEFAULT 3,
    babylonjs__physics_use_gravity BOOLEAN DEFAULT TRUE,

    babylonjs__animation_auto_animate BOOLEAN DEFAULT TRUE,
    babylonjs__animation_auto_animate_from INTEGER DEFAULT 0,
    babylonjs__animation_auto_animate_to INTEGER DEFAULT 100,
    babylonjs__animation_auto_animate_loop BOOLEAN DEFAULT TRUE,
    babylonjs__animation_auto_animate_speed_ratio FLOAT DEFAULT 1.0,

    babylonjs__camera_fov FLOAT,
    babylonjs__camera_min_z FLOAT,
    babylonjs__camera_max_z FLOAT,
    babylonjs__camera_inertia FLOAT,
    babylonjs__camera_speed FLOAT,
    babylonjs__camera_check_collisions BOOLEAN,
    babylonjs__camera_apply_gravity BOOLEAN,
    babylonjs__camera_ellipsoid vector3,
    babylonjs__camera_ellipsoid_offset vector3,
    babylonjs__camera_rotation_speed FLOAT,
    babylonjs__camera_angle FLOAT,
    babylonjs__camera_beta FLOAT,
    babylonjs__camera_alpha FLOAT,
    babylonjs__camera_radius FLOAT,
    babylonjs__camera_target vector3,

    babylonjs__state_is_enabled BOOLEAN DEFAULT TRUE,
    babylonjs__state_is_picked BOOLEAN DEFAULT FALSE,
    babylonjs__state_freeze_world_matrix BOOLEAN DEFAULT FALSE,
    babylonjs__state_ignore_parent_scaling BOOLEAN DEFAULT FALSE,
    babylonjs__state_preserve_parent_rotation_for_billboard BOOLEAN DEFAULT FALSE
);

CREATE TABLE entities_metadata (
    metadata_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_id UUID NOT NULL REFERENCES entities(general__uuid) ON DELETE CASCADE,
    key__name TEXT NOT NULL,
    values__text TEXT[],
    values__numeric NUMERIC[],
    values__boolean BOOLEAN[],
    values__timestamp TIMESTAMPTZ[],
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (entity_id, key__name)
);

--
-- ENTITY SCRIPTS
--

CREATE TABLE entity_scripts (
    entity_id UUID NOT NULL REFERENCES entities(general__uuid) ON DELETE CASCADE,
    entity_script_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    web__compiled__node__script TEXT,
    web__compiled__node__script_sha256 TEXT,
    web__compiled__node__script_status TEXT,
    web__compiled__bun__script TEXT,
    web__compiled__bun__script_sha256 TEXT,
    web__compiled__bun__script_status TEXT,
    web__compiled__browser__script TEXT,
    web__compiled__browser__script_sha256 TEXT,
    web__compiled__browser__script_status TEXT,
    git_repo_entry_path TEXT,
    git_repo_url TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP

    CONSTRAINT check_script_compilation_status CHECK (
        (web__compiled__node__script_status IS NULL OR 
         web__compiled__node__script_status IN ('PENDING', 'COMPILED', 'FAILED')) AND
        (web__compiled__bun__script_status IS NULL OR 
         web__compiled__bun__script_status IN ('PENDING', 'COMPILED', 'FAILED')) AND
        (web__compiled__browser__script_status IS NULL OR 
         web__compiled__browser__script_status IN ('PENDING', 'COMPILED', 'FAILED'))
    )
);

--
-- INDEXES
--

-- Core indexes
CREATE INDEX idx_entities_general__permissions__roles__view ON entities USING GIN (general__permissions__roles__view);
CREATE INDEX idx_entities_parent_id ON entities(general__parent_entity_id);
CREATE INDEX idx_entities_created_at ON entities(general__created_at);
CREATE INDEX idx_entities_updated_at ON entities(general__updated_at);
CREATE INDEX idx_entities_semantic_version ON entities(general__semantic_version);

-- Mesh-related indexes
CREATE INDEX idx_entities_mesh_instance_of_id ON entities(babylonjs__mesh_instance_of_id);
CREATE INDEX idx_entities_mesh_material_id ON entities(babylonjs__mesh_material_id);
CREATE INDEX idx_entities_mesh_is_instance ON entities(babylonjs__mesh_is_instance) 
    WHERE babylonjs__mesh_is_instance = TRUE;
CREATE INDEX idx_entities_mesh_gltf_data ON entities USING GIN (babylonjs__mesh_gltf_data);

-- Visual and rendering indexes
CREATE INDEX idx_entities_lod_level ON entities(babylonjs__lod_level);
CREATE INDEX idx_entities_light_mode ON entities(babylonjs__light_mode);
CREATE INDEX idx_entities_light_type ON entities(babylonjs__light_type);
CREATE INDEX idx_entities_babylonjs_type ON entities(babylonjs__type);

-- Material indexes
CREATE INDEX idx_entities_material_type ON entities(babylonjs__material_type);
CREATE INDEX idx_entities_material_custom_properties ON entities USING GIN ((babylonjs__material_custom_properties::jsonb));
CREATE INDEX idx_entities_material_shader_parameters ON entities USING GIN ((babylonjs__material_shader_parameters::jsonb));

-- Physics indexes
CREATE INDEX idx_entities_physics_shape_data ON entities USING GIN ((babylonjs__physics_shape_data::jsonb));
CREATE INDEX idx_entities_physics_is_static ON entities(babylonjs__physics_is_static)
    WHERE babylonjs__physics_is_static = TRUE;

-- State indexes
CREATE INDEX idx_entities_state_is_enabled ON entities(babylonjs__state_is_enabled)
    WHERE babylonjs__state_is_enabled = FALSE;

-- Enable RLS on entities table
ALTER TABLE entities ENABLE ROW LEVEL SECURITY;

-- View policy for specified roles
CREATE POLICY "entities_view_policy" ON entities
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 
            FROM agent_roles ar
            WHERE ar.agent_id = auth.uid()
            AND ar.is_active = true
            AND ar.role_name = ANY(entities.general__permissions__roles__view)
        )
    );

-- Update policy - ONLY allow through mutation functions
CREATE POLICY "entities_update_policy" ON entities
    FOR UPDATE
    USING (
        current_setting('role') = 'rls_definer'
    );

-- Insert policy - ONLY allow through mutation functions
CREATE POLICY "entities_insert_policy" ON entities
    FOR INSERT
    WITH CHECK (
        current_setting('role') = 'rls_definer'
    );

-- Delete policy - ONLY allow through mutation functions
CREATE POLICY "entities_delete_policy" ON entities
    FOR DELETE
    USING (
        current_setting('role') = 'rls_definer'
    );

-- Trigger function to enforce foreign key constraint on array elements
CREATE OR REPLACE FUNCTION check_entity_permissions_roles()
RETURNS TRIGGER AS $$
BEGIN
    -- Check each role in the permissions__can_view_roles array
    PERFORM 1
    FROM unnest(NEW.permissions__can_view_roles) AS role
    WHERE NOT EXISTS (
        SELECT 1 FROM roles WHERE role_name = role
    );

    IF FOUND THEN
        RAISE EXCEPTION 'Role not found in roles table';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for entities table
CREATE TRIGGER enforce_entities_permissions_roles
BEFORE INSERT OR UPDATE ON entities
FOR EACH ROW EXECUTE FUNCTION check_entity_permissions_roles();

-- Trigger for entity_scripts table
CREATE TRIGGER enforce_entity_scripts_permissions_roles
BEFORE INSERT OR UPDATE ON entity_scripts
FOR EACH ROW EXECUTE FUNCTION check_entity_permissions_roles();

-- Enable RLS on entities_metadata table
ALTER TABLE entities_metadata ENABLE ROW LEVEL SECURITY;

-- View policy for `entities_metadata`
CREATE POLICY "entities_metadata_view_policy" ON entities_metadata
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 
            FROM entities e
            JOIN agent_roles ar ON ar.role_name = ANY(e.general__permissions__roles__view)
            WHERE e.general__uuid = entities_metadata.entity_id
            AND ar.agent_id = auth.uid()
            AND ar.is_active = true
        )
    );

-- Update policy for `entities_metadata`
CREATE POLICY "entities_metadata_update_policy" ON entities_metadata
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

-- Insert policy for `entities_metadata`
CREATE POLICY "entities_metadata_insert_policy" ON entities_metadata
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

-- Delete policy for `entities_metadata`
CREATE POLICY "entities_metadata_delete_policy" ON entities_metadata
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

-- Add index for faster metadata lookups by key__name and entity_id
CREATE INDEX idx_entities_key__name_entity ON entities_metadata(key__name, entity_id);

