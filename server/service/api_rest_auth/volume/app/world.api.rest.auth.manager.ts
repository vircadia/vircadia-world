// =============================================================================
// ============================== WORLD API AUTH MANAGER ========================
// =============================================================================

import type { Server } from "bun";
import type { SQL } from "bun";
import type { Sql } from "postgres";
import { verify } from "jsonwebtoken";
import { serverConfiguration } from "../../../../../sdk/vircadia-world-sdk-ts/bun/src/config/vircadia.server.config";
import { BunLogModule } from "../../../../../sdk/vircadia-world-sdk-ts/bun/src/module/vircadia.common.bun.log.module";
import { BunPostgresClientModule } from "../../../../../sdk/vircadia-world-sdk-ts/bun/src/module/vircadia.common.bun.postgres.module";
import {
    Auth,
    Communication,
    Service,
} from "../../../../../sdk/vircadia-world-sdk-ts/schema/src/vircadia.schema.general";
import { z } from "zod";
import {
    AzureADAuthService,
    createAzureADConfig,
    parseOAuthState,
} from "./service/azure.ad.auth";
import { AclService, createAnonymousUser, signOut, validateJWT } from "../../../../../sdk/vircadia-world-sdk-ts/bun/src/module/vircadia.server.auth.module";
import { MetricsCollector } from "./service/metrics";

let legacySuperUserSql: Sql | null = null;
let superUserSql: SQL | null = null;

const LOG_PREFIX = "World API Auth Manager";

class WorldApiAuthManager {
    private server: Server | undefined;
    private metricsCollector = new MetricsCollector();
    private aclService: AclService | null = null;
    private azureADService: AzureADAuthService | null = null;

    private addCorsHeaders(response: Response, req: Request): Response {
        const origin = req.headers.get("origin");
        if (origin && (origin.includes("localhost") || origin.includes("127.0.0.1"))) {
            response.headers.set("Access-Control-Allow-Origin", origin);
        } else {
            response.headers.set("Access-Control-Allow-Origin", "*");
        }
        response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
        response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
        response.headers.set("Access-Control-Allow-Credentials", "true");
        return response;
    }

    private createJsonResponse(data: unknown, req: Request, status?: number): Response {
        const response = status ? Response.json(data, { status }) : Response.json(data);
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
        this.metricsCollector.recordEndpoint(endpoint, duration, requestSize, responseSize, success);
    }


    async initialize() {
        BunLogModule({ message: "Initializing World API Auth Manager", debug: serverConfiguration.VRCA_SERVER_DEBUG, suppress: serverConfiguration.VRCA_SERVER_SUPPRESS, type: "debug", prefix: LOG_PREFIX });

        // Database init
        legacySuperUserSql = await BunPostgresClientModule.getInstance({
            debug: serverConfiguration.VRCA_SERVER_DEBUG,
            suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
        }).getLegacySuperClient({
            postgres: {
                host: serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_CONTAINER_NAME,
                port: serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_PORT_CONTAINER_BIND_EXTERNAL,
                database: serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_DATABASE,
                username: serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_SUPER_USER_USERNAME,
                password: serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
            },
        });

        superUserSql = await BunPostgresClientModule.getInstance({
            debug: serverConfiguration.VRCA_SERVER_DEBUG,
            suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
        }).getSuperClient({
            postgres: {
                host: serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_CONTAINER_NAME,
                port: serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_PORT_CONTAINER_BIND_EXTERNAL,
                database: serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_DATABASE,
                username: serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_SUPER_USER_USERNAME,
                password: serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
            },
        });

        // ACL service
        if (superUserSql) {
            this.aclService = new AclService({ db: superUserSql, legacyDb: legacySuperUserSql });
            await this.aclService.startRoleChangeListener();
        }

        // Azure AD service
        try {
            const azureConfig = await createAzureADConfig(superUserSql);
            this.azureADService = new AzureADAuthService(azureConfig, superUserSql);
        } catch {}

        // HTTP Server
        this.server = Bun.serve({
            hostname: "0.0.0.0",
            port: 3022,
            development: serverConfiguration.VRCA_SERVER_DEBUG,
            fetch: async (req: Request, server: Server) => {
                try {
                    const url = new URL(req.url);

                    if (req.method === "OPTIONS") {
                        const response = new Response(null, { status: 204 });
                        return this.addCorsHeaders(response, req);
                    }

                    

                    // Stats (moved to official REST endpoint)
                    if (
                        url.pathname.startsWith(Communication.REST.Endpoint.AUTH_STATS.path) &&
                        req.method === Communication.REST.Endpoint.AUTH_STATS.method
                    ) {
                        const requestIP =
                            req.headers.get("x-forwarded-for")?.split(",")[0] ||
                            server.requestIP(req)?.address ||
                            "";
                        const isLocalhost = requestIP === "127.0.0.1" || requestIP === "::1" || requestIP === "localhost";
                        const isDockerInternal = requestIP.startsWith("172.") || requestIP.startsWith("192.168.") || requestIP.startsWith("10.") || requestIP === "::ffff:127.0.0.1";
                        if (!isLocalhost && !isDockerInternal) {
                            return this.createJsonResponse(Service.API.Auth.Stats_Endpoint.createError("Forbidden."), req, 403);
                        }
                        const response = Response.json(
                            Communication.REST.Endpoint.AUTH_STATS.createSuccess({
                                uptime: process.uptime(),
                                connections: this.metricsCollector.getSystemMetrics(true).connections,
                                database: {
                                    connected: !!superUserSql,
                                    connections: this.metricsCollector.getSystemMetrics(true).database.connections,
                                },
                                memory: this.metricsCollector.getSystemMetrics(true).memory,
                                cpu: this.metricsCollector.getSystemMetrics(true).cpu,
                            }),
                        );
                        return this.addCorsHeaders(response, req);
                    }

                    if (!superUserSql) {
                        return this.createJsonResponse({ error: "Internal server error" }, req, 500);
                    }

                    if (url.pathname.startsWith(Communication.REST_BASE_AUTH_PATH)) {
                        switch (true) {
                            case url.pathname === Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.path && req.method === "POST": {
                                const startTime = performance.now();
                                let requestSize = 0;
                                let response: Response;
                                try {
                                    // Safely parse JSON once
                                    const bodyRaw = await req.text().catch(() => "");
                                    const bodyJson = bodyRaw ? JSON.parse(bodyRaw) : {};
                                    const body = Communication.REST.Z.AuthSessionValidateRequest.safeParse(bodyJson);
                                    const raw = body ? JSON.stringify(body) : "";
                                    requestSize = new Blob([raw]).size;
                                    if (!body.success)
                                        return this.createJsonResponse(
                                            Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.createError("No token provided"),
                                            req,
                                            401,
                                        );
                                    if (!body.data.provider)
                                        return this.createJsonResponse(
                                            Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.createError("No provider specified"),
                                            req,
                                            400,
                                        );

                                    const jwtValidationResult = await validateJWT({ superUserSql, provider: body.data.provider, token: body.data.token });
                                    if (!jwtValidationResult.isValid)
                                        return this.createJsonResponse(
                                            Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.createError(
                                                `Invalid token: ${jwtValidationResult.errorReason}`,
                                            ),
                                            req,
                                            401,
                                        );

                                    const [sessionValidationResult] = await superUserSql<[{ agent_id: string }]>`
                                        SELECT * FROM auth.validate_session_id(${jwtValidationResult.sessionId}::UUID) as agent_id
                                    `;
                                    if (!sessionValidationResult.agent_id) {
                                        return this.createJsonResponse(
                                            Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.createError("Invalid session"),
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
                                } catch {
                                    response = this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.createError("Internal server error"),
                                        req,
                                        500,
                                    );
                                }
                                const finalClone = response.clone();
                                const responseSize = new Blob([await finalClone.text()]).size;
                                this.recordEndpointMetrics("AUTH_SESSION_VALIDATE", startTime, requestSize, responseSize, response.status < 400);
                                return response;
                            }

                            case url.pathname === Communication.REST.Endpoint.AUTH_ANONYMOUS_LOGIN.path && req.method === "POST": {
                                try {
                                    const startTime = performance.now();
                                    const result = await createAnonymousUser(superUserSql);
                                    const response = this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_ANONYMOUS_LOGIN.createSuccess(result),
                                        req,
                                    );
                                    const clone = response.clone();
                                    const responseSize = new Blob([await clone.text()]).size;
                                    this.recordEndpointMetrics("AUTH_ANONYMOUS_LOGIN", startTime, 0, responseSize, true);
                                    return response;
                                } catch {
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_ANONYMOUS_LOGIN.createError("Failed to create anonymous user."),
                                        req,
                                        500,
                                    );
                                }
                            }

                            case url.pathname === Communication.REST.Endpoint.AUTH_OAUTH_AUTHORIZE.path && req.method === "GET": {
                                const qp = Object.fromEntries(new URL(req.url).searchParams.entries());
                                const parsed = Communication.REST.Z.OAuthAuthorizeQuery.safeParse(qp);
                                const provider = parsed.success ? parsed.data.provider : null;
                                if (provider !== Auth.E_Provider.AZURE)
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_OAUTH_AUTHORIZE.createError("Unsupported provider"),
                                        req,
                                        400,
                                    );
                                if (!this.azureADService)
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_OAUTH_AUTHORIZE.createError("Azure AD provider not configured"),
                                        req,
                                        500,
                                    );
                                try {
                                    const redirectUrl = await this.azureADService.getAuthorizationUrl({ provider, action: "login" });
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_OAUTH_AUTHORIZE.createSuccess(redirectUrl),
                                        req,
                                    );
                                } catch (error) {
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_OAUTH_AUTHORIZE.createError("Failed to generate authorization URL"),
                                        req,
                                        500,
                                    );
                                }
                            }

                            case url.pathname === Communication.REST.Endpoint.AUTH_OAUTH_CALLBACK.path && req.method === "GET": {
                                if (!this.azureADService)
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_OAUTH_CALLBACK.createError("Azure AD provider not configured"),
                                        req,
                                        500,
                                    );
                                const u = new URL(req.url);
                                const qp = Object.fromEntries(u.searchParams.entries());
                                const parsed = Communication.REST.Z.OAuthCallbackQuery.safeParse(qp);
                                const provider = parsed.success ? parsed.data.provider : null;
                                const code = parsed.success ? parsed.data.code : null;
                                const stateParam = parsed.success ? parsed.data.state : null;
                                if (provider !== Auth.E_Provider.AZURE)
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_OAUTH_CALLBACK.createError("Unsupported provider"),
                                        req,
                                        400,
                                    );
                                if (!code || !stateParam)
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_OAUTH_CALLBACK.createError("Missing code or state parameter"),
                                        req,
                                        400,
                                    );

                                try {
                                    // Pass the raw state string so PKCE verification can look up the exact cache key
                                    const loginResult = await this.azureADService.handleLoginCallback({ code, state: stateParam });
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_OAUTH_CALLBACK.createSuccess({
                                            token: loginResult.token,
                                            agentId: loginResult.agentId,
                                            sessionId: loginResult.sessionId,
                                            provider: provider,
                                            email: loginResult.email,
                                            displayName: loginResult.displayName,
                                            username: loginResult.username,
                                        }),
                                        req,
                                    );
                                } catch (error) {
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_OAUTH_CALLBACK.createError(
                                            error instanceof Error ? error.message : String(error),
                                        ),
                                        req,
                                        500,
                                    );
                                }
                            }

                            case url.pathname === Communication.REST.Endpoint.AUTH_LOGOUT.path && req.method === "POST": {
                                try {
                                    const raw = await req.text();
                                    const parsed = Communication.REST.Z.LogoutRequest.safeParse(raw ? JSON.parse(raw) : {});
                                    const sessionId = parsed.success ? parsed.data.sessionId : undefined;
                                    if (!sessionId)
                                        return this.createJsonResponse(
                                            Communication.REST.Endpoint.AUTH_LOGOUT.createError("No session ID provided"),
                                            req,
                                            400,
                                        );

                                    // Lookup provider for this session (before we invalidate)
                                    let providerName: string | null = null;
                                    try {
                                        const [row] = await superUserSql<[{ auth__provider_name: string }]>`
                                            SELECT auth__provider_name
                                            FROM auth.agent_sessions
                                            WHERE general__session_id = ${sessionId}::UUID
                                            LIMIT 1
                                        `;
                                        providerName = row?.auth__provider_name || null;
                                    } catch {}

                                    await signOut(superUserSql, sessionId);

                                    // Optionally compute an end-session URL for Azure
                                    if (providerName === Auth.E_Provider.AZURE && this.azureADService) {
                                        const endSessionUrl = this.azureADService.getEndSessionUrl();
                                        if (endSessionUrl) {
                                            // Inline response with optional provider logout URL
                                            const response = Response.json({
                                                success: true,
                                                timestamp: Date.now(),
                                                providerLogoutUrl: endSessionUrl,
                                            });
                                            return this.addCorsHeaders(response, req);
                                        }
                                    }

                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_LOGOUT.createSuccess(),
                                        req,
                                    );
                                } catch {
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_LOGOUT.createError("Logout failed"),
                                        req,
                                        500,
                                    );
                                }
                            }

                            case url.pathname === Communication.REST.Endpoint.AUTH_LINK_PROVIDER.path && req.method === "POST": {
                                const raw = await req.text();
                                const parsed = Communication.REST.Z.LinkProviderRequest.safeParse(raw ? JSON.parse(raw) : {});
                                const provider = parsed.success ? parsed.data.provider : undefined;
                                const sessionId = parsed.success ? parsed.data.sessionId : undefined;
                                if (!provider || !sessionId)
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_LINK_PROVIDER.createError("Missing provider or sessionId"),
                                        req,
                                        400,
                                    );
                                if (!this.azureADService || provider !== Auth.E_Provider.AZURE)
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_LINK_PROVIDER.createError("Unsupported or unconfigured provider"),
                                        req,
                                        400,
                                    );
                                const redirectUrl = await this.azureADService.getAuthorizationUrl({ provider, action: "link", sessionId });
                                return this.createJsonResponse(
                                    Communication.REST.Endpoint.AUTH_LINK_PROVIDER.createSuccess(redirectUrl),
                                    req,
                                );
                            }

                            case url.pathname === Communication.REST.Endpoint.AUTH_UNLINK_PROVIDER.path && req.method === "POST": {
                                const raw = await req.text();
                                const parsed = Communication.REST.Z.UnlinkProviderRequest.safeParse(raw ? JSON.parse(raw) : {});
                                const provider = parsed.success ? parsed.data.provider : undefined;
                                const providerUid = parsed.success ? parsed.data.providerUid : undefined;
                                const sessionId = parsed.success ? parsed.data.sessionId : undefined;
                                if (!provider || !providerUid || !sessionId)
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_UNLINK_PROVIDER.createError("Missing required fields"),
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
                                        Communication.REST.Endpoint.AUTH_UNLINK_PROVIDER.createError("Failed to unlink provider"),
                                        req,
                                        500,
                                    );
                                }
                            }

                            case url.pathname === Communication.REST.Endpoint.AUTH_LIST_PROVIDERS.path && req.method === "GET": {
                                const qp = Object.fromEntries(new URL(req.url).searchParams.entries());
                                const parsed = Communication.REST.Z.ListProvidersQuery.safeParse(qp);
                                const sessionId = parsed.success ? parsed.data.sessionId : null;
                                if (!sessionId)
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_LIST_PROVIDERS.createError("Missing sessionId"),
                                        req,
                                        400,
                                    );
                                try {
                                    const providers = await superUserSql<Auth.I_AuthProvider[]>`
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
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_LIST_PROVIDERS.createSuccess(providers as unknown as Auth.I_AuthProvider[]),
                                        req,
                                    );
                                } catch (error) {
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.AUTH_LIST_PROVIDERS.createError("Failed to list providers"),
                                        req,
                                        500,
                                    );
                                }
                            }

                            default:
                                return this.createJsonResponse({ error: "Not found" }, req, 404);
                        }
                    }

                    return this.createJsonResponse({ error: "Not found" }, req, 404);
                } catch (error) {
                    BunLogModule({ prefix: LOG_PREFIX, message: "Unexpected error in auth manager", error, debug: true, suppress: false, type: "error" });
                    return this.createJsonResponse({ error: "Internal server error" }, req, 500);
                }
            },
        });

        BunLogModule({ prefix: LOG_PREFIX, message: `Auth Manager listening on 3022`, debug: serverConfiguration.VRCA_SERVER_DEBUG, suppress: serverConfiguration.VRCA_SERVER_SUPPRESS, type: "info" });
    }
}

void (async () => {
    const manager = new WorldApiAuthManager();
    await manager.initialize();
})();


