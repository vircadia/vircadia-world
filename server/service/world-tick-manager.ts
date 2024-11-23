import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "../../sdk/vircadia-world-sdk-ts/module/general/log";

export class WorldTickManager {
    private intervalId: Timer | null = null;
    private entityStatesCleanupId: Timer | null = null;
    private tickMetricsCleanupId: Timer | null = null;
    private targetIntervalMs = 50;
    private lastServerTime: Date | null = null;
    private tickCount = 0;
    private tickBufferDurationMs = 1000;
    private tickMetricsHistoryMs = 3600;
    private configSubscription: any = null;

    constructor(
        private readonly supabase: SupabaseClient,
        private readonly debugMode: boolean = false,
    ) {
        this.debugMode = debugMode;
    }

    async initialize() {
        try {
            // Fetch initial config values
            const { data: configData, error: configError } = await this.supabase
                .from("world_config")
                .select("*");

            if (configError) throw configError;

            // Update config values
            this.updateConfigValues(configData);

            // Subscribe to config changes
            this.configSubscription = this.supabase
                .channel("world_config_changes")
                .on(
                    "postgres_changes",
                    {
                        event: "*",
                        schema: "public",
                        table: "world_config",
                    },
                    (payload) => {
                        this.handleConfigChange(payload.new);
                    },
                )
                .subscribe();

            // Get current server time
            const { data: timeData, error: timeError } =
                await this.supabase.rpc("get_server_time");

            if (timeError) throw timeError;

            this.lastServerTime = new Date(timeData);

            log({
                message: `Initialized with tick duration: ${this.targetIntervalMs}ms, server time: ${this.lastServerTime}`,
                debug: this.debugMode,
                type: "debug",
            });
        } catch (error) {
            log({
                message: `Failed to initialize tick capture service: ${JSON.stringify(error)}`,
                debug: this.debugMode,
                type: "error",
            });
            throw error;
        }
    }

    private updateConfigValues(configData: any[]) {
        for (const config of configData) {
            this.handleConfigChange(config);
        }
    }

    private handleConfigChange(config: any) {
        switch (config.key) {
            case "tick_rate_ms": {
                const newInterval = Number.parseFloat(config.value);
                if (this.targetIntervalMs !== newInterval) {
                    this.targetIntervalMs = newInterval;
                    // Restart the service if it's running to apply new interval
                    if (this.intervalId) {
                        this.stop();
                        this.start();
                    }
                }
                break;
            }
            case "tick_buffer_duration_ms":
                this.tickBufferDurationMs = Number.parseFloat(config.value);
                break;
            case "tick_metrics_history_ms":
                this.tickMetricsHistoryMs = Number.parseFloat(config.value);
                break;
        }
    }

    private setupCleanupTimers() {
        // Clear existing timers if any
        if (this.entityStatesCleanupId)
            clearInterval(this.entityStatesCleanupId);
        if (this.tickMetricsCleanupId) clearInterval(this.tickMetricsCleanupId);

        // Setup entity states cleanup timer (runs at tickBufferDurationMs interval)
        this.entityStatesCleanupId = setInterval(async () => {
            try {
                await this.supabase.rpc("cleanup_old_entity_states");
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

        // Setup tick metrics cleanup timer (runs at tickMetricsHistorySeconds interval)
        this.tickMetricsCleanupId = setInterval(async () => {
            try {
                await this.supabase.rpc("cleanup_old_tick_metrics");
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
            // Get current server time before capture
            const { data: timeData, error: timeError } =
                await this.supabase.rpc("get_server_time");

            if (timeError) {
                log({
                    message: `Failed to get server time: ${JSON.stringify(timeError)}`,
                    debug: this.debugMode,
                    type: "error",
                });
                return;
            }

            const currentServerTime = new Date(timeData);

            // Start measuring actual tick capture performance here
            const startTime = performance.now();

            // Update: Changed function name from capture_entity_state to capture_tick_state
            const { error: captureError } =
                await this.supabase.rpc("capture_tick_state");

            if (captureError) {
                log({
                    message: `Tick capture failed: ${JSON.stringify(captureError)}`,
                    debug: this.debugMode,
                    type: "error",
                });
            } else {
                this.lastServerTime = currentServerTime;
                this.tickCount++;

                // Log performance metrics for just the capture operation
                const elapsed = performance.now() - startTime;
                if (elapsed > this.targetIntervalMs) {
                    log({
                        message: `Tick capture took ${elapsed.toFixed(2)}ms (target: ${this.targetIntervalMs}ms)`,
                        debug: this.debugMode,
                        type: "warn",
                    });
                }
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

            // Clean up subscription
            if (this.configSubscription) {
                this.configSubscription.unsubscribe();
                this.configSubscription = null;
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
