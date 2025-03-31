INSERT INTO entity.entity_scripts (
    general__script_file_name,
    group__sync,
    script__source__repo__url,
    script__type
) 
VALUES 
    -- Model script
    ('browser_entity_model.ts', 'public.STATIC', 'https://github.com/vircadia/vircadia-world', 'BABYLON_BROWSER'),
    ('node_entity_model.ts', 'public.STATIC', 'https://github.com/vircadia/vircadia-world', 'BABYLON_NODE'),
    ('bun_entity_model.ts', 'public.STATIC', 'https://github.com/vircadia/vircadia-world', 'BABYLON_BUN');
