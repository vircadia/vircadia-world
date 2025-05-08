import { BunLogModule } from "../../../../../sdk/vircadia-world-sdk-ts/bun/src/module/vircadia.common.bun.log.module";
import type postgres from "postgres";
import { serverConfiguration } from "../../../../../sdk/vircadia-world-sdk-ts/bun/src/config/vircadia.server.config";
import {
    Service,
    type Auth,
    type Tick,
} from "../../../../../sdk/vircadia-world-sdk-ts/schema/src/vircadia.schema.general";
import { BunPostgresClientModule } from "../../../../../sdk/vircadia-world-sdk-ts/bun/src/module/vircadia.common.bun.postgres.module";
import type { Server } from "bun";

const LOG_PREFIX = "World Tick Manager";

export class WorldTickManager {
    private intervalIds: Map<string, Timer> = new Map();
    private syncGroups: Map<string, Auth.SyncGroup.I_SyncGroup> = new Map();
    private tickCounts: Map<string, number> = new Map();
    private superUserSql: postgres.Sql | null = null;
    private processingTicks: Set<string> = new Set(); // Track which sync groups are currently processing
    private pendingTicks: Map<string, boolean> = new Map(); // Track pending ticks for sync groups

    async initialize() {
        try {
            BunLogModule({
                message: "Initializing World Tick Manager",
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                type: "debug",
                prefix: LOG_PREFIX,
            });

            Bun.serve({
                hostname:
                    serverConfiguration.VRCA_SERVER_SERVICE_WORLD_TICK_MANAGER_HOST_CONTAINER_BIND_INTERNAL,
                port: serverConfiguration.VRCA_SERVER_SERVICE_WORLD_TICK_MANAGER_PORT_CONTAINER_BIND_INTERNAL,
                development: serverConfiguration.VRCA_SERVER_DEBUG,

                websocket: {
                    message(ws, message) {},
                },

                // #region API -> HTTP Routes
                fetch: async (req: Request, server: Server) => {
                    const url = new URL(req.url);

                    // Handle stats
                    if (
                        url.pathname.startsWith(
                            Service.Tick.Stats_Endpoint.path,
                        ) &&
                        req.method === Service.Tick.Stats_Endpoint.method
                    ) {
                        const requestIP =
                            req.headers.get("x-forwarded-for")?.split(",")[0] ||
                            server.requestIP(req)?.address ||
                            "";

                        // Only allow access from localhost
                        if (
                            requestIP !== "127.0.0.1" &&
                            requestIP !== "::1" &&
                            requestIP !== "localhost"
                        ) {
                            return Response.json(
                                Service.Tick.Stats_Endpoint.createError(
                                    "Forbidden.",
                                ),
                            );
                        }

                        // Define standard stats data
                        const standardStatsData = {
                            uptime: process.uptime(),
                            database: {
                                connected: !!this.superUserSql,
                            },
                            ticks: {
                                processing: Array.from(this.processingTicks),
                                pending: Object.fromEntries(this.pendingTicks),
                            },
                            memory: {
                                heapUsed: process.memoryUsage().heapUsed,
                            },
                            cpu: {
                                system: process.cpuUsage().system,
                                user: process.cpuUsage().user,
                            },
                        };

                        // Create response with additional data and return
                        const responseData =
                            Service.Tick.Stats_Endpoint.createSuccess(
                                standardStatsData,
                            );

                        return Response.json(responseData);
                    }
                },
            });

            this.superUserSql = await BunPostgresClientModule.getInstance({
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
            }).getSuperClient({
                postgres: {
                    host: serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_CONTAINER_NAME,
                    port: serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_PORT_CONTAINER_BIND_EXTERNAL,
                    database:
                        serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_DATABASE,
                    username:
                        serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_SUPER_USER_USERNAME,
                    password:
                        serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
                },
            });

            // Get sync groups from the database
            const syncGroupsData = await this.superUserSql<
                Auth.SyncGroup.I_SyncGroup[]
            >`
                SELECT * FROM auth.sync_groups
            `;

            for (const group of syncGroupsData) {
                this.syncGroups.set(group.general__sync_group, group);
            }

            await this.superUserSql`LISTEN tick_captured`;
            this.superUserSql.listen("tick_captured", (payload) => {
                this.handleTickCapturedNotification(payload);
            });

            // Start tick loops for each sync group
            for (const [syncGroup, config] of this.syncGroups.entries()) {
                if (this.intervalIds.has(syncGroup)) {
                    continue;
                }

                // Initialize first tick for each sync group
                this.scheduleTick(syncGroup);
            }

            BunLogModule({
                message: `World Tick Manager initialized successfully with ${this.syncGroups.size} sync groups`,
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                type: "success",
                prefix: LOG_PREFIX,
            });
        } catch (error) {
            BunLogModule({
                message: `Failed to initialize tick manager: ${error}`,
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                type: "error",
                prefix: LOG_PREFIX,
            });
            throw error;
        }
    }

    // Handle postgres notifications with proper error handling
    private async handleTickCapturedNotification(
        notification: string,
    ): Promise<void> {
        try {
            const data = JSON.parse(notification);
            const syncGroup = data.syncGroup;

            BunLogModule({
                message: `Received tick completion notification for sync group: ${syncGroup}, tick: ${data.tickNumber}`,
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                type: "debug",
                prefix: LOG_PREFIX,
            });

            // Mark this sync group as no longer processing
            this.processingTicks.delete(syncGroup);

            // If there's a pending tick, process it immediately
            if (this.pendingTicks.get(syncGroup)) {
                this.pendingTicks.set(syncGroup, false);
                this.scheduleTick(syncGroup);
            }
        } catch (error) {
            BunLogModule({
                message: `Error processing tick notification: ${error}`,
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                type: "error",
                prefix: LOG_PREFIX,
            });
        }
    }

    private scheduleTick(syncGroup: string) {
        const config = this.syncGroups.get(syncGroup);
        if (!config) {
            BunLogModule({
                message: `Cannot schedule tick for unknown sync group: ${syncGroup}`,
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                type: "error",
                prefix: LOG_PREFIX,
            });
            return;
        }

        // If this sync group is currently processing a tick, mark it as pending and return
        if (this.processingTicks.has(syncGroup)) {
            this.pendingTicks.set(syncGroup, true);
            BunLogModule({
                message: `Sync group ${syncGroup} is still processing, marking tick as pending`,
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                type: "debug",
                prefix: LOG_PREFIX,
            });
            return;
        }

        // Clear any existing interval
        if (this.intervalIds.has(syncGroup)) {
            const intervalId = this.intervalIds.get(syncGroup);
            if (intervalId) {
                clearTimeout(intervalId);
                this.intervalIds.delete(syncGroup);
            }
        }

        // Schedule the next tick according to the configured rate
        this.intervalIds.set(
            syncGroup,
            setTimeout(() => {
                // Mark this sync group as processing
                this.processingTicks.add(syncGroup);

                // Process the tick
                this.processTick(syncGroup).catch((error) => {
                    // If there was an error, remove from processing
                    this.processingTicks.delete(syncGroup);

                    BunLogModule({
                        message: `Error in tick processing for ${syncGroup}.`,
                        error: error,
                        prefix: LOG_PREFIX,
                        suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                        debug: serverConfiguration.VRCA_SERVER_DEBUG,
                        type: "error",
                    });

                    // Reschedule the tick to try again after a short delay
                    setTimeout(() => this.scheduleTick(syncGroup), 1000);
                });

                // Schedule the next tick
                this.scheduleTick(syncGroup);
            }, config.server__tick__rate_ms),
        );
    }

    private async processTick(syncGroup: string) {
        // Record manager start time
        const managerStartTime = new Date();
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
                BunLogModule({
                    message: `No tick data returned for sync group: ${syncGroup}`,
                    debug: serverConfiguration.VRCA_SERVER_DEBUG,
                    suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                    type: "warning",
                    prefix: LOG_PREFIX,
                });
                return null;
            }

            BunLogModule({
                message: `Tick captured for sync group: ${syncGroup}`,
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                type: "debug",
                prefix: LOG_PREFIX,
                data: {
                    tickId: tickData.general__tick_id,
                    tickNumber: tickData.tick__number,
                    syncGroup: tickData.group__sync,
                },
            });

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
        const isRemotelyDbDelayed =
            result?.tick_data.tick__db__is_delayed || false;

        BunLogModule({
            message: `Tick detected the following changes for sync group: ${syncGroup}`,
            data: {
                "Entity Changes":
                    result?.tick_data.tick__entity_states_processed,
            },
            debug: serverConfiguration.VRCA_SERVER_DEBUG,
            suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
            type: "debug",
            prefix: LOG_PREFIX,
        });

        if (
            isLocallyTotalDelayed ||
            isLocallyDbDelayed ||
            isRemotelyDbDelayed
        ) {
            BunLogModule({
                message: `Tick processing is delayed for ${syncGroup}\nLocally: ${isLocallyDbDelayed || isLocallyTotalDelayed}\nRemotely: ${isRemotelyDbDelayed}`,
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                type: "warning",
                prefix: LOG_PREFIX,
                data: {
                    localDbProcessingTime: `Local database processing time: ${localDbProcessingTime}ms`,
                    localTotalProcessingTime: `Local total processing time: ${localTotalProcessingTime}ms`,
                    remoteDbProcessingTime: `Remote database processing time: ${result?.tick_data.tick__db__duration_ms}ms`,
                    tickRate: `Tick rate: ${tickRate}ms`,
                },
            });
        }

        // Record manager end time and update metrics asynchronously
        const managerEndTime = new Date();
        const managerDurationMs = localTotalProcessingTime;
        const managerIsDelayed = isLocallyTotalDelayed;

        if (result?.tick_data?.general__tick_id) {
            this.updateTickManagerMetrics(
                result.tick_data.general__tick_id,
                managerStartTime,
                managerEndTime,
                managerDurationMs,
                managerIsDelayed,
            ).catch((error) => {
                BunLogModule({
                    message: `Failed to update manager metrics: ${error}`,
                    debug: serverConfiguration.VRCA_SERVER_DEBUG,
                    suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                    type: "error",
                    prefix: LOG_PREFIX,
                });
            });
        }
    }

    // Direct database update method instead of using a dedicated function
    private async updateTickManagerMetrics(
        tickId: string,
        startTime: Date,
        endTime: Date,
        durationMs: number,
        isDelayed: boolean,
    ) {
        // Only proceed if we have a database connection
        if (!this.superUserSql) {
            return;
        }

        try {
            await this.superUserSql`
                UPDATE tick.world_ticks
                SET 
                    tick__manager__start_time = ${startTime},
                    tick__manager__end_time = ${endTime},
                    tick__manager__duration_ms = ${durationMs},
                    tick__manager__is_delayed = ${isDelayed}
                WHERE general__tick_id = ${tickId}
            `;
        } catch (error) {
            // Log but don't throw to avoid affecting tick processing
            BunLogModule({
                message: `Error updating tick manager metrics: ${error}`,
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                type: "error",
                prefix: LOG_PREFIX,
            });
        }
    }

    stop() {
        for (const [syncGroup, intervalId] of this.intervalIds.entries()) {
            clearTimeout(intervalId);
            this.intervalIds.delete(syncGroup);
        }

        BunLogModule({
            message: "World Tick Manager stopped",
            debug: serverConfiguration.VRCA_SERVER_DEBUG,
            suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
            type: "debug",
            prefix: LOG_PREFIX,
        });
    }

    cleanup() {
        this.stop();

        // Unlisten from notifications if possible
        if (this.superUserSql) {
            try {
                this.superUserSql`UNLISTEN tick_captured`.catch(
                    (error: unknown) => {
                        BunLogModule({
                            message: `Error unlistening from tick notifications: ${error}`,
                            debug: serverConfiguration.VRCA_SERVER_DEBUG,
                            suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                            type: "error",
                            prefix: LOG_PREFIX,
                        });
                    },
                );
            } catch (error) {
                BunLogModule({
                    message: `Error attempting to unlisten: ${error}`,
                    debug: serverConfiguration.VRCA_SERVER_DEBUG,
                    suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                    type: "error",
                    prefix: LOG_PREFIX,
                });
            }
        }

        BunPostgresClientModule.getInstance({
            debug: serverConfiguration.VRCA_SERVER_DEBUG,
            suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
        }).disconnect();
    }
}

// Add command line entry point
if (import.meta.main) {
    try {
        BunLogModule({
            message: "Starting World Tick Manager",
            debug: serverConfiguration.VRCA_SERVER_DEBUG,
            suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
            type: "info",
            prefix: LOG_PREFIX,
        });
        const manager = new WorldTickManager();
        await manager.initialize();

        // Handle cleanup on process termination
        process.on("SIGINT", () => {
            BunLogModule({
                message: "\nReceived SIGINT. Cleaning up tick manager...",
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                type: "debug",
                prefix: LOG_PREFIX,
            });
            manager.cleanup();
            process.exit(0);
        });

        process.on("SIGTERM", () => {
            BunLogModule({
                message: "\nReceived SIGTERM. Cleaning up tick manager...",
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                type: "debug",
                prefix: LOG_PREFIX,
            });
            manager.cleanup();
            process.exit(0);
        });

        BunLogModule({
            message: "World Tick Manager running as standalone process",
            debug: serverConfiguration.VRCA_SERVER_DEBUG,
            suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
            type: "success",
            prefix: LOG_PREFIX,
        });
    } catch (error) {
        BunLogModule({
            message: `Failed to start World Tick Manager: ${error}`,
            type: "error",
            suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
            debug: serverConfiguration.VRCA_SERVER_DEBUG,
            prefix: LOG_PREFIX,
        });
        process.exit(1);
    }
}
