INSERT INTO entity.entity_assets (
    general__asset_file_name,
    group__sync,
    asset__mime_type
)
VALUES
    -- Babylon.js Level Test
    ('babylon.level.test.glb', 'public.STATIC', 'model/gltf-binary'),
    ('babylon.level.test.hdr.1k.hdr', 'public.STATIC', 'image/vnd.radiance');
