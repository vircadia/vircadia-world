/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
    // Entity States Collection
    const entityStates = new Collection({
        name: 'entity_states',
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
                name: 'tick_number',
                type: 'number',
                required: true
            },
            {
                name: 'tick_start_time',
                type: 'date',
                required: true
            },
            {
                name: 'tick_end_time',
                type: 'date',
                required: true
            },
            {
                name: 'tick_duration_ms',
                type: 'number',
                required: true
            },
            {
                name: 'state_data',
                type: 'json',
                required: true
            }
        ],
        indexes: [
            "CREATE INDEX idx_entity_states_lookup ON entity_states (entity, tick_number)",
            "CREATE INDEX idx_entity_states_timestamp ON entity_states (created)"
        ],
        listRule: `
            @collection.entities.id = entity &&
            (
                @collection.entities.created_by = @request.auth.id ||
                @collection.agent_roles.agent = @request.auth.id && 
                @collection.agent_roles.role.role_name ~ @collection.entities.permissions_roles_view
            )
        `,
        viewRule: `
            @collection.entities.id = entity &&
            (
                @collection.entities.created_by = @request.auth.id ||
                @collection.agent_roles.agent = @request.auth.id && 
                @collection.agent_roles.role.role_name ~ @collection.entities.permissions_roles_view
            )
        `,
        createRule: `
            @collection.agent_roles.agent = @request.auth.id && 
            @collection.agent_roles.role.is_system = true
        `,
        updateRule: `
            @collection.agent_roles.agent = @request.auth.id && 
            @collection.agent_roles.role.is_system = true
        `,
        deleteRule: `
            @collection.agent_roles.agent = @request.auth.id && 
            @collection.agent_roles.role.is_system = true
        `
    });

    // Entity Metadata States Collection
    const entityMetadataStates = new Collection({
        name: 'entity_metadata_states',
        type: 'base',
        system: false,
        schema: [
            {
                name: 'entity_metadata',
                type: 'relation',
                required: true,
                options: {
                    collectionId: 'entities_metadata',
                    cascadeDelete: true
                }
            },
            {
                name: 'tick_number',
                type: 'number',
                required: true
            },
            {
                name: 'tick_start_time',
                type: 'date',
                required: true
            },
            {
                name: 'tick_end_time',
                type: 'date',
                required: true
            },
            {
                name: 'tick_duration_ms',
                type: 'number',
                required: true
            },
            {
                name: 'state_data',
                type: 'json',
                required: true
            }
        ],
        indexes: [
            "CREATE INDEX idx_metadata_states_lookup ON entity_metadata_states (entity_metadata, tick_number)",
            "CREATE INDEX idx_metadata_states_timestamp ON entity_metadata_states (created)"
        ],
        listRule: `
            @collection.entities_metadata.id = entity_metadata &&
            (
                @collection.entities.created_by = @request.auth.id ||
                @collection.agent_roles.agent = @request.auth.id && 
                @collection.agent_roles.role.role_name ~ @collection.entities.permissions_roles_view
            )
        `,
        viewRule: `
            @collection.entities_metadata.id = entity_metadata &&
            (
                @collection.entities.created_by = @request.auth.id ||
                @collection.agent_roles.agent = @request.auth.id && 
                @collection.agent_roles.role.role_name ~ @collection.entities.permissions_roles_view
            )
        `,
        createRule: `
            @collection.agent_roles.agent = @request.auth.id && 
            @collection.agent_roles.role.is_system = true
        `,
        updateRule: `
            @collection.agent_roles.agent = @request.auth.id && 
            @collection.agent_roles.role.is_system = true
        `,
        deleteRule: `
            @collection.agent_roles.agent = @request.auth.id && 
            @collection.agent_roles.role.is_system = true
        `
    });

    // Tick Metrics Collection
    const tickMetrics = new Collection({
        name: 'tick_metrics',
        type: 'base',
        system: false,
        schema: [
            {
                name: 'tick_number',
                type: 'number',
                required: true
            },
            {
                name: 'start_time',
                type: 'date',
                required: true
            },
            {
                name: 'end_time',
                type: 'date',
                required: true
            },
            {
                name: 'duration_ms',
                type: 'number',
                required: true
            },
            {
                name: 'states_processed',
                type: 'number',
                required: true
            },
            {
                name: 'is_delayed',
                type: 'bool',
                required: true
            },
            {
                name: 'headroom_ms',
                type: 'number',
                required: false
            },
            {
                name: 'rate_limited',
                type: 'bool',
                required: true,
                default: false
            },
            {
                name: 'time_since_last_tick_ms',
                type: 'number',
                required: false
            }
        ],
        indexes: [
            "CREATE INDEX idx_tick_metrics_number ON tick_metrics (tick_number)",
            "CREATE INDEX idx_tick_metrics_time ON tick_metrics (start_time)"
        ],
        // Only system roles can access tick metrics
        listRule: `
            @collection.agent_roles.agent = @request.auth.id && 
            @collection.agent_roles.role.is_system = true
        `,
        viewRule: `
            @collection.agent_roles.agent = @request.auth.id && 
            @collection.agent_roles.role.is_system = true
        `,
        createRule: `
            @collection.agent_roles.agent = @request.auth.id && 
            @collection.agent_roles.role.is_system = true
        `,
        updateRule: `
            @collection.agent_roles.agent = @request.auth.id && 
            @collection.agent_roles.role.is_system = true
        `,
        deleteRule: `
            @collection.agent_roles.agent = @request.auth.id && 
            @collection.agent_roles.role.is_system = true
        `
    });

    // Add cleanup hooks
    db.onAfterServe().add(async () => {
        const config = await db.collection('world_config').getFullList();
        const tickBufferMs = config.find(c => c.key === 'tick_buffer_duration_ms')?.value || 2000;
        const metricsHistoryMs = config.find(c => c.key === 'tick_metrics_history_ms')?.value || 3600000;

        // Cleanup old states
        const cutoffDate = new Date(Date.now() - tickBufferMs);
        await db.collection('entity_states').delete(`created < "${cutoffDate.toISOString()}"`);
        await db.collection('entity_metadata_states').delete(`created < "${cutoffDate.toISOString()}"`);

        // Cleanup old metrics
        const metricsCutoffDate = new Date(Date.now() - metricsHistoryMs);
        await db.collection('tick_metrics').delete(`created < "${metricsCutoffDate.toISOString()}"`);
    });

    return {
        collections: [entityStates, entityMetadataStates, tickMetrics]
    };
}, (db) => {
    // Revert migration
    db.deleteCollection('tick_metrics');
    db.deleteCollection('entity_metadata_states');
    db.deleteCollection('entity_states');
});
