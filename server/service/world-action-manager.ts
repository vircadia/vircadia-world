import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "../../sdk/vircadia-world-sdk-ts/module/general/log";

export class WorldActionManager {
    private intervalId: Timer | null = null;
    private actionCleanupId: Timer | null = null;
    private targetIntervalMs = 50;
    private actionAbandonedThresholdMs = 300000; // 5 minutes default
    private actionInactiveHistoryCount = 10000;
    private actionCleanupRateMs = 5000; // Add default cleanup rate
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
                this.actionAbandonedThresholdMs = Number.parseFloat(
                    config.value,
                );
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

    private setupCleanupTimers() {
        // Clear existing timer if any
        if (this.actionCleanupId) clearInterval(this.actionCleanupId);

        // Setup action cleanup timer using configurable rate
        this.actionCleanupId = setInterval(async () => {
            try {
                // First, mark abandoned actions as expired
                const { error: expireError } = await this.supabase.rpc(
                    "expire_abandoned_actions",
                    {
                        threshold_ms: this.actionAbandonedThresholdMs,
                    },
                );

                if (expireError) throw expireError;

                // Then, clean up excess inactive actions
                const { error: cleanupError } = await this.supabase.rpc(
                    "cleanup_inactive_actions",
                    {
                        retain_count: this.actionInactiveHistoryCount,
                    },
                );

                if (cleanupError) throw cleanupError;

                log({
                    message: "Action cleanup completed",
                    debug: this.debugMode,
                    type: "debug",
                });
            } catch (error) {
                log({
                    message: `Error during action cleanup: ${JSON.stringify(
                        error,
                    )}`,
                    debug: this.debugMode,
                    type: "error",
                });
            }
        }, this.actionCleanupRateMs); // Use configured cleanup rate instead of calculated one
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

        // Setup cleanup timer
        this.setupCleanupTimers();
    }

    stop() {
        if (this.actionCleanupId) {
            clearInterval(this.actionCleanupId);
            this.actionCleanupId = null;

            // Clean up subscription
            if (this.configSubscription) {
                this.configSubscription.unsubscribe();
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
