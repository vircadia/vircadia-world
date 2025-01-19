import { log } from "../../sdk/vircadia-world-sdk-ts/module/general/log";
import type postgres from "postgres";
import type { Hono } from "hono";
import { compare, hash } from "bcrypt";
import { sign, verify } from "jsonwebtoken";

export enum AuthProvider {
    PASSWORD = "password",
    GITHUB = "github",
    GOOGLE = "google",
}

interface AuthConfig {
    jwtSecret: string;
    sessionDuration: string;
    bcryptRounds: number;
    providers: {
        [key in AuthProvider]?: {
            enabled: boolean;
            displayName: string;
            description?: string;
            clientId?: string;
            clientSecret?: string;
            callbackUrl?: string;
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

export class WorldAuthManager {
    private sql: postgres.Sql;
    private config: AuthConfig;
    private authProviders: Map<AuthProvider, AuthProviderHandler> = new Map();

    constructor(
        sql: postgres.Sql,
        config: AuthConfig,
        private readonly debugMode: boolean = false,
    ) {
        this.sql = sql;
        this.config = config;

        // Register built-in providers
        this.registerAuthProvider(AuthProvider.PASSWORD, {
            authenticate: async (credentials: LoginCredentials) => {
                const [agent] = await this.sql`
                    SELECT general__uuid, auth__password_hash
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

        this.registerAuthProvider(AuthProvider.GITHUB, {
            authenticate: async (code: string) => {
                // Exchange code for access token
                const tokenResponse = await fetch(
                    "https://github.com/login/oauth/access_token",
                    {
                        method: "POST",
                        headers: {
                            Accept: "application/json",
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                            client_id:
                                this.config.providers[AuthProvider.GITHUB]
                                    ?.clientId,
                            client_secret:
                                this.config.providers[AuthProvider.GITHUB]
                                    ?.clientSecret,
                            code,
                        }),
                    },
                );

                const tokenData = await tokenResponse.json();
                const accessToken = tokenData.access_token;

                // Get user data from GitHub
                const userResponse = await fetch(
                    "https://api.github.com/user",
                    {
                        headers: {
                            Authorization: `Bearer ${accessToken}`,
                            Accept: "application/json",
                        },
                    },
                );

                const userData = await userResponse.json();

                // Get user's email
                const emailResponse = await fetch(
                    "https://api.github.com/user/emails",
                    {
                        headers: {
                            Authorization: `Bearer ${accessToken}`,
                            Accept: "application/json",
                        },
                    },
                );

                const emails = await emailResponse.json();
                const primaryEmail = emails.find((e: any) => e.primary)?.email;

                return {
                    providerId: userData.id.toString(),
                    email: primaryEmail,
                    username: userData.login,
                };
            },
        });
    }

    registerAuthProvider(provider: AuthProvider, handler: AuthProviderHandler) {
        this.authProviders.set(provider, handler);
    }

    async authenticateWithProvider(provider: AuthProvider, data: any) {
        const handler = this.authProviders.get(provider);
        if (!handler) {
            throw new Error(`Auth provider ${provider} not supported`);
        }

        const userData = await handler.authenticate(data);

        // Create or update agent profile
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

        // Link provider
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

    async initialize() {
        try {
            log({
                message: "Initializing world auth manager",
                debug: this.debugMode,
                type: "debug",
            });

            // Clean up expired sessions
            await this.sql`
                UPDATE auth.agent_sessions 
                SET session__is_active = false
                WHERE session__last_seen_at < NOW() - INTERVAL '24 hours'
            `;

            log({
                message: "Initialized WorldAuthManager",
                debug: this.debugMode,
                type: "debug",
            });
        } catch (error) {
            log({
                message: `Failed to initialize WorldAuthManager: ${error}`,
                debug: this.debugMode,
                type: "error",
            });
            throw error;
        }
    }

    private async createSession(agentId: string, providerName?: string) {
        const [session] = await this.sql`
            INSERT INTO auth.agent_sessions (
                auth__agent_id,
                auth__provider_name,
                session__is_active
            ) VALUES (
                ${agentId},
                ${providerName ?? null},
                true
            )
            RETURNING general__session_id
        `;

        const token = sign(
            {
                sessionId: session.general__session_id,
                agentId,
            },
            this.config.jwtSecret,
            { expiresIn: this.config.sessionDuration },
        );

        return { sessionId: session.general__session_id, token };
    }

    private async validateSession(token: string) {
        try {
            const decoded = verify(token, this.config.jwtSecret) as {
                sessionId: string;
                agentId: string;
            };

            const [session] = await this.sql`
                SELECT * FROM auth.agent_sessions
                WHERE general__session_id = ${decoded.sessionId}
                AND session__is_active = true
                AND session__last_seen_at > NOW() - INTERVAL '24 hours'
            `;

            if (!session) {
                return null;
            }

            // Update last seen
            await this.sql`
                UPDATE auth.agent_sessions
                SET session__last_seen_at = NOW()
                WHERE general__session_id = ${decoded.sessionId}
            `;

            return decoded.agentId;
        } catch (error) {
            return null;
        }
    }

    async register(data: RegisterData) {
        try {
            const passwordHash = await hash(
                data.password,
                this.config.bcryptRounds,
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

            // Assign default 'agent' role
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
            UPDATE auth.agent_sessions
            SET session__is_active = false
            WHERE general__session_id = ${sessionId}
        `;
    }

    async initiateGitHubAuth() {
        const githubAuthUrl =
            `https://github.com/login/oauth/authorize?` +
            `client_id=${this.config.providers[AuthProvider.GITHUB]?.clientId}&` +
            `redirect_uri=${encodeURIComponent(this.config.providers[AuthProvider.GITHUB]?.callbackUrl)}&` +
            `scope=user:email`;

        return githubAuthUrl;
    }

    async handleGitHubCallback(code: string) {
        return this.authenticateWithProvider(AuthProvider.GITHUB, code);
    }

    addRoutes(app: Hono) {
        const routes = app.basePath("/services/world-auth");

        // Registration endpoint
        routes.post("/register", async (c) => {
            try {
                const data = (await c.req.json()) as RegisterData;
                const session = await this.register(data);
                return c.json(session);
            } catch (error) {
                return c.json({ error: "Registration failed" }, 400);
            }
        });

        // Login endpoint
        routes.post("/login", async (c) => {
            try {
                const credentials = (await c.req.json()) as LoginCredentials;
                const session = await this.login(credentials);
                return c.json(session);
            } catch (error) {
                return c.json({ error: "Login failed" }, 401);
            }
        });

        // Logout endpoint
        routes.post("/logout", async (c) => {
            const sessionId = c.req.header("X-Session-ID");
            if (!sessionId) {
                return c.json({ error: "No session provided" }, 400);
            }

            await this.logout(sessionId);
            return c.json({ status: "logged out" });
        });

        // Session validation endpoint
        routes.get("/validate", async (c) => {
            const token = c.req.header("Authorization")?.replace("Bearer ", "");
            if (!token) {
                return c.json({ valid: false }, 401);
            }

            const agentId = await this.validateSession(token);
            return c.json({ valid: !!agentId, agentId });
        });

        // Get user profile
        routes.get("/profile", async (c) => {
            const token = c.req.header("Authorization")?.replace("Bearer ", "");
            if (!token) {
                return c.json({ error: "Unauthorized" }, 401);
            }

            const agentId = await this.validateSession(token);
            if (!agentId) {
                return c.json({ error: "Invalid session" }, 401);
            }

            const [profile] = await this.sql`
                SELECT 
                    general__uuid,
                    profile__username,
                    auth__email,
                    general__created_at,
                    (
                        SELECT json_agg(auth__role_name)
                        FROM agent_roles
                        WHERE auth__agent_id = agent_profiles.general__uuid
                        AND auth__is_active = true
                    ) as roles
                FROM agent_profiles
                WHERE general__uuid = ${agentId}
            `;

            return c.json(profile);
        });

        if (this.debugMode) {
            // Debug endpoints
            routes.get("/sessions", async (c) => {
                const sessions = await this.sql`
                    SELECT * FROM auth.agent_sessions
                    WHERE session__is_active = true
                    ORDER BY session__last_seen_at DESC
                `;
                return c.json(sessions);
            });
        }

        // GitHub OAuth routes
        routes.get("/auth/github", async (c) => {
            const authUrl = await this.initiateGitHubAuth();
            return c.redirect(authUrl);
        });

        routes.get("/auth/github/callback", async (c) => {
            const code = c.req.query("code");
            if (!code) {
                return c.json({ error: "No code provided" }, 400);
            }

            try {
                const session = await this.handleGitHubCallback(code);
                return c.json(session);
            } catch (error) {
                return c.json({ error: "Authentication failed" }, 401);
            }
        });
    }
}
