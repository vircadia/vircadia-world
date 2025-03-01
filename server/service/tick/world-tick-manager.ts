import { log } from "../../../sdk/vircadia-world-sdk-ts/module/general/log.ts";
import type postgres from "postgres";
import { VircadiaConfig } from "../../../sdk/vircadia-world-sdk-ts/config/vircadia.config.ts";
import type {
    Auth,
    Tick,
} from "../../../sdk/vircadia-world-sdk-ts/schema/schema.general.ts";
import { PostgresClient } from "../../database/postgres/postgres_client.ts";

export class WorldTickManager {
    private intervalIds: Map<string, Timer> = new Map();
    private syncGroups: Map<string, Auth.SyncGroup.I_SyncGroup> = new Map();
    private tickCounts: Map<string, number> = new Map();
    private superUserSql: postgres.Sql | null = null;
    private proxyUserSql: postgres.Sql | null = null;

    private readonly LOG_PREFIX = "World Tick Manager";

    async initialize() {
        try {
            log({
                message: "Initializing World Tick Manager",
                debug: VircadiaConfig.SERVER.DEBUG,
                suppress: VircadiaConfig.SERVER.SUPPRESS,
                type: "debug",
                prefix: this.LOG_PREFIX,
            });

            this.superUserSql =
                await PostgresClient.getInstance().getSuperClient();
            this.proxyUserSql =
                await PostgresClient.getInstance().getProxyClient();

            // Get sync groups from the database
            const syncGroupsData = await this.superUserSql<
                Auth.SyncGroup.I_SyncGroup[]
            >`
                SELECT * FROM auth.sync_groups
            `;

            for (const group of syncGroupsData) {
                this.syncGroups.set(group.general__sync_group, group);
            }

            // Start tick loops for each sync group
            for (const [syncGroup, config] of this.syncGroups.entries()) {
                if (this.intervalIds.has(syncGroup)) {
                    continue;
                }

                // Use performance.now() for precise timing
                let nextTickTime = performance.now();

                const tickLoop = () => {
                    const now = performance.now();
                    const delay = Math.max(0, nextTickTime - now);

                    // Schedule next tick
                    nextTickTime += config.server__tick__rate_ms;
                    this.intervalIds.set(
                        syncGroup,
                        setTimeout(tickLoop, delay),
                    );

                    // Process tick asynchronously
                    this.processTick(syncGroup).catch((error) => {
                        log({
                            message: `Error in tick processing for ${syncGroup}.`,
                            error: error,
                            prefix: this.LOG_PREFIX,
                            suppress: VircadiaConfig.SERVER.SUPPRESS,
                            debug: VircadiaConfig.SERVER.DEBUG,
                            type: "error",
                        });
                    });
                };

                tickLoop();
            }

            log({
                message: `World Tick Manager initialized successfully with ${this.syncGroups.size} sync groups`,
                debug: VircadiaConfig.SERVER.DEBUG,
                suppress: VircadiaConfig.SERVER.SUPPRESS,
                type: "success",
                prefix: this.LOG_PREFIX,
            });
        } catch (error) {
            log({
                message: `Failed to initialize tick manager: ${error}`,
                debug: VircadiaConfig.SERVER.DEBUG,
                suppress: VircadiaConfig.SERVER.SUPPRESS,
                type: "error",
                prefix: this.LOG_PREFIX,
            });
            throw error;
        }
    }

    private async processTick(syncGroup: string) {
        const localTotalStartTime = performance.now();

        const syncGroupConfig = this.syncGroups.get(syncGroup);
        if (!syncGroupConfig) {
            throw new Error(`Sync group ${syncGroup} not found`);
        }

        if (!this.superUserSql) {
            throw new Error("No database connection available");
        }

        // Measure the time taken for the database operations
        const localDbStartTime = performance.now();
        const result = await this.superUserSql.begin(async (tx) => {
            // Capture the tick state and get metadata directly
            // This function will send a notification after capturing the tick
            const [tickData] = await tx<[Tick.I_Tick]>`
                SELECT * FROM tick.capture_tick_state(${syncGroup})
            `;

            if (!tickData) {
                return null;
            }

            // Update tick count for internal metrics
            const currentCount = this.tickCounts.get(syncGroup) || 0;
            this.tickCounts.set(syncGroup, currentCount + 1);

            return {
                tick_data: tickData,
            };
        });

        const localDbProcessingTime = performance.now() - localDbStartTime;
        const localTotalProcessingTime =
            performance.now() - localTotalStartTime;
        const tickRate = syncGroupConfig.server__tick__rate_ms;
        const isLocallyTotalDelayed = localTotalProcessingTime > tickRate;
        const isLocallyDbDelayed = localDbProcessingTime > tickRate;
        const isRemotelyDbDelayed = result?.tick_data.tick__is_delayed || false;

        if (
            isLocallyTotalDelayed ||
            isLocallyDbDelayed ||
            isRemotelyDbDelayed
        ) {
            log({
                message: `Tick processing is delayed for ${syncGroup}\nLocally: ${isLocallyDbDelayed || isLocallyTotalDelayed}\nRemotely: ${isRemotelyDbDelayed}`,
                debug: VircadiaConfig.SERVER.DEBUG,
                suppress: VircadiaConfig.SERVER.SUPPRESS,
                type: "warning",
                prefix: this.LOG_PREFIX,
                data: {
                    localDbProcessingTime: `Local database processing time: ${localDbProcessingTime}ms`,
                    localTotalProcessingTime: `Local total processing time: ${localTotalProcessingTime}ms`,
                    remoteDbProcessingTime: `Remote database processing time: ${result?.tick_data.tick__duration_ms}ms`,
                    tickRate: `Tick rate: ${tickRate}ms`,
                },
            });
        }
    }

    stop() {
        for (const [syncGroup, intervalId] of this.intervalIds.entries()) {
            clearTimeout(intervalId);
            this.intervalIds.delete(syncGroup);
        }

        log({
            message: "World Tick Manager stopped",
            debug: VircadiaConfig.SERVER.DEBUG,
            suppress: VircadiaConfig.SERVER.SUPPRESS,
            type: "debug",
            prefix: this.LOG_PREFIX,
        });
    }

    cleanup() {
        this.stop();
        PostgresClient.getInstance().disconnect();
    }
}

// Add command line entry point
if (import.meta.main) {
    try {
        const manager = new WorldTickManager();
        await manager.initialize();

        // Handle cleanup on process termination
        process.on("SIGINT", () => {
            log({
                message: "\nReceived SIGINT. Cleaning up tick manager...",
                debug: VircadiaConfig.SERVER.DEBUG,
                suppress: VircadiaConfig.SERVER.SUPPRESS,
                type: "debug",
            });
            manager.cleanup();
            process.exit(0);
        });

        process.on("SIGTERM", () => {
            log({
                message: "\nReceived SIGTERM. Cleaning up tick manager...",
                debug: VircadiaConfig.SERVER.DEBUG,
                suppress: VircadiaConfig.SERVER.SUPPRESS,
                type: "debug",
            });
            manager.cleanup();
            process.exit(0);
        });

        log({
            message: "World Tick Manager running as standalone process",
            debug: VircadiaConfig.SERVER.DEBUG,
            suppress: VircadiaConfig.SERVER.SUPPRESS,
            type: "success",
        });
    } catch (error) {
        log({
            message: `Failed to start World Tick Manager: ${error}`,
            type: "error",
            suppress: VircadiaConfig.SERVER.SUPPRESS,
            debug: true,
        });
        process.exit(1);
    }
}
