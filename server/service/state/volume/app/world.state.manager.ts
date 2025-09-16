import { BunLogModule } from "../../../../../sdk/vircadia-world-sdk-ts/bun/src/module/vircadia.common.bun.log.module";
// Switched to legacy postgres.js client for now
import type { Sql } from "postgres";
import { serverConfiguration } from "../../../../../sdk/vircadia-world-sdk-ts/bun/src/config/vircadia.server.config";
import {
    Service,
    type Auth,
    type Tick,
    type Config,
} from "../../../../../sdk/vircadia-world-sdk-ts/schema/src/vircadia.schema.general";
import { BunPostgresClientModule } from "../../../../../sdk/vircadia-world-sdk-ts/bun/src/module/vircadia.common.bun.postgres.module";
import type { Server } from "bun";

const LOG_PREFIX = "World State Manager";

export class WorldStateManager {
    private intervalIds: Map<string, Timer> = new Map();
    private syncGroups: Map<string, Auth.SyncGroup.I_SyncGroup> = new Map();
    private tickCounts: Map<string, number> = new Map();
    private superUserSql: Sql | null = null;
    private legacySuperSql: Sql | null = null;
    private processingTicks: Set<string> = new Set(); // Track which sync groups are currently processing
    private pendingTicks: Map<string, boolean> = new Map(); // Track pending ticks for sync groups
    private entityExpiryIntervalId: Timer | null = null;
    private metadataExpiryIntervalId: Timer | null = null;
    private entityConfig: Config.I_EntityConfig | null = null;

    async initialize() {
        try {
            BunLogModule({
                message: "Initializing World State Manager",
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                type: "debug",
                prefix: LOG_PREFIX,
            });

            Bun.serve({
                hostname: "0.0.0.0",
                port: 3021,
                development: serverConfiguration.VRCA_SERVER_DEBUG,

                websocket: {
                    message(_ws, _message) {},
                },

                // #region API -> HTTP Routes
                fetch: async (req: Request, server: Server) => {
                    const url = new URL(req.url);

                    // Handle stats
                    if (
                        url.pathname.startsWith(
                            Service.State.Stats_Endpoint.path,
                        ) &&
                        req.method === Service.State.Stats_Endpoint.method
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
                                Service.State.Stats_Endpoint.createError(
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
                            entityExpiry: {
                                enabled: !!this.entityConfig,
                                intervalActive: !!this.entityExpiryIntervalId,
                                configuration: this.entityConfig
                                    ? {
                                          checkIntervalMs:
                                              this.entityConfig
                                                  .entity_config__expiry_check_interval_ms,
                                      }
                                    : null,
                            },
                            metadataExpiry: {
                                enabled: !!this.entityConfig,
                                intervalActive: !!this.metadataExpiryIntervalId,
                                configuration: this.entityConfig
                                    ? {
                                          checkIntervalMs:
                                              this.entityConfig
                                                  .entity_config__metadata_expiry_check_interval_ms,
                                      }
                                    : null,
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
                            Service.State.Stats_Endpoint.createSuccess(
                                standardStatsData,
                            );

                        return Response.json(responseData);
                    }
                },
            });

            this.superUserSql = await BunPostgresClientModule.getInstance({
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
            }).getLegacySuperClient({
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

            this.legacySuperSql = await BunPostgresClientModule.getInstance({
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
            }).getLegacySuperClient({
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

            // Get entity configuration from the database
            const [entityConfigData] = await this.superUserSql<
                [Config.I_EntityConfig]
            >`
                SELECT * FROM config.entity_config LIMIT 1
            `;

            if (entityConfigData) {
                this.entityConfig = entityConfigData;

                // Start entity expiry checking interval
                this.startEntityExpiryChecking();
                // Start metadata expiry checking interval
                this.startMetadataExpiryChecking();
            } else {
                BunLogModule({
                    message: "No entity configuration found in database",
                    debug: serverConfiguration.VRCA_SERVER_DEBUG,
                    suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                    type: "warning",
                    prefix: LOG_PREFIX,
                });
            }

            await this.legacySuperSql`LISTEN tick_captured`;
            this.legacySuperSql.listen("tick_captured", (payload) => {
                this.handleTickCapturedNotification(payload);
            });

            // Start tick loops for each sync group, respecting enabled flag (default enabled if undefined)
            for (const [syncGroup, config] of this.syncGroups.entries()) {
                if (config.server__tick__enabled === false) {
                    BunLogModule({
                        message: `Ticking disabled for sync group: ${syncGroup}`,
                        debug: serverConfiguration.VRCA_SERVER_DEBUG,
                        suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                        type: "info",
                        prefix: LOG_PREFIX,
                    });
                    continue;
                }

                if (this.intervalIds.has(syncGroup)) {
                    continue;
                }

                // Initialize first tick for each sync group
                this.scheduleTick(syncGroup);
            }

            const enabledGroups = Array.from(this.syncGroups.entries())
                .filter(([_, cfg]) => cfg.server__tick__enabled !== false)
                .map(([name]) => name);
            const disabledGroups = Array.from(this.syncGroups.entries())
                .filter(([_, cfg]) => cfg.server__tick__enabled === false)
                .map(([name]) => name);

            BunLogModule({
                message: `World State Manager initialized successfully with ${this.syncGroups.size} sync groups, entity expiry checking, and metadata expiry checking`,
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                type: "success",
                prefix: LOG_PREFIX,
                data: {
                    syncGroups: this.syncGroups.size,
                    tickEnabledGroups: enabledGroups.length,
                    tickDisabledGroups: disabledGroups.length,
                    disabledSyncGroups: disabledGroups,
                    entityExpiryEnabled: !!this.entityConfig,
                    entityExpiryInterval:
                        this.entityConfig
                            ?.entity_config__expiry_check_interval_ms,
                    metadataExpiryInterval:
                        this.entityConfig
                            ?.entity_config__metadata_expiry_check_interval_ms,
                },
            });
        } catch (error) {
            BunLogModule({
                message: `Failed to initialize state manager: ${error}`,
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

        // Respect disabled flag (default enabled if undefined)
        if (config.server__tick__enabled === false) {
            BunLogModule({
                message: `Skipping tick scheduling; disabled for sync group: ${syncGroup}`,
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                type: "debug",
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
                    tick__service__start_time = ${startTime},
                    tick__service__end_time = ${endTime},
                    tick__service__duration_ms = ${durationMs},
                    tick__service__is_delayed = ${isDelayed}
                WHERE general__tick_id = ${tickId}
            `;
        } catch (error) {
            // Log but don't throw to avoid affecting tick processing
            BunLogModule({
                message: `Error updating state manager metrics: ${error}`,
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                type: "error",
                prefix: LOG_PREFIX,
            });
        }
    }

    private startEntityExpiryChecking() {
        if (!this.entityConfig) {
            BunLogModule({
                message:
                    "Cannot start entity expiry checking without configuration",
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                type: "error",
                prefix: LOG_PREFIX,
            });
            return;
        }

        // Clear any existing interval
        if (this.entityExpiryIntervalId) {
            clearTimeout(this.entityExpiryIntervalId);
        }

        // Start the expiry checking interval
        this.entityExpiryIntervalId = setInterval(() => {
            this.checkExpiredEntities().catch((error) => {
                BunLogModule({
                    message: `Error in entity expiry checking: ${error}`,
                    debug: serverConfiguration.VRCA_SERVER_DEBUG,
                    suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                    type: "error",
                    prefix: LOG_PREFIX,
                });
            });
        }, this.entityConfig.entity_config__expiry_check_interval_ms);

        BunLogModule({
            message: `Entity expiry checking started with interval: ${this.entityConfig.entity_config__expiry_check_interval_ms}ms`,
            debug: serverConfiguration.VRCA_SERVER_DEBUG,
            suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
            type: "debug",
            prefix: LOG_PREFIX,
        });
    }

    private async checkExpiredEntities() {
        if (!this.superUserSql) {
            return;
        }

        try {
            BunLogModule({
                message:
                    "Checking for expired entities using entity-specific expiry settings",
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                type: "debug",
                prefix: LOG_PREFIX,
            });

            // Find expired entities using their individual expiry settings
            const expiredEntities = await this.superUserSql<
                Array<{
                    general__entity_name: string;
                    general__updated_at: Date;
                    general__created_at: Date;
                    general__expiry__delete_since_updated_at_ms: number | null;
                    general__expiry__delete_since_created_at_ms: number | null;
                    expiry_reason: string;
                }>
            >`
                SELECT 
                    general__entity_name,
                    general__updated_at,
                    general__created_at,
                    general__expiry__delete_since_updated_at_ms,
                    general__expiry__delete_since_created_at_ms,
                    CASE 
                        WHEN general__expiry__delete_since_updated_at_ms IS NOT NULL 
                             AND EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - general__updated_at)) * 1000 > general__expiry__delete_since_updated_at_ms 
                        THEN 'inactivity'
                        WHEN general__expiry__delete_since_created_at_ms IS NOT NULL 
                             AND EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - general__created_at)) * 1000 > general__expiry__delete_since_created_at_ms 
                        THEN 'general_expiry'
                        ELSE 'unknown'
                    END as expiry_reason
                FROM entity.entities 
                WHERE 
                    (
                        (general__expiry__delete_since_updated_at_ms IS NOT NULL 
                         AND EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - general__updated_at)) * 1000 > general__expiry__delete_since_updated_at_ms)
                        OR 
                        (general__expiry__delete_since_created_at_ms IS NOT NULL 
                         AND EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - general__created_at)) * 1000 > general__expiry__delete_since_created_at_ms)
                    )
            `;

            if (expiredEntities.length > 0) {
                BunLogModule({
                    message: `Found ${expiredEntities.length} expired entities`,
                    debug: serverConfiguration.VRCA_SERVER_DEBUG,
                    suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                    type: "info",
                    prefix: LOG_PREFIX,
                    data: {
                        expiredEntities: expiredEntities.map((e) => ({
                            name: e.general__entity_name,
                            reason: e.expiry_reason,
                            lastUpdated: e.general__updated_at,
                            created: e.general__created_at,
                            inactiveExpiryMs:
                                e.general__expiry__delete_since_updated_at_ms,
                            generalExpiryMs:
                                e.general__expiry__delete_since_created_at_ms,
                        })),
                    },
                });

                // Delete expired entities (they're truly expired based on their own settings)
                const entityNames = expiredEntities.map(
                    (e) => e.general__entity_name,
                );

                const placeholders = entityNames
                    .map((_, i) => `$${i + 1}`)
                    .join(", ");
                await this.superUserSql.unsafe(
                    `DELETE FROM entity.entities WHERE general__entity_name IN (${placeholders})`,
                    entityNames,
                );

                BunLogModule({
                    message: `Successfully deleted ${expiredEntities.length} expired entities`,
                    debug: serverConfiguration.VRCA_SERVER_DEBUG,
                    suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                    type: "success",
                    prefix: LOG_PREFIX,
                });
            } else {
                BunLogModule({
                    message: "No expired entities found",
                    debug: serverConfiguration.VRCA_SERVER_DEBUG,
                    suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                    type: "debug",
                    prefix: LOG_PREFIX,
                });
            }
        } catch (error) {
            BunLogModule({
                message: `Error checking expired entities: ${error}`,
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                type: "error",
                prefix: LOG_PREFIX,
            });
        }
    }

    private startMetadataExpiryChecking() {
        if (!this.entityConfig) {
            BunLogModule({
                message:
                    "Cannot start metadata expiry checking without configuration",
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                type: "error",
                prefix: LOG_PREFIX,
            });
            return;
        }

        // Clear any existing interval
        if (this.metadataExpiryIntervalId) {
            clearTimeout(this.metadataExpiryIntervalId);
        }

        // Start the expiry checking interval
        this.metadataExpiryIntervalId = setInterval(() => {
            this.checkExpiredMetadata().catch((error) => {
                BunLogModule({
                    message: `Error in metadata expiry checking: ${error}`,
                    debug: serverConfiguration.VRCA_SERVER_DEBUG,
                    suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                    type: "error",
                    prefix: LOG_PREFIX,
                });
            });
        }, this.entityConfig.entity_config__metadata_expiry_check_interval_ms);

        BunLogModule({
            message: `Metadata expiry checking started with interval: ${this.entityConfig.entity_config__metadata_expiry_check_interval_ms}ms`,
            debug: serverConfiguration.VRCA_SERVER_DEBUG,
            suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
            type: "debug",
            prefix: LOG_PREFIX,
        });
    }

    private async checkExpiredMetadata() {
        if (!this.superUserSql) {
            return;
        }

        try {
            BunLogModule({
                message:
                    "Checking for expired metadata using metadata-specific expiry settings",
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                type: "debug",
                prefix: LOG_PREFIX,
            });

            // Find expired metadata using their individual expiry settings
            const expiredMetadata = await this.superUserSql<
                Array<{
                    general__entity_name: string;
                    metadata__key: string;
                    general__updated_at: Date;
                    general__created_at: Date;
                    general__expiry__delete_since_updated_at_ms: number | null;
                    general__expiry__delete_since_created_at_ms: number | null;
                    expiry_reason: string;
                }>
            >`
                SELECT 
                    general__entity_name,
                    metadata__key,
                    general__updated_at,
                    general__created_at,
                    general__expiry__delete_since_updated_at_ms,
                    general__expiry__delete_since_created_at_ms,
                    CASE 
                        WHEN general__expiry__delete_since_updated_at_ms IS NOT NULL 
                             AND EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - general__updated_at)) * 1000 > general__expiry__delete_since_updated_at_ms 
                        THEN 'inactivity'
                        WHEN general__expiry__delete_since_created_at_ms IS NOT NULL 
                             AND EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - general__created_at)) * 1000 > general__expiry__delete_since_created_at_ms 
                        THEN 'general_expiry'
                        ELSE 'unknown'
                    END as expiry_reason
                FROM entity.entity_metadata 
                WHERE 
                    (
                        (general__expiry__delete_since_updated_at_ms IS NOT NULL 
                         AND EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - general__updated_at)) * 1000 > general__expiry__delete_since_updated_at_ms)
                        OR 
                        (general__expiry__delete_since_created_at_ms IS NOT NULL 
                         AND EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - general__created_at)) * 1000 > general__expiry__delete_since_created_at_ms)
                    )
            `;

            if (expiredMetadata.length > 0) {
                BunLogModule({
                    message: `Found ${expiredMetadata.length} expired metadata entries`,
                    debug: serverConfiguration.VRCA_SERVER_DEBUG,
                    suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                    type: "info",
                    prefix: LOG_PREFIX,
                    data: {
                        expiredMetadata: expiredMetadata.map((m) => ({
                            entityName: m.general__entity_name,
                            metadataKey: m.metadata__key,
                            reason: m.expiry_reason,
                            lastUpdated: m.general__updated_at,
                            created: m.general__created_at,
                            inactiveExpiryMs:
                                m.general__expiry__delete_since_updated_at_ms,
                            generalExpiryMs:
                                m.general__expiry__delete_since_created_at_ms,
                        })),
                    },
                });

                // Delete expired metadata entries
                const metadataToDelete = expiredMetadata.map((m) => ({
                    entity_name: m.general__entity_name,
                    metadata_key: m.metadata__key,
                }));

                // Delete using composite primary key
                for (const metadata of metadataToDelete) {
                    await this.superUserSql`
                        DELETE FROM entity.entity_metadata 
                        WHERE general__entity_name = ${metadata.entity_name}
                          AND metadata__key = ${metadata.metadata_key}
                    `;
                }

                BunLogModule({
                    message: `Successfully deleted ${expiredMetadata.length} expired metadata entries`,
                    debug: serverConfiguration.VRCA_SERVER_DEBUG,
                    suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                    type: "success",
                    prefix: LOG_PREFIX,
                });
            } else {
                BunLogModule({
                    message: "No expired metadata found",
                    debug: serverConfiguration.VRCA_SERVER_DEBUG,
                    suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                    type: "debug",
                    prefix: LOG_PREFIX,
                });
            }
        } catch (error) {
            BunLogModule({
                message: `Error checking expired metadata: ${error}`,
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

        // Clear entity expiry interval
        if (this.entityExpiryIntervalId) {
            clearInterval(this.entityExpiryIntervalId);
            this.entityExpiryIntervalId = null;
        }

        // Clear metadata expiry interval
        if (this.metadataExpiryIntervalId) {
            clearInterval(this.metadataExpiryIntervalId);
            this.metadataExpiryIntervalId = null;
        }

        BunLogModule({
            message: "World State Manager stopped",
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
            message: "Starting World State Manager",
            debug: serverConfiguration.VRCA_SERVER_DEBUG,
            suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
            type: "info",
            prefix: LOG_PREFIX,
        });
        const manager = new WorldStateManager();
        await manager.initialize();

        // Handle cleanup on process termination
        process.on("SIGINT", () => {
            BunLogModule({
                message: "\nReceived SIGINT. Cleaning up state manager...",
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
                message: "\nReceived SIGTERM. Cleaning up state manager...",
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                type: "debug",
                prefix: LOG_PREFIX,
            });
            manager.cleanup();
            process.exit(0);
        });

        BunLogModule({
            message: "World State Manager running as standalone process",
            debug: serverConfiguration.VRCA_SERVER_DEBUG,
            suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
            type: "success",
            prefix: LOG_PREFIX,
        });
    } catch (error) {
        BunLogModule({
            message: `Failed to start World State Manager: ${error}`,
            type: "error",
            suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
            debug: serverConfiguration.VRCA_SERVER_DEBUG,
            prefix: LOG_PREFIX,
        });
        process.exit(1);
    }
}
