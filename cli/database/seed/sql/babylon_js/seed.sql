INSERT INTO entity.entity_scripts (
    general__script_file_name,
    group__sync,
    script__source__repo__url,
    script__platform
) 
VALUES 
    -- Model script
    ('babylon_js/babylon_universal_entity_model.ts', 'public.SYSTEM.SCRIPTS', 'https://github.com/vircadia/vircadia-world', ARRAY['BABYLON_BROWSER', 'BABYLON_BUN']),
    -- Character controller script
    ('babylon_js/babylon_browser_character_controller.ts', 'public.SYSTEM.SCRIPTS', 'https://github.com/vircadia/vircadia-world', ARRAY['BABYLON_BROWSER']),
    -- Basic scene lighting script
    ('babylon_js/babylon_universal_basic_scene.ts', 'public.SYSTEM.SCRIPTS', 'https://github.com/vircadia/vircadia-world', ARRAY['BABYLON_BROWSER', 'BABYLON_BUN']);
