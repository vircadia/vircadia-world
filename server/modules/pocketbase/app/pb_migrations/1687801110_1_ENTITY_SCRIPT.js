/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
    // Script compilation status enum (as a select field)
    const scriptStatusOptions = {
        maxSelect: 1,
        values: ['PENDING', 'COMPILED', 'FAILED']
    };

    // Entity Scripts Collection
    const entityScripts = new Collection({
        name: 'entity_scripts',
        type: 'base',
        system: false,
        schema: [
            // Web Node Script
            {
                name: 'compiled_web_node_script',
                type: 'text',
                system: false,
                required: false
            },
            {
                name: 'compiled_web_node_script_sha256',
                type: 'text',
                system: false,
                required: false
            },
            {
                name: 'compiled_web_node_script_status',
                type: 'select',
                system: false,
                required: true,
                options: scriptStatusOptions,
                default: 'PENDING'
            },
            // Web Bun Script
            {
                name: 'compiled_web_bun_script',
                type: 'text',
                system: false,
                required: false
            },
            {
                name: 'compiled_web_bun_script_sha256',
                type: 'text',
                system: false,
                required: false
            },
            {
                name: 'compiled_web_bun_script_status',
                type: 'select',
                system: false,
                required: true,
                options: scriptStatusOptions,
                default: 'PENDING'
            },
            // Web Browser Script
            {
                name: 'compiled_web_browser_script',
                type: 'text',
                system: false,
                required: false
            },
            {
                name: 'compiled_web_browser_script_sha256',
                type: 'text',
                system: false,
                required: false
            },
            {
                name: 'compiled_web_browser_script_status',
                type: 'select',
                system: false,
                required: true,
                options: scriptStatusOptions,
                default: 'PENDING'
            },
            // Source Information
            {
                name: 'source_git_repo_entry_path',
                type: 'text',
                system: false,
                required: false
            },
            {
                name: 'source_git_repo_url',
                type: 'text',
                system: false,
                required: false
            },
            // Permissions
            {
                name: 'permissions_roles_view',
                type: 'json',
                system: false,
                required: false,
                default: '[]'
            },
            {
                name: 'permissions_roles_full',
                type: 'json',
                system: false,
                required: false,
                default: '[]'
            }
        ],
        indexes: [
            "CREATE INDEX idx_script_node_status ON entity_scripts (compiled_web_node_script_status)",
            "CREATE INDEX idx_script_bun_status ON entity_scripts (compiled_web_bun_script_status)",
            "CREATE INDEX idx_script_browser_status ON entity_scripts (compiled_web_browser_script_status)"
        ],
        // Security rules equivalent to your RLS policies
        listRule: `
            @request.auth.id = created_by ||
            @collection.agent_roles.agent = @request.auth.id && 
            (
                @collection.agent_roles.role.entity_script_can_insert = true ||
                @collection.agent_roles.role.is_system = true ||
                @collection.agent_roles.role.role_name ~ @request.data.permissions_roles_view ||
                @collection.agent_roles.role.role_name ~ @request.data.permissions_roles_full
            )
        `,
        viewRule: `
            @request.auth.id = created_by ||
            @collection.agent_roles.agent = @request.auth.id && 
            (
                @collection.agent_roles.role.entity_script_can_insert = true ||
                @collection.agent_roles.role.is_system = true ||
                @collection.agent_roles.role.role_name ~ @request.data.permissions_roles_view ||
                @collection.agent_roles.role.role_name ~ @request.data.permissions_roles_full
            )
        `,
        createRule: `
            @collection.agent_roles.agent = @request.auth.id &&
            (
                @collection.agent_roles.role.entity_script_can_insert = true ||
                @collection.agent_roles.role.is_system = true
            )
        `,
        updateRule: `
            @request.auth.id = created_by ||
            @collection.agent_roles.agent = @request.auth.id && 
            (
                @collection.agent_roles.role.entity_script_can_insert = true ||
                @collection.agent_roles.role.is_system = true ||
                @collection.agent_roles.role.role_name ~ @request.data.permissions_roles_full
            )
        `,
        deleteRule: `
            @request.auth.id = created_by ||
            @collection.agent_roles.agent = @request.auth.id && 
            (
                @collection.agent_roles.role.entity_script_can_insert = true ||
                @collection.agent_roles.role.is_system = true ||
                @collection.agent_roles.role.role_name ~ @request.data.permissions_roles_full
            )
        `
    });

    // Add hooks for script validation and cleanup
    db.beforeCreate('entity_scripts', async (e) => {
        // Add any validation logic here
    });

    db.beforeDelete('entity_scripts', async (e) => {
        // Cleanup script references in entities
        const scriptId = e.record.id;
        const entities = await db.collection('entities').getFullList({
            filter: `scripts_ids ~ "${scriptId}"`
        });

        for (const entity of entities) {
            const scriptsIds = JSON.parse(entity.scripts_ids || '[]');
            const updatedScriptsIds = scriptsIds.filter(id => id !== scriptId);
            await db.collection('entities').update(entity.id, {
                scripts_ids: JSON.stringify(updatedScriptsIds)
            });
        }
    });

    return {
        collections: [entityScripts]
    };
}, (db) => {
    // Revert migration
    db.deleteCollection('entity_scripts');
});
