/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
    // Agent Profiles Collection
    const agentProfiles = new Collection({
        name: 'agent_profiles',
        type: 'auth',
        system: false,
        schema: [
            {
                name: 'username',
                type: 'text',
                system: false,
                required: true,
                unique: true,
                options: {
                    min: 3,
                    max: 64,
                    pattern: '^[a-zA-Z0-9_-]+$'
                }
            },
            {
                name: 'email',
                type: 'email',
                system: false,
                required: true,
                unique: true
            },
            {
                name: 'password_last_changed',
                type: 'date',
                system: false,
                required: false
            }
        ],
        indexes: ["CREATE INDEX idx_username ON agent_profiles (username)"],
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule: null,
        updateRule: "@request.auth.id = id",
        deleteRule: null
    });

    // Auth Providers Collection
    const authProviders = new Collection({
        name: 'auth_providers',
        type: 'base',
        system: false,
        schema: [
            {
                name: 'provider_name',
                type: 'text',
                system: false,
                required: true,
                unique: true
            },
            {
                name: 'description',
                type: 'text',
                system: false,
                required: false
            },
            {
                name: 'is_active',
                type: 'bool',
                system: false,
                required: true,
                default: true
            }
        ],
        indexes: ["CREATE INDEX idx_provider_name ON auth_providers (provider_name)"],
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule: null,
        updateRule: null,
        deleteRule: null
    });

    // Agent Auth Providers Collection
    const agentAuthProviders = new Collection({
        name: 'agent_auth_providers',
        type: 'base',
        system: false,
        schema: [
            {
                name: 'agent',
                type: 'relation',
                required: true,
                options: {
                    collectionId: 'agent_profiles',
                    cascadeDelete: true
                }
            },
            {
                name: 'provider',
                type: 'relation',
                required: true,
                options: {
                    collectionId: 'auth_providers',
                    cascadeDelete: true
                }
            },
            {
                name: 'provider_uid',
                type: 'text',
                required: false
            },
            {
                name: 'is_primary',
                type: 'bool',
                required: true,
                default: false
            }
        ],
        indexes: [
            "CREATE UNIQUE INDEX idx_agent_provider ON agent_auth_providers (agent, provider)",
            "CREATE INDEX idx_is_primary ON agent_auth_providers (is_primary)"
        ],
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule: null,
        updateRule: "@request.auth.id = agent",
        deleteRule: "@request.auth.id = agent"
    });

    // Roles Collection
    const roles = new Collection({
        name: 'roles',
        type: 'base',
        system: false,
        schema: [
            {
                name: 'role_name',
                type: 'text',
                required: true,
                unique: true
            },
            {
                name: 'description',
                type: 'text',
                required: false
            },
            {
                name: 'is_system',
                type: 'bool',
                required: true,
                default: false
            },
            {
                name: 'is_active',
                type: 'bool',
                required: true,
                default: true
            },
            {
                name: 'entity_object_can_insert',
                type: 'bool',
                required: true,
                default: false
            },
            {
                name: 'entity_script_can_insert',
                type: 'bool',
                required: true,
                default: false
            }
        ],
        indexes: ["CREATE INDEX idx_role_name ON roles (role_name)"],
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule: null,
        updateRule: null,
        deleteRule: null
    });

    // Agent Roles Collection
    const agentRoles = new Collection({
        name: 'agent_roles',
        type: 'base',
        system: false,
        schema: [
            {
                name: 'agent',
                type: 'relation',
                required: true,
                options: {
                    collectionId: 'agent_profiles',
                    cascadeDelete: true
                }
            },
            {
                name: 'role',
                type: 'relation',
                required: true,
                options: {
                    collectionId: 'roles',
                    cascadeDelete: true
                }
            },
            {
                name: 'is_active',
                type: 'bool',
                required: true,
                default: true
            },
            {
                name: 'granted_by',
                type: 'relation',
                required: false,
                options: {
                    collectionId: 'agent_profiles',
                    cascadeDelete: false
                }
            }
        ],
        indexes: [
            "CREATE UNIQUE INDEX idx_agent_role ON agent_roles (agent, role)",
            "CREATE INDEX idx_is_active ON agent_roles (is_active)"
        ],
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule: null,
        updateRule: null,
        deleteRule: null
    });

    // Agent Sessions Collection
    const agentSessions = new Collection({
        name: 'agent_sessions',
        type: 'base',
        system: false,
        schema: [
            {
                name: 'agent',
                type: 'relation',
                required: true,
                options: {
                    collectionId: 'agent_profiles',
                    cascadeDelete: true
                }
            },
            {
                name: 'provider',
                type: 'relation',
                required: false,
                options: {
                    collectionId: 'auth_providers',
                    cascadeDelete: false
                }
            },
            {
                name: 'last_seen_at',
                type: 'date',
                required: true,
                options: {
                    autoUpdate: true
                }
            },
            {
                name: 'metadata',
                type: 'json',
                required: false
            },
            {
                name: 'is_active',
                type: 'bool',
                required: true,
                default: true
            }
        ],
        indexes: [
            "CREATE INDEX idx_agent_session ON agent_sessions (agent)",
            "CREATE INDEX idx_last_seen ON agent_sessions (last_seen_at)",
            "CREATE INDEX idx_session_active ON agent_sessions (is_active)"
        ],
        listRule: "@request.auth.id = agent",
        viewRule: "@request.auth.id = agent",
        createRule: "@request.auth.id = agent",
        updateRule: "@request.auth.id = agent",
        deleteRule: "@request.auth.id = agent"
    });

    return {
        collections: [
            agentProfiles,
            authProviders,
            agentAuthProviders,
            roles,
            agentRoles,
            agentSessions
        ],
        async afterSync() {
            try {
                // 1. Create default auth providers
                const defaultProviders = [
                    { name: 'email', description: 'Email and password authentication', is_active: true },
                    { name: 'anonymous', description: 'Anonymous authentication', is_active: true },
                    { name: 'google', description: 'Google OAuth', is_active: true },
                    { name: 'github', description: 'GitHub OAuth', is_active: true },
                    { name: 'discord', description: 'Discord OAuth', is_active: true }
                ];

                for (const provider of defaultProviders) {
                    try {
                        await db.collection('auth_providers').create({
                            provider_name: provider.name,
                            description: provider.description,
                            is_active: provider.is_active
                        });
                    } catch (err) {
                        // Convert error object to string message
                        throw new Error(`Failed to create auth provider ${provider.name}: ${err.message}`);
                    }
                }

                // 2. Create default roles
                const defaultRoles = [
                    {
                        role_name: 'guest',
                        description: 'Default role for all users',
                        is_system: true,
                        is_active: true,
                        entity_object_can_insert: false,
                        entity_script_can_insert: false
                    },
                    {
                        role_name: 'user',
                        description: 'Authenticated user role',
                        is_system: true,
                        is_active: true,
                        entity_object_can_insert: true,
                        entity_script_can_insert: true
                    },
                    {
                        role_name: 'admin',
                        description: 'Administrative role',
                        is_system: true,
                        is_active: true,
                        entity_object_can_insert: true,
                        entity_script_can_insert: true
                    }
                ];

                for (const role of defaultRoles) {
                    try {
                        await db.collection('roles').create(role);
                    } catch (err) {
                        console.error('Failed to create role:', role.role_name, err.message);
                        throw new Error(`Failed to create role ${role.role_name}: ${err.message}`);
                    }
                }

                try {
                    // 3. Create admin user
                    const adminEmail = 'admin@changeme.com';
                    const adminPassword = 'CHANGE_ME!';

                    const admin = await db.collection('agent_profiles').create({
                        username: 'admin',
                        emailVisibility: true,
                        email: adminEmail,
                        password: adminPassword,
                        passwordConfirm: adminPassword,
                        verified: true,
                        password_last_changed: new Date().toISOString()
                    });

                    // 4. Add email provider for admin
                    const emailProvider = await db.collection('auth_providers').getFirstListItem('provider_name = "email"');
                    await db.collection('agent_auth_providers').create({
                        agent: admin.id,
                        provider: emailProvider.id,
                        is_primary: true
                    });

                    // 5. Grant admin role
                    const adminRole = await db.collection('roles').getFirstListItem('role_name = "admin"');
                    await db.collection('agent_roles').create({
                        agent: admin.id,
                        role: adminRole.id,
                        is_active: true,
                        granted_by: admin.id
                    });

                    console.log('✅ Seed data created successfully');
                    console.log('⚠️  IMPORTANT: Remember to change the default admin password after first login!');
                } catch (err) {
                    console.error('Failed during admin user setup:', err.message);
                    throw new Error(`Failed during admin user setup: ${err.message}`);
                }
            } catch (err) {
                // Ensure we're throwing a proper Error object
                if (err instanceof Error) {
                    throw err;
                }
                throw new Error(err.toString());
            }
        }
    };
}, (db) => {
    const collections = [
        'agent_profiles',
        'auth_providers',
        'agent_auth_providers',
        'roles',
        'agent_roles',
        'agent_sessions'
    ];

    try {
        for (const collection of collections) {
            db.deleteCollection(collection);
        }
    } catch (err) {
        // Ensure we're throwing a proper Error object
        if (err instanceof Error) {
            throw err;
        }
        throw new Error(err.toString());
    }
});
