/// <reference path="../pb_data/types.d.ts" />

migrate((db) => {
    const roles = new Collection({
        name: 'roles',
        type: 'base',
        fields: [
            {
                id: 'name',
                type: 'text',
                name: 'name',
                required: true,
                unique: true,
                max: 100,
            },
            {
                id: 'description',
                type: 'text',
                name: 'description',
                required: false,
            },
            {
                id: 'is_system',
                type: 'bool',
                name: 'is_system',
                required: true,
            },
            {
                id: 'is_active',
                type: 'bool',
                name: 'is_active',
                required: true,
                default: true,
            },
            {
                id: 'can_insert_entity',
                type: 'bool',
                name: 'can_insert_entity',
                required: false,
            },
            {
                id: 'can_insert_script',
                type: 'bool',
                name: 'can_insert_script',
                required: false,
            }
        ],
        indexes: [
            "CREATE INDEX idx_roles_name ON roles (name)",
            "CREATE INDEX idx_roles_is_active ON roles (is_active)"
        ],
        listRule: '',
        viewRule: '',
        createRule: '',
        updateRule: '',
        deleteRule: '',
    });
    db.save(roles);

    const defaultRoles = [
        {
            name: 'guest',
            description: 'Default role for all users',
            is_system: true,
            is_active: true,
            can_insert_entity: false,
            can_insert_script: false,
        },
        {
            name: 'user',
            description: 'Authenticated user role',
            is_system: true,
            is_active: true,
            can_insert_entity: true,
            can_insert_script: true,
        },
        {
            name: 'admin',
            description: 'Administrative role',
            is_system: true,
            is_active: true,
            can_insert_entity: true,
            can_insert_script: true,
        }
    ];

    for (const role of defaultRoles) {
        const record = new Record(roles);
        record.load(role);
        db.save(record);
    }

    const userRoles = new Collection({
        name: 'user_roles',
        type: 'base',
        fields: [
            {
                id: 'user',
                type: 'relation',
                name: 'user',
                required: true,
                collectionId: '_pb_users_auth_',
                cascadeDelete: true,
                maxSelect: 1,
                minSelect: 1,
            },
            {
                id: 'role',
                type: 'relation',
                name: 'role',
                required: true,
                collectionId: roles.id,
                cascadeDelete: true,
                maxSelect: 1,
                minSelect: 1,
            },
            {
                id: 'is_active',
                type: 'bool',
                name: 'is_active',
                required: true,
                default: true,
            },
            {
                id: 'granted_at',
                type: 'date',
                name: 'granted_at',
                required: true,
                autoCreate: true,
            },
            {
                id: 'granted_by',
                type: 'relation',
                name: 'granted_by',
                required: false,
                collectionId: '_pb_users_auth_',
                cascadeDelete: false,
                maxSelect: 1,
            }
        ],
        indexes: [
            "CREATE INDEX idx_user_roles_is_active ON user_roles (is_active)",
            "CREATE INDEX idx_user_roles_user ON user_roles (user)",
            "CREATE INDEX idx_user_roles_role ON user_roles (role)",
            "CREATE UNIQUE INDEX idx_unique_user_role ON user_roles (user, role)"
        ],
        listRule: '',
        viewRule: '',
        createRule: '',
        updateRule: '',
        deleteRule: '',
    });

    db.save(userRoles);
}, (db) => {
    // Revert operation
    const userRoles = db.findCollectionByNameOrId('user_roles');
    const roles = db.findCollectionByNameOrId('roles');

    db.delete(userRoles);
    db.delete(roles);
});
