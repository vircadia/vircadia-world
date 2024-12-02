/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
    // Seed Scripts Collection
    const seedScripts = new Collection({
        name: 'seed_scripts',
        type: 'base',
        system: false,
        schema: [
            {
                name: 'script',
                type: 'relation',
                required: true,
                options: {
                    collectionId: 'entity_scripts',
                    cascadeDelete: true
                }
            },
            {
                name: 'order',
                type: 'number',
                required: true,
                options: {
                    min: 0
                }
            },
            {
                name: 'is_active',
                type: 'bool',
                required: true,
                default: true
            }
        ],
        indexes: [
            // Create unique index for active scripts with specific order
            "CREATE UNIQUE INDEX idx_seed_script_order ON seed_scripts (\"order\") WHERE is_active = 1",
            "CREATE INDEX idx_seed_script_active ON seed_scripts (is_active)"
        ],
        // Security rules equivalent to your RLS policies
        listRule: `
            @collection.agent_roles.agent = @request.auth.id && 
            @collection.agent_roles.role.is_active = true
        `,
        viewRule: `
            @collection.agent_roles.agent = @request.auth.id && 
            @collection.agent_roles.role.is_active = true
        `,
        createRule: null, // Only through system/admin
        updateRule: `
            @collection.agent_roles.agent = @request.auth.id && 
            (
                @collection.agent_roles.role.is_system = true ||
                @request.data.is_active = false
            )
        `,
        deleteRule: null // Only through system/admin
    });

    // Add hooks for maintaining order integrity
    db.beforeCreate('seed_scripts', async (e) => {
        // Check for duplicate order when active
        if (e.record.get('is_active')) {
            const existingScript = await db.collection('seed_scripts').getFirstListItem(
                `order = ${e.record.get('order')} && is_active = true`
            ).catch(() => null);

            if (existingScript) {
                throw new Error(`Active seed script with order ${e.record.get('order')} already exists`);
            }
        }
    });

    db.beforeUpdate('seed_scripts', async (e) => {
        const newOrder = e.record.get('order');
        const isActive = e.record.get('is_active');

        if (isActive) {
            const existingScript = await db.collection('seed_scripts').getFirstListItem(
                `order = ${newOrder} && is_active = true && id != '${e.record.id}'`
            ).catch(() => null);

            if (existingScript) {
                throw new Error(`Active seed script with order ${newOrder} already exists`);
            }
        }
    });

    // Add validation hook for script existence
    db.beforeCreate('seed_scripts', async (e) => {
        const scriptId = e.record.get('script');
        const script = await db.collection('entity_scripts').getOne(scriptId).catch(() => null);

        if (!script) {
            throw new Error('Referenced script does not exist');
        }
    });

    return {
        collections: [seedScripts],
        // Optional: Add any seed data if needed
        afterSync: async () => {
            // Could add initial seed scripts here if needed
        }
    };
}, (db) => {
    // Revert migration
    db.deleteCollection('seed_scripts');
});
