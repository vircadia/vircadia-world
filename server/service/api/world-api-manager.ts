// =============================================================================
// ============================== IMPORTS, TYPES, AND INTERFACES ==============================
// =============================================================================

import { log } from "../../../sdk/vircadia-world-sdk-ts/module/general/log.ts";
import type postgres from "postgres";
import { VircadiaConfig } from "../../../sdk/vircadia-world-sdk-ts/config/vircadia.config.ts";
import {
    Communication,
    type Auth,
    type Tick,
} from "../../../sdk/vircadia-world-sdk-ts/schema/schema.general.ts";
import type { Server, ServerWebSocket } from "bun";
import { PostgresClient } from "../../database/postgres/postgres_client.ts";
import { verify } from "jsonwebtoken";

export async function validateJWT(data: {
    jwtSecret?: string;
    token: string;
}): Promise<{ agentId: string; sessionId: string; isValid: boolean }> {
    const { jwtSecret, token } = data;

    try {
        if (!jwtSecret) {
            throw new Error("JWT secret is not set");
        }

        // Check for empty or malformed token first
        if (!token || token.split(".").length !== 3) {
            return {
                agentId: "",
                sessionId: "",
                isValid: false,
            };
        }

        const decoded = verify(token, jwtSecret) as {
            sessionId: string;
            agentId: string;
        };

        log({
            message: "JWT validation result",
            debug: VircadiaConfig.SERVER.DEBUG,
            suppress: VircadiaConfig.SERVER.SUPPRESS,
            type: "debug",
            data: {
                token,
                decoded,
            },
        });

        return {
            agentId: decoded.agentId,
            sessionId: decoded.sessionId,
            isValid: !!decoded.sessionId && !!decoded.agentId,
        };
    } catch (error) {
        log({
            message: `Session validation failed: ${error}`,
            debug: VircadiaConfig.SERVER.DEBUG,
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

// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------

// =============================================================================
// ======================= TICK MANAGER: Tick Loops and Cleanup Timers =======================
// =============================================================================

// #region WorldTickManager

class WorldTickManager {
    private intervalIds: Map<string, Timer> = new Map();
    private syncGroups: Map<string, Auth.SyncGroup.I_SyncGroup> = new Map();
    private tickCounts: Map<string, number> = new Map();

    private readonly LOG_PREFIX = "WorldTickManager";

    constructor(
        private readonly sql: postgres.Sql,
        private readonly worldApiManager: WorldApiManager,
    ) {}

    async initialize() {
        try {
            // Updated to use auth schema for sync groups
            const syncGroupsData = await this.sql<Auth.SyncGroup.I_SyncGroup[]>`
                SELECT * FROM auth.sync_groups
            `;

            for (const group of syncGroupsData) {
                this.syncGroups.set(group.general__sync_group, group);
            }
        } catch (error) {
            log({
                message: `Failed to initialize tick manager: ${error}`,
                debug: VircadiaConfig.SERVER.DEBUG,
                suppress: VircadiaConfig.SERVER.SUPPRESS,
                type: "error",
            });
            throw error;
        }

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
                this.intervalIds.set(syncGroup, setTimeout(tickLoop, delay));

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
    }

    private async processTick(syncGroup: string) {
        const localTotalStartTime = performance.now();

        const syncGroupConfig = this.syncGroups.get(syncGroup);
        if (!syncGroupConfig) {
            throw new Error(`Sync group ${syncGroup} not found`);
        }

        // Measure the time taken for the database operations
        const localDbStartTime = performance.now();
        const result = await this.sql.begin(async (sql) => {
            // Capture the tick state and get metadata directly
            const [tickData] = await sql<[Tick.I_Tick]>`
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

        await this.worldApiManager.sendWorldUpdatesToSyncGroup({ syncGroup });

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
    }
}

// #endregion

// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------

// =================================================================================
// ================ WORLD API MANAGER: Server Startup and Routing ==================
// =================================================================================

// #region WorldApiManager

export interface WorldSession<T = unknown> {
    ws: WebSocket | ServerWebSocket<T>;
    agentId: string;
    sessionId: string;
    lastHeartbeat: number;
}

export interface WebSocketData {
    token: string;
    agentId: string;
    sessionId: string;
}

export class WorldApiManager {
    private tickManager: WorldTickManager | undefined;
    private server: Server | undefined;
    private sql: postgres.Sql | undefined;
    private authConfig: {
        auth_config__jwt_secret: string | undefined;
        auth_config__heartbeat_inactive_expiry_ms: number | undefined;
    } = {
        auth_config__jwt_secret: undefined,
        auth_config__heartbeat_inactive_expiry_ms: undefined,
    };

    public activeSessions: Map<string, WorldSession<unknown>> = new Map();
    private heartbeatInterval: Timer | null = null;
    private tokenMap = new WeakMap<
        WebSocket | ServerWebSocket<unknown>,
        string
    >();
    private wsToSessionMap = new WeakMap<
        WebSocket | ServerWebSocket<unknown>,
        string
    >();

    private LOG_PREFIX = "WorldApiManager";

    async initialize() {
        try {
            log({
                message: "Initializing world api manager",
                debug: VircadiaConfig.SERVER.DEBUG,
                type: "debug",
            });

            // Initialize database connection using PostgresClient
            const postgresClient = PostgresClient.getInstance();
            await postgresClient.connect();
            this.sql = postgresClient.getClient();

            if (!this.sql) {
                log({
                    message: "Failed to initialize Postgres client",
                    debug: VircadiaConfig.SERVER.DEBUG,
                    type: "error",
                });
                throw new Error("Failed to initialize Postgres client");
            }

            // Load full config with proper typing
            [this.authConfig] = await this.sql<
                [
                    {
                        auth_config__jwt_secret: string;
                        auth_config__heartbeat_inactive_expiry_ms: number;
                    },
                ]
            >`
                SELECT 
                    auth_config__jwt_secret,
                    auth_config__heartbeat_inactive_expiry_ms
                FROM config.auth_config
            `;

            if (
                !this.authConfig.auth_config__jwt_secret ||
                !this.authConfig.auth_config__heartbeat_inactive_expiry_ms
            ) {
                log({
                    message: "Failed to load auth configuration",
                    error: this.authConfig,
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                    type: "error",
                });
                throw new Error("Failed to load auth configuration");
            }

            // Initialize Tick Manager after wsManager is ready
            this.tickManager = new WorldTickManager(this.sql, this);
            await this.tickManager.initialize();

            // Start server
            this.server = Bun.serve({
                port: VircadiaConfig.SERVER.SERVER_PORT,
                hostname: VircadiaConfig.SERVER.SERVER_HOST,
                development: VircadiaConfig.SERVER.DEBUG,

                fetch: async (req: Request, server: Server) => {
                    const url = new URL(req.url);

                    if (!this.sql) {
                        log({
                            message: "No database connection available",
                            debug: VircadiaConfig.SERVER.DEBUG,
                            type: "error",
                        });
                        return new Response("Internal server error", {
                            status: 500,
                        });
                    }

                    // Handle WebSocket upgrade
                    if (url.pathname.startsWith(Communication.WS_PATH)) {
                        const url = new URL(req.url);
                        const token = url.searchParams.get("token");

                        // Handle missing token first
                        if (!token) {
                            log({
                                prefix: this.LOG_PREFIX,
                                message: "No token found in query parameters",
                                debug: VircadiaConfig.SERVER.DEBUG,
                                type: "debug",
                            });
                            return new Response("Authentication required", {
                                status: 401,
                            });
                        }

                        const jwtValidationResult = await validateJWT({
                            jwtSecret: this.authConfig.auth_config__jwt_secret,
                            token,
                        });

                        if (!jwtValidationResult.isValid) {
                            log({
                                prefix: this.LOG_PREFIX,
                                message: "Token JWT validation failed",
                                debug: VircadiaConfig.SERVER.DEBUG,
                                type: "debug",
                            });
                            return new Response("Invalid token", {
                                status: 401,
                            });
                        }

                        const sessionValidationResult = await this.sql<
                            [{ is_valid: boolean }]
                        >`
                            SELECT * FROM auth.validate_session(${jwtValidationResult.sessionId}::UUID)
                        `;

                        if (!sessionValidationResult[0].is_valid) {
                            log({
                                prefix: this.LOG_PREFIX,
                                message: "Session validation failed",
                                debug: VircadiaConfig.SERVER.DEBUG,
                                type: "debug",
                            });
                            return new Response("Invalid session", {
                                status: 401,
                            });
                        }

                        // Only attempt upgrade if validation passes
                        const upgraded = server.upgrade(req, {
                            data: {
                                token,
                                agentId: jwtValidationResult.agentId,
                                sessionId: jwtValidationResult.sessionId,
                            },
                        });

                        if (!upgraded) {
                            log({
                                prefix: this.LOG_PREFIX,
                                message: "WebSocket upgrade failed",
                                debug: VircadiaConfig.SERVER.DEBUG,
                                type: "error",
                            });
                            return new Response("WebSocket upgrade failed", {
                                status: 500,
                            });
                        }

                        return undefined;
                    }

                    // Handle HTTP routes
                    if (url.pathname.startsWith(Communication.REST_BASE_PATH)) {
                        switch (true) {
                            case url.pathname ===
                                Communication.REST.Endpoint
                                    .AUTH_SESSION_VALIDATE.path &&
                                req.method === "GET": {
                                const token = req.headers
                                    .get("Authorization")
                                    ?.replace("Bearer ", "");
                                if (!token) {
                                    return Response.json(
                                        Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.createError(
                                            "No token provided",
                                        ),
                                        { status: 401 },
                                    );
                                }

                                const jwtValidationResult = await validateJWT({
                                    jwtSecret:
                                        this.authConfig.auth_config__jwt_secret,
                                    token,
                                });

                                if (!jwtValidationResult.isValid) {
                                    return Response.json(
                                        Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.createError(
                                            "Invalid token",
                                        ),
                                    );
                                }

                                const setSessionContextResult = await this.sql<
                                    [
                                        {
                                            set_agent_context_from_session_id: boolean;
                                        },
                                    ]
                                >`
                                    SELECT auth.set_agent_context_from_session_id(${jwtValidationResult.sessionId}::UUID, ${token}::TEXT) as set_agent_context_from_session_id
                                `;

                                if (
                                    !setSessionContextResult[0]
                                        .set_agent_context_from_session_id
                                ) {
                                    return Response.json(
                                        Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.createError(
                                            "Failed to set agent context",
                                        ),
                                    );
                                }

                                try {
                                    const sessionValidationResult = await this
                                        .sql<[{ is_valid: boolean }]>`
                                    SELECT * FROM auth.validate_session(${jwtValidationResult.sessionId}::UUID)
                                `;

                                    log({
                                        message:
                                            "Auth endpoint - Session validation result",
                                        debug: VircadiaConfig.SERVER.DEBUG,
                                        suppress:
                                            VircadiaConfig.SERVER.SUPPRESS,
                                        type: "debug",
                                        prefix: this.LOG_PREFIX,
                                        data: {
                                            jwtValidationResult,
                                            setSessionContextResult,
                                        },
                                    });

                                    return Response.json(
                                        Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.createSuccess(
                                            sessionValidationResult[0].is_valid,
                                        ),
                                    );
                                } catch (error) {
                                    log({
                                        message: "Failed to validate session",
                                        debug: VircadiaConfig.SERVER.DEBUG,
                                        type: "error",
                                        prefix: this.LOG_PREFIX,
                                        data: {
                                            error:
                                                error instanceof Error
                                                    ? error.message
                                                    : String(error),
                                        },
                                    });
                                    return Response.json(
                                        Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.createError(
                                            "Failed to validate session",
                                        ),
                                    );
                                }
                            }

                            case url.pathname ===
                                Communication.REST.Endpoint.AUTH_SESSION_LOGOUT
                                    .path && req.method === "POST": {
                                // TODO: On OAUTH, we must also invalidate the token on the OAUTH server as well as wiping it from our own session list.
                                const token = req.headers
                                    .get("Authorization")
                                    ?.replace("Bearer ", "");
                                if (!token) {
                                    return Response.json(
                                        Communication.REST.Endpoint.AUTH_SESSION_LOGOUT.createError(
                                            "No token provided",
                                        ),
                                        { status: 401 },
                                    );
                                }

                                const jwtValidationResult = await validateJWT({
                                    jwtSecret:
                                        this.authConfig.auth_config__jwt_secret,
                                    token,
                                });

                                if (!jwtValidationResult.isValid) {
                                    return Response.json(
                                        Communication.REST.Endpoint.AUTH_SESSION_LOGOUT.createError(
                                            "Invalid token",
                                        ),
                                    );
                                }

                                const [setSessionContextResult] = await this
                                    .sql<
                                    [
                                        {
                                            set_agent_context_from_session_id: boolean;
                                        },
                                    ]
                                >`
                                    SELECT auth.set_agent_context_from_session_id(${jwtValidationResult.sessionId}::UUID, ${token}::TEXT) as set_agent_context_from_session_id
                                `;

                                if (
                                    !setSessionContextResult.set_agent_context_from_session_id
                                ) {
                                    return Response.json(
                                        Communication.REST.Endpoint.AUTH_SESSION_LOGOUT.createError(
                                            "Failed to set agent context",
                                        ),
                                    );
                                }

                                try {
                                    // Call invalidate_session and check its boolean return value
                                    const [result] = await this.sql<
                                        [{ invalidate_session: boolean }]
                                    >`
                                        SELECT auth.invalidate_session(${jwtValidationResult.sessionId}::UUID) as invalidate_session;
                                    `;

                                    if (!result.invalidate_session) {
                                        throw new Error(
                                            "Failed to invalidate session",
                                        );
                                    }

                                    log({
                                        message:
                                            "Auth endpoint - Successfully logged out",
                                        debug: VircadiaConfig.SERVER.DEBUG,
                                        type: "debug",
                                        prefix: this.LOG_PREFIX,
                                        data: {
                                            jwtValidationResult,
                                            setSessionContextResult,
                                            result,
                                        },
                                    });

                                    return Response.json(
                                        Communication.REST.Endpoint.AUTH_SESSION_LOGOUT.createSuccess(),
                                    );
                                } catch (error) {
                                    log({
                                        message: "Failed to invalidate session",
                                        debug: VircadiaConfig.SERVER.DEBUG,
                                        type: "error",
                                        prefix: this.LOG_PREFIX,
                                        data: {
                                            error:
                                                error instanceof Error
                                                    ? error.message
                                                    : String(error),
                                        },
                                    });

                                    return Response.json(
                                        Communication.REST.Endpoint.AUTH_SESSION_LOGOUT.createError(
                                            "Failed to invalidate session",
                                        ),
                                    );
                                }
                            }

                            default:
                                return new Response("Not Found", {
                                    status: 404,
                                });
                        }
                    }

                    return new Response("Not Found", { status: 404 });
                },

                websocket: {
                    message: async (
                        ws: ServerWebSocket<WebSocketData>,
                        message: string,
                    ) => {
                        log({
                            message: "WebSocket message received",
                            debug: VircadiaConfig.SERVER.DEBUG,
                            type: "debug",
                        });
                        let data: Communication.WebSocket.Message | undefined;

                        if (!this.sql) {
                            log({
                                message: "No database connection available",
                                debug: VircadiaConfig.SERVER.DEBUG,
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

                            if (!sessionToken || !sessionId || !session) {
                                ws.send(
                                    JSON.stringify(
                                        new Communication.WebSocket.GeneralErrorResponseMessage(
                                            "Invalid session",
                                        ),
                                    ),
                                );
                                return;
                            }

                            // Validate JWT
                            const jwtValidationResult = await validateJWT({
                                jwtSecret:
                                    this.authConfig.auth_config__jwt_secret,
                                token: sessionToken,
                            });

                            if (!jwtValidationResult.isValid) {
                                session.ws.send(
                                    JSON.stringify(
                                        new Communication.WebSocket.GeneralErrorResponseMessage(
                                            "Invalid token",
                                        ),
                                    ),
                                );
                                return;
                            }

                            const setSessionContextResult = await this.sql<
                                [{ set_agent_context_from_session_id: boolean }]
                            >`
                                SELECT auth.set_agent_context_from_session_id(${sessionId}::UUID, ${sessionToken}::TEXT) as set_agent_context_from_session_id
                            `;

                            if (
                                !setSessionContextResult[0]
                                    .set_agent_context_from_session_id
                            ) {
                                session.ws.send(
                                    JSON.stringify(
                                        new Communication.WebSocket.GeneralErrorResponseMessage(
                                            "Failed to set agent context",
                                        ),
                                    ),
                                );
                                return;
                            }

                            // Update heartbeat
                            session.lastHeartbeat = Date.now();

                            // Parse message
                            data = JSON.parse(
                                message,
                            ) as Communication.WebSocket.Message;

                            // Handle different message types
                            switch (data.type) {
                                case Communication.WebSocket.MessageType
                                    .HEARTBEAT_REQUEST: {
                                    ws.send(
                                        JSON.stringify(
                                            new Communication.WebSocket.HeartbeatResponseMessage(
                                                session.agentId,
                                            ),
                                        ),
                                    );
                                    break;
                                }

                                case Communication.WebSocket.MessageType
                                    .CLIENT_CONFIG_REQUEST: {
                                    ws.send(
                                        JSON.stringify(
                                            new Communication.WebSocket.ClientConfigResponseMessage(
                                                {},
                                            ),
                                        ),
                                    );
                                    break;
                                }

                                case Communication.WebSocket.MessageType
                                    .QUERY_REQUEST: {
                                    const typedRequest =
                                        data as Communication.WebSocket.QueryRequestMessage;
                                    try {
                                        const results = await this.sql?.begin(
                                            async (sql) => {
                                                return await sql.unsafe(
                                                    typedRequest.query,
                                                    typedRequest.parameters ||
                                                        [],
                                                );
                                            },
                                        );

                                        ws.send(
                                            JSON.stringify(
                                                new Communication.WebSocket.QueryResponseMessage(
                                                    results,
                                                ),
                                            ),
                                        );
                                    } catch (error) {
                                        session.ws.send(
                                            JSON.stringify(
                                                new Communication.WebSocket.GeneralErrorResponseMessage(
                                                    "Query failed",
                                                ),
                                            ),
                                        );

                                        throw error;
                                    }
                                    break;
                                }

                                default: {
                                    session.ws.send(
                                        JSON.stringify(
                                            new Communication.WebSocket.GeneralErrorResponseMessage(
                                                `Unsupported message type: ${data.type}`,
                                            ),
                                        ),
                                    );
                                }
                            }
                        } catch (error) {
                            log({
                                type: "error",
                                message: "Received WS message handling failed.",
                                error: error,
                                suppress: VircadiaConfig.SERVER.SUPPRESS,
                                debug: VircadiaConfig.SERVER.DEBUG,
                            });
                        }
                    },
                    open: (ws: ServerWebSocket<WebSocketData>) => {
                        const sessionData = ws.data;

                        log({
                            prefix: this.LOG_PREFIX,
                            message: "New WebSocket connection attempt",
                            debug: VircadiaConfig.SERVER.DEBUG,
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
                        };

                        this.activeSessions.set(sessionData.sessionId, session);
                        this.wsToSessionMap.set(ws, sessionData.sessionId);
                        this.tokenMap.set(
                            ws,
                            (ws as ServerWebSocket<WebSocketData>).data.token,
                        );

                        try {
                            const connectionMsg =
                                new Communication.WebSocket.ConnectionEstablishedResponseMessage(
                                    sessionData.agentId,
                                );
                            ws.send(JSON.stringify(connectionMsg));
                            log({
                                prefix: this.LOG_PREFIX,
                                message: `Connection established with agent ${sessionData.agentId}`,
                                debug: VircadiaConfig.SERVER.DEBUG,
                                type: "debug",
                            });
                        } catch (error) {
                            log({
                                prefix: this.LOG_PREFIX,
                                message: `Failed to send connection message: ${error}`,
                                debug: VircadiaConfig.SERVER.DEBUG,
                                type: "error",
                            });
                        }
                    },
                    close: (
                        ws: ServerWebSocket<WebSocketData>,
                        code: number,
                        reason: string,
                    ) => {
                        log({
                            message: `WebSocket connection closed, code: ${code}, reason: ${reason}`,
                            debug: VircadiaConfig.SERVER.DEBUG,
                            type: "debug",
                        });
                        const session = this.activeSessions.get(
                            ws.data.sessionId,
                        );
                        if (session) {
                            log({
                                prefix: this.LOG_PREFIX,
                                message: "WebSocket disconnection",
                                debug: VircadiaConfig.SERVER.DEBUG,
                                suppress: VircadiaConfig.SERVER.SUPPRESS,
                                type: "debug",
                                data: {
                                    sessionId: session.sessionId,
                                    agentId: session.agentId,
                                    lastHeartbeat: new Date(
                                        session.lastHeartbeat,
                                    ).toISOString(),
                                    timeSinceLastHeartbeat:
                                        Date.now() - session.lastHeartbeat,
                                },
                            });

                            // Clean up both maps
                            this.wsToSessionMap.delete(session.ws);
                            this.activeSessions.delete(session.sessionId);
                        }
                    },
                },
            });

            this.heartbeatInterval = setInterval(async () => {
                const now = Date.now();
                const sessionsToCheck = Array.from(
                    this.activeSessions.entries(),
                );

                // Process sessions in parallel
                await Promise.all(
                    sessionsToCheck.map(async ([sessionId, session]) => {
                        if (
                            !this.authConfig
                                .auth_config__heartbeat_inactive_expiry_ms
                        ) {
                            throw new Error("WebSocket check interval not set");
                        }

                        // Check heartbeat timeout first
                        if (
                            now - session.lastHeartbeat >
                            this.authConfig
                                .auth_config__heartbeat_inactive_expiry_ms
                        ) {
                            // Use database validate_session function
                            const [validation] = await this.sql<
                                [
                                    {
                                        auth__agent_id: string | null;
                                        is_valid: boolean;
                                        session_token: string | null;
                                    },
                                ]
                            >`
                                    SELECT * FROM auth.validate_session(${sessionId}::UUID)
                                `;

                            if (!validation?.is_valid) {
                                log({
                                    prefix: this.LOG_PREFIX,
                                    message:
                                        "Session expired / invalid, closing WebSocket",
                                    debug: VircadiaConfig.SERVER.DEBUG,
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
                            }
                        }
                    }),
                );
            }, 1000);

            log({
                message: `Bun HTTP+WS World API Server running at http://${VircadiaConfig.SERVER.SERVER_HOST}:${VircadiaConfig.SERVER.SERVER_PORT}`,
                type: "success",
            });
        } catch (error) {
            log({
                message: `Failed to initialize WorldApiManager: ${error}`,
                type: "error",
                debug: true,
            });
            throw error;
        }
    }

    public async sendWorldUpdatesToSyncGroup(data: {
        syncGroup: string;
    }): Promise<void> {
        if (!this.sql) {
            log({
                message: "No database connection available",
                debug: VircadiaConfig.SERVER.DEBUG,
                type: "error",
            });
            return;
        }

        // Fetch active sessions for the sync group with proper type checking
        const sessions = await this.sql<{ active_session_ids: string[] }[]>`
            SELECT active_session_ids
            FROM auth.active_sync_group_sessions
            WHERE group__sync = ${data.syncGroup}
        `;

        // Early return if no active sessions found
        if (
            !sessions ||
            sessions.length === 0 ||
            !sessions[0]?.active_session_ids
        ) {
            return;
        }

        const updatePackage: Communication.WebSocket.SyncGroupUpdatesResponseMessage =
            new Communication.WebSocket.SyncGroupUpdatesResponseMessage(
                [],
                [],
                [],
            );

        // Fetch all changes.
        try {
            updatePackage.entities = await this.sql<Tick.I_EntityUpdate[]>`
                    SELECT 
                        general__entity_id,
                        operation,
                        changes
                    FROM tick.get_changed_entity_states_between_latest_ticks(${data.syncGroup})
                `.then((result) => {
                return result.map((e) => ({
                    entityId: e.general__entity_id,
                    operation: e.operation,
                    changes: e.changes,
                    error: null,
                }));
            });
        } catch (error) {
            log({
                message: `Error fetching entity updates: ${error}`,
                debug: VircadiaConfig.SERVER.DEBUG,
                suppress: VircadiaConfig.SERVER.SUPPRESS,
                type: "error",
            });
        }

        try {
            updatePackage.scripts = await this.sql<Tick.I_ScriptUpdate[]>`
                    SELECT 
                        general__script_id,
                        operation,
                        changes
                    FROM tick.get_changed_script_states_between_latest_ticks(${data.syncGroup})
                `.then((result) => {
                return result.map((s) => ({
                    scriptId: s.general__script_id,
                    operation: s.operation,
                    changes: s.changes,
                    error: null,
                }));
            });
        } catch (error) {
            log({
                message: `Error fetching script updates: ${error}`,
                debug: VircadiaConfig.SERVER.DEBUG,
                suppress: VircadiaConfig.SERVER.SUPPRESS,
                type: "error",
            });
        }

        try {
            updatePackage.assets = await this.sql<Tick.I_AssetUpdate[]>`
                    SELECT 
                        general__asset_id,
                        operation,
                        changes
                    FROM tick.get_changed_asset_states_between_latest_ticks(${data.syncGroup})
                `.then((result) => {
                return result.map((a) => ({
                    assetId: a.general__asset_id,
                    operation: a.operation,
                    changes: a.changes,
                    error: null,
                }));
            });
        } catch (error) {
            log({
                message: `Error fetching asset updates: ${error}`,
                debug: VircadiaConfig.SERVER.DEBUG,
                suppress: VircadiaConfig.SERVER.SUPPRESS,
                type: "error",
            });
        }

        // If there are no changes at all, just return
        if (
            (!Array.isArray(updatePackage.entities) ||
                updatePackage.entities.length === 0) &&
            (!Array.isArray(updatePackage.scripts) ||
                updatePackage.scripts.length === 0) &&
            (!Array.isArray(updatePackage.assets) ||
                updatePackage.assets.length === 0)
        ) {
            return;
        }

        // Update the sessions loop to use the corrected array
        const updatePromises = sessions[0].active_session_ids.map(
            async (sessionId) => {
                const session = this.activeSessions.get(sessionId);
                if (!session?.ws) {
                    log({
                        message: `Session ${sessionId} not found`,
                        debug: VircadiaConfig.SERVER.DEBUG,
                        suppress: VircadiaConfig.SERVER.SUPPRESS,
                        type: "debug",
                    });
                    return;
                }

                session.ws.send(JSON.stringify(updatePackage));
            },
        );

        // Fire and forget
        Promise.all(updatePromises).catch((error) => {
            log({
                message: "Error sending sync group updates.",
                error: error,
                debug: VircadiaConfig.SERVER.DEBUG,
                suppress: VircadiaConfig.SERVER.SUPPRESS,
                type: "error",
            });
        });
    }

    cleanup() {
        this.tickManager?.stop();
        this.server?.stop().finally(() => {
            if (this.heartbeatInterval) {
                clearInterval(this.heartbeatInterval);
            }

            for (const session of this.activeSessions.values()) {
                session.ws.close(1000, "Server shutting down");
            }
            this.activeSessions.clear();
        });
        PostgresClient.getInstance().disconnect();
    }
}

// Add command line entry point
if (import.meta.main) {
    try {
        const manager = new WorldApiManager();
        await manager.initialize();

        // Handle cleanup on process termination
        process.on("SIGINT", () => {
            log({
                message: "\nReceived SIGINT. Cleaning up...",
                debug: VircadiaConfig.SERVER.DEBUG,
                type: "debug",
            });
            manager.cleanup();
            process.exit(0);
        });

        process.on("SIGTERM", () => {
            log({
                message: "\nReceived SIGTERM. Cleaning up...",
                debug: VircadiaConfig.SERVER.DEBUG,
                type: "debug",
            });
            manager.cleanup();
            process.exit(0);
        });
    } catch (error) {
        log({
            message: `Failed to start WorldApiManager: ${error}`,
            type: "error",
            debug: true,
        });
        process.exit(1);
    }
}

// #endregion
