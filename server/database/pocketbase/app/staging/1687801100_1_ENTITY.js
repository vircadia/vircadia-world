/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
    // Entities Collection
    const entities = new Collection({
        name: 'entities',
        type: 'base',
        system: false,
        schema: [
            {
                name: 'name',
                type: 'text',
                system: false,
                required: true
            },
            {
                name: 'semantic_version',
                type: 'text',
                system: false,
                required: true,
                default: '1.0.0'
            },
            {
                name: 'type_babylonjs',
                type: 'text',
                system: false,
                required: true
            },
            {
                name: 'scripts_ids',
                type: 'json',
                system: false,
                required: false,
                default: '[]'
            },
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
            "CREATE INDEX idx_entity_semantic_version ON entities (semantic_version)",
            "CREATE INDEX idx_entity_type_babylonjs ON entities (type_babylonjs)"
        ],
        // Security rules equivalent to your RLS policies
        listRule: `
            @request.auth.id = created_by ||
            @collection.agent_roles.agent = @request.auth.id && 
            (
                @collection.agent_roles.role.role_name ~ @request.data.permissions_roles_view ||
                @collection.agent_roles.role.role_name ~ @request.data.permissions_roles_full
            )
        `,
        viewRule: `
            @request.auth.id = created_by ||
            @collection.agent_roles.agent = @request.auth.id && 
            (
                @collection.agent_roles.role.role_name ~ @request.data.permissions_roles_view ||
                @collection.agent_roles.role.role_name ~ @request.data.permissions_roles_full
            )
        `,
        createRule: `
            @collection.agent_roles.agent = @request.auth.id &&
            @collection.agent_roles.role.entity_object_can_insert = true
        `,
        updateRule: `
            @request.auth.id = created_by ||
            @collection.agent_roles.agent = @request.auth.id && 
            @collection.agent_roles.role.role_name ~ @request.data.permissions_roles_full
        `,
        deleteRule: `
            @request.auth.id = created_by ||
            @collection.agent_roles.agent = @request.auth.id && 
            @collection.agent_roles.role.role_name ~ @request.data.permissions_roles_full
        `
    });

    // Entities Metadata Collection
    const entitiesMetadata = new Collection({
        name: 'entities_metadata',
        type: 'base',
        system: false,
        schema: [
            {
                name: 'entity',
                type: 'relation',
                required: true,
                options: {
                    collectionId: 'entities',
                    cascadeDelete: true
                }
            },
            {
                name: 'key',
                type: 'text',
                required: true
            },
            {
                name: 'values_text',
                type: 'json',
                required: false,
                default: '[]'
            },
            {
                name: 'values_numeric',
                type: 'json',
                required: false,
                default: '[]'
            },
            {
                name: 'values_boolean',
                type: 'json',
                required: false,
                default: '[]'
            },
            {
                name: 'values_timestamp',
                type: 'json',
                required: false,
                default: '[]'
            }
        ],
        indexes: [
            "CREATE UNIQUE INDEX idx_entity_metadata_key ON entities_metadata (entity, key)",
            "CREATE INDEX idx_metadata_key ON entities_metadata (key)"
        ],
        // Security rules matching entity permissions
        listRule: `
            @collection.entities.id = entity &&
            (
                @collection.entities.created_by = @request.auth.id ||
                @collection.agent_roles.agent = @request.auth.id && 
                (
                    @collection.agent_roles.role.role_name ~ @collection.entities.permissions_roles_view ||
                    @collection.agent_roles.role.role_name ~ @collection.entities.permissions_roles_full
                )
            )
        `,
        viewRule: `
            @collection.entities.id = entity &&
            (
                @collection.entities.created_by = @request.auth.id ||
                @collection.agent_roles.agent = @request.auth.id && 
                (
                    @collection.agent_roles.role.role_name ~ @collection.entities.permissions_roles_view ||
                    @collection.agent_roles.role.role_name ~ @collection.entities.permissions_roles_full
                )
            )
        `,
        createRule: `
            @collection.entities.id = entity &&
            (
                @collection.entities.created_by = @request.auth.id ||
                @collection.agent_roles.agent = @request.auth.id && 
                @collection.agent_roles.role.role_name ~ @collection.entities.permissions_roles_full
            )
        `,
        updateRule: `
            @collection.entities.id = entity &&
            (
                @collection.entities.created_by = @request.auth.id ||
                @collection.agent_roles.agent = @request.auth.id && 
                @collection.agent_roles.role.role_name ~ @collection.entities.permissions_roles_full
            )
        `,
        deleteRule: `
            @collection.entities.id = entity &&
            (
                @collection.entities.created_by = @request.auth.id ||
                @collection.agent_roles.agent = @request.auth.id && 
                @collection.agent_roles.role.role_name ~ @collection.entities.permissions_roles_full
            )
        `
    });

    return {
        collections: [entities, entitiesMetadata],
        // Add any necessary hooks or validations
        afterSync: async () => {
            // Could add validation hooks here if needed
        }
    };
}, (db) => {
    // Revert migration
    db.deleteCollection('entities_metadata');
    db.deleteCollection('entities');
});
