import {
    describe,
    expect,
    test,
    beforeAll,
    afterAll,
    beforeEach,
    mock,
} from "bun:test";
import type { SQL } from "bun";
import { BunPostgresClientModule } from "../../sdk/vircadia-world-sdk-ts/bun/src/module/vircadia.common.bun.postgres.module";
import { Auth } from "../../sdk/vircadia-world-sdk-ts/schema/src/vircadia.schema.general";
import {
    DB_TEST_PREFIX,
    runCliCommand,
    cleanupTestAccounts,
    cleanupTestAuthProviders,
} from "./helper/helpers";
import { cliConfiguration } from "../vircadia.cli.config";
import { Service } from "../../sdk/vircadia-world-sdk-ts/schema/src/vircadia.schema.general";
import { serverConfiguration } from "../../sdk/vircadia-world-sdk-ts/bun/src/config/vircadia.server.config";
import { BunLogModule } from "../../sdk/vircadia-world-sdk-ts/bun/src/module/vircadia.common.bun.log.module";
import { WorldApiManager } from "../../server/service/api_ws/volume/app/world.api.ws.manager";
import {
    AzureADAuthService,
    createAzureADConfig,
    parseOAuthState,
    type I_UserInfo,
    type I_TokenResponse,
    type I_OAuthState,
} from "../../server/service/api_rest_auth/volume/app/service/azure.ad.auth";
import { sign, verify } from "jsonwebtoken";
import { randomUUID } from "node:crypto";

let superUserSql: SQL;
let apiManager: WorldApiManager;
let apiServerUrl: string;

describe("Azure AD Authentication", () => {
    beforeAll(async () => {
        await runCliCommand("server:run-command", "up", "-d");
        // Wait longer for services to be ready
        await Bun.sleep(1000);

        BunLogModule({
            message: "Getting super user client...",
            type: "debug",
            suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
            debug: cliConfiguration.VRCA_CLI_DEBUG,
        });
        superUserSql = await BunPostgresClientModule.getInstance({
            debug: cliConfiguration.VRCA_CLI_DEBUG,
            suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
        }).getSuperClient({
            postgres: {
                host: cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_HOST,
                port: cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_PORT,
                database: cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_DATABASE,
                username:
                    cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_USERNAME,
                password:
                    cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
            },
        });
        BunLogModule({
            message: "Super user client obtained.",
            type: "debug",
            suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
            debug: cliConfiguration.VRCA_CLI_DEBUG,
        });

        // Clean up any existing test data
        await cleanupTestAccounts({ superUserSql });
        await cleanupTestAuthProviders({ superUserSql });

        // Set up Azure AD provider in database if not exists
        const jwtSecret = "test-jwt-secret-for-azure-ad";
        await superUserSql`
            INSERT INTO auth.auth_providers (
                provider__name,
                provider__display_name,
                provider__enabled,
                provider__client_id,
                provider__client_secret,
                provider__redirect_uris,
                provider__scope,
                provider__jwt_secret,
                provider__metadata,
                provider__session_max_per_agent,
                provider__session_duration_ms,
                provider__session_duration_jwt_string
            ) VALUES (
                ${Auth.E_Provider.AZURE},
                'Azure Active Directory',
                true,
                'test-client-id',
                'test-client-secret',
                ARRAY['http://localhost:3000/auth/callback'],
                ARRAY['openid', 'profile', 'email', 'User.Read'],
                ${jwtSecret},
                ${superUserSql.json({ tenant_id: "test-tenant-id" })},
                10,
                86400000,
                '24h'
            )
            ON CONFLICT (provider__name) 
            DO UPDATE SET
                provider__display_name = EXCLUDED.provider__display_name,
                provider__enabled = EXCLUDED.provider__enabled,
                provider__client_id = EXCLUDED.provider__client_id,
                provider__client_secret = EXCLUDED.provider__client_secret,
                provider__redirect_uris = EXCLUDED.provider__redirect_uris,
                provider__scope = EXCLUDED.provider__scope,
                provider__jwt_secret = EXCLUDED.provider__jwt_secret,
                provider__metadata = EXCLUDED.provider__metadata,
                provider__session_max_per_agent = EXCLUDED.provider__session_max_per_agent,
                provider__session_duration_ms = EXCLUDED.provider__session_duration_ms,
                provider__session_duration_jwt_string = EXCLUDED.provider__session_duration_jwt_string
        `;

        try {
            // Initialize Azure AD auth service with mocked MSAL client
            const azureConfig = await createAzureADConfig(superUserSql);
            azureAuthService = new AzureADAuthService(
                azureConfig,
                superUserSql,
            );

            // Mock the MSAL client methods - use any since we're mocking internals
            const serviceWithMocks = azureAuthService as unknown as {
                msalClient: {
                    getAuthCodeUrl: typeof mockGetAuthCodeUrl;
                    acquireTokenByCode: typeof mockAcquireTokenByCode;
                    acquireTokenSilent: ReturnType<typeof mock>;
                };
            };
            serviceWithMocks.msalClient = {
                getAuthCodeUrl: mockGetAuthCodeUrl,
                acquireTokenByCode: mockAcquireTokenByCode,
                acquireTokenSilent: mock(() =>
                    Promise.reject(new Error("Silent acquisition failed")),
                ),
            };

            // Mock global fetch
            global.fetch = mockFetch as unknown as typeof fetch;

            // Start the API server
            apiManager = new WorldApiManager();
            await apiManager.initialize();

            // Give the server time to start
            await Bun.sleep(1000);

            apiServerUrl = `http://${serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_MANAGER_HOST_CONTAINER_BIND_EXTERNAL}:${serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_MANAGER_PORT_CONTAINER_BIND_EXTERNAL}`;

            BunLogModule({
                message: "Azure AD test setup complete",
                type: "debug",
                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                debug: cliConfiguration.VRCA_CLI_DEBUG,
            });
        } catch (error) {
            BunLogModule({
                message: "Failed to initialize Azure AD test setup",
                error,
                type: "error",
                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                debug: cliConfiguration.VRCA_CLI_DEBUG,
            });
            throw error;
        }
    });

    beforeEach(async () => {
        // Clean up OAuth state cache between tests to avoid duplicates
        if (superUserSql) {
            await superUserSql`
                DELETE FROM auth.oauth_state_cache 
                WHERE cache_key LIKE 'pkce_verifier_%'
            `;
        }
    });

    describe("Can connect to the API server", () => {
        test("should be able to connect to the API server", async () => {
            const response = await fetch(
                `${apiServerUrl}${Service.API.Stats_Endpoint.path}`,
                {
                    method: "GET",
                },
            );
            expect(response.status).toBe(200);
        });
    });

    describe("OAuth State Management", () => {
        test.skipIf(!azureAuthService)(
            "should encode and decode OAuth state correctly",
            () => {
                const state: I_OAuthState = {
                    provider: Auth.E_Provider.AZURE,
                    action: "login",
                    sessionId: "test-session-id",
                    agentId: "test-agent-id",
                    redirectUrl: "/dashboard",
                };

                const encoded = Buffer.from(JSON.stringify(state)).toString(
                    "base64url",
                );
                const decoded = parseOAuthState(encoded);

                expect(decoded).toEqual(state);
            },
        );

        test("should handle invalid state parameter", () => {
            expect(() => parseOAuthState("invalid-state")).toThrow(
                "Invalid state parameter",
            );
        });
    });

    describe("Azure AD Service", () => {
        test("should generate authorization URL with PKCE", async () => {
            const state: I_OAuthState = {
                provider: Auth.E_Provider.AZURE,
                action: "login",
            };

            const authUrl = await azureAuthService.getAuthorizationUrl(state);

            expect(authUrl).toBe(
                "https://login.microsoftonline.com/mock-auth-url",
            );
            expect(mockGetAuthCodeUrl).toHaveBeenCalled();

            // Verify PKCE verifier was stored
            const stateParam = Buffer.from(JSON.stringify(state)).toString(
                "base64url",
            );
            const cacheKey = `pkce_verifier_${stateParam}`;
            const [cache] = await superUserSql`
                SELECT * FROM auth.oauth_state_cache
                WHERE cache_key = ${cacheKey}
            `;
            expect(cache).toBeDefined();
            expect(cache.cache_value).toBeDefined();
        });

        test("should exchange authorization code for tokens", async () => {
            const state: I_OAuthState = {
                provider: Auth.E_Provider.AZURE,
                action: "login",
            };
            const stateParam = Buffer.from(JSON.stringify(state)).toString(
                "base64url",
            );

            // Store PKCE verifier
            const cacheKey = `pkce_verifier_${stateParam}`;
            await superUserSql`
                INSERT INTO auth.oauth_state_cache (
                    cache_key,
                    cache_value,
                    expires_at
                ) VALUES (
                    ${cacheKey},
                    'test-verifier',
                    NOW() + INTERVAL '10 minutes'
                )
            `;

            const tokens = await azureAuthService.exchangeCodeForTokens(
                "test-code",
                stateParam,
            );

            expect(tokens.accessToken).toBe(mockTokenResponse.accessToken);
            if (mockTokenResponse.idToken) {
                expect(tokens.idToken).toBe(mockTokenResponse.idToken);
            }
            expect(mockAcquireTokenByCode).toHaveBeenCalled();

            // Verify cache was cleaned up
            const [cache] = await superUserSql`
                SELECT * FROM auth.oauth_state_cache
                WHERE cache_key = ${cacheKey}
            `;
            expect(cache).toBeUndefined();
        });

        test("should fetch user info from Microsoft Graph", async () => {
            const userInfo =
                await azureAuthService.getUserInfo("test-access-token");

            expect(userInfo.id).toBe(mockUserInfo.id);
            expect(userInfo.email).toBe(mockUserInfo.email);
            expect(userInfo.displayName).toBe(mockUserInfo.displayName);
            expect(mockFetch).toHaveBeenCalledWith(
                "https://graph.microsoft.com/v1.0/me",
                expect.objectContaining({
                    headers: {
                        Authorization: "Bearer test-access-token",
                    },
                }),
            );
        });

        test("should create new user from Azure AD info", async () => {
            const uniqueUserInfo = getMockUserInfo();
            const result = await azureAuthService.createOrUpdateUser(
                uniqueUserInfo,
                mockTokenResponse,
            );

            expect(result.agentId).toBeDefined();
            expect(result.sessionId).toBeDefined();
            expect(result.jwt).toBeDefined();

            // Verify user was created
            const [agent] = await superUserSql`
                SELECT * FROM auth.agent_profiles
                WHERE general__agent_profile_id = ${result.agentId}::UUID
            `;
            expect(agent).toBeDefined();
            expect(agent.auth__email).toBe(uniqueUserInfo.email);
            expect(agent.profile__username).toBe(uniqueUserInfo.displayName);

            // Verify auth provider was created
            const [provider] = await superUserSql`
                SELECT * FROM auth.agent_auth_providers
                WHERE auth__agent_id = ${result.agentId}::UUID
                  AND auth__provider_name = ${Auth.E_Provider.AZURE}
            `;
            expect(provider).toBeDefined();
            expect(provider.auth__provider_uid).toBe(mockUserInfo.id);
            expect(provider.auth__provider_email).toBe(mockUserInfo.email);

            // Verify session was created
            const [session] = await superUserSql`
                SELECT * FROM auth.agent_sessions
                WHERE general__session_id = ${result.sessionId}::UUID
            `;
            expect(session).toBeDefined();
            expect(session.auth__agent_id).toBe(result.agentId);
            expect(session.session__is_active).toBe(true);

            // Verify JWT
            const azureConfig = await createAzureADConfig(superUserSql);
            const decoded = verify(result.jwt, azureConfig.jwtSecret) as {
                agentId: string;
                sessionId: string;
                provider: string;
                email: string;
            };
            expect(decoded.agentId).toBe(result.agentId);
            expect(decoded.sessionId).toBe(result.sessionId);
            expect(decoded.provider).toBe(Auth.E_Provider.AZURE);
        });

        test("should update existing user on subsequent login", async () => {
            // First create a user
            const firstResult = await azureAuthService.createOrUpdateUser(
                mockUserInfo,
                mockTokenResponse,
            );

            // Update mock user info
            const updatedUserInfo = {
                ...mockUserInfo,
                displayName: `${DB_TEST_PREFIX}Updated Azure User`,
            };
            mockFetch.mockImplementationOnce((url: string) => {
                if (url === "https://graph.microsoft.com/v1.0/me") {
                    return Promise.resolve({
                        ok: true,
                        json: () =>
                            Promise.resolve({
                                ...updatedUserInfo,
                                mail: updatedUserInfo.email,
                            }),
                    } as Response);
                }
                return originalFetch(url);
            });

            // Login again with updated info
            const secondResult = await azureAuthService.createOrUpdateUser(
                updatedUserInfo,
                mockTokenResponse,
            );

            // Should be the same agent ID
            expect(secondResult.agentId).toBe(firstResult.agentId);
            // But different session ID
            expect(secondResult.sessionId).not.toBe(firstResult.sessionId);

            // Verify metadata was updated
            const [provider] = await superUserSql`
                SELECT * FROM auth.agent_auth_providers
                WHERE auth__agent_id = ${secondResult.agentId}::UUID
                  AND auth__provider_name = ${Auth.E_Provider.AZURE}
            `;
            expect(provider.auth__metadata.displayName).toBe(
                updatedUserInfo.displayName,
            );
        });

        test("should link Azure AD to existing account", async () => {
            // Create a regular user first
            const agentId = randomUUID();
            await superUserSql`
                INSERT INTO auth.agent_profiles (
                    general__agent_profile_id,
                    profile__username,
                    auth__email,
                    auth__is_admin,
                    auth__is_anon
                ) VALUES (
                    ${agentId}::UUID,
                    ${`${DB_TEST_PREFIX}Regular User`},
                    ${`${DB_TEST_PREFIX}regular@test.com`},
                    false,
                    false
                )
            `;

            // Link Azure AD
            await azureAuthService.linkProvider(
                agentId,
                mockUserInfo,
                mockTokenResponse,
            );

            // Verify link was created
            const [provider] = await superUserSql`
                SELECT * FROM auth.agent_auth_providers
                WHERE auth__agent_id = ${agentId}::UUID
                  AND auth__provider_name = ${Auth.E_Provider.AZURE}
            `;
            expect(provider).toBeDefined();
            expect(provider.auth__provider_uid).toBe(mockUserInfo.id);
            expect(provider.auth__provider_email).toBe(mockUserInfo.email);
        });

        test("should prevent linking already linked Azure AD account", async () => {
            // Create two users
            const agentId1 = randomUUID();
            const agentId2 = randomUUID();

            await superUserSql`
                INSERT INTO auth.agent_profiles (
                    general__agent_profile_id,
                    profile__username,
                    auth__email
                ) VALUES
                    (${agentId1}::UUID, ${`${DB_TEST_PREFIX}User 1`}, ${`${DB_TEST_PREFIX}user1@test.com`}),
                    (${agentId2}::UUID, ${`${DB_TEST_PREFIX}User 2`}, ${`${DB_TEST_PREFIX}user2@test.com`})
            `;

            // Link Azure AD to first user
            await azureAuthService.linkProvider(
                agentId1,
                mockUserInfo,
                mockTokenResponse,
            );

            // Try to link same Azure AD to second user
            await expect(
                azureAuthService.linkProvider(
                    agentId2,
                    mockUserInfo,
                    mockTokenResponse,
                ),
            ).rejects.toThrow(
                "This Azure AD account is already linked to another user",
            );
        });

        test("should sign out user and invalidate session", async () => {
            // Create a user and session
            const result = await azureAuthService.createOrUpdateUser(
                mockUserInfo,
                mockTokenResponse,
            );

            // Sign out
            await azureAuthService.signOut(result.sessionId);

            // Verify session is inactive
            const [session] = await superUserSql`
                SELECT * FROM auth.agent_sessions
                WHERE general__session_id = ${result.sessionId}::UUID
            `;
            expect(session.session__is_active).toBe(false);
        });
    });

    describe("API Endpoints", () => {
        test("should validate JWT session", async () => {
            // Create a user and session
            const result = await azureAuthService.createOrUpdateUser(
                mockUserInfo,
                mockTokenResponse,
            );

            const response = await fetch(
                `${apiServerUrl}/api/auth/session/validate`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        token: result.jwt,
                        provider: Auth.E_Provider.AZURE,
                    }),
                },
            );

            const data = await response.json();
            expect(response.status).toBe(200);
            expect(data.success).toBe(true);
            expect(data.data.agentId).toBe(result.agentId);
            expect(data.data.sessionId).toBe(result.sessionId);
        });

        test("should reject invalid JWT", async () => {
            const response = await fetch(
                `${apiServerUrl}/api/auth/session/validate`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        token: "invalid-jwt-token",
                        provider: Auth.E_Provider.AZURE,
                    }),
                },
            );

            const data = await response.json();
            expect(response.status).toBe(401);
            expect(data.success).toBe(false);
            expect(data.error).toContain("Token is empty or malformed");
        });

        test("should generate OAuth authorization URL", async () => {
            const response = await fetch(
                `${apiServerUrl}/api/auth/oauth/authorize?provider=${Auth.E_Provider.AZURE}`,
                {
                    method: "GET",
                },
            );

            const data = await response.json();
            expect(response.status).toBe(200);
            expect(data.success).toBe(true);
            expect(data.data.authUrl).toBe(
                "https://login.microsoftonline.com/mock-auth-url",
            );
        });

        test("should handle OAuth callback for login", async () => {
            // Prepare state for callback
            const state: I_OAuthState = {
                provider: Auth.E_Provider.AZURE,
                action: "login",
            };
            const stateParam = Buffer.from(JSON.stringify(state)).toString(
                "base64url",
            );

            // Store PKCE verifier
            const cacheKey = `pkce_verifier_${stateParam}`;
            await superUserSql`
                INSERT INTO auth.oauth_state_cache (
                    cache_key,
                    cache_value,
                    expires_at
                ) VALUES (
                    ${cacheKey},
                    'test-verifier',
                    NOW() + INTERVAL '10 minutes'
                )
            `;

            const response = await fetch(
                `${apiServerUrl}/api/auth/oauth/callback?code=test-code&state=${stateParam}&provider=${Auth.E_Provider.AZURE}`,
                {
                    method: "GET",
                },
            );

            const data = await response.json();
            expect(response.status).toBe(200);
            expect(data.success).toBe(true);
            expect(data.data.token).toBeDefined();
            expect(data.data.agentId).toBeDefined();
            expect(data.data.sessionId).toBeDefined();
            expect(data.data.provider).toBe(Auth.E_Provider.AZURE);
        });

        test("should list linked providers", async () => {
            // Create a user with Azure AD
            const result = await azureAuthService.createOrUpdateUser(
                mockUserInfo,
                mockTokenResponse,
            );

            const response = await fetch(
                `${apiServerUrl}/api/auth/providers?sessionId=${result.sessionId}`,
                {
                    method: "GET",
                },
            );

            const data = await response.json();
            expect(response.status).toBe(200);
            expect(data.success).toBe(true);
            expect(data.data).toHaveLength(1);
            expect(data.data[0].auth__provider_name).toBe(
                Auth.E_Provider.AZURE,
            );
            expect(data.data[0].auth__provider_uid).toBe(mockUserInfo.id);
        });

        test("should unlink provider", async () => {
            // Create a user with Azure AD
            const result = await azureAuthService.createOrUpdateUser(
                mockUserInfo,
                mockTokenResponse,
            );

            const response = await fetch(
                `${apiServerUrl}/api/auth/providers/unlink`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        provider: Auth.E_Provider.AZURE,
                        providerUid: mockUserInfo.id,
                        sessionId: result.sessionId,
                    }),
                },
            );

            const data = await response.json();
            expect(response.status).toBe(200);
            expect(data.success).toBe(true);

            // Verify provider was unlinked
            const [provider] = await superUserSql`
                SELECT * FROM auth.agent_auth_providers
                WHERE auth__agent_id = ${result.agentId}::UUID
                  AND auth__provider_name = ${Auth.E_Provider.AZURE}
            `;
            expect(provider).toBeUndefined();
        });

        test("should logout user", async () => {
            // Create a user and session
            const result = await azureAuthService.createOrUpdateUser(
                mockUserInfo,
                mockTokenResponse,
            );

            const response = await fetch(`${apiServerUrl}/api/auth/logout`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    sessionId: result.sessionId,
                }),
            });

            const data = await response.json();
            expect(response.status).toBe(200);
            expect(data.success).toBe(true);

            // Verify session is inactive
            const [session] = await superUserSql`
                SELECT * FROM auth.agent_sessions
                WHERE general__session_id = ${result.sessionId}::UUID
            `;
            expect(session.session__is_active).toBe(false);
        });

        test("should handle WebSocket connection with Azure AD JWT", async () => {
            // Create a user and session
            const result = await azureAuthService.createOrUpdateUser(
                mockUserInfo,
                mockTokenResponse,
            );

            const ws = new WebSocket(
                `ws://${serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_MANAGER_HOST_CONTAINER_BIND_INTERNAL}:${serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_MANAGER_PORT_CONTAINER_BIND_INTERNAL}/ws?token=${result.jwt}&provider=${Auth.E_Provider.AZURE}`,
            );

            await new Promise<void>((resolve, reject) => {
                ws.onopen = () => {
                    ws.onmessage = (event) => {
                        const message = JSON.parse(event.data);
                        if (message.type === "SESSION_INFO") {
                            expect(message.agentId).toBe(result.agentId);
                            expect(message.sessionId).toBe(result.sessionId);
                            ws.close();
                            resolve();
                        }
                    };
                };
                ws.onerror = reject;
                setTimeout(
                    () => reject(new Error("WebSocket connection timeout")),
                    5000,
                );
            });
        });
    });

    afterAll(async () => {
        BunLogModule({
            message: "Cleaning up Azure AD test data...",
            type: "debug",
            suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
            debug: cliConfiguration.VRCA_CLI_DEBUG,
        });

        // Restore original fetch
        global.fetch = originalFetch;

        // Clean up test accounts and providers
        await superUserSql`
            DELETE FROM auth.agent_auth_providers 
            WHERE auth__provider_email LIKE ${`${DB_TEST_PREFIX}%`}
        `;
        await cleanupTestAccounts({ superUserSql });
        await superUserSql`
            DELETE FROM auth.oauth_state_cache 
            WHERE cache_key LIKE ${`${DB_TEST_PREFIX}%`}
        `;

        // Stop API server
        if (apiManager) {
            apiManager.cleanup();
        }

        // Disconnect from DB
        await BunPostgresClientModule.getInstance({
            debug: cliConfiguration.VRCA_CLI_DEBUG,
            suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
        }).disconnect();

        BunLogModule({
            message: "Azure AD test cleanup complete",
            type: "debug",
            suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
            debug: cliConfiguration.VRCA_CLI_DEBUG,
        });
    });
});
