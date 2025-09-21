// =============================================================================
// ============================== IMPORTS, TYPES, AND INTERFACES ==============================
// =============================================================================

import type { Server, ServerWebSocket } from "bun";
import type { SQL } from "bun";
import { serverConfiguration } from "../../../../../sdk/vircadia-world-sdk-ts/bun/src/config/vircadia.server.config";
import { BunLogModule } from "../../../../../sdk/vircadia-world-sdk-ts/bun/src/module/vircadia.common.bun.log.module";
import { BunPostgresClientModule } from "../../../../../sdk/vircadia-world-sdk-ts/bun/src/module/vircadia.common.bun.postgres.module";
import {
    Communication,
    Service,
} from "../../../../../sdk/vircadia-world-sdk-ts/schema/src/vircadia.schema.general";
import { AclService, validateJWT } from "../../../../../sdk/vircadia-world-sdk-ts/bun/src/module/vircadia.server.auth.module";
import { MetricsCollector } from "./service/metrics";
import type { Sql } from "postgres";

let legacySuperUserSql: Sql | null = null;
// Note: legacyProxyUserSql kept for parity, currently unused
let legacyProxyUserSql: Sql | null = null;
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

export class WorldApiWsManager {
    private server: Server | undefined;

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

    // ACL Service instance
    private aclService: AclService | null = null;

    private CONNECTION_HEARTBEAT_INTERVAL = 500;

    // Add CORS helper function
    private addCorsHeaders(response: Response, req: Request): Response {
        const origin = req.headers.get("origin");

        // Allow requests from localhost development servers
        if (
            origin &&
            (origin.includes("localhost") || origin.includes("127.0.0.1"))
        ) {
            response.headers.set("Access-Control-Allow-Origin", origin);
        } else {
            // In production, you might want to restrict this to specific domains
            response.headers.set("Access-Control-Allow-Origin", "*");
        }

        response.headers.set(
            "Access-Control-Allow-Methods",
            "GET, POST, PUT, DELETE, OPTIONS",
        );
        response.headers.set(
            "Access-Control-Allow-Headers",
            "Content-Type, Authorization",
        );
        response.headers.set("Access-Control-Allow-Credentials", "true");

        return response;
    }

    // Wrapper helpers to the ACL service
    private async warmAgentAcl(agentId: string) {
        await this.aclService?.warmAgentAcl(agentId);
    }
    private canRead(agentId: string, syncGroup: string): boolean {
        return !!this.aclService?.canRead(agentId, syncGroup);
    }

    async initialize() {
        BunLogModule({
            message: "Initializing World API WS Manager",
            debug: serverConfiguration.VRCA_SERVER_DEBUG,
            suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
            type: "debug",
        });

        try {
            legacySuperUserSql = await BunPostgresClientModule.getInstance({
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
            legacyProxyUserSql = await BunPostgresClientModule.getInstance({
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
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
            proxyUserSql = await BunPostgresClientModule.getInstance({
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
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
                await this.aclService.startRoleChangeListener();
            }

            // Start listener for role changes to refresh ACLs lazily
            try {
                // Role change listener now handled by AclService
            } catch (error) {
                BunLogModule({
                    message: "Failed to start auth_roles_changed listener",
                    error,
                    debug: serverConfiguration.VRCA_SERVER_DEBUG,
                    suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                    type: "error",
                    prefix: LOG_PREFIX,
                });
            }
        } catch (error) {
            BunLogModule({
                message: "Failed to initialize DB connection",
                error: error,
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                type: "error",
            });
            return;
        }

        // Start server
        this.server = Bun.serve({
            hostname: "0.0.0.0",
            port: 3020,
            development: serverConfiguration.VRCA_SERVER_DEBUG,

            // #region API -> HTTP Routes
            fetch: async (req: Request, server: Server) => {
                try {
                    const url = new URL(req.url);

                    // Handle CORS preflight requests
                    if (req.method === "OPTIONS") {
                        const response = new Response(null, { status: 204 });
                        return this.addCorsHeaders(response, req);
                    }

                    if (!superUserSql || !proxyUserSql) {
                        BunLogModule({
                            message: "No database connection available",
                            debug: serverConfiguration.VRCA_SERVER_DEBUG,
                            suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                            type: "error",
                        });
                        const response = new Response("Internal server error", {
                            status: 500,
                        });
                        return this.addCorsHeaders(response, req);
                    }

                    // Handle stats
                    if (
                        url.pathname.startsWith(
                            Service.API.WS.Stats_Endpoint.path,
                        ) &&
                        req.method === Service.API.WS.Stats_Endpoint.method
                    ) {
                        const requestIP =
                            req.headers.get("x-forwarded-for")?.split(",")[0] ||
                            server.requestIP(req)?.address ||
                            "";

                        // Log the detected IP for debugging
                        BunLogModule({
                            prefix: LOG_PREFIX,
                            message: `Stats endpoint access attempt from IP: ${requestIP}`,
                            debug: serverConfiguration.VRCA_SERVER_DEBUG,
                            suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
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

                        if (!isLocalhost && !isDockerInternal) {
                            BunLogModule({
                                prefix: LOG_PREFIX,
                                message: `Stats endpoint access denied for IP: ${requestIP}`,
                                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                                suppress:
                                    serverConfiguration.VRCA_SERVER_SUPPRESS,
                                type: "debug",
                            });
                            const response = Response.json(
                                Service.API.WS.Stats_Endpoint.createError(
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
                        const systemMetrics =
                            this.metricsCollector.getSystemMetrics(
                                !!superUserSql && !!proxyUserSql,
                            );
                        const poolStats =
                            await BunPostgresClientModule.getInstance({
                                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                                suppress:
                                    serverConfiguration.VRCA_SERVER_SUPPRESS,
                            }).getDatabasePoolStats();

                        const response = Response.json(
                            Service.API.WS.Stats_Endpoint.createSuccess({
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
                                endpoints: this.metricsCollector.getEndpointMetrics(),
                            }),
                        );
                        return this.addCorsHeaders(response, req);
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
                            BunLogModule({
                                prefix: LOG_PREFIX,
                                message: "No token found in query parameters",
                                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                                suppress:
                                    serverConfiguration.VRCA_SERVER_SUPPRESS,
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
                                message:
                                    "No provider found in query parameters",
                                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                                suppress:
                                    serverConfiguration.VRCA_SERVER_SUPPRESS,
                                type: "debug",
                            });
                            return new Response("Provider required", {
                                status: 401,
                            });
                        }

                        const jwtValidationResult = await validateJWT({
                            superUserSql,
                            provider,
                            token,
                        });

                        if (!jwtValidationResult.isValid) {
                            BunLogModule({
                                prefix: LOG_PREFIX,
                                message: `Token JWT validation failed: ${jwtValidationResult.errorReason}`,
                                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                                suppress:
                                    serverConfiguration.VRCA_SERVER_SUPPRESS,
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
                                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                                suppress:
                                    serverConfiguration.VRCA_SERVER_SUPPRESS,
                                type: "debug",
                            });
                            return new Response("Invalid session", {
                                status: 401,
                            });
                        }

                        // Enforce hard limit: only one active WebSocket per session
                        const existingSession = this.activeSessions.get(jwtValidationResult.sessionId);
                        if (existingSession) {
                            BunLogModule({
                                prefix: LOG_PREFIX,
                                message: "Rejecting WebSocket upgrade: session already connected",
                                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                                type: "debug",
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
                                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                                data: {
                                    token,
                                    agentId: jwtValidationResult.agentId,
                                    sessionId: jwtValidationResult.sessionId,
                                },
                                suppress:
                                    serverConfiguration.VRCA_SERVER_SUPPRESS,
                                type: "error",
                            });
                            return new Response("WebSocket upgrade failed", {
                                status: 500,
                            });
                        }

                        return undefined;
                    }

                    // Handle 404
                    BunLogModule({
                        message: "404 Not Found",
                        debug: true, // Force debug for troubleshooting
                        suppress: false,
                        type: "debug",
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
                        suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
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
                    BunLogModule({
                        message: "WebSocket message received",
                        suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                        debug: serverConfiguration.VRCA_SERVER_DEBUG,
                        type: "debug",
                    });
                    let data: Communication.WebSocket.Message | undefined;

                    if (!superUserSql || !proxyUserSql) {
                        BunLogModule({
                            message: "No database connections available",
                            suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                            debug: serverConfiguration.VRCA_SERVER_DEBUG,
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
                                    debug: serverConfiguration.VRCA_SERVER_DEBUG,
                                    suppress:
                                        serverConfiguration.VRCA_SERVER_SUPPRESS,
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

                                        const response =
                                            new Communication.WebSocket.QueryResponseMessage(
                                                {
                                                    result: results,
                                                    requestId:
                                                        typedRequest.requestId,
                                                    errorMessage:
                                                        typedRequest.errorMessage,
                                                },
                                            );

                                        const responseString =
                                            JSON.stringify(response);
                                        responseSize = new TextEncoder().encode(
                                            responseString,
                                        ).length;
                                        success = true;

                                        ws.send(responseString);
                                    });
                                } catch (error) {
                                    // Improved error handling with more structured information
                                    const errorMessage =
                                        error instanceof Error
                                            ? error.message
                                            : String(error);

                                    BunLogModule({
                                        message: `Query failed: ${errorMessage}`,
                                        debug: serverConfiguration.VRCA_SERVER_DEBUG,
                                        suppress:
                                            serverConfiguration.VRCA_SERVER_SUPPRESS,
                                        type: "error",
                                        prefix: LOG_PREFIX,
                                        data: {
                                            error,
                                            query: typedRequest.query,
                                        },
                                    });

                                    const errorResponse =
                                        new Communication.WebSocket.QueryResponseMessage(
                                            {
                                                requestId:
                                                    typedRequest.requestId,
                                                errorMessage,
                                                result: [],
                                            },
                                        );

                                    const errorResponseString =
                                        JSON.stringify(errorResponse);
                                    responseSize = new TextEncoder().encode(
                                        errorResponseString,
                                    ).length;
                                    success = false;

                                    ws.send(errorResponseString);
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
                                    ws.send(
                                        JSON.stringify(
                                            new Communication.WebSocket.ReflectAckResponseMessage(
                                                {
                                                    syncGroup,
                                                    channel,
                                                    delivered: 0,
                                                    requestId: req.requestId,
                                                    errorMessage:
                                                        "Missing syncGroup or channel",
                                                },
                                            ),
                                        ),
                                    );
                                    break;
                                }

                                // ensure ACL warm for sender
                                if (!this.aclService?.isWarmed(session.agentId)) {
                                    await this.warmAgentAcl(session.agentId).catch(
                                        () => {},
                                    );
                                }

                                // authorize: sender must be able to read the target group
                                if (!this.canRead(session.agentId, syncGroup)) {
                                    const endTime = performance.now();
                                    const duration = endTime - startTime;
                                    this.metricsCollector.recordReflect(
                                        duration,
                                        messageSize,
                                        0, // delivered
                                        false, // acknowledged
                                    );
                                    ws.send(
                                        JSON.stringify(
                                            new Communication.WebSocket.ReflectAckResponseMessage(
                                                {
                                                    syncGroup,
                                                    channel,
                                                    delivered: 0,
                                                    requestId: req.requestId,
                                                    errorMessage:
                                                        "Not authorized",
                                                },
                                            ),
                                        ),
                                    );
                                    break;
                                }

                                // fanout to all sessions that can read this group
                                let delivered = 0;
                                const delivery =
                                    new Communication.WebSocket.ReflectDeliveryMessage(
                                        {
                                            syncGroup,
                                            channel,
                                            payload: req.payload,
                                            fromSessionId: session.sessionId,
                                        },
                                    );
                                const payloadStr = JSON.stringify(delivery);

                                for (const [, s] of this.activeSessions) {
                                    if (this.canRead(s.agentId, syncGroup)) {
                                        try {
                                            (
                                                s.ws as ServerWebSocket<WebSocketData>
                                            ).send(payloadStr);
                                            delivered++;
                                        } catch {
                                            // ignore send errors per recipient
                                        }
                                    }
                                }

                                this.recordEndpointMetrics(
                                    "WS_REFLECT_PUBLISH_REQUEST",
                                    startTime,
                                    messageSize,
                                    new TextEncoder().encode(
                                        JSON.stringify(
                                            new Communication.WebSocket.ReflectAckResponseMessage(
                                                {
                                                    syncGroup,
                                                    channel,
                                                    delivered,
                                                    requestId: req.requestId,
                                                },
                                            ),
                                        ),
                                    ).length,
                                    delivered > 0, // success
                                );

                                ws.send(
                                    JSON.stringify(
                                        new Communication.WebSocket.ReflectAckResponseMessage(
                                            {
                                                syncGroup,
                                                channel,
                                                delivered,
                                                requestId: req.requestId,
                                            },
                                        ),
                                    ),
                                );
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
                            suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                            debug: serverConfiguration.VRCA_SERVER_DEBUG,
                        });
                    }
                },
                open: (ws: ServerWebSocket<WebSocketData>) => {
                    const sessionData = ws.data;

                    BunLogModule({
                        prefix: LOG_PREFIX,
                        message: "New WebSocket connection attempt",
                        debug: serverConfiguration.VRCA_SERVER_DEBUG,
                        suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
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
                        suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                        debug: serverConfiguration.VRCA_SERVER_DEBUG,
                        type: "debug",
                    });

                    // Warm ACL for this agent (non-blocking)
                    void this.warmAgentAcl(sessionData.agentId).catch(() => {});

                    // Send session info to client via WebSocket using typed message
                    ws.send(
                        JSON.stringify(
                            new Communication.WebSocket.SessionInfoMessage({
                                agentId: sessionData.agentId,
                                sessionId: sessionData.sessionId,
                            }),
                        ),
                    );
                },
                close: (
                    ws: ServerWebSocket<WebSocketData>,
                    code: number,
                    reason: string,
                ) => {
                    BunLogModule({
                        message: `WebSocket connection closed, code: ${code}, reason: ${reason}`,
                        debug: serverConfiguration.VRCA_SERVER_DEBUG,
                        suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                        type: "debug",
                    });
                    const session = this.activeSessions.get(ws.data.sessionId);
                    if (session) {
                        BunLogModule({
                            prefix: LOG_PREFIX,
                            message: "WebSocket disconnection",
                            debug: serverConfiguration.VRCA_SERVER_DEBUG,
                            suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
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
                            debug: serverConfiguration.VRCA_SERVER_DEBUG,
                            suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
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
            message: "Bun WS World API Server running.",
            prefix: LOG_PREFIX,
            type: "success",
            debug: serverConfiguration.VRCA_SERVER_DEBUG,
            suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
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

            for (const session of this.activeSessions.values()) {
                session.ws.close(1000, "Server shutting down");
            }
            this.activeSessions.clear();
        });
        // Do not forcibly clear cache on shutdown; keep warmed files for faster next start
        BunPostgresClientModule.getInstance({
            debug: serverConfiguration.VRCA_SERVER_DEBUG,
            suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
        }).disconnect();
    }
}

// #endregion

// Add command line entry point
if (import.meta.main) {
    try {
        BunLogModule({
            message: "Starting World API WS Manager",
            debug: serverConfiguration.VRCA_SERVER_DEBUG,
            suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
            type: "info",
            prefix: LOG_PREFIX,
        });
        const manager = new WorldApiWsManager();
        await manager.initialize();

        // Handle cleanup on process termination
        process.on("SIGINT", () => {
            BunLogModule({
                message: "\nReceived SIGINT. Cleaning up...",
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
                message: "\nReceived SIGTERM. Cleaning up...",
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                type: "debug",
                prefix: LOG_PREFIX,
            });
            manager.cleanup();
            process.exit(0);
        });
    } catch (error) {
        BunLogModule({
            message: "Failed to start World API WS Manager.",
            data: {
                error,
            },
            type: "error",
            suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
            debug: true,
            prefix: LOG_PREFIX,
        });
        process.exit(1);
    }
}
