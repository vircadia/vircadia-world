// =============================================================================
// ============================== IMPORTS, TYPES, AND INTERFACES ==============================
// =============================================================================

import { log } from "../vircadia-world-sdk-ts/module/general/log.ts";
import type postgres from "postgres";
import { VircadiaConfig } from "../vircadia-world-sdk-ts/config/vircadia.config.ts";
import {
    Communication,
    Service,
    type Tick,
} from "../vircadia-world-sdk-ts/schema/schema.general.ts";
import type { Server, ServerWebSocket } from "bun";
import { PostgresClient } from "../vircadia-world-sdk-ts/module/server/postgres.server.client.ts";
import { verify } from "jsonwebtoken";
import { EventEmitter } from "node:events";

let superUserSql: postgres.Sql | null = null;
let proxyUserSql: postgres.Sql | null = null;

// TODO: Needs heavy optimization especially for pushing notifications to clients

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
    private server: Server | undefined;
    public events: EventEmitter = new EventEmitter();

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

    private LOG_PREFIX = "World API Manager";

    private CONNECTION_HEARTBEAT_INTERVAL = 500;

    // Add a method to expose events for testing
    getEventEmitter(): EventEmitter {
        return this.events;
    }

    async validateJWT(data: {
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
                throw new Error(
                    `Provider ${provider} not found or not enabled.`,
                );
            }

            const jwtSecret = providerConfig.provider__jwt_secret;

            const decoded = verify(token, jwtSecret) as {
                sessionId: string;
                agentId: string;
            };

            log({
                message: "JWT validation result",
                debug: VircadiaConfig.SERVER.VRCA_SERVER_DEBUG,
                suppress: VircadiaConfig.SERVER.VRCA_SERVER_SUPPRESS,
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
                message: `Internal JWT Session validation failed: ${error}`,
                debug: VircadiaConfig.SERVER.VRCA_SERVER_DEBUG,
                suppress: VircadiaConfig.SERVER.VRCA_SERVER_SUPPRESS,
                type: "debug",
                data: {
                    error:
                        error instanceof Error ? error.message : String(error),
                },
            });
            return {
                agentId: "",
                sessionId: "",
                isValid: false,
            };
        }
    }

    async initialize() {
        log({
            message: "Initializing World API Manager",
            debug: VircadiaConfig.SERVER.VRCA_SERVER_DEBUG,
            suppress: VircadiaConfig.SERVER.VRCA_SERVER_SUPPRESS,
            type: "debug",
        });

        try {
            superUserSql = await PostgresClient.getInstance({
                debug: VircadiaConfig.SERVER.VRCA_SERVER_DEBUG,
                suppress: VircadiaConfig.SERVER.VRCA_SERVER_SUPPRESS,
            }).getSuperClient({
                postgres: {
                    host: VircadiaConfig.SERVER
                        .VRCA_SERVER_SERVICE_POSTGRES_HOST_CONTAINER_CLUSTER,
                    port: VircadiaConfig.SERVER
                        .VRCA_SERVER_SERVICE_POSTGRES_PORT_CONTAINER_CLUSTER,
                    database:
                        VircadiaConfig.SERVER
                            .VRCA_SERVER_SERVICE_POSTGRES_DATABASE,
                    username:
                        VircadiaConfig.SERVER
                            .VRCA_SERVER_SERVICE_POSTGRES_SUPER_USER_USERNAME,
                    password:
                        VircadiaConfig.SERVER
                            .VRCA_SERVER_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
                },
            });
            proxyUserSql = await PostgresClient.getInstance({
                debug: VircadiaConfig.SERVER.VRCA_SERVER_DEBUG,
                suppress: VircadiaConfig.SERVER.VRCA_SERVER_SUPPRESS,
            }).getProxyClient({
                postgres: {
                    host: VircadiaConfig.SERVER
                        .VRCA_SERVER_SERVICE_POSTGRES_HOST_CONTAINER_CLUSTER,
                    port: VircadiaConfig.SERVER
                        .VRCA_SERVER_SERVICE_POSTGRES_PORT_CONTAINER_CLUSTER,
                    database:
                        VircadiaConfig.SERVER
                            .VRCA_SERVER_SERVICE_POSTGRES_DATABASE,
                    username:
                        VircadiaConfig.SERVER
                            .VRCA_SERVER_SERVICE_POSTGRES_AGENT_PROXY_USER_USERNAME,
                    password:
                        VircadiaConfig.SERVER
                            .VRCA_SERVER_SERVICE_POSTGRES_AGENT_PROXY_USER_PASSWORD,
                },
            });
        } catch (error) {
            log({
                message: "Failed to initialize DB connection",
                error: error,
                debug: VircadiaConfig.SERVER.VRCA_SERVER_DEBUG,
                suppress: VircadiaConfig.SERVER.VRCA_SERVER_SUPPRESS,
                type: "error",
            });
            return;
        }

        // Listen for tick_captured notifications
        await superUserSql.begin(async (tx) => {
            await tx`LISTEN tick_captured`;
        });

        await superUserSql.listen("tick_captured", async (notification) => {
            const payload = JSON.parse(notification);

            if (payload) {
                try {
                    const syncGroup = payload.syncGroup;

                    log({
                        message: `Received tick notification for sync group: ${syncGroup}`,
                        debug: VircadiaConfig.SERVER.VRCA_SERVER_DEBUG,
                        suppress: VircadiaConfig.SERVER.VRCA_SERVER_SUPPRESS,
                        type: "debug",
                        prefix: this.LOG_PREFIX,
                        data: {
                            tickId: payload.tickId,
                            tickNumber: payload.tickNumber,
                        },
                    });

                    // Emit event for tick notification received
                    this.events.emit("tick:notification", {
                        syncGroup,
                        tickId: payload.tickId,
                        tickNumber: payload.tickNumber,
                    });

                    // Process world updates based on the notification
                    await this.sendWorldUpdatesToSyncGroup({ syncGroup });
                } catch (error) {
                    log({
                        message: "Error processing tick notification",
                        error: error,
                        debug: VircadiaConfig.SERVER.VRCA_SERVER_DEBUG,
                        suppress: VircadiaConfig.SERVER.VRCA_SERVER_SUPPRESS,
                        type: "error",
                        prefix: this.LOG_PREFIX,
                    });
                }
            }
        });

        // Start server
        this.server = Bun.serve({
            hostname: "0.0.0.0",
            port: 3020,
            development: VircadiaConfig.SERVER.VRCA_SERVER_DEBUG,

            // #region API -> HTTP Routes
            fetch: async (req: Request, server: Server) => {
                const url = new URL(req.url);

                if (!superUserSql || !proxyUserSql) {
                    log({
                        message: "No database connection available",
                        debug: VircadiaConfig.SERVER.VRCA_SERVER_DEBUG,
                        type: "error",
                    });
                    return new Response("Internal server error", {
                        status: 500,
                    });
                }

                // Handle stats
                if (
                    url.pathname.startsWith(Service.API.Stats_Endpoint.path) &&
                    req.method === Service.API.Stats_Endpoint.method
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
                            Service.API.Stats_Endpoint.createError(
                                "Forbidden.",
                            ),
                        );
                    }

                    // Gather stats information
                    return Response.json(
                        Service.API.Stats_Endpoint.createSuccess({
                            uptime: process.uptime(),
                            connections: {
                                active: this.activeSessions.size,
                            },
                            database: {
                                connected: !!superUserSql && !!proxyUserSql,
                            },
                            memory: process.memoryUsage(),
                            cpu: process.cpuUsage(),
                        }),
                    );
                }

                // Handle WebSocket upgrade
                if (url.pathname.startsWith(Communication.WS_UPGRADE_PATH)) {
                    const url = new URL(req.url);
                    const token = url.searchParams.get("token");
                    const provider = url.searchParams.get("provider");

                    // Handle missing token first
                    if (!token) {
                        log({
                            prefix: this.LOG_PREFIX,
                            message: "No token found in query parameters",
                            debug: VircadiaConfig.SERVER.VRCA_SERVER_DEBUG,
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
                            message: "No provider found in query parameters",
                            debug: VircadiaConfig.SERVER.VRCA_SERVER_DEBUG,
                            type: "debug",
                        });
                        return new Response("Provider required", {
                            status: 401,
                        });
                    }

                    const jwtValidationResult = await this.validateJWT({
                        provider,
                        token,
                    });

                    if (!jwtValidationResult.isValid) {
                        log({
                            prefix: this.LOG_PREFIX,
                            message: "Token JWT validation failed",
                            debug: VircadiaConfig.SERVER.VRCA_SERVER_DEBUG,
                            type: "debug",
                        });
                        return new Response("Invalid token", {
                            status: 401,
                        });
                    }

                    const sessionValidationResult = await superUserSql<
                        [{ agent_id: string }]
                    >`
                            SELECT * FROM auth.validate_session_id(${jwtValidationResult.sessionId}::UUID) as agent_id
                        `;

                    if (!sessionValidationResult[0].agent_id) {
                        log({
                            prefix: this.LOG_PREFIX,
                            message: "WS Upgrade Session validation failed",
                            debug: VircadiaConfig.SERVER.VRCA_SERVER_DEBUG,
                            suppress:
                                VircadiaConfig.SERVER.VRCA_SERVER_SUPPRESS,
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
                            debug: VircadiaConfig.SERVER.VRCA_SERVER_DEBUG,
                            type: "error",
                        });
                        return new Response("WebSocket upgrade failed", {
                            status: 500,
                        });
                    }

                    return undefined;
                }

                // Handle HTTP routes
                // TODO: This code could be cleaned up.
                if (url.pathname.startsWith(Communication.REST_BASE_PATH)) {
                    switch (true) {
                        case url.pathname ===
                            Communication.REST.Endpoint.AUTH_SESSION_VALIDATE
                                .path && req.method === "POST": {
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

                            const jwtValidationResult = await this.validateJWT({
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
                                return await superUserSql.begin(async (tx) => {
                                    // Execute validation within the same transaction context
                                    const [sessionValidationResult] = await tx<
                                        [{ agent_id: string }]
                                    >`
                                                    SELECT * FROM auth.validate_session_id(${jwtValidationResult.sessionId}::UUID) as agent_id
                                                `;

                                    if (!sessionValidationResult.agent_id) {
                                        return Response.json(
                                            Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.createError(
                                                "Invalid session",
                                            ),
                                        );
                                    }

                                    log({
                                        message:
                                            "Auth endpoint - Session validation result",
                                        debug: VircadiaConfig.SERVER
                                            .VRCA_SERVER_DEBUG,
                                        suppress:
                                            VircadiaConfig.SERVER
                                                .VRCA_SERVER_SUPPRESS,
                                        type: "debug",
                                        prefix: this.LOG_PREFIX,
                                        data: {
                                            jwtValidationResult,
                                        },
                                    });

                                    return Response.json(
                                        Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.createSuccess(
                                            jwtValidationResult.agentId,
                                            jwtValidationResult.sessionId,
                                        ),
                                    );
                                });
                            } catch (error) {
                                log({
                                    message: "Failed to validate session",
                                    debug: VircadiaConfig.SERVER
                                        .VRCA_SERVER_DEBUG,
                                    suppress:
                                        VircadiaConfig.SERVER
                                            .VRCA_SERVER_SUPPRESS,
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
                        suppress: VircadiaConfig.SERVER.VRCA_SERVER_SUPPRESS,
                        debug: VircadiaConfig.SERVER.VRCA_SERVER_DEBUG,
                        type: "debug",
                    });
                    let data: Communication.WebSocket.Message | undefined;

                    if (!superUserSql || !proxyUserSql) {
                        log({
                            message: "No database connections available",
                            suppress:
                                VircadiaConfig.SERVER.VRCA_SERVER_SUPPRESS,
                            debug: VircadiaConfig.SERVER.VRCA_SERVER_DEBUG,
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
                        superUserSql`SELECT auth.update_session_heartbeat_from_session_id(${sessionId}::UUID)`.catch(
                            (error) => {
                                log({
                                    message:
                                        "Failed to update session heartbeat",
                                    debug: VircadiaConfig.SERVER
                                        .VRCA_SERVER_DEBUG,
                                    suppress:
                                        VircadiaConfig.SERVER
                                            .VRCA_SERVER_SUPPRESS,
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

                        // Emit event for message received (optional, might be too verbose)
                        this.events.emit("message:received", {
                            sessionId: session?.sessionId,
                            messageType: data?.type,
                        });

                        // Handle different message types
                        switch (data.type) {
                            case Communication.WebSocket.MessageType
                                .QUERY_REQUEST: {
                                const typedRequest =
                                    data as Communication.WebSocket.QueryRequestMessage;
                                try {
                                    await proxyUserSql?.begin(async (tx) => {
                                        // First set agent context
                                        await tx`SELECT auth.set_agent_context_from_agent_id(${session.agentId}::UUID)`;

                                        const results = await tx.unsafe(
                                            typedRequest.query,
                                            typedRequest.parameters || [],
                                        );

                                        ws.send(
                                            JSON.stringify(
                                                new Communication.WebSocket.QueryResponseMessage(
                                                    results,
                                                ),
                                            ),
                                        );
                                    });
                                } catch (error) {
                                    // Improved error handling with more structured information
                                    const errorMessage =
                                        error instanceof Error
                                            ? error.message
                                            : String(error);

                                    log({
                                        message: `Query failed: ${errorMessage}`,
                                        debug: VircadiaConfig.SERVER
                                            .VRCA_SERVER_DEBUG,
                                        suppress:
                                            VircadiaConfig.SERVER
                                                .VRCA_SERVER_SUPPRESS,
                                        type: "error",
                                        prefix: this.LOG_PREFIX,
                                        data: {
                                            error,
                                            query: typedRequest.query,
                                        },
                                    });

                                    ws.send(
                                        JSON.stringify(
                                            new Communication.WebSocket.QueryResponseMessage(
                                                undefined,
                                                errorMessage,
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
                            suppress:
                                VircadiaConfig.SERVER.VRCA_SERVER_SUPPRESS,
                            debug: VircadiaConfig.SERVER.VRCA_SERVER_DEBUG,
                        });
                    }
                },
                open: (ws: ServerWebSocket<WebSocketData>) => {
                    const sessionData = ws.data;

                    log({
                        prefix: this.LOG_PREFIX,
                        message: "New WebSocket connection attempt",
                        debug: VircadiaConfig.SERVER.VRCA_SERVER_DEBUG,
                        suppress: VircadiaConfig.SERVER.VRCA_SERVER_SUPPRESS,
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

                    // Emit client connected event
                    this.events.emit("client:connected", {
                        sessionId: sessionData.sessionId,
                        agentId: sessionData.agentId,
                    });

                    log({
                        prefix: this.LOG_PREFIX,
                        message: `Connection established with agent ${sessionData.agentId}`,
                        suppress: VircadiaConfig.SERVER.VRCA_SERVER_SUPPRESS,
                        debug: VircadiaConfig.SERVER.VRCA_SERVER_DEBUG,
                        type: "debug",
                    });
                },
                close: (
                    ws: ServerWebSocket<WebSocketData>,
                    code: number,
                    reason: string,
                ) => {
                    log({
                        message: `WebSocket connection closed, code: ${code}, reason: ${reason}`,
                        debug: VircadiaConfig.SERVER.VRCA_SERVER_DEBUG,
                        suppress: VircadiaConfig.SERVER.VRCA_SERVER_SUPPRESS,
                        type: "debug",
                    });
                    const session = this.activeSessions.get(ws.data.sessionId);
                    if (session) {
                        // Emit client disconnected event
                        this.events.emit("client:disconnected", {
                            sessionId: session.sessionId,
                            agentId: session.agentId,
                            reason,
                            code,
                        });

                        log({
                            prefix: this.LOG_PREFIX,
                            message: "WebSocket disconnection",
                            debug: VircadiaConfig.SERVER.VRCA_SERVER_DEBUG,
                            suppress:
                                VircadiaConfig.SERVER.VRCA_SERVER_SUPPRESS,
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
            const sessionsToCheck = Array.from(this.activeSessions.entries());

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
                        log({
                            prefix: this.LOG_PREFIX,
                            message:
                                "Session expired / invalid, closing WebSocket",
                            debug: VircadiaConfig.SERVER.VRCA_SERVER_DEBUG,
                            suppress:
                                VircadiaConfig.SERVER.VRCA_SERVER_SUPPRESS,
                            type: "debug",
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

        log({
            message: "Bun HTTP+WS World API Server running.",
            type: "success",
            debug: VircadiaConfig.SERVER.VRCA_SERVER_DEBUG,
            suppress: VircadiaConfig.SERVER.VRCA_SERVER_SUPPRESS,
        });

        // #endregion
    }

    // #region World Updates

    /**
     * Captures all changes for a sync group from the database
     */
    private async captureWorldChanges(data: {
        syncGroup: string;
    }): Promise<Communication.WebSocket.SyncGroupUpdatesResponseMessage | null> {
        if (!superUserSql) {
            log({
                message: "No database connection available",
                debug: VircadiaConfig.SERVER.VRCA_SERVER_DEBUG,
                type: "error",
                suppress: VircadiaConfig.SERVER.VRCA_SERVER_SUPPRESS,
            });
            return null;
        }

        // Create an empty update package
        const updatePackage =
            new Communication.WebSocket.SyncGroupUpdatesResponseMessage(
                [],
                [],
                [],
            );
        let hasChanges = false;

        // Capture all changes in a single transaction to ensure consistency
        try {
            const result = await superUserSql.begin(async (tx) => {
                // Fetch entity changes
                const entityChanges = await tx<Tick.I_EntityUpdate[]>`
                SELECT 
                    general__entity_id,
                    operation,
                    changes
                FROM tick.get_changed_entity_states_between_latest_ticks(${data.syncGroup})
            `;

                updatePackage.entities = entityChanges.map((e) => ({
                    entityId: e.general__entity_id,
                    operation: e.operation,
                    changes: e.changes,
                    error: null,
                }));

                // Fetch script changes
                const scriptChanges = await tx<Tick.I_ScriptUpdate[]>`
                SELECT 
                    general__script_id,
                    operation,
                    changes
                FROM tick.get_changed_script_states_between_latest_ticks(${data.syncGroup})
            `;

                updatePackage.scripts = scriptChanges.map((s) => ({
                    scriptId: s.general__script_id,
                    operation: s.operation,
                    changes: s.changes,
                    error: null,
                }));

                // Fetch asset changes
                const assetChanges = await tx<Tick.I_AssetUpdate[]>`
                SELECT 
                    general__asset_id,
                    operation,
                    changes
                FROM tick.get_changed_asset_states_between_latest_ticks(${data.syncGroup})
            `;

                updatePackage.assets = assetChanges.map((a) => ({
                    assetId: a.general__asset_id,
                    operation: a.operation,
                    changes: a.changes,
                    error: null,
                }));

                return updatePackage;
            });

            // Check if there are any changes
            hasChanges =
                (result.entities && result.entities.length > 0) ||
                (result.scripts && result.scripts.length > 0) ||
                (result.assets && result.assets.length > 0);

            return hasChanges ? result : null;
        } catch (error) {
            log({
                message: `Error capturing world changes: ${error}`,
                debug: VircadiaConfig.SERVER.VRCA_SERVER_DEBUG,
                suppress: VircadiaConfig.SERVER.VRCA_SERVER_SUPPRESS,
                type: "error",
            });
            return null;
        }
    }

    /**
     * Sends world updates to all sessions in a sync group
     */
    private async distributeWorldUpdates(data: {
        syncGroup: string;
        updatePackage: Communication.WebSocket.SyncGroupUpdatesResponseMessage;
    }): Promise<void> {
        if (!superUserSql) {
            log({
                message: "No database connection available",
                debug: VircadiaConfig.SERVER.VRCA_SERVER_DEBUG,
                type: "error",
                suppress: VircadiaConfig.SERVER.VRCA_SERVER_SUPPRESS,
            });
            return;
        }

        try {
            // Fetch active sessions for the sync group
            const sessionRecords = await superUserSql<
                { general__session_id: string }[]
            >`
            SELECT general__session_id
            FROM auth.active_sync_group_sessions
            WHERE group__sync = ${data.syncGroup}
        `;

            if (!sessionRecords || sessionRecords.length === 0) {
                return; // No active sessions
            }

            // Convert update package to JSON once to avoid repeated serialization
            const updateJson = JSON.stringify(data.updatePackage);

            // Update the sessions in parallel
            const updatePromises = sessionRecords.map(async (record) => {
                const sessionId = record.general__session_id;
                const session = this.activeSessions.get(sessionId);

                if (!session?.ws) {
                    return;
                }

                // Send update to client
                session.ws.send(updateJson);
            });

            // Fire and forget
            Promise.all(updatePromises).catch((error) => {
                log({
                    message: "Error distributing world updates to clients",
                    error: error,
                    debug: VircadiaConfig.SERVER.VRCA_SERVER_DEBUG,
                    suppress: VircadiaConfig.SERVER.VRCA_SERVER_SUPPRESS,
                    type: "error",
                });
            });
        } catch (error) {
            log({
                message: `Error fetching sessions for sync group ${data.syncGroup}: ${error}`,
                debug: VircadiaConfig.SERVER.VRCA_SERVER_DEBUG,
                suppress: VircadiaConfig.SERVER.VRCA_SERVER_SUPPRESS,
                type: "error",
            });
        }
    }

    /**
     * Main function called by the tick system to update the world
     */
    public async sendWorldUpdatesToSyncGroup(data: {
        syncGroup: string;
    }): Promise<void> {
        // Step 1: Capture changes from the database
        const changes = await this.captureWorldChanges(data);

        // Step 2: If there are changes, distribute them to clients
        if (changes) {
            await this.distributeWorldUpdates({
                syncGroup: data.syncGroup,
                updatePackage: changes,
            });

            // Emit event for updates sent
            this.events.emit("updates:sent", {
                syncGroup: data.syncGroup,
                hasEntities: changes.entities?.length > 0,
                entityCount: changes.entities?.length || 0,
                scriptCount: changes.scripts?.length || 0,
                assetCount: changes.assets?.length || 0,
            });
        } else {
            // Emit event for no changes found
            this.events.emit("updates:empty", {
                syncGroup: data.syncGroup,
            });
        }
    }

    cleanup() {
        this.server?.stop().finally(() => {
            if (this.heartbeatInterval) {
                clearInterval(this.heartbeatInterval);
            }

            for (const session of this.activeSessions.values()) {
                session.ws.close(1000, "Server shutting down");
            }
            this.activeSessions.clear();
        });
        PostgresClient.getInstance({
            debug: VircadiaConfig.SERVER.VRCA_SERVER_DEBUG,
            suppress: VircadiaConfig.SERVER.VRCA_SERVER_SUPPRESS,
        }).disconnect();
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
                debug: VircadiaConfig.SERVER.VRCA_SERVER_DEBUG,
                suppress: VircadiaConfig.SERVER.VRCA_SERVER_SUPPRESS,
                type: "debug",
            });
            manager.cleanup();
            process.exit(0);
        });

        process.on("SIGTERM", () => {
            log({
                message: "\nReceived SIGTERM. Cleaning up...",
                debug: VircadiaConfig.SERVER.VRCA_SERVER_DEBUG,
                suppress: VircadiaConfig.SERVER.VRCA_SERVER_SUPPRESS,
                type: "debug",
            });
            manager.cleanup();
            process.exit(0);
        });
    } catch (error) {
        log({
            message: "Failed to start World API Manager.",
            data: {
                error,
            },
            type: "error",
            suppress: VircadiaConfig.SERVER.VRCA_SERVER_SUPPRESS,
            debug: true,
        });
        process.exit(1);
    }
}
