// =============================================================================
// ============================== WORLD API AUTH MANAGER ========================
// =============================================================================

import type { Server, SQL } from "bun";
import type { Sql } from "postgres";
import { z } from "zod";
// import { verify } from "jsonwebtoken";
import { serverConfiguration } from "../../../../../sdk/vircadia-world-sdk-ts/bun/src/config/vircadia.server.config";
import { BunLogModule } from "../../../../../sdk/vircadia-world-sdk-ts/bun/src/module/vircadia.common.bun.log.module";
import { BunPostgresClientModule } from "../../../../../sdk/vircadia-world-sdk-ts/bun/src/module/vircadia.common.bun.postgres.module";
import {
    AclService,
    createAnonymousUser,
    signOut,
    validateJWT,
} from "../../../../../sdk/vircadia-world-sdk-ts/bun/src/module/vircadia.server.auth.module";
import {
    Auth,
    Communication,
} from "../../../../../sdk/vircadia-world-sdk-ts/schema/src/vircadia.schema.general";
import {
    isDockerInternalIP,
    isLocalhostIP,
    isLocalhostOrigin,
} from "../../../../module/general.server.util";
import {
    AzureADAuthService,
    createAzureADConfig,
    ensureAzureProviderSeed,
} from "./service/azure.ad.auth";
import { MetricsCollector } from "./service/metrics";

let legacySuperUserSql: Sql | null = null;
let superUserSql: SQL | null = null;

const LOG_PREFIX = "World API Auth Manager";

class WorldApiAuthManager {
    private _server: Server<unknown> | undefined;
    private metricsCollector = new MetricsCollector();
    private aclService: AclService | null = null;
    private azureADService: AzureADAuthService | null = null;

    private addCorsHeaders(response: Response, req: Request): Response {
        const origin = req.headers.get("origin");

        // Auto-allow localhost and 127.0.0.1 on any port for development
        const isLocalhost = origin && isLocalhostOrigin(origin);

        // Build allowed origins for production
        const allowedOrigins = [
            // Caddy domain
            `https://${serverConfiguration.VRCA_SERVER_SERVICE_CADDY_DOMAIN}`,
            `http://${serverConfiguration.VRCA_SERVER_SERVICE_CADDY_DOMAIN}`,
            // Auth Manager's own public endpoint
            serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_AUTH_MANAGER_SSL_ENABLED_PUBLIC_AVAILABLE_AT
                ? `https://${serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_AUTH_MANAGER_HOST_PUBLIC_AVAILABLE_AT}${serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_AUTH_MANAGER_PORT_PUBLIC_AVAILABLE_AT !== 443 ? `:${serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_AUTH_MANAGER_PORT_PUBLIC_AVAILABLE_AT}` : ""}`
                : `http://${serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_AUTH_MANAGER_HOST_PUBLIC_AVAILABLE_AT}${serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_AUTH_MANAGER_PORT_PUBLIC_AVAILABLE_AT !== 80 ? `:${serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_AUTH_MANAGER_PORT_PUBLIC_AVAILABLE_AT}` : ""}`,
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

    async initialize() {
        BunLogModule({
            message: "Initializing World API Auth Manager",
            debug: serverConfiguration.VRCA_SERVER_DEBUG,
            suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
            type: "debug",
            prefix: LOG_PREFIX,
        });

        // Database init
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

        // ACL service
        if (superUserSql) {
            this.aclService = new AclService({
                db: superUserSql,
                legacyDb: legacySuperUserSql,
            });
            await this.aclService.startRoleChangeListener();
        }

        // Azure AD service
        try {
            // Ensure provider row exists and is aligned with local env-configured defaults
            if (superUserSql) {
                await ensureAzureProviderSeed(superUserSql);
            }
            const azureConfig = await createAzureADConfig(superUserSql);
            this.azureADService = new AzureADAuthService(
                azureConfig,
                superUserSql,
            );
        } catch (error) {
            BunLogModule({
                prefix: LOG_PREFIX,
                message: "Azure provider initialization failed",
                error,
                debug: true,
                suppress: false,
                type: "error",
            });
        }

        // HTTP Server
        this._server = Bun.serve({
            hostname: "0.0.0.0",
            port: 3022,
            development: serverConfiguration.VRCA_SERVER_DEBUG,
            fetch: async (req: Request, server: Server<unknown>) => {
                try {
                    const url = new URL(req.url);

                    if (req.method === "OPTIONS") {
                        const response = new Response(null, { status: 204 });
                        return this.addCorsHeaders(response, req);
                    }

                    // Stats (moved to official REST endpoint)
                    if (
                        url.pathname.startsWith(
                            Communication.REST.Endpoint.AUTH_STATS.path,
                        ) &&
                        req.method ===
                            Communication.REST.Endpoint.AUTH_STATS.method
                    ) {
                        const requestIP =
                            req.headers.get("x-forwarded-for")?.split(",")[0] ||
                            server.requestIP(req)?.address ||
                            "";
                        const isLocalhost = isLocalhostIP(requestIP);
                        const isDockerInternal = isDockerInternalIP(requestIP);
                        if (!isLocalhost && !isDockerInternal) {
                            return this.createJsonResponse(
                                Communication.REST.Endpoint.AUTH_STATS.createError(
                                    "Forbidden.",
                                ),
                                req,
                                403,
                            );
                        }
                        const response = this.createJsonResponse(
                            Communication.REST.Z.AuthStatsSuccess.parse({
                                success: true,
                                timestamp: Date.now(),
                                uptime: process.uptime(),
                                connections:
                                    this.metricsCollector.getSystemMetrics(true)
                                        .connections,
                                database: {
                                    connected: !!superUserSql,
                                    connections:
                                        this.metricsCollector.getSystemMetrics(
                                            true,
                                        ).database.connections,
                                },
                                memory: this.metricsCollector.getSystemMetrics(
                                    true,
                                ).memory,
                                cpu: this.metricsCollector.getSystemMetrics(
                                    true,
                                ).cpu,
                            }),
                            req,
                        );
                        return response;
                    }

                    if (!superUserSql) {
                        BunLogModule({
                            prefix: LOG_PREFIX,
                            message:
                                "Database connection not initialized (superUserSql is null)",
                            debug: true,
                            suppress: false,
                            type: "error",
                        });
                        return this.createJsonResponse(
                            { error: "Internal server error" },
                            req,
                            500,
                        );
                    }

                    if (
                        url.pathname.startsWith(
                            Communication.REST_BASE_AUTH_PATH,
                        )
                    ) {
                        switch (true) {
                            case url.pathname ===
                                Communication.REST.Endpoint
                                    .AUTH_SESSION_VALIDATE.path &&
                                req.method === "POST": {
                                const startTime = performance.now();
                                let requestSize = 0;
                                let response: Response;
                                try {
                                    // Parse and validate JSON with Zod schema
                                    const bodyRaw = await req
                                        .text()
                                        .catch(() => "");
                                    requestSize = new Blob([bodyRaw]).size;
                                    const body =
                                        Communication.REST.Z.AuthSessionValidateRequestBody.safeParse(
                                            bodyRaw,
                                        );
                                    if (!body.success)
                                        return this.createJsonResponse(
                                            Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.createError(
                                                "Invalid request body",
                                            ),
                                            req,
                                            400,
                                        );

                                    const jwtValidationResult =
                                        await validateJWT({
                                            superUserSql,
                                            provider: body.data.provider,
                                            token: body.data.token,
                                        });
                                    if (!jwtValidationResult.isValid)
                                        return this.createJsonResponse(
                                            Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.createError(
                                                `Invalid token: ${jwtValidationResult.errorReason}`,
                                            ),
                                            req,
                                            401,
                                        );

                                    // FIXME: This flow is not ideal because it raises exception DB side which throws as an internal error when it is in fact not.
                                    const [sessionValidationResult] =
                                        await superUserSql<
                                            [{ agent_id: string }]
                                        >`
                                        SELECT * FROM auth.validate_session_id(${jwtValidationResult.sessionId}::UUID) as agent_id
                                    `;
                                    if (!sessionValidationResult.agent_id) {
                                        return this.createJsonResponse(
                                            Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.createError(
                                                "Invalid session",
                                            ),
                                            req,
                                            401,
                                        );
                                    }

                                    response = this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.createSuccess(
                                            jwtValidationResult.agentId,
                                            jwtValidationResult.sessionId,
                                        ),
                                        req,
                                    );
                                } catch (error) {
                                    BunLogModule({
                                        prefix: LOG_PREFIX,
                                        message:
                                            "AUTH_SESSION_VALIDATE internal error",
                                        error,
                                        debug: true,
                                        suppress: false,
                                        type: "error",
                                    });
                                    response = this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.createError(
                                            "Internal server error",
                                        ),
                                        req,
                                        500,
                                    );
                                }
                                const finalClone = response.clone();
                                const responseSize = new Blob([
                                    await finalClone.text(),
                                ]).size;
                                this.recordEndpointMetrics(
                                    "AUTH_SESSION_VALIDATE",
                                    startTime,
                                    requestSize,
                                    responseSize,
                                    response.status < 400,
                                );
                                return response;
                            }

                            case url.pathname ===
                                Communication.REST.Endpoint.AUTH_ANONYMOUS_LOGIN
                                    .path && req.method === "POST": {
                                try {
                                    const startTime = performance.now();
                                    const result =
                                        await createAnonymousUser(superUserSql);
                                    const response = this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_ANONYMOUS_LOGIN.createSuccess(
                                            result,
                                        ),
                                        req,
                                    );
                                    const clone = response.clone();
                                    const responseSize = new Blob([
                                        await clone.text(),
                                    ]).size;
                                    this.recordEndpointMetrics(
                                        "AUTH_ANONYMOUS_LOGIN",
                                        startTime,
                                        0,
                                        responseSize,
                                        true,
                                    );
                                    return response;
                                } catch {
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_ANONYMOUS_LOGIN.createError(
                                            "Failed to create anonymous user.",
                                        ),
                                        req,
                                        500,
                                    );
                                }
                            }

                            case url.pathname ===
                                Communication.REST.Endpoint.AUTH_OAUTH_AUTHORIZE
                                    .path && req.method === "GET": {
                                const qp = Object.fromEntries(
                                    new URL(req.url).searchParams.entries(),
                                );
                                const parsed =
                                    Communication.REST.Z.OAuthAuthorizeQuery.safeParse(
                                        qp,
                                    );
                                if (!parsed.success) {
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_OAUTH_AUTHORIZE.createError(
                                            "Invalid query parameters",
                                        ),
                                        req,
                                        400,
                                    );
                                }
                                const provider = parsed.data.provider;
                                if (provider !== Auth.E_Provider.AZURE)
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_OAUTH_AUTHORIZE.createError(
                                            "Unsupported provider",
                                        ),
                                        req,
                                        400,
                                    );
                                if (!this.azureADService) {
                                    BunLogModule({
                                        prefix: LOG_PREFIX,
                                        message:
                                            "Authorize requested but Azure provider not configured",
                                        debug: true,
                                        suppress: false,
                                        type: "error",
                                    });
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_OAUTH_AUTHORIZE.createError(
                                            "Azure AD provider not configured",
                                        ),
                                        req,
                                        500,
                                    );
                                }
                                try {
                                    const requestedRedirectUri =
                                        parsed.data.redirectUri;

                                    const redirectUrl =
                                        await this.azureADService.getAuthorizationUrl(
                                            {
                                                provider,
                                                action: "login",
                                                redirectUrl:
                                                    requestedRedirectUri,
                                            },
                                        );
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_OAUTH_AUTHORIZE.createSuccess(
                                            redirectUrl,
                                        ),
                                        req,
                                    );
                                } catch {
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_OAUTH_AUTHORIZE.createError(
                                            "Failed to generate authorization URL",
                                        ),
                                        req,
                                        500,
                                    );
                                }
                            }

                            case url.pathname ===
                                Communication.REST.Endpoint.AUTH_OAUTH_CALLBACK
                                    .path && req.method === "GET": {
                                if (!this.azureADService)
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_OAUTH_CALLBACK.createError(
                                            "Azure AD provider not configured",
                                        ),
                                        req,
                                        500,
                                    );
                                const u = new URL(req.url);
                                const qp = Object.fromEntries(
                                    u.searchParams.entries(),
                                );
                                const parsed =
                                    Communication.REST.Z.OAuthCallbackQuery.safeParse(
                                        qp,
                                    );
                                if (!parsed.success) {
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_OAUTH_CALLBACK.createError(
                                            "Invalid query parameters",
                                        ),
                                        req,
                                        400,
                                    );
                                }
                                const provider = parsed.data.provider;
                                const code = parsed.data.code;
                                const stateParam = parsed.data.state;
                                if (provider !== Auth.E_Provider.AZURE)
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_OAUTH_CALLBACK.createError(
                                            "Unsupported provider",
                                        ),
                                        req,
                                        400,
                                    );
                                if (!code || !stateParam)
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_OAUTH_CALLBACK.createError(
                                            "Missing code or state parameter",
                                        ),
                                        req,
                                        400,
                                    );

                                try {
                                    // Pass the raw state string so PKCE verification can look up the exact cache key
                                    const loginResult =
                                        await this.azureADService.handleLoginCallback(
                                            { code, state: stateParam },
                                        );
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_OAUTH_CALLBACK.createSuccess(
                                            {
                                                token: loginResult.token,
                                                agentId: loginResult.agentId,
                                                sessionId:
                                                    loginResult.sessionId,
                                                provider: provider,
                                                email: loginResult.email,
                                                displayName:
                                                    loginResult.displayName,
                                                username: loginResult.username,
                                            },
                                        ),
                                        req,
                                    );
                                } catch (error) {
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_OAUTH_CALLBACK.createError(
                                            error instanceof Error
                                                ? error.message
                                                : String(error),
                                        ),
                                        req,
                                        500,
                                    );
                                }
                            }

                            case url.pathname ===
                                Communication.REST.Endpoint.AUTH_LOGOUT.path &&
                                req.method === "POST": {
                                try {
                                    const raw = await req.text();
                                    const parsed =
                                        Communication.REST.Z.LogoutRequestBody.safeParse(
                                            raw,
                                        );
                                    if (!parsed.success)
                                        return this.createJsonResponse(
                                            Communication.REST.Endpoint.AUTH_LOGOUT.createError(
                                                "Invalid request body",
                                            ),
                                            req,
                                            400,
                                        );
                                    const sessionId = parsed.data.sessionId;

                                    // Lookup provider for this session (before we invalidate)
                                    let providerName: string | null = null;
                                    try {
                                        const [row] = await superUserSql<
                                            [{ auth__provider_name: string }]
                                        >`
                                            SELECT auth__provider_name
                                            FROM auth.agent_sessions
                                            WHERE general__session_id = ${sessionId}::UUID
                                            LIMIT 1
                                        `;
                                        providerName =
                                            row?.auth__provider_name || null;
                                    } catch {}

                                    await signOut(superUserSql, sessionId);

                                    // Optionally compute an end-session URL for Azure
                                    if (
                                        providerName ===
                                            Auth.E_Provider.AZURE &&
                                        this.azureADService
                                    ) {
                                        const endSessionUrl =
                                            this.azureADService.getEndSessionUrl();
                                        if (endSessionUrl) {
                                            // Inline response with optional provider logout URL
                                            const response = Response.json({
                                                success: true,
                                                timestamp: Date.now(),
                                                providerLogoutUrl:
                                                    endSessionUrl,
                                            });
                                            return this.addCorsHeaders(
                                                response,
                                                req,
                                            );
                                        }
                                    }

                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_LOGOUT.createSuccess(),
                                        req,
                                    );
                                } catch {
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_LOGOUT.createError(
                                            "Logout failed",
                                        ),
                                        req,
                                        500,
                                    );
                                }
                            }

                            case url.pathname ===
                                Communication.REST.Endpoint.AUTH_LINK_PROVIDER
                                    .path && req.method === "POST": {
                                const raw = await req.text();
                                const parsed =
                                    Communication.REST.Z.LinkProviderRequestBody.safeParse(
                                        raw,
                                    );
                                if (!parsed.success) {
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_LINK_PROVIDER.createError(
                                            "Invalid request body",
                                        ),
                                        req,
                                        400,
                                    );
                                }
                                const provider = parsed.data.provider;
                                const sessionId = parsed.data.sessionId;
                                if (!provider || !sessionId)
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_LINK_PROVIDER.createError(
                                            "Missing provider or sessionId",
                                        ),
                                        req,
                                        400,
                                    );
                                if (
                                    !this.azureADService ||
                                    provider !== Auth.E_Provider.AZURE
                                )
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_LINK_PROVIDER.createError(
                                            "Unsupported or unconfigured provider",
                                        ),
                                        req,
                                        400,
                                    );
                                const redirectUrl =
                                    await this.azureADService.getAuthorizationUrl(
                                        { provider, action: "link", sessionId },
                                    );
                                return this.createJsonResponse(
                                    Communication.REST.Endpoint.AUTH_LINK_PROVIDER.createSuccess(
                                        redirectUrl,
                                    ),
                                    req,
                                );
                            }

                            case url.pathname ===
                                Communication.REST.Endpoint.AUTH_UNLINK_PROVIDER
                                    .path && req.method === "POST": {
                                const raw = await req.text();
                                const parsed =
                                    Communication.REST.Z.UnlinkProviderRequestBody.safeParse(
                                        raw,
                                    );
                                if (!parsed.success) {
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_UNLINK_PROVIDER.createError(
                                            "Invalid request body",
                                        ),
                                        req,
                                        400,
                                    );
                                }
                                const provider = parsed.data.provider;
                                const providerUid = parsed.data.providerUid;
                                const sessionId = parsed.data.sessionId;
                                if (!provider || !providerUid || !sessionId)
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_UNLINK_PROVIDER.createError(
                                            "Missing required fields",
                                        ),
                                        req,
                                        400,
                                    );
                                try {
                                    await superUserSql`
                                        SELECT auth.unlink_provider(${sessionId}::UUID, ${provider}, ${providerUid})
                                    `;
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_UNLINK_PROVIDER.createSuccess(),
                                        req,
                                    );
                                } catch {
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_UNLINK_PROVIDER.createError(
                                            "Failed to unlink provider",
                                        ),
                                        req,
                                        500,
                                    );
                                }
                            }

                            case url.pathname ===
                                Communication.REST.Endpoint.AUTH_LIST_PROVIDERS
                                    .path && req.method === "GET": {
                                const qp = Object.fromEntries(
                                    new URL(req.url).searchParams.entries(),
                                );
                                const parsed =
                                    Communication.REST.Z.ListProvidersQuery.safeParse(
                                        qp,
                                    );
                                if (!parsed.success) {
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_LIST_PROVIDERS.createError(
                                            "Invalid query parameters",
                                        ),
                                        req,
                                        400,
                                    );
                                }
                                const sessionId = parsed.data.sessionId;
                                if (!sessionId)
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_LIST_PROVIDERS.createError(
                                            "Missing sessionId",
                                        ),
                                        req,
                                        400,
                                    );
                                try {
                                    const providersRaw = await superUserSql`
                                        SELECT auth__agent_id as auth__agent_id,
                                               auth__provider_name as auth__provider_name,
                                               auth__provider_uid as auth__provider_uid,
                                               auth__refresh_token as auth__refresh_token,
                                               auth__provider_email as auth__provider_email,
                                               auth__is_primary as auth__is_primary,
                                               auth__metadata as auth__metadata,
                                               general__created_at as general__created_at,
                                               general__created_by as general__created_by,
                                               general__updated_at as general__updated_at,
                                               general__updated_by as general__updated_by
                                        FROM auth.auth_provider_links
                                        WHERE auth__agent_id = (SELECT auth__agent_id FROM auth.agent_sessions WHERE general__session_id = ${sessionId}::UUID LIMIT 1)
                                    `;
                                    const providersValidation = z
                                        .array(
                                            Communication.REST.Z.AuthProvider,
                                        )
                                        .safeParse(providersRaw);
                                    if (!providersValidation.success) {
                                        return this.createJsonResponse(
                                            Communication.REST.Endpoint.AUTH_LIST_PROVIDERS.createError(
                                                "Invalid provider data format",
                                            ),
                                            req,
                                            500,
                                        );
                                    }
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_LIST_PROVIDERS.createSuccess(
                                            providersValidation.data,
                                        ),
                                        req,
                                    );
                                } catch {
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_LIST_PROVIDERS.createError(
                                            "Failed to list providers",
                                        ),
                                        req,
                                        500,
                                    );
                                }
                            }

                            default:
                                return this.createJsonResponse(
                                    { error: "Not found" },
                                    req,
                                    404,
                                );
                        }
                    }

                    return this.createJsonResponse(
                        { error: "Not found" },
                        req,
                        404,
                    );
                } catch (error) {
                    BunLogModule({
                        prefix: LOG_PREFIX,
                        message: "Unexpected error in auth manager",
                        error,
                        debug: true,
                        suppress: false,
                        type: "error",
                    });
                    return this.createJsonResponse(
                        { error: "Internal server error" },
                        req,
                        500,
                    );
                }
            },
        });
        void this._server;

        BunLogModule({
            prefix: LOG_PREFIX,
            message: `Auth Manager listening on 3022`,
            debug: serverConfiguration.VRCA_SERVER_DEBUG,
            suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
            type: "info",
        });
    }
}

void (async () => {
    const manager = new WorldApiAuthManager();
    await manager.initialize();
})();
