-- TODO: Split this up into multiple SQL files and denote which ones we want and don't want through the CLI config on deployment.

-- ============================================================================
-- ENTITIES: ASSETS
-- ============================================================================

INSERT INTO entity.entity_assets (
    general__asset_file_name,
    group__sync,
    asset__mime_type
)
VALUES
    -- Babylon.js Level
    ('babylon.level.glb', 'public.STATIC', 'model/gltf-binary'),
    ('babylon.level.hdr.1k.hdr', 'public.STATIC', 'image/vnd.radiance'),
    -- Babylon.js Avatar
    ('babylon.avatar.glb', 'public.STATIC', 'model/gltf-binary'),
    -- Idle animations
    ('babylon.avatar.animation.f.idle.1.glb', 'public.STATIC', 'model/gltf-binary'),
    ('babylon.avatar.animation.f.idle.2.glb', 'public.STATIC', 'model/gltf-binary'),
    ('babylon.avatar.animation.f.idle.3.glb', 'public.STATIC', 'model/gltf-binary'),
    ('babylon.avatar.animation.f.idle.4.glb', 'public.STATIC', 'model/gltf-binary'),
    ('babylon.avatar.animation.f.idle.5.glb', 'public.STATIC', 'model/gltf-binary'),
    ('babylon.avatar.animation.f.idle.6.glb', 'public.STATIC', 'model/gltf-binary'),
    ('babylon.avatar.animation.f.idle.7.glb', 'public.STATIC', 'model/gltf-binary'),
    ('babylon.avatar.animation.f.idle.8.glb', 'public.STATIC', 'model/gltf-binary'),
    ('babylon.avatar.animation.f.idle.9.glb', 'public.STATIC', 'model/gltf-binary'),
    ('babylon.avatar.animation.f.idle.10.glb', 'public.STATIC', 'model/gltf-binary'),
    -- Other animations
    ('babylon.avatar.animation.f.crouch_strafe_left.glb', 'public.STATIC', 'model/gltf-binary'),
    ('babylon.avatar.animation.f.crouch_strafe_right.glb', 'public.STATIC', 'model/gltf-binary'),
    ('babylon.avatar.animation.f.crouch_walk_back.glb', 'public.STATIC', 'model/gltf-binary'),
    ('babylon.avatar.animation.f.crouch_walk.glb', 'public.STATIC', 'model/gltf-binary'),
    ('babylon.avatar.animation.f.falling_idle.1.glb', 'public.STATIC', 'model/gltf-binary'),
    ('babylon.avatar.animation.f.falling_idle.2.glb', 'public.STATIC', 'model/gltf-binary'),
    ('babylon.avatar.animation.f.jog_back.glb', 'public.STATIC', 'model/gltf-binary'),
    ('babylon.avatar.animation.f.jog.glb', 'public.STATIC', 'model/gltf-binary'),
    ('babylon.avatar.animation.f.jump_small.glb', 'public.STATIC', 'model/gltf-binary'),
    ('babylon.avatar.animation.f.jump.glb', 'public.STATIC', 'model/gltf-binary'),
    ('babylon.avatar.animation.f.run_back.glb', 'public.STATIC', 'model/gltf-binary'),
    ('babylon.avatar.animation.f.run_strafe_left.glb', 'public.STATIC', 'model/gltf-binary'),
    ('babylon.avatar.animation.f.run_strafe_right.glb', 'public.STATIC', 'model/gltf-binary'),
    ('babylon.avatar.animation.f.run.glb', 'public.STATIC', 'model/gltf-binary'),
    ('babylon.avatar.animation.f.strafe_left.glb', 'public.STATIC', 'model/gltf-binary'),
    ('babylon.avatar.animation.f.strafe_right.glb', 'public.STATIC', 'model/gltf-binary'),
    ('babylon.avatar.animation.f.talking.1.glb', 'public.STATIC', 'model/gltf-binary'),
    ('babylon.avatar.animation.f.talking.2.glb', 'public.STATIC', 'model/gltf-binary'),
    ('babylon.avatar.animation.f.talking.3.glb', 'public.STATIC', 'model/gltf-binary'),
    ('babylon.avatar.animation.f.talking.4.glb', 'public.STATIC', 'model/gltf-binary'),
    ('babylon.avatar.animation.f.talking.5.glb', 'public.STATIC', 'model/gltf-binary'),
    ('babylon.avatar.animation.f.talking.6.glb', 'public.STATIC', 'model/gltf-binary'),
    ('babylon.avatar.animation.f.walk_back.glb', 'public.STATIC', 'model/gltf-binary'),
    ('babylon.avatar.animation.f.walk_jump.1.glb', 'public.STATIC', 'model/gltf-binary'),
    ('babylon.avatar.animation.f.walk_jump.2.glb', 'public.STATIC', 'model/gltf-binary'),
    ('babylon.avatar.animation.f.walk_strafe_left.glb', 'public.STATIC', 'model/gltf-binary'),
    ('babylon.avatar.animation.f.walk_strafe_right.glb', 'public.STATIC', 'model/gltf-binary'),
    ('babylon.avatar.animation.f.walk.1.glb', 'public.STATIC', 'model/gltf-binary'),
    ('babylon.avatar.animation.f.walk.2.glb', 'public.STATIC', 'model/gltf-binary');

-- ============================================================================
-- ENTITIES: MODEL DEFINITIONS
-- ============================================================================

-- Babylon level entity (used by client to discover and sync model metadata)
INSERT INTO entity.entities (
    general__entity_name,
    group__sync
)
VALUES (
    'babylon.level.glb',
    'public.STATIC'
)
ON CONFLICT (general__entity_name) DO NOTHING;

-- Babylon environment entity (used by client to discover and sync environment metadata)
INSERT INTO entity.entities (
    general__entity_name,
    group__sync
)
VALUES (
    'babylon.environment.default',
    'public.STATIC'
)
ON CONFLICT (general__entity_name) DO NOTHING;

-- Metadata for Babylon level entity
INSERT INTO entity.entity_metadata (
    general__entity_name,
    metadata__key,
    metadata__value,
    group__sync
)
VALUES
    ('babylon.level.glb', 'type', '"Model"'::jsonb, 'public.STATIC'),
    ('babylon.level.glb', 'modelFileName', '"babylon.level.glb"'::jsonb, 'public.STATIC'),
    ('babylon.level.glb', 'position', '{"x":0,"y":0,"z":0}'::jsonb, 'public.STATIC'),
    ('babylon.level.glb', 'rotation', '{"x":0,"y":0,"z":0,"w":1}'::jsonb, 'public.STATIC'),
    ('babylon.level.glb', 'throttleInterval', '10'::jsonb, 'public.STATIC'),
    ('babylon.level.glb', 'enablePhysics', 'true'::jsonb, 'public.STATIC'),
    ('babylon.level.glb', 'physicsType', '"mesh"'::jsonb, 'public.STATIC'),
    ('babylon.level.glb', 'physicsOptions', '{"mass":0,"friction":0.5,"restitution":0.3}'::jsonb, 'public.STATIC'),
    ('babylon.level.glb', 'ownerSessionId', 'null'::jsonb, 'public.STATIC'),
    -- Environment metadata (HDR files etc.)
    ('babylon.environment.default', 'type', '"Environment"'::jsonb, 'public.STATIC'),
    ('babylon.environment.default', 'hdrFiles', '["babylon.level.hdr.1k.hdr"]'::jsonb, 'public.STATIC')
ON CONFLICT (general__entity_name, metadata__key) DO UPDATE SET
    metadata__value = EXCLUDED.metadata__value,
    group__sync = EXCLUDED.group__sync;

-- ==========================================================================
-- ENTITIES: AVATAR DEFINITIONS
-- ==========================================================================

-- Default avatar definition entity (consumed by client for avatar setup)
INSERT INTO entity.entities (
    general__entity_name,
    group__sync
)
VALUES (
    'avatar.definition.default',
    'public.STATIC'
)
ON CONFLICT (general__entity_name) DO NOTHING;

-- Metadata for default avatar definition
INSERT INTO entity.entity_metadata (
    general__entity_name,
    metadata__key,
    metadata__value,
    group__sync
)
VALUES
    ('avatar.definition.default', 'type', '"AvatarDefinition"'::jsonb, 'public.STATIC'),
    ('avatar.definition.default', 'initialAvatarPosition', '{"x":0,"y":0,"z":-5}'::jsonb, 'public.STATIC'),
    ('avatar.definition.default', 'initialAvatarRotation', '{"x":0,"y":0,"z":0,"w":1}'::jsonb, 'public.STATIC'),
    ('avatar.definition.default', 'initialAvatarCameraOrientation', '{"alpha":-1.5707963267948966,"beta":1.0471975511965976,"radius":5}'::jsonb, 'public.STATIC'),
    ('avatar.definition.default', 'modelFileName', '"babylon.avatar.glb"'::jsonb, 'public.STATIC'),
    ('avatar.definition.default', 'meshPivotPoint', '"bottom"'::jsonb, 'public.STATIC'),
    ('avatar.definition.default', 'throttleInterval', '500'::jsonb, 'public.STATIC'),
    ('avatar.definition.default', 'capsuleHeight', '1.8'::jsonb, 'public.STATIC'),
    ('avatar.definition.default', 'capsuleRadius', '0.3'::jsonb, 'public.STATIC'),
    ('avatar.definition.default', 'slopeLimit', '45'::jsonb, 'public.STATIC'),
    ('avatar.definition.default', 'jumpSpeed', '5'::jsonb, 'public.STATIC'),
    ('avatar.definition.default', 'debugBoundingBox', 'false'::jsonb, 'public.STATIC'),
    ('avatar.definition.default', 'debugSkeleton', 'true'::jsonb, 'public.STATIC'),
    ('avatar.definition.default', 'debugAxes', 'false'::jsonb, 'public.STATIC'),
    ('avatar.definition.default', 'walkSpeed', '1.47'::jsonb, 'public.STATIC'),
    ('avatar.definition.default', 'turnSpeed', '3.141592653589793'::jsonb, 'public.STATIC'),
    ('avatar.definition.default', 'blendDuration', '0.15'::jsonb, 'public.STATIC'),
    ('avatar.definition.default', 'gravity', '-9.8'::jsonb, 'public.STATIC'),
    ('avatar.definition.default', 'disableRootMotion', 'true'::jsonb, 'public.STATIC'),
    ('avatar.definition.default', 'animations', '[
        {"fileName":"babylon.avatar.animation.f.idle.1.glb","slMotion":"stand"},
        {"fileName":"babylon.avatar.animation.f.idle.2.glb","slMotion":"stand"},
        {"fileName":"babylon.avatar.animation.f.idle.3.glb","slMotion":"stand"},
        {"fileName":"babylon.avatar.animation.f.idle.4.glb","slMotion":"stand"},
        {"fileName":"babylon.avatar.animation.f.idle.5.glb","slMotion":"stand"},
        {"fileName":"babylon.avatar.animation.f.idle.6.glb","slMotion":"stand"},
        {"fileName":"babylon.avatar.animation.f.idle.7.glb","slMotion":"stand"},
        {"fileName":"babylon.avatar.animation.f.idle.8.glb","slMotion":"stand"},
        {"fileName":"babylon.avatar.animation.f.idle.9.glb","slMotion":"stand"},
        {"fileName":"babylon.avatar.animation.f.idle.10.glb","slMotion":"stand"},
        {"fileName":"babylon.avatar.animation.f.walk.1.glb","slMotion":"walk","direction":"forward"},
        {"fileName":"babylon.avatar.animation.f.walk.2.glb","slMotion":"walk","direction":"forward"},
        {"fileName":"babylon.avatar.animation.f.crouch_strafe_left.glb","slMotion":"crouchwalk","direction":"left","ignoreHipTranslation":true},
        {"fileName":"babylon.avatar.animation.f.crouch_strafe_right.glb","slMotion":"crouchwalk","direction":"right","ignoreHipTranslation":true},
        {"fileName":"babylon.avatar.animation.f.crouch_walk_back.glb","slMotion":"crouchwalk","direction":"back","ignoreHipTranslation":true},
        {"fileName":"babylon.avatar.animation.f.crouch_walk.glb","slMotion":"crouchwalk","direction":"forward"},
        {"fileName":"babylon.avatar.animation.f.falling_idle.1.glb","slMotion":"falling"},
        {"fileName":"babylon.avatar.animation.f.falling_idle.2.glb","slMotion":"falling"},
        {"fileName":"babylon.avatar.animation.f.jog_back.glb","slMotion":"run","direction":"back","variant":"jog","ignoreHipTranslation":true},
        {"fileName":"babylon.avatar.animation.f.jog.glb","slMotion":"run","direction":"forward","variant":"jog","ignoreHipTranslation":true},
        {"fileName":"babylon.avatar.animation.f.jump_small.glb","slMotion":"jump"},
        {"fileName":"babylon.avatar.animation.f.jump.glb","slMotion":"jump"},
        {"fileName":"babylon.avatar.animation.f.run_back.glb","slMotion":"run","direction":"back","ignoreHipTranslation":true},
        {"fileName":"babylon.avatar.animation.f.run_strafe_left.glb","slMotion":"run","direction":"left","ignoreHipTranslation":true},
        {"fileName":"babylon.avatar.animation.f.run_strafe_right.glb","slMotion":"run","direction":"right","ignoreHipTranslation":true},
        {"fileName":"babylon.avatar.animation.f.run.glb","slMotion":"run","direction":"forward","ignoreHipTranslation":true},
        {"fileName":"babylon.avatar.animation.f.strafe_left.glb","slMotion":"walk","direction":"left","ignoreHipTranslation":true},
        {"fileName":"babylon.avatar.animation.f.strafe_right.glb","slMotion":"walk","direction":"right","ignoreHipTranslation":true},
        {"fileName":"babylon.avatar.animation.f.talking.1.glb","slMotion":"talk"},
        {"fileName":"babylon.avatar.animation.f.talking.2.glb","slMotion":"talk"},
        {"fileName":"babylon.avatar.animation.f.talking.3.glb","slMotion":"talk"},
        {"fileName":"babylon.avatar.animation.f.talking.4.glb","slMotion":"talk"},
        {"fileName":"babylon.avatar.animation.f.talking.5.glb","slMotion":"talk"},
        {"fileName":"babylon.avatar.animation.f.talking.6.glb","slMotion":"talk"},
        {"fileName":"babylon.avatar.animation.f.walk_back.glb","slMotion":"walk","direction":"back","ignoreHipTranslation":true},
        {"fileName":"babylon.avatar.animation.f.walk_jump.1.glb","slMotion":"jump"},
        {"fileName":"babylon.avatar.animation.f.walk_jump.2.glb","slMotion":"jump"},
        {"fileName":"babylon.avatar.animation.f.walk_strafe_left.glb","slMotion":"walk","direction":"left","ignoreHipTranslation":true},
        {"fileName":"babylon.avatar.animation.f.walk_strafe_right.glb","slMotion":"walk","direction":"right","ignoreHipTranslation":true}
    ]'::jsonb, 'public.STATIC')
ON CONFLICT (general__entity_name, metadata__key) DO UPDATE SET
    metadata__value = EXCLUDED.metadata__value,
    group__sync = EXCLUDED.group__sync;