import PocketBase from 'pocketbase';
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
        private readonly pb: PocketBase,
        private readonly debugMode: boolean = false,
    ) {
        this.debugMode = debugMode;
    }

    async initialize() {
        try {
            // Fetch initial config values
            const configData = await this.pb.collection('world_config').getFullList();

            // Update config values
            this.updateConfigValues(configData);

            // Subscribe to config changes
            this.configSubscription = await this.pb.collection('world_config').subscribe('*', 
                (data) => {
                    this.handleConfigChange(data.record);
                }
            );

            // Get current server time
            const timeData = await this.pb.send('/api/utils/now', {});
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
        if (this.entityStatesCleanupId) clearInterval(this.entityStatesCleanupId);
        if (this.tickMetricsCleanupId) clearInterval(this.tickMetricsCleanupId);

        this.entityStatesCleanupId = setInterval(async () => {
            try {
                await this.pb.send('/api/collections/entity_states/cleanup', {});
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
                await this.pb.send('/api/collections/tick_metrics/cleanup', {});
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
            const timeData = await this.pb.send('/api/utils/now', {});
            const timeRequestDuration = performance.now() - timeRequestStart;

            const currentServerTime = new Date(timeData);

            // Capture tick state
            const captureRequestStart = performance.now();
            const captureData = await this.pb.send('/api/collections/tick_state/capture', {});
            const captureRequestDuration = performance.now() - captureRequestStart;

            this.lastServerTime = currentServerTime;
            this.tickCount++;

            // Log performance metrics
            const totalElapsed = performance.now() - totalStartTime;
            if (totalElapsed > this.targetIntervalMs) {
                log({
                    message: `Tick capture took ${totalElapsed.toFixed(2)}ms (target: ${this.targetIntervalMs}ms) ` +
                        `[time_req: ${timeRequestDuration.toFixed(2)}ms, ` +
                        `capture_req: ${captureRequestDuration.toFixed(2)}ms]`,
                    debug: this.debugMode,
                    type: "warn",
                });
            } else if (this.debugMode) {
                log({
                    message: `Tick ${this.tickCount} completed in ${totalElapsed.toFixed(2)}ms ` +
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
