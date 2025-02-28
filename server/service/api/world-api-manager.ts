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

let superUserSql: postgres.Sql | null = null;
let proxyUserSql: postgres.Sql | null = null;

export async function validateJWT(data: {
    provider: string;
    token: string;
}): Promise<{ agentId: string; sessionId: string; isValid: boolean }> {
    const { provider, token } = data;

    if (!superUserSql) {
        throw new Error("No database connection available");
    }

    try {
        if (!provider) {
            throw new Error("Provider is not set.");
        }

        // Check for empty or malformed token first
        if (!token || token.split(".").length !== 3) {
            return {
                agentId: "",
                sessionId: "",
                isValid: false,
            };
        }

        // Fetch JWT secret for this provider
        const [providerConfig] = await superUserSql<
            [{ provider__jwt_secret: string }]
        >`
            SELECT provider__jwt_secret
            FROM auth.auth_providers
            WHERE provider__name = ${provider}
              AND provider__enabled = true
        `;

        if (!providerConfig) {
            throw new Error(`Provider ${provider} not found or not enabled.`);
        }

        const jwtSecret = providerConfig.provider__jwt_secret;

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

    constructor(private readonly worldApiManager: WorldApiManager) {}

    async initialize() {
        try {
            superUserSql = await PostgresClient.getInstance().getSuperClient();
            proxyUserSql = await PostgresClient.getInstance().getProxyClient();

            // Updated to use auth schema for sync groups
            const syncGroupsData = await superUserSql<
                Auth.SyncGroup.I_SyncGroup[]
            >`
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
        const result = await superUserSql?.begin(async (tx) => {
            // Capture the tick state and get metadata directly
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
}

export interface WebSocketData {
    token: string;
    agentId: string;
    sessionId: string;
}

export class WorldApiManager {
    private tickManager: WorldTickManager | undefined;
    private server: Server | undefined;

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

            superUserSql = await PostgresClient.getInstance().getSuperClient();
            proxyUserSql = await PostgresClient.getInstance().getProxyClient();

            // Initialize Tick Manager after wsManager is ready
            this.tickManager = new WorldTickManager(this);
            await this.tickManager.initialize();

            // Start server
            this.server = Bun.serve({
                port: VircadiaConfig.SERVER.SERVER_PORT,
                hostname: VircadiaConfig.SERVER.SERVER_HOST,
                development: VircadiaConfig.SERVER.DEBUG,

                // #region API -> HTTP Routes
                fetch: async (req: Request, server: Server) => {
                    const url = new URL(req.url);

                    if (!superUserSql || !proxyUserSql) {
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
                    if (
                        url.pathname.startsWith(Communication.WS_UPGRADE_PATH)
                    ) {
                        const url = new URL(req.url);
                        const token = url.searchParams.get("token");
                        const provider = url.searchParams.get("provider");

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

                        // Handle missing provider
                        if (!provider) {
                            log({
                                prefix: this.LOG_PREFIX,
                                message:
                                    "No provider found in query parameters",
                                debug: VircadiaConfig.SERVER.DEBUG,
                                type: "debug",
                            });
                            return new Response("Provider required", {
                                status: 401,
                            });
                        }

                        const jwtValidationResult = await validateJWT({
                            provider,
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

                        const sessionValidationResult = await proxyUserSql<
                            [{ is_valid: boolean }]
                        >`
                            SELECT * FROM auth.validate_session_id(${jwtValidationResult.sessionId}::UUID)
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
                                req.method === "POST": {
                                // Parse request body to get token and provider
                                let body: {
                                    token: string;
                                    provider: string;
                                };
                                try {
                                    body = await req.json();

                                    // Validate required fields
                                    if (!body.token) {
                                        return Response.json(
                                            Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.createError(
                                                "No token provided",
                                            ),
                                            { status: 401 },
                                        );
                                    }

                                    if (!body.provider) {
                                        return Response.json(
                                            Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.createError(
                                                "No provider specified",
                                            ),
                                            { status: 400 },
                                        );
                                    }
                                } catch (error) {
                                    return Response.json(
                                        Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.createError(
                                            "Invalid request body",
                                        ),
                                        { status: 400 },
                                    );
                                }

                                const { token, provider } = body;

                                const jwtValidationResult = await validateJWT({
                                    provider,
                                    token,
                                });

                                if (!jwtValidationResult.isValid) {
                                    return Response.json(
                                        Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.createError(
                                            "Invalid token",
                                        ),
                                        { status: 401 },
                                    );
                                }

                                try {
                                    // Wrap the entire validation logic in a transaction
                                    return await proxyUserSql.begin(
                                        async (tx) => {
                                            // Set the agent context within the transaction
                                            const [setSessionContextResult] =
                                                await tx<
                                                    [
                                                        {
                                                            set_agent_context_from_agent_id: boolean;
                                                        },
                                                    ]
                                                >`
                                            SELECT auth.set_agent_context_from_agent_id(${jwtValidationResult.sessionId}::UUID, ${token}::TEXT) as set_agent_context_from_agent_id
                                        `;

                                            if (
                                                !setSessionContextResult.set_agent_context_from_agent_id
                                            ) {
                                                return Response.json(
                                                    Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.createError(
                                                        "Failed to set agent context",
                                                    ),
                                                );
                                            }

                                            // Execute validation within the same transaction context
                                            const [sessionValidationResult] =
                                                await tx<
                                                    [{ is_valid: boolean }]
                                                >`
                                            SELECT * FROM auth.validate_session_id(${jwtValidationResult.sessionId}::UUID)
                                        `;

                                            log({
                                                message:
                                                    "Auth endpoint - Session validation result",
                                                debug: VircadiaConfig.SERVER
                                                    .DEBUG,
                                                suppress:
                                                    VircadiaConfig.SERVER
                                                        .SUPPRESS,
                                                type: "debug",
                                                prefix: this.LOG_PREFIX,
                                                data: {
                                                    jwtValidationResult,
                                                    setSessionContextResult,
                                                },
                                            });

                                            return Response.json(
                                                Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.createSuccess(
                                                    jwtValidationResult.agentId,
                                                    jwtValidationResult.sessionId,
                                                ),
                                            );
                                        },
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

                            default:
                                return new Response("Not Found", {
                                    status: 404,
                                });
                        }
                    }

                    return new Response("Not Found", { status: 404 });
                },
                // #endregion

                // #region API -> WS Routes
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

                        if (!superUserSql || !proxyUserSql) {
                            log({
                                message: "No database connections available",
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
                                ws.close(1000, "Invalid session");
                                return;
                            }

                            // Update session heartbeat in database (don't await)
                            superUserSql`SELECT auth.update_session_heartbeat(${sessionId}::UUID)`.catch(
                                (error) => {
                                    log({
                                        message:
                                            "Failed to update session heartbeat",
                                        debug: VircadiaConfig.SERVER.DEBUG,
                                        type: "error",
                                        prefix: this.LOG_PREFIX,
                                        data: { error, sessionId },
                                    });
                                },
                            );

                            // Parse message
                            data = JSON.parse(
                                message,
                            ) as Communication.WebSocket.Message;

                            // Handle different message types
                            switch (data.type) {
                                case Communication.WebSocket.MessageType
                                    .HEARTBEAT_REQUEST: {
                                    await superUserSql`SELECT auth.update_session_heartbeat(${sessionId}::UUID)`
                                        .catch((error) => {
                                            ws.send(
                                                JSON.stringify(
                                                    new Communication.WebSocket.GeneralErrorResponseMessage(
                                                        "Failed to update heartbeat",
                                                    ),
                                                ),
                                            );
                                        })
                                        .then(() => {
                                            ws.send(
                                                JSON.stringify(
                                                    new Communication.WebSocket.HeartbeatResponseMessage(
                                                        session.agentId,
                                                    ),
                                                ),
                                            );
                                        });
                                    break;
                                }

                                case Communication.WebSocket.MessageType
                                    .QUERY_REQUEST: {
                                    const typedRequest =
                                        data as Communication.WebSocket.QueryRequestMessage;
                                    try {
                                        const results =
                                            await proxyUserSql?.begin(
                                                async (tx) => {
                                                    const [setAgentContext] =
                                                        await tx`
                                                        SELECT auth.set_agent_context_from_agent_id(${sessionId}::UUID, ${sessionToken}::TEXT)
                                                    `;

                                                    return await tx.unsafe(
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

                                case Communication.WebSocket.MessageType
                                    .SESSION_INVALIDATION_REQUEST: {
                                    try {
                                        // Get session information
                                        const sessionToken =
                                            this.tokenMap.get(ws);
                                        const sessionId =
                                            this.wsToSessionMap.get(ws);

                                        if (!sessionToken || !sessionId) {
                                            ws.send(
                                                JSON.stringify(
                                                    new Communication.WebSocket.GeneralErrorResponseMessage(
                                                        "Invalid session for logout",
                                                    ),
                                                ),
                                            );
                                            return;
                                        }

                                        const typedRequest =
                                            data as Communication.WebSocket.SessionInvalidationRequestMessage;

                                        // Wrap the entire logout logic in a transaction
                                        const logoutResult =
                                            await proxyUserSql.begin(
                                                async (tx) => {
                                                    // Set the agent context within the transaction
                                                    const [
                                                        setSessionContextResult,
                                                    ] = await tx<
                                                        [
                                                            {
                                                                set_agent_context_from_agent_id: boolean;
                                                            },
                                                        ]
                                                    >`
                                                SELECT auth.set_agent_context_from_agent_id(${sessionId}::UUID, ${sessionToken}::TEXT) as set_agent_context_from_agent_id
                                            `;

                                                    if (
                                                        !setSessionContextResult.set_agent_context_from_agent_id
                                                    ) {
                                                        return {
                                                            success: false,
                                                            message:
                                                                "Failed to set agent context",
                                                        };
                                                    }

                                                    // Call invalidate_session within the same transaction context
                                                    const [result] = await tx<
                                                        [
                                                            {
                                                                invalidate_session: boolean;
                                                            },
                                                        ]
                                                    >`
                                                SELECT auth.invalidate_session(${typedRequest.sessionId}::UUID) as invalidate_session;
                                            `;

                                                    if (
                                                        !result.invalidate_session
                                                    ) {
                                                        return {
                                                            success: false,
                                                            message:
                                                                "Failed to invalidate session",
                                                        };
                                                    }

                                                    log({
                                                        message:
                                                            "WebSocket - Successfully logged out",
                                                        debug: VircadiaConfig
                                                            .SERVER.DEBUG,
                                                        type: "debug",
                                                        prefix: this.LOG_PREFIX,
                                                        data: {
                                                            sessionId,
                                                            result,
                                                        },
                                                    });

                                                    return { success: true };
                                                },
                                            );

                                        if (!logoutResult.success) {
                                            ws.send(
                                                JSON.stringify(
                                                    new Communication.WebSocket.GeneralErrorResponseMessage(
                                                        logoutResult.message ||
                                                            "Logout failed",
                                                    ),
                                                ),
                                            );
                                            return;
                                        }

                                        // Send success response
                                        ws.send(
                                            JSON.stringify(
                                                new Communication.WebSocket.SessionInvalidationResponseMessage(
                                                    sessionId,
                                                ),
                                            ),
                                        );

                                        // Close the websocket after logout
                                        setTimeout(() => {
                                            ws.close(1000, "Logged out");
                                        }, 100);
                                    } catch (error) {
                                        log({
                                            message:
                                                "Failed to process logout request",
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

                                        ws.send(
                                            JSON.stringify(
                                                new Communication.WebSocket.GeneralErrorResponseMessage(
                                                    "Failed to process logout request",
                                                ),
                                            ),
                                        );
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
                                },
                            });

                            // Clean up both maps
                            this.wsToSessionMap.delete(session.ws);
                            this.activeSessions.delete(session.sessionId);
                        }
                    },
                },

                // #endregion
            });

            // #region Heartbeat Interval

            this.heartbeatInterval = setInterval(async () => {
                const sessionsToCheck = Array.from(
                    this.activeSessions.entries(),
                );

                // Process sessions in parallel
                await Promise.all(
                    sessionsToCheck.map(async ([sessionId, session]) => {
                        if (!superUserSql) {
                            throw new Error(
                                "No super user database connection available",
                            );
                        }

                        // Check session validity directly in database
                        const [validation] = await superUserSql<
                            [
                                {
                                    is_valid: boolean;
                                },
                            ]
                        >`
                            SELECT * FROM auth.validate_session_id(${sessionId}::UUID)
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
                                },
                            });
                            session.ws.close(1000, "Session expired");
                        }
                    }),
                );
            }, 1000);

            log({
                message: `Bun HTTP+WS World API Server running at http://${VircadiaConfig.SERVER.SERVER_HOST}:${VircadiaConfig.SERVER.SERVER_PORT}`,
                type: "success",
                debug: VircadiaConfig.SERVER.DEBUG,
                suppress: VircadiaConfig.SERVER.SUPPRESS,
            });

            // #endregion
        } catch (error) {
            log({
                message: `Failed to initialize WorldApiManager: ${error}`,
                type: "error",
                debug: VircadiaConfig.SERVER.DEBUG,
                suppress: VircadiaConfig.SERVER.SUPPRESS,
            });
            throw error;
        }
    }

    // #region World Updates
    public async sendWorldUpdatesToSyncGroup(data: {
        syncGroup: string;
    }): Promise<void> {
        if (!superUserSql) {
            log({
                message: "No database connection available",
                debug: VircadiaConfig.SERVER.DEBUG,
                type: "error",
                suppress: VircadiaConfig.SERVER.SUPPRESS,
            });
            return;
        }

        // Fetch active sessions for the sync group with proper type checking
        const sessionRecords = await superUserSql<
            { general__session_id: string }[]
        >`
            SELECT general__session_id
            FROM auth.active_sync_group_sessions
            WHERE group__sync = ${data.syncGroup}
        `;

        // Early return if no active sessions found
        if (!sessionRecords || sessionRecords.length === 0) {
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
            updatePackage.entities = await superUserSql<Tick.I_EntityUpdate[]>`
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
            updatePackage.scripts = await superUserSql<Tick.I_ScriptUpdate[]>`
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
            updatePackage.assets = await superUserSql<Tick.I_AssetUpdate[]>`
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

        // Update the sessions loop to use the individual session records
        const updatePromises = sessionRecords.map(async (record) => {
            const sessionId = record.general__session_id;
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
        });

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
    // #endregion

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

// #endregion

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
