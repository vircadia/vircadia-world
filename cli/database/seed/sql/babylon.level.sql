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
    ('babylon.avatar.animation.running.glb', 'public.STATIC', 'model/gltf-binary');
