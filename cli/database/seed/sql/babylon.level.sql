-- TODO: Split this up into multiple SQL files and denote which ones we want and don't want through the CLI config on deployment.

-- ============================================================================
-- ENTITIES: ASSETS
-- ============================================================================

-- Level assets
INSERT INTO entity.entity_assets (
    general__asset_file_name,
    group__sync,
    asset__mime_type
)
VALUES
    ('babylon.level.glb', 'public.STATIC', 'model/gltf-binary');

-- Environment assets
INSERT INTO entity.entity_assets (
    general__asset_file_name,
    group__sync,
    asset__mime_type
)
VALUES
    ('babylon.level.hdr.1k.hdr', 'public.STATIC', 'image/vnd.radiance');

-- Door assets
INSERT INTO entity.entity_assets (
    general__asset_file_name,
    group__sync,
    asset__mime_type
)
VALUES
    ('babylon.model.wooden_door.glb', 'public.STATIC', 'model/gltf-binary');

-- Avatar model assets
INSERT INTO entity.entity_assets (
    general__asset_file_name,
    group__sync,
    asset__mime_type
)
VALUES
    ('babylon.avatar.glb', 'public.STATIC', 'model/gltf-binary');

-- Animation assets
INSERT INTO entity.entity_assets (
    general__asset_file_name,
    group__sync,
    asset__mime_type
)
VALUES
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
