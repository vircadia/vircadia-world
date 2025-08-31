// =============================================================================
// ============================== IMPORTS, TYPES, AND INTERFACES ==============================
// =============================================================================

import type { Server, ServerWebSocket } from "bun";
import { verify } from "jsonwebtoken";
import type postgres from "postgres";
import { serverConfiguration } from "../../../../../sdk/vircadia-world-sdk-ts/bun/src/config/vircadia.server.config";
import { BunLogModule } from "../../../../../sdk/vircadia-world-sdk-ts/bun/src/module/vircadia.common.bun.log.module";
import { BunPostgresClientModule } from "../../../../../sdk/vircadia-world-sdk-ts/bun/src/module/vircadia.common.bun.postgres.module";
import {
    Auth,
    Communication,
    Service,
} from "../../../../../sdk/vircadia-world-sdk-ts/schema/src/vircadia.schema.general";
import {
    AzureADAuthService,
    createAzureADConfig,
    parseOAuthState,
} from "./service/azure.ad.auth";
import { createAnonymousUser, signOut } from "./util/auth";
import { MetricsCollector } from "./service/metrics";

let superUserSql: postgres.Sql | null = null;
let proxyUserSql: postgres.Sql | null = null;

// TODO: Needs heavy optimization, especially for SQL flow.

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
    private metricsCollector = new MetricsCollector();

    // Add Azure AD service instance
    private azureADService: AzureADAuthService | null = null;

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

    // Helper function to create JSON response with CORS headers
    private createJsonResponse(
        data: unknown,
        req: Request,
        status?: number,
    ): Response {
        const response = status
            ? Response.json(data, { status })
            : Response.json(data);
        return this.addCorsHeaders(response, req);
    }

    async validateJWT(data: { provider: string; token: string }): Promise<{
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
                    debug: serverConfiguration.VRCA_SERVER_DEBUG,
                    suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
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
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
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
            debug: serverConfiguration.VRCA_SERVER_DEBUG,
            suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
            type: "debug",
        });

        try {
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

            // Initialize Azure AD service
            try {
                BunLogModule({
                    message: "Attempting to initialize Azure AD service",
                    debug: true,
                    suppress: false,
                    type: "debug",
                    prefix: LOG_PREFIX,
                });

                const azureConfig = await createAzureADConfig(superUserSql);

                BunLogModule({
                    message: "Azure AD config loaded",
                    debug: true,
                    suppress: false,
                    type: "debug",
                    prefix: LOG_PREFIX,
                    data: {
                        hasClientId: !!azureConfig.clientId,
                        hasClientSecret: !!azureConfig.clientSecret,
                        tenantId: azureConfig.tenantId,
                        redirectUri: azureConfig.redirectUri,
                        scopes: azureConfig.scopes,
                    },
                });

                this.azureADService = new AzureADAuthService(
                    azureConfig,
                    superUserSql,
                );

                BunLogModule({
                    message: "Azure AD service initialized successfully",
                    debug: true,
                    suppress: false,
                    type: "success",
                    prefix: LOG_PREFIX,
                });
            } catch (error) {
                BunLogModule({
                    message: "Azure AD provider initialization failed",
                    debug: true,
                    suppress: false,
                    type: "error",
                    prefix: LOG_PREFIX,
                    data: {
                        error: error instanceof Error ? error.message : error,
                        stack: error instanceof Error ? error.stack : undefined,
                    },
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
            hostname: '0.0.0.0',
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
                            Service.API.Stats_Endpoint.path,
                        ) &&
                        req.method === Service.API.Stats_Endpoint.method
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
                                Service.API.Stats_Endpoint.createError(
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
                        const response = Response.json(
                            Service.API.Stats_Endpoint.createSuccess({
                                uptime: process.uptime(),
                                connections: systemMetrics.connections,
                                database: systemMetrics.database,
                                memory: systemMetrics.memory,
                                cpu: systemMetrics.cpu,
                                queries: this.metricsCollector.getMetrics(),
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

                        const jwtValidationResult = await this.validateJWT({
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

                    // Handle HTTP routes
                    // TODO: This code could be cleaned up.
                    BunLogModule({
                        message: "Checking REST endpoints",
                        debug: true, // Force debug for troubleshooting
                        suppress: false,
                        type: "debug",
                        prefix: LOG_PREFIX,
                        data: {
                            pathname: url.pathname,
                            REST_BASE_PATH: Communication.REST_BASE_PATH,
                            startsWithREST: url.pathname.startsWith(
                                Communication.REST_BASE_PATH,
                            ),
                            method: req.method,
                        },
                    });

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
                                        const response =
                                            this.createJsonResponse(
                                                Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.createError(
                                                    "No token provided",
                                                ),
                                                req,
                                                401,
                                            );
                                        return this.addCorsHeaders(
                                            response,
                                            req,
                                        );
                                    }

                                    if (!body.provider) {
                                        const response =
                                            this.createJsonResponse(
                                                Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.createError(
                                                    "No provider specified",
                                                ),
                                                req,
                                                400,
                                            );
                                        return this.addCorsHeaders(
                                            response,
                                            req,
                                        );
                                    }
                                } catch (error) {
                                    const response = this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.createError(
                                            "Invalid request body",
                                        ),
                                        req,
                                        400,
                                    );
                                    return this.addCorsHeaders(response, req);
                                }

                                const { token, provider } = body;

                                const jwtValidationResult =
                                    await this.validateJWT({
                                        provider,
                                        token,
                                    });

                                if (!jwtValidationResult.isValid) {
                                    const response = this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.createError(
                                            `Invalid token: ${jwtValidationResult.errorReason}`,
                                        ),
                                        req,
                                        401,
                                    );
                                    return this.addCorsHeaders(response, req);
                                }

                                try {
                                    // Wrap the entire validation logic in a transaction
                                    return await superUserSql.begin(
                                        async (tx) => {
                                            // Execute validation within the same transaction context
                                            const [sessionValidationResult] =
                                                await tx<
                                                    [{ agent_id: string }]
                                                >`
                                                SELECT * FROM auth.validate_session_id(${jwtValidationResult.sessionId}::UUID) as agent_id
                                            `;

                                            if (
                                                !sessionValidationResult.agent_id
                                            ) {
                                                const response =
                                                    this.createJsonResponse(
                                                        Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.createError(
                                                            "Invalid session",
                                                        ),
                                                        req,
                                                        401,
                                                    );
                                                return this.addCorsHeaders(
                                                    response,
                                                    req,
                                                );
                                            }

                                            BunLogModule({
                                                message:
                                                    "Auth endpoint - Session validation result",
                                                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                                                suppress:
                                                    serverConfiguration.VRCA_SERVER_SUPPRESS,
                                                type: "debug",
                                                prefix: LOG_PREFIX,
                                                data: {
                                                    jwtValidationResult,
                                                },
                                            });

                                            const response =
                                                this.createJsonResponse(
                                                    Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.createSuccess(
                                                        jwtValidationResult.agentId,
                                                        jwtValidationResult.sessionId,
                                                    ),
                                                    req,
                                                );
                                            return this.addCorsHeaders(
                                                response,
                                                req,
                                            );
                                        },
                                    );
                                } catch (error) {
                                    BunLogModule({
                                        message: "Failed to validate session",
                                        debug: serverConfiguration.VRCA_SERVER_DEBUG,
                                        suppress:
                                            serverConfiguration.VRCA_SERVER_SUPPRESS,
                                        type: "error",
                                        prefix: LOG_PREFIX,
                                        data: {
                                            error:
                                                error instanceof Error
                                                    ? error.message
                                                    : String(error),
                                        },
                                    });
                                    const response = this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.createError(
                                            "Failed to validate session",
                                        ),
                                        req,
                                        500,
                                    );
                                    return this.addCorsHeaders(response, req);
                                }
                            }

                            // Anonymous login endpoint
                            case url.pathname ===
                                Communication.REST.Endpoint.AUTH_ANONYMOUS_LOGIN
                                    .path && req.method === "POST": {
                                try {
                                    if (!superUserSql) {
                                        throw new Error(
                                            "Database service is not initialized.",
                                        );
                                    }
                                    const result =
                                        await createAnonymousUser(superUserSql);

                                    const response = this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_ANONYMOUS_LOGIN.createSuccess(
                                            result,
                                        ),
                                        req,
                                    );
                                    return response;
                                } catch (error) {
                                    BunLogModule({
                                        message: "Anonymous login failed",
                                        error,
                                        debug: serverConfiguration.VRCA_SERVER_DEBUG,
                                        suppress:
                                            serverConfiguration.VRCA_SERVER_SUPPRESS,
                                        type: "error",
                                        prefix: LOG_PREFIX,
                                    });
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_ANONYMOUS_LOGIN.createError(
                                            "Failed to create anonymous user.",
                                        ),
                                        req,
                                        500,
                                    );
                                }
                            }

                            // OAuth Authorization endpoint
                            case url.pathname ===
                                Communication.REST.Endpoint.AUTH_OAUTH_AUTHORIZE
                                    .path && req.method === "GET": {
                                if (!this.azureADService) {
                                    BunLogModule({
                                        message:
                                            "Azure AD service not available",
                                        debug: true,
                                        suppress: false,
                                        type: "error",
                                        prefix: LOG_PREFIX,
                                    });
                                    const response = this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_OAUTH_AUTHORIZE.createError(
                                            "Azure AD provider not configured",
                                        ),
                                        req,
                                        503,
                                    );
                                    return this.addCorsHeaders(response, req);
                                }

                                const provider =
                                    url.searchParams.get("provider");
                                if (provider !== Auth.E_Provider.AZURE) {
                                    const response = this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_OAUTH_AUTHORIZE.createError(
                                            "Unsupported provider",
                                        ),
                                        req,
                                        400,
                                    );
                                    return this.addCorsHeaders(response, req);
                                }

                                try {
                                    const state = {
                                        provider: Auth.E_Provider.AZURE,
                                        action: "login" as const,
                                    };

                                    BunLogModule({
                                        message:
                                            "OAuth authorize endpoint - generating auth URL",
                                        debug: true, // Force debug for troubleshooting
                                        suppress: false,
                                        type: "debug",
                                        prefix: LOG_PREFIX,
                                        data: { state },
                                    });

                                    const authUrl =
                                        await this.azureADService.getAuthorizationUrl(
                                            state,
                                        );

                                    BunLogModule({
                                        message:
                                            "OAuth authorize endpoint - auth URL generated",
                                        debug: true, // Force debug for troubleshooting
                                        suppress: false,
                                        type: "debug",
                                        prefix: LOG_PREFIX,
                                        data: { authUrl },
                                    });

                                    const responseData =
                                        Communication.REST.Endpoint.AUTH_OAUTH_AUTHORIZE.createSuccess(
                                            authUrl,
                                        );

                                    BunLogModule({
                                        message:
                                            "OAuth authorize endpoint - response data",
                                        debug: true, // Force debug for troubleshooting
                                        suppress: false,
                                        type: "debug",
                                        prefix: LOG_PREFIX,
                                        data: { responseData },
                                    });

                                    const response =
                                        Response.json(responseData);
                                    return this.addCorsHeaders(response, req);
                                } catch (error) {
                                    BunLogModule({
                                        message:
                                            "Failed to generate authorization URL",
                                        error,
                                        debug: serverConfiguration.VRCA_SERVER_DEBUG,
                                        suppress:
                                            serverConfiguration.VRCA_SERVER_SUPPRESS,
                                        type: "error",
                                        prefix: LOG_PREFIX,
                                    });
                                    const response = this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_OAUTH_AUTHORIZE.createError(
                                            "Failed to generate authorization URL",
                                        ),
                                        req,
                                        500,
                                    );
                                    return this.addCorsHeaders(response, req);
                                }
                            }

                            // OAuth Callback endpoint
                            case url.pathname ===
                                Communication.REST.Endpoint.AUTH_OAUTH_CALLBACK
                                    .path && req.method === "GET": {
                                // Add initial logging
                                BunLogModule({
                                    message: "OAuth callback endpoint hit",
                                    debug: true, // Force debug for troubleshooting
                                    suppress: false,
                                    type: "debug",
                                    prefix: LOG_PREFIX,
                                    data: {
                                        url: url.toString(),
                                        pathname: url.pathname,
                                        searchParams: Object.fromEntries(
                                            url.searchParams,
                                        ),
                                        hasAzureADService:
                                            !!this.azureADService,
                                        origin: req.headers.get("origin"),
                                        referer: req.headers.get("referer"),
                                        userAgent:
                                            req.headers.get("user-agent"),
                                    },
                                });

                                if (!this.azureADService) {
                                    BunLogModule({
                                        message:
                                            "Azure AD service not initialized",
                                        debug: true,
                                        suppress: false,
                                        type: "error",
                                        prefix: LOG_PREFIX,
                                    });
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_OAUTH_CALLBACK.createError(
                                            "Azure AD provider not configured",
                                        ),
                                        req,
                                        503,
                                    );
                                }

                                const code = url.searchParams.get("code");
                                const state = url.searchParams.get("state");
                                const provider =
                                    url.searchParams.get("provider");

                                BunLogModule({
                                    message:
                                        "OAuth callback - extracted parameters",
                                    debug: true,
                                    suppress: false,
                                    type: "debug",
                                    prefix: LOG_PREFIX,
                                    data: {
                                        hasCode: !!code,
                                        codeLength: code?.length,
                                        state,
                                        provider,
                                    },
                                });

                                if (!code || !state) {
                                    BunLogModule({
                                        message:
                                            "Missing code or state parameter",
                                        debug: true,
                                        suppress: false,
                                        type: "error",
                                        prefix: LOG_PREFIX,
                                        data: { code: !!code, state: !!state },
                                    });
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_OAUTH_CALLBACK.createError(
                                            "Missing code or state parameter",
                                        ),
                                        req,
                                        400,
                                    );
                                }

                                if (provider !== Auth.E_Provider.AZURE) {
                                    BunLogModule({
                                        message: "Unsupported provider",
                                        debug: true,
                                        suppress: false,
                                        type: "error",
                                        prefix: LOG_PREFIX,
                                        data: { provider },
                                    });
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_OAUTH_CALLBACK.createError(
                                            "Unsupported provider",
                                        ),
                                        req,
                                        400,
                                    );
                                }

                                try {
                                    BunLogModule({
                                        message: "Parsing OAuth state",
                                        debug: true,
                                        suppress: false,
                                        type: "debug",
                                        prefix: LOG_PREFIX,
                                        data: { state },
                                    });

                                    // Parse state to determine action
                                    const stateData = parseOAuthState(state);

                                    BunLogModule({
                                        message: "State parsed successfully",
                                        debug: true,
                                        suppress: false,
                                        type: "debug",
                                        prefix: LOG_PREFIX,
                                        data: { stateData },
                                    });

                                    BunLogModule({
                                        message: "Starting token exchange",
                                        debug: true,
                                        suppress: false,
                                        type: "debug",
                                        prefix: LOG_PREFIX,
                                    });

                                    // Exchange code for tokens
                                    const tokenResponse =
                                        await this.azureADService.exchangeCodeForTokens(
                                            code,
                                            state,
                                        );

                                    BunLogModule({
                                        message: "Token exchange completed",
                                        debug: true,
                                        suppress: false,
                                        type: "debug",
                                        prefix: LOG_PREFIX,
                                        data: {
                                            hasAccessToken:
                                                !!tokenResponse.accessToken,
                                            hasIdToken: !!tokenResponse.idToken,
                                            hasAccount: !!tokenResponse.account,
                                        },
                                    });

                                    // Get user info
                                    const userInfo =
                                        await this.azureADService.getUserInfo(
                                            tokenResponse.accessToken,
                                        );

                                    BunLogModule({
                                        message: "User info retrieved",
                                        debug: true,
                                        suppress: false,
                                        type: "debug",
                                        prefix: LOG_PREFIX,
                                        data: {
                                            userId: userInfo.id,
                                            email: userInfo.email,
                                        },
                                    });

                                    if (stateData.action === "login") {
                                        BunLogModule({
                                            message: "Processing login action",
                                            debug: true,
                                            suppress: false,
                                            type: "debug",
                                            prefix: LOG_PREFIX,
                                        });

                                        // Create or update user
                                        const result =
                                            await this.azureADService.createOrUpdateUser(
                                                userInfo,
                                                tokenResponse,
                                            );

                                        BunLogModule({
                                            message:
                                                "User created/updated successfully",
                                            debug: true,
                                            suppress: false,
                                            type: "debug",
                                            prefix: LOG_PREFIX,
                                            data: {
                                                agentId: result.agentId,
                                                sessionId: result.sessionId,
                                                hasJwt: !!result.jwt,
                                                email: result.email,
                                                displayName: result.displayName,
                                                username: result.username,
                                            },
                                        });

                                        const successResponse =
                                            Communication.REST.Endpoint.AUTH_OAUTH_CALLBACK.createSuccess(
                                                {
                                                    token: result.jwt,
                                                    agentId: result.agentId,
                                                    sessionId: result.sessionId,
                                                    provider:
                                                        Auth.E_Provider.AZURE,
                                                    email: result.email,
                                                    displayName:
                                                        result.displayName,
                                                    username: result.username,
                                                },
                                            );

                                        BunLogModule({
                                            message: "Sending success response",
                                            debug: true,
                                            suppress: false,
                                            type: "debug",
                                            prefix: LOG_PREFIX,
                                            data: {
                                                responseStructure:
                                                    successResponse,
                                                responseKeys:
                                                    Object.keys(
                                                        successResponse,
                                                    ),
                                                hasSuccess:
                                                    "success" in
                                                    successResponse,
                                                hasData:
                                                    "data" in successResponse,
                                            },
                                        });

                                        const response =
                                            this.createJsonResponse(
                                                successResponse,
                                                req,
                                            );

                                        return response;
                                    }

                                    if (
                                        stateData.action === "link" &&
                                        stateData.agentId
                                    ) {
                                        // Link provider to existing account
                                        await this.azureADService.linkProvider(
                                            stateData.agentId,
                                            userInfo,
                                            tokenResponse,
                                        );

                                        return this.createJsonResponse(
                                            Communication.REST.Endpoint.AUTH_OAUTH_CALLBACK.createSuccess(
                                                {
                                                    token: "",
                                                    agentId: stateData.agentId,
                                                    sessionId:
                                                        stateData.sessionId ||
                                                        "",
                                                    provider:
                                                        Auth.E_Provider.AZURE,
                                                },
                                            ),
                                            req,
                                        );
                                    }

                                    throw new Error("Invalid state action");
                                } catch (error) {
                                    BunLogModule({
                                        message: "OAuth callback failed",
                                        error,
                                        debug: true, // Force debug
                                        suppress: false,
                                        type: "error",
                                        prefix: LOG_PREFIX,
                                        data: {
                                            errorMessage:
                                                error instanceof Error
                                                    ? error.message
                                                    : String(error),
                                            errorStack:
                                                error instanceof Error
                                                    ? error.stack
                                                    : undefined,
                                            errorName:
                                                error instanceof Error
                                                    ? error.name
                                                    : undefined,
                                        },
                                    });
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_OAUTH_CALLBACK.createError(
                                            error instanceof Error
                                                ? error.message
                                                : "OAuth callback failed",
                                        ),
                                        req,
                                        500,
                                    );
                                }
                            }

                            // Logout endpoint
                            case url.pathname ===
                                Communication.REST.Endpoint.AUTH_LOGOUT.path &&
                                req.method === "POST": {
                                try {
                                    const body = await req.json();
                                    const { sessionId } = body;

                                    if (!sessionId) {
                                        return this.createJsonResponse(
                                            Communication.REST.Endpoint.AUTH_LOGOUT.createError(
                                                "No session ID provided",
                                            ),
                                            req,
                                            400,
                                        );
                                    }

                                    if (superUserSql) {
                                        await signOut(superUserSql, sessionId);
                                    }

                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_LOGOUT.createSuccess(),
                                        req,
                                    );
                                } catch (error) {
                                    BunLogModule({
                                        message: "Logout failed",
                                        error,
                                        debug: serverConfiguration.VRCA_SERVER_DEBUG,
                                        suppress:
                                            serverConfiguration.VRCA_SERVER_SUPPRESS,
                                        type: "error",
                                        prefix: LOG_PREFIX,
                                    });
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_LOGOUT.createError(
                                            "Logout failed",
                                        ),
                                        req,
                                        500,
                                    );
                                }
                            }

                            // Link provider endpoint
                            case url.pathname ===
                                Communication.REST.Endpoint.AUTH_LINK_PROVIDER
                                    .path && req.method === "POST": {
                                if (!this.azureADService) {
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_LINK_PROVIDER.createError(
                                            "Azure AD provider not configured",
                                        ),
                                        req,
                                        503,
                                    );
                                }

                                try {
                                    const body = await req.json();
                                    const { provider, sessionId } = body;

                                    if (provider !== Auth.E_Provider.AZURE) {
                                        return this.createJsonResponse(
                                            Communication.REST.Endpoint.AUTH_LINK_PROVIDER.createError(
                                                "Unsupported provider",
                                            ),
                                            req,
                                            400,
                                        );
                                    }

                                    // Validate session and get agent ID
                                    const [sessionResult] = await superUserSql<
                                        [{ agent_id: string }]
                                    >`
                                        SELECT * FROM auth.validate_session_id(${sessionId}::UUID) as agent_id
                                    `;

                                    if (!sessionResult?.agent_id) {
                                        return this.createJsonResponse(
                                            Communication.REST.Endpoint.AUTH_LINK_PROVIDER.createError(
                                                "Invalid session",
                                            ),
                                            req,
                                            401,
                                        );
                                    }

                                    const state = {
                                        provider: Auth.E_Provider.AZURE,
                                        action: "link" as const,
                                        agentId: sessionResult.agent_id,
                                        sessionId,
                                    };

                                    const authUrl =
                                        await this.azureADService.getAuthorizationUrl(
                                            state,
                                        );

                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_LINK_PROVIDER.createSuccess(
                                            authUrl,
                                        ),
                                        req,
                                    );
                                } catch (error) {
                                    BunLogModule({
                                        message: "Failed to link provider",
                                        error,
                                        debug: serverConfiguration.VRCA_SERVER_DEBUG,
                                        suppress:
                                            serverConfiguration.VRCA_SERVER_SUPPRESS,
                                        type: "error",
                                        prefix: LOG_PREFIX,
                                    });
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_LINK_PROVIDER.createError(
                                            "Failed to link provider",
                                        ),
                                        req,
                                        500,
                                    );
                                }
                            }

                            // Unlink provider endpoint
                            case url.pathname ===
                                Communication.REST.Endpoint.AUTH_UNLINK_PROVIDER
                                    .path && req.method === "POST": {
                                try {
                                    const body = await req.json();
                                    const { provider, providerUid, sessionId } =
                                        body;

                                    if (provider !== Auth.E_Provider.AZURE) {
                                        return this.createJsonResponse(
                                            Communication.REST.Endpoint.AUTH_UNLINK_PROVIDER.createError(
                                                "Unsupported provider",
                                            ),
                                            req,
                                            400,
                                        );
                                    }

                                    // Validate session and get agent ID
                                    const [sessionResult] = await superUserSql<
                                        [{ agent_id: string }]
                                    >`
                                        SELECT * FROM auth.validate_session_id(${sessionId}::UUID) as agent_id
                                    `;

                                    if (!sessionResult?.agent_id) {
                                        return this.createJsonResponse(
                                            Communication.REST.Endpoint.AUTH_UNLINK_PROVIDER.createError(
                                                "Invalid session",
                                            ),
                                            req,
                                            401,
                                        );
                                    }

                                    // Unlink the provider
                                    await superUserSql`
                                        DELETE FROM auth.agent_auth_providers
                                        WHERE auth__agent_id = ${sessionResult.agent_id}::UUID
                                          AND auth__provider_name = ${provider}
                                          AND auth__provider_uid = ${providerUid}
                                    `;

                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_UNLINK_PROVIDER.createSuccess(),
                                        req,
                                    );
                                } catch (error) {
                                    BunLogModule({
                                        message: "Failed to unlink provider",
                                        error,
                                        debug: serverConfiguration.VRCA_SERVER_DEBUG,
                                        suppress:
                                            serverConfiguration.VRCA_SERVER_SUPPRESS,
                                        type: "error",
                                        prefix: LOG_PREFIX,
                                    });
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_UNLINK_PROVIDER.createError(
                                            "Failed to unlink provider",
                                        ),
                                        req,
                                        500,
                                    );
                                }
                            }

                            // List providers endpoint
                            case url.pathname ===
                                Communication.REST.Endpoint.AUTH_LIST_PROVIDERS
                                    .path && req.method === "GET": {
                                try {
                                    const sessionId =
                                        url.searchParams.get("sessionId");

                                    if (!sessionId) {
                                        return this.createJsonResponse(
                                            Communication.REST.Endpoint.AUTH_LIST_PROVIDERS.createError(
                                                "No session ID provided",
                                            ),
                                            req,
                                            400,
                                        );
                                    }

                                    // Validate session and get agent ID
                                    const [sessionResult] = await superUserSql<
                                        [{ agent_id: string }]
                                    >`
                                        SELECT * FROM auth.validate_session_id(${sessionId}::UUID) as agent_id
                                    `;

                                    if (!sessionResult?.agent_id) {
                                        return this.createJsonResponse(
                                            Communication.REST.Endpoint.AUTH_LIST_PROVIDERS.createError(
                                                "Invalid session",
                                            ),
                                            req,
                                            401,
                                        );
                                    }

                                    // Get linked providers
                                    const providers = await superUserSql`
                                        SELECT 
                                            auth__provider_name,
                                            auth__provider_uid,
                                            auth__provider_email,
                                            auth__is_verified,
                                            auth__last_login_at,
                                            auth__metadata,
                                            general__created_at,
                                            general__updated_at
                                        FROM auth.agent_auth_providers
                                        WHERE auth__agent_id = ${sessionResult.agent_id}::UUID
                                    `;

                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_LIST_PROVIDERS.createSuccess(
                                            providers,
                                        ),
                                        req,
                                    );
                                } catch (error) {
                                    BunLogModule({
                                        message: "Failed to list providers",
                                        error,
                                        debug: serverConfiguration.VRCA_SERVER_DEBUG,
                                        suppress:
                                            serverConfiguration.VRCA_SERVER_SUPPRESS,
                                        type: "error",
                                        prefix: LOG_PREFIX,
                                    });
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_LIST_PROVIDERS.createError(
                                            "Failed to list providers",
                                        ),
                                        req,
                                        500,
                                    );
                                }
                            }

                            default: {
                                const response = new Response("Not Found", {
                                    status: 404,
                                });
                                return this.addCorsHeaders(response, req);
                            }
                        }
                    }

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
                                    const endTime = performance.now();
                                    const duration = endTime - startTime;
                                    this.metricsCollector.recordQuery(
                                        duration,
                                        requestSize,
                                        responseSize,
                                        success,
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
            message: "Bun HTTP+WS World API Server running.",
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

            for (const session of this.activeSessions.values()) {
                session.ws.close(1000, "Server shutting down");
            }
            this.activeSessions.clear();
        });
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
            message: "Starting World API Manager",
            debug: serverConfiguration.VRCA_SERVER_DEBUG,
            suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
            type: "info",
            prefix: LOG_PREFIX,
        });
        const manager = new WorldApiManager();
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
            message: "Failed to start World API Manager.",
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
