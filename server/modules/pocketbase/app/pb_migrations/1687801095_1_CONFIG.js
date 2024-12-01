/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
    // World Configuration Collection
    const worldConfig = new Collection({
        name: 'world_config',
        type: 'base',
        system: false,
        schema: [
            {
                name: 'key',
                type: 'text',
                system: false,
                required: true,
                unique: true
            },
            {
                name: 'value',
                type: 'json',
                system: false,
                required: true
            },
            {
                name: 'description',
                type: 'text',
                system: false,
                required: false
            }
        ],
        indexes: ["CREATE UNIQUE INDEX idx_config_key ON world_config (key)"],
        // Only system roles can modify config, but authenticated users can view
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule: null,
        updateRule: null,
        deleteRule: null
    });

    // Insert default configuration
    const defaultConfigs = [
        {
            key: 'tick_rate_ms',
            value: 50,
            description: 'Server tick rate in milliseconds (20 ticks per second)'
        },
        {
            key: 'tick_buffer_duration_ms',
            value: 2000,
            description: 'How long to keep tick history in milliseconds'
        },
        {
            key: 'tick_metrics_history_ms',
            value: 3600000,
            description: 'How long to keep tick metrics history in milliseconds (1 hour default)'
        },
        {
            key: 'action_cleanup_rate_ms',
            value: 5000,
            description: 'How often to clean up actions in milliseconds (5 seconds default)'
        },
        {
            key: 'action_abandoned_threshold_ms',
            value: 5000,
            description: 'Time after which an action with an old heartbeat is considered abandoned (5 seconds default)'
        },
        {
            key: 'action_inactive_history_count',
            value: 10000,
            description: 'Number of inactive actions to retain in history'
        }
    ];

    return {
        collections: [worldConfig],
        // Insert default configurations after collection creation
        afterSync: async () => {
            const collection = db.collection('world_config');
            for (const config of defaultConfigs) {
                await collection.create({
                    key: config.key,
                    value: JSON.stringify(config.value),
                    description: config.description
                });
            }
        }
    };
}, (db) => {
    // Revert migration
    db.deleteCollection('world_config');
});
