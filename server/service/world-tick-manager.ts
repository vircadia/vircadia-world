import { log } from "../../sdk/vircadia-world-sdk-ts/module/general/log";
import type postgres from "postgres";
import type { Hono } from "hono";

interface SyncGroup {
    server_tick_rate_ms: number;
    client_keyframe_check_rate_ms: number;
}

interface SyncGroups {
    [key: string]: SyncGroup;
}

export class WorldTickManager {
    private intervalIds: Map<string, Timer> = new Map();
    private entityStatesCleanupId: Timer | null = null;
    private tickMetricsCleanupId: Timer | null = null;
    private syncGroups: SyncGroups = {};
    private lastServerTime: Date | null = null;
    private tickCounts: Map<string, number> = new Map();
    private tickBufferDurationMs = 2000; // Default from config
    private tickMetricsHistoryMs = 3600000; // Default from config
    private sql: postgres.Sql;

    constructor(
        sql: postgres.Sql,
        private readonly debugMode: boolean = false,
    ) {
        this.sql = sql;
    }

    async initialize() {
        try {
            log({
                message: "Initializing world tick manager",
                debug: this.debugMode,
                type: "debug",
            });

            // Fetch initial config values including sync groups
            const configData = await this.sql`
                SELECT key, value FROM world_config 
                WHERE key IN ('tick_buffer_duration_ms', 'tick_metrics_history_ms', 'sync_groups')
            `;

            // Update config values
            this.updateConfigValues(configData);

            // Get current server time
            const timeData = await this.sql`SELECT get_server_time()`;
            this.lastServerTime = timeData[0].get_server_time;

            log({
                message: `Initialized with sync groups: ${Object.keys(this.syncGroups).join(", ")}`,
                debug: this.debugMode,
                type: "debug",
            });
        } catch (error) {
            log({
                message: `Failed to initialize tick capture service: ${error}`,
                debug: this.debugMode,
                type: "error",
            });
            throw error;
        }
    }

    private updateConfigValues(configData: postgres.RowList<postgres.Row[]>) {
        for (const config of configData) {
            switch (config.key) {
                case "sync_groups":
                    this.syncGroups = config.value;
                    break;
                case "tick_buffer_duration_ms":
                    this.tickBufferDurationMs = config.value;
                    break;
                case "tick_metrics_history_ms":
                    this.tickMetricsHistoryMs = config.value;
                    break;
            }
        }
    }

    private setupCleanupTimers() {
        if (this.entityStatesCleanupId)
            clearInterval(this.entityStatesCleanupId);
        if (this.tickMetricsCleanupId) clearInterval(this.tickMetricsCleanupId);

        this.entityStatesCleanupId = setInterval(async () => {
            try {
                await this.sql`SELECT cleanup_old_entity_states()`;
                log({
                    message: "Entity states cleanup completed",
                    debug: this.debugMode,
                    type: "debug",
                });
            } catch (error) {
                log({
                    message: `Error during entity states cleanup: ${error}`,
                    debug: this.debugMode,
                    type: "error",
                });
            }
        }, this.tickBufferDurationMs);

        this.tickMetricsCleanupId = setInterval(async () => {
            try {
                await this.sql`SELECT cleanup_old_tick_metrics()`;
                log({
                    message: "Tick metrics cleanup completed",
                    debug: this.debugMode,
                    type: "debug",
                });
            } catch (error) {
                log({
                    message: `Error during tick metrics cleanup: ${error}`,
                    debug: this.debugMode,
                    type: "error",
                });
            }
        }, this.tickMetricsHistoryMs);
    }

    private async captureSyncGroupTick(syncGroup: string, config: SyncGroup) {
        try {
            const tickCount = this.tickCounts.get(syncGroup) || 0;

            // Capture tick state and get metrics
            const result = await this.sql`
                WITH tick_capture AS (
                    SELECT capture_tick_state(${syncGroup})
                )
                SELECT 
                    duration_ms, 
                    is_delayed,
                    headroom_ms
                FROM tick_metrics
                WHERE sync_group = ${syncGroup}
                ORDER BY end_time DESC
                LIMIT 1
            `;

            // Update tick count for this sync group
            this.tickCounts.set(syncGroup, tickCount + 1);

            // Log performance metrics if there was a delay
            if (result[0]?.is_delayed) {
                log({
                    message: `${syncGroup} tick capture took ${result[0].duration_ms.toFixed(2)}ms (target: ${config.server_tick_rate_ms}ms, headroom: ${result[0].headroom_ms.toFixed(2)}ms)`,
                    debug: this.debugMode,
                    type: "warn",
                });
            }
        } catch (error) {
            log({
                message: `Error during ${syncGroup} tick capture: ${error}`,
                debug: this.debugMode,
                type: "error",
            });
        }
    }

    start() {
        // Start a separate interval for each sync group
        for (const [syncGroup, config] of Object.entries(this.syncGroups)) {
            if (this.intervalIds.has(syncGroup)) {
                log({
                    message: `Tick capture for ${syncGroup} is already running`,
                    debug: this.debugMode,
                    type: "warn",
                });
                continue;
            }

            log({
                message: `Starting tick capture for ${syncGroup} with ${config.server_tick_rate_ms}ms interval`,
                debug: this.debugMode,
                type: "debug",
            });

            const tick = async () => {
                await this.captureSyncGroupTick(syncGroup, config);
                this.intervalIds.set(
                    syncGroup,
                    setTimeout(tick, config.server_tick_rate_ms),
                );
            };

            tick();
        }

        // Setup cleanup timers
        this.setupCleanupTimers();
    }

    stop() {
        // Stop all sync group intervals
        for (const [syncGroup, intervalId] of this.intervalIds.entries()) {
            clearTimeout(intervalId);
            this.intervalIds.delete(syncGroup);
        }

        // Clear cleanup timers
        if (this.entityStatesCleanupId) {
            clearInterval(this.entityStatesCleanupId);
            this.entityStatesCleanupId = null;
        }
        if (this.tickMetricsCleanupId) {
            clearInterval(this.tickMetricsCleanupId);
            this.tickMetricsCleanupId = null;
        }

        log({
            message: "Tick capture service stopped",
            debug: this.debugMode,
            type: "debug",
        });
    }

    getStats() {
        return {
            tickCounts: Object.fromEntries(this.tickCounts),
            lastServerTime: this.lastServerTime,
            syncGroups: this.syncGroups,
        };
    }

    addRoutes(app: Hono) {
        const routes = app.basePath("/services/world-tick");

        // Add stats endpoint
        routes.get("/stats", (c) => {
            return c.json(this.getStats());
        });
    }
}
