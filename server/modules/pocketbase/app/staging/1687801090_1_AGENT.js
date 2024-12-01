/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
    // Agent Profiles Collection
    let agentProfiles = new Collection({
        name: "agent_profiles",
        type: "auth",
        fields: [
            {
                name: "username",
                type: "text",
                min: 3,
                max: 64,
                pattern: "^[a-zA-Z0-9_-]+$",
                autogeneratePattern: "[a-zA-Z0-9_-]{10}",
            },
            // how this field will be managed?
            {
                name: "password_last_changed",
                type: "date",
                system: false,
                required: false
            }
        ],
        indexes: ["CREATE UNIQUE INDEX idx_agent_profiles_username ON agent_profiles (username)"],
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule: null,
        updateRule: "@request.auth.id = id",
        deleteRule: null,
    });
    app.save(agentProfiles);

    // What this supposed to be?
    // Note that PocketBase manage its auth provider as part of the auth collection.
    // Please export the auth collection options in the Dashboard.
    //
    //
    // Auth Providers Collection
    let authProviders = new Collection({
        name: "auth_providers",
        type: "base",
        fields: [
            {
                name: "provider_name",
                type: "text",
                required: true,
            },
            {
                name: "description",
                type: "text",
                required: false
            },
            {
                name: "is_active",
                type: "bool",
                required: true,
            }
        ],
        indexes: ["CREATE UNIQUE INDEX idx_auth_providers_provider_name ON auth_providers (provider_name)"],
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule: null,
        updateRule: null,
        deleteRule: null
    });
    app.save(authProviders);

    // Agent Auth Providers Collection
    let agentAuthProviders = new Collection({
        name: "agent_auth_providers",
        type: "base",
        fields: [
            {
                name: "agent",
                type: "relation",
                required: true,
                collectionId: agentProfiles.id,
                cascadeDelete: true,
            },
            {
                name: "provider",
                type: "relation",
                required: true,
                collectionId: authProviders.id,
                cascadeDelete: true,
            },
            {
                name: "provider_uid",
                type: "text",
                required: false
            },
            {
                name: "is_primary",
                type: "bool",
            }
        ],
        indexes: [
            "CREATE UNIQUE INDEX idx_agent_auth_providers_agent_provider ON agent_auth_providers (agent, provider)",
            "CREATE INDEX idx_agent_auth_providers_is_primary ON agent_auth_providers (is_primary)"
        ],
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule: null,
        updateRule: "@request.auth.id = agent",
        deleteRule: "@request.auth.id = agent"
    });
    app.save(agentAuthProviders);

    // Roles Collection
    let roles = new Collection({
        name: "roles",
        type: "base",
        schema: [
            {
                name: "role_name",
                type: "text",
                required: true,
            },
            {
                name: "description",
                type: "text",
                required: false
            },
            {
                name: "is_system",
                type: "bool",
            },
            {
                name: "is_active",
                type: "bool",
            },
            {
                name: "entity_object_can_insert",
                type: "bool",
            },
            {
                name: "entity_script_can_insert",
                type: "bool",
            }
        ],
        indexes: ["CREATE UNIQUE INDEX idx_roles_role_name ON roles (role_name)"],
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule: null,
        updateRule: null,
        deleteRule: null
    });
    app.save(roles);

    // Agent Roles Collection
    let agentRoles = new Collection({
        name: "agent_roles",
        type: "base",
        schema: [
            {
                name: "agent",
                type: "relation",
                required: true,
                collectionId: agentProfiles.id,
                cascadeDelete: true,
            },
            {
                name: "role",
                type: "relation",
                required: true,
                collectionId: "roles",
                cascadeDelete: true,
            },
            {
                name: "is_active",
                type: "bool",
            },
            {
                name: "granted_by",
                type: "relation",
                required: false,
                collectionId: agentProfiles.id,
                cascadeDelete: false,
            }
        ],
        indexes: [
            "CREATE UNIQUE INDEX idx_agent_roles_role ON agent_roles (agent, role)",
            "CREATE INDEX idx_agent_roles_is_active ON agent_roles (is_active)"
        ],
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule: null,
        updateRule: null,
        deleteRule: null
    });
    app.save(agentRoles);

    // PocketBase APIs are fully stateless, aka. there are no sessions; how this collection will be managed?
    //
    // Agent Sessions Collection
    let agentSessions = new Collection({
        name: "agent_sessions",
        type: "base",
        schema: [
            {
                name: "agent",
                type: "relation",
                required: true,
                collectionId: agentProfiles.id,
                cascadeDelete: true
            },
            {
                name: "provider",
                type: "relation",
                required: false,
                collectionId: authProviders.id,
                cascadeDelete: false
            },
            {
                // should this be an autodate (aka. auto update its value on create and update)
                // or it is manual managed date?
                name: "last_seen_at",
                type: "autodate",
                required: true,
                onCreate: true,
                onUpdate: true,
            },
            {
                name: "metadata",
                type: "json",
            },
            {
                name: "is_active",
                type: "bool",
            }
        ],
        indexes: [
            "CREATE INDEX idx_agent_sessions_agent ON agent_sessions (agent)",
            "CREATE INDEX idx_agent_sessions_last_seen_at ON agent_sessions (last_seen_at)",
            "CREATE INDEX idx_agent_sessions_active ON agent_sessions (is_active)"
        ],
        listRule: "@request.auth.id = agent",
        viewRule: "@request.auth.id = agent",
        createRule: "@request.auth.id = agent",
        updateRule: "@request.auth.id = agent",
        deleteRule: "@request.auth.id = agent"
    });
    app.save(agentSessions);


    // See the related collection above. This doesn't really make much sense with PocketBase.
    //
    // 1. Create default auth providers
    let defaultProviders = [
        { name: 'email', description: 'Email and password authentication', is_active: true },
        { name: 'anonymous', description: 'Anonymous authentication', is_active: true },
        { name: 'google', description: 'Google OAuth', is_active: true },
        { name: 'github', description: 'GitHub OAuth', is_active: true },
        { name: 'discord', description: 'Discord OAuth', is_active: true }
    ];
    for (let provider of defaultProviders) {
        let record = new Record(authProviders);
        record.Set("provider_name", provider.name);
        record.Set("description", provider.description);
        record.Set("is_active", provider.is_active);
        app.save(record)
    }

    // 2. Create default roles
    let defaultRoles = [
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
    for (let role of defaultRoles) {
        let record = new Record(roles);
        record.load(role);
        app.save(record)
    }

    // 3. Create admin user
    const adminEmail = 'admin@changeme.com';
    const adminPassword = 'CHANGE_ME!';

    let admin = new Record(agentProfiles)
    admin.set("username", "admin")
    admin.set("emailVisibility", true)
    admin.set("email", adminEmail)
    admin.set("password", adminPassword)
    admin.set("verified", true)
    admin.set("password_last_changed", new Date().toISOString().replace("T", " "))
    app.save(admin)


    // (Again, if the below is supposed to be for auth, see the notes above.)
    //
    // 4. Add email provider for admin
    let emailProvider = app.findFirstRecordByData("auth_providers", "provider_name", "email");
    let agentProvider = new Record(agentAuthProviders)
    agentProvider.set("agent", admin.id)
    agentProvider.set("provider", emailProvider.id)
    agentProvider.set("is_primary", true)
    app.save(agentProvider);

    // 5. Grant admin role
    let adminRole = app.findFirstRecordByData("roles", "role_name", "admin");
    let agentRole = new Record(agentRoles)
    agentRole.set("agent", admin.id)
    agentRole.set("role", adminRole.id)
    agentRole.set("is_active", true)
    agentRole.set("granted_by", admin.id)
    app.save(agentRole);

    console.log('✅ Seed data created successfully');
    console.log('⚠️  IMPORTANT: Remember to change the default admin password after first login!');
}, (app) => {
    const collections = [
        "agent_sessions",
        "agent_roles",
        "roles",
        "agent_auth_providers",
        "auth_providers",
        "agent_profiles",
    ];

    for (let name of collections) {
        app.delete(app.findCollectionByNameOrId(name));
    }
});