INSERT INTO entity.entity_scripts (
    general__script_file_name,
    group__sync,
    script__source__repo__url,
    script__platform
) 
VALUES 
    -- Model script
    ('universal_entity_model.ts', 'public.SYSTEM.SCRIPTS', 'https://github.com/vircadia/vircadia-world', 'BABYLON_BROWSER'),
    ('universal_entity_model.ts', 'public.SYSTEM.SCRIPTS', 'https://github.com/vircadia/vircadia-world', 'BABYLON_NODE'),
    ('universal_entity_model.ts', 'public.SYSTEM.SCRIPTS', 'https://github.com/vircadia/vircadia-world', 'BABYLON_BUN'),
    -- Character controller script
    ('browser_character_controller.ts', 'public.SYSTEM.SCRIPTS', 'https://github.com/vircadia/vircadia-world', 'BABYLON_BROWSER'),
    -- Basic scene lighting script
    ('universal_basic_scene.ts', 'public.SYSTEM.SCRIPTS', 'https://github.com/vircadia/vircadia-world', 'BABYLON_BROWSER'),
    ('universal_basic_scene.ts', 'public.SYSTEM.SCRIPTS', 'https://github.com/vircadia/vircadia-world', 'BABYLON_NODE'),
    ('universal_basic_scene.ts', 'public.SYSTEM.SCRIPTS', 'https://github.com/vircadia/vircadia-world', 'BABYLON_BUN');
