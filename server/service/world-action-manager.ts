import PocketBase from 'pocketbase';
import { log } from "../../sdk/vircadia-world-sdk-ts/module/general/log";

export class WorldActionManager {
    private intervalId: Timer | null = null;
    private actionCleanupId: Timer | null = null;
    private targetIntervalMs = 50;
    private actionAbandonedThresholdMs = 300000; // 5 minutes default
    private actionInactiveHistoryCount = 10000;
    private actionCleanupRateMs = 5000;
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

            log({
                message: `Initialized action manager with abandoned threshold: ${this.actionAbandonedThresholdMs}ms`,
                debug: this.debugMode,
                type: "debug",
            });
        } catch (error) {
            log({
                message: `Failed to initialize action manager: ${error}`,
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
            case "action_abandoned_threshold_ms":
                this.actionAbandonedThresholdMs = Number.parseFloat(config.value);
                break;
            case "action_inactive_history_count":
                this.actionInactiveHistoryCount = Number.parseInt(config.value);
                break;
            case "action_cleanup_rate_ms":
                this.actionCleanupRateMs = Number.parseFloat(config.value);
                if (this.actionCleanupId) {
                    this.setupCleanupTimers();
                }
                break;
        }
    }

    private async setupCleanupTimers() {
        if (this.actionCleanupId) clearInterval(this.actionCleanupId);

        this.actionCleanupId = setInterval(async () => {
            try {
                // Mark abandoned actions as expired
                await this.pb.send('/api/expire_abandoned_actions', {
                    threshold_ms: this.actionAbandonedThresholdMs,
                });

                // Clean up excess inactive actions
                await this.pb.send('/api/cleanup_inactive_actions', {
                    retain_count: this.actionInactiveHistoryCount,
                });

                log({
                    message: "Action cleanup completed",
                    debug: this.debugMode,
                    type: "debug",
                });
            } catch (error) {
                log({
                    message: `Error during action cleanup: ${JSON.stringify(error)}`,
                    debug: this.debugMode,
                    type: "error",
                });
            }
        }, this.actionCleanupRateMs);
    }

    start() {
        if (this.actionCleanupId) {
            log({
                message: "Action manager is already running",
                debug: this.debugMode,
                type: "warn",
            });
            return;
        }

        log({
            message: "Starting action manager",
            debug: this.debugMode,
            type: "debug",
        });

        this.setupCleanupTimers();
    }

    stop() {
        if (this.actionCleanupId) {
            clearInterval(this.actionCleanupId);
            this.actionCleanupId = null;

            if (this.configSubscription) {
                this.pb.collection('world_config').unsubscribe();
                this.configSubscription = null;
            }

            log({
                message: "Action manager stopped",
                debug: this.debugMode,
                type: "debug",
            });
        }
    }

    getStats() {
        return {
            abandonedThresholdMs: this.actionAbandonedThresholdMs,
            inactiveHistoryCount: this.actionInactiveHistoryCount,
        };
    }
}
