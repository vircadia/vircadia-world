// =============================================================================
// ============================== IMPORTS, TYPES, AND INTERFACES ==============================
// =============================================================================

import { BunLogModule } from "../../../../../sdk/vircadia-world-sdk-ts/src/client/module/bun/vircadia.client.bun.log";
import type postgres from "postgres";
import { ServerConfiguration } from "../../../../../sdk/vircadia-world-sdk-ts/src/server/config/vircadia.server.config";
import {
    Communication,
    Service,
} from "../../../../../sdk/vircadia-world-sdk-ts/src/schema/vircadia.schema.general";
import type { Server, ServerWebSocket } from "bun";
import { BunPostgresClientModule } from "../../../../../sdk/vircadia-world-sdk-ts/src/client/module/bun/vircadia.client.bun.postgres";
import { verify } from "jsonwebtoken";

let superUserSql: postgres.Sql | null = null;
let proxyUserSql: postgres.Sql | null = null;

// TODO: Needs heavy optimization, especially for SQL flow.

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

const LOG_PREFIX = "World API Manager";

export class WorldApiManager {
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

    private CONNECTION_HEARTBEAT_INTERVAL = 500;

    async validateJWT(data: {
        provider: string;
        token: string;
    }): Promise<{
        agentId: string;
        sessionId: string;
        isValid: boolean;
        errorReason?: string;
    }> {
        const { provider, token } = data;

        if (!superUserSql) {
            throw new Error("No database connection available");
        }

        try {
            if (!provider) {
                return {
                    agentId: "",
                    sessionId: "",
                    isValid: false,
                    errorReason: "Provider is not set.",
                };
            }

            // Check for empty or malformed token first
            if (!token || token.split(".").length !== 3) {
                return {
                    agentId: "",
                    sessionId: "",
                    isValid: false,
                    errorReason: "Token is empty or malformed.",
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
                return {
                    agentId: "",
                    sessionId: "",
                    isValid: false,
                    errorReason: `Provider '${provider}' not found or not enabled.`,
                };
            }

            const jwtSecret = providerConfig.provider__jwt_secret;

            try {
                const decoded = verify(token, jwtSecret) as {
                    sessionId: string;
                    agentId: string;
                    exp?: number;
                };

                // Check for missing required fields
                if (!decoded.sessionId) {
                    return {
                        agentId: decoded.agentId || "",
                        sessionId: "",
                        isValid: false,
                        errorReason: "Token is missing sessionId claim.",
                    };
                }

                if (!decoded.agentId) {
                    return {
                        agentId: "",
                        sessionId: decoded.sessionId || "",
                        isValid: false,
                        errorReason: "Token is missing agentId claim.",
                    };
                }

                BunLogModule({
                    message: "JWT validation result",
                    debug: ServerConfiguration.VRCA_SERVER_DEBUG,
                    suppress: ServerConfiguration.VRCA_SERVER_SUPPRESS,
                    type: "debug",
                    data: {
                        token,
                        decoded,
                    },
                });

                return {
                    agentId: decoded.agentId,
                    sessionId: decoded.sessionId,
                    isValid: true,
                };
            } catch (verifyError) {
                // Handle specific jsonwebtoken errors
                if (verifyError instanceof Error) {
                    let errorReason: string;

                    if (verifyError.name === "TokenExpiredError") {
                        errorReason = "Token has expired.";
                    } else if (verifyError.name === "JsonWebTokenError") {
                        errorReason = `JWT error: ${verifyError.message}`;
                    } else if (verifyError.name === "NotBeforeError") {
                        errorReason = "Token is not yet valid.";
                    } else {
                        errorReason = `Token verification failed: ${verifyError.message}`;
                    }

                    return {
                        agentId: "",
                        sessionId: "",
                        isValid: false,
                        errorReason,
                    };
                }

                return {
                    agentId: "",
                    sessionId: "",
                    isValid: false,
                    errorReason: "Unknown token verification error.",
                };
            }
        } catch (error) {
            const errorMessage =
                error instanceof Error ? error.message : String(error);
            BunLogModule({
                message: `Internal JWT Session validation failed: ${errorMessage}`,
                debug: ServerConfiguration.VRCA_SERVER_DEBUG,
                suppress: ServerConfiguration.VRCA_SERVER_SUPPRESS,
                type: "debug",
                data: { error: errorMessage },
            });

            return {
                agentId: "",
                sessionId: "",
                isValid: false,
                errorReason: `Internal validation error: ${errorMessage}`,
            };
        }
    }

    async initialize() {
        BunLogModule({
            message: "Initializing World API Manager",
            debug: ServerConfiguration.VRCA_SERVER_DEBUG,
            suppress: ServerConfiguration.VRCA_SERVER_SUPPRESS,
            type: "debug",
        });

        try {
            superUserSql = await BunPostgresClientModule.getInstance({
                debug: ServerConfiguration.VRCA_SERVER_DEBUG,
                suppress: ServerConfiguration.VRCA_SERVER_SUPPRESS,
            }).getSuperClient({
                postgres: {
                    host: ServerConfiguration.VRCA_SERVER_SERVICE_POSTGRES_CONTAINER_NAME,
                    port: ServerConfiguration.VRCA_SERVER_SERVICE_POSTGRES_PORT_CONTAINER_BIND_EXTERNAL,
                    database:
                        ServerConfiguration.VRCA_SERVER_SERVICE_POSTGRES_DATABASE,
                    username:
                        ServerConfiguration.VRCA_SERVER_SERVICE_POSTGRES_SUPER_USER_USERNAME,
                    password:
                        ServerConfiguration.VRCA_SERVER_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
                },
            });
            proxyUserSql = await BunPostgresClientModule.getInstance({
                debug: ServerConfiguration.VRCA_SERVER_DEBUG,
                suppress: ServerConfiguration.VRCA_SERVER_SUPPRESS,
            }).getProxyClient({
                postgres: {
                    host: ServerConfiguration.VRCA_SERVER_SERVICE_POSTGRES_CONTAINER_NAME,
                    port: ServerConfiguration.VRCA_SERVER_SERVICE_POSTGRES_PORT_CONTAINER_BIND_EXTERNAL,
                    database:
                        ServerConfiguration.VRCA_SERVER_SERVICE_POSTGRES_DATABASE,
                    username:
                        ServerConfiguration.VRCA_SERVER_SERVICE_POSTGRES_AGENT_PROXY_USER_USERNAME,
                    password:
                        ServerConfiguration.VRCA_SERVER_SERVICE_POSTGRES_AGENT_PROXY_USER_PASSWORD,
                },
            });
        } catch (error) {
            BunLogModule({
                message: "Failed to initialize DB connection",
                error: error,
                debug: ServerConfiguration.VRCA_SERVER_DEBUG,
                suppress: ServerConfiguration.VRCA_SERVER_SUPPRESS,
                type: "error",
            });
            return;
        }

        // Start server
        this.server = Bun.serve({
            hostname:
                ServerConfiguration.VRCA_SERVER_SERVICE_WORLD_API_MANAGER_HOST_CONTAINER_BIND_INTERNAL,
            port: ServerConfiguration.VRCA_SERVER_SERVICE_WORLD_API_MANAGER_PORT_CONTAINER_BIND_INTERNAL,
            development: ServerConfiguration.VRCA_SERVER_DEBUG,

            // #region API -> HTTP Routes
            fetch: async (req: Request, server: Server) => {
                const url = new URL(req.url);

                if (!superUserSql || !proxyUserSql) {
                    BunLogModule({
                        message: "No database connection available",
                        debug: ServerConfiguration.VRCA_SERVER_DEBUG,
                        suppress: ServerConfiguration.VRCA_SERVER_SUPPRESS,
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
                        BunLogModule({
                            prefix: LOG_PREFIX,
                            message: "No token found in query parameters",
                            debug: ServerConfiguration.VRCA_SERVER_DEBUG,
                            suppress: ServerConfiguration.VRCA_SERVER_SUPPRESS,
                            type: "debug",
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
                            message: "No provider found in query parameters",
                            debug: ServerConfiguration.VRCA_SERVER_DEBUG,
                            suppress: ServerConfiguration.VRCA_SERVER_SUPPRESS,
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
                        BunLogModule({
                            prefix: LOG_PREFIX,
                            message: `Token JWT validation failed: ${jwtValidationResult.errorReason}`,
                            debug: ServerConfiguration.VRCA_SERVER_DEBUG,
                            suppress: ServerConfiguration.VRCA_SERVER_SUPPRESS,
                            type: "debug",
                        });
                        return new Response(
                            `Invalid token: ${jwtValidationResult.errorReason}`,
                            {
                                status: 401,
                            },
                        );
                    }

                    const sessionValidationResult = await superUserSql<
                        [{ agent_id: string }]
                    >`
                            SELECT * FROM auth.validate_session_id(${jwtValidationResult.sessionId}::UUID) as agent_id
                        `;

                    if (!sessionValidationResult[0].agent_id) {
                        BunLogModule({
                            prefix: LOG_PREFIX,
                            message: "WS Upgrade Session validation failed",
                            debug: ServerConfiguration.VRCA_SERVER_DEBUG,
                            suppress: ServerConfiguration.VRCA_SERVER_SUPPRESS,
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
                        BunLogModule({
                            prefix: LOG_PREFIX,
                            message: "WebSocket upgrade failed",
                            debug: ServerConfiguration.VRCA_SERVER_DEBUG,
                            data: {
                                token,
                                agentId: jwtValidationResult.agentId,
                                sessionId: jwtValidationResult.sessionId,
                            },
                            suppress: ServerConfiguration.VRCA_SERVER_SUPPRESS,
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
                                        `Invalid token: ${jwtValidationResult.errorReason}`,
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

                                    BunLogModule({
                                        message:
                                            "Auth endpoint - Session validation result",
                                        debug: ServerConfiguration.VRCA_SERVER_DEBUG,
                                        suppress:
                                            ServerConfiguration.VRCA_SERVER_SUPPRESS,
                                        type: "debug",
                                        prefix: LOG_PREFIX,
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
                                BunLogModule({
                                    message: "Failed to validate session",
                                    debug: ServerConfiguration.VRCA_SERVER_DEBUG,
                                    suppress:
                                        ServerConfiguration.VRCA_SERVER_SUPPRESS,
                                    type: "error",
                                    prefix: LOG_PREFIX,
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
                    BunLogModule({
                        message: "WebSocket message received",
                        suppress: ServerConfiguration.VRCA_SERVER_SUPPRESS,
                        debug: ServerConfiguration.VRCA_SERVER_DEBUG,
                        type: "debug",
                    });
                    let data: Communication.WebSocket.Message | undefined;

                    if (!superUserSql || !proxyUserSql) {
                        BunLogModule({
                            message: "No database connections available",
                            suppress: ServerConfiguration.VRCA_SERVER_SUPPRESS,
                            debug: ServerConfiguration.VRCA_SERVER_DEBUG,
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

                        if (!sessionToken || !sessionId || !session) {
                            ws.send(
                                JSON.stringify(
                                    new Communication.WebSocket.GeneralErrorResponseMessage(
                                        {
                                            error: "Invalid session",
                                            requestId: data.requestId,
                                        },
                                    ),
                                ),
                            );
                            ws.close(1000, "Invalid session");
                            return;
                        }

                        // Update session heartbeat in database (awaiting increases delay, but we need to fix this later as for now we need to await to prevent deadlocks.)
                        await superUserSql`SELECT auth.update_session_heartbeat_from_session_id(${sessionId}::UUID)`.catch(
                            (error) => {
                                BunLogModule({
                                    message:
                                        "Failed to update session heartbeat",
                                    debug: ServerConfiguration.VRCA_SERVER_DEBUG,
                                    suppress:
                                        ServerConfiguration.VRCA_SERVER_SUPPRESS,
                                    type: "error",
                                    prefix: LOG_PREFIX,
                                    data: { error, sessionId },
                                });
                            },
                        );

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
                                                    {
                                                        result: results,
                                                        requestId:
                                                            typedRequest.requestId,
                                                        errorMessage:
                                                            typedRequest.errorMessage,
                                                    },
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

                                    BunLogModule({
                                        message: `Query failed: ${errorMessage}`,
                                        debug: ServerConfiguration.VRCA_SERVER_DEBUG,
                                        suppress:
                                            ServerConfiguration.VRCA_SERVER_SUPPRESS,
                                        type: "error",
                                        prefix: LOG_PREFIX,
                                        data: {
                                            error,
                                            query: typedRequest.query,
                                        },
                                    });

                                    ws.send(
                                        JSON.stringify(
                                            new Communication.WebSocket.QueryResponseMessage(
                                                {
                                                    requestId:
                                                        typedRequest.requestId,
                                                    errorMessage,
                                                    result: [],
                                                },
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
                                            {
                                                error: `Unsupported message type: ${data.type}`,
                                                requestId: data.requestId,
                                            },
                                        ),
                                    ),
                                );
                            }
                        }
                    } catch (error) {
                        BunLogModule({
                            type: "error",
                            message: "Received WS message handling failed.",
                            error: error,
                            suppress: ServerConfiguration.VRCA_SERVER_SUPPRESS,
                            debug: ServerConfiguration.VRCA_SERVER_DEBUG,
                        });
                    }
                },
                open: (ws: ServerWebSocket<WebSocketData>) => {
                    const sessionData = ws.data;

                    BunLogModule({
                        prefix: LOG_PREFIX,
                        message: "New WebSocket connection attempt",
                        debug: ServerConfiguration.VRCA_SERVER_DEBUG,
                        suppress: ServerConfiguration.VRCA_SERVER_SUPPRESS,
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

                    BunLogModule({
                        prefix: LOG_PREFIX,
                        message: `Connection established with agent ${sessionData.agentId}`,
                        suppress: ServerConfiguration.VRCA_SERVER_SUPPRESS,
                        debug: ServerConfiguration.VRCA_SERVER_DEBUG,
                        type: "debug",
                    });
                },
                close: (
                    ws: ServerWebSocket<WebSocketData>,
                    code: number,
                    reason: string,
                ) => {
                    BunLogModule({
                        message: `WebSocket connection closed, code: ${code}, reason: ${reason}`,
                        debug: ServerConfiguration.VRCA_SERVER_DEBUG,
                        suppress: ServerConfiguration.VRCA_SERVER_SUPPRESS,
                        type: "debug",
                    });
                    const session = this.activeSessions.get(ws.data.sessionId);
                    if (session) {
                        BunLogModule({
                            prefix: LOG_PREFIX,
                            message: "WebSocket disconnection",
                            debug: ServerConfiguration.VRCA_SERVER_DEBUG,
                            suppress: ServerConfiguration.VRCA_SERVER_SUPPRESS,
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
                        BunLogModule({
                            prefix: LOG_PREFIX,
                            message:
                                "Session expired / invalid, closing WebSocket",
                            debug: ServerConfiguration.VRCA_SERVER_DEBUG,
                            suppress: ServerConfiguration.VRCA_SERVER_SUPPRESS,
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

        BunLogModule({
            message: "Bun HTTP+WS World API Server running.",
            type: "success",
            debug: ServerConfiguration.VRCA_SERVER_DEBUG,
            suppress: ServerConfiguration.VRCA_SERVER_SUPPRESS,
        });

        // #endregion
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
        BunPostgresClientModule.getInstance({
            debug: ServerConfiguration.VRCA_SERVER_DEBUG,
            suppress: ServerConfiguration.VRCA_SERVER_SUPPRESS,
        }).disconnect();
    }
}

// #endregion

// Add command line entry point
if (import.meta.main) {
    try {
        BunLogModule({
            message: "Starting World API Manager",
            debug: ServerConfiguration.VRCA_SERVER_DEBUG,
            suppress: ServerConfiguration.VRCA_SERVER_SUPPRESS,
            type: "info",
            prefix: LOG_PREFIX,
        });
        const manager = new WorldApiManager();
        await manager.initialize();

        // Handle cleanup on process termination
        process.on("SIGINT", () => {
            BunLogModule({
                message: "\nReceived SIGINT. Cleaning up...",
                debug: ServerConfiguration.VRCA_SERVER_DEBUG,
                suppress: ServerConfiguration.VRCA_SERVER_SUPPRESS,
                type: "debug",
                prefix: LOG_PREFIX,
            });
            manager.cleanup();
            process.exit(0);
        });

        process.on("SIGTERM", () => {
            BunLogModule({
                message: "\nReceived SIGTERM. Cleaning up...",
                debug: ServerConfiguration.VRCA_SERVER_DEBUG,
                suppress: ServerConfiguration.VRCA_SERVER_SUPPRESS,
                type: "debug",
                prefix: LOG_PREFIX,
            });
            manager.cleanup();
            process.exit(0);
        });
    } catch (error) {
        BunLogModule({
            message: "Failed to start World API Manager.",
            data: {
                error,
            },
            type: "error",
            suppress: ServerConfiguration.VRCA_SERVER_SUPPRESS,
            debug: true,
            prefix: LOG_PREFIX,
        });
        process.exit(1);
    }
}
