/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
    // World Configuration Collection
    const worldConfig = new Collection({
        name: 'world_config',
        type: 'base',
        system: false,
        fields: [
            {
                id: 'key',
                name: 'key',
                type: 'text',
                system: false,
                required: true,
                unique: true
            },
            {
                id: 'value',
                name: 'value',
                type: 'json',
                system: false,
                required: true
            },
            {
                id: 'description',
                name: 'description',
                type: 'text',
                system: false,
                required: false
            }
        ],
        indexes: ["CREATE UNIQUE INDEX idx_config_key ON world_config (key)"],
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule: null,
        updateRule: null,
        deleteRule: null
    });

    // Save the collection first
    db.save(worldConfig);

    // Insert default configurations
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

    // Insert default configurations
    for (const config of defaultConfigs) {
        const record = new Record(worldConfig);
        record.load(config);
        db.save(record);
    }
}, (db) => {
    // Revert migration
    const worldConfig = db.findCollectionByNameOrId('world_config');
    db.delete(worldConfig);
});