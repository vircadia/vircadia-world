// =============================================================================
// ============================== IMPORTS, TYPES, AND INTERFACES ==============================
// =============================================================================

import {
    ConfidentialClientApplication,
    type Configuration,
    type AuthorizationUrlRequest,
    type AuthorizationCodeRequest,
    type AccountInfo,
    type AuthenticationResult,
    CryptoProvider,
} from "@azure/msal-node";
import { BunLogModule } from "../../../../../../sdk/vircadia-world-sdk-ts/bun/src/module/vircadia.common.bun.log.module";
import { serverConfiguration } from "../../../../../../sdk/vircadia-world-sdk-ts/bun/src/config/vircadia.server.config";
import type postgres from "postgres";
import { sign } from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { Auth } from "../../../../../../sdk/vircadia-world-sdk-ts/schema/src/vircadia.schema.general";

// =================================================================================
// ================ INTERFACES & TYPES ==================
// =================================================================================

export interface I_AzureADConfig {
    clientId: string;
    clientSecret: string;
    tenantId: string;
    redirectUri: string;
    scopes: string[];
    jwtSecret: string;
}

export interface I_OAuthState {
    provider: string;
    action: "login" | "link";
    sessionId?: string;
    agentId?: string;
    redirectUrl?: string;
}

export interface I_TokenResponse {
    accessToken: string;
    idToken?: string;
    refreshToken?: string;
    expiresOn?: Date;
    account?: AccountInfo;
}

export interface I_UserInfo {
    id: string;
    email: string;
    displayName: string;
    givenName?: string;
    surname?: string;
    userPrincipalName?: string;
}

// =================================================================================
// ================ AZURE AD AUTH SERVICE ==================
// =================================================================================

const LOG_PREFIX = "Azure AD Auth Service";

export class AzureADAuthService {
    private msalClient: ConfidentialClientApplication;
    private cryptoProvider: CryptoProvider;
    private config: I_AzureADConfig;
    private db: postgres.Sql;

    constructor(config: I_AzureADConfig, db: postgres.Sql) {
        this.config = config;
        this.db = db;
        this.cryptoProvider = new CryptoProvider();

        const msalConfig: Configuration = {
            auth: {
                clientId: config.clientId,
                authority: `https://login.microsoftonline.com/${config.tenantId}`,
                clientSecret: config.clientSecret,
            },
            system: {
                loggerOptions: {
                    loggerCallback: (logLevel, message, containsPii) => {
                        if (!containsPii) {
                            BunLogModule({
                                prefix: LOG_PREFIX,
                                message: `MSAL: ${message}`,
                                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                                suppress:
                                    serverConfiguration.VRCA_SERVER_SUPPRESS,
                                type: "debug",
                            });
                        }
                    },
                    piiLoggingEnabled: false,
                    logLevel: serverConfiguration.VRCA_SERVER_DEBUG ? 3 : 0, // 3 = Verbose, 0 = Error
                },
            },
        };

        this.msalClient = new ConfidentialClientApplication(msalConfig);
    }

    /**
     * Get the authorization URL for OAuth flow
     */
    async getAuthorizationUrl(state: I_OAuthState): Promise<string> {
        try {
            const stateParam = Buffer.from(JSON.stringify(state)).toString(
                "base64url",
            );

            BunLogModule({
                prefix: LOG_PREFIX,
                message: "Generating authorization URL",
                debug: true,
                suppress: false,
                type: "debug",
                data: {
                    state,
                    stateParam,
                },
            });

            // Generate PKCE codes
            const { verifier, challenge } =
                await this.cryptoProvider.generatePkceCodes();

            BunLogModule({
                prefix: LOG_PREFIX,
                message: "PKCE codes generated",
                debug: true,
                suppress: false,
                type: "debug",
                data: {
                    verifierLength: verifier?.length,
                    challengeLength: challenge?.length,
                },
            });

            // Store the verifier in cache for later use during token exchange
            const cacheKey = `pkce_verifier_${stateParam}`;

            BunLogModule({
                prefix: LOG_PREFIX,
                message: "Storing PKCE verifier in cache",
                debug: true,
                suppress: false,
                type: "debug",
                data: {
                    cacheKey,
                    expiresIn: "10 minutes",
                },
            });

            // Note: In production, you'd want to store this in a secure cache like Redis
            // For now, we'll store it in the database with expiry
            try {
                await this.db`
                    INSERT INTO auth.oauth_state_cache (
                        cache_key,
                        cache_value,
                        expires_at
                    ) VALUES (
                        ${cacheKey},
                        ${verifier},
                        NOW() + INTERVAL '10 minutes'
                    )
                    ON CONFLICT (cache_key) DO UPDATE
                    SET cache_value = EXCLUDED.cache_value,
                        expires_at = EXCLUDED.expires_at
                `;

                BunLogModule({
                    prefix: LOG_PREFIX,
                    message: "PKCE verifier stored successfully",
                    debug: true,
                    suppress: false,
                    type: "success",
                    data: {
                        cacheKey,
                    },
                });

                // Verify it was stored
                const verifyStore = await this.db`
                    SELECT cache_key, expires_at::text as expires_at
                    FROM auth.oauth_state_cache
                    WHERE cache_key = ${cacheKey}
                `;

                BunLogModule({
                    prefix: LOG_PREFIX,
                    message: "PKCE verifier storage verification",
                    debug: true,
                    suppress: false,
                    type: "debug",
                    data: {
                        stored: verifyStore.length > 0,
                        entry: verifyStore[0],
                    },
                });
            } catch (dbError) {
                BunLogModule({
                    prefix: LOG_PREFIX,
                    message: "Failed to store PKCE verifier",
                    debug: true,
                    suppress: false,
                    type: "error",
                    data: {
                        error:
                            dbError instanceof Error
                                ? dbError.message
                                : String(dbError),
                        stack:
                            dbError instanceof Error
                                ? dbError.stack
                                : undefined,
                        cacheKey,
                    },
                });
                throw new Error(
                    `Failed to store PKCE verifier: ${dbError instanceof Error ? dbError.message : String(dbError)}`,
                );
            }

            const authCodeUrlParameters: AuthorizationUrlRequest = {
                scopes: this.config.scopes,
                redirectUri: this.config.redirectUri,
                state: stateParam,
                codeChallenge: challenge,
                codeChallengeMethod: "S256",
                prompt: "select_account", // Force account selection
            };

            BunLogModule({
                prefix: LOG_PREFIX,
                message: "Creating auth URL with parameters",
                debug: true,
                suppress: false,
                type: "debug",
                data: {
                    scopes: authCodeUrlParameters.scopes,
                    redirectUri: authCodeUrlParameters.redirectUri,
                    hasState: !!authCodeUrlParameters.state,
                    hasChallenge: !!authCodeUrlParameters.codeChallenge,
                    codeChallengeMethod:
                        authCodeUrlParameters.codeChallengeMethod,
                },
            });

            const authUrl = await this.msalClient.getAuthCodeUrl(
                authCodeUrlParameters,
            );

            BunLogModule({
                prefix: LOG_PREFIX,
                message: "Generated authorization URL",
                debug: true, // Force debug for troubleshooting
                suppress: false,
                type: "success",
                data: {
                    state,
                    authUrl,
                    authUrlLength: authUrl?.length,
                    authUrlType: typeof authUrl,
                },
            });

            return authUrl;
        } catch (error) {
            BunLogModule({
                prefix: LOG_PREFIX,
                message: "Failed to generate authorization URL",
                error,
                debug: true, // Force debug
                suppress: false,
                type: "error",
                data: {
                    errorMessage:
                        error instanceof Error ? error.message : String(error),
                    errorName: error instanceof Error ? error.name : undefined,
                    stack: error instanceof Error ? error.stack : undefined,
                },
            });
            throw error;
        }
    }

    /**
     * Exchange authorization code for tokens
     */
    async exchangeCodeForTokens(
        code: string,
        state: string,
    ): Promise<I_TokenResponse> {
        try {
            BunLogModule({
                prefix: LOG_PREFIX,
                message: "Starting token exchange",
                debug: true, // Force debug for troubleshooting
                suppress: false,
                type: "debug",
                data: {
                    codeLength: code?.length,
                    state,
                    hasCode: !!code,
                    hasState: !!state,
                },
            });

            // Retrieve the PKCE verifier from cache
            const cacheKey = `pkce_verifier_${state}`;

            BunLogModule({
                prefix: LOG_PREFIX,
                message: "Looking up PKCE verifier",
                debug: true,
                suppress: false,
                type: "debug",
                data: { cacheKey },
            });

            let cacheResult: { cache_value: string } | undefined;
            try {
                const results = await this.db<[{ cache_value: string }]>`
                    SELECT cache_value FROM auth.oauth_state_cache
                    WHERE cache_key = ${cacheKey}
                      AND expires_at > NOW()
                `;

                cacheResult = results?.[0];

                BunLogModule({
                    prefix: LOG_PREFIX,
                    message: "PKCE verifier query result",
                    debug: true,
                    suppress: false,
                    type: "debug",
                    data: {
                        found: !!cacheResult,
                        hasValue: !!cacheResult?.cache_value,
                        cacheKey,
                    },
                });

                // Also check for expired entries for debugging
                const expiredCheck = await this.db<
                    [{ count: number; min_expires_at: string }]
                >`
                    SELECT COUNT(*) as count, MIN(expires_at)::text as min_expires_at
                    FROM auth.oauth_state_cache
                    WHERE cache_key = ${cacheKey}
                      AND expires_at <= NOW()
                `;

                if (expiredCheck?.[0]?.count > 0) {
                    BunLogModule({
                        prefix: LOG_PREFIX,
                        message: "Found expired PKCE verifier entries",
                        debug: true,
                        suppress: false,
                        type: "warning",
                        data: {
                            expiredCount: expiredCheck[0].count,
                            oldestExpiry: expiredCheck[0].min_expires_at,
                            cacheKey,
                        },
                    });
                }
            } catch (dbError) {
                BunLogModule({
                    prefix: LOG_PREFIX,
                    message: "Database error while retrieving PKCE verifier",
                    debug: true,
                    suppress: false,
                    type: "error",
                    data: {
                        error:
                            dbError instanceof Error
                                ? dbError.message
                                : String(dbError),
                        stack:
                            dbError instanceof Error
                                ? dbError.stack
                                : undefined,
                        cacheKey,
                    },
                });
                throw new Error(
                    `Failed to retrieve PKCE verifier: ${dbError instanceof Error ? dbError.message : String(dbError)}`,
                );
            }

            if (!cacheResult?.cache_value) {
                // Check if any entries exist for debugging
                const allEntries = await this.db<
                    [
                        {
                            cache_key: string;
                            expires_at: string;
                            created_at: string;
                        },
                    ]
                >`
                    SELECT cache_key, expires_at::text, created_at::text
                    FROM auth.oauth_state_cache
                    ORDER BY created_at DESC
                    LIMIT 10
                `;

                BunLogModule({
                    prefix: LOG_PREFIX,
                    message:
                        "PKCE verifier not found in cache - showing recent entries",
                    debug: true,
                    suppress: false,
                    type: "error",
                    data: {
                        cacheKey,
                        recentEntries: allEntries,
                        totalEntries: allEntries.length,
                    },
                });
                throw new Error("PKCE verifier not found or expired");
            }

            const verifier = cacheResult.cache_value;

            BunLogModule({
                prefix: LOG_PREFIX,
                message: "PKCE verifier retrieved successfully",
                debug: true,
                suppress: false,
                type: "debug",
                data: {
                    verifierLength: verifier?.length,
                    cacheKey,
                },
            });

            // Clean up the cache entry
            try {
                await this.db`
                    DELETE FROM auth.oauth_state_cache
                    WHERE cache_key = ${cacheKey}
                `;

                BunLogModule({
                    prefix: LOG_PREFIX,
                    message: "PKCE verifier cache entry cleaned up",
                    debug: true,
                    suppress: false,
                    type: "debug",
                    data: { cacheKey },
                });
            } catch (deleteError) {
                BunLogModule({
                    prefix: LOG_PREFIX,
                    message: "Failed to clean up PKCE verifier cache entry",
                    debug: true,
                    suppress: false,
                    type: "warning",
                    data: {
                        error:
                            deleteError instanceof Error
                                ? deleteError.message
                                : String(deleteError),
                        cacheKey,
                    },
                });
                // Don't throw here, continue with token exchange
            }

            const tokenRequest: AuthorizationCodeRequest = {
                code,
                scopes: this.config.scopes,
                redirectUri: this.config.redirectUri,
                codeVerifier: verifier,
            };

            BunLogModule({
                prefix: LOG_PREFIX,
                message: "Calling MSAL acquireTokenByCode",
                debug: true,
                suppress: false,
                type: "debug",
                data: {
                    hasCode: !!tokenRequest.code,
                    scopes: tokenRequest.scopes,
                    redirectUri: tokenRequest.redirectUri,
                    hasCodeVerifier: !!tokenRequest.codeVerifier,
                    codeVerifierLength: tokenRequest.codeVerifier?.length,
                },
            });

            let response: AuthenticationResult | null;
            try {
                response =
                    await this.msalClient.acquireTokenByCode(tokenRequest);
            } catch (msalError) {
                BunLogModule({
                    prefix: LOG_PREFIX,
                    message: "MSAL token acquisition failed",
                    debug: true,
                    suppress: false,
                    type: "error",
                    data: {
                        error:
                            msalError instanceof Error
                                ? msalError.message
                                : String(msalError),
                        errorName:
                            msalError instanceof Error
                                ? msalError.name
                                : undefined,
                        stack:
                            msalError instanceof Error
                                ? msalError.stack
                                : undefined,
                    },
                });
                throw new Error(
                    `Token acquisition failed: ${msalError instanceof Error ? msalError.message : String(msalError)}`,
                );
            }

            if (!response) {
                BunLogModule({
                    prefix: LOG_PREFIX,
                    message: "MSAL returned null response",
                    debug: true,
                    suppress: false,
                    type: "error",
                });
                throw new Error("Failed to acquire token - null response");
            }

            BunLogModule({
                prefix: LOG_PREFIX,
                message: "Successfully exchanged code for tokens",
                debug: true, // Force debug
                suppress: false,
                type: "success",
                data: {
                    account: response.account,
                    hasAccessToken: !!response.accessToken,
                    hasIdToken: !!response.idToken,
                    expiresOn: response.expiresOn,
                },
            });

            return {
                accessToken: response.accessToken,
                idToken: response.idToken,
                refreshToken: undefined, // MSAL handles refresh tokens internally
                expiresOn: response.expiresOn || undefined,
                account: response.account || undefined,
            };
        } catch (error) {
            BunLogModule({
                prefix: LOG_PREFIX,
                message: "Failed to exchange code for tokens",
                error,
                debug: true, // Force debug
                suppress: false,
                type: "error",
                data: {
                    errorMessage:
                        error instanceof Error ? error.message : String(error),
                    errorName: error instanceof Error ? error.name : undefined,
                    errorStack:
                        error instanceof Error ? error.stack : undefined,
                    code: `${code?.substring(0, 20)}...`, // Log partial code for debugging
                    state,
                },
            });
            throw error;
        }
    }

    /**
     * Get user info from Microsoft Graph
     */
    async getUserInfo(accessToken: string): Promise<I_UserInfo> {
        try {
            const response = await fetch(
                "https://graph.microsoft.com/v1.0/me",
                {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                    },
                },
            );

            if (!response.ok) {
                throw new Error(
                    `Failed to fetch user info: ${response.statusText}`,
                );
            }

            const data = await response.json();

            return {
                id: data.id,
                email: data.mail || data.userPrincipalName,
                displayName: data.displayName,
                givenName: data.givenName,
                surname: data.surname,
                userPrincipalName: data.userPrincipalName,
            };
        } catch (error) {
            BunLogModule({
                prefix: LOG_PREFIX,
                message: "Failed to get user info from Microsoft Graph",
                error,
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                type: "error",
            });
            throw error;
        }
    }

    /**
     * Create or update user in database
     */
    async createOrUpdateUser(
        userInfo: I_UserInfo,
        tokenResponse: I_TokenResponse,
    ): Promise<{
        agentId: string;
        sessionId: string;
        jwt: string;
    }> {
        try {
            // Start a transaction
            return await this.db.begin(async (tx) => {
                // Check if user exists with this Azure AD ID
                const [existingProvider] = await tx<
                    [{ auth__agent_id: string }]
                >`
                    SELECT auth__agent_id
                    FROM auth.agent_auth_providers
                    WHERE auth__provider_name = 'azure'
                      AND auth__provider_uid = ${userInfo.id}
                `;

                let agentId: string;

                if (existingProvider) {
                    // User exists, update their info
                    agentId = existingProvider.auth__agent_id;

                    // Update the auth provider record
                    await tx`
                        UPDATE auth.agent_auth_providers
                        SET auth__provider_email = ${userInfo.email},
                            auth__metadata = ${JSON.stringify({
                                displayName: userInfo.displayName,
                                givenName: userInfo.givenName,
                                surname: userInfo.surname,
                                userPrincipalName: userInfo.userPrincipalName,
                                lastLogin: new Date().toISOString(),
                            })},
                            general__updated_at = NOW()
                        WHERE auth__agent_id = ${agentId}
                          AND auth__provider_name = 'azure'
                    `;

                    // Update profile
                    await tx`
                        UPDATE auth.agent_profiles
                        SET profile__last_seen_at = NOW(),
                            general__updated_at = NOW()
                        WHERE general__agent_profile_id = ${agentId}
                    `;
                } else {
                    // New user, create agent and provider records
                    agentId = randomUUID();

                    // Create agent profile
                    await tx`
                        INSERT INTO auth.agent_profiles (
                            general__agent_profile_id,
                            profile__username,
                            auth__email,
                            auth__is_admin,
                            auth__is_anon,
                            profile__last_seen_at
                        ) VALUES (
                            ${agentId}::UUID,
                            ${userInfo.displayName || userInfo.email},
                            ${userInfo.email},
                            false,
                            false,
                            NOW()
                        )
                    `;

                    // Create auth provider record
                    await tx`
                        INSERT INTO auth.agent_auth_providers (
                            auth__agent_id,
                            auth__provider_name,
                            auth__provider_uid,
                            auth__provider_email,
                            auth__metadata
                        ) VALUES (
                            ${agentId}::UUID,
                            'azure',
                            ${userInfo.id},
                            ${userInfo.email},
                            ${JSON.stringify({
                                displayName: userInfo.displayName,
                                givenName: userInfo.givenName,
                                surname: userInfo.surname,
                                userPrincipalName: userInfo.userPrincipalName,
                                lastLogin: new Date().toISOString(),
                            })}
                        )
                    `;
                }

                // Create a new session
                const sessionId = randomUUID();
                const expiresAt = new Date();
                expiresAt.setHours(expiresAt.getHours() + 24); // 24 hour session

                // Create JWT token
                const jwt = sign(
                    {
                        sessionId,
                        agentId,
                        provider: Auth.E_Provider.AZURE,
                        email: userInfo.email,
                    },
                    this.config.jwtSecret,
                    {
                        expiresIn: "24h",
                    },
                );

                // Store session in database
                await tx`
                    INSERT INTO auth.agent_sessions (
                        general__session_id,
                        auth__agent_id,
                        auth__provider_name,
                        session__expires_at,
                        session__jwt,
                        session__is_active
                    ) VALUES (
                        ${sessionId}::UUID,
                        ${agentId}::UUID,
                        'azure',
                        ${expiresAt},
                        ${jwt},
                        true
                    )
                `;

                return {
                    agentId,
                    sessionId,
                    jwt,
                };
            });
        } catch (error) {
            BunLogModule({
                prefix: LOG_PREFIX,
                message: "Failed to create or update user",
                error,
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                type: "error",
            });
            throw error;
        }
    }

    /**
     * Link Azure AD account to existing agent
     */
    async linkProvider(
        agentId: string,
        userInfo: I_UserInfo,
        tokenResponse: I_TokenResponse,
    ): Promise<void> {
        try {
            await this.db.begin(async (tx) => {
                // Check if this Azure AD account is already linked to another agent
                const [existingLink] = await tx<[{ auth__agent_id: string }]>`
                    SELECT auth__agent_id
                    FROM auth.agent_auth_providers
                    WHERE auth__provider_name = 'azure'
                      AND auth__provider_uid = ${userInfo.id}
                      AND auth__agent_id != ${agentId}::UUID
                `;

                if (existingLink) {
                    throw new Error(
                        "This Azure AD account is already linked to another user",
                    );
                }

                // Check if agent already has Azure linked
                const [hasAzure] = await tx<[{ count: number }]>`
                    SELECT COUNT(*) as count
                    FROM auth.agent_auth_providers
                    WHERE auth__agent_id = ${agentId}::UUID
                      AND auth__provider_name = 'azure'
                `;

                if (hasAzure?.count > 0) {
                    throw new Error(
                        "This account already has an Azure AD provider linked",
                    );
                }

                // Link the provider
                await tx`
                    INSERT INTO auth.agent_auth_providers (
                        auth__agent_id,
                        auth__provider_name,
                        auth__provider_uid,
                        auth__provider_email,
                        auth__metadata
                    ) VALUES (
                        ${agentId}::UUID,
                        'azure',
                        ${userInfo.id},
                        ${userInfo.email},
                        ${JSON.stringify({
                            displayName: userInfo.displayName,
                            givenName: userInfo.givenName,
                            surname: userInfo.surname,
                            userPrincipalName: userInfo.userPrincipalName,
                            linkedAt: new Date().toISOString(),
                        })}
                    )
                `;
            });

            BunLogModule({
                prefix: LOG_PREFIX,
                message: "Successfully linked Azure AD provider",
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                type: "debug",
                data: { agentId, azureId: userInfo.id },
            });
        } catch (error) {
            BunLogModule({
                prefix: LOG_PREFIX,
                message: "Failed to link Azure AD provider",
                error,
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                type: "error",
            });
            throw error;
        }
    }

    /**
     * Refresh access token using silent flow
     * Note: MSAL manages refresh tokens internally, so we use acquireTokenSilent
     */
    async refreshAccessToken(agentId: string): Promise<string> {
        try {
            // Get user account info from database
            const [provider] = await this.db<
                [
                    {
                        auth__provider_uid: string;
                        auth__provider_email: string;
                    },
                ]
            >`
                SELECT auth__provider_uid, auth__provider_email
                FROM auth.agent_auth_providers
                WHERE auth__agent_id = ${agentId}::UUID
                  AND auth__provider_name = 'azure'
            `;

            if (!provider) {
                throw new Error("No Azure AD provider found for user");
            }

            // Try to get token from cache using acquireTokenSilent
            const account = {
                homeAccountId: `${provider.auth__provider_uid}.${this.config.tenantId}`,
                environment: "login.microsoftonline.com",
                tenantId: this.config.tenantId,
                username: provider.auth__provider_email,
                localAccountId: provider.auth__provider_uid,
            };

            const silentRequest = {
                scopes: this.config.scopes,
                account: account,
            };

            try {
                const response =
                    await this.msalClient.acquireTokenSilent(silentRequest);
                if (!response) {
                    throw new Error("Failed to acquire token silently");
                }
                return response.accessToken;
            } catch (silentError) {
                // If silent acquisition fails, the user needs to re-authenticate
                BunLogModule({
                    prefix: LOG_PREFIX,
                    message:
                        "Silent token acquisition failed, user needs to re-authenticate",
                    error: silentError,
                    debug: serverConfiguration.VRCA_SERVER_DEBUG,
                    suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                    type: "debug",
                });
                throw new Error(
                    "Token refresh failed. Please re-authenticate.",
                );
            }
        } catch (error) {
            BunLogModule({
                prefix: LOG_PREFIX,
                message: "Failed to refresh access token",
                error,
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                type: "error",
            });
            throw error;
        }
    }

    /**
     * Sign out and revoke tokens
     */
    async signOut(sessionId: string): Promise<void> {
        try {
            // Invalidate the session
            await this.db`
                UPDATE auth.agent_sessions
                SET session__is_active = false,
                    general__updated_at = NOW()
                WHERE general__session_id = ${sessionId}::UUID
            `;

            BunLogModule({
                prefix: LOG_PREFIX,
                message: "User signed out successfully",
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                type: "debug",
                data: { sessionId },
            });
        } catch (error) {
            BunLogModule({
                prefix: LOG_PREFIX,
                message: "Failed to sign out user",
                error,
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                type: "error",
            });
            throw error;
        }
    }
}

// =================================================================================
// ================ HELPER FUNCTIONS ==================
// =================================================================================

/**
 * Parse OAuth state parameter
 */
export function parseOAuthState(stateParam: string): I_OAuthState {
    try {
        return JSON.parse(
            Buffer.from(stateParam, "base64url").toString("utf8"),
        );
    } catch (error) {
        throw new Error("Invalid state parameter");
    }
}

/**
 * Create Azure AD configuration from environment/database
 */
export async function createAzureADConfig(
    db: postgres.Sql,
): Promise<I_AzureADConfig> {
    try {
        // Fetch Azure AD configuration from database
        const [config] = await db<
            [
                {
                    provider__client_id: string;
                    provider__client_secret: string;
                    provider__redirect_uris: string[];
                    provider__scope: string[];
                    provider__jwt_secret: string;
                    provider__metadata: { tenant_id?: string } | null;
                },
            ]
        >`
            SELECT 
                provider__client_id,
                provider__client_secret,
                provider__redirect_uris,
                provider__scope,
                provider__jwt_secret,
                provider__metadata
            FROM auth.auth_providers
            WHERE provider__name = 'azure'
              AND provider__enabled = true
        `;

        if (!config) {
            BunLogModule({
                prefix: LOG_PREFIX,
                message: "No Azure AD configuration found in database",
                debug: true,
                suppress: false,
                type: "error",
            });
            throw new Error(
                "Azure AD provider configuration not found or disabled",
            );
        }

        // Extract tenant ID from metadata or use a default
        const tenantId = config.provider__metadata?.tenant_id || "common";
        const redirectUri = config.provider__redirect_uris?.[0];

        if (!redirectUri) {
            throw new Error("No redirect URI configured for Azure AD provider");
        }

        return {
            clientId: config.provider__client_id,
            clientSecret: config.provider__client_secret,
            tenantId: tenantId,
            redirectUri: redirectUri,
            scopes: config.provider__scope || [
                "openid",
                "profile",
                "email",
                "User.Read",
            ],
            jwtSecret: config.provider__jwt_secret,
        };
    } catch (error) {
        BunLogModule({
            prefix: LOG_PREFIX,
            message: "Failed to load Azure AD configuration",
            error,
            debug: serverConfiguration.VRCA_SERVER_DEBUG,
            suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
            type: "error",
        });
        throw error;
    }
}
