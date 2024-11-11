--
-- 
-- AGENTS
--
--

-- Base agent profiles table
CREATE TABLE public.agent_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    password_last_changed TIMESTAMPTZ
);

-- Auth providers table
CREATE TABLE public.auth_providers (
    provider_name TEXT PRIMARY KEY,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert default providers
INSERT INTO public.auth_providers (provider_name, description) VALUES
    ('email', 'Email and password authentication'),
    ('anonymous', 'Anonymous authentication'),
    ('google', 'Google OAuth'),
    ('github', 'GitHub OAuth'),
    ('discord', 'Discord OAuth');

-- Agent auth providers junction
CREATE TABLE public.agent_auth_providers (
    agent_id UUID REFERENCES public.agent_profiles(id) ON DELETE CASCADE,
    provider_name TEXT REFERENCES public.auth_providers(provider_name) ON DELETE CASCADE,
    provider_uid TEXT,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (agent_id, provider_name)
);

-- Roles table
CREATE TABLE public.roles (
    role_name TEXT PRIMARY KEY,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert default roles
INSERT INTO public.roles (role_name, description) VALUES
    ('guest', 'Default role for all users'),
    ('user', 'Authenticated user role'),
    ('admin', 'Administrative role');

-- Agent roles junction
CREATE TABLE public.agent_roles (
    agent_id UUID REFERENCES public.agent_profiles(id) ON DELETE CASCADE,
    role_name TEXT REFERENCES public.roles(role_name) ON DELETE CASCADE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    granted_by UUID REFERENCES public.agent_profiles(id),
    PRIMARY KEY (agent_id, role_name)
);

-- Sessions table
CREATE TABLE public.agent_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID REFERENCES public.agent_profiles(id) ON DELETE CASCADE,
    provider_name TEXT REFERENCES public.auth_providers(provider_name),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

-- Helper function to check roles
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Trigger to automatically grant guest role and anonymous provider to new users
CREATE OR REPLACE FUNCTION handle_new_agent()
RETURNS TRIGGER AS $$
BEGIN
    -- Grant anonymous provider
    INSERT INTO agent_auth_providers (agent_id, provider_name, is_primary)
    VALUES (NEW.id, 'anonymous', TRUE);
    
    -- Grant guest role
    INSERT INTO agent_roles (agent_id, role_name, granted_by)
    VALUES (NEW.id, 'guest', NEW.id);
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_agent_created
    AFTER INSERT ON agent_profiles
    FOR EACH ROW
    EXECUTE FUNCTION handle_new_agent();

-- Enable RLS on all tables
ALTER TABLE auth_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_auth_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_sessions ENABLE ROW LEVEL SECURITY;

-- Basic RLS policies
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

-- Indexes for better performance
CREATE INDEX idx_agent_sessions_agent_id ON agent_sessions(agent_id);
CREATE INDEX idx_agent_sessions_active ON agent_sessions(is_active);
CREATE INDEX idx_agent_roles_agent_id ON agent_roles(agent_id);
CREATE INDEX idx_agent_roles_active ON agent_roles(is_active);
CREATE INDEX idx_agent_auth_providers_agent_id ON agent_auth_providers(agent_id);

--
-- 
-- ENTITIES
--
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

-- LOD Types
CREATE TYPE babylon_lod_mode AS ENUM ('distance', 'size');
CREATE TYPE babylon_lod_level AS ENUM ('LOD0', 'LOD1', 'LOD2', 'LOD3', 'LOD4');

-- Billboard Types
CREATE TYPE babylon_billboard_mode AS ENUM (
    'BILLBOARDMODE_NONE',
    'BILLBOARDMODE_X',
    'BILLBOARDMODE_Y',
    'BILLBOARDMODE_Z',
    'BILLBOARDMODE_ALL'
);

-- Light Types
CREATE TYPE babylon_light_mode AS ENUM ('default', 'shadowsOnly', 'specular');

-- Texture Types
CREATE TYPE babylon_texture_color_space AS ENUM ('linear', 'sRGB', 'gamma');

-- Entities table
CREATE TABLE entities (
  general__uuid UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  general__name VARCHAR(255) NOT NULL,
  general__type TEXT NOT NULL,
  general__semantic_version TEXT NOT NULL DEFAULT '1.0.0',
  general__created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  general__updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  general__transform transform NOT NULL DEFAULT ((0.0, 0.0, 0.0), (0.0, 0.0, 0.0), (1.0, 1.0, 1.0)),
  general__parent_entity_id UUID,
  
  -- Add permissions fields
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
  -- Light properties
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
  -- Zone properties
  zone__properties JSON,
  -- Agent properties
  agent__ai_properties JSON,
  agent__inventory JSON,
  -- Material properties (renamed with babylonjs__ prefix)
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
  -- Babylon.js v2 Havok Physics properties
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
  
  -- CHECK constraints
  CONSTRAINT check_general_type CHECK (general__type IN ('MODEL', 'LIGHT', 'ZONE', 'VOLUME', 'AGENT', 'MATERIAL_STANDARD', 'MATERIAL_PROCEDURAL')),
  CONSTRAINT check_light_type CHECK (babylonjs__light_type IN ('POINT', 'DIRECTIONAL', 'SPOT', 'HEMISPHERIC')),
  CONSTRAINT check_light_mode CHECK (babylonjs__light_mode IN ('default', 'shadowsOnly', 'specular')),
  CONSTRAINT check_shadow_quality CHECK (babylonjs__shadow_quality IN ('LOW', 'MEDIUM', 'HIGH'))
);

-- ENTITIES METADATA
CREATE TABLE entities_metadata (
    metadata_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_id UUID NOT NULL REFERENCES entities(general__uuid) ON DELETE CASCADE,
    key TEXT NOT NULL,
    values_text TEXT[],
    values_numeric NUMERIC[],
    values_boolean BOOLEAN[],
    values_timestamp TIMESTAMPTZ[],
    createdat TIMESTAMPTZ DEFAULT NOW(),
    updatedat TIMESTAMPTZ DEFAULT NOW(),
    permissions__groups__read TEXT[],
    permissions__groups__write TEXT[],
    permissions__groups__execute TEXT[],
    UNIQUE (entity_id, key)
);

-- 1. Base table update trigger
CREATE OR REPLACE FUNCTION update_base_table_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.general__updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Apply update trigger to tables
CREATE TRIGGER update_entities_modtime
    BEFORE UPDATE ON entities
    FOR EACH ROW EXECUTE FUNCTION update_base_table_modified_column();

CREATE TRIGGER update_entities_metadata_modtime
    BEFORE UPDATE ON entities_metadata
    FOR EACH ROW EXECUTE FUNCTION update_base_table_modified_column();

CREATE TRIGGER update_entity_scripts_modtime
    BEFORE UPDATE ON entity_scripts
    FOR EACH ROW EXECUTE FUNCTION update_base_table_modified_column();

-- 2. Enable Row Level Security
ALTER TABLE entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE entities_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_scripts ENABLE ROW LEVEL SECURITY;

-- 3. Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE entities;
ALTER PUBLICATION supabase_realtime ADD TABLE entities_metadata;
ALTER PUBLICATION supabase_realtime ADD TABLE entity_scripts;

-- 4. Entity Table Indexes
-- Primary indexes
CREATE INDEX idx_entities_type ON entities(general__type);
CREATE INDEX idx_entities_parent_entity_id ON entities(general__parent_entity_id);
CREATE INDEX idx_entities_mesh_instance_of_id ON entities(babylonjs__mesh_instance_of_id);
CREATE INDEX idx_entities_mesh_material_id ON entities(babylonjs__mesh_material_id);

-- JSON/JSONB indexes
CREATE INDEX idx_entities_mesh_gltf_data ON entities USING GIN (babylonjs__mesh_gltf_data);
CREATE INDEX idx_entities_mesh_physics_properties ON entities USING GIN ((babylonjs__mesh_physics_properties::jsonb));
CREATE INDEX idx_entities_zone_properties ON entities USING GIN ((zone__properties::jsonb));
CREATE INDEX idx_entities_agent_ai_properties ON entities USING GIN ((agent__ai_properties::jsonb));
CREATE INDEX idx_entities_agent_inventory ON entities USING GIN ((agent__inventory::jsonb));
CREATE INDEX idx_entities_material_custom_properties ON entities USING GIN ((babylonjs__material_custom_properties::jsonb));
CREATE INDEX idx_entities_material_shader_parameters ON entities USING GIN ((babylonjs__material_shader_parameters::jsonb));
CREATE INDEX idx_entities_physics_shape_data ON entities USING GIN ((babylonjs__physics_shape_data::jsonb));

-- Timestamp indexes
CREATE INDEX idx_entities_created_at ON entities(general__created_at);
CREATE INDEX idx_entities_updated_at ON entities(general__updated_at);
CREATE INDEX idx_entities_semantic_version ON entities(general__semantic_version);

-- Boolean field indexes
CREATE INDEX idx_entities_mesh_is_instance ON entities(babylonjs__mesh_is_instance) 
    WHERE babylonjs__mesh_is_instance = TRUE;
CREATE INDEX idx_entities_shadow_enabled ON entities(babylonjs__shadow_enabled) 
    WHERE babylonjs__shadow_enabled = TRUE;

-- Array field indexes
CREATE INDEX idx_entities_exclude_mesh_ids ON entities USING GIN (babylonjs__exclude_mesh_ids);
CREATE INDEX idx_entities_include_only_mesh_ids ON entities USING GIN (babylonjs__include_only_mesh_ids);

-- Composite indexes
CREATE INDEX idx_entities_type_parent ON entities(general__type, general__parent_entity_id);
CREATE INDEX idx_entities_type_created_at ON entities(general__type, general__created_at);

-- 5. Metadata Table Indexes
CREATE INDEX idx_entities_metadata_lookup ON entities_metadata 
    (entity_id, key, values_text, values_numeric, values_boolean, values_timestamp);

-- 6. Script Table Indexes
CREATE INDEX idx_entity_scripts_entity_id ON entity_scripts(entity_id);
CREATE INDEX idx_entity_scripts_is_persistent ON entity_scripts(is_persistent);

-- 7. Permission Check Functions
-- Entity permission functions
CREATE OR REPLACE FUNCTION can_read(entity_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    user_role TEXT;
    permission_array TEXT[];
BEGIN
    SELECT role INTO user_role FROM agent_profiles WHERE id = auth.uid();
    SELECT permissions__groups__read INTO permission_array FROM entities WHERE general__uuid = entity_id;
    RETURN user_role = ANY(permission_array) OR '*' = ANY(permission_array);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth;

CREATE OR REPLACE FUNCTION can_write(entity_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    user_role TEXT;
    permission_array TEXT[];
BEGIN
    SELECT role INTO user_role FROM agent_profiles WHERE id = auth.uid();
    SELECT permissions__groups__write INTO permission_array FROM entities WHERE general__uuid = entity_id;
    RETURN user_role = ANY(permission_array) OR '*' = ANY(permission_array);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth;

CREATE OR REPLACE FUNCTION can_execute(entity_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    user_role TEXT;
    permission_array TEXT[];
BEGIN
    SELECT role INTO user_role FROM agent_profiles WHERE id = auth.uid();
    SELECT permissions__groups__execute INTO permission_array FROM entities WHERE general__uuid = entity_id;
    RETURN user_role = ANY(permission_array) OR '*' = ANY(permission_array);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth;

-- Metadata permission functions
CREATE OR REPLACE FUNCTION can_read_metadata(metadata_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    user_role TEXT;
    permission_array TEXT[];
BEGIN
    SELECT role INTO user_role FROM agent_profiles WHERE id = auth.uid();
    SELECT permissions__groups__read INTO permission_array FROM entities_metadata WHERE metadata_id = metadata_id;
    RETURN user_role = ANY(permission_array) OR '*' = ANY(permission_array) OR
           (SELECT COUNT(*) = 0 FROM entities_metadata WHERE metadata_id = metadata_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth;

CREATE OR REPLACE FUNCTION can_write_metadata(metadata_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    user_role TEXT;
    permission_array TEXT[];
BEGIN
    SELECT role INTO user_role FROM agent_profiles WHERE id = auth.uid();
    SELECT permissions__groups__write INTO permission_array FROM entities_metadata WHERE metadata_id = metadata_id;
    RETURN user_role = ANY(permission_array) OR '*' = ANY(permission_array) OR
           (SELECT COUNT(*) = 0 FROM entities_metadata WHERE metadata_id = metadata_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth;

CREATE OR REPLACE FUNCTION can_execute_metadata(metadata_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    user_role TEXT;
    permission_array TEXT[];
BEGIN
    SELECT role INTO user_role FROM agent_profiles WHERE id = auth.uid();
    SELECT permissions__groups__execute INTO permission_array FROM entities_metadata WHERE metadata_id = metadata_id;
    RETURN user_role = ANY(permission_array) OR '*' = ANY(permission_array) OR
           (SELECT COUNT(*) = 0 FROM entities_metadata WHERE metadata_id = metadata_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth;

-- 8. Entity RLS Policies
CREATE POLICY entities_select_policy ON entities
    FOR SELECT USING (can_read(general__uuid));

CREATE POLICY entities_insert_policy ON entities
    FOR INSERT WITH CHECK (has_role('admin'));

CREATE POLICY entities_update_policy ON entities
    FOR UPDATE USING (has_role('admin'));

CREATE POLICY entities_delete_policy ON entities
    FOR DELETE USING (has_role('admin'));

-- 9. Metadata RLS Policies
CREATE POLICY entities_metadata_select_policy ON entities_metadata
    FOR SELECT USING (can_read_metadata(metadata_id));

CREATE POLICY entities_metadata_insert_policy ON entities_metadata
    FOR INSERT WITH CHECK (has_role('admin'));

CREATE POLICY entities_metadata_update_policy ON entities_metadata
    FOR UPDATE USING (has_role('admin'));

CREATE POLICY entities_metadata_delete_policy ON entities_metadata
    FOR DELETE USING (has_role('admin'));

-- 10. Script RLS Policies
CREATE POLICY entity_scripts_select_policy ON entity_scripts
    FOR SELECT USING (can_read(entity_id));

CREATE POLICY entity_scripts_insert_policy ON entity_scripts
    FOR INSERT WITH CHECK (has_role('admin'));

CREATE POLICY entity_scripts_update_policy ON entity_scripts
    FOR UPDATE USING (has_role('admin'));

CREATE POLICY entity_scripts_delete_policy ON entity_scripts
    FOR DELETE USING (has_role('admin'));

-- Add the new indexes
CREATE INDEX idx_entities_lod_level ON entities(babylonjs__lod_level);
CREATE INDEX idx_entities_light_mode ON entities(babylonjs__light_mode);

--
--
-- SCRIPTS
--
--

CREATE TYPE script_compilation_status AS ENUM ('PENDING', 'COMPILED', 'FAILED');

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
    git_repo_url TEXT,
);

CREATE TABLE entity_scripts (
    FOREIGN KEY (entity_id) REFERENCES entities(general__uuid) ON DELETE CASCADE,
    entity_id UUID NOT NULL,
    entity_script_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    permissions__groups__mutations TEXT[],
    permissions__world_connection BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
) INHERITS (script_sources);

--
--
-- MUTATIONS
--
--

-- Enums
CREATE TYPE mutation_type AS ENUM ('INSERT', 'UPDATE', 'DELETE');
CREATE TYPE update_category AS ENUM ('FORCE', 'PROPERTY');
CREATE TYPE mutation_status AS ENUM ('PENDING', 'PROCESSED', 'REJECTED');

-- Base mutations table
CREATE TABLE mutations (
    mutation_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    mutation_type mutation_type NOT NULL,
    update_category update_category NOT NULL,
    mutation_data JSONB,
    requestor_allowed_groups TEXT[], -- Must match script permissions__groups__mutations
    simulate_optimistically BOOLEAN DEFAULT false,
    status mutation_status NOT NULL DEFAULT 'PENDING',
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Entity creation mutations
CREATE TABLE entity_creation_mutations (
    LIKE mutations INCLUDING ALL,
    initial_properties JSONB NOT NULL,
    parent_id UUID REFERENCES entities(general__uuid) ON DELETE CASCADE
) INHERITS (mutations);

-- Entity update mutations
CREATE TABLE entity_update_mutations (
    LIKE mutations INCLUDING ALL,
    property_path TEXT[], -- For specific property updates
    previous_value JSONB  -- For rollback capability
) INHERITS (mutations);

-- Entity deletion mutations
CREATE TABLE entity_deletion_mutations (
    LIKE mutations INCLUDING ALL,
    cascade_delete BOOLEAN DEFAULT false,
    backup_data JSONB,    -- Store entity state before deletion
    dependent_entities UUID[], -- List of entities that will be affected
    verification_hash TEXT -- Hash of entity state to ensure it hasn't changed
) INHERITS (mutations);

-- Pending mutations tracking
CREATE TABLE entity_pending_mutations (
    LIKE mutations INCLUDING ALL,
    priority INTEGER DEFAULT 0,
    retry_count INTEGER DEFAULT 0,
    next_retry_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT
) INHERITS (mutations);

-- Rejected mutations tracking
CREATE TABLE entity_rejected_mutations (
    LIKE mutations INCLUDING ALL,
    rejection_reason TEXT,
    rejected_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    original_mutation_data JSONB -- Store the original mutation attempt
) INHERITS (mutations);

-- Create mutation validation function
CREATE OR REPLACE FUNCTION validate_mutation_groups()
RETURNS TRIGGER AS $$
BEGIN
    -- Check if mutation groups match any of the entity's script permissions
    IF NOT EXISTS (
        SELECT 1 
        FROM entity_scripts es
        WHERE es.entity_id = NEW.entity_id
        AND es.permissions__groups__mutations ?| NEW.allowed_groups
    ) THEN
        RAISE EXCEPTION 'Mutation groups do not match any script permissions';
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers
CREATE TRIGGER validate_mutation_groups_trigger
    BEFORE INSERT OR UPDATE ON mutations
    FOR EACH ROW
    EXECUTE FUNCTION validate_mutation_groups();

-- Enable RLS
ALTER TABLE entity_pending_mutations ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_rejected_mutations ENABLE ROW LEVEL SECURITY;
ALTER TABLE mutations ENABLE ROW LEVEL SECURITY;

-- Create indexes
CREATE INDEX idx_mutations_entity_id ON mutations(entity_id);
CREATE INDEX idx_mutations_agent_id ON mutations(agent_id);
CREATE INDEX idx_mutations_created_at ON mutations(created_at);
CREATE INDEX idx_mutations_type ON mutations(mutation_type);
CREATE INDEX idx_mutations_category ON mutations(update_category);
CREATE INDEX idx_mutations_status ON mutations(status);
CREATE INDEX idx_mutations_data ON mutations USING GIN (mutation_data);
CREATE INDEX idx_mutations_groups ON mutations USING GIN (allowed_groups);
CREATE INDEX idx_mutations_expires_at ON mutations(expires_at);

-- Specific indexes for pending mutations
CREATE INDEX idx_pending_mutations_priority ON entity_pending_mutations(priority);
CREATE INDEX idx_pending_mutations_next_retry ON entity_pending_mutations(next_retry_at);

-- Specific indexes for entity operations
CREATE INDEX idx_entity_creation_mutations_parent ON entity_creation_mutations(parent_id);
CREATE INDEX idx_entity_creation_mutations_properties ON entity_creation_mutations USING GIN (initial_properties);
CREATE INDEX idx_entity_update_mutations_path ON entity_update_mutations USING GIN (property_path);
CREATE INDEX idx_entity_deletion_mutations_cascade ON entity_deletion_mutations(cascade_delete);
CREATE INDEX idx_entity_deletion_mutations_dependents ON entity_deletion_mutations USING GIN (dependent_entities);

-- Composite indexes for common queries
CREATE INDEX idx_mutations_entity_created ON mutations(entity_id, created_at);
CREATE INDEX idx_mutations_agent_created ON mutations(agent_id, created_at);

-- RLS Policies
CREATE POLICY mutations_select_policy ON mutations
    FOR SELECT USING (can_read(entity_id));

-- Create new insert policy with conditional checks
CREATE POLICY mutations_insert_policy ON mutations
    FOR INSERT WITH CHECK (
        CASE 
            -- For creation mutations, only check allowed_groups
            WHEN mutation_type = 'INSERT' THEN
                EXISTS (
                    SELECT 1 
                    FROM entity_scripts es
                    WHERE es.entity_id = entity_id
                    AND es.permissions__groups__mutations && allowed_groups
                )
            -- For update/delete mutations, check write permission and allowed_groups
            ELSE 
                can_write(entity_id) AND 
                EXISTS (
                    SELECT 1 FROM entities e 
                    WHERE e.general__uuid = entity_id 
                    AND EXISTS (
                        SELECT 1 
                        FROM entity_scripts es
                        WHERE es.entity_id = e.general__uuid
                        AND es.permissions__groups__mutations && allowed_groups
                    )
                )
        END
    );

-- Apply policies to child tables
CREATE POLICY entity_creation_mutations_select_policy ON entity_creation_mutations FOR SELECT USING (can_read(entity_id));
CREATE POLICY entity_update_mutations_select_policy ON entity_update_mutations FOR SELECT USING (can_read(entity_id));
CREATE POLICY entity_deletion_mutations_select_policy ON entity_deletion_mutations FOR SELECT USING (can_read(entity_id));
CREATE POLICY entity_pending_mutations_select_policy ON entity_pending_mutations FOR SELECT USING (can_read(entity_id));
CREATE POLICY entity_rejected_mutations_select_policy ON entity_rejected_mutations FOR SELECT USING (can_read(entity_id));

-- Create cleanup function for expired mutations
CREATE OR REPLACE FUNCTION cleanup_expired_mutations()
RETURNS void AS $$
BEGIN
    -- Clean up expired mutations
    DELETE FROM mutations 
    WHERE expires_at < NOW() 
    OR (status = 'PROCESSED' AND created_at < NOW() - INTERVAL '30 days');
    
    -- Clean up rejected mutations older than 7 days
    DELETE FROM entity_rejected_mutations 
    WHERE rejected_at < NOW() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;

