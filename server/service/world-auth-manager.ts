import { log } from "../../sdk/vircadia-world-sdk-ts/module/general/log";
import type postgres from "postgres";
import type { Hono } from "hono";
import { compare, hash } from "bcrypt";
import { sign, verify } from "jsonwebtoken";

interface AuthConfig {
    jwtSecret: string;
    sessionDuration: string; // e.g., '24h'
    bcryptRounds: number;
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

export class WorldAuthManager {
    private sql: postgres.Sql;
    private config: AuthConfig;

    constructor(
        sql: postgres.Sql,
        config: AuthConfig,
        private readonly debugMode: boolean = false,
    ) {
        this.sql = sql;
        this.config = config;
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
                UPDATE agent_sessions 
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
            INSERT INTO agent_sessions (
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
                SELECT * FROM agent_sessions
                WHERE general__session_id = ${decoded.sessionId}
                AND session__is_active = true
                AND session__last_seen_at > NOW() - INTERVAL '24 hours'
            `;

            if (!session) {
                return null;
            }

            // Update last seen
            await this.sql`
                UPDATE agent_sessions
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

        return this.createSession(agent.general__uuid);
    }

    async logout(sessionId: string) {
        await this.sql`
            UPDATE agent_sessions
            SET session__is_active = false
            WHERE general__session_id = ${sessionId}
        `;
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
                    SELECT * FROM agent_sessions
                    WHERE session__is_active = true
                    ORDER BY session__last_seen_at DESC
                `;
                return c.json(sessions);
            });
        }
    }
}
