import { log } from "../../sdk/vircadia-world-sdk-ts/module/general/log";
import type postgres from "postgres";
import { sign, verify } from "jsonwebtoken";
import type { VircadiaConfig_Server } from "../../sdk/vircadia-world-sdk-ts/config/vircadia.config.ts";
import { Communication } from "../../sdk/vircadia-world-sdk-ts/schema/schema.general";
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
            SELECT * FROM validate_session(${decoded.sessionId}::UUID)
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

        try {
            // Even if the token is invalid, we should return success since the session is effectively "logged out"
            if (!validation.isValid) {
                return Response.json(
                    Communication.REST.Endpoint.AUTH_SESSION_LOGOUT.createSuccess(),
                );
            }

            // Call invalidate_session and check its boolean return value
            const [result] = await this.sql<[{ invalidate_session: boolean }]>`
                SELECT invalidate_session(${validation.sessionId}::UUID) as invalidate_session;
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
              heartbeat: {
                  interval: number;
                  timeout: number;
              };
              session: {
                  max_session_age_ms: number;
                  cleanup_interval_ms: number;
                  inactive_timeout_ms: number;
              };
          }
        | undefined;
    private channelSubscribers: Map<string, Set<string>> = new Map();
    private pgListener: postgres.SubscriptionHandle | null = null;

    private readonly LOG_PREFIX = "WorldWebSocketManager";

    constructor(
        private readonly sql: postgres.Sql,
        private readonly debugMode: boolean,
        private readonly authConfig: AuthConfig,
    ) {
        // Initialize PostgreSQL notification listener
        this.initializePgListener();
    }

    private async initializePgListener() {
        try {
            this.pgListener = await this.sql.subscribe(
                "entity_changes",
                (payload) => {
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
                        log({
                            prefix: this.LOG_PREFIX,
                            message: "Received entity change notification",
                            type: "debug",
                            data: { payload },
                            debug: true,
                        });

                        const notificationData = JSON.parse(payload.toString());
                        const subscribers =
                            this.channelSubscribers.get("entity_changes");

                        if (!subscribers) {
                            log({
                                prefix: this.LOG_PREFIX,
                                message:
                                    "No subscribers found for entity_changes",
                                type: "debug",
                                debug: true,
                            });
                            return;
                        }

                        // Match the database notification format
                        const notificationMsg =
                            Communication.WebSocket.createMessage<Communication.WebSocket.NotificationMessage>(
                                {
                                    type: Communication.WebSocket.MessageType
                                        .NOTIFICATION,
                                    channel: "entity_changes",
                                    payload: {
                                        entity_id: notificationData.entity_id,
                                        operation: notificationData.operation,
                                        type: notificationData.type,
                                        sync_group: notificationData.sync_group,
                                        timestamp: notificationData.timestamp,
                                        agent_id: notificationData.agent_id,
                                    },
                                },
                            );

                        const message = JSON.stringify(notificationMsg);

                        for (const sessionId of subscribers) {
                            log({
                                prefix: this.LOG_PREFIX,
                                message: "Sending entity change notification",
                                type: "debug",
                                data: {
                                    sessionId,
                                    message,
                                },
                                debug: true,
                            });

                            const session = this.activeSessions.get(sessionId);
                            if (session?.ws.readyState === WebSocket.OPEN) {
                                session.ws.send(message);
                            }
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
        } catch (error) {
            log({
                prefix: this.LOG_PREFIX,
                message:
                    "Failed to initialize PostgreSQL notification listener",
                type: "error",
                error,
            });
        }
    }

    private async handleQuery(
        ws: ServerWebSocket<WebSocketData>,
        message: Communication.WebSocket.QueryMessage,
    ) {
        const sessionId = this.wsToSessionMap.get(ws);
        const session = sessionId
            ? this.activeSessions.get(sessionId)
            : undefined;

        if (!session) {
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

            // Execute query as the user
            const results = await this.sql.begin(async (sql) => {
                await sql`SELECT set_config('app.current_agent_id', ${session.agentId}, true)`;
                return await sql.unsafe(
                    message.query,
                    message.parameters || [],
                );
            });

            log({
                prefix: this.LOG_PREFIX,
                message: "Query execution completed",
                type: "debug",
                data: {
                    results,
                },
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
                data: {
                    message,
                },
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
        const session = sessionId
            ? this.activeSessions.get(sessionId)
            : undefined;

        if (!session || !sessionId) {
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

            // Add to channel subscribers
            if (!this.channelSubscribers.has(message.channel)) {
                this.channelSubscribers.set(message.channel, new Set());
            }
            this.channelSubscribers.get(message.channel)?.add(sessionId);

            // Add to session subscriptions
            session.subscriptions.add(message.channel);

            log({
                prefix: this.LOG_PREFIX,
                message: "Subscription successful",
                debug: this.debugMode,
                type: "debug",
                data: {
                    channel: message.channel,
                    sessionId,
                    subscriberCount: this.channelSubscribers.get(
                        message.channel,
                    )?.size,
                },
            });

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

        // Remove from channel subscribers
        const channelSubs = this.channelSubscribers.get(message.channel);
        if (channelSubs) {
            channelSubs.delete(sessionId);
            if (channelSubs.size === 0) {
                this.channelSubscribers.delete(message.channel);
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
        if (this.pgListener) {
            this.pgListener.unsubscribe();
        }
        for (const session of this.activeSessions.values()) {
            session.ws.close(1000, "Server shutting down");
        }
        this.activeSessions.clear();
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
