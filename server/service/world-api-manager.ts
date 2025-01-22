import { log } from "../../sdk/vircadia-world-sdk-ts/module/general/log";
import type postgres from "postgres";
import type { Hono } from "hono";
import { sign, verify } from "jsonwebtoken";
import type { MiddlewareHandler } from "hono";
import { VircadiaConfig_Server } from "../../sdk/vircadia-world-sdk-ts/config/vircadia.config.ts";
import { createBunWebSocket } from "hono/bun";
import type { ServerWebSocket } from "bun";

interface WorldSession {
    ws: WebSocket;
    agentId: string;
    sessionId: string;
    lastHeartbeat: number;
}

interface SessionValidationResult {
    agentId: string;
    sessionId: string;
    isValid: boolean;
}

class SessionValidator {
    private authConfig: any;

    constructor(
        private readonly sql: postgres.Sql,
        private readonly debugMode: boolean,
    ) {}

    async initialize() {
        const [config] = await this.sql`
            SELECT value FROM config.config WHERE key = 'auth_settings'
        `;
        this.authConfig = config.value;
    }

    async validateSession(token: string): Promise<SessionValidationResult> {
        try {
            const decoded = verify(token, this.authConfig.jwt_secret) as {
                sessionId: string;
                agentId: string;
            };

            const [validation] = await this.sql`
                SELECT * FROM validate_session(${decoded.sessionId}::UUID)
            `;

            return {
                agentId: validation.auth__agent_id || "",
                sessionId: decoded.sessionId,
                isValid: validation.is_valid,
            };
        } catch (error) {
            log({
                message: `Session validation failed: ${error}`,
                debug: this.debugMode,
                type: "debug",
            });
            return {
                agentId: "",
                sessionId: "",
                isValid: false,
            };
        }
    }
}

class WorldOAuthManager {
    private authConfig: any;
    private authRoutes: Hono;

    constructor(
        private readonly sql: postgres.Sql,
        private readonly app: Hono,
        private readonly debugMode: boolean,
        private readonly sessionValidator: SessionValidator,
    ) {
        // Create a single router instance for auth routes
        this.authRoutes = this.app.basePath("/services/world-auth");

        // Apply session middleware to protected routes
        this.authRoutes.use("/session/*", this.sessionMiddleware());
    }

    async initialize() {
        const [config] = await this.sql`
            SELECT value FROM config.config WHERE key = 'auth_settings'
        `;
        this.authConfig = config.value;

        // Use the existing authRoutes instance
        this.authRoutes.post("/system/session", async (c) => {
            try {
                const [systemAgentId] = await this
                    .sql`SELECT get_system_agent_id()`;
                const token = sign(
                    { agentId: systemAgentId.get_system_agent_id },
                    this.authConfig.jwt_secret,
                );

                const [session] = await this.sql`
                    SELECT * FROM create_agent_session(
                        ${systemAgentId.get_system_agent_id}, 
                        'system',
                        ${token}
                    );
                `;

                return c.json({
                    success: true,
                    data: {
                        sessionId: session.general__session_id,
                        token: session.session__jwt,
                        expiresAt: session.session__expires_at,
                    },
                });
            } catch (error) {
                return c.json(
                    {
                        success: false,
                        error: "Failed to create system session",
                    },
                    500,
                );
            }
        });

        // Session validation route
        this.authRoutes.get("/session/validate", async (c) => {
            const token = c.req.header("Authorization")?.replace("Bearer ", "");
            if (!token) {
                return c.json(
                    {
                        success: false,
                        error: "No token provided",
                    },
                    401,
                );
            }

            const validation =
                await this.sessionValidator.validateSession(token);
            return c.json({
                success: true,
                data: {
                    isValid: validation.isValid,
                    agentId: validation.agentId,
                },
            });
        });

        // Logout route
        this.authRoutes.post("/session/logout", async (c) => {
            const token = c.req.header("Authorization")?.replace("Bearer ", "");
            if (!token) {
                return c.json(
                    {
                        success: false,
                        error: "No token provided",
                    },
                    401,
                );
            }

            const validation =
                await this.sessionValidator.validateSession(token);
            if (validation.isValid) {
                await this.sql`
                    SELECT invalidate_session(${validation.sessionId});
                `;
            }

            return c.json({
                success: true,
            });
        });

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

    sessionMiddleware(): MiddlewareHandler {
        return async (c, next) => {
            const token = c.req.header("Authorization")?.replace("Bearer ", "");

            if (token) {
                const validation =
                    await this.sessionValidator.validateSession(token);
                if (validation.isValid) {
                    await this
                        .sql`SELECT set_session_context(${validation.sessionId}::UUID)`;
                    c.set("session", {
                        agentId: validation.agentId,
                        isAuthenticated: true,
                    });
                }
            }

            if (!c.get("session")) {
                await this.sql`SELECT set_session_context(NULL)`;
                c.set("session", {
                    agentId: "00000000-0000-0000-0000-000000000001",
                    isAuthenticated: false,
                });
            }

            await next();
        };
    }
}

class WorldWebSocketManager {
    private activeSessions: Map<string, WorldSession> = new Map();
    private heartbeatInterval: Timer | null = null;
    private tokenMap = new WeakMap<WebSocket | ServerWebSocket, string>();
    private authConfig: any;

    constructor(
        private readonly sql: postgres.Sql,
        private readonly app: Hono,
        private readonly debugMode: boolean,
        private readonly sessionValidator: SessionValidator,
    ) {}

    async initialize() {
        const [config] = await this.sql`
            SELECT value FROM config.config WHERE key = 'auth_settings'
        `;
        this.authConfig = config.value;

        const routes = this.app.basePath("/services/world");
        const { upgradeWebSocket, websocket } =
            createBunWebSocket<ServerWebSocket>();

        routes.get(
            "/ws",
            upgradeWebSocket(async (c) => {
                const token = c.req
                    .header("Authorization")
                    ?.replace("Bearer ", "");
                if (!token) {
                    throw new Error("Authentication required");
                }

                const validation =
                    await this.sessionValidator.validateSession(token);
                if (!validation.isValid) {
                    throw new Error("Invalid token");
                }

                this.tokenMap.set(c.req.socket, token);
                return {
                    message: async (ws, message) => {
                        await this.handleMessage(ws, message);
                    },
                    onOpen: (_event, ws) => {
                        this.handleConnection(ws, {
                            agentId: validation.agentId,
                            sessionId: validation.sessionId,
                        });
                    },
                    onClose: () => {
                        this.handleDisconnect(validation.sessionId);
                    },
                };
            }),
        );

        // Initialize heartbeat checker
        this.heartbeatInterval = setInterval(
            () => this.checkHeartbeats(),
            this.authConfig.ws_check_interval,
        );
    }

    handleConnection(
        ws: WebSocket,
        sessionData: { agentId: string; sessionId: string },
    ) {
        const session: WorldSession = {
            ws,
            agentId: sessionData.agentId,
            sessionId: sessionData.sessionId,
            lastHeartbeat: Date.now(),
        };

        this.activeSessions.set(sessionData.sessionId, session);

        ws.on("message", async (message: string) => {
            try {
                const data = JSON.parse(message);
                await this.handleMessage(ws, data);
            } catch (error) {
                ws.send(
                    JSON.stringify({
                        type: "error",
                        message: "Invalid message format",
                    }),
                );
            }
        });

        ws.on("close", () => {
            this.handleDisconnect(sessionData.sessionId);
        });

        // Send initial connection success
        ws.send(
            JSON.stringify({
                type: "connection_established",
                agentId: sessionData.agentId,
            }),
        );
    }

    async handleMessage(ws: WebSocket | ServerWebSocket, message: any) {
        try {
            const data = JSON.parse(
                typeof message === "string" ? message : message.toString(),
            );
            const sessionId = this.getSessionIdFromWebSocket(ws);
            if (!sessionId) {
                ws.send(
                    JSON.stringify({
                        type: "error",
                        message: "Session not found",
                    }),
                );
                return;
            }

            const session = this.activeSessions.get(sessionId);
            if (!session) {
                ws.send(
                    JSON.stringify({
                        type: "error",
                        message: "Session not found",
                    }),
                );
                return;
            }

            session.lastHeartbeat = Date.now();

            switch (data.type) {
                case "heartbeat":
                    ws.send(JSON.stringify({ type: "heartbeat_ack" }));
                    break;
                // Add other message type handlers here
                default:
                    ws.send(
                        JSON.stringify({
                            type: "error",
                            message: "Unknown message type",
                        }),
                    );
            }
        } catch (error) {
            ws.send(
                JSON.stringify({
                    type: "error",
                    message: "Invalid message format",
                }),
            );
        }
    }

    private getSessionIdFromWebSocket(
        ws: WebSocket | ServerWebSocket,
    ): string | null {
        for (const [sessionId, session] of this.activeSessions.entries()) {
            if (session.ws === ws) {
                return sessionId;
            }
        }
        return null;
    }

    handleDisconnect(sessionId: string) {
        const session = this.activeSessions.get(sessionId);
        if (session) {
            // Cleanup logic here
            this.activeSessions.delete(sessionId);
        }
    }

    private async checkHeartbeats() {
        const now = Date.now();
        const sessionsToCheck = Array.from(this.activeSessions.entries());

        // Process sessions in parallel
        await Promise.all(
            sessionsToCheck.map(async ([sessionId, session]) => {
                // Check both heartbeat timeout and session validity
                if (
                    now - session.lastHeartbeat >
                    this.authConfig.ws_check_interval
                ) {
                    const token = this.getTokenFromWebSocket(session.ws);
                    if (
                        !token ||
                        !(await this.sessionValidator.validateSession(token))
                            .isValid
                    ) {
                        session.ws.close(1000, "Session expired");
                        this.handleDisconnect(sessionId);
                    }
                }
            }),
        );
    }

    private getTokenFromWebSocket(
        ws: WebSocket | ServerWebSocket,
    ): string | undefined {
        return this.tokenMap.get(ws);
    }

    cleanup() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }
        for (const session of this.activeSessions.values()) {
            session.ws.close(1000, "Server shutting down");
        }
        this.activeSessions.clear();
    }
}

export class WorldApiManager {
    private oauthManager: WorldOAuthManager;
    private wsManager: WorldWebSocketManager;
    private sessionValidator: SessionValidator;

    constructor(
        private sql: postgres.Sql,
        private readonly hono: Hono,
        private readonly debugMode: boolean,
    ) {
        this.sessionValidator = new SessionValidator(sql, debugMode);
        this.oauthManager = new WorldOAuthManager(
            sql,
            hono,
            debugMode,
            this.sessionValidator,
        );
        this.wsManager = new WorldWebSocketManager(
            sql,
            hono,
            debugMode,
            this.sessionValidator,
        );
    }

    async initialize() {
        log({
            message: "Initializing world api manager",
            debug: this.debugMode,
            type: "debug",
        });

        // Initialize session validator first
        await this.sessionValidator.initialize();

        // Then initialize managers that depend on it
        await this.oauthManager.initialize();
        await this.wsManager.initialize();
    }

    cleanup() {
        this.wsManager.cleanup();
    }
}
