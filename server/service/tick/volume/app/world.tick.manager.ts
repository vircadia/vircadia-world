import { log } from "../vircadia-world-sdk-ts/module/general/log.ts";
import type postgres from "postgres";
import { VircadiaConfig_SERVER } from "../vircadia-world-sdk-ts/config/vircadia.server.config";
import {
    Service,
    type Auth,
    type Tick,
} from "../vircadia-world-sdk-ts/schema/schema.general";
import { PostgresClient } from "../vircadia-world-sdk-ts/module/server/postgres.server.client.ts";
import type { Server } from "bun";

export class WorldTickManager {
    private intervalIds: Map<string, Timer> = new Map();
    private syncGroups: Map<string, Auth.SyncGroup.I_SyncGroup> = new Map();
    private tickCounts: Map<string, number> = new Map();
    private superUserSql: postgres.Sql | null = null;

    private readonly LOG_PREFIX = "World Tick Manager";

    async initialize() {
        try {
            log({
                message: "Initializing World Tick Manager",
                debug: VircadiaConfig_SERVER.VRCA_SERVER_DEBUG,
                suppress: VircadiaConfig_SERVER.VRCA_SERVER_SUPPRESS,
                type: "debug",
                prefix: this.LOG_PREFIX,
            });

            Bun.serve({
                hostname:
                    VircadiaConfig_SERVER.VRCA_SERVER_SERVICE_WORLD_TICK_MANAGER_HOST_CONTAINER_BIND_INTERNAL,
                port: VircadiaConfig_SERVER.VRCA_SERVER_SERVICE_WORLD_TICK_MANAGER_PORT_CONTAINER_BIND_INTERNAL,
                development: VircadiaConfig_SERVER.VRCA_SERVER_DEBUG,

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

                        // Gather stats information
                        return Response.json(
                            Service.Tick.Stats_Endpoint.createSuccess({
                                uptime: process.uptime(),
                                database: {
                                    connected: !!this.superUserSql,
                                },
                                memory: {
                                    heapUsed: process.memoryUsage().heapUsed,
                                },
                                cpu: {
                                    system: process.cpuUsage().system,
                                    user: process.cpuUsage().user,
                                },
                            }),
                        );
                    }
                },
            });

            this.superUserSql = await PostgresClient.getInstance({
                debug: VircadiaConfig_SERVER.VRCA_SERVER_DEBUG,
                suppress: VircadiaConfig_SERVER.VRCA_SERVER_SUPPRESS,
            }).getSuperClient({
                postgres: {
                    host: VircadiaConfig_SERVER.VRCA_SERVER_SERVICE_POSTGRES_CONTAINER_NAME,
                    port: VircadiaConfig_SERVER.VRCA_SERVER_SERVICE_POSTGRES_PORT_CONTAINER_BIND_EXTERNAL,
                    database:
                        VircadiaConfig_SERVER.VRCA_SERVER_SERVICE_POSTGRES_DATABASE,
                    username:
                        VircadiaConfig_SERVER.VRCA_SERVER_SERVICE_POSTGRES_SUPER_USER_USERNAME,
                    password:
                        VircadiaConfig_SERVER.VRCA_SERVER_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
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
                            suppress:
                                VircadiaConfig_SERVER.VRCA_SERVER_SUPPRESS,
                            debug: VircadiaConfig_SERVER.VRCA_SERVER_DEBUG,
                            type: "error",
                        });
                    });
                };

                tickLoop();
            }

            log({
                message: `World Tick Manager initialized successfully with ${this.syncGroups.size} sync groups`,
                debug: VircadiaConfig_SERVER.VRCA_SERVER_DEBUG,
                suppress: VircadiaConfig_SERVER.VRCA_SERVER_SUPPRESS,
                type: "success",
                prefix: this.LOG_PREFIX,
            });
        } catch (error) {
            log({
                message: `Failed to initialize tick manager: ${error}`,
                debug: VircadiaConfig_SERVER.VRCA_SERVER_DEBUG,
                suppress: VircadiaConfig_SERVER.VRCA_SERVER_SUPPRESS,
                type: "error",
                prefix: this.LOG_PREFIX,
            });
            throw error;
        }
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
                log({
                    message: `No tick data returned for sync group: ${syncGroup}`,
                    debug: VircadiaConfig_SERVER.VRCA_SERVER_DEBUG,
                    suppress: VircadiaConfig_SERVER.VRCA_SERVER_SUPPRESS,
                    type: "warning",
                    prefix: this.LOG_PREFIX,
                });
                return null;
            }

            log({
                message: `Tick captured for sync group: ${syncGroup}`,
                debug: VircadiaConfig_SERVER.VRCA_SERVER_DEBUG,
                suppress: VircadiaConfig_SERVER.VRCA_SERVER_SUPPRESS,
                type: "debug",
                prefix: this.LOG_PREFIX,
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

        log({
            message: `Tick detected the following changes for sync group: ${syncGroup}`,
            data: {
                "Entity Changes":
                    result?.tick_data.tick__entity_states_processed,
                "Script Changes":
                    result?.tick_data.tick__script_states_processed,
                "Asset Changes": result?.tick_data.tick__asset_states_processed,
            },
            debug: VircadiaConfig_SERVER.VRCA_SERVER_DEBUG,
            suppress: VircadiaConfig_SERVER.VRCA_SERVER_SUPPRESS,
            type: "debug",
            prefix: this.LOG_PREFIX,
        });

        if (
            isLocallyTotalDelayed ||
            isLocallyDbDelayed ||
            isRemotelyDbDelayed
        ) {
            log({
                message: `Tick processing is delayed for ${syncGroup}\nLocally: ${isLocallyDbDelayed || isLocallyTotalDelayed}\nRemotely: ${isRemotelyDbDelayed}`,
                debug: VircadiaConfig_SERVER.VRCA_SERVER_DEBUG,
                suppress: VircadiaConfig_SERVER.VRCA_SERVER_SUPPRESS,
                type: "warning",
                prefix: this.LOG_PREFIX,
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
                log({
                    message: `Failed to update manager metrics: ${error}`,
                    debug: VircadiaConfig_SERVER.VRCA_SERVER_DEBUG,
                    suppress: VircadiaConfig_SERVER.VRCA_SERVER_SUPPRESS,
                    type: "error",
                    prefix: this.LOG_PREFIX,
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
            log({
                message: `Error updating tick manager metrics: ${error}`,
                debug: VircadiaConfig_SERVER.VRCA_SERVER_DEBUG,
                suppress: VircadiaConfig_SERVER.VRCA_SERVER_SUPPRESS,
                type: "error",
                prefix: this.LOG_PREFIX,
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
            debug: VircadiaConfig_SERVER.VRCA_SERVER_DEBUG,
            suppress: VircadiaConfig_SERVER.VRCA_SERVER_SUPPRESS,
            type: "debug",
            prefix: this.LOG_PREFIX,
        });
    }

    cleanup() {
        this.stop();
        PostgresClient.getInstance({
            debug: VircadiaConfig_SERVER.VRCA_SERVER_DEBUG,
            suppress: VircadiaConfig_SERVER.VRCA_SERVER_SUPPRESS,
        }).disconnect();
    }
}

// Add command line entry point
if (import.meta.main) {
    try {
        console.info("Starting World Tick Manager");
        const manager = new WorldTickManager();
        await manager.initialize();

        // Handle cleanup on process termination
        process.on("SIGINT", () => {
            log({
                message: "\nReceived SIGINT. Cleaning up tick manager...",
                debug: VircadiaConfig_SERVER.VRCA_SERVER_DEBUG,
                suppress: VircadiaConfig_SERVER.VRCA_SERVER_SUPPRESS,
                type: "debug",
            });
            manager.cleanup();
            process.exit(0);
        });

        process.on("SIGTERM", () => {
            log({
                message: "\nReceived SIGTERM. Cleaning up tick manager...",
                debug: VircadiaConfig_SERVER.VRCA_SERVER_DEBUG,
                suppress: VircadiaConfig_SERVER.VRCA_SERVER_SUPPRESS,
                type: "debug",
            });
            manager.cleanup();
            process.exit(0);
        });

        log({
            message: "World Tick Manager running as standalone process",
            debug: VircadiaConfig_SERVER.VRCA_SERVER_DEBUG,
            suppress: VircadiaConfig_SERVER.VRCA_SERVER_SUPPRESS,
            type: "success",
        });
    } catch (error) {
        log({
            message: `Failed to start World Tick Manager: ${error}`,
            type: "error",
            suppress: VircadiaConfig_SERVER.VRCA_SERVER_SUPPRESS,
            debug: VircadiaConfig_SERVER.VRCA_SERVER_DEBUG,
        });
        process.exit(1);
    }
}
