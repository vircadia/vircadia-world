INSERT INTO entity.entity_scripts (
    general__script_file_name,
    group__sync,
    script__source__repo__url,
    script__platform
) 
VALUES 
    -- Model script
    ('three_js/three_universal_entity_model.ts', 'public.SYSTEM.SCRIPTS', 'https://github.com/vircadia/vircadia-world', ARRAY['THREE_BROWSER', 'THREE_BUN']),
    -- Character controller script
    ('three_js/three_browser_character_controller.ts', 'public.SYSTEM.SCRIPTS', 'https://github.com/vircadia/vircadia-world', ARRAY['THREE_BROWSER']),
    -- Basic scene lighting script
    ('three_js/three_universal_basic_scene.ts', 'public.SYSTEM.SCRIPTS', 'https://github.com/vircadia/vircadia-world', ARRAY['THREE_BROWSER', 'THREE_BUN']);
