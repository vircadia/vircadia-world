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
-- SCRIPTS
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
-- ENTITIES
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
    
    permissions__groups__read TEXT[],
    permissions__groups__write TEXT[],
    permissions__groups__execute TEXT[],
    
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
    permissions__groups__read TEXT[],
    permissions__groups__write TEXT[],
    permissions__groups__execute TEXT[],
    UNIQUE (entity_id, key)
);

CREATE TABLE entity_scripts (
    entity_id UUID NOT NULL REFERENCES entities(general__uuid) ON DELETE CASCADE,
    entity_script_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    permissions__groups__mutations TEXT[],
    permissions__world_connection BOOLEAN NOT NULL DEFAULT FALSE,
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
    allowed_roles TEXT[] NOT NULL,
    update_category update_category NOT NULL,
    mutation_data JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Actions to represent instances of mutations
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
    v_roles TEXT[];
BEGIN
    -- Get agent's active roles
    SELECT array_agg(role_name) INTO v_roles
    FROM agent_roles
    WHERE agent_id = p_agent_id
    AND is_active = true;
    
    -- Try to claim if agent has permission and action is unclaimed
    UPDATE actions a
    SET claimed_by = p_agent_id,
        status = 'IN_PROGRESS',
        last_heartbeat = NOW()
    FROM mutations m
    WHERE a.action_id = p_action_id
    AND a.mutation_id = m.mutation_id
    AND a.claimed_by IS NULL
    AND a.status = 'PENDING'
    AND m.allowed_roles && v_roles;
    
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

--
-- INDEXES
--

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
CREATE INDEX idx_mutations_allowed_roles ON mutations USING GIN (allowed_roles);

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

--
-- ROW LEVEL SECURITY
--

-- Enable RLS
ALTER TABLE entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE entities_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_scripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mutations ENABLE ROW LEVEL SECURITY;

-- Mutations policies
CREATE POLICY mutations_select ON mutations
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM agent_roles ar
            WHERE ar.agent_id = auth.uid()
            AND ar.role_name = ANY(mutations.allowed_roles)
            AND ar.is_active = true
        )
    );

-- Actions policies
CREATE POLICY actions_select ON actions
    FOR SELECT USING (true);  -- All authenticated users can see actions

CREATE POLICY actions_update ON actions
    FOR UPDATE USING (
        claimed_by = auth.uid() OR
        claimed_by IS NULL
    );

-- Entity policies
CREATE POLICY "Public read for auth providers" ON auth_providers 
    FOR SELECT USING (true);

CREATE POLICY "Public read for agent auth providers" ON agent_auth_providers 
    FOR SELECT USING (true);

CREATE POLICY "Public read for roles" ON roles 
    FOR SELECT USING (true);

CREATE POLICY "Public read for agent roles" ON agent_roles 
    FOR SELECT USING (true);

CREATE POLICY "Users can read their own sessions" ON agent_sessions 
    FOR SELECT USING (agent_id = auth.uid());

--
-- CRON JOBS
--

-- Schedule the timeout check to run every minute
SELECT cron.schedule(
    'action-timeout-check',           -- job name
    '* * * * *',                      -- every minute
    $$SELECT handle_action_timeouts()$$
);