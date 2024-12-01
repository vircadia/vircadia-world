/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
    // Actions Collection
    const actions = new Collection({
        name: 'actions',
        type: 'base',
        system: false,
        schema: [
            {
                name: 'entity_script',
                type: 'relation',
                required: true,
                options: {
                    collectionId: 'entity_scripts',
                    cascadeDelete: true
                }
            },
            {
                name: 'action_status',
                type: 'select',
                required: true,
                options: {
                    maxSelect: 1,
                    values: [
                        'PENDING',
                        'IN_PROGRESS',
                        'COMPLETED',
                        'FAILED',
                        'REJECTED',
                        'EXPIRED',
                        'CANCELLED'
                    ]
                },
                default: 'PENDING'
            },
            {
                name: 'claimed_by',
                type: 'relation',
                required: false,
                options: {
                    collectionId: 'agent_profiles',
                    cascadeDelete: false
                }
            },
            {
                name: 'action_query',
                type: 'json',
                required: true
            },
            {
                name: 'last_heartbeat',
                type: 'date',
                required: false
            }
        ],
        indexes: [
            "CREATE INDEX idx_actions_status ON actions (action_status)",
            "CREATE INDEX idx_actions_claimed_by ON actions (claimed_by)",
            "CREATE INDEX idx_actions_heartbeat ON actions (last_heartbeat) WHERE action_status = 'IN_PROGRESS'"
        ],
        // Security rules equivalent to your RLS policies
        listRule: `
            @request.auth.id = created_by ||
            @collection.agent_roles.agent = @request.auth.id && 
            @collection.agent_roles.role.is_system = true
        `,
        viewRule: `
            @request.auth.id = created_by ||
            @collection.agent_roles.agent = @request.auth.id && 
            @collection.agent_roles.role.is_system = true
        `,
        createRule: `
            @collection.agent_roles.agent = @request.auth.id && 
            (
                @collection.agent_roles.role.is_system = true ||
                @collection.agent_roles.role.entity_object_can_insert = true
            )
        `,
        updateRule: `
            @collection.agent_roles.agent = @request.auth.id && 
            @collection.agent_roles.role.is_system = true &&
            (
                @request.data.action_status:isset ||
                @request.data.claimed_by:isset
            )
        `,
        deleteRule: null // Actions should not be deleted, only marked as CANCELLED
    });

    // Add hooks for action management
    db.beforeCreate('actions', async (e) => {
        // Validate script exists
        const scriptId = e.record.get('entity_script');
        const script = await db.collection('entity_scripts').getOne(scriptId).catch(() => null);

        if (!script) {
            throw new Error('Referenced entity script does not exist');
        }
    });

    // Add hooks for automatic action expiration
    db.onAfterServe().add(async () => {
        const config = await db.collection('world_config').getFullList();
        const abandonedThresholdMs = config.find(c => c.key === 'action_abandoned_threshold_ms')?.value || 5000;
        const inactiveHistoryCount = config.find(c => c.key === 'action_inactive_history_count')?.value || 10000;

        // Expire abandoned actions
        const expireAbandonedActions = async () => {
            const cutoffDate = new Date(Date.now() - abandonedThresholdMs);
            await db.collection('actions').update(`
                action_status = 'IN_PROGRESS' AND 
                last_heartbeat < '${cutoffDate.toISOString()}'
            `, {
                action_status: 'EXPIRED'
            });
        };

        // Cleanup inactive actions
        const cleanupInactiveActions = async () => {
            const inactiveStatuses = ['COMPLETED', 'FAILED', 'REJECTED', 'EXPIRED', 'CANCELLED'];

            for (const status of inactiveStatuses) {
                const actions = await db.collection('actions').getFullList({
                    filter: `action_status = '${status}'`,
                    sort: '-created',
                    skip: inactiveHistoryCount
                });

                for (const action of actions) {
                    await db.collection('actions').delete(action.id);
                }
            }
        };

        // Schedule regular cleanup
        const cleanupInterval = config.find(c => c.key === 'action_cleanup_rate_ms')?.value || 5000;
        setInterval(async () => {
            await expireAbandonedActions();
            await cleanupInactiveActions();
        }, cleanupInterval);
    });

    return {
        collections: [actions]
    };
}, (db) => {
    // Revert migration
    db.deleteCollection('actions');
});
