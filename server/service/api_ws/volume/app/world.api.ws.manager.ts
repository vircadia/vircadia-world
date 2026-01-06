// =============================================================================
// ============================== IMPORTS, TYPES, AND INTERFACES ==============================
// =============================================================================

import type { Server, ServerWebSocket, SQL } from "bun";
import type { Sql } from "postgres";
import { serverConfiguration } from "../../../../../sdk/vircadia-world-sdk-ts/bun/src/config/vircadia.server.config";
import { BunLogModule } from "../../../../../sdk/vircadia-world-sdk-ts/bun/src/module/vircadia.common.bun.log.module";
import { BunPostgresClientModule } from "../../../../../sdk/vircadia-world-sdk-ts/bun/src/module/vircadia.common.bun.postgres.module";
import {
    AclService,
    validateJWT,
} from "../../../../../sdk/vircadia-world-sdk-ts/bun/src/module/vircadia.server.auth.module";
import {
    type Auth,
    Communication,
} from "../../../../../sdk/vircadia-world-sdk-ts/schema/src/vircadia.schema.general";
import { MetricsCollector } from "./service/metrics";

let legacySuperUserSql: Sql | null = null;
// Note: legacyProxyUserSql kept for parity, currently unused
let _legacyProxyUserSql: Sql | null = null;
let superUserSql: SQL | null = null;
let proxyUserSql: SQL | null = null;

// =================================================================================
// ================ WORLD API WS MANAGER: Server Startup and Routing ==================
// =================================================================================

// #region WorldApiWsManager

export interface WorldSession<T = unknown> {
    ws: WebSocket | ServerWebSocket<T>;
    agentId: string;
    sessionId: string;
}

export interface WebSocketData {
    token: string;
    agentId: string;
    sessionId: string;
}

const LOG_PREFIX = "World API WS Manager";

// Reflect tick-gated delivery queue item shape
type ReflectQueuedItem = {
    payloadJson: string;
    ack?: { requestId: string };
};

interface EntityNotificationPayload {
    resource: "entity" | "entity_metadata";
    operation: Communication.WebSocket.DatabaseOperation;
    entityName?: string;
    metadataKey?: string;
    syncGroup: string;
    channel?: string | null;
    data: unknown;
    previous?: unknown;
    // Timing instrumentation for latency tracking
    replicationEventReceivedTime?: number; // When logical replication event was received
    queuedTime?: number; // When notification was queued
    flushedTime?: number; // When notification was flushed from queue
    publishedTime?: number; // When notification was published via WebSocket
}

type DbNotificationOperation = "INSERT" | "UPDATE" | "DELETE";

interface EntityDbNotification {
    resource: "entity";
    operation: DbNotificationOperation;
    entityName: string;
    syncGroup?: string | null;
    channel?: string | null;
    data?: unknown;
    previous?: unknown;
}

interface EntityMetadataDbNotification {
    resource: "entity_metadata";
    operation: DbNotificationOperation;
    entityName: string;
    metadataKey: string;
    syncGroup?: string | null;
    channel?: string | null;
    data?: unknown;
    previous?: unknown;
}

export class WorldApiWsManager {
    private server: Server<WebSocketData> | undefined;

    public activeSessions: Map<string, WorldSession<unknown>> = new Map();
    private heartbeatInterval: Timer | null = null;
    private assetMaintenanceInterval: Timer | null = null;
    private tokenMap = new WeakMap<
        WebSocket | ServerWebSocket<unknown>,
        string
    >();
    private wsToSessionMap = new WeakMap<
        WebSocket | ServerWebSocket<unknown>,
        string
    >();
    private metricsCollector = new MetricsCollector();

    // Reflect tick-gated delivery queue: syncGroup -> channel -> fromSessionId -> queued item
    private reflectQueues: Map<
        string,
        Map<string, Map<string, ReflectQueuedItem>>
    > = new Map();

    // Entity tick-gated delivery queue: syncGroup -> entityName -> queued entity notifications
    private entityQueues: Map<
        string,
        Map<string, EntityNotificationPayload[]>
    > = new Map();

    // Entity metadata tick-gated delivery queue: syncGroup -> entityName -> metadataKey -> queued metadata notifications
    private entityMetadataQueues: Map<
        string,
        Map<string, Map<string, EntityNotificationPayload[]>>
    > = new Map();
    private reflectIntervals: Map<string, Timer> = new Map();
    private reflectTickRateMs: Map<string, number> = new Map();
    private unregisterAclWarmCallback: (() => void) | null = null;
    private readonly REFLECT_TOPIC_PREFIX = "reflect:";
    private readonly ENTITY_TOPIC_PREFIX = "entity:";
    private readonly METADATA_TOPIC_PREFIX = "metadata:";
    private readonly ENTITY_CHANGE_CHANNEL = "entity_change";
    private readonly ENTITY_METADATA_CHANGE_CHANNEL = "entity_metadata_change";

    private addCorsHeaders(response: Response, req: Request): Response {
        const origin = req.headers.get("origin");

        // Auto-allow localhost and 127.0.0.1 on any port for development
        const isLocalhost =
            origin &&
            (origin.startsWith("http://localhost:") ||
                origin.startsWith("https://localhost:") ||
                origin.startsWith("http://127.0.0.1:") ||
                origin.startsWith("https://127.0.0.1:"));

        // Build allowed origins for production
        const allowedOrigins = [
            // Caddy domain
            `https://${serverConfiguration.VRCA_SERVER_SERVICE_CADDY_DOMAIN}`,
            `http://${serverConfiguration.VRCA_SERVER_SERVICE_CADDY_DOMAIN}`,
            // WS Manager's own public endpoint
            serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_WS_MANAGER_SSL_ENABLED_PUBLIC_AVAILABLE_AT
                ? `https://${serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_WS_MANAGER_HOST_PUBLIC_AVAILABLE_AT}${serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_WS_MANAGER_PORT_PUBLIC_AVAILABLE_AT !== 443 ? `:${serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_WS_MANAGER_PORT_PUBLIC_AVAILABLE_AT}` : ""}`
                : `http://${serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_WS_MANAGER_HOST_PUBLIC_AVAILABLE_AT}${serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_WS_MANAGER_PORT_PUBLIC_AVAILABLE_AT !== 80 ? `:${serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_WS_MANAGER_PORT_PUBLIC_AVAILABLE_AT}` : ""}`,
        ];
        // Add allowed origins from config
        allowedOrigins.push(...serverConfiguration.VRCA_SERVER_ALLOWED_ORIGINS);

        // Check if origin is allowed (localhost on any port OR in allowed list)
        if (origin && (isLocalhost || allowedOrigins.includes(origin))) {
            response.headers.set("Access-Control-Allow-Origin", origin);
            response.headers.set("Access-Control-Allow-Credentials", "true");
        } else {
            // For non-matching origins, don't set credentials
            response.headers.set("Access-Control-Allow-Origin", "*");
            // Note: We don't set Access-Control-Allow-Credentials for wildcard origins
        }

        response.headers.set(
            "Access-Control-Allow-Methods",
            "GET, POST, PUT, DELETE, OPTIONS",
        );
        response.headers.set(
            "Access-Control-Allow-Headers",
            "Content-Type, Authorization, X-Requested-With",
        );

        return response;
    }

    private getReflectTopic(
        syncGroup: string,
        channel?: string | null,
    ): string {
        if (channel === null || channel === undefined) {
            return `${this.REFLECT_TOPIC_PREFIX}${syncGroup}:*`;
        }
        return `${this.REFLECT_TOPIC_PREFIX}${syncGroup}:${channel}`;
    }

    private getEntityTopic(
        syncGroup: string,
        entityName: string,
        channel?: string | null,
    ): string {
        if (channel === null || channel === undefined) {
            return `${this.ENTITY_TOPIC_PREFIX}${syncGroup}:${entityName}:*`;
        }
        return `${this.ENTITY_TOPIC_PREFIX}${syncGroup}:${entityName}:${channel}`;
    }

    private getMetadataTopic(
        syncGroup: string,
        entityName: string,
        metadataKey: string,
        channel?: string | null,
    ): string {
        if (channel === null || channel === undefined) {
            return `${this.METADATA_TOPIC_PREFIX}${syncGroup}:${entityName}:${metadataKey}:*`;
        }
        return `${this.METADATA_TOPIC_PREFIX}${syncGroup}:${entityName}:${metadataKey}:${channel}`;
    }

    private syncReflectSubscriptionsForSession(
        session: WorldSession<unknown>,
    ): void {
        if (!this.aclService) {
            return;
        }
        const ws = session.ws as ServerWebSocket<WebSocketData>;
        if (typeof ws.subscribe !== "function") {
            return;
        }

        const readableGroups = this.aclService.getReadableSyncGroups(
            session.agentId,
        );
        const requestedGroups = new Set<string>();
        for (const group of readableGroups) {
            requestedGroups.add(group);
        }

        // Get current subscriptions from Bun's native getter
        const subscriptions =
            (ws as unknown as { subscriptions?: string[] }).subscriptions || [];
        const currentSubscriptions = new Set(subscriptions);

        // Unsubscribe from groups we no longer have access to
        for (const subscription of currentSubscriptions) {
            if (subscription.startsWith(this.REFLECT_TOPIC_PREFIX)) {
                const syncGroup = subscription
                    .replace(this.REFLECT_TOPIC_PREFIX, "")
                    .split(":")[0];
                if (!requestedGroups.has(syncGroup)) {
                    try {
                        ws.unsubscribe(subscription);
                    } catch {
                        // ignore unsubscribe errors
                    }
                }
            }
        }

        // Subscribe to new groups
        for (const group of requestedGroups) {
            const allChannelsTopic = this.getReflectTopic(group);
            if (!currentSubscriptions.has(allChannelsTopic)) {
                try {
                    ws.subscribe(allChannelsTopic);
                } catch {
                    // ignore subscribe errors
                }
            }
        }
    }

    private publishReflect(
        syncGroup: string,
        channel: string,
        payloadJson: string,
    ): number {
        if (!this.server) {
            return 0;
        }

        // Always publish to the "all channels" topic
        const allChannelsTopic = this.getReflectTopic(syncGroup);
        let delivered = this.server.publish(allChannelsTopic, payloadJson);

        // If a specific channel is provided, also publish to the channel-specific topic
        if (channel !== null && channel !== undefined && channel !== "") {
            const channelTopic = this.getReflectTopic(syncGroup, channel);
            delivered += this.server.publish(channelTopic, payloadJson);
        }

        return delivered;
    }

    private enqueueReflect(
        syncGroup: string,
        channel: string,
        fromSessionId: string,
        payloadJson: string,
        ackRequestId?: string,
    ) {
        let groupMap = this.reflectQueues.get(syncGroup);
        if (!groupMap) {
            groupMap = new Map();
            this.reflectQueues.set(syncGroup, groupMap);
        }
        let channelMap = groupMap.get(channel);
        if (!channelMap) {
            channelMap = new Map();
            groupMap.set(channel, channelMap);
        }
        // Only one message per session per channel; replace any existing
        channelMap.set(fromSessionId, {
            payloadJson,
            ack: ackRequestId ? { requestId: ackRequestId } : undefined,
        });
    }

    private async flushTickQueues(syncGroup: string) {
        const flushStartTime = performance.now();
        const groupMap = this.reflectQueues.get(syncGroup);
        if (!groupMap) {
            // Check if there are metadata/entity queues even if no reflect queue
            const hasMetadataQueues = this.entityMetadataQueues.has(syncGroup);
            const hasEntityQueues = this.entityQueues.has(syncGroup);
            if (!hasMetadataQueues && !hasEntityQueues) {
                return;
            }
            // Continue to process metadata/entity queues even if reflect queue is empty
        }

        const startTime = performance.now();
        let reflectDeliveredCount = 0;
        let reflectMessages = 0;
        let reflectUniqueMessages = 0;
        let reflectBytes = 0;
        const reflectStartTime = performance.now();
        let entityDeliveredCount = 0;
        let entityMessages = 0;
        let entityUniqueMessages = 0;
        let entityBytes = 0;
        let entityStartTime = 0;
        let metadataDeliveredCount = 0;
        let metadataMessages = 0;
        let metadataUniqueMessages = 0;
        let metadataBytes = 0;
        let metadataStartTime = 0;

        // Track unique reflect messages by channel+payload hash
        const reflectMessageHashes = new Set<string>();
        if (groupMap) {
            for (const [channel, channelMap] of groupMap) {
                for (const [fromSessionId, queuedItem] of channelMap) {
                    const payloadJson = queuedItem.payloadJson;
                    reflectMessages++;
                    const messageHash = `${channel}:${payloadJson}`;
                    if (!reflectMessageHashes.has(messageHash)) {
                        reflectMessageHashes.add(messageHash);
                        reflectUniqueMessages++;
                    }
                    const messageBytes = new TextEncoder().encode(
                        payloadJson,
                    ).length;
                    reflectBytes += messageBytes;
                    const perMessageStart = performance.now();
                    const deliveredForMessage = this.publishReflect(
                        syncGroup,
                        channel,
                        payloadJson,
                    );
                    reflectDeliveredCount += deliveredForMessage;
                    // Record reflect metrics per message
                    this.metricsCollector.recordReflect(
                        performance.now() - perMessageStart,
                        messageBytes,
                        deliveredForMessage,
                        !!queuedItem.ack,
                    );

                    // If an acknowledgement was requested for this message, send it now
                    if (queuedItem.ack) {
                        const senderSession =
                            this.activeSessions.get(fromSessionId);
                        if (senderSession) {
                            const ackData = {
                                type: Communication.WebSocket.MessageType
                                    .REFLECT_ACK_RESPONSE,
                                timestamp: Date.now(),
                                requestId: queuedItem.ack.requestId,
                                errorMessage: null,
                                syncGroup,
                                channel,
                                delivered: deliveredForMessage,
                            };
                            const ackParsed =
                                Communication.WebSocket.Z.ReflectAckResponse.safeParse(
                                    ackData,
                                );
                            if (ackParsed.success) {
                                try {
                                    senderSession.ws.send(
                                        JSON.stringify(ackParsed.data),
                                    );
                                } catch {
                                    // ignore ack send errors
                                }
                            }
                        }
                    }
                }
            }
        }
        const reflectProcessingTimeMs = performance.now() - reflectStartTime;

        // Process entity and entity metadata queues for this tick
        const entityGroupMap = this.entityQueues.get(syncGroup);
        const metadataGroupMap = this.entityMetadataQueues.get(syncGroup);

        // Process entity notifications
        let entityProcessingTimeMs = 0;
        if (entityGroupMap) {
            entityStartTime = performance.now();
            // Track unique entity messages by entityName
            const entityMessageKeys = new Set<string>();
            const entityTasks: Array<
                Promise<{
                    notification: EntityNotificationPayload;
                    delivered: number;
                    messageSize: number;
                }>
            > = [];
            for (const notifications of entityGroupMap.values()) {
                for (const notification of notifications) {
                    entityTasks.push(
                        (async () => {
                            const delivered =
                                this.publishEntityChange(notification);
                            const messageSize =
                                JSON.stringify(notification).length;
                            return { notification, delivered, messageSize };
                        })(),
                    );
                }
            }
            const entityResults = await Promise.all(entityTasks);
            for (const {
                notification,
                delivered,
                messageSize,
            } of entityResults) {
                entityMessages++;
                const entityKey = notification.entityName || "";
                if (!entityMessageKeys.has(entityKey)) {
                    entityMessageKeys.add(entityKey);
                    entityUniqueMessages++;
                }
                entityBytes += messageSize;
                entityDeliveredCount += delivered;
            }
            entityProcessingTimeMs = performance.now() - entityStartTime;
        }

        // Process entity metadata notifications
        let metadataProcessingTimeMs = 0;
        if (metadataGroupMap) {
            metadataStartTime = performance.now();
            // Track unique metadata messages by entityName+metadataKey (already deduplicated in queue)
            const metadataMessageKeys = new Set<string>();
            const metadataTasks: Array<
                Promise<{
                    notification: EntityNotificationPayload;
                    delivered: number;
                    messageSize: number;
                }>
            > = [];
            for (const metadataMap of metadataGroupMap.values()) {
                for (const notifications of metadataMap.values()) {
                    for (const notification of notifications) {
                        notification.flushedTime = performance.now();
                        metadataTasks.push(
                            (async () => {
                                const delivered =
                                    await this.publishEntityMetadataChange(
                                        notification,
                                    );
                                const messageSize =
                                    JSON.stringify(notification).length;
                                this.recordMetadataLatencyMetrics(notification);
                                return {
                                    notification,
                                    delivered,
                                    messageSize,
                                };
                            })(),
                        );
                    }
                }
            }
            const metadataResults = await Promise.all(metadataTasks);
            for (const {
                notification,
                delivered,
                messageSize,
            } of metadataResults) {
                metadataMessages++;
                const metadataKey = `${notification.entityName}:${notification.metadataKey}`;
                if (!metadataMessageKeys.has(metadataKey)) {
                    metadataMessageKeys.add(metadataKey);
                    metadataUniqueMessages++;
                }
                metadataBytes += messageSize;
                metadataDeliveredCount += delivered;
            }
            metadataProcessingTimeMs = performance.now() - metadataStartTime;
        }

        // Clear all queues after flush
        this.reflectQueues.delete(syncGroup);
        this.entityQueues.delete(syncGroup);
        this.entityMetadataQueues.delete(syncGroup);

        // Notify that a reflect tick has been flushed (WS sends tick notification)
        if (superUserSql) {
            try {
                const payload = JSON.stringify({
                    syncGroup,
                    totalMessages:
                        reflectMessages + entityMessages + metadataMessages,
                    deliveredCount:
                        reflectDeliveredCount +
                        entityDeliveredCount +
                        metadataDeliveredCount,
                    durationMs: performance.now() - startTime,
                    timestamp: Date.now(),
                });
                await superUserSql`
                    SELECT pg_notify('reflect_tick', ${payload})
                `;
            } catch {}
        }

        // Record endpoint metrics for the flush and tick metrics
        const flushDuration = performance.now() - startTime;
        const rate = this.reflectTickRateMs.get(syncGroup) || 0;
        const success = rate === 0 ? true : flushDuration <= rate;
        const totalBytes = reflectBytes + entityBytes + metadataBytes;
        this.recordEndpointMetrics(
            "WS_REFLECT_FLUSH",
            startTime,
            totalBytes,
            0,
            success,
        );
        this.metricsCollector.recordTick(
            syncGroup,
            flushDuration,
            reflectMessages,
            reflectUniqueMessages,
            reflectBytes,
            reflectDeliveredCount,
            reflectProcessingTimeMs,
            entityMessages,
            entityUniqueMessages,
            entityBytes,
            entityDeliveredCount,
            entityProcessingTimeMs,
            metadataMessages,
            metadataUniqueMessages,
            metadataBytes,
            metadataDeliveredCount,
            metadataProcessingTimeMs,
            rate,
        );
    }

    private async startReflectTickLoops() {
        if (!superUserSql) {
            return;
        }
        // Load sync groups with tick configuration
        try {
            const rows = await superUserSql`
                SELECT general__sync_group, server__tick__rate_ms, server__tick__reflect__enabled
                FROM auth.sync_groups
            `;
            for (const row of rows as Array<
                Pick<
                    Auth.SyncGroup.I_SyncGroup,
                    | "general__sync_group"
                    | "server__tick__rate_ms"
                    | "server__tick__reflect__enabled"
                >
            >) {
                const syncGroup = row.general__sync_group;
                const rate = row.server__tick__rate_ms;
                const enabled = row.server__tick__reflect__enabled !== false;
                if (!enabled) continue;
                if (this.reflectIntervals.has(syncGroup)) continue;
                this.reflectTickRateMs.set(syncGroup, rate);

                BunLogModule({
                    prefix: LOG_PREFIX,
                    message: `Starting tick loop for sync group: ${syncGroup}`,
                    debug: this.DEBUG,
                    suppress: this.SUPPRESS,
                    type: "info",
                    data: {
                        syncGroup,
                        tickRateMs: rate,
                        enabled,
                    },
                });

                const ticker = setInterval(() => {
                    this.flushTickQueues(syncGroup).catch((error) => {
                        BunLogModule({
                            prefix: LOG_PREFIX,
                            message: `Error flushing tick queues for ${syncGroup}`,
                            debug: this.DEBUG,
                            suppress: this.SUPPRESS,
                            type: "error",
                            error,
                        });
                    });
                }, rate);
                this.reflectIntervals.set(syncGroup, ticker);
            }

            // Log all sync groups and their reflect tick status
            const allSyncGroups = rows.map(
                (row: {
                    general__sync_group: string;
                    server__tick__rate_ms: number;
                    server__tick__reflect__enabled: boolean;
                }) => ({
                    syncGroup: row.general__sync_group,
                    reflectEnabled:
                        row.server__tick__reflect__enabled !== false,
                    tickRateMs: row.server__tick__rate_ms,
                }),
            );

            const activeSyncGroups = Array.from(
                this.reflectTickRateMs.entries(),
            );

            BunLogModule({
                prefix: LOG_PREFIX,
                message: "Reflect tick loop initialization completed",
                debug: this.DEBUG,
                suppress: this.SUPPRESS,
                type: "info",
                data: {
                    allSyncGroups,
                    activeReflectTicks: activeSyncGroups.length,
                    totalSyncGroups: allSyncGroups.length,
                },
            });
        } catch (e) {
            BunLogModule({
                prefix: LOG_PREFIX,
                message: "Failed to start reflect tick loops",
                error: e,
                debug: this.DEBUG,
                suppress: this.SUPPRESS,
                type: "error",
            });
        }
    }

    private async startEntityNotificationListeners() {
        if (!legacySuperUserSql || !superUserSql) {
            BunLogModule({
                prefix: LOG_PREFIX,
                message:
                    "Cannot start entity notification listeners without database connections",
                debug: this.DEBUG,
                suppress: this.SUPPRESS,
                type: "warn",
            });
            return;
        }

        try {
            await legacySuperUserSql`LISTEN entity_change`;
            await legacySuperUserSql.listen(
                this.ENTITY_CHANGE_CHANNEL,
                (payload: string) => {
                    void this.handleEntityNotification(payload);
                },
            );
            BunLogModule({
                prefix: LOG_PREFIX,
                message: "Entity change notification listener started",
                debug: this.DEBUG,
                suppress: this.SUPPRESS,
                type: "info",
                data: {
                    channel: this.ENTITY_CHANGE_CHANNEL,
                },
            });
        } catch (error) {
            BunLogModule({
                prefix: LOG_PREFIX,
                message: "Failed to start entity change notification listener",
                error,
                debug: this.DEBUG,
                suppress: this.SUPPRESS,
                type: "error",
            });
        }

        try {
            await legacySuperUserSql`LISTEN entity_metadata_change`;
            await legacySuperUserSql.listen(
                this.ENTITY_METADATA_CHANGE_CHANNEL,
                (payload: string) => {
                    void this.handleEntityMetadataNotification(payload);
                },
            );
            BunLogModule({
                prefix: LOG_PREFIX,
                message: "Entity metadata notification listener started",
                debug: this.DEBUG,
                suppress: this.SUPPRESS,
                type: "info",
                data: {
                    channel: this.ENTITY_METADATA_CHANGE_CHANNEL,
                },
            });
        } catch (error) {
            BunLogModule({
                prefix: LOG_PREFIX,
                message:
                    "Failed to start entity metadata change notification listener",
                error,
                debug: this.DEBUG,
                suppress: this.SUPPRESS,
                type: "error",
            });
        }
    }

    private async handleEntityNotification(payload: string) {
        const receivedAt = performance.now();
        if (!superUserSql) {
            return;
        }

        try {
            const notification = JSON.parse(payload) as EntityDbNotification;
            if (
                notification.resource !== "entity" ||
                !notification.entityName ||
                !notification.operation
            ) {
                return;
            }

            const operation = this.mapDbOperationToCommunication(
                notification.operation,
            );
            if (!operation) {
                return;
            }

            let entityData = notification.data as Record<
                string,
                unknown
            > | null;
            if (
                operation ===
                    Communication.WebSocket.DatabaseOperation.INSERT ||
                operation === Communication.WebSocket.DatabaseOperation.UPDATE
            ) {
                // Notifications have a max payload of 8kb, so if the entity data is not provided, we need to load it from the database
                if (!entityData) {
                    const rows = (await superUserSql`
                    SELECT *
                    FROM entity.entities
                    WHERE general__entity_name = ${notification.entityName}
                    LIMIT 1
                `) as Array<Record<string, unknown>>;
                    entityData = rows?.[0] ?? null;
                    if (!entityData) {
                        BunLogModule({
                            prefix: LOG_PREFIX,
                            message:
                                "Entity notification could not load latest entity data",
                            debug: this.DEBUG,
                            suppress: this.SUPPRESS,
                            type: "warn",
                            data: {
                                entityName: notification.entityName,
                                operation: notification.operation,
                            },
                        });
                        return;
                    }
                }
            } else if (!entityData) {
                entityData =
                    (notification.previous as Record<string, unknown>) ?? null;
            }

            if (!entityData) {
                return;
            }

            const syncGroup =
                (entityData as { group__sync?: string })?.group__sync ??
                notification.syncGroup ??
                (notification.previous as { group__sync?: string })
                    ?.group__sync;

            if (!syncGroup) {
                BunLogModule({
                    prefix: LOG_PREFIX,
                    message:
                        "Entity notification missing sync group, skipping publish",
                    debug: this.DEBUG,
                    suppress: this.SUPPRESS,
                    type: "warn",
                    data: {
                        entityName: notification.entityName,
                        operation: notification.operation,
                    },
                });
                return;
            }

            const resolvedChannel =
                (entityData as { group__channel?: string | null })
                    ?.group__channel ??
                notification.channel ??
                (notification.previous as { group__channel?: string | null })
                    ?.group__channel ??
                null;

            const queuePayload: EntityNotificationPayload = {
                resource: "entity",
                operation,
                entityName: notification.entityName,
                syncGroup,
                channel: resolvedChannel,
                data: entityData,
                previous:
                    notification.previous ??
                    (operation ===
                    Communication.WebSocket.DatabaseOperation.DELETE
                        ? entityData
                        : null),
                replicationEventReceivedTime: receivedAt,
            };

            this.queueEntityChange(queuePayload);
        } catch (error) {
            BunLogModule({
                prefix: LOG_PREFIX,
                message: "Failed to process entity notification payload",
                error,
                debug: this.DEBUG,
                suppress: this.SUPPRESS,
                type: "error",
            });
        }
    }

    private async handleEntityMetadataNotification(payload: string) {
        const receivedAt = performance.now();
        if (!superUserSql) {
            return;
        }

        try {
            const notification = JSON.parse(
                payload,
            ) as EntityMetadataDbNotification;
            if (
                notification.resource !== "entity_metadata" ||
                !notification.entityName ||
                !notification.metadataKey ||
                !notification.operation
            ) {
                return;
            }

            const operation = this.mapDbOperationToCommunication(
                notification.operation,
            );
            if (!operation) {
                return;
            }

            let metadataData = notification.data as Record<
                string,
                unknown
            > | null;

            if (
                operation ===
                    Communication.WebSocket.DatabaseOperation.INSERT ||
                operation === Communication.WebSocket.DatabaseOperation.UPDATE
            ) {
                // Notifications have a max payload of 8kb, so if the metadata data is not provided, we need to load it from the database
                if (!metadataData) {
                    const rows = (await superUserSql`
                    SELECT *
                    FROM entity.entity_metadata
                    WHERE general__entity_name = ${notification.entityName}
                      AND metadata__key = ${notification.metadataKey}
                    LIMIT 1
                `) as Array<Record<string, unknown>>;
                    metadataData = rows?.[0] ?? null;
                    if (!metadataData) {
                        BunLogModule({
                            prefix: LOG_PREFIX,
                            message:
                                "Metadata notification could not load latest metadata row",
                            debug: this.DEBUG,
                            suppress: this.SUPPRESS,
                            type: "warn",
                            data: {
                                entityName: notification.entityName,
                                metadataKey: notification.metadataKey,
                                operation: notification.operation,
                            },
                        });
                        return;
                    }
                }
            } else if (!metadataData) {
                metadataData =
                    (notification.previous as Record<string, unknown>) ?? null;
            }

            if (!metadataData) {
                return;
            }

            const syncGroup =
                (metadataData as { ro__group__sync?: string })
                    ?.ro__group__sync ??
                notification.syncGroup ??
                (notification.previous as { ro__group__sync?: string })
                    ?.ro__group__sync;

            if (!syncGroup) {
                BunLogModule({
                    prefix: LOG_PREFIX,
                    message:
                        "Metadata notification missing sync group, skipping publish",
                    debug: this.DEBUG,
                    suppress: this.SUPPRESS,
                    type: "warn",
                    data: {
                        entityName: notification.entityName,
                        metadataKey: notification.metadataKey,
                        operation: notification.operation,
                    },
                });
                return;
            }

            const resolvedChannel =
                (
                    metadataData as {
                        ro__group__channel?: string | null;
                    }
                )?.ro__group__channel ??
                notification.channel ??
                (
                    notification.previous as {
                        ro__group__channel?: string | null;
                    }
                )?.ro__group__channel ??
                null;

            const queuePayload: EntityNotificationPayload = {
                resource: "entity_metadata",
                operation,
                entityName: notification.entityName,
                metadataKey: notification.metadataKey,
                syncGroup,
                channel: resolvedChannel,
                data: metadataData,
                previous:
                    notification.previous ??
                    (operation ===
                    Communication.WebSocket.DatabaseOperation.DELETE
                        ? metadataData
                        : null),
                replicationEventReceivedTime: receivedAt,
            };

            this.queueEntityMetadataChange(queuePayload);
        } catch (error) {
            BunLogModule({
                prefix: LOG_PREFIX,
                message:
                    "Failed to process entity metadata notification payload",
                error,
                debug: this.DEBUG,
                suppress: this.SUPPRESS,
                type: "error",
            });
        }
    }

    private queueEntityChange(payload: EntityNotificationPayload) {
        if (!payload.entityName) {
            return;
        }

        // Get or create sync group map
        let syncGroupMap = this.entityQueues.get(payload.syncGroup);
        if (!syncGroupMap) {
            syncGroupMap = new Map();
            this.entityQueues.set(payload.syncGroup, syncGroupMap);
        }

        // Coalesce: keep only the latest notification per entity (regardless of channel)
        syncGroupMap.set(payload.entityName, [payload]);
    }

    private queueEntityMetadataChange(payload: EntityNotificationPayload) {
        if (!payload.entityName || !payload.metadataKey) {
            return;
        }

        // Record queued time
        payload.queuedTime = performance.now();

        // Get or create sync group map
        let syncGroupMap = this.entityMetadataQueues.get(payload.syncGroup);
        if (!syncGroupMap) {
            syncGroupMap = new Map();
            this.entityMetadataQueues.set(payload.syncGroup, syncGroupMap);
        }

        // Get or create entity map
        let entityMap = syncGroupMap.get(payload.entityName);
        if (!entityMap) {
            entityMap = new Map();
            syncGroupMap.set(payload.entityName, entityMap);
        }

        // Coalesce: keep only the latest notification per entity+metadataKey (regardless of channel)
        entityMap.set(payload.metadataKey, [payload]);
    }

    private publishEntityChange(payload: EntityNotificationPayload): number {
        if (!payload.entityName || !this.server) {
            return 0;
        }

        const messageData = {
            type: Communication.WebSocket.MessageType.ENTITY_DELIVERY,
            timestamp: Date.now(),
            requestId: payload.entityName,
            errorMessage: null,
            entityName: payload.entityName,
            operation: payload.operation,
            syncGroup: payload.syncGroup,
            channel: payload.channel ?? null,
            data: payload.data,
        };

        const parsed =
            Communication.WebSocket.Z.EntityDelivery.safeParse(messageData);
        if (!parsed.success) {
            return 0;
        }

        const payloadJson = JSON.stringify(parsed.data);
        const payloadChannel = payload.channel ?? null;

        // Always publish to the "all channels" topic
        const allChannelsTopic = this.getEntityTopic(
            payload.syncGroup,
            payload.entityName,
        );
        let delivered = this.server.publish(allChannelsTopic, payloadJson);

        // If a specific channel is provided, also publish to the channel-specific topic
        if (payloadChannel !== null && payloadChannel !== undefined) {
            const channelTopic = this.getEntityTopic(
                payload.syncGroup,
                payload.entityName,
                payloadChannel,
            );
            delivered += this.server.publish(channelTopic, payloadJson);
        }

        return delivered;
    }

    private async publishEntityMetadataChange(
        payload: EntityNotificationPayload,
    ): Promise<number> {
        if (!payload.entityName || !payload.metadataKey || !this.server) {
            return 0;
        }

        // Logical replication already includes the latest row data, so rely on the payload directly
        let fullData = payload.data;

        if (payload.resource === "entity_metadata") {
            const ensuredData =
                (fullData as {
                    ro__group__sync?: string;
                    ro__group__channel?: string | null;
                }) || {};
            fullData = {
                ...(fullData ?? {}),
                ro__group__sync:
                    ensuredData.ro__group__sync ?? payload.syncGroup,
                ro__group__channel:
                    ensuredData.ro__group__channel ?? payload.channel ?? null,
            };
        }

        const messageData = {
            type: Communication.WebSocket.MessageType.ENTITY_METADATA_DELIVERY,
            timestamp: Date.now(),
            requestId: `${payload.entityName}:${payload.metadataKey}`,
            errorMessage: null,
            entityName: payload.entityName,
            metadataKey: payload.metadataKey,
            operation: payload.operation,
            syncGroup: payload.syncGroup,
            channel: payload.channel ?? null,
            data: fullData,
        };

        const parsed =
            Communication.WebSocket.Z.EntityMetadataDelivery.safeParse(
                messageData,
            );
        if (!parsed.success) {
            return 0;
        }

        const payloadJson = JSON.stringify(parsed.data);
        const payloadChannel = payload.channel ?? null;

        // Record published time
        payload.publishedTime = performance.now();

        // Always publish to the "all channels" topic
        const allChannelsTopic = this.getMetadataTopic(
            payload.syncGroup,
            payload.entityName,
            payload.metadataKey,
        );
        let delivered = this.server.publish(allChannelsTopic, payloadJson);

        // Also publish to the generic "all metadata" topic for this entity
        const allMetadataTopic = this.getMetadataTopic(
            payload.syncGroup,
            payload.entityName,
            "__ALL__",
        );
        delivered += this.server.publish(allMetadataTopic, payloadJson);

        // If a specific channel is provided, also publish to the channel-specific topic
        if (payloadChannel !== null && payloadChannel !== undefined) {
            const channelTopic = this.getMetadataTopic(
                payload.syncGroup,
                payload.entityName,
                payload.metadataKey,
                payloadChannel,
            );
            delivered += this.server.publish(channelTopic, payloadJson);

            // And the generic channel-specific topic
            const allMetadataChannelTopic = this.getMetadataTopic(
                payload.syncGroup,
                payload.entityName,
                "__ALL__",
                payloadChannel,
            );
            delivered += this.server.publish(
                allMetadataChannelTopic,
                payloadJson,
            );
        }

        return delivered;
    }

    private recordMetadataLatencyMetrics(
        payload: EntityNotificationPayload,
    ): void {
        // Only track metrics for metadata updates
        if (payload.resource !== "entity_metadata" || !payload.metadataKey) {
            return;
        }

        // Extract pingId if this is a ping test
        let pingId: number | undefined;
        try {
            const data = payload.data as {
                metadata__jsonb?:
                    | string
                    | { pingId?: number; timestamp?: number };
            };
            if (data?.metadata__jsonb) {
                const parsed =
                    typeof data.metadata__jsonb === "string"
                        ? JSON.parse(data.metadata__jsonb)
                        : data.metadata__jsonb;
                if (parsed && typeof parsed.pingId === "number") {
                    pingId = parsed.pingId;
                }
            }
        } catch {
            // Ignore parsing errors
        }

        // Calculate latency stages
        const replicationToQueued =
            payload.replicationEventReceivedTime && payload.queuedTime
                ? payload.queuedTime - payload.replicationEventReceivedTime
                : undefined;
        const queuedToFlushed =
            payload.queuedTime && payload.flushedTime
                ? payload.flushedTime - payload.queuedTime
                : undefined;
        const flushedToPublished =
            payload.flushedTime && payload.publishedTime
                ? payload.publishedTime - payload.flushedTime
                : undefined;
        const totalLatency =
            payload.replicationEventReceivedTime && payload.publishedTime
                ? payload.publishedTime - payload.replicationEventReceivedTime
                : undefined;

        // Record metrics
        this.metricsCollector.recordMetadataLatency({
            pingId,
            entityName: payload.entityName,
            metadataKey: payload.metadataKey,
            replicationToQueued,
            queuedToFlushed,
            flushedToPublished,
            totalLatency,
        });
    }

    // Helper method to record endpoint metrics
    private recordEndpointMetrics(
        endpoint: string,
        startTime: number,
        requestSize: number,
        responseSize: number,
        success: boolean,
    ) {
        const duration = performance.now() - startTime;
        this.metricsCollector.recordEndpoint(
            endpoint,
            duration,
            requestSize,
            responseSize,
            success,
        );
    }

    private mapDbOperationToCommunication(
        operation?: DbNotificationOperation | string | null,
    ): Communication.WebSocket.DatabaseOperation | null {
        switch ((operation ?? "").toString().toLowerCase()) {
            case "insert":
                return Communication.WebSocket.DatabaseOperation.INSERT;
            case "update":
                return Communication.WebSocket.DatabaseOperation.UPDATE;
            case "delete":
                return Communication.WebSocket.DatabaseOperation.DELETE;
            default:
                return null;
        }
    }

    // ACL Service instance
    private aclService: AclService | null = null;

    private CONNECTION_HEARTBEAT_INTERVAL = 500;
    private DEBUG =
        serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_WS_MANAGER_DEBUG;
    private SUPPRESS =
        serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_WS_MANAGER_SUPPRESS;



    // Wrapper helpers to the ACL service
    private async warmAgentAcl(agentId: string) {
        await this.aclService?.warmAgentAcl(agentId);
        // Sync reflect subscriptions for all sessions of this agent
        for (const session of this.activeSessions.values()) {
            if (session.agentId === agentId) {
                this.syncReflectSubscriptionsForSession(session);
            }
        }
    }
    private canRead(agentId: string, syncGroup: string): boolean {
        return !!this.aclService?.canRead(agentId, syncGroup);
    }
    private canUpdate(agentId: string, syncGroup: string): boolean {
        // Treat "update" as write permission required to publish into a sync group
        return !!this.aclService?.canUpdate?.(agentId, syncGroup);
    }

    private canInsert(agentId: string, syncGroup: string): boolean {
        return !!this.aclService?.canInsert?.(agentId, syncGroup);
    }

    async initialize() {
        BunLogModule({
            prefix: LOG_PREFIX,
            message: "Initializing World API WS Manager",
            debug: this.DEBUG,
            suppress: this.SUPPRESS,
            type: "info",
        });

        try {
            legacySuperUserSql = await BunPostgresClientModule.getInstance({
                debug: this.DEBUG,
                suppress: this.SUPPRESS,
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
                    publications: "entity_pub",
                },
            });
            _legacyProxyUserSql = await BunPostgresClientModule.getInstance({
                debug: this.DEBUG,
                suppress: this.SUPPRESS,
            }).getLegacyProxyClient({
                postgres: {
                    host: serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_CONTAINER_NAME,
                    port: serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_PORT_CONTAINER_BIND_EXTERNAL,
                    database:
                        serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_DATABASE,
                    username:
                        serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_AGENT_PROXY_USER_USERNAME,
                    password:
                        serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_AGENT_PROXY_USER_PASSWORD,
                },
            });
            superUserSql = await BunPostgresClientModule.getInstance({
                debug: this.DEBUG,
                suppress: this.SUPPRESS,
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
            proxyUserSql = await BunPostgresClientModule.getInstance({
                debug: this.DEBUG,
                suppress: this.SUPPRESS,
            }).getProxyClient({
                postgres: {
                    host: serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_CONTAINER_NAME,
                    port: serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_PORT_CONTAINER_BIND_EXTERNAL,
                    database:
                        serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_DATABASE,
                    username:
                        serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_AGENT_PROXY_USER_USERNAME,
                    password:
                        serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_AGENT_PROXY_USER_PASSWORD,
                },
            });

            // Initialize ACL Service
            if (superUserSql) {
                this.aclService = new AclService({
                    db: superUserSql,
                    legacyDb: legacySuperUserSql,
                });
                this.unregisterAclWarmCallback =
                    this.aclService.registerWarmCallback((agentId) => {
                        // Sync reflect subscriptions for all sessions of this agent
                        for (const session of this.activeSessions.values()) {
                            if (session.agentId === agentId) {
                                this.syncReflectSubscriptionsForSession(
                                    session,
                                );
                            }
                        }
                    });
                await this.aclService.startRoleChangeListener();
            }
            // Start reflect tick loops to flush queued reflect messages per sync group
            await this.startReflectTickLoops();
            await this.startEntityNotificationListeners();
        } catch (error) {
            BunLogModule({
                prefix: LOG_PREFIX,
                message: "Failed to initialize DB connection",
                error: error,
                debug: this.DEBUG,
                suppress: this.SUPPRESS,
                type: "error",
            });
            return;
        }

        // Start server
        this.server = Bun.serve({
            hostname: "0.0.0.0",
            port: 3020,
            development: this.DEBUG,

            // #region API -> HTTP Routes
            fetch: async (req: Request, server: Server<WebSocketData>) => {
                try {
                    if (!superUserSql || !proxyUserSql) {
                        BunLogModule({
                            prefix: LOG_PREFIX,
                            message: "No database connection available",
                            debug: this.DEBUG,
                            suppress: this.SUPPRESS,
                            type: "error",
                        });
                        return new Response("Internal server error", {
                            status: 500,
                        });
                    }

                    const url = new URL(req.url);

                    // Handle CORS preflight requests
                    if (req.method === "OPTIONS") {
                        const response = new Response(null, { status: 204 });
                        return this.addCorsHeaders(response, req);
                    }

                    // Speed Test Download
                    if (
                        url.pathname === "/world/rest/ws/speedtest/download" &&
                        req.method === "GET"
                    ) {
                        const sizeStr = url.searchParams.get("size");
                        let size = sizeStr ? parseInt(sizeStr) : 10 * 1024 * 1024; // Default 10MB
                        // Cap at 100MB to prevent abuse
                        if (size > 100 * 1024 * 1024) size = 100 * 1024 * 1024;
                        if (size < 0) size = 1024;

                        const buffer = new Uint8Array(size); // Zero-filled by default
                        
                        const response = new Response(buffer, {
                            status: 200,
                            headers: {
                                "Content-Type": "application/octet-stream",
                                "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
                                "Pragma": "no-cache",
                                "Expires": "0",
                            }
                        });
                        return this.addCorsHeaders(response, req);
                    }

                    // Speed Test Ping
                    if (
                        url.pathname === "/world/rest/ws/speedtest/ping" &&
                        req.method === "GET"
                    ) {
                        const response = new Response("pong", {
                            status: 200,
                            headers: {
                                "Content-Type": "text/plain",
                                "Cache-Control": "no-cache",
                            },
                        });
                        return this.addCorsHeaders(response, req);
                    }

                    // Speed Test Upload
                    if (
                        url.pathname === "/world/rest/ws/speedtest/upload" &&
                        req.method === "POST"
                    ) {
                        // Consume the body stream to ensure we measure the full upload time
                        // without buffering the entire file in memory
                        if (req.body) {
                            const reader = req.body.getReader();
                            while (true) {
                                const { done } = await reader.read();
                                if (done) break;
                            }
                        }
                        
                        const response = new Response(JSON.stringify({ status: "ok" }), {
                            status: 200,
                            headers: {
                                "Content-Type": "application/json",
                            }
                        });
                        return this.addCorsHeaders(response, req);
                    }

                    // Validate-upgrade diagnostic endpoint: must run BEFORE DB guard to return JSON even if DB is down
                    if (
                        url.pathname.startsWith(
                            Communication.REST.Endpoint.WS_UPGRADE_VALIDATE
                                .path,
                        ) &&
                        req.method ===
                            Communication.REST.Endpoint.WS_UPGRADE_VALIDATE
                                .method
                    ) {
                        const token =
                            url.searchParams.get("token") || undefined;
                        const provider =
                            url.searchParams.get("provider") || undefined;

                        if (!superUserSql || !proxyUserSql) {
                            const response = Response.json(
                                Communication.REST.Endpoint.WS_UPGRADE_VALIDATE.createError(
                                    Communication.REST.E_ErrorCode
                                        .WS_UPGRADE_DB_UNAVAILABLE,
                                    "Database unavailable",
                                ),
                            );
                            return this.addCorsHeaders(response, req);
                        }

                        if (!token) {
                            const response = Response.json(
                                Communication.REST.Endpoint.WS_UPGRADE_VALIDATE.createError(
                                    Communication.REST.E_ErrorCode
                                        .WS_UPGRADE_MISSING_TOKEN,
                                    "Missing authentication token",
                                ),
                            );
                            return this.addCorsHeaders(response, req);
                        }

                        if (!provider) {
                            const response = Response.json(
                                Communication.REST.Endpoint.WS_UPGRADE_VALIDATE.createError(
                                    Communication.REST.E_ErrorCode
                                        .WS_UPGRADE_MISSING_PROVIDER,
                                    "Missing authentication provider",
                                ),
                            );
                            return this.addCorsHeaders(response, req);
                        }

                        let jwtValidationResult: {
                            isValid: boolean;
                            errorReason?: string;
                            sessionId: string;
                            agentId: string;
                        };
                        try {
                            jwtValidationResult = await validateJWT({
                                superUserSql,
                                provider,
                                token,
                            });
                        } catch (e) {
                            const response = Response.json(
                                Communication.REST.Endpoint.WS_UPGRADE_VALIDATE.createError(
                                    Communication.REST.E_ErrorCode
                                        .WS_UPGRADE_JWT_INVALID,
                                    `JWT validation failed: ${e instanceof Error ? e.message : String(e)}`,
                                ),
                            );
                            return this.addCorsHeaders(response, req);
                        }

                        if (!jwtValidationResult.isValid) {
                            const response = Response.json(
                                Communication.REST.Endpoint.WS_UPGRADE_VALIDATE.createError(
                                    Communication.REST.E_ErrorCode
                                        .WS_UPGRADE_JWT_INVALID,
                                    jwtValidationResult.errorReason ||
                                        "JWT validation failed",
                                ),
                            );
                            return this.addCorsHeaders(response, req);
                        }

                        try {
                            const sessionValidationResult = await superUserSql<
                                [{ agent_id: string }]
                            >`
                                SELECT * FROM auth.validate_session_id(${jwtValidationResult.sessionId}::UUID) as agent_id
                            `;

                            if (!sessionValidationResult[0].agent_id) {
                                const response = Response.json(
                                    Communication.REST.Endpoint.WS_UPGRADE_VALIDATE.createError(
                                        Communication.REST.E_ErrorCode
                                            .WS_UPGRADE_SESSION_INVALID,
                                        `Invalid session ID: ${jwtValidationResult.sessionId}`,
                                    ),
                                );
                                return this.addCorsHeaders(response, req);
                            }
                        } catch (error) {
                            const response = Response.json(
                                Communication.REST.Endpoint.WS_UPGRADE_VALIDATE.createError(
                                    Communication.REST.E_ErrorCode
                                        .WS_UPGRADE_SESSION_INVALID,
                                    `Session validation failed for session ${jwtValidationResult.sessionId}: ${error instanceof Error ? error.message : String(error)}`,
                                ),
                            );
                            return this.addCorsHeaders(response, req);
                        }

                        const existingSession = this.activeSessions.get(
                            jwtValidationResult.sessionId,
                        );
                        if (existingSession) {
                            const response = Response.json(
                                Communication.REST.Endpoint.WS_UPGRADE_VALIDATE.createError(
                                    Communication.REST.E_ErrorCode
                                        .WS_UPGRADE_SESSION_ALREADY_CONNECTED,
                                    `Session ${jwtValidationResult.sessionId} is already connected`,
                                ),
                            );
                            return this.addCorsHeaders(response, req);
                        }

                        const okResponse = Response.json(
                            Communication.REST.Endpoint.WS_UPGRADE_VALIDATE.createSuccess(
                                {
                                    ok: true,
                                    reason: "OK",
                                    details: {
                                        agentId: jwtValidationResult.agentId,
                                        sessionId:
                                            jwtValidationResult.sessionId,
                                    },
                                },
                            ),
                        );
                        return this.addCorsHeaders(okResponse, req);
                    }

                    // Handle stats (moved to official REST endpoint)
                    if (
                        url.pathname.startsWith(
                            Communication.REST.Endpoint.WS_STATS.path,
                        ) &&
                        req.method ===
                            Communication.REST.Endpoint.WS_STATS.method
                    ) {
                        BunLogModule({
                            prefix: LOG_PREFIX,
                            message: "Stats endpoint hit",
                            debug: this.DEBUG,
                            suppress: this.SUPPRESS,
                            type: "debug",
                            data: {
                                pathname: url.pathname,
                                method: req.method,
                                expectedPath:
                                    Communication.REST.Endpoint.WS_STATS.path,
                                expectedMethod:
                                    Communication.REST.Endpoint.WS_STATS.method,
                            },
                        });

                        const requestIP =
                            req.headers.get("x-forwarded-for")?.split(",")[0] ||
                            server.requestIP(req)?.address ||
                            "";

                        // Log the detected IP for debugging
                        BunLogModule({
                            prefix: LOG_PREFIX,
                            message: `Stats endpoint access attempt from IP: ${requestIP}`,
                            debug: this.DEBUG,
                            suppress: this.SUPPRESS,
                            type: "debug",
                            data: {
                                requestIP,
                                xForwardedFor:
                                    req.headers.get("x-forwarded-for"),
                                serverRequestIP: server.requestIP(req)?.address,
                            },
                        });

                        // Allow access from localhost and Docker internal networks
                        const isLocalhost =
                            requestIP === "127.0.0.1" ||
                            requestIP === "::1" ||
                            requestIP === "localhost";
                        const isDockerInternal =
                            requestIP.startsWith("172.") ||
                            requestIP.startsWith("192.168.") ||
                            requestIP.startsWith("10.") ||
                            requestIP === "::ffff:127.0.0.1";

                        BunLogModule({
                            prefix: LOG_PREFIX,
                            message: `Stats endpoint IP check: ${requestIP}, isLocalhost: ${isLocalhost}, isDockerInternal: ${isDockerInternal}`,
                            debug: this.DEBUG,
                            suppress: this.SUPPRESS,
                            type: "debug",
                        });

                        if (!isLocalhost && !isDockerInternal) {
                            BunLogModule({
                                prefix: LOG_PREFIX,
                                message: `Stats endpoint access denied for IP: ${requestIP}`,
                                debug: this.DEBUG,
                                suppress: this.SUPPRESS,
                                type: "debug",
                            });
                            const response = Response.json(
                                Communication.REST.Endpoint.WS_STATS.createError(
                                    "Forbidden.",
                                ),
                            );
                            return this.addCorsHeaders(response, req);
                        }

                        // Record current system metrics before gathering stats
                        const currentMemory = process.memoryUsage();
                        const currentCpu = process.cpuUsage();
                        const dbConnectionCount =
                            Number(!!superUserSql) + Number(!!proxyUserSql);

                        this.metricsCollector.recordSystemMetrics(
                            currentCpu,
                            currentMemory,
                            this.activeSessions.size,
                            dbConnectionCount,
                        );

                        // Gather stats information
                        const windowSecParam =
                            url.searchParams.get("windowSec");
                        const windowSec = windowSecParam
                            ? Math.max(1, Math.min(300, Number(windowSecParam)))
                            : 60;
                        const activityMetrics =
                            this.metricsCollector.getActivityMetrics(windowSec);
                        const systemMetrics =
                            this.metricsCollector.getSystemMetrics(
                                !!superUserSql && !!proxyUserSql,
                            );

                        BunLogModule({
                            prefix: LOG_PREFIX,
                            message:
                                "Stats endpoint gathering database pool stats",
                            debug: this.DEBUG,
                            suppress: this.SUPPRESS,
                            type: "debug",
                        });

                        let poolStats: Record<string, unknown>;
                        try {
                            const poolPromise =
                                BunPostgresClientModule.getInstance({
                                    debug: this.DEBUG,
                                    suppress: this.SUPPRESS,
                                }).getDatabasePoolStats();

                            // Prevent stats endpoint from hanging if DB is slow/unavailable
                            poolStats = (await Promise.race([
                                poolPromise,
                                new Promise<Record<string, unknown>>(
                                    (resolve) =>
                                        setTimeout(() => resolve({}), 750),
                                ),
                            ])) as Record<string, unknown>;

                            BunLogModule({
                                prefix: LOG_PREFIX,
                                message:
                                    "Stats endpoint database pool stats gathered",
                                debug: this.DEBUG,
                                suppress: this.SUPPRESS,
                                type: "debug",
                            });
                        } catch (error) {
                            BunLogModule({
                                prefix: LOG_PREFIX,
                                message:
                                    "Stats endpoint error gathering pool stats",
                                debug: this.DEBUG,
                                suppress: this.SUPPRESS,
                                type: "error",
                                error: error,
                            });
                            poolStats = {}; // Provide empty fallback
                        }

                        BunLogModule({
                            prefix: LOG_PREFIX,
                            message: "Stats endpoint generating response",
                            debug: this.DEBUG,
                            suppress: this.SUPPRESS,
                            type: "debug",
                        });

                        const response = Response.json(
                            Communication.REST.Endpoint.WS_STATS.createSuccess({
                                uptime: process.uptime(),
                                connections: systemMetrics.connections,
                                database: {
                                    ...systemMetrics.database,
                                    pool: poolStats,
                                },
                                memory: systemMetrics.memory,
                                cpu: systemMetrics.cpu,
                                queries: this.metricsCollector.getMetrics(),
                                reflect:
                                    this.metricsCollector.getReflectMetrics(),
                                endpoints:
                                    this.metricsCollector.getEndpointMetrics(),
                                ticks: this.metricsCollector.getTickMetrics(),
                                activity: activityMetrics,
                                metadataLatency:
                                    this.metricsCollector.getMetadataLatencyMetrics(),
                            }),
                        );

                        BunLogModule({
                            prefix: LOG_PREFIX,
                            message: "Stats endpoint returning response",
                            debug: this.DEBUG,
                            suppress: this.SUPPRESS,
                            type: "debug",
                            data: {
                                responseStatus: response.status,
                                responseHeaders: response.headers.toJSON(),
                                hasBody: !!response.body,
                            },
                        });

                        const corsResponse = this.addCorsHeaders(response, req);

                        BunLogModule({
                            prefix: LOG_PREFIX,
                            message: "Stats endpoint CORS response prepared",
                            debug: this.DEBUG,
                            suppress: this.SUPPRESS,
                            type: "debug",
                            data: {
                                corsResponseStatus: corsResponse.status,
                                corsResponseHeaders:
                                    corsResponse.headers.toJSON(),
                            },
                        });

                        return corsResponse;
                    }

                    // Handle WebSocket upgrade
                    if (
                        url.pathname.startsWith(
                            Communication.REST.Endpoint.WS_UPGRADE_REQUEST.path,
                        ) &&
                        req.method ===
                            Communication.REST.Endpoint.WS_UPGRADE_REQUEST
                                .method
                    ) {
                        const upgradeStart = performance.now();
                        const url = new URL(req.url);
                        const token = url.searchParams.get("token");
                        const provider = url.searchParams.get("provider");

                        BunLogModule({
                            prefix: LOG_PREFIX,
                            message: "WS upgrade request received",
                            debug: this.DEBUG,
                            suppress: this.SUPPRESS,
                            type: "info",
                            data: {
                                pathname: url.pathname,
                                hasToken: !!token,
                                hasProvider: !!provider,
                            },
                        });

                        // Handle missing token first
                        if (!token) {
                            BunLogModule({
                                prefix: LOG_PREFIX,
                                message: "No token found in query parameters",
                                debug: this.DEBUG,
                                suppress: this.SUPPRESS,
                                type: "info",
                            });
                            return new Response(
                                "Authentication required: No token provided",
                                {
                                    status: 401,
                                },
                            );
                        }

                        // Handle missing provider
                        if (!provider) {
                            BunLogModule({
                                prefix: LOG_PREFIX,
                                message:
                                    "No provider found in query parameters",
                                debug: this.DEBUG,
                                suppress: this.SUPPRESS,
                                type: "info",
                            });
                            return new Response("Provider required", {
                                status: 401,
                            });
                        }

                        const jwtStart = performance.now();
                        const jwtValidationResult = await validateJWT({
                            superUserSql,
                            provider,
                            token,
                        });
                        const jwtMs = performance.now() - jwtStart;

                        if (!jwtValidationResult.isValid) {
                            BunLogModule({
                                prefix: LOG_PREFIX,
                                message: `Token JWT validation failed: ${jwtValidationResult.errorReason}`,
                                debug: this.DEBUG,
                                suppress: this.SUPPRESS,
                                type: "info",
                                data: {
                                    provider,
                                    jwtMs,
                                },
                            });
                            return new Response(
                                `Invalid token: ${jwtValidationResult.errorReason}`,
                                {
                                    status: 401,
                                },
                            );
                        }

                        const sessionStart = performance.now();
                        const sessionValidationResult = await superUserSql<
                            [{ agent_id: string }]
                        >`
                                SELECT * FROM auth.validate_session_id(${jwtValidationResult.sessionId}::UUID) as agent_id
                            `;
                        const sessionMs = performance.now() - sessionStart;

                        BunLogModule({
                            prefix: LOG_PREFIX,
                            message: "WS session validated",
                            debug: this.DEBUG,
                            suppress: this.SUPPRESS,
                            type: "info",
                            data: {
                                sessionId: jwtValidationResult.sessionId,
                                agentId: jwtValidationResult.agentId,
                                sessionMs,
                            },
                        });

                        if (!sessionValidationResult[0].agent_id) {
                            BunLogModule({
                                prefix: LOG_PREFIX,
                                message: "WS Upgrade Session validation failed",
                                debug: this.DEBUG,
                                suppress: this.SUPPRESS,
                                type: "info",
                                data: {
                                    sessionMs,
                                },
                            });
                            return new Response("Invalid session", {
                                status: 401,
                            });
                        }

                        // Enforce hard limit: only one active WebSocket per session
                        const existingSession = this.activeSessions.get(
                            jwtValidationResult.sessionId,
                        );
                        if (existingSession) {
                            BunLogModule({
                                prefix: LOG_PREFIX,
                                message:
                                    "Rejecting WebSocket upgrade: session already connected",
                                debug: this.DEBUG,
                                suppress: this.SUPPRESS,
                                type: "info",
                                data: {
                                    sessionId: jwtValidationResult.sessionId,
                                    agentId: jwtValidationResult.agentId,
                                },
                            });
                            return new Response("Session already connected", {
                                status: 409, // Conflict - resource already exists
                            });
                        }

                        // Only attempt upgrade if validation passes
                        const upgradeAttemptStart = performance.now();
                        const upgraded = server.upgrade(req, {
                            data: {
                                token,
                                agentId: jwtValidationResult.agentId,
                                sessionId: jwtValidationResult.sessionId,
                            },
                        });
                        const upgradeAttemptMs =
                            performance.now() - upgradeAttemptStart;

                        if (!upgraded) {
                            BunLogModule({
                                prefix: LOG_PREFIX,
                                message: "WebSocket upgrade failed",
                                debug: this.DEBUG,
                                data: {
                                    token,
                                    agentId: jwtValidationResult.agentId,
                                    sessionId: jwtValidationResult.sessionId,
                                    jwtMs,
                                    sessionMs,
                                    upgradeAttemptMs,
                                    totalMs: performance.now() - upgradeStart,
                                },
                                suppress: this.SUPPRESS,
                                type: "error",
                            });
                            return new Response("WebSocket upgrade failed", {
                                status: 500,
                            });
                        }

                        BunLogModule({
                            prefix: LOG_PREFIX,
                            message: "WebSocket upgrade succeeded",
                            debug: this.DEBUG,
                            suppress: this.SUPPRESS,
                            type: "info",
                            data: {
                                agentId: jwtValidationResult.agentId,
                                sessionId: jwtValidationResult.sessionId,
                                jwtMs,
                                sessionMs,
                                upgradeAttemptMs,
                                totalMs: performance.now() - upgradeStart,
                            },
                        });

                        return undefined;
                    }

                    // Handle 404
                    BunLogModule({
                        message: "404 Not Found",
                        debug: true, // Force debug for troubleshooting
                        suppress: false,
                        type: "info",
                        prefix: LOG_PREFIX,
                        data: {
                            pathname: url.pathname,
                            method: req.method,
                        },
                    });

                    const response = new Response("Not Found", { status: 404 });
                    return this.addCorsHeaders(response, req);
                } catch (error) {
                    BunLogModule({
                        type: "error",
                        message: "Unexpected error in fetch handler",
                        error: error,
                        suppress: this.SUPPRESS,
                        debug: true, // Force debug for troubleshooting
                        prefix: LOG_PREFIX,
                        data: {
                            url: req.url,
                            method: req.method,
                            error:
                                error instanceof Error
                                    ? error.message
                                    : String(error),
                            stack:
                                error instanceof Error
                                    ? error.stack
                                    : undefined,
                        },
                    });
                    const response = new Response("Internal server error", {
                        status: 500,
                    });
                    return this.addCorsHeaders(response, req);
                }
            },
            // #endregion

            // #region API -> WS Routes
            websocket: {
                message: async (
                    ws: ServerWebSocket<WebSocketData>,
                    message: string,
                ) => {
                    const receivedAt = performance.now();
                    BunLogModule({
                        prefix: LOG_PREFIX,
                        message: "WS message received",
                        suppress: this.SUPPRESS,
                        debug: this.DEBUG,
                        type: "debug",
                        data: {
                            bytes: new TextEncoder().encode(message).length,
                            sessionId: ws.data.sessionId,
                            agentId: ws.data.agentId,
                        },
                    });
                    let data: Communication.WebSocket.Message | undefined;

                    if (!superUserSql || !proxyUserSql) {
                        BunLogModule({
                            message: "No database connections available",
                            suppress: this.SUPPRESS,
                            debug: this.DEBUG,
                            type: "error",
                        });
                        return;
                    }

                    try {
                        // Session validation
                        const sessionToken = this.tokenMap.get(ws);
                        const sessionId = this.wsToSessionMap.get(ws);
                        const session = sessionId
                            ? this.activeSessions.get(sessionId)
                            : undefined;

                        // Parse message
                        data = JSON.parse(
                            message,
                        ) as Communication.WebSocket.Message;

                        BunLogModule({
                            prefix: LOG_PREFIX,
                            message: "WS message parsed",
                            suppress: this.SUPPRESS,
                            debug: this.DEBUG,
                            type: "debug",
                            data: {
                                type: data.type,
                                requestId: data?.requestId,
                                parseMs: performance.now() - receivedAt,
                            },
                        });

                        // Zod-validate incoming WS message
                        const parsed =
                            Communication.WebSocket.Z.AnyMessage.safeParse(
                                data,
                            );
                        if (!parsed.success) {
                            const requestId = data?.requestId ?? "";
                            const errorMessageData = {
                                type: Communication.WebSocket.MessageType
                                    .GENERAL_ERROR_RESPONSE,
                                timestamp: Date.now(),
                                requestId,
                                errorMessage: "Invalid message format",
                            };
                            const errorParsed =
                                Communication.WebSocket.Z.GeneralErrorResponse.safeParse(
                                    errorMessageData,
                                );
                            if (errorParsed.success) {
                                ws.send(JSON.stringify(errorParsed.data));
                            }
                            BunLogModule({
                                prefix: LOG_PREFIX,
                                message: "WS message validation failed",
                                suppress: this.SUPPRESS,
                                debug: this.DEBUG,
                                type: "info",
                                data: {
                                    requestId,
                                    elapsedMs: performance.now() - receivedAt,
                                },
                            });
                            return;
                        }

                        if (!sessionToken || !sessionId || !session) {
                            const errorMessageData = {
                                type: Communication.WebSocket.MessageType
                                    .GENERAL_ERROR_RESPONSE,
                                timestamp: Date.now(),
                                requestId: parsed.data.requestId,
                                errorMessage: "Invalid session",
                            };
                            const errorParsed =
                                Communication.WebSocket.Z.GeneralErrorResponse.safeParse(
                                    errorMessageData,
                                );
                            if (errorParsed.success) {
                                ws.send(JSON.stringify(errorParsed.data));
                            }
                            ws.close(1000, "Invalid session");
                            BunLogModule({
                                prefix: LOG_PREFIX,
                                message: "WS invalid session on message",
                                suppress: this.SUPPRESS,
                                debug: this.DEBUG,
                                type: "info",
                                data: {
                                    requestId: parsed.data.requestId,
                                    elapsedMs: performance.now() - receivedAt,
                                },
                            });
                            return;
                        }

                        // Handle different message types
                        switch (data.type) {
                            case Communication.WebSocket.MessageType
                                .QUERY_REQUEST: {
                                const typedRequest =
                                    data as Communication.WebSocket.QueryRequestMessage;

                                // Metrics tracking
                                const startTime = performance.now();
                                const requestSize = new TextEncoder().encode(
                                    message,
                                ).length;
                                let responseSize = 0;
                                let success = false;

                                try {
                                    await proxyUserSql?.begin(async (tx) => {
                                        // First set agent context
                                        await tx`SELECT auth.set_agent_context_from_agent_id(${session.agentId}::UUID)`;

                                        const results = await tx.unsafe(
                                            typedRequest.query,
                                            typedRequest.parameters || [],
                                        );

                                        const responseData = {
                                            type: Communication.WebSocket
                                                .MessageType.QUERY_RESPONSE,
                                            timestamp: Date.now(),
                                            requestId: typedRequest.requestId,
                                            errorMessage:
                                                typedRequest.errorMessage,
                                            result: results,
                                        };

                                        const responseParsed =
                                            Communication.WebSocket.Z.QueryResponse.safeParse(
                                                responseData,
                                            );
                                        if (!responseParsed.success) {
                                            throw new Error(
                                                `Invalid query response format: ${responseParsed.error.message}`,
                                            );
                                        }

                                        const responseString = JSON.stringify(
                                            responseParsed.data,
                                        );
                                        responseSize = new TextEncoder().encode(
                                            responseString,
                                        ).length;
                                        success = true;

                                        ws.send(responseString);
                                        BunLogModule({
                                            prefix: LOG_PREFIX,
                                            message: "WS QUERY_REQUEST handled",
                                            debug: this.DEBUG,
                                            suppress: this.SUPPRESS,
                                            type: "debug",
                                            data: {
                                                requestId:
                                                    typedRequest.requestId,
                                                durationMs:
                                                    performance.now() -
                                                    receivedAt,
                                                requestSize,
                                                responseSize,
                                            },
                                        });
                                    });
                                } catch (error) {
                                    // Improved error handling with more structured information
                                    const errorMessage =
                                        error instanceof Error
                                            ? error.message
                                            : String(error);

                                    BunLogModule({
                                        message: `Query failed: ${errorMessage}`,
                                        debug: this.DEBUG,
                                        suppress: this.SUPPRESS,
                                        type: "error",
                                        prefix: LOG_PREFIX,
                                        data: {
                                            error,
                                            query: typedRequest.query,
                                        },
                                    });

                                    const errorResponseData: Communication.WebSocket.QueryResponseMessage =
                                        {
                                            type: Communication.WebSocket
                                                .MessageType.QUERY_RESPONSE,
                                            timestamp: Date.now(),
                                            requestId: typedRequest.requestId,
                                            errorMessage,
                                            result: [],
                                        };

                                    const errorResponseParsed =
                                        Communication.WebSocket.Z.QueryResponse.safeParse(
                                            errorResponseData,
                                        );
                                    if (!errorResponseParsed.success) {
                                        throw new Error(
                                            `Invalid error response format: ${errorResponseParsed.error.message}`,
                                        );
                                    }

                                    const errorResponseString = JSON.stringify(
                                        errorResponseParsed.data,
                                    );
                                    responseSize = new TextEncoder().encode(
                                        errorResponseString,
                                    ).length;
                                    success = false;

                                    ws.send(errorResponseString);
                                    BunLogModule({
                                        prefix: LOG_PREFIX,
                                        message: "WS QUERY_REQUEST error",
                                        debug: this.DEBUG,
                                        suppress: this.SUPPRESS,
                                        type: "info",
                                        data: {
                                            requestId: typedRequest.requestId,
                                            durationMs:
                                                performance.now() - receivedAt,
                                            requestSize,
                                            responseSize,
                                            errorMessage,
                                        },
                                    });
                                } finally {
                                    // Record metrics
                                    this.recordEndpointMetrics(
                                        "WS_QUERY_REQUEST",
                                        startTime,
                                        requestSize,
                                        responseSize,
                                        success,
                                    );
                                }
                                break;
                            }

                            case Communication.WebSocket.MessageType
                                .ENTITY_CHANNEL_SUBSCRIBE_REQUEST: {
                                const typedRequest =
                                    data as Communication.WebSocket.EntityChannelSubscribeRequestMessage;

                                const startTime = performance.now();
                                const requestSize = new TextEncoder().encode(
                                    message,
                                ).length;
                                let responseSize = 0;
                                let success = false;
                                const entityName =
                                    typedRequest.entityName.trim();
                                const channel =
                                    typedRequest.channel === undefined
                                        ? null
                                        : typedRequest.channel?.trim() || null;

                                try {
                                    if (!entityName) {
                                        throw new Error(
                                            "entityName is required",
                                        );
                                    }

                                    if (
                                        !this.aclService?.isWarmed(
                                            session.agentId,
                                        )
                                    ) {
                                        await this.warmAgentAcl(
                                            session.agentId,
                                        ).catch(() => {});
                                    }

                                    // Get the entity's syncGroup from the database
                                    if (!superUserSql) {
                                        throw new Error(
                                            "Database connection not available",
                                        );
                                    }

                                    const entityResult = await superUserSql<
                                        Array<{ group__sync: string }>
                                    >`
                                        SELECT group__sync
                                        FROM entity.entities
                                        WHERE general__entity_name = ${entityName}
                                        LIMIT 1
                                    `;

                                    if (entityResult.length === 0) {
                                        throw new Error(
                                            `Entity not found: ${entityName}`,
                                        );
                                    }

                                    const syncGroup =
                                        entityResult[0].group__sync;

                                    // Check if user can read this syncGroup
                                    if (
                                        !this.canRead(
                                            session.agentId,
                                            syncGroup,
                                        )
                                    ) {
                                        throw new Error(
                                            `Not authorized to read sync group: ${syncGroup}`,
                                        );
                                    }

                                    // Subscribe to entity topics
                                    const ws =
                                        session.ws as ServerWebSocket<WebSocketData>;
                                    if (typeof ws.subscribe !== "function") {
                                        throw new Error(
                                            "WebSocket does not support subscriptions",
                                        );
                                    }

                                    if (channel === null) {
                                        // Subscribe to "all channels" topic
                                        const allChannelsTopic =
                                            this.getEntityTopic(
                                                syncGroup,
                                                entityName,
                                            );
                                        ws.subscribe(allChannelsTopic);

                                        // Also subscribe to all metadata "all channels" topics for this entity
                                        // We subscribe to the generic "__ALL__" metadata topic for each sync group used by this entity's metadata
                                        // plus the entity's own sync group (to cover future metadata creation)

                                        const metadataSyncGroupsResult =
                                            await superUserSql<
                                                Array<{ group__sync: string }>
                                            >`
                                            SELECT DISTINCT e.group__sync
                                            FROM entity.entity_metadata AS m
                                            JOIN entity.entities AS e
                                              ON e.general__entity_name = m.general__entity_name
                                            WHERE m.general__entity_name = ${entityName}
                                        `;

                                        const uniqueSyncGroups =
                                            new Set<string>();
                                        uniqueSyncGroups.add(syncGroup);
                                        for (const row of metadataSyncGroupsResult) {
                                            uniqueSyncGroups.add(
                                                row.group__sync,
                                            );
                                        }

                                        for (const sg of uniqueSyncGroups) {
                                            if (
                                                this.canRead(
                                                    session.agentId,
                                                    sg,
                                                )
                                            ) {
                                                const metadataAllChannelsTopic =
                                                    this.getMetadataTopic(
                                                        sg,
                                                        entityName,
                                                        "__ALL__",
                                                    );
                                                ws.subscribe(
                                                    metadataAllChannelsTopic,
                                                );
                                            }
                                        }
                                    } else {
                                        // Subscribe to channel-specific topic
                                        const channelTopic =
                                            this.getEntityTopic(
                                                syncGroup,
                                                entityName,
                                                channel,
                                            );
                                        ws.subscribe(channelTopic);

                                        // Also subscribe to channel-specific metadata topics
                                        const metadataSyncGroupsResult =
                                            await superUserSql<
                                                Array<{ group__sync: string }>
                                            >`
                                            SELECT DISTINCT e.group__sync
                                            FROM entity.entity_metadata AS m
                                            JOIN entity.entities AS e
                                              ON e.general__entity_name = m.general__entity_name
                                            WHERE m.general__entity_name = ${entityName}
                                        `;

                                        const uniqueSyncGroups =
                                            new Set<string>();
                                        uniqueSyncGroups.add(syncGroup);
                                        for (const row of metadataSyncGroupsResult) {
                                            uniqueSyncGroups.add(
                                                row.group__sync,
                                            );
                                        }

                                        for (const sg of uniqueSyncGroups) {
                                            if (
                                                this.canRead(
                                                    session.agentId,
                                                    sg,
                                                )
                                            ) {
                                                const metadataChannelTopic =
                                                    this.getMetadataTopic(
                                                        sg,
                                                        entityName,
                                                        "__ALL__",
                                                        channel,
                                                    );
                                                ws.subscribe(
                                                    metadataChannelTopic,
                                                );
                                            }
                                        }
                                    }

                                    const responseData = {
                                        type: Communication.WebSocket
                                            .MessageType
                                            .ENTITY_CHANNEL_SUBSCRIBE_RESPONSE,
                                        timestamp: Date.now(),
                                        requestId: typedRequest.requestId,
                                        errorMessage: null,
                                        entityName,
                                        channel,
                                        subscribed: true,
                                    };

                                    const responseParsed =
                                        Communication.WebSocket.Z.EntityChannelSubscribeResponse.safeParse(
                                            responseData,
                                        );
                                    if (!responseParsed.success) {
                                        throw new Error(
                                            "Invalid entity channel subscribe response format",
                                        );
                                    }

                                    const responseString = JSON.stringify(
                                        responseParsed.data,
                                    );
                                    responseSize = new TextEncoder().encode(
                                        responseString,
                                    ).length;
                                    success = true;

                                    ws.send(responseString);

                                    BunLogModule({
                                        prefix: LOG_PREFIX,
                                        message:
                                            "WS ENTITY_CHANNEL_SUBSCRIBE_REQUEST handled",
                                        debug: this.DEBUG,
                                        suppress: this.SUPPRESS,
                                        type: "debug",
                                        data: {
                                            requestId: typedRequest.requestId,
                                            entityName,
                                            channel,
                                            durationMs:
                                                performance.now() - receivedAt,
                                        },
                                    });
                                } catch (error) {
                                    const errorMessage =
                                        error instanceof Error
                                            ? error.message
                                            : String(error);

                                    const errorResponse = {
                                        type: Communication.WebSocket
                                            .MessageType
                                            .ENTITY_CHANNEL_SUBSCRIBE_RESPONSE,
                                        timestamp: Date.now(),
                                        requestId: typedRequest.requestId,
                                        errorMessage,
                                        entityName,
                                        channel,
                                        subscribed: false,
                                    };

                                    const errorParsed =
                                        Communication.WebSocket.Z.EntityChannelSubscribeResponse.safeParse(
                                            errorResponse,
                                        );
                                    if (errorParsed.success) {
                                        const errorString = JSON.stringify(
                                            errorParsed.data,
                                        );
                                        responseSize = new TextEncoder().encode(
                                            errorString,
                                        ).length;
                                        ws.send(errorString);
                                    }

                                    BunLogModule({
                                        prefix: LOG_PREFIX,
                                        message:
                                            "WS ENTITY_CHANNEL_SUBSCRIBE_REQUEST error",
                                        debug: this.DEBUG,
                                        suppress: this.SUPPRESS,
                                        type: "info",
                                        data: {
                                            requestId: typedRequest.requestId,
                                            entityName,
                                            channel,
                                            errorMessage,
                                        },
                                    });
                                } finally {
                                    this.recordEndpointMetrics(
                                        "WS_ENTITY_CHANNEL_SUBSCRIBE_REQUEST",
                                        startTime,
                                        requestSize,
                                        responseSize,
                                        success,
                                    );
                                }

                                break;
                            }

                            case Communication.WebSocket.MessageType
                                .ENTITY_CHANNEL_UNSUBSCRIBE_REQUEST: {
                                const typedRequest =
                                    data as Communication.WebSocket.EntityChannelUnsubscribeRequestMessage;

                                const startTime = performance.now();
                                const requestSize = new TextEncoder().encode(
                                    message,
                                ).length;
                                let responseSize = 0;
                                let removed = false;
                                const entityName =
                                    typedRequest.entityName.trim();
                                const channel =
                                    typedRequest.channel === undefined
                                        ? null
                                        : typedRequest.channel?.trim() || null;

                                const ws =
                                    session.ws as ServerWebSocket<WebSocketData>;
                                if (typeof ws.unsubscribe !== "function") {
                                    // WebSocket doesn't support unsubscription
                                    removed = false;
                                } else {
                                    // Get current subscriptions from Bun's native getter
                                    const subscriptions =
                                        (
                                            ws as unknown as {
                                                subscriptions?: string[];
                                            }
                                        ).subscriptions || [];
                                    const currentSubscriptions = new Set(
                                        subscriptions,
                                    );

                                    // Get the entity's syncGroup from the database
                                    if (superUserSql && entityName) {
                                        try {
                                            const entityResult =
                                                await superUserSql<
                                                    Array<{
                                                        group__sync: string;
                                                    }>
                                                >`
                                                SELECT group__sync
                                                FROM entity.entities
                                                WHERE general__entity_name = ${entityName}
                                                LIMIT 1
                                            `;

                                            if (entityResult.length > 0) {
                                                const syncGroup =
                                                    entityResult[0].group__sync;

                                                if (channel === null) {
                                                    // Unsubscribe from all entity and metadata topics for this entity
                                                    const allChannelsTopic =
                                                        this.getEntityTopic(
                                                            syncGroup,
                                                            entityName,
                                                        );
                                                    if (
                                                        currentSubscriptions.has(
                                                            allChannelsTopic,
                                                        )
                                                    ) {
                                                        ws.unsubscribe(
                                                            allChannelsTopic,
                                                        );
                                                        removed = true;
                                                    }

                                                    // Unsubscribe from all metadata "all channels" topics
                                                    const metadataKeysResult =
                                                        await superUserSql<
                                                            Array<{
                                                                metadata__key: string;
                                                                group__sync: string;
                                                            }>
                                                        >`
                                                        SELECT DISTINCT m.metadata__key, e.group__sync
                                                        FROM entity.entity_metadata AS m
                                                        JOIN entity.entities AS e
                                                          ON e.general__entity_name = m.general__entity_name
                                                        WHERE m.general__entity_name = ${entityName}
                                                    `;

                                                    for (const row of metadataKeysResult) {
                                                        const metadataAllChannelsTopic =
                                                            this.getMetadataTopic(
                                                                row.group__sync,
                                                                entityName,
                                                                row.metadata__key,
                                                            );
                                                        if (
                                                            currentSubscriptions.has(
                                                                metadataAllChannelsTopic,
                                                            )
                                                        ) {
                                                            ws.unsubscribe(
                                                                metadataAllChannelsTopic,
                                                            );
                                                        }
                                                    }
                                                } else {
                                                    // Unsubscribe from channel-specific topic
                                                    const channelTopic =
                                                        this.getEntityTopic(
                                                            syncGroup,
                                                            entityName,
                                                            channel,
                                                        );
                                                    if (
                                                        currentSubscriptions.has(
                                                            channelTopic,
                                                        )
                                                    ) {
                                                        ws.unsubscribe(
                                                            channelTopic,
                                                        );
                                                        removed = true;
                                                    }

                                                    // Unsubscribe from channel-specific metadata topics
                                                    const metadataKeysResult =
                                                        await superUserSql<
                                                            Array<{
                                                                metadata__key: string;
                                                                group__sync: string;
                                                            }>
                                                        >`
                                                        SELECT DISTINCT m.metadata__key, e.group__sync
                                                        FROM entity.entity_metadata AS m
                                                        JOIN entity.entities AS e
                                                          ON e.general__entity_name = m.general__entity_name
                                                        WHERE m.general__entity_name = ${entityName}
                                                    `;

                                                    for (const row of metadataKeysResult) {
                                                        const metadataChannelTopic =
                                                            this.getMetadataTopic(
                                                                row.group__sync,
                                                                entityName,
                                                                row.metadata__key,
                                                                channel,
                                                            );
                                                        if (
                                                            currentSubscriptions.has(
                                                                metadataChannelTopic,
                                                            )
                                                        ) {
                                                            ws.unsubscribe(
                                                                metadataChannelTopic,
                                                            );
                                                        }
                                                    }
                                                }
                                            }
                                        } catch {
                                            // If entity not found or error, just try to unsubscribe from any matching topics
                                            removed = false;
                                        }
                                    }

                                    // Fallback: unsubscribe from any topics matching the entity name pattern
                                    if (!removed) {
                                        for (const subscription of currentSubscriptions) {
                                            if (
                                                (subscription.startsWith(
                                                    this.ENTITY_TOPIC_PREFIX,
                                                ) ||
                                                    subscription.startsWith(
                                                        this
                                                            .METADATA_TOPIC_PREFIX,
                                                    )) &&
                                                subscription.includes(
                                                    `:${entityName}:`,
                                                )
                                            ) {
                                                if (
                                                    channel === null ||
                                                    subscription.endsWith(
                                                        `:${channel}`,
                                                    )
                                                ) {
                                                    ws.unsubscribe(
                                                        subscription,
                                                    );
                                                    removed = true;
                                                }
                                            }
                                        }
                                    }
                                }

                                const responseData = {
                                    type: Communication.WebSocket.MessageType
                                        .ENTITY_CHANNEL_UNSUBSCRIBE_RESPONSE,
                                    timestamp: Date.now(),
                                    requestId: typedRequest.requestId,
                                    errorMessage: removed
                                        ? null
                                        : "Subscription not found",
                                    entityName,
                                    channel,
                                    removed,
                                };

                                const responseParsed =
                                    Communication.WebSocket.Z.EntityChannelUnsubscribeResponse.safeParse(
                                        responseData,
                                    );
                                if (responseParsed.success) {
                                    const responseString = JSON.stringify(
                                        responseParsed.data,
                                    );
                                    responseSize = new TextEncoder().encode(
                                        responseString,
                                    ).length;
                                    ws.send(responseString);
                                }

                                BunLogModule({
                                    prefix: LOG_PREFIX,
                                    message:
                                        "WS ENTITY_CHANNEL_UNSUBSCRIBE_REQUEST handled",
                                    debug: this.DEBUG,
                                    suppress: this.SUPPRESS,
                                    type: "debug",
                                    data: {
                                        requestId: typedRequest.requestId,
                                        entityName,
                                        channel,
                                        removed,
                                        durationMs:
                                            performance.now() - receivedAt,
                                    },
                                });

                                this.recordEndpointMetrics(
                                    "WS_ENTITY_CHANNEL_UNSUBSCRIBE_REQUEST",
                                    startTime,
                                    requestSize,
                                    responseSize,
                                    removed,
                                );
                                break;
                            }

                            case Communication.WebSocket.MessageType
                                .REFLECT_PUBLISH_REQUEST: {
                                const req =
                                    data as Communication.WebSocket.ReflectPublishRequestMessage;

                                // Metrics tracking
                                const startTime = performance.now();
                                const messageSize = new TextEncoder().encode(
                                    message,
                                ).length;

                                // basic validation
                                const syncGroup = (req.syncGroup || "").trim();
                                const channel = (req.channel || "").trim();
                                if (!syncGroup || !channel) {
                                    const endTime = performance.now();
                                    const duration = endTime - startTime;
                                    this.metricsCollector.recordReflect(
                                        duration,
                                        messageSize,
                                        0, // delivered
                                        false, // acknowledged
                                    );
                                    const errorAckData = {
                                        type: Communication.WebSocket
                                            .MessageType.REFLECT_ACK_RESPONSE,
                                        timestamp: Date.now(),
                                        requestId: req.requestId,
                                        errorMessage:
                                            "Missing syncGroup or channel",
                                        syncGroup,
                                        channel,
                                        delivered: 0,
                                    };
                                    const errorAckParsed =
                                        Communication.WebSocket.Z.ReflectAckResponse.safeParse(
                                            errorAckData,
                                        );
                                    if (errorAckParsed.success) {
                                        ws.send(
                                            JSON.stringify(errorAckParsed.data),
                                        );
                                    }
                                    BunLogModule({
                                        prefix: LOG_PREFIX,
                                        message:
                                            "WS REFLECT_PUBLISH_REQUEST validation failed",
                                        debug: this.DEBUG,
                                        suppress: this.SUPPRESS,
                                        type: "info",
                                        data: {
                                            syncGroup,
                                            channel,
                                            durationMs:
                                                performance.now() - receivedAt,
                                        },
                                    });
                                    break;
                                }

                                // ensure ACL warm for sender
                                if (
                                    !this.aclService?.isWarmed(session.agentId)
                                ) {
                                    await this.warmAgentAcl(
                                        session.agentId,
                                    ).catch(() => {});
                                }

                                // authorize: sender must be able to write (update or insert) the target group
                                if (
                                    !this.canUpdate(
                                        session.agentId,
                                        syncGroup,
                                    ) &&
                                    !this.canInsert(session.agentId, syncGroup)
                                ) {
                                    const endTime = performance.now();
                                    const duration = endTime - startTime;
                                    this.metricsCollector.recordReflect(
                                        duration,
                                        messageSize,
                                        0, // delivered
                                        false, // acknowledged
                                    );
                                    const unauthorizedAckData = {
                                        type: Communication.WebSocket
                                            .MessageType.REFLECT_ACK_RESPONSE,
                                        timestamp: Date.now(),
                                        requestId: req.requestId,
                                        errorMessage:
                                            "Not authorized (update or insert required)",
                                        syncGroup,
                                        channel,
                                        delivered: 0,
                                    };
                                    const unauthorizedAckParsed =
                                        Communication.WebSocket.Z.ReflectAckResponse.safeParse(
                                            unauthorizedAckData,
                                        );
                                    if (unauthorizedAckParsed.success) {
                                        ws.send(
                                            JSON.stringify(
                                                unauthorizedAckParsed.data,
                                            ),
                                        );
                                    }
                                    BunLogModule({
                                        prefix: LOG_PREFIX,
                                        message:
                                            "WS REFLECT_PUBLISH_REQUEST unauthorized - update or insert required",
                                        debug: this.DEBUG,
                                        suppress: this.SUPPRESS,
                                        type: "info",
                                        data: {
                                            syncGroup,
                                            channel,
                                            durationMs:
                                                performance.now() - receivedAt,
                                        },
                                    });
                                    break;
                                }

                                // enqueue for tick-gated fanout
                                // let delivered = 0; // not used in fire-and-forget path
                                const deliveryData = {
                                    type: Communication.WebSocket.MessageType
                                        .REFLECT_MESSAGE_DELIVERY,
                                    timestamp: Date.now(),
                                    requestId: "",
                                    errorMessage: null,
                                    syncGroup,
                                    channel,
                                    payload: req.payload,
                                    fromSessionId: session.sessionId,
                                };

                                const deliveryParsed =
                                    Communication.WebSocket.Z.ReflectDelivery.safeParse(
                                        deliveryData,
                                    );
                                if (!deliveryParsed.success) {
                                    throw new Error(
                                        `Invalid delivery message format: ${deliveryParsed.error.message}`,
                                    );
                                }
                                const delivery = deliveryParsed.data;
                                const payloadStr = JSON.stringify(delivery);

                                // Record pusher activity for this publish
                                this.metricsCollector.recordPusher(
                                    session.sessionId,
                                    syncGroup,
                                    channel,
                                );

                                this.enqueueReflect(
                                    syncGroup,
                                    channel,
                                    session.sessionId,
                                    payloadStr,
                                    req.requestAcknowledgement
                                        ? req.requestId
                                        : undefined,
                                );

                                // Record endpoint metrics using request size; response size depends on ack
                                const responseSize = 0; // ack sent after flush

                                this.recordEndpointMetrics(
                                    "WS_REFLECT_PUBLISH_REQUEST",
                                    startTime,
                                    messageSize,
                                    responseSize,
                                    true,
                                );

                                BunLogModule({
                                    prefix: LOG_PREFIX,
                                    message:
                                        "WS REFLECT_PUBLISH_REQUEST enqueued for tick ",
                                    debug: this.DEBUG,
                                    suppress: this.SUPPRESS,
                                    type: "debug",
                                    data: {
                                        syncGroup,
                                        channel,
                                        delivered: 0,
                                        requestAcknowledgement:
                                            req.requestAcknowledgement,
                                        durationMs:
                                            performance.now() - receivedAt,
                                    },
                                });
                                break;
                            }

                            default: {
                                const unsupportedErrorData: Communication.WebSocket.GeneralErrorResponseMessage =
                                    {
                                        type: Communication.WebSocket
                                            .MessageType.GENERAL_ERROR_RESPONSE,
                                        timestamp: Date.now(),
                                        requestId: parsed.data.requestId,
                                        errorMessage: `Unsupported message type: ${parsed.data.type}`,
                                    };
                                const unsupportedErrorParsed =
                                    Communication.WebSocket.Z.GeneralErrorResponse.safeParse(
                                        unsupportedErrorData,
                                    );
                                if (unsupportedErrorParsed.success) {
                                    session.ws.send(
                                        JSON.stringify(
                                            unsupportedErrorParsed.data,
                                        ),
                                    );
                                }
                                BunLogModule({
                                    prefix: LOG_PREFIX,
                                    message: "WS unsupported message type",
                                    debug: this.DEBUG,
                                    suppress: this.SUPPRESS,
                                    type: "info",
                                    data: {
                                        type: parsed.data.type,
                                        requestId: parsed.data.requestId,
                                        durationMs:
                                            performance.now() - receivedAt,
                                    },
                                });
                            }
                        }
                    } catch (error) {
                        BunLogModule({
                            prefix: LOG_PREFIX,
                            message: "WS message handler threw",
                            debug: this.DEBUG,
                            suppress: this.SUPPRESS,
                            type: "info",
                            data: {
                                error:
                                    error instanceof Error
                                        ? error.message
                                        : String(error),
                                elapsedMs: performance.now() - receivedAt,
                            },
                        });
                    }
                },
                open: (ws: ServerWebSocket<WebSocketData>) => {
                    const sessionData = ws.data;

                    BunLogModule({
                        prefix: LOG_PREFIX,
                        message: "New WebSocket connection attempt",
                        debug: this.DEBUG,
                        suppress: this.SUPPRESS,
                        type: "info",
                        data: {
                            agentId: sessionData.agentId,
                            sessionId: sessionData.sessionId,
                            readyState: ws.readyState,
                        },
                    });

                    const session: WorldSession<unknown> = {
                        ws,
                        agentId: sessionData.agentId,
                        sessionId: sessionData.sessionId,
                    };

                    this.activeSessions.set(sessionData.sessionId, session);
                    this.wsToSessionMap.set(ws, sessionData.sessionId);
                    this.tokenMap.set(
                        ws,
                        (ws as ServerWebSocket<WebSocketData>).data.token,
                    );
                    this.syncReflectSubscriptionsForSession(session);

                    BunLogModule({
                        prefix: LOG_PREFIX,
                        message: `Connection established with agent ${sessionData.agentId}`,
                        suppress: this.SUPPRESS,
                        debug: this.DEBUG,
                        type: "info",
                    });

                    // Warm ACL for this agent (non-blocking)
                    void this.warmAgentAcl(sessionData.agentId).catch(() => {});

                    // Send session info to client via WebSocket using typed message
                    const sessionInfoData = {
                        type: Communication.WebSocket.MessageType
                            .SESSION_INFO_RESPONSE,
                        timestamp: Date.now(),
                        requestId: "",
                        errorMessage: null,
                        agentId: sessionData.agentId,
                        sessionId: sessionData.sessionId,
                    };

                    const sessionInfoParsed =
                        Communication.WebSocket.Z.SessionInfo.safeParse(
                            sessionInfoData,
                        );
                    if (sessionInfoParsed.success) {
                        ws.send(JSON.stringify(sessionInfoParsed.data));
                    }
                },
                close: (
                    ws: ServerWebSocket<WebSocketData>,
                    code: number,
                    reason: string,
                ) => {
                    const session = this.activeSessions.get(ws.data.sessionId);
                    if (session) {
                        // Clean up maps
                        this.wsToSessionMap.delete(session.ws);
                        this.activeSessions.delete(session.sessionId);
                        // Bun automatically handles unsubscription on close
                    }

                    BunLogModule({
                        message: "WebSocket disconnection",
                        debug: this.DEBUG,
                        suppress: this.SUPPRESS,
                        prefix: LOG_PREFIX,
                        data: {
                            sessionId: session?.sessionId,
                            agentId: session?.agentId,
                            code,
                            reason,
                        },
                        type: "info",
                    });
                },
            },

            // #endregion
        });

        // #region Heartbeat Interval

        this.heartbeatInterval = setInterval(async () => {
            const sessionsToCheck = Array.from(this.activeSessions.entries());

            // Record current system metrics periodically
            const currentMemory = process.memoryUsage();
            const currentCpu = process.cpuUsage();
            const dbConnectionCount =
                (superUserSql ? 1 : 0) + (proxyUserSql ? 1 : 0);

            this.metricsCollector.recordSystemMetrics(
                currentCpu,
                currentMemory,
                this.activeSessions.size,
                dbConnectionCount,
            );

            // Process sessions in parallel
            await Promise.all(
                sessionsToCheck.map(async ([sessionId, session]) => {
                    if (!superUserSql) {
                        throw new Error(
                            "No super user database connection available",
                        );
                    }

                    try {
                        // Check session validity directly in database
                        await superUserSql<[{ agent_id: string }]>`
                                SELECT * FROM auth.validate_session_id(${sessionId}::UUID) as agent_id
                            `;
                        // Session is valid if no exception was thrown
                    } catch (error) {
                        // Session is invalid, close the connection
                        BunLogModule({
                            prefix: LOG_PREFIX,
                            message:
                                "Session expired / invalid, closing WebSocket",
                            debug: this.DEBUG,
                            suppress: this.SUPPRESS,
                            type: "info",
                            data: {
                                sessionId,
                                agentId: session.agentId,
                                error:
                                    error instanceof Error
                                        ? error.message
                                        : String(error),
                            },
                        });
                        session.ws.close(1000, "Session expired");
                    }
                }),
            );
        }, this.CONNECTION_HEARTBEAT_INTERVAL);

        BunLogModule({
            message: "Bun WS World API Server running.",
            prefix: LOG_PREFIX,
            type: "success",
            debug: this.DEBUG,
            suppress: this.SUPPRESS,
        });

        // #endregion
    }

    resetMetrics() {
        this.metricsCollector.reset();
    }

    cleanup() {
        this.server?.stop().finally(() => {
            if (this.heartbeatInterval) {
                clearInterval(this.heartbeatInterval);
            }
            if (this.assetMaintenanceInterval) {
                clearInterval(this.assetMaintenanceInterval);
            }
            // Clear reflect tick intervals
            for (const timer of this.reflectIntervals.values()) {
                clearInterval(timer);
            }
            this.reflectIntervals.clear();

            for (const session of this.activeSessions.values()) {
                session.ws.close(1000, "Server shutting down");
            }
            this.activeSessions.clear();
        });
        // Do not forcibly clear cache on shutdown; keep warmed files for faster next start
        BunPostgresClientModule.getInstance({
            debug: this.DEBUG,
            suppress: this.SUPPRESS,
        }).disconnect();
        this.unregisterAclWarmCallback?.();
        this.unregisterAclWarmCallback = null;
    }
}

// #endregion

void (async () => {
    const manager = new WorldApiWsManager();
    await manager.initialize();
})();
