--
-- EXTENSIONS
--
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_cron";
CREATE EXTENSION IF NOT EXISTS "pg_net";

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

--
-- ENUMS
--
CREATE TYPE babylon_lod_mode AS ENUM ('distance', 'size');
CREATE TYPE babylon_lod_level AS ENUM ('LOD0', 'LOD1', 'LOD2', 'LOD3', 'LOD4');
CREATE TYPE babylon_billboard_mode AS ENUM (
    'BILLBOARDMODE_NONE',
    'BILLBOARDMODE_X',
    'BILLBOARDMODE_Y',
    'BILLBOARDMODE_Z',
    'BILLBOARDMODE_ALL'
);
CREATE TYPE babylon_light_mode AS ENUM ('default', 'shadowsOnly', 'specular');
CREATE TYPE babylon_texture_color_space AS ENUM ('linear', 'sRGB', 'gamma');
CREATE TYPE script_compilation_status AS ENUM ('PENDING', 'COMPILED', 'FAILED');
CREATE TYPE mutation_type AS ENUM ('INSERT', 'UPDATE', 'DELETE');
CREATE TYPE update_category AS ENUM ('FORCE', 'PROPERTY');
CREATE TYPE mutation_status AS ENUM ('PENDING', 'PROCESSED', 'REJECTED');
CREATE TYPE action_status AS ENUM (
    'PENDING',
    'IN_PROGRESS',
    'COMPLETED',
    'FAILED',
    'EXPIRED',
    'CANCELLED'
);

--
-- AGENTS AND AUTH
--
CREATE TABLE public.agent_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    password_last_changed TIMESTAMPTZ
);

CREATE TABLE public.auth_providers (
    provider_name TEXT PRIMARY KEY,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.agent_auth_providers (
    agent_id UUID REFERENCES public.agent_profiles(id) ON DELETE CASCADE,
    provider_name TEXT REFERENCES public.auth_providers(provider_name) ON DELETE CASCADE,
    provider_uid TEXT,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (agent_id, provider_name)
);

CREATE TABLE public.roles (
    role_name TEXT PRIMARY KEY,
    description TEXT,
    is_system BOOLEAN NOT NULL DEFAULT FALSE,
    parent_role TEXT REFERENCES roles(role_name),
    zone_id UUID,  -- Will be linked to entities after entities table creation
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.agent_roles (
    agent_id UUID REFERENCES public.agent_profiles(id) ON DELETE CASCADE,
    role_name TEXT REFERENCES public.roles(role_name) ON DELETE CASCADE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    granted_by UUID REFERENCES public.agent_profiles(id),
    PRIMARY KEY (agent_id, role_name)
);

CREATE TABLE public.agent_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID REFERENCES public.agent_profiles(id) ON DELETE CASCADE,
    provider_name TEXT REFERENCES public.auth_providers(provider_name),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

--
-- SCRIPT SOURCES (BASE TABLE)
--
CREATE TABLE script_sources (
    is_persistent BOOLEAN NOT NULL DEFAULT FALSE,
    web__compiled__node__script TEXT,
    web__compiled__node__script_sha256 TEXT,
    web__compiled__node__script_status script_compilation_status,
    web__compiled__bun__script TEXT,
    web__compiled__bun__script_sha256 TEXT,
    web__compiled__bun__script_status script_compilation_status,
    web__compiled__browser__script TEXT,
    web__compiled__browser__script_sha256 TEXT,
    web__compiled__browser__script_status script_compilation_status,
    git_repo_entry_path TEXT,
    git_repo_url TEXT
);

--
-- ENTITIES AND CAPABILITIES
--
CREATE TABLE entities (
    general__uuid UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    general__name VARCHAR(255) NOT NULL,
    general__type TEXT NOT NULL,
    general__semantic_version TEXT NOT NULL DEFAULT '1.0.0',
    general__created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    general__updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    general__transform transform NOT NULL DEFAULT ((0.0, 0.0, 0.0), (0.0, 0.0, 0.0), (1.0, 1.0, 1.0)),
    general__parent_entity_id UUID,
    
    view_role TEXT REFERENCES roles(role_name),
    mutation_role TEXT REFERENCES roles(role_name),
    
    babylonjs__mesh_is_instance BOOLEAN DEFAULT FALSE,
    babylonjs__mesh_instance_of_id UUID,
    babylonjs__mesh_material_id UUID,
    babylonjs__mesh_gltf_file_path VARCHAR(255),
    babylonjs__mesh_gltf_data JSONB,
    babylonjs__mesh_physics_properties JSON,
    babylonjs__mesh_joints joint[],
    babylonjs__lod_mode babylon_lod_mode,
    babylonjs__lod_level babylon_lod_level,
    babylonjs__lod_auto BOOLEAN,
    babylonjs__lod_distance NUMERIC,
    babylonjs__lod_size NUMERIC,
    babylonjs__lod_hide NUMERIC,
    babylonjs__billboard_mode babylon_billboard_mode,
    babylonjs__light_type TEXT,
    babylonjs__light_mode babylon_light_mode,
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
    babylonjs__shadow_enabled BOOLEAN,
    babylonjs__shadow_bias FLOAT,
    babylonjs__shadow_blur_kernel FLOAT,
    babylonjs__shadow_darkness FLOAT,
    babylonjs__shadow_frustum_size FLOAT,
    babylonjs__shadow_map_size INTEGER,
    babylonjs__shadow_quality TEXT,
    babylonjs__exclude_mesh_ids TEXT[],
    babylonjs__include_only_mesh_ids TEXT[],
    
    zone__properties JSON,
    agent__ai_properties JSON,
    agent__inventory JSON,
    
    babylonjs__material_type TEXT,
    babylonjs__material_ambient color4,
    babylonjs__material_diffuse color4,
    babylonjs__material_specular color4,
    babylonjs__material_emissive color4,
    babylonjs__material_alpha FLOAT,
    babylonjs__material_backFaceCulling BOOLEAN,
    babylonjs__material_wireframe BOOLEAN,
    babylonjs__material_diffuse_texture TEXT,
    babylonjs__material_diffuse_texture_color_space babylon_texture_color_space,
    babylonjs__material_ambient_texture TEXT,
    babylonjs__material_ambient_texture_color_space babylon_texture_color_space,
    babylonjs__material_opacity_texture TEXT,
    babylonjs__material_opacity_texture_color_space babylon_texture_color_space,
    babylonjs__material_reflection_texture TEXT,
    babylonjs__material_reflection_texture_color_space babylon_texture_color_space,
    babylonjs__material_emissive_texture TEXT,
    babylonjs__material_emissive_texture_color_space babylon_texture_color_space,
    babylonjs__material_specular_texture TEXT,
    babylonjs__material_specular_texture_color_space babylon_texture_color_space,
    babylonjs__material_bump_texture TEXT,
    babylonjs__material_bump_texture_color_space babylon_texture_color_space,
    babylonjs__material_lightmap_texture TEXT,
    babylonjs__material_lightmap_texture_color_space babylon_texture_color_space,
    babylonjs__material_refraction_texture TEXT,
    babylonjs__material_refraction_texture_color_space babylon_texture_color_space,
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
    babylonjs__material_max_simultaneous_lights INTEGER,
    babylonjs__material_direct_intensity FLOAT,
    babylonjs__material_environment_texture TEXT,
    babylonjs__material_environment_texture_color_space babylon_texture_color_space,
    babylonjs__material_reflectivity_texture TEXT,
    babylonjs__material_reflectivity_texture_color_space babylon_texture_color_space,
    babylonjs__material_metallic_texture TEXT,
    babylonjs__material_metallic_texture_color_space babylon_texture_color_space,
    babylonjs__material_microsurface_texture TEXT,
    babylonjs__material_microsurface_texture_color_space babylon_texture_color_space,
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
    
    babylonjs__physics_motion_type TEXT,
    babylonjs__physics_mass FLOAT,
    babylonjs__physics_friction FLOAT,
    babylonjs__physics_restitution FLOAT,
    babylonjs__physics_linear_velocity vector3,
    babylonjs__physics_angular_velocity vector3,
    babylonjs__physics_linear_damping FLOAT,
    babylonjs__physics_angular_damping FLOAT,
    babylonjs__physics_collision_filter_group INTEGER,
    babylonjs__physics_collision_filter_mask INTEGER,
    babylonjs__physics_shape_type TEXT,
    babylonjs__physics_shape_data JSON,
    
    FOREIGN KEY (general__parent_entity_id) REFERENCES entities(general__uuid) ON DELETE SET NULL,
    FOREIGN KEY (babylonjs__mesh_instance_of_id) REFERENCES entities(general__uuid) ON DELETE SET NULL,
    FOREIGN KEY (babylonjs__mesh_material_id) REFERENCES entities(general__uuid) ON DELETE SET NULL,
    
    CONSTRAINT check_general_type CHECK (general__type IN ('MODEL', 'LIGHT', 'ZONE', 'VOLUME', 'AGENT', 'MATERIAL_STANDARD', 'MATERIAL_PROCEDURAL')),
    CONSTRAINT check_light_type CHECK (babylonjs__light_type IN ('POINT', 'DIRECTIONAL', 'SPOT', 'HEMISPHERIC')),
    CONSTRAINT check_shadow_quality CHECK (babylonjs__shadow_quality IN ('LOW', 'MEDIUM', 'HIGH'))
);

-- Add foreign key constraints for zone_id in roles table
ALTER TABLE roles 
    ADD CONSTRAINT fk_roles_zone 
    FOREIGN KEY (zone_id) REFERENCES entities(general__uuid);

CREATE TABLE entity_capabilities (
    entity_id UUID REFERENCES entities(general__uuid) ON DELETE CASCADE,
    can_view_role TEXT REFERENCES roles(role_name),
    can_mutate_role TEXT REFERENCES roles(role_name),
    has_full_access BOOLEAN DEFAULT FALSE,
    PRIMARY KEY (entity_id)
);

CREATE TABLE entities_metadata (
    metadata_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_id UUID NOT NULL REFERENCES entities(general__uuid) ON DELETE CASCADE,
    key TEXT NOT NULL,
    values_text TEXT[],
    values_numeric NUMERIC[],
    values_boolean BOOLEAN[],
    values_timestamp TIMESTAMPTZ[],
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (entity_id, key)
);

--
-- ENTITY SCRIPTS
--
CREATE TABLE entity_scripts (
    entity_id UUID NOT NULL REFERENCES entities(general__uuid) ON DELETE CASCADE,
    entity_script_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
) INHERITS (script_sources);

--
-- MUTATIONS AND ACTIONS
--
CREATE TABLE mutations (
    LIKE script_sources INCLUDING ALL,
    mutation_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    mutation_type mutation_type NOT NULL,
    update_category update_category NOT NULL,
    required_role TEXT REFERENCES roles(role_name),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE actions (
    action_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    mutation_id UUID REFERENCES mutations(mutation_id) NOT NULL,
    status action_status NOT NULL DEFAULT 'PENDING',
    claimed_by UUID REFERENCES agent_profiles(id),
    target_entities UUID[] NOT NULL,
    action_data JSONB,
    last_heartbeat TIMESTAMPTZ,
    timeout_duration INTERVAL NOT NULL DEFAULT '5 minutes'::INTERVAL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB
);

--
-- FUNCTIONS AND PROCEDURES
--

-- Function to try claiming an action
CREATE OR REPLACE FUNCTION try_claim_action(
    p_action_id UUID,
    p_agent_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
    v_required_role TEXT;
BEGIN
    -- Get mutation's required role
    SELECT m.required_role INTO v_required_role
    FROM actions a
    JOIN mutations m ON a.mutation_id = m.mutation_id
    WHERE a.action_id = p_action_id;
    
    -- Try to claim if agent has required role and action is unclaimed
    UPDATE actions a
    SET claimed_by = p_agent_id,
        status = 'IN_PROGRESS',
        last_heartbeat = NOW()
    FROM mutations m
    WHERE a.action_id = p_action_id
    AND a.mutation_id = m.mutation_id
    AND a.claimed_by IS NULL
    AND a.status = 'PENDING'
    AND EXISTS (
        SELECT 1 FROM agent_roles ar
        WHERE ar.agent_id = p_agent_id
        AND ar.role_name = v_required_role
        AND ar.is_active = true
    );
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Function to update action heartbeat
CREATE OR REPLACE FUNCTION update_action_heartbeat(
    p_action_id UUID,
    p_agent_id UUID
) RETURNS BOOLEAN AS $$
BEGIN
    UPDATE actions
    SET last_heartbeat = NOW()
    WHERE action_id = p_action_id
    AND claimed_by = p_agent_id
    AND status = 'IN_PROGRESS';
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Function to handle action timeouts
CREATE OR REPLACE FUNCTION handle_action_timeouts()
RETURNS void AS $$
BEGIN
    -- Release timed out actions
    UPDATE actions
    SET claimed_by = NULL,
        status = 'PENDING',
        last_heartbeat = NULL
    WHERE status = 'IN_PROGRESS'
    AND last_heartbeat + timeout_duration < NOW();

    -- Mark very old pending actions as expired
    UPDATE actions
    SET status = 'EXPIRED'
    WHERE status = 'PENDING'
    AND created_at < NOW() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql;

-- Function to check if agent has role
CREATE OR REPLACE FUNCTION has_role(p_role TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM agent_roles 
    WHERE agent_id = auth.uid() 
    AND role_name = p_role 
    AND is_active = TRUE
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to handle role management
CREATE OR REPLACE FUNCTION handle_role_mutation(
    p_mutation_id UUID,
    p_action_data JSONB
) RETURNS void AS $$
DECLARE
    v_operation TEXT;
    v_role_name TEXT;
    v_description TEXT;
    v_parent_role TEXT;
    v_zone_id UUID;
BEGIN
    -- Extract data
    v_operation := p_action_data->>'operation';
    v_role_name := p_action_data->>'role_name';
    v_description := p_action_data->>'description';
    v_parent_role := p_action_data->>'parent_role';
    v_zone_id := (p_action_data->>'zone_id')::UUID;
    
    CASE v_operation
    WHEN 'CREATE' THEN
        INSERT INTO roles (
            role_name,
            description,
            parent_role,
            zone_id
        ) VALUES (
            v_role_name,
            v_description,
            v_parent_role,
            v_zone_id
        );
    
    WHEN 'UPDATE' THEN
        UPDATE roles
        SET description = COALESCE(v_description, description),
            parent_role = COALESCE(v_parent_role, parent_role),
            zone_id = COALESCE(v_zone_id, zone_id)
        WHERE role_name = v_role_name
        AND NOT is_system;
    
    WHEN 'DELETE' THEN
        DELETE FROM roles 
        WHERE role_name = v_role_name
        AND NOT is_system;
    END CASE;
END;
$$ LANGUAGE plpgsql;

--
-- VIEWS
--

-- Create the visible_entities view using roles
CREATE OR REPLACE VIEW visible_entities AS
SELECT e.*
FROM entities e
WHERE 
    -- Entity is visible if:
    (
        -- The accessing entity has full access
        EXISTS (
            SELECT 1 
            FROM entity_capabilities 
            WHERE entity_id = auth.uid() 
            AND has_full_access = true
        )
        OR
        -- The accessing entity has the required role (including parent roles)
        EXISTS (
            WITH RECURSIVE role_hierarchy AS (
                -- Base case: direct role
                SELECT role_name, parent_role
                FROM roles
                WHERE role_name = e.view_role
                
                UNION
                
                -- Recursive case: parent roles
                SELECT r.role_name, r.parent_role
                FROM roles r
                JOIN role_hierarchy rh ON r.role_name = rh.parent_role
            )
            SELECT 1 
            FROM agent_roles ar
            JOIN role_hierarchy rh ON ar.role_name = rh.role_name
            WHERE ar.agent_id = auth.uid()
            AND ar.is_active = true
        )
        OR
        -- The accessing entity has a role in the same zone
        EXISTS (
            SELECT 1
            FROM agent_roles ar
            JOIN roles r ON ar.role_name = r.role_name
            WHERE ar.agent_id = auth.uid()
            AND ar.is_active = true
            AND r.zone_id = (
                SELECT general__parent_entity_id 
                FROM entities 
                WHERE general__uuid = e.general__uuid
                AND general__type = 'ZONE'
            )
        )
    );

--
-- INDEXES
--

-- Roles and Capabilities Indexes
CREATE INDEX idx_roles_zone_id ON roles(zone_id);
CREATE INDEX idx_roles_parent_role ON roles(parent_role);
CREATE INDEX idx_agent_roles_is_active ON agent_roles(is_active);
CREATE INDEX idx_mutations_required_role ON mutations(required_role);
CREATE INDEX idx_entities_view_role ON entities(view_role);
CREATE INDEX idx_entities_mutation_role ON entities(mutation_role);
CREATE INDEX idx_entity_capabilities_view_role ON entity_capabilities(can_view_role);
CREATE INDEX idx_entity_capabilities_mutate_role ON entity_capabilities(can_mutate_role);

-- Actions indexes
CREATE INDEX idx_actions_status ON actions(status);
CREATE INDEX idx_actions_claimed_by ON actions(claimed_by);
CREATE INDEX idx_actions_heartbeat ON actions(last_heartbeat) 
    WHERE status = 'IN_PROGRESS';
CREATE INDEX idx_actions_mutation_id ON actions(mutation_id);
CREATE INDEX idx_actions_target_entities ON actions USING GIN (target_entities);
CREATE INDEX idx_actions_metadata ON actions USING GIN (metadata jsonb_path_ops);

-- Mutations indexes
CREATE INDEX idx_mutations_type ON mutations(mutation_type);

-- Entity indexes
CREATE INDEX idx_entities_type ON entities(general__type);
CREATE INDEX idx_entities_parent_entity_id ON entities(general__parent_entity_id);
CREATE INDEX idx_entities_mesh_instance_of_id ON entities(babylonjs__mesh_instance_of_id);
CREATE INDEX idx_entities_mesh_material_id ON entities(babylonjs__mesh_material_id);
CREATE INDEX idx_entities_created_at ON entities(general__created_at);
CREATE INDEX idx_entities_updated_at ON entities(general__updated_at);
CREATE INDEX idx_entities_mesh_is_instance ON entities(babylonjs__mesh_is_instance) 
    WHERE babylonjs__mesh_is_instance = TRUE;
CREATE INDEX idx_entities_semantic_version ON entities(general__semantic_version);
CREATE INDEX idx_entities_lod_level ON entities(babylonjs__lod_level);
CREATE INDEX idx_entities_light_mode ON entities(babylonjs__light_mode);

-- JSON/JSONB indexes
CREATE INDEX idx_entities_mesh_gltf_data ON entities USING GIN (babylonjs__mesh_gltf_data);
CREATE INDEX idx_entities_mesh_physics_properties ON entities USING GIN ((babylonjs__mesh_physics_properties::jsonb));
CREATE INDEX idx_entities_zone_properties ON entities USING GIN ((zone__properties::jsonb));
CREATE INDEX idx_entities_agent_ai_properties ON entities USING GIN ((agent__ai_properties::jsonb));
CREATE INDEX idx_entities_agent_inventory ON entities USING GIN ((agent__inventory::jsonb));
CREATE INDEX idx_entities_material_custom_properties ON entities USING GIN ((babylonjs__material_custom_properties::jsonb));
CREATE INDEX idx_entities_material_shader_parameters ON entities USING GIN ((babylonjs__material_shader_parameters::jsonb));
CREATE INDEX idx_entities_physics_shape_data ON entities USING GIN ((babylonjs__physics_shape_data::jsonb));