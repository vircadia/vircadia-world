import { log } from "../../sdk/vircadia-world-sdk-ts/module/general/log";
import type postgres from "postgres";
import type { Hono } from "hono";
import { compare, hash } from "bcrypt";
import { sign, verify } from "jsonwebtoken";
import type { MiddlewareHandler } from "hono";
import { VircadiaConfig_Server } from "../../sdk/vircadia-world-sdk-ts/config/vircadia.config.ts";

export enum AuthProvider {
    PASSWORD = "password",
    GITHUB = "github",
    GOOGLE = "google",
}

interface OAuthProviderConfig {
    enabled: boolean;
    displayName: string;
    clientId: string;
    clientSecret: string;
    callbackUrl: string;
    authorizeUrl: string;
    tokenUrl: string;
    userInfoUrl: string;
    scope: string[];
    userDataMapping: {
        endpoint: string;
        additionalEndpoints?: {
            [key: string]: string;
        };
        fields: {
            providerId: string;
            email: string;
            username: string;
        };
    };
}

interface LoginCredentials {
    email: string;
    password: string;
}

interface RegisterData {
    email: string;
    username: string;
    password: string;
}

interface AuthProviderHandler {
    authenticate: (data: any) => Promise<{
        providerId: string;
        email: string;
        username: string;
    }>;
}

interface SessionData {
    sessionId: string;
    agentId: string;
}

interface AuthConfig {
    providers: {
        [key: string]: OAuthProviderConfig;
    };
    jwt: {
        secret: string;
        sessionDuration: string;
        bcryptRounds: number;
    };
}

class AuthManager {
    private authProviders: Map<AuthProvider, AuthProviderHandler> = new Map();

    constructor(
        private readonly sql: postgres.Sql,
        private readonly debugMode: boolean,
    ) {
        // Register built-in providers
        this.registerAuthProvider(AuthProvider.PASSWORD, {
            authenticate: async (credentials: LoginCredentials) => {
                const [agent] = await this.sql`
                    SELECT general__uuid, auth__password_hash, profile__username
                    FROM agent_profiles
                    WHERE auth__email = ${credentials.email}
                `;

                if (!agent || !agent.auth__password_hash) {
                    throw new Error("Invalid credentials");
                }

                const validPassword = await compare(
                    credentials.password,
                    agent.auth__password_hash,
                );

                if (!validPassword) {
                    throw new Error("Invalid credentials");
                }

                return {
                    providerId: agent.general__uuid,
                    email: credentials.email,
                    username: agent.profile__username,
                };
            },
        });
    }

    async initialize() {
        try {
            log({
                message: "Initializing auth manager",
                debug: this.debugMode,
                type: "debug",
            });

            const [result] = await this.sql`
                SELECT cleanup_old_sessions() as cleaned_count;
            `;

            log({
                message: `Cleaned up ${result.cleaned_count} old sessions`,
                debug: this.debugMode,
                type: "debug",
            });

            log({
                message: "Initialized AuthManager",
                debug: this.debugMode,
                type: "debug",
            });
        } catch (error) {
            log({
                message: `Failed to initialize AuthManager: ${error}`,
                debug: this.debugMode,
                type: "error",
            });
            throw error;
        }
    }

    registerAuthProvider(provider: AuthProvider, handler: AuthProviderHandler) {
        this.authProviders.set(provider, handler);
    }

    async register(data: RegisterData) {
        try {
            const passwordHash = await hash(
                data.password,
                VircadiaConfig_Server.auth.jwt.bcryptRounds,
            );

            const [agent] = await this.sql`
                INSERT INTO agent_profiles (
                    profile__username,
                    auth__email,
                    auth__password_hash
                ) VALUES (
                    ${data.username},
                    ${data.email},
                    ${passwordHash}
                )
                RETURNING general__uuid
            `;

            await this.sql`
                INSERT INTO agent_roles (
                    auth__agent_id,
                    auth__role_name,
                    auth__is_active
                ) VALUES (
                    ${agent.general__uuid},
                    'agent',
                    true
                )
            `;

            return this.createSession(agent.general__uuid);
        } catch (error) {
            log({
                message: `Registration failed: ${error}`,
                debug: this.debugMode,
                type: "error",
            });
            throw error;
        }
    }

    async login(credentials: LoginCredentials) {
        return this.authenticateWithProvider(
            AuthProvider.PASSWORD,
            credentials,
        );
    }

    async logout(sessionId: string) {
        await this.sql`
            SELECT invalidate_session(${sessionId});
        `;
    }

    async authenticateWithProvider(provider: AuthProvider, data: any) {
        if (provider === AuthProvider.PASSWORD) {
            const handler = this.authProviders.get(provider);
            if (!handler) {
                throw new Error(`Auth provider ${provider} not supported`);
            }
            const userData = await handler.authenticate(data);
            return this.storeAgentAndCreateSession(userData, provider);
        }

        const userData = await this.handleOAuthFlow(provider, data);
        return this.storeAgentAndCreateSession(userData, provider);
    }

    sessionMiddleware(): MiddlewareHandler {
        return async (c, next) => {
            const token = c.req.header("Authorization")?.replace("Bearer ", "");

            if (token) {
                try {
                    const decoded = verify(
                        token,
                        VircadiaConfig_Server.auth.jwt.secret,
                    ) as {
                        sessionId: string;
                        agentId: string;
                    };

                    // Set the database session context
                    await this
                        .sql`SELECT set_session_context(${decoded.sessionId}::UUID)`;

                    c.set("session", {
                        agentId: decoded.agentId,
                        isAuthenticated: true,
                    });
                } catch (error) {
                    log({
                        message: `Session validation failed: ${error}`,
                        debug: this.debugMode,
                        type: "debug",
                    });
                }
            }

            if (!c.get("session")) {
                // Set anonymous context
                await this.sql`SELECT set_session_context(NULL)`;

                c.set("session", {
                    agentId: "00000000-0000-0000-0000-000000000001",
                    isAuthenticated: false,
                });
            }

            await next();
        };
    }

    private async handleOAuthFlow(provider: AuthProvider, code: string) {
        const config = VircadiaConfig_Server.auth.providers[provider];
        if (!config?.enabled) {
            throw new Error(`Provider ${provider} not enabled`);
        }

        // Exchange code for token
        const tokenResponse = await fetch(config.tokenUrl, {
            method: "POST",
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                client_id: config.clientId,
                client_secret: config.clientSecret,
                code,
                redirect_uri: config.callbackUrl,
            }),
        });

        const tokenData = await tokenResponse.json();
        if (!tokenData.access_token) {
            throw new Error("Failed to obtain access token");
        }

        // Fetch user data from main endpoint
        const userResponse = await fetch(config.userDataMapping.endpoint, {
            headers: {
                Authorization: `Bearer ${tokenData.access_token}`,
                Accept: "application/json",
            },
        });
        const userData = await userResponse.json();

        // Fetch data from additional endpoints if specified
        const additionalData: Record<string, any> = {};
        if (config.userDataMapping.additionalEndpoints) {
            for (const [key, url] of Object.entries(
                config.userDataMapping.additionalEndpoints,
            )) {
                const response = await fetch(url as string, {
                    headers: {
                        Authorization: `Bearer ${tokenData.access_token}`,
                        Accept: "application/json",
                    },
                });
                additionalData[key] = await response.json();
            }
        }

        // Extract fields using regex patterns
        const extractField = (pattern: string, data: any) => {
            const jsonString = JSON.stringify(data);
            const match = jsonString.match(new RegExp(pattern));
            if (!match || !match[1]) {
                throw new Error(
                    `Could not extract field using pattern: ${pattern}`,
                );
            }
            return match[1];
        };

        const extractedData = {
            providerId: extractField(
                config.userDataMapping.fields.providerId,
                userData,
            ).toString(),
            email: extractField(config.userDataMapping.fields.email, userData),
            username: extractField(
                config.userDataMapping.fields.username,
                userData,
            ),
        };

        // Store or update provider authentication
        await this.sql`
            INSERT INTO auth.agent_auth_providers (
                auth__agent_id,
                auth__provider_name,
                auth__provider_uid
            ) VALUES (
                ${extractedData.providerId},
                ${provider},
                ${extractedData.providerId}
            )
            ON CONFLICT (auth__agent_id, auth__provider_name) 
            DO UPDATE SET auth__provider_uid = EXCLUDED.auth__provider_uid
        `;

        return this.storeAgentAndCreateSession(extractedData, provider);
    }

    private async storeAgentAndCreateSession(
        userData: { providerId: string; email: string; username: string },
        provider: AuthProvider,
    ) {
        const [agent] = await this.sql`
            INSERT INTO auth.agent_profiles (
                profile__username,
                auth__email
            ) VALUES (
                ${userData.username},
                ${userData.email}
            )
            ON CONFLICT (auth__email) DO UPDATE
            SET profile__username = EXCLUDED.profile__username
            RETURNING general__uuid
        `;

        await this.sql`
            INSERT INTO auth.agent_sessions (
                auth__agent_id,
                auth__provider_name,
                session__is_active
            ) VALUES (
                ${agent.general__uuid},
                ${provider},
                true
            )
            ON CONFLICT (auth__agent_id, auth__provider_name) 
            DO UPDATE SET session__is_active = EXCLUDED.session__is_active
        `;

        return this.createSession(agent.general__uuid, provider);
    }

    private async createSession(agentId: string, providerName?: string) {
        const [session] = await this.sql`
            SELECT create_agent_session(${agentId}, ${providerName}) as general__session_id;
        `;

        const token = sign(
            {
                sessionId: session.general__session_id,
                agentId,
            },
            VircadiaConfig_Server.auth.jwt.secret,
            { expiresIn: VircadiaConfig_Server.auth.jwt.sessionDuration },
        );

        return { sessionId: session.general__session_id, token };
    }

    private async validateSession(token: string): Promise<string | null> {
        try {
            const decoded = verify(
                token,
                VircadiaConfig_Server.auth.jwt.secret,
            ) as {
                sessionId: string;
                agentId: string;
            };

            const [session] = await this.sql`
                SELECT set_current_session(${decoded.sessionId});
                
                SELECT * FROM auth.agent_sessions
                WHERE general__session_id = ${decoded.sessionId}
                AND session__is_active = true
                AND session__last_seen_at > NOW() - INTERVAL '24 hours'
            `;

            if (!session) {
                return null;
            }

            return decoded.agentId;
        } catch (error) {
            return null;
        }
    }
}

class ApiRouteManager {
    constructor(
        private auth: AuthManager,
        private sql: postgres.Sql,
        private debugMode: boolean,
    ) {}

    addRoutes(app: Hono) {
        this.addAuthRoutes(app);
    }

    private addAuthRoutes(app: Hono) {
        const routes = app.basePath("/services/world-auth");

        routes.use("/*", this.auth.sessionMiddleware());

        routes.post("/register", async (c) => {
            try {
                const data = (await c.req.json()) as RegisterData;
                const session = await this.auth.register(data);
                return c.json(session);
            } catch (error) {
                return c.json({ error: "Registration failed" }, 400);
            }
        });

        routes.post("/login", async (c) => {
            try {
                const credentials = (await c.req.json()) as LoginCredentials;
                const session = await this.auth.login(credentials);
                return c.json(session);
            } catch (error) {
                return c.json({ error: "Login failed" }, 401);
            }
        });

        // ... (rest of auth routes)
    }
}

export class WorldApiManager {
    private auth: AuthManager;
    private routes: ApiRouteManager;

    constructor(
        private sql: postgres.Sql,
        private readonly debugMode: boolean,
    ) {
        this.auth = new AuthManager(sql, debugMode);
        this.routes = new ApiRouteManager(this.auth, sql, debugMode);
    }

    async initialize() {
        await this.auth.initialize();
    }

    addRoutes(app: Hono) {
        this.routes.addRoutes(app);
    }
}
