import { log } from "../../sdk/vircadia-world-sdk-ts/module/general/log";
import type postgres from "postgres";
import { sign, verify } from "jsonwebtoken";
import type { VircadiaConfig_Server } from "../../sdk/vircadia-world-sdk-ts/config/vircadia.config.ts";
import {
    Communication,
    type Tick,
} from "../../sdk/vircadia-world-sdk-ts/schema/schema.general";
import type { Server, ServerWebSocket } from "bun";

interface WorldSession<T = unknown> {
    ws: WebSocket | ServerWebSocket<T>;
    agentId: string;
    sessionId: string;
    lastHeartbeat: number;
    subscriptions: Set<string>;
}

interface AuthConfig {
    jwt_session_duration: string;
    jwt_secret: string;
    admin_token_session_duration: string;
    ws_check_interval: number;
}

interface WebSocketData {
    token: string;
    agentId: string;
    sessionId: string;
}

async function validateSession(
    sql: postgres.Sql,
    debugMode: boolean,
    authConfig: AuthConfig,
    token: string,
): Promise<{ agentId: string; sessionId: string; isValid: boolean }> {
    try {
        // Check for empty or malformed token first
        if (!token || token.split(".").length !== 3) {
            return {
                agentId: "",
                sessionId: "",
                isValid: false,
            };
        }

        const decoded = verify(token, authConfig.jwt_secret) as {
            sessionId: string;
            agentId: string;
        };

        const [validation] = await sql`
            SELECT * FROM auth.validate_session(${decoded.sessionId}::UUID)
        `;

        log({
            message: "Session validation result",
            debug: debugMode,
            type: "debug",
            data: {
                validation,
            },
        });

        return {
            agentId: validation.auth__agent_id || "",
            sessionId: decoded.sessionId,
            isValid: validation.is_valid && !!validation.auth__agent_id,
        };
    } catch (error) {
        log({
            message: `Session validation failed: ${error}`,
            debug: debugMode,
            type: "debug",
            data: {
                error: error instanceof Error ? error.message : String(error),
            },
        });
        return {
            agentId: "",
            sessionId: "",
            isValid: false,
        };
    }
}

class WorldRestManager {
    constructor(
        private readonly sql: postgres.Sql,
        private readonly debugMode: boolean,
        private readonly authConfig: AuthConfig,
    ) {}

    async handleRequest(req: Request): Promise<Response> {
        const url = new URL(req.url);
        const path = url.pathname;

        // Handle authentication routes
        switch (true) {
            case path ===
                Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.path &&
                req.method === "GET":
                return await this.handleSessionValidate(req);

            case path ===
                Communication.REST.Endpoint.AUTH_SESSION_LOGOUT.path &&
                req.method === "POST":
                return await this.handleLogout(req);

            default:
                return new Response("Not Found", { status: 404 });
        }
    }

    private async handleSessionValidate(req: Request): Promise<Response> {
        const token = req.headers.get("Authorization")?.replace("Bearer ", "");
        if (!token) {
            return Response.json(
                Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.createError(
                    "No token provided",
                ),
                { status: 401 },
            );
        }

        const validation = await validateSession(
            this.sql,
            this.debugMode,
            this.authConfig,
            token,
        );

        // Set the current agent ID for RLS
        if (validation.isValid) {
            await this
                .sql`SELECT set_config('app.current_agent_id', ${validation.agentId}::text, true)`;
        }

        log({
            message: "Auth endpoint - Session validation result",
            debug: this.debugMode,
            type: "debug",
            data: {
                validation,
            },
        });

        if (!validation.isValid) {
            return Response.json(
                Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.createError(
                    "Invalid token",
                ),
            );
        }

        return Response.json(
            Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.createSuccess(
                validation.isValid,
                validation.agentId,
                validation.sessionId,
            ),
        );
    }

    private async handleLogout(req: Request): Promise<Response> {
        // TODO: On OAUTH, we must also invalidate the token on the OAUTH server as well as wiping it from our own session list.
        const token = req.headers.get("Authorization")?.replace("Bearer ", "");
        if (!token) {
            return Response.json(
                Communication.REST.Endpoint.AUTH_SESSION_LOGOUT.createError(
                    "No token provided",
                ),
                { status: 401 },
            );
        }

        const validation = await validateSession(
            this.sql,
            this.debugMode,
            this.authConfig,
            token,
        );

        // Set the current agent ID for RLS
        if (validation.isValid) {
            await this
                .sql`SELECT set_config('app.current_agent_id', ${validation.agentId}::text, true)`;
        }

        try {
            // Even if the token is invalid, we should return success since the session is effectively "logged out"
            if (!validation.isValid) {
                return Response.json(
                    Communication.REST.Endpoint.AUTH_SESSION_LOGOUT.createSuccess(),
                );
            }

            // Call invalidate_session and check its boolean return value
            const [result] = await this.sql<[{ invalidate_session: boolean }]>`
                SELECT auth.invalidate_session(${validation.sessionId}::UUID) as invalidate_session;
            `;

            if (!result.invalidate_session) {
                throw new Error("Failed to invalidate session");
            }

            log({
                message: "Auth endpoint - Successfully logged out",
                debug: this.debugMode,
                type: "debug",
                data: {
                    validation,
                },
            });

            return Response.json(
                Communication.REST.Endpoint.AUTH_SESSION_LOGOUT.createSuccess(),
            );
        } catch (error) {
            log({
                message: "Failed to invalidate session",
                debug: this.debugMode,
                type: "error",
                data: {
                    error:
                        error instanceof Error ? error.message : String(error),
                },
            });

            return Response.json(
                Communication.REST.Endpoint.AUTH_SESSION_LOGOUT.createSuccess(),
            );
        }
    }
}

class TickManager {
    private intervalIds: Map<string, Timer> = new Map();
    private entityStatesCleanupId: Timer | null = null;
    private tickMetricsCleanupId: Timer | null = null;
    private syncGroups: Map<string, Tick.SyncGroup> = new Map();
    private tickCounts: Map<string, number> = new Map();
    private tickBufferDurationMs = 2000;
    private tickMetricsHistoryMs = 3600000;

    private readonly LOG_PREFIX = "TickManager";

    constructor(
        private readonly sql: postgres.Sql,
        private readonly debugMode: boolean,
        private readonly wsManager: WorldWebSocketManager,
    ) {}

    async initialize() {
        try {
            // Load sync groups from the database
            const syncGroupsData = await this.sql<
                [
                    {
                        sync_group: string;
                        server__tick__rate_ms: number;
                        server__tick__buffer: number;
                        client__render_delay_ms: number;
                        client__max_prediction_time_ms: number;
                        network__packet_timing_variance_ms: number;
                    },
                ]
            >`
                SELECT 
                    sync_group,
                    server__tick__rate_ms,
                    server__tick__buffer,
                    client__render_delay_ms,
                    client__max_prediction_time_ms,
                    network__packet_timing_variance_ms
                FROM entity.entity_sync_groups
            `;

            // Convert to Map for easier access
            for (const group of syncGroupsData) {
                this.syncGroups.set(group.sync_group, {
                    server_tick_rate_ms: group.server__tick__rate_ms,
                    server_tick_buffer: group.server__tick__buffer,
                    client_render_delay_ms: group.client__render_delay_ms,
                    client_max_prediction_time_ms:
                        group.client__max_prediction_time_ms,
                    network_packet_timing_variance_ms:
                        group.network__packet_timing_variance_ms,
                });
            }

            // Load other config values
            const [bufferConfig] = await this.sql`
                SELECT value FROM config.config WHERE key = 'tick_buffer_duration_ms'
            `;
            const [metricsConfig] = await this.sql`
                SELECT value FROM config.config WHERE key = 'tick_metrics_history_ms'
            `;

            if (bufferConfig) {
                this.tickBufferDurationMs = bufferConfig.value;
            }
            if (metricsConfig) {
                this.tickMetricsHistoryMs = metricsConfig.value;
            }

            this.setupCleanupTimers();
        } catch (error) {
            log({
                message: `Failed to initialize tick manager: ${error}`,
                debug: this.debugMode,
                type: "error",
            });
            throw error;
        }
    }

    private setupCleanupTimers() {
        if (this.entityStatesCleanupId)
            clearInterval(this.entityStatesCleanupId);
        if (this.tickMetricsCleanupId) clearInterval(this.tickMetricsCleanupId);

        this.entityStatesCleanupId = setInterval(async () => {
            try {
                await this.sql`SELECT tick.cleanup_old_entity_states()`;
                log({
                    prefix: this.LOG_PREFIX,
                    message: "Entity states cleanup completed",
                    debug: this.debugMode,
                    type: "debug",
                });
            } catch (error) {
                log({
                    prefix: this.LOG_PREFIX,
                    message: `Error during entity states cleanup: ${error}`,
                    debug: this.debugMode,
                    type: "error",
                });
            }
        }, this.tickBufferDurationMs);

        this.tickMetricsCleanupId = setInterval(async () => {
            try {
                await this.sql`SELECT tick.cleanup_old_tick_metrics()`;
                log({
                    prefix: this.LOG_PREFIX,
                    message: "Tick metrics cleanup completed",
                    debug: this.debugMode,
                    type: "debug",
                });
            } catch (error) {
                log({
                    prefix: this.LOG_PREFIX,
                    message: `Error during tick metrics cleanup: ${error}`,
                    debug: this.debugMode,
                    type: "error",
                });
            }
        }, this.tickMetricsHistoryMs);
    }

    async start() {
        for (const [syncGroup, config] of this.syncGroups.entries()) {
            if (this.intervalIds.has(syncGroup)) {
                continue;
            }

            const tickLoop = async () => {
                const startTime = performance.now();

                try {
                    const tickState = await this.captureTick(syncGroup);

                    if (tickState) {
                        await this.wsManager.broadcastEntityUpdate(
                            tickState.entityId,
                            tickState.changes,
                            tickState.sessionIds,
                            tickState.tickNumber,
                            tickState.tickStartTime,
                        );
                    }

                    const endTime = performance.now();
                    const elapsedMs = endTime - startTime;
                    const sleepMs = Math.max(
                        0,
                        config.server_tick_rate_ms - elapsedMs,
                    );

                    await Bun.sleep(sleepMs);
                    this.intervalIds.set(syncGroup, setTimeout(tickLoop, 0));
                } catch (error) {
                    log({
                        message: `Error in tick loop for ${syncGroup}: ${error}`,
                        debug: this.debugMode,
                        type: "error",
                    });
                    this.intervalIds.set(
                        syncGroup,
                        setTimeout(tickLoop, config.server_tick_rate_ms),
                    );
                }
            };

            tickLoop();
        }
    }

    private async captureTick(
        syncGroup: string,
    ): Promise<Tick.TickState | null> {
        try {
            const result = await this.sql`
                WITH tick_capture AS (
                    SELECT * FROM tick.capture_tick_state(${syncGroup})
                )
                SELECT 
                    entity_id,
                    operation,
                    changes,
                    session_ids,
                    tick_number,
                    tick_start_time,
                    tick_end_time,
                    tick_duration_ms,
                    is_delayed,
                    headroom_ms
                FROM tick_capture
            `;

            if (!result.length) {
                return null;
            }

            // Update tick count
            const currentCount = this.tickCounts.get(syncGroup) || 0;
            this.tickCounts.set(syncGroup, currentCount + 1);

            return {
                entityId: result[0].entity_id,
                operation: result[0].operation,
                changes: result[0].changes,
                sessionIds: result[0].session_ids,
                tickNumber: result[0].tick_number,
                tickStartTime: result[0].tick_start_time,
                tickEndTime: result[0].tick_end_time,
                tickDurationMs: result[0].tick_duration_ms,
                isDelayed: result[0].is_delayed,
                headroomMs: result[0].headroom_ms,
            };
        } catch (error) {
            log({
                message: `Error capturing tick for ${syncGroup}: ${error}`,
                debug: this.debugMode,
                type: "error",
            });
            return null;
        }
    }

    stop() {
        for (const [syncGroup, intervalId] of this.intervalIds.entries()) {
            clearTimeout(intervalId);
            this.intervalIds.delete(syncGroup);
        }

        if (this.entityStatesCleanupId) {
            clearInterval(this.entityStatesCleanupId);
            this.entityStatesCleanupId = null;
        }
        if (this.tickMetricsCleanupId) {
            clearInterval(this.tickMetricsCleanupId);
            this.tickMetricsCleanupId = null;
        }
    }
}

class WorldWebSocketManager {
    private activeSessions: Map<string, WorldSession<unknown>> = new Map();
    private heartbeatInterval: Timer | null = null;
    private tokenMap = new WeakMap<
        WebSocket | ServerWebSocket<unknown>,
        string
    >();
    private wsToSessionMap = new WeakMap<
        WebSocket | ServerWebSocket<unknown>,
        string
    >();
    private clientConfig:
        | {
              heartbeat: { interval: number; timeout: number };
              session: {
                  max_session_age_ms: number;
                  cleanup_interval_ms: number;
                  inactive_timeout_ms: number;
              };
          }
        | undefined;
    private channelSubscribers: Map<string, Map<string, postgres.ListenMeta>> =
        new Map();

    private readonly LOG_PREFIX = "WorldWebSocketManager";

    constructor(
        private readonly sql: postgres.Sql,
        private readonly debugMode: boolean,
        private readonly authConfig: AuthConfig,
    ) {}

    private async setAgentContext(
        sql: postgres.Sql,
        sessionId: string,
        sessionToken: string,
    ): Promise<void> {
        if (!sessionToken || !sessionId) {
            throw new Error("Session token or session ID not found");
        }

        // Check the return value to ensure context was set correctly
        const [contextResult] = await sql<[{ set_agent_context: boolean }]>`
            SELECT auth.set_agent_context(${sessionId}::UUID, ${sessionToken}::TEXT) as set_agent_context
        `;

        if (!contextResult.set_agent_context) {
            throw new Error("Failed to set agent context");
        }
    }

    private async handleQuery(
        ws: ServerWebSocket<WebSocketData>,
        message: Communication.WebSocket.QueryMessage,
    ) {
        const sessionId = this.wsToSessionMap.get(ws);
        const sessionToken = this.tokenMap.get(ws);
        const session = sessionId
            ? this.activeSessions.get(sessionId)
            : undefined;

        if (!session || !sessionToken || !sessionId) {
            return;
        }

        try {
            log({
                prefix: this.LOG_PREFIX,
                message: "Processing query request",
                type: "debug",
                data: {
                    sessionId,
                    message,
                },
            });

            // Execute query as the user with both session ID and token
            const results = await this.sql.begin(async (sql) => {
                await this.setAgentContext(sql, sessionId, sessionToken);
                return await sql.unsafe(
                    message.query,
                    message.parameters || [],
                );
            });

            log({
                prefix: this.LOG_PREFIX,
                message: "Query execution completed",
                type: "debug",
                data: { results },
            });

            const responseMsg =
                Communication.WebSocket.createMessage<Communication.WebSocket.QueryResponseMessage>(
                    {
                        type: Communication.WebSocket.MessageType
                            .QUERY_RESPONSE,
                        requestId: message.requestId,
                        results,
                    },
                );
            ws.send(JSON.stringify(responseMsg));
        } catch (error) {
            log({
                prefix: this.LOG_PREFIX,
                message: "Query execution failed",
                type: "error",
                error,
                data: { message },
            });

            const errorMsg =
                Communication.WebSocket.createMessage<Communication.WebSocket.QueryResponseMessage>(
                    {
                        type: Communication.WebSocket.MessageType
                            .QUERY_RESPONSE,
                        requestId: message.requestId,
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    },
                );
            ws.send(JSON.stringify(errorMsg));
        }
    }

    private async handleSubscribe(
        ws: ServerWebSocket<WebSocketData>,
        message: Communication.WebSocket.SubscribeMessage,
    ) {
        const sessionId = this.wsToSessionMap.get(ws);
        const sessionToken = this.tokenMap.get(ws);
        const session = sessionId
            ? this.activeSessions.get(sessionId)
            : undefined;

        if (!session || !sessionToken || !sessionId) {
            log({
                prefix: this.LOG_PREFIX,
                message: "Session not found during subscribe",
                debug: this.debugMode,
                type: "debug",
                data: { sessionId },
            });
            return;
        }

        try {
            log({
                prefix: this.LOG_PREFIX,
                message: "Processing subscription request",
                debug: this.debugMode,
                type: "debug",
                data: { channel: message.channel, sessionId },
            });

            // Create a new SQL connection for this subscription
            const subscriberSql = this.sql;

            // Set the agent context using both session ID and token
            await this.setAgentContext(subscriberSql, sessionId, sessionToken);

            // Listen on the session ID channel
            const pgListener = await subscriberSql.listen(
                sessionId,
                async (payload) => {
                    log({
                        prefix: this.LOG_PREFIX,
                        message: "Received entity change notification",
                        type: "debug",
                        data: { payload },
                    });

                    if (!payload) {
                        log({
                            prefix: this.LOG_PREFIX,
                            message: "Received empty payload from pg_notify",
                            type: "debug",
                            debug: true,
                        });
                        return;
                    }

                    try {
                        // Set agent context for each notification processing
                        await this.setAgentContext(
                            subscriberSql,
                            sessionId,
                            sessionToken,
                        );

                        const notificationData = JSON.parse(payload.toString());

                        let notificationMsg:
                            | Communication.WebSocket.NotificationEntityUpdateMessage
                            | Communication.WebSocket.NotificationEntityScriptUpdateMessage;

                        if (notificationData.type === "entity") {
                            notificationMsg =
                                Communication.WebSocket.createMessage<Communication.WebSocket.NotificationEntityUpdateMessage>(
                                    {
                                        type: Communication.WebSocket
                                            .MessageType
                                            .NOTIFICATION_ENTITY_UPDATE,
                                        entityId: notificationData.id,
                                        changes: {
                                            operation:
                                                notificationData.operation,
                                            syncGroup:
                                                notificationData.sync_group,
                                            timestamp:
                                                notificationData.timestamp,
                                            agentId: notificationData.agent_id,
                                        },
                                    },
                                );
                        } else if (notificationData.type === "script") {
                            notificationMsg =
                                Communication.WebSocket.createMessage<Communication.WebSocket.NotificationEntityScriptUpdateMessage>(
                                    {
                                        type: Communication.WebSocket
                                            .MessageType
                                            .NOTIFICATION_ENTITY_SCRIPT_UPDATE,
                                        entityId: notificationData.id,
                                        scriptChanges: {
                                            operation:
                                                notificationData.operation,
                                            syncGroup:
                                                notificationData.sync_group,
                                            timestamp:
                                                notificationData.timestamp,
                                            agentId: notificationData.agent_id,
                                        },
                                    },
                                );
                        } else {
                            throw new Error(
                                `Unknown notification type: ${notificationData.type}`,
                            );
                        }

                        if (session.ws.readyState === WebSocket.OPEN) {
                            session.ws.send(JSON.stringify(notificationMsg));
                        }
                    } catch (error) {
                        log({
                            prefix: this.LOG_PREFIX,
                            message:
                                "Failed to process entity change notification",
                            type: "error",
                            error,
                            data: { payload },
                        });
                    }
                },
            );

            // Store using sessionId as the key
            if (!this.channelSubscribers.has(sessionId)) {
                this.channelSubscribers.set(sessionId, new Map());
            }
            this.channelSubscribers.get(sessionId)?.set(sessionId, pgListener);

            // Add to session subscriptions
            session.subscriptions.add(message.channel);

            const responseMsg =
                Communication.WebSocket.createMessage<Communication.WebSocket.SubscribeResponseMessage>(
                    {
                        type: Communication.WebSocket.MessageType
                            .SUBSCRIBE_RESPONSE,
                        channel: message.channel,
                        success: true,
                    },
                );
            ws.send(JSON.stringify(responseMsg));
        } catch (error) {
            log({
                prefix: this.LOG_PREFIX,
                message: "Subscription failed",
                type: "error",
                error,
                data: { channel: message.channel, sessionId },
            });
            const errorMsg =
                Communication.WebSocket.createMessage<Communication.WebSocket.SubscribeResponseMessage>(
                    {
                        type: Communication.WebSocket.MessageType
                            .SUBSCRIBE_RESPONSE,
                        channel: message.channel,
                        success: false,
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    },
                );
            ws.send(JSON.stringify(errorMsg));
        }
    }

    private handleUnsubscribe(
        ws: ServerWebSocket<WebSocketData>,
        message: Communication.WebSocket.UnsubscribeMessage,
    ) {
        const sessionId = this.wsToSessionMap.get(ws);
        const session = sessionId
            ? this.activeSessions.get(sessionId)
            : undefined;

        if (!session || !sessionId) {
            log({
                prefix: this.LOG_PREFIX,
                message: "Session not found",
                debug: this.debugMode,
                type: "debug",
            });
            return;
        }

        // Unsubscribe and cleanup the subscription
        const channelSubs = this.channelSubscribers.get(sessionId);
        if (channelSubs) {
            const subscription = channelSubs.get(sessionId);
            if (subscription) {
                subscription.unlisten();
                channelSubs.delete(sessionId);
            }
            if (channelSubs.size === 0) {
                this.channelSubscribers.delete(sessionId);
            }
        }

        // Remove from session subscriptions
        session.subscriptions.delete(message.channel);

        const responseMsg =
            Communication.WebSocket.createMessage<Communication.WebSocket.UnsubscribeResponseMessage>(
                {
                    type: Communication.WebSocket.MessageType
                        .UNSUBSCRIBE_RESPONSE,
                    channel: message.channel,
                    success: true,
                },
            );
        ws.send(JSON.stringify(responseMsg));
    }

    async initialize() {
        // Load client configuration
        const [heartbeatInterval] = await this.sql`
            SELECT value FROM config.config WHERE key = 'client__heartbeat_interval_ms'
        `;
        const [heartbeatTimeout] = await this.sql`
            SELECT value FROM config.config WHERE key = 'client__heartbeat_timeout_ms'
        `;
        const [sessionConfig] = await this.sql`
            SELECT value FROM config.config WHERE key = 'client__session'
        `;

        this.clientConfig = {
            heartbeat: {
                interval: heartbeatInterval.value,
                timeout: heartbeatTimeout.value,
            },
            session: sessionConfig.value,
        };

        this.heartbeatInterval = setInterval(
            () => this.checkHeartbeats(),
            this.authConfig.ws_check_interval,
        );
    }

    async handleUpgrade(
        req: Request,
        server: Server,
    ): Promise<Response | undefined> {
        const url = new URL(req.url);
        const token = url.searchParams.get("token");

        // Handle missing token first
        if (!token) {
            log({
                prefix: this.LOG_PREFIX,
                message: "No token found in query parameters",
                debug: this.debugMode,
                type: "debug",
            });
            return new Response("Authentication required", { status: 401 });
        }

        const validation = await validateSession(
            this.sql,
            this.debugMode,
            this.authConfig,
            token,
        );

        if (!validation.isValid) {
            log({
                prefix: this.LOG_PREFIX,
                message: "Token validation failed",
                debug: this.debugMode,
                type: "debug",
            });
            return new Response("Invalid token", { status: 401 });
        }

        // Only attempt upgrade if validation passes
        const upgraded = server.upgrade(req, {
            data: {
                token,
                agentId: validation.agentId,
                sessionId: validation.sessionId,
            },
        });

        if (!upgraded) {
            log({
                prefix: this.LOG_PREFIX,
                message: "WebSocket upgrade failed",
                debug: this.debugMode,
                type: "error",
            });
            return new Response("WebSocket upgrade failed", { status: 500 });
        }

        return undefined;
    }

    handleConnection(
        ws: WebSocket | ServerWebSocket<WebSocketData>,
        sessionData: { agentId: string; sessionId: string },
    ) {
        log({
            prefix: this.LOG_PREFIX,
            message: "New WebSocket connection attempt",
            debug: this.debugMode,
            type: "debug",
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
            lastHeartbeat: Date.now(),
            subscriptions: new Set(),
        };

        this.activeSessions.set(sessionData.sessionId, session);
        this.wsToSessionMap.set(ws, sessionData.sessionId);
        this.tokenMap.set(
            ws,
            (ws as ServerWebSocket<WebSocketData>).data.token,
        );

        try {
            const connectionMsg =
                Communication.WebSocket.createMessage<Communication.WebSocket.ConnectionEstablishedMessage>(
                    {
                        type: Communication.WebSocket.MessageType
                            .CONNECTION_ESTABLISHED,
                        agentId: sessionData.agentId,
                    },
                );
            ws.send(JSON.stringify(connectionMsg));
            log({
                prefix: this.LOG_PREFIX,
                message: `Connection established with agent ${sessionData.agentId}`,
                debug: this.debugMode,
                type: "debug",
            });
        } catch (error) {
            log({
                prefix: this.LOG_PREFIX,
                message: `Failed to send connection message: ${error}`,
                debug: this.debugMode,
                type: "error",
            });
        }
    }

    async handleMessage(
        ws: WebSocket | ServerWebSocket<unknown>,
        message: string | ArrayBuffer,
    ) {
        try {
            log({
                prefix: this.LOG_PREFIX,
                message: "Handling WebSocket message",
                debug: this.debugMode,
                type: "debug",
                data: { message },
            });

            const data = JSON.parse(
                typeof message === "string" ? message : message.toString(),
            ) as Communication.WebSocket.Message;

            const sessionId = this.wsToSessionMap.get(ws);
            if (!sessionId) {
                const errorMsg =
                    Communication.WebSocket.createMessage<Communication.WebSocket.ErrorMessage>(
                        {
                            type: Communication.WebSocket.MessageType.ERROR,
                            message: "Session not found",
                        },
                    );
                ws.send(JSON.stringify(errorMsg));
                return;
            }

            const session = this.activeSessions.get(sessionId);
            if (!session) {
                const errorMsg =
                    Communication.WebSocket.createMessage<Communication.WebSocket.ErrorMessage>(
                        {
                            type: Communication.WebSocket.MessageType.ERROR,
                            message: "Session not found",
                        },
                    );
                ws.send(JSON.stringify(errorMsg));
                return;
            }

            session.lastHeartbeat = Date.now();

            switch (data.type) {
                case Communication.WebSocket.MessageType.HEARTBEAT: {
                    const heartbeatAck =
                        Communication.WebSocket.createMessage<Communication.WebSocket.HeartbeatAckMessage>(
                            {
                                type: Communication.WebSocket.MessageType
                                    .HEARTBEAT_ACK,
                            },
                        );
                    ws.send(JSON.stringify(heartbeatAck));
                    break;
                }
                case Communication.WebSocket.MessageType.CONFIG_REQUEST: {
                    if (!this.clientConfig) {
                        throw new Error("Client config not initialized");
                    }
                    const configMsg =
                        Communication.WebSocket.createMessage<Communication.WebSocket.ConfigResponseMessage>(
                            {
                                type: Communication.WebSocket.MessageType
                                    .CONFIG_RESPONSE,
                                config: this.clientConfig,
                            },
                        );
                    ws.send(JSON.stringify(configMsg));
                    break;
                }
                case Communication.WebSocket.MessageType.QUERY:
                    await this.handleQuery(
                        ws as ServerWebSocket<WebSocketData>,
                        data,
                    );
                    break;
                case Communication.WebSocket.MessageType.SUBSCRIBE:
                    await this.handleSubscribe(
                        ws as ServerWebSocket<WebSocketData>,
                        data,
                    );
                    break;
                case Communication.WebSocket.MessageType.UNSUBSCRIBE:
                    this.handleUnsubscribe(
                        ws as ServerWebSocket<WebSocketData>,
                        data,
                    );
                    break;
                default: {
                    const errorMsg =
                        Communication.WebSocket.createMessage<Communication.WebSocket.ErrorMessage>(
                            {
                                type: Communication.WebSocket.MessageType.ERROR,
                                message: "Unknown message type",
                            },
                        );
                    ws.send(JSON.stringify(errorMsg));
                }
            }
        } catch (error) {
            const errorMsg =
                Communication.WebSocket.createMessage<Communication.WebSocket.ErrorMessage>(
                    {
                        type: Communication.WebSocket.MessageType.ERROR,
                        message: "Invalid message format",
                    },
                );
            ws.send(JSON.stringify(errorMsg));
        }
    }

    handleDisconnect(sessionId: string) {
        const session = this.activeSessions.get(sessionId);
        if (session) {
            log({
                prefix: this.LOG_PREFIX,
                message: "WebSocket disconnection",
                debug: this.debugMode,
                type: "debug",
                data: {
                    sessionId,
                    agentId: session.agentId,
                    lastHeartbeat: new Date(
                        session.lastHeartbeat,
                    ).toISOString(),
                    timeSinceLastHeartbeat: Date.now() - session.lastHeartbeat,
                },
            });

            // Clean up both maps
            this.wsToSessionMap.delete(session.ws);
            this.activeSessions.delete(sessionId);

            // Clean up subscriptions
            for (const channel of session.subscriptions) {
                const channelSubs = this.channelSubscribers.get(channel);
                if (channelSubs) {
                    channelSubs.delete(sessionId);
                    if (channelSubs.size === 0) {
                        this.channelSubscribers.delete(channel);
                    }
                }
            }
        }
    }

    private async checkHeartbeats() {
        const now = Date.now();
        const sessionsToCheck = Array.from(this.activeSessions.entries());

        // Process sessions in parallel
        await Promise.all(
            sessionsToCheck.map(async ([sessionId, session]) => {
                // Check both heartbeat timeout and session validity
                if (
                    now - session.lastHeartbeat >
                    this.authConfig.ws_check_interval
                ) {
                    const token = this.tokenMap.get(session.ws);
                    if (
                        !token ||
                        !(
                            await validateSession(
                                this.sql,
                                this.debugMode,
                                this.authConfig,
                                token,
                            )
                        ).isValid
                    ) {
                        log({
                            prefix: this.LOG_PREFIX,
                            message:
                                "Session expired / invalid, closing WebSocket",
                            debug: this.debugMode,
                            type: "debug",
                            data: {
                                sessionId,
                                agentId: session.agentId,
                                lastHeartbeat: new Date(
                                    session.lastHeartbeat,
                                ).toISOString(),
                                timeSinceLastHeartbeat:
                                    Date.now() - session.lastHeartbeat,
                            },
                        });
                        session.ws.close(1000, "Session expired");
                        this.handleDisconnect(sessionId);
                    }
                }
            }),
        );
    }

    cleanup() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }

        // Cleanup all subscriptions
        for (const channelSubs of this.channelSubscribers.values()) {
            for (const subscription of channelSubs.values()) {
                subscription.unlisten();
            }
        }
        this.channelSubscribers.clear();

        for (const session of this.activeSessions.values()) {
            session.ws.close(1000, "Server shutting down");
        }
        this.activeSessions.clear();
    }

    async broadcastEntityUpdates(
        sessionId: string,
        changes: Tick.I_TickState["entityUpdates"],
        tickData: Tick.I_TickState["tickData"],
    ) {
        // Get the session
        const session = this.activeSessions.get(sessionId);
        if (!session || session.ws.readyState !== WebSocket.OPEN) {
            return;
        }

        // Filter entities that include this session ID
        const relevantEntities = changes
            .filter((change) => change.sessionIds.includes(sessionId))
            .map((change) => ({
                id: change.entityId,
                operation: change.operation,
                entityChanges: change.entityChanges,
                entityStatus: change.entityStatus,
            }));

        // If no relevant entities, don't send a message
        if (relevantEntities.length === 0) {
            return;
        }

        const notificationMsg =
            Communication.WebSocket.createMessage<Communication.WebSocket.NotificationEntityUpdatesMessage>(
                {
                    type: Communication.WebSocket.MessageType
                        .NOTIFICATION_ENTITY_UPDATE,
                    timestamp: new Date().toISOString(),
                    tick: tickData,
                    entities: relevantEntities,
                },
            );

        session.ws.send(JSON.stringify(notificationMsg));
    }

    async broadcastEntityScriptUpdates(
        sessionId: string,
        scriptChanges: Tick.I_TickState["scriptUpdates"],
        tickData: Tick.I_TickData,
    ) {
        // Get the session
        const session = this.activeSessions.get(sessionId);
        if (!session || session.ws.readyState !== WebSocket.OPEN) {
            return;
        }

        // Filter scripts that include this session ID
        const relevantScripts = scriptChanges
            .filter((change) => change.sessionIds.includes(sessionId))
            .map((change) => ({
                id: change.scriptId,
                operation: change.operation,
                scriptChanges: change.changes,
            }));

        // If no relevant scripts, don't send a message
        if (relevantScripts.length === 0) {
            return;
        }

        const notificationMsg =
            Communication.WebSocket.createMessage<Communication.WebSocket.NotificationEntityScriptUpdatesMessage>(
                {
                    type: Communication.WebSocket.MessageType
                        .NOTIFICATION_ENTITY_SCRIPT_UPDATE,
                    timestamp: new Date().toISOString(),
                    tick: tickData,
                    scripts: relevantScripts,
                },
            );

        session.ws.send(JSON.stringify(notificationMsg));
    }
}

export class WorldApiManager {
    private authConfig: AuthConfig | undefined;
    private oauthManager: WorldRestManager | undefined;
    private wsManager: WorldWebSocketManager | undefined;
    private server: Server | undefined;

    constructor(
        private sql: postgres.Sql,
        private readonly debugMode: boolean,
        private readonly config: typeof VircadiaConfig_Server,
    ) {}

    async initialize() {
        log({
            message: "Initializing world api manager",
            debug: this.debugMode,
            type: "debug",
        });

        // Load auth config
        const [config] = await this.sql`
            SELECT value FROM config.config WHERE key = 'auth_settings'
        `;
        this.authConfig = config.value as AuthConfig;

        // Initialize components
        this.oauthManager = new WorldRestManager(
            this.sql,
            this.debugMode,
            this.authConfig,
        );

        this.wsManager = new WorldWebSocketManager(
            this.sql,
            this.debugMode,
            this.authConfig,
        );

        await this.wsManager.initialize();

        // Start server
        this.server = Bun.serve({
            port: this.config.serverPort,
            hostname: this.config.serverHost,
            development: this.debugMode,

            fetch: async (req: Request, server: Server) => {
                const url = new URL(req.url);

                // Handle WebSocket upgrade
                if (url.pathname.startsWith(Communication.WS_PATH)) {
                    return await this.wsManager?.handleUpgrade(req, server);
                }

                // Handle HTTP routes
                if (url.pathname.startsWith(Communication.REST_BASE_PATH)) {
                    return await this.oauthManager?.handleRequest(req);
                }

                return new Response("Not Found", { status: 404 });
            },

            websocket: {
                message: (
                    ws: ServerWebSocket<WebSocketData>,
                    message: string,
                ) => {
                    log({
                        message: "WebSocket message received",
                        debug: this.debugMode,
                        type: "debug",
                    });
                    this.wsManager?.handleMessage(ws, message);
                },
                open: (ws: ServerWebSocket<WebSocketData>) => {
                    log({
                        message: "WebSocket connection opened",
                        debug: this.debugMode,
                        type: "debug",
                    });
                    this.wsManager?.handleConnection(ws, {
                        agentId: ws.data.agentId,
                        sessionId: ws.data.sessionId,
                    });
                },
                close: (
                    ws: ServerWebSocket<WebSocketData>,
                    code: number,
                    reason: string,
                ) => {
                    log({
                        message: `WebSocket connection closed, code: ${code}, reason: ${reason}`,
                        debug: this.debugMode,
                        type: "debug",
                    });
                    this.wsManager?.handleDisconnect(ws.data.sessionId);
                },
            },
        });

        log({
            message: `Bun HTTP+WS World API Server running at http://${this.config.serverHost}:${this.config.serverPort}`,
            type: "success",
        });
    }

    cleanup() {
        this.wsManager?.cleanup();
        this.server?.stop();
    }
}
