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
    private DEBUG = true || serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_WS_MANAGER_DEBUG;
    private SUPPRESS = serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_WS_MANAGER_SUPPRESS;

    // Add CORS helper function
    private addCorsHeaders(response: Response, req: Request): Response {
        const origin = req.headers.get("origin");

        // Auto-allow localhost and 127.0.0.1 on any port for development
        const isLocalhost = origin && (
            origin.startsWith("http://localhost:") ||
            origin.startsWith("https://localhost:") ||
            origin.startsWith("http://127.0.0.1:") ||
            origin.startsWith("https://127.0.0.1:")
        );

        // Build allowed origins for production
        const allowedOrigins = [
            // Frontend domain
            `https://${serverConfiguration.VRCA_SERVER_SERVICE_CADDY_DOMAIN_APP}`,
            // WS Manager's own public endpoint
            serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_WS_MANAGER_SSL_ENABLED_PUBLIC_AVAILABLE_AT
                ? `https://${serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_WS_MANAGER_HOST_PUBLIC_AVAILABLE_AT}${serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_WS_MANAGER_PORT_PUBLIC_AVAILABLE_AT !== 443 ? `:${serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_WS_MANAGER_PORT_PUBLIC_AVAILABLE_AT}` : ""}`
                : `http://${serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_WS_MANAGER_HOST_PUBLIC_AVAILABLE_AT}${serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_WS_MANAGER_PORT_PUBLIC_AVAILABLE_AT !== 80 ? `:${serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_WS_MANAGER_PORT_PUBLIC_AVAILABLE_AT}` : ""}`,
        ];

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
            debug: this.DEBUG,
            suppress: this.SUPPRESS,
            type: "debug",
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
                },
            });
            legacyProxyUserSql = await BunPostgresClientModule.getInstance({
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
                await this.aclService.startRoleChangeListener();
            }
        } catch (error) {
            BunLogModule({
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
            fetch: async (req: Request, server: Server) => {
                try {
                    if (!superUserSql || !proxyUserSql) {
                        BunLogModule({
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

                    // Validate-upgrade diagnostic endpoint: must run BEFORE DB guard to return JSON even if DB is down
                    if (
                        url.pathname.startsWith(
                            Communication.REST.Endpoint.WS_UPGRADE_VALIDATE.path,
                        ) &&
                        req.method === Communication.REST.Endpoint.WS_UPGRADE_VALIDATE.method
                    ) {
                        const token = url.searchParams.get("token") || undefined;
                        const provider = url.searchParams.get("provider") || undefined;

                        if (!superUserSql || !proxyUserSql) {
                            const response = Response.json(
                                Communication.REST.Endpoint.WS_UPGRADE_VALIDATE.createError(
                                    Communication.REST.E_ErrorCode.WS_UPGRADE_DB_UNAVAILABLE,
                                    "Database unavailable",
                                ),
                            );
                            return this.addCorsHeaders(response, req);
                        }

                        if (!token) {
                            const response = Response.json(
                                Communication.REST.Endpoint.WS_UPGRADE_VALIDATE.createError(
                                    Communication.REST.E_ErrorCode.WS_UPGRADE_MISSING_TOKEN,
                                    "Missing authentication token",
                                ),
                            );
                            return this.addCorsHeaders(response, req);
                        }

                        if (!provider) {
                            const response = Response.json(
                                Communication.REST.Endpoint.WS_UPGRADE_VALIDATE.createError(
                                    Communication.REST.E_ErrorCode.WS_UPGRADE_MISSING_PROVIDER,
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
                                    Communication.REST.E_ErrorCode.WS_UPGRADE_JWT_INVALID,
                                    `JWT validation failed: ${e instanceof Error ? e.message : String(e)}`,
                                ),
                            );
                            return this.addCorsHeaders(response, req);
                        }

                        if (!jwtValidationResult.isValid) {
                            const response = Response.json(
                                Communication.REST.Endpoint.WS_UPGRADE_VALIDATE.createError(
                                    Communication.REST.E_ErrorCode.WS_UPGRADE_JWT_INVALID,
                                    jwtValidationResult.errorReason || "JWT validation failed",
                                ),
                            );
                            return this.addCorsHeaders(response, req);
                        }

                        try {
                            const sessionValidationResult = await superUserSql<[
                                { agent_id: string }
                            ]>`
                                SELECT * FROM auth.validate_session_id(${jwtValidationResult.sessionId}::UUID) as agent_id
                            `;

                            if (!sessionValidationResult[0].agent_id) {
                                const response = Response.json(
                                    Communication.REST.Endpoint.WS_UPGRADE_VALIDATE.createError(
                                        Communication.REST.E_ErrorCode.WS_UPGRADE_SESSION_INVALID,
                                        `Invalid session ID: ${jwtValidationResult.sessionId}`,
                                    ),
                                );
                                return this.addCorsHeaders(response, req);
                            }
                        } catch (error) {
                            const response = Response.json(
                                Communication.REST.Endpoint.WS_UPGRADE_VALIDATE.createError(
                                    Communication.REST.E_ErrorCode.WS_UPGRADE_SESSION_INVALID,
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
                                    Communication.REST.E_ErrorCode.WS_UPGRADE_SESSION_ALREADY_CONNECTED,
                                    `Session ${jwtValidationResult.sessionId} is already connected`,
                                ),
                            );
                            return this.addCorsHeaders(response, req);
                        }

                        const okResponse = Response.json(
                            Communication.REST.Endpoint.WS_UPGRADE_VALIDATE.createSuccess({
                                ok: true,
                                reason: "OK",
                                details: {
                                    agentId: jwtValidationResult.agentId,
                                    sessionId: jwtValidationResult.sessionId,
                                },
                            }),
                        );
                        return this.addCorsHeaders(okResponse, req);
                    }

                    // Handle stats (moved to official REST endpoint)
                    if (
                        url.pathname.startsWith(Communication.REST.Endpoint.WS_STATS.path) &&
                        req.method === Communication.REST.Endpoint.WS_STATS.method
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
                                expectedPath: Communication.REST.Endpoint.WS_STATS.path,
                                expectedMethod: Communication.REST.Endpoint.WS_STATS.method,
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
                        const systemMetrics =
                            this.metricsCollector.getSystemMetrics(
                                !!superUserSql && !!proxyUserSql,
                            );

                        BunLogModule({
                            prefix: LOG_PREFIX,
                            message: "Stats endpoint gathering database pool stats",
                            debug: this.DEBUG,
                            suppress: this.SUPPRESS,
                            type: "debug",
                        });

                        let poolStats;
                        try {
                            const poolPromise = BunPostgresClientModule.getInstance({
                                debug: this.DEBUG,
                                suppress: this.SUPPRESS,
                            }).getDatabasePoolStats();

                            // Prevent stats endpoint from hanging if DB is slow/unavailable
                            poolStats = await Promise.race([
                                poolPromise,
                                new Promise((resolve) => setTimeout(() => resolve({}), 750)),
                            ]);

                            BunLogModule({
                                prefix: LOG_PREFIX,
                                message: "Stats endpoint database pool stats gathered",
                                debug: this.DEBUG,
                                suppress: this.SUPPRESS,
                                type: "debug",
                            });
                        } catch (error) {
                            BunLogModule({
                                prefix: LOG_PREFIX,
                                message: "Stats endpoint error gathering pool stats",
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
                                reflect: this.metricsCollector.getReflectMetrics(),
                                endpoints: this.metricsCollector.getEndpointMetrics(),
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
                                corsResponseHeaders: corsResponse.headers.toJSON(),
                            },
                        });

                        return corsResponse;
                    }

                    // Handle WebSocket upgrade
                    if (
                        url.pathname.startsWith(Communication.REST.Endpoint.WS_UPGRADE_REQUEST.path) && 
                        req.method === Communication.REST.Endpoint.WS_UPGRADE_REQUEST.method
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
                            type: "debug",
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
                                suppress:
                                    this.SUPPRESS,
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
                                debug: this.DEBUG,
                                suppress:
                                    this.SUPPRESS,
                                type: "debug",
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
                                suppress:
                                    this.SUPPRESS,
                                type: "debug",
                                data: {
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
                            type: "debug",
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
                                suppress:
                                    this.SUPPRESS,
                                type: "debug",
                                data: {
                                    sessionMs,
                                },
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
                                debug: this.DEBUG,
                                suppress: this.SUPPRESS,
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
                        const upgradeAttemptStart = performance.now();
                        const upgraded = server.upgrade(req, {
                            data: {
                                token,
                                agentId: jwtValidationResult.agentId,
                                sessionId: jwtValidationResult.sessionId,
                            },
                        });
                        const upgradeAttemptMs = performance.now() - upgradeAttemptStart;

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
                                suppress:
                                    this.SUPPRESS,
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
                            type: "debug",
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
                                requestId: (data as any)?.requestId,
                                parseMs: performance.now() - receivedAt,
                            },
                        });

                        // Zod-validate incoming WS message
                        const parsed = Communication.WebSocket.Z.AnyMessage.safeParse(data);
                        if (!parsed.success) {
                            const requestId = (data as any)?.requestId ?? "";
                            const errorMessageData = {
                                type: Communication.WebSocket.MessageType.GENERAL_ERROR_RESPONSE,
                                timestamp: Date.now(),
                                requestId,
                                errorMessage: "Invalid message format",
                            };
                            const errorParsed = Communication.WebSocket.Z.GeneralErrorResponse.safeParse(errorMessageData);
                            if (errorParsed.success) {
                                ws.send(JSON.stringify(errorParsed.data));
                            }
                            BunLogModule({
                                prefix: LOG_PREFIX,
                                message: "WS message validation failed",
                                suppress: this.SUPPRESS,
                                debug: this.DEBUG,
                                type: "debug",
                                data: {
                                    requestId,
                                    elapsedMs: performance.now() - receivedAt,
                                },
                            });
                            return;
                        }

                        if (!sessionToken || !sessionId || !session) {
                            const errorMessageData = {
                                type: Communication.WebSocket.MessageType.GENERAL_ERROR_RESPONSE,
                                timestamp: Date.now(),
                                requestId: parsed.data.requestId,
                                errorMessage: "Invalid session",
                            };
                            const errorParsed = Communication.WebSocket.Z.GeneralErrorResponse.safeParse(errorMessageData);
                            if (errorParsed.success) {
                                ws.send(JSON.stringify(errorParsed.data));
                            }
                            ws.close(1000, "Invalid session");
                            BunLogModule({
                                prefix: LOG_PREFIX,
                                message: "WS invalid session on message",
                                suppress: this.SUPPRESS,
                                debug: this.DEBUG,
                                type: "debug",
                                data: {
                                    requestId: parsed.data.requestId,
                                    elapsedMs: performance.now() - receivedAt,
                                },
                            });
                            return;
                        }

                        // Update session heartbeat in database (awaiting increases delay, but we need to fix this later as for now we need to await to prevent deadlocks.)
                        await superUserSql`SELECT auth.update_session_heartbeat_from_session_id(${sessionId}::UUID)`.catch(
                            (error) => {
                                BunLogModule({
                                    message:
                                        "Failed to update session heartbeat",
                                    debug: this.DEBUG,
                                    suppress:
                                        this.SUPPRESS,
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

                                        const responseData = {
                                            type: Communication.WebSocket.MessageType.QUERY_RESPONSE,
                                            timestamp: Date.now(),
                                            requestId: typedRequest.requestId,
                                            errorMessage: typedRequest.errorMessage,
                                            result: results,
                                        };

                                        const responseParsed = Communication.WebSocket.Z.QueryResponse.safeParse(responseData);
                                        if (!responseParsed.success) {
                                            throw new Error(`Invalid query response format: ${responseParsed.error.message}`);
                                        }

                                        const responseString =
                                            JSON.stringify(responseParsed.data);
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
                                                requestId: typedRequest.requestId,
                                                durationMs: performance.now() - receivedAt,
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
                                        suppress:
                                            this.SUPPRESS,
                                        type: "error",
                                        prefix: LOG_PREFIX,
                                        data: {
                                            error,
                                            query: typedRequest.query,
                                        },
                                    });

                                    const errorResponseData = {
                                        type: Communication.WebSocket.MessageType.QUERY_RESPONSE,
                                        timestamp: Date.now(),
                                        requestId: typedRequest.requestId,
                                        errorMessage,
                                        result: [],
                                    };

                                    const errorResponseParsed = Communication.WebSocket.Z.QueryResponse.safeParse(errorResponseData);
                                    if (!errorResponseParsed.success) {
                                        throw new Error(`Invalid error response format: ${errorResponseParsed.error.message}`);
                                    }

                                    const errorResponseString =
                                        JSON.stringify(errorResponseParsed.data);
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
                                        type: "debug",
                                        data: {
                                            requestId: typedRequest.requestId,
                                            durationMs: performance.now() - receivedAt,
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
                                        type: Communication.WebSocket.MessageType.REFLECT_ACK_RESPONSE,
                                        timestamp: Date.now(),
                                        requestId: req.requestId,
                                        errorMessage: "Missing syncGroup or channel",
                                        syncGroup,
                                        channel,
                                        delivered: 0,
                                    };
                                    const errorAckParsed = Communication.WebSocket.Z.ReflectAckResponse.safeParse(errorAckData);
                                    if (errorAckParsed.success) {
                                        ws.send(JSON.stringify(errorAckParsed.data));
                                    }
                                    BunLogModule({
                                        prefix: LOG_PREFIX,
                                        message: "WS REFLECT_PUBLISH_REQUEST validation failed",
                                        debug: this.DEBUG,
                                        suppress: this.SUPPRESS,
                                        type: "debug",
                                        data: {
                                            syncGroup,
                                            channel,
                                            durationMs: performance.now() - receivedAt,
                                        },
                                    });
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
                                    const unauthorizedAckData = {
                                        type: Communication.WebSocket.MessageType.REFLECT_ACK_RESPONSE,
                                        timestamp: Date.now(),
                                        requestId: req.requestId,
                                        errorMessage: "Not authorized",
                                        syncGroup,
                                        channel,
                                        delivered: 0,
                                    };
                                    const unauthorizedAckParsed = Communication.WebSocket.Z.ReflectAckResponse.safeParse(unauthorizedAckData);
                                    if (unauthorizedAckParsed.success) {
                                        ws.send(JSON.stringify(unauthorizedAckParsed.data));
                                    }
                                    BunLogModule({
                                        prefix: LOG_PREFIX,
                                        message: "WS REFLECT_PUBLISH_REQUEST unauthorized",
                                        debug: this.DEBUG,
                                        suppress: this.SUPPRESS,
                                        type: "debug",
                                        data: {
                                            syncGroup,
                                            channel,
                                            durationMs: performance.now() - receivedAt,
                                        },
                                    });
                                    break;
                                }

                                // fanout to all sessions that can read this group
                                let delivered = 0;
                                const deliveryData = {
                                    type: Communication.WebSocket.MessageType.REFLECT_MESSAGE_DELIVERY,
                                    timestamp: Date.now(),
                                    requestId: "",
                                    errorMessage: null,
                                    syncGroup,
                                    channel,
                                    payload: req.payload,
                                    fromSessionId: session.sessionId,
                                };

                                const deliveryParsed = Communication.WebSocket.Z.ReflectDelivery.safeParse(deliveryData);
                                if (!deliveryParsed.success) {
                                    throw new Error(`Invalid delivery message format: ${deliveryParsed.error.message}`);
                                }
                                const delivery = deliveryParsed.data;
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

                                const successAckData = {
                                    type: Communication.WebSocket.MessageType.REFLECT_ACK_RESPONSE,
                                    timestamp: Date.now(),
                                    requestId: req.requestId,
                                    errorMessage: null,
                                    syncGroup,
                                    channel,
                                    delivered,
                                };

                                const successAckParsed = Communication.WebSocket.Z.ReflectAckResponse.safeParse(successAckData);
                                if (!successAckParsed.success) {
                                    throw new Error(`Invalid success ack format: ${successAckParsed.error.message}`);
                                }

                                this.recordEndpointMetrics(
                                    "WS_REFLECT_PUBLISH_REQUEST",
                                    startTime,
                                    messageSize,
                                    new TextEncoder().encode(JSON.stringify(successAckParsed.data)).length,
                                    delivered > 0, // success
                                );

                                ws.send(JSON.stringify(successAckParsed.data));
                                BunLogModule({
                                    prefix: LOG_PREFIX,
                                    message: "WS REFLECT_PUBLISH_REQUEST fanout complete",
                                    debug: this.DEBUG,
                                    suppress: this.SUPPRESS,
                                    type: "debug",
                                    data: {
                                        syncGroup,
                                        channel,
                                        delivered,
                                        durationMs: performance.now() - receivedAt,
                                    },
                                });
                                break;
                            }


                            default: {
                                const unsupportedErrorData = {
                                    type: Communication.WebSocket.MessageType.GENERAL_ERROR_RESPONSE,
                                    timestamp: Date.now(),
                                    requestId: parsed.data.requestId,
                                    errorMessage: `Unsupported message type: ${parsed.data.type}`,
                                };
                                const unsupportedErrorParsed = Communication.WebSocket.Z.GeneralErrorResponse.safeParse(unsupportedErrorData);
                                if (unsupportedErrorParsed.success) {
                                    session.ws.send(JSON.stringify(unsupportedErrorParsed.data));
                                }
                                BunLogModule({
                                    prefix: LOG_PREFIX,
                                    message: "WS unsupported message type",
                                    debug: this.DEBUG,
                                    suppress: this.SUPPRESS,
                                    type: "debug",
                                    data: {
                                        type: parsed.data.type,
                                        requestId: parsed.data.requestId,
                                        durationMs: performance.now() - receivedAt,
                                    },
                                });
                            }
                        }
                    } catch (error) {
                        BunLogModule({
                            type: "error",
                            message: "Received WS message handling failed.",
                            error: error,
                            suppress: this.SUPPRESS,
                            debug: this.DEBUG,
                        });
                        BunLogModule({
                            prefix: LOG_PREFIX,
                            message: "WS message handler threw",
                            debug: this.DEBUG,
                            suppress: this.SUPPRESS,
                            type: "debug",
                            data: {
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
                        suppress: this.SUPPRESS,
                        debug: this.DEBUG,
                        type: "debug",
                    });

                    // Warm ACL for this agent (non-blocking)
                    void this.warmAgentAcl(sessionData.agentId).catch(() => {});

                    // Send session info to client via WebSocket using typed message
                    const sessionInfoData = {
                        type: Communication.WebSocket.MessageType.SESSION_INFO_RESPONSE,
                        timestamp: Date.now(),
                        requestId: "",
                        errorMessage: null,
                        agentId: sessionData.agentId,
                        sessionId: sessionData.sessionId,
                    };

                    const sessionInfoParsed = Communication.WebSocket.Z.SessionInfo.safeParse(sessionInfoData);
                    if (sessionInfoParsed.success) {
                        ws.send(JSON.stringify(sessionInfoParsed.data));
                    }
                },
                close: (
                    ws: ServerWebSocket<WebSocketData>,
                    code: number,
                    reason: string,
                ) => {
                    BunLogModule({
                        message: `WebSocket connection closed, code: ${code}, reason: ${reason}`,
                        debug: this.DEBUG,
                        suppress: this.SUPPRESS,
                        type: "debug",
                    });
                    const session = this.activeSessions.get(ws.data.sessionId);
                    if (session) {
                        BunLogModule({
                            prefix: LOG_PREFIX,
                            message: "WebSocket disconnection",
                            debug: this.DEBUG,
                            suppress: this.SUPPRESS,
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
                            debug: this.DEBUG,
                            suppress: this.SUPPRESS,
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
    }
}

// #endregion

void (async () => {
    const manager = new WorldApiWsManager();
    await manager.initialize();
})();
