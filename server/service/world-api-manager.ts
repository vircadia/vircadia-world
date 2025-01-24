import { log } from "../../sdk/vircadia-world-sdk-ts/module/general/log";
import type postgres from "postgres";
import { sign, verify } from "jsonwebtoken";
import type { VircadiaConfig_Server } from "../../sdk/vircadia-world-sdk-ts/config/vircadia.config.ts";
import { Communication } from "../../sdk/vircadia-world-sdk-ts/schema/schema.general";
import type { Server, ServerWebSocket } from "bun";

interface WorldSession<T = unknown> {
    ws: WebSocket | ServerWebSocket<T>;
    agentId: string;
    sessionId: string;
    lastHeartbeat: number;
}

interface SessionValidationResult {
    agentId: string;
    sessionId: string;
    isValid: boolean;
}

interface AuthConfig {
    jwt_session_duration: string;
    jwt_secret: string;
    admin_token_session_duration: string;
    ws_check_interval: number;
}

interface WebSocketData {
    token: string;
    agentId: string;
    sessionId: string;
}

class SessionValidator {
    constructor(
        private readonly sql: postgres.Sql,
        private readonly debugMode: boolean,
        private readonly authConfig: AuthConfig,
    ) {}

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
    constructor(
        private readonly sql: postgres.Sql,
        private readonly debugMode: boolean,
        private readonly sessionValidator: SessionValidator,
        private readonly authConfig: AuthConfig,
    ) {}

    async handleRequest(req: Request): Promise<Response> {
        const url = new URL(req.url);
        const path = url.pathname;

        // Handle authentication routes
        switch (true) {
            case path === Communication.RESTEndpoint.AUTH_SESSION_VALIDATE &&
                req.method === "GET":
                return await this.handleSessionValidate(req);

            case path === Communication.RESTEndpoint.AUTH_SESSION_LOGOUT &&
                req.method === "POST":
                return await this.handleLogout(req);

            default:
                return new Response("Not Found", { status: 404 });
        }
    }

    private async handleSessionValidate(req: Request): Promise<Response> {
        const token = req.headers.get("Authorization")?.replace("Bearer ", "");
        if (!token) {
            return Response.json(
                { success: false, error: "No token provided" },
                { status: 401 },
            );
        }

        const validation = await this.sessionValidator.validateSession(token);
        log({
            message: "Auth endpoint - Session validation result",
            debug: this.debugMode,
            type: "debug",
            data: {
                validation,
            },
        });
        return Response.json({
            success: true,
            data: {
                isValid: validation.isValid,
                agentId: validation.agentId,
            },
        });
    }

    private async handleLogout(req: Request): Promise<Response> {
        const token = req.headers.get("Authorization")?.replace("Bearer ", "");
        if (!token) {
            return Response.json(
                { success: false, error: "No token provided" },
                { status: 401 },
            );
        }

        const validation = await this.sessionValidator.validateSession(token);

        if (validation.isValid) {
            await this.sql`SELECT invalidate_session(${validation.sessionId});`;
        }

        log({
            message: "Auth endpoint - Session logout",
            debug: this.debugMode,
            type: "debug",
            data: {
                validation,
            },
        });

        return Response.json({ success: true });
    }
}

class WorldWebSocketManager {
    private activeSessions: Map<string, WorldSession<unknown>> = new Map();
    private heartbeatInterval: Timer | null = null;
    private tokenMap = new WeakMap<
        WebSocket | ServerWebSocket<unknown>,
        string
    >();
    private wsToSessionMap = new WeakMap<
        WebSocket | ServerWebSocket<unknown>,
        string
    >();
    private clientConfig:
        | {
              heartbeat: {
                  interval: number;
                  timeout: number;
              };
              session: {
                  max_session_age_ms: number;
                  cleanup_interval_ms: number;
                  inactive_timeout_ms: number;
              };
          }
        | undefined;

    constructor(
        private readonly sql: postgres.Sql,
        private readonly debugMode: boolean,
        private readonly sessionValidator: SessionValidator,
        private readonly authConfig: AuthConfig,
    ) {}

    async initialize() {
        // Load client configuration
        const [heartbeatInterval] = await this.sql`
            SELECT value FROM config.config WHERE key = 'client__heartbeat_interval_ms'
        `;
        const [heartbeatTimeout] = await this.sql`
            SELECT value FROM config.config WHERE key = 'client__heartbeat_timeout_ms'
        `;
        const [sessionConfig] = await this.sql`
            SELECT value FROM config.config WHERE key = 'client__session'
        `;

        this.clientConfig = {
            heartbeat: {
                interval: heartbeatInterval.value,
                timeout: heartbeatTimeout.value,
            },
            session: sessionConfig.value,
        };

        this.heartbeatInterval = setInterval(
            () => this.checkHeartbeats(),
            this.authConfig.ws_check_interval,
        );
    }

    async handleUpgrade(
        req: Request,
        server: Server,
    ): Promise<Response | undefined> {
        const protocols = req.headers.get("Sec-WebSocket-Protocol")?.split(",");
        log({
            message: `Received protocols: ${protocols?.join(", ")}`,
            debug: this.debugMode,
            type: "debug",
        });

        const bearerProtocol = protocols?.find((p) =>
            p.trim().startsWith("bearer."),
        );

        if (!bearerProtocol) {
            log({
                message: "No bearer protocol found in request",
                debug: this.debugMode,
                type: "debug",
            });
            return new Response("Authentication required", { status: 401 });
        }

        const token = bearerProtocol.trim().substring(7);
        log({
            message: "Attempting to validate token",
            debug: this.debugMode,
            type: "debug",
        });

        const validation = await this.sessionValidator.validateSession(token);

        if (!validation.isValid) {
            log({
                message: "Token validation failed",
                debug: this.debugMode,
                type: "debug",
            });
            return new Response("Invalid token", { status: 401 });
        }

        log({
            message: "Token validated successfully, attempting upgrade",
            debug: this.debugMode,
            type: "debug",
        });

        const upgraded = server.upgrade(req, {
            data: {
                token,
                agentId: validation.agentId,
                sessionId: validation.sessionId,
            },
            headers: {
                "Sec-WebSocket-Protocol": bearerProtocol.trim(),
            },
        });

        if (!upgraded) {
            log({
                message: "WebSocket upgrade failed",
                debug: this.debugMode,
                type: "error",
                data: {
                    agentId: validation.agentId,
                    sessionId: validation.sessionId,
                    headers: req.headers.toJSON(),
                },
            });
            return new Response("WebSocket upgrade failed", { status: 500 });
        }

        log({
            message: "WebSocket upgrade successful",
            debug: this.debugMode,
            type: "debug",
            data: {
                agentId: validation.agentId,
                sessionId: validation.sessionId,
            },
        });

        return undefined;
    }

    handleConnection(
        ws: WebSocket | ServerWebSocket<WebSocketData>,
        sessionData: { agentId: string; sessionId: string },
    ) {
        log({
            message: "New WebSocket connection attempt",
            debug: this.debugMode,
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
            lastHeartbeat: Date.now(),
        };

        this.activeSessions.set(sessionData.sessionId, session);
        this.wsToSessionMap.set(ws, sessionData.sessionId);

        try {
            const connectionMsg = Communication.createMessage({
                type: Communication.MessageType.CONNECTION_ESTABLISHED,
                agentId: sessionData.agentId,
            });
            ws.send(JSON.stringify(connectionMsg));
            log({
                message: `Connection established with agent ${sessionData.agentId}`,
                debug: this.debugMode,
                type: "debug",
            });
        } catch (error) {
            log({
                message: `Failed to send connection message: ${error}`,
                debug: this.debugMode,
                type: "error",
            });
        }
    }

    async handleMessage(
        ws: WebSocket | ServerWebSocket<unknown>,
        message: string | ArrayBuffer,
    ) {
        try {
            const data = JSON.parse(
                typeof message === "string" ? message : message.toString(),
            ) as Communication.Message;

            const sessionId = this.wsToSessionMap.get(ws);
            if (!sessionId) {
                const errorMsg = Communication.createMessage({
                    type: Communication.MessageType.ERROR,
                    message: "Session not found",
                });
                ws.send(JSON.stringify(errorMsg));
                return;
            }

            const session = this.activeSessions.get(sessionId);
            if (!session) {
                const errorMsg = Communication.createMessage({
                    type: Communication.MessageType.ERROR,
                    message: "Session not found",
                });
                ws.send(JSON.stringify(errorMsg));
                return;
            }

            session.lastHeartbeat = Date.now();

            switch (data.type) {
                case Communication.MessageType.HEARTBEAT: {
                    const heartbeatAck = Communication.createMessage({
                        type: Communication.MessageType.HEARTBEAT_ACK,
                    });
                    ws.send(JSON.stringify(heartbeatAck));
                    break;
                }
                case Communication.MessageType.CONFIG_REQUEST: {
                    if (!this.clientConfig) {
                        throw new Error("Client config not initialized");
                    }
                    const configMsg = Communication.createMessage({
                        type: Communication.MessageType.CONFIG_RESPONSE,
                        config: this.clientConfig,
                    });
                    ws.send(JSON.stringify(configMsg));
                    break;
                }
                default: {
                    const errorMsg = Communication.createMessage({
                        type: Communication.MessageType.ERROR,
                        message: "Unknown message type",
                    });
                    ws.send(JSON.stringify(errorMsg));
                }
            }
        } catch (error) {
            const errorMsg = Communication.createMessage({
                type: Communication.MessageType.ERROR,
                message: "Invalid message format",
            });
            ws.send(JSON.stringify(errorMsg));
        }
    }

    handleDisconnect(sessionId: string) {
        const session = this.activeSessions.get(sessionId);
        if (session) {
            log({
                message: "WebSocket disconnection",
                debug: this.debugMode,
                type: "debug",
                data: {
                    sessionId,
                    agentId: session.agentId,
                    lastHeartbeat: new Date(
                        session.lastHeartbeat,
                    ).toISOString(),
                    timeSinceLastHeartbeat: Date.now() - session.lastHeartbeat,
                },
            });

            // Clean up both maps
            this.wsToSessionMap.delete(session.ws);
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
                    const token = this.tokenMap.get(session.ws);
                    if (
                        !token ||
                        !(await this.sessionValidator.validateSession(token))
                            .isValid
                    ) {
                        log({
                            message:
                                "Session expired / invalid, closing WebSocket",
                            debug: this.debugMode,
                            type: "debug",
                            data: {
                                sessionId,
                                agentId: session.agentId,
                                lastHeartbeat: new Date(
                                    session.lastHeartbeat,
                                ).toISOString(),
                                timeSinceLastHeartbeat:
                                    Date.now() - session.lastHeartbeat,
                            },
                        });
                        session.ws.close(1000, "Session expired");
                        this.handleDisconnect(sessionId);
                    }
                }
            }),
        );
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
    private authConfig: AuthConfig | undefined;
    private oauthManager: WorldOAuthManager | undefined;
    public wsManager: WorldWebSocketManager | undefined;
    private sessionValidator: SessionValidator | undefined;
    private server: Server | undefined;

    constructor(
        private sql: postgres.Sql,
        private readonly debugMode: boolean,
        private readonly config: typeof VircadiaConfig_Server,
    ) {}

    async initialize() {
        log({
            message: "Initializing world api manager",
            debug: this.debugMode,
            type: "debug",
        });

        // Load auth config
        const [config] = await this.sql`
            SELECT value FROM config.config WHERE key = 'auth_settings'
        `;
        this.authConfig = config.value as AuthConfig;

        // Initialize components
        this.sessionValidator = new SessionValidator(
            this.sql,
            this.debugMode,
            this.authConfig,
        );

        this.oauthManager = new WorldOAuthManager(
            this.sql,
            this.debugMode,
            this.sessionValidator,
            this.authConfig,
        );

        this.wsManager = new WorldWebSocketManager(
            this.sql,
            this.debugMode,
            this.sessionValidator,
            this.authConfig,
        );

        await this.wsManager.initialize();

        // Start server
        this.server = Bun.serve({
            port: this.config.serverPort,
            hostname: this.config.serverHost,
            development: this.debugMode,

            fetch: async (req: Request, server: Server) => {
                const url = new URL(req.url);

                // Handle WebSocket upgrade
                if (url.pathname.startsWith(Communication.WS_BASE_URL)) {
                    return await this.wsManager?.handleUpgrade(req, server);
                }

                // Handle HTTP routes
                if (url.pathname.startsWith(Communication.REST_BASE_URL)) {
                    return await this.oauthManager?.handleRequest(req);
                }

                return new Response("Not Found", { status: 404 });
            },

            websocket: {
                message: (
                    ws: ServerWebSocket<WebSocketData>,
                    message: string,
                ) => {
                    log({
                        message: "WebSocket message received",
                        debug: this.debugMode,
                        type: "debug",
                    });
                    this.wsManager?.handleMessage(ws, message);
                },
                open: (ws: ServerWebSocket<WebSocketData>) => {
                    log({
                        message: "WebSocket connection opened",
                        debug: this.debugMode,
                        type: "debug",
                    });
                    this.wsManager?.handleConnection(ws, {
                        agentId: ws.data.agentId,
                        sessionId: ws.data.sessionId,
                    });
                },
                close: (
                    ws: ServerWebSocket<WebSocketData>,
                    code: number,
                    reason: string,
                ) => {
                    log({
                        message: `WebSocket connection closed, code: ${code}, reason: ${reason}`,
                        debug: this.debugMode,
                        type: "debug",
                    });
                    this.wsManager?.handleDisconnect(ws.data.sessionId);
                },
            },
        });

        log({
            message: `Bun HTTP+WS World API Server running at http://${this.config.serverHost}:${this.config.serverPort}`,
            type: "success",
        });
    }

    cleanup() {
        this.wsManager?.cleanup();
        this.server?.stop();
    }
}
