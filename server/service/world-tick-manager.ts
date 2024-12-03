import type { PostgresClient } from "../database/postgres/postgres_client";
import { log } from "../../sdk/vircadia-world-sdk-ts/module/general/log";
import type postgres from "postgres";

export class WorldTickManager {
    private intervalId: Timer | null = null;
    private entityStatesCleanupId: Timer | null = null;
    private tickMetricsCleanupId: Timer | null = null;
    private targetIntervalMs = 50;
    private lastServerTime: Date | null = null;
    private tickCount = 0;
    private tickBufferDurationMs = 1000;
    private tickMetricsHistoryMs = 3600;
    private sql: postgres.Sql;

    constructor(
        private readonly postgresClient: PostgresClient,
        private readonly debugMode: boolean = false,
    ) {
        this.sql = postgresClient.getClient();
    }

    async initialize() {
        try {
            // Fetch initial config values
            const configData = await this.sql`
                SELECT key, value FROM world_config 
                WHERE key IN ('tick_rate_ms', 'tick_buffer_duration_ms', 'tick_metrics_history_ms')
            `;

            // Update config values
            this.updateConfigValues(configData);

            // Get current server time
            const timeData = await this.sql`SELECT get_server_time()`;
            this.lastServerTime = timeData[0].get_server_time;

            log({
                message: `Initialized with tick duration: ${this.targetIntervalMs}ms, server time: ${this.lastServerTime}`,
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

    private updateConfigValues(configData: any[]) {
        for (const config of configData) {
            switch (config.key) {
                case "tick_rate_ms":
                    this.targetIntervalMs = Number.parseFloat(config.value);
                    break;
                case "tick_buffer_duration_ms":
                    this.tickBufferDurationMs = Number.parseFloat(config.value);
                    break;
                case "tick_metrics_history_ms":
                    this.tickMetricsHistoryMs = Number.parseFloat(config.value);
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

    async captureTick() {
        try {
            const totalStartTime = performance.now();

            // Get current server time
            const timeRequestStart = performance.now();
            const timeData = await this.sql`SELECT get_server_time()`;
            const timeRequestDuration = performance.now() - timeRequestStart;

            const currentServerTime = timeData[0].get_server_time;

            // Capture tick state
            const captureRequestStart = performance.now();
            await this.sql`SELECT capture_tick_state()`;
            const captureRequestDuration =
                performance.now() - captureRequestStart;

            this.lastServerTime = currentServerTime;
            this.tickCount++;

            // Log performance metrics
            const totalElapsed = performance.now() - totalStartTime;
            if (totalElapsed > this.targetIntervalMs) {
                log({
                    message:
                        `Tick capture took ${totalElapsed.toFixed(2)}ms (target: ${this.targetIntervalMs}ms) ` +
                        `[time_req: ${timeRequestDuration.toFixed(2)}ms, ` +
                        `capture_req: ${captureRequestDuration.toFixed(2)}ms]`,
                    debug: this.debugMode,
                    type: "warn",
                });
            } else if (this.debugMode) {
                log({
                    message:
                        `Tick ${this.tickCount} completed in ${totalElapsed.toFixed(2)}ms ` +
                        `[time_req: ${timeRequestDuration.toFixed(2)}ms, ` +
                        `capture_req: ${captureRequestDuration.toFixed(2)}ms]`,
                    debug: true,
                    type: "debug",
                });
            }
        } catch (error) {
            log({
                message: `Error during tick capture: ${error}`,
                debug: this.debugMode,
                type: "error",
            });
        }
    }

    start() {
        if (this.intervalId) {
            log({
                message: "Tick capture service is already running",
                debug: this.debugMode,
                type: "warn",
            });
            return;
        }

        log({
            message: `Starting tick capture service with ${this.targetIntervalMs}ms interval`,
            debug: this.debugMode,
            type: "debug",
        });

        // Setup cleanup timers
        this.setupCleanupTimers();

        let lastTickTime = performance.now();
        let drift = 0;

        // Use a more precise timing mechanism
        const tick = async () => {
            const now = performance.now();
            const delta = now - lastTickTime;

            await this.captureTick();

            // Calculate next tick time accounting for drift
            lastTickTime = now;
            drift += delta - this.targetIntervalMs;

            // Adjust next interval to account for drift
            const nextDelay = Math.max(0, this.targetIntervalMs - drift);

            // Reset drift if it gets too large
            if (Math.abs(drift) > this.targetIntervalMs * 2) {
                drift = 0;
            }

            // Schedule next tick
            this.intervalId = setTimeout(tick, nextDelay);
        };

        // Start the first tick
        tick();
    }

    stop() {
        if (this.intervalId) {
            clearTimeout(this.intervalId);
            this.intervalId = null;

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
    }

    getStats() {
        return {
            tickCount: this.tickCount,
            lastServerTime: this.lastServerTime,
            targetInterval: this.targetIntervalMs,
        };
    }
}
