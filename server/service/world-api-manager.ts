// =============================================================================
// ============================== IMPORTS, TYPES, AND INTERFACES ==============================
// =============================================================================

import { log } from "../../sdk/vircadia-world-sdk-ts/module/general/log";
import type postgres from "postgres";
import { sign, verify } from "jsonwebtoken";
import type { VircadiaConfig_Server } from "../../sdk/vircadia-world-sdk-ts/config/vircadia.config.ts";
import {
    Communication,
    type Tick,
} from "../../sdk/vircadia-world-sdk-ts/schema/schema.general";
import type { Server, ServerWebSocket } from "bun";
import {
    Config,
    type Entity,
} from "../../sdk/vircadia-world-sdk-ts/schema/schema.general";

interface WorldSession<T = unknown> {
    ws: WebSocket | ServerWebSocket<T>;
    agentId: string;
    sessionId: string;
    lastHeartbeat: number;
}

interface WebSocketData {
    token: string;
    agentId: string;
    sessionId: string;
}

// =============================================================================
// ============================== SESSION VALIDATION FUNCTION ==============================
// =============================================================================

// #region SessionValidation

async function validateJWTAndSession(
    sql: postgres.Sql,
    debugMode: boolean,
    authConfig: Config.I_ClientSettings["auth"],
    token: string,
): Promise<{ agentId: string; sessionId: string; isValid: boolean }> {
    try {
        // Check for empty or malformed token first
        if (!token || token.split(".").length !== 3) {
            return {
                agentId: "",
                sessionId: "",
                isValid: false,
            };
        }

        const decoded = verify(token, authConfig.secret_jwt) as {
            sessionId: string;
            agentId: string;
        };

        const [validation] = await sql`
            SELECT * FROM auth.validate_session(${decoded.sessionId}::UUID)
        `;

        log({
            message: "Session validation result",
            debug: debugMode,
            type: "debug",
            data: {
                validation,
            },
        });

        return {
            agentId: validation.auth__agent_id || "",
            sessionId: decoded.sessionId,
            isValid: validation.is_valid && !!validation.auth__agent_id,
        };
    } catch (error) {
        log({
            message: `Session validation failed: ${error}`,
            debug: debugMode,
            type: "debug",
            data: {
                error: error instanceof Error ? error.message : String(error),
            },
        });
        return {
            agentId: "",
            sessionId: "",
            isValid: false,
        };
    }
}

// #endregion

// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------

// =============================================================================
// ======================= WORLD REST MANAGER: REST API Session Management =======================
// =============================================================================

// #region WorldRestManager

class WorldRestManager {
    constructor(
        private readonly sql: postgres.Sql,
        private readonly debugMode: boolean,
        private readonly authConfig: Config.I_ClientSettings["auth"],
    ) {}

    async handleRequest(req: Request): Promise<Response> {
        const url = new URL(req.url);
        const path = url.pathname;

        // Handle authentication routes
        switch (true) {
            case path ===
                Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.path &&
                req.method === "GET":
                return await this.handleSessionValidate(req);

            case path ===
                Communication.REST.Endpoint.AUTH_SESSION_LOGOUT.path &&
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
                Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.createError(
                    "No token provided",
                ),
                { status: 401 },
            );
        }

        const validation = await validateJWTAndSession(
            this.sql,
            this.debugMode,
            this.authConfig,
            token,
        );

        // Set the current agent ID for RLS
        if (validation.isValid) {
            await this
                .sql`SELECT set_config('app.current_agent_id', ${validation.agentId}::text, true)`;
        }

        log({
            message: "Auth endpoint - Session validation result",
            debug: this.debugMode,
            type: "debug",
            data: {
                validation,
            },
        });

        if (!validation.isValid) {
            return Response.json(
                Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.createError(
                    "Invalid token",
                ),
            );
        }

        return Response.json(
            Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.createSuccess(
                validation.isValid,
                validation.agentId,
                validation.sessionId,
            ),
        );
    }

    private async handleLogout(req: Request): Promise<Response> {
        // TODO: On OAUTH, we must also invalidate the token on the OAUTH server as well as wiping it from our own session list.
        const token = req.headers.get("Authorization")?.replace("Bearer ", "");
        if (!token) {
            return Response.json(
                Communication.REST.Endpoint.AUTH_SESSION_LOGOUT.createError(
                    "No token provided",
                ),
                { status: 401 },
            );
        }

        const validation = await validateJWTAndSession(
            this.sql,
            this.debugMode,
            this.authConfig,
            token,
        );

        // Set the current agent ID for RLS
        if (validation.isValid) {
            await this
                .sql`SELECT set_config('app.current_agent_id', ${validation.agentId}::text, true)`;
        }

        try {
            // Even if the token is invalid, we should return success since the session is effectively "logged out"
            if (!validation.isValid) {
                return Response.json(
                    Communication.REST.Endpoint.AUTH_SESSION_LOGOUT.createSuccess(),
                );
            }

            // Call invalidate_session and check its boolean return value
            const [result] = await this.sql<[{ invalidate_session: boolean }]>`
                SELECT auth.invalidate_session(${validation.sessionId}::UUID) as invalidate_session;
            `;

            if (!result.invalidate_session) {
                throw new Error("Failed to invalidate session");
            }

            log({
                message: "Auth endpoint - Successfully logged out",
                debug: this.debugMode,
                type: "debug",
                data: {
                    validation,
                },
            });

            return Response.json(
                Communication.REST.Endpoint.AUTH_SESSION_LOGOUT.createSuccess(),
            );
        } catch (error) {
            log({
                message: "Failed to invalidate session",
                debug: this.debugMode,
                type: "error",
                data: {
                    error:
                        error instanceof Error ? error.message : String(error),
                },
            });

            return Response.json(
                Communication.REST.Endpoint.AUTH_SESSION_LOGOUT.createSuccess(),
            );
        }
    }

    async stop() {
        // Nothing to do for now...
    }
}

// #endregion

// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------

// =============================================================================
// ======================= TICK MANAGER: Tick Loops and Cleanup Timers =======================
// =============================================================================

// #region WorldTickManager

class WorldTickManager {
    private intervalIds: Map<string, Timer> = new Map();
    private entityStatesCleanupId: Timer | null = null;
    private tickMetricsCleanupId: Timer | null = null;
    private syncGroups: Map<string, Entity.SyncGroup.I_SyncGroup> = new Map();
    private tickCounts: Map<string, number> = new Map();
    private tickBufferDurationMs = 2000;
    private tickMetricsHistoryMs = 3600000;

    private readonly LOG_PREFIX = "WorldTickManager";

    constructor(
        private readonly sql: postgres.Sql,
        private readonly debugMode: boolean,
        private readonly wsManager: WorldWebSocketManager,
    ) {}

    async initialize() {
        try {
            const syncGroupsData = await this.sql<
                Entity.SyncGroup.I_SyncGroup[]
            >`
                SELECT 
                    sync_group,
                    server__tick__rate_ms as server_tick_rate_ms,
                    server__tick__buffer as server_tick_buffer,
                    client__render_delay_ms as client_render_delay_ms,
                    client__max_prediction_time_ms as client_max_prediction_time_ms,
                    network__packet_timing_variance_ms as network_packet_timing_variance_ms,
                    server__keyframe__interval_ticks as keyframe_interval_ticks
                FROM entity.entity_sync_groups
            `;

            // Store the sync groups directly since they already match our interface
            for (const group of syncGroupsData) {
                this.syncGroups.set(group.sync_group, group);
            }

            // Load other config values
            const [bufferConfig] = await this.sql`
                SELECT value FROM config.config WHERE key = 'tick_buffer_duration_ms'
            `;
            const [metricsConfig] = await this.sql`
                SELECT value FROM config.config WHERE key = 'tick_metrics_history_ms'
            `;

            if (bufferConfig) {
                this.tickBufferDurationMs = bufferConfig.value;
            }
            if (metricsConfig) {
                this.tickMetricsHistoryMs = metricsConfig.value;
            }

            this.setupCleanupTimers();
        } catch (error) {
            log({
                message: `Failed to initialize tick manager: ${error}`,
                debug: this.debugMode,
                type: "error",
            });
            throw error;
        }
    }

    private setupCleanupTimers() {
        if (this.entityStatesCleanupId)
            clearInterval(this.entityStatesCleanupId);
        if (this.tickMetricsCleanupId) clearInterval(this.tickMetricsCleanupId);

        this.entityStatesCleanupId = setInterval(async () => {
            try {
                await this.sql`SELECT tick.cleanup_old_entity_states()`;
                log({
                    prefix: this.LOG_PREFIX,
                    message: "Entity states cleanup completed",
                    debug: this.debugMode,
                    type: "debug",
                });
            } catch (error) {
                log({
                    prefix: this.LOG_PREFIX,
                    message: `Error during entity states cleanup: ${error}`,
                    debug: this.debugMode,
                    type: "error",
                });
            }
        }, this.tickBufferDurationMs);

        this.tickMetricsCleanupId = setInterval(async () => {
            try {
                await this.sql`SELECT tick.cleanup_old_tick_metrics()`;
                log({
                    prefix: this.LOG_PREFIX,
                    message: "Tick metrics cleanup completed",
                    debug: this.debugMode,
                    type: "debug",
                });
            } catch (error) {
                log({
                    prefix: this.LOG_PREFIX,
                    message: `Error during tick metrics cleanup: ${error}`,
                    debug: this.debugMode,
                    type: "error",
                });
            }
        }, this.tickMetricsHistoryMs);
    }

    /**
     * Capture a tick state using the new tick.capture_tick_state function.
     * The function now returns a JSONB object with the following structure:
     * {
     *   tick_data: I_TickMetadata,
     *   entity_updates: I_EntityUpdate[],
     *   script_updates: I_ScriptUpdate[]
     * }
     */
    private async captureTick(
        syncGroup: string,
    ): Promise<Tick.I_TickState | null> {
        try {
            // Using the new tick.capture_tick_state from the migration which returns the complete tick state as JSONB.
            const result = await this.sql<{ tick_state: Tick.I_TickState }[]>`
                SELECT tick.capture_tick_state(${syncGroup}) AS tick_state;
            `;
            if (!result.length || !result[0].tick_state) {
                return null;
            }
            // Update tick count for internal metrics or debugging
            const currentCount = this.tickCounts.get(syncGroup) || 0;
            this.tickCounts.set(syncGroup, currentCount + 1);

            return result[0].tick_state;
        } catch (error) {
            log({
                message: `Error capturing tick for ${syncGroup}: ${error}`,
                debug: this.debugMode,
                type: "error",
            });
            return null;
        }
    }

    /**
     * Start tick loops for each sync group.
     * Updated so that it evaluates the new tick state structure:
     * - tick_state.tick_data holds the tick metadata
     * - tick_state.entity_updates and tick_state.script_updates are arrays of updates.
     * The relevant updates are forwarded to the WebSocket manager.
     */
    async start() {
        for (const [syncGroup, config] of this.syncGroups.entries()) {
            if (this.intervalIds.has(syncGroup)) {
                continue;
            }

            let nextTickTime = performance.now();

            const tickLoop = () => {
                // Schedule next tick immediately at fixed interval
                nextTickTime += config.server_tick_rate_ms;
                this.intervalIds.set(
                    syncGroup,
                    setTimeout(tickLoop, nextTickTime - performance.now()),
                );

                // Process tick asynchronously without blocking the loop
                this.processTick(syncGroup).catch((error) => {
                    log({
                        message: `Error in tick processing for ${syncGroup}: ${error}`,
                        debug: this.debugMode,
                        type: "error",
                    });
                });
            };

            // Start the loop
            tickLoop();
        }
    }

    private async processTick(syncGroup: string) {
        const startTime = performance.now();

        try {
            const syncGroupConfig = this.syncGroups.get(syncGroup);

            if (!syncGroupConfig) {
                throw new Error(`Sync group ${syncGroup} not found`);
            }

            const tickState = await this.captureTick(syncGroup);

            if (tickState) {
                // Get current tick count for this sync group
                const currentTickCount = this.tickCounts.get(syncGroup) || 0;

                // Check if keyframe is needed based on interval
                const needsKeyframe =
                    syncGroupConfig.keyframe_interval_ticks > 0 &&
                    currentTickCount %
                        syncGroupConfig.keyframe_interval_ticks ===
                        0;

                // Get all active WebSocket connections as an array
                const activeWebSockets = Array.from(
                    this.wsManager.activeSessions.values(),
                ).map(
                    (session) => session.ws as ServerWebSocket<WebSocketData>,
                );

                if (needsKeyframe) {
                    // Send keyframes to all active connections
                    await Promise.all([
                        this.wsManager.sendEntitiesKeyframeNotification(
                            activeWebSockets,
                            syncGroup,
                        ),
                        this.wsManager.sendEntityScriptsKeyframeNotification(
                            activeWebSockets,
                            syncGroup,
                        ),
                    ]);

                    log({
                        message: "Sent scheduled keyframe",
                        debug: this.debugMode,
                        type: "debug",
                        data: {
                            syncGroup,
                            tickCount: currentTickCount,
                            activeConnections: activeWebSockets.length,
                        },
                    });
                }

                // Handle regular entity updates
                if (
                    Array.isArray(tickState.entity_updates) &&
                    tickState.entity_updates.length > 0
                ) {
                    await this.wsManager.sendEntitiesUpdatesNotification(
                        activeWebSockets,
                        tickState.entity_updates,
                        tickState.tick_data,
                    );
                }

                // Handle script updates
                if (
                    Array.isArray(tickState.script_updates) &&
                    tickState.script_updates.length > 0
                ) {
                    await this.wsManager.sendEntityScriptsUpdatesNotification(
                        activeWebSockets,
                        tickState.script_updates,
                        tickState.tick_data,
                    );
                }
            }

            const processingTime = performance.now() - startTime;
            if (processingTime > syncGroupConfig.server_tick_rate_ms) {
                log({
                    message: "Tick processing took longer than tick rate",
                    debug: this.debugMode,
                    type: "warning",
                    data: {
                        syncGroup,
                        processingTime,
                        tickRate: syncGroupConfig.server_tick_rate_ms,
                    },
                });
            }
        } catch (error) {
            log({
                message: `Error in tick processing for ${syncGroup}: ${error}`,
                debug: this.debugMode,
                type: "error",
            });
            throw error;
        }
    }

    stop() {
        for (const [syncGroup, intervalId] of this.intervalIds.entries()) {
            clearTimeout(intervalId);
            this.intervalIds.delete(syncGroup);
        }

        if (this.entityStatesCleanupId) {
            clearInterval(this.entityStatesCleanupId);
            this.entityStatesCleanupId = null;
        }
        if (this.tickMetricsCleanupId) {
            clearInterval(this.tickMetricsCleanupId);
            this.tickMetricsCleanupId = null;
        }
    }
}

// #endregion

// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------

// =============================================================================
// =========== WORLD WEBSOCKET MANAGER: WebSocket Connections and Messaging ===========
// =============================================================================

// #region WorldWebSocketManager

class WorldWebSocketManager {
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
    private clientConfig: Config.I_ClientSettings | undefined;

    private readonly LOG_PREFIX = "WorldWebSocketManager";

    constructor(
        private readonly sql: postgres.Sql,
        private readonly debugMode: boolean,
        private readonly authConfig: Config.I_ClientSettings["auth"],
    ) {}

    private async setAgentContext(
        sql: postgres.Sql,
        sessionId: string,
        sessionToken: string,
    ): Promise<void> {
        const [contextResult] = await sql<[{ set_agent_context: boolean }]>`
            SELECT auth.set_agent_context(${sessionId}::UUID, ${sessionToken}::TEXT) as set_agent_context
        `;

        if (!contextResult.set_agent_context) {
            throw new Error("Failed to set agent context");
        }
    }

    private async handleQuery(
        ws: ServerWebSocket<WebSocketData>,
        message: Communication.WebSocket.QueryRequestMessage,
    ) {
        const sessionId = this.wsToSessionMap.get(ws);
        const sessionToken = this.tokenMap.get(ws);
        const session = sessionId
            ? this.activeSessions.get(sessionId)
            : undefined;

        if (!session || !sessionToken || !sessionId) {
            return;
        }

        try {
            log({
                prefix: this.LOG_PREFIX,
                message: "Processing query request",
                type: "debug",
                data: {
                    sessionId,
                    message,
                },
            });

            // Execute query in a transaction with the correct agent context
            const results = await this.sql.begin(async (sql) => {
                await this.setAgentContext(sql, sessionId, sessionToken);
                return await sql.unsafe(
                    message.query,
                    message.parameters || [],
                );
            });

            log({
                prefix: this.LOG_PREFIX,
                message: "Query execution completed",
                type: "debug",
                data: { results },
            });

            const responseMsg =
                Communication.WebSocket.createMessage<Communication.WebSocket.QueryResponseMessage>(
                    {
                        type: Communication.WebSocket.MessageType
                            .QUERY_RESPONSE,
                        requestId: message.requestId,
                        results,
                    },
                );
            ws.send(JSON.stringify(responseMsg));
        } catch (error) {
            log({
                prefix: this.LOG_PREFIX,
                message: "Query execution failed",
                type: "error",
                error,
                data: { message },
            });

            const errorMsg =
                Communication.WebSocket.createMessage<Communication.WebSocket.ErrorResponseMessage>(
                    {
                        type: Communication.WebSocket.MessageType
                            .ERROR_RESPONSE,
                        message:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    },
                );
            ws.send(JSON.stringify(errorMsg));
        }
    }

    async initialize() {
        // Load client configuration
        const [configEntry] = await this.sql`
            SELECT value FROM config.config WHERE general__key = '${Config.CONFIG_KEYS.CLIENT_SETTINGS}'
        `;

        if (configEntry?.value) {
            this.clientConfig = configEntry.value as Config.I_ClientSettings;
        } else {
            throw new Error("Client settings configuration not found");
        }

        this.heartbeatInterval = setInterval(
            () => this.checkHeartbeats(),
            this.authConfig.ws_check_interval_ms,
        );
    }

    async handleUpgrade(
        req: Request,
        server: Server,
    ): Promise<Response | undefined> {
        const url = new URL(req.url);
        const token = url.searchParams.get("token");

        // Handle missing token first
        if (!token) {
            log({
                prefix: this.LOG_PREFIX,
                message: "No token found in query parameters",
                debug: this.debugMode,
                type: "debug",
            });
            return new Response("Authentication required", { status: 401 });
        }

        const validation = await validateJWTAndSession(
            this.sql,
            this.debugMode,
            this.authConfig,
            token,
        );

        if (!validation.isValid) {
            log({
                prefix: this.LOG_PREFIX,
                message: "Token validation failed",
                debug: this.debugMode,
                type: "debug",
            });
            return new Response("Invalid token", { status: 401 });
        }

        // Only attempt upgrade if validation passes
        const upgraded = server.upgrade(req, {
            data: {
                token,
                agentId: validation.agentId,
                sessionId: validation.sessionId,
            },
        });

        if (!upgraded) {
            log({
                prefix: this.LOG_PREFIX,
                message: "WebSocket upgrade failed",
                debug: this.debugMode,
                type: "error",
            });
            return new Response("WebSocket upgrade failed", { status: 500 });
        }

        return undefined;
    }

    handleConnection(
        ws: WebSocket | ServerWebSocket<WebSocketData>,
        sessionData: { agentId: string; sessionId: string },
    ) {
        log({
            prefix: this.LOG_PREFIX,
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
        this.tokenMap.set(
            ws,
            (ws as ServerWebSocket<WebSocketData>).data.token,
        );

        try {
            const connectionMsg =
                Communication.WebSocket.createMessage<Communication.WebSocket.ConnectionEstablishedResponseMessage>(
                    {
                        type: Communication.WebSocket.MessageType
                            .CONNECTION_ESTABLISHED_RESPONSE,
                        agentId: sessionData.agentId,
                    },
                );
            ws.send(JSON.stringify(connectionMsg));
            log({
                prefix: this.LOG_PREFIX,
                message: `Connection established with agent ${sessionData.agentId}`,
                debug: this.debugMode,
                type: "debug",
            });
            // Send a full keyframe immediately on join.
            this.sendEntitiesKeyframeNotification(
                [ws as ServerWebSocket<WebSocketData>],
                "default",
            );
            this.sendEntityScriptsKeyframeNotification(
                [ws as ServerWebSocket<WebSocketData>],
                "default",
            );
        } catch (error) {
            log({
                prefix: this.LOG_PREFIX,
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
            log({
                prefix: this.LOG_PREFIX,
                message: "Handling WebSocket message",
                debug: this.debugMode,
                type: "debug",
                data: { message },
            });

            // Get session token
            const sessionToken = this.tokenMap.get(ws);
            if (!sessionToken) {
                const errorMsg =
                    Communication.WebSocket.createMessage<Communication.WebSocket.ErrorResponseMessage>(
                        {
                            type: Communication.WebSocket.MessageType
                                .ERROR_RESPONSE,
                            message: "Session token not found",
                        },
                    );
                ws.send(JSON.stringify(errorMsg));
                return;
            }

            // Validate session using the existing function
            const validation = await validateJWTAndSession(
                this.sql,
                this.debugMode,
                this.authConfig,
                sessionToken,
            );

            if (!validation.isValid) {
                const errorMsg =
                    Communication.WebSocket.createMessage<Communication.WebSocket.ErrorResponseMessage>(
                        {
                            type: Communication.WebSocket.MessageType
                                .ERROR_RESPONSE,
                            message: "Invalid session",
                        },
                    );
                ws.send(JSON.stringify(errorMsg));
                return;
            }

            const sessionId = this.wsToSessionMap.get(ws);
            if (!sessionId) {
                const errorMsg =
                    Communication.WebSocket.createMessage<Communication.WebSocket.ErrorResponseMessage>(
                        {
                            type: Communication.WebSocket.MessageType
                                .ERROR_RESPONSE,
                            message: "Session not found",
                        },
                    );
                ws.send(JSON.stringify(errorMsg));
                return;
            }
            const session = this.activeSessions.get(sessionId);
            if (!session) {
                const errorMsg =
                    Communication.WebSocket.createMessage<Communication.WebSocket.ErrorResponseMessage>(
                        {
                            type: Communication.WebSocket.MessageType
                                .ERROR_RESPONSE,
                            message: "Session not found",
                        },
                    );
                ws.send(JSON.stringify(errorMsg));
                return;
            }
            session.lastHeartbeat = Date.now();

            const data = JSON.parse(
                typeof message === "string" ? message : message.toString(),
            ) as
                | Communication.WebSocket.Message
                | {
                      type: "KEYFRAME_REQUEST";
                      syncGroup: string;
                      keyframeTypes: string[];
                  };

            switch (data.type) {
                case Communication.WebSocket.MessageType.HEARTBEAT_REQUEST: {
                    const heartbeatResponse =
                        Communication.WebSocket.createMessage<Communication.WebSocket.HeartbeatResponseMessage>(
                            {
                                type: Communication.WebSocket.MessageType
                                    .HEARTBEAT_RESPONSE,
                            },
                        );
                    ws.send(JSON.stringify(heartbeatResponse));
                    break;
                }
                case Communication.WebSocket.MessageType.CONFIG_REQUEST: {
                    if (!this.clientConfig) {
                        throw new Error("Client config not initialized");
                    }
                    const configMsg =
                        Communication.WebSocket.createMessage<Communication.WebSocket.ConfigResponseMessage>(
                            {
                                type: Communication.WebSocket.MessageType
                                    .CONFIG_RESPONSE,
                                config: this.clientConfig,
                            },
                        );
                    ws.send(JSON.stringify(configMsg));
                    break;
                }
                case Communication.WebSocket.MessageType
                    .KEYFRAME_ENTITIES_REQUEST: {
                    const request =
                        data as Communication.WebSocket.KeyframeEntitiesRequestMessage;
                    await this.sendEntitiesKeyframeNotification(
                        [ws as ServerWebSocket<WebSocketData>],
                        request.syncGroup,
                    );
                    break;
                }
                case Communication.WebSocket.MessageType.QUERY_REQUEST:
                    await this.handleQuery(
                        ws as ServerWebSocket<WebSocketData>,
                        data,
                    );
                    break;
                default: {
                    const errorMsg =
                        Communication.WebSocket.createMessage<Communication.WebSocket.ErrorResponseMessage>(
                            {
                                type: Communication.WebSocket.MessageType
                                    .ERROR_RESPONSE,
                                message: "Unknown message type",
                            },
                        );
                    ws.send(JSON.stringify(errorMsg));
                }
            }
        } catch (error) {
            const errorMsg =
                Communication.WebSocket.createMessage<Communication.WebSocket.ErrorResponseMessage>(
                    {
                        type: Communication.WebSocket.MessageType
                            .ERROR_RESPONSE,
                        message: "Invalid message format",
                    },
                );
            ws.send(JSON.stringify(errorMsg));
        }
    }

    handleDisconnect(sessionId: string) {
        const session = this.activeSessions.get(sessionId);
        if (session) {
            log({
                prefix: this.LOG_PREFIX,
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
                // Check heartbeat timeout first
                if (
                    now - session.lastHeartbeat >
                    this.authConfig.ws_check_interval_ms
                ) {
                    // Use database validate_session function
                    const [validation] = await this.sql<
                        [
                            {
                                auth__agent_id: string | null;
                                is_valid: boolean;
                                session_token: string | null;
                            },
                        ]
                    >`
                        SELECT * FROM auth.validate_session(${sessionId}::UUID)
                    `;

                    if (!validation?.is_valid) {
                        log({
                            prefix: this.LOG_PREFIX,
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

    stop() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }

        for (const session of this.activeSessions.values()) {
            session.ws.close(1000, "Server shutting down");
        }
        this.activeSessions.clear();
    }

    async sendEntitiesUpdatesNotification(
        ws: ServerWebSocket<WebSocketData>,
        changes: Tick.I_TickState["entity_updates"],
        tickData: Tick.I_TickState["tick_data"],
    ) {
        try {
            // Filter entities that include this session ID
            const relevantEntities = changes
                .filter((change) =>
                    change.sessionIds.includes(ws.data.sessionId),
                )
                .map((change) => ({
                    id: change.entityId,
                    operation: change.operation,
                    entityChanges: change.entityChanges,
                }));

            const notificationMsg =
                Communication.WebSocket.createMessage<Communication.WebSocket.NotificationEntityUpdatesMessage>(
                    {
                        type: Communication.WebSocket.MessageType
                            .NOTIFICATION_ENTITY_UPDATE,
                        tickMetadata: tickData,
                        entities: relevantEntities,
                    },
                );

            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(notificationMsg));
            } else {
                throw new Error("WebSocket is not open");
            }
        } catch (error) {
            log({
                prefix: this.LOG_PREFIX,
                message: `Failed to send entities updates: ${error}`,
                debug: this.debugMode,
                type: "error",
            });
        }
    }

    async sendEntityScriptsUpdatesNotification(
        ws: ServerWebSocket<WebSocketData>,
        scriptChanges: Tick.I_TickState["script_updates"],
        tickData: Tick.I_TickState["tick_data"],
    ) {
        try {
            // Filter scripts that include this session ID
            const relevantScripts = scriptChanges
                .filter((change) =>
                    change.sessionIds.includes(ws.data.sessionId),
                )
                .map((change) => ({
                    id: change.scriptId,
                    operation: change.operation,
                    scriptChanges: change.scriptChanges,
                }));

            const notificationMsg =
                Communication.WebSocket.createMessage<Communication.WebSocket.NotificationEntityScriptUpdatesMessage>(
                    {
                        type: Communication.WebSocket.MessageType
                            .NOTIFICATION_ENTITY_SCRIPT_UPDATE,
                        tickMetadata: tickData,
                        scripts: relevantScripts,
                    },
                );

            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(notificationMsg));
            } else {
                throw new Error("WebSocket is not open");
            }
        } catch (error) {
            log({
                prefix: this.LOG_PREFIX,
                message: `Failed to send entity scripts updates: ${error}`,
                debug: this.debugMode,
                type: "error",
            });
        }
    }

    async sendEntitiesKeyframeNotification(
        wsArray: ServerWebSocket<WebSocketData>[],
        syncGroup: string,
    ): Promise<void> {
        // Process all websockets in parallel
        await Promise.all(
            wsArray.map(async (ws) => {
                const sessionId = this.wsToSessionMap.get(ws);
                const sessionToken = this.tokenMap.get(ws);

                if (!sessionId || !sessionToken) {
                    log({
                        prefix: this.LOG_PREFIX,
                        message: "Missing session data for WebSocket",
                        debug: this.debugMode,
                        type: "debug",
                    });
                    return;
                }

                try {
                    // Execute query in a transaction with the correct agent context
                    const [result] = await this.sql.begin(async (sql) => {
                        await this.setAgentContext(
                            sql,
                            sessionId,
                            sessionToken,
                        );
                        return await sql<[{ entities: Entity.I_Entity[] }]>`
                            SELECT array_agg(e.*) as entities
                            FROM entity.entities e
                            WHERE e.group__sync = ${syncGroup}
                            AND e.scripts__status = 'ACTIVE'
                        `;
                    });

                    const keyframeMsg =
                        Communication.WebSocket.createMessage<Communication.WebSocket.KeyframeEntitiesResponseMessage>(
                            {
                                type: Communication.WebSocket.MessageType
                                    .KEYFRAME_ENTITIES_RESPONSE,
                                entities: result?.entities || [],
                            },
                        );

                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify(keyframeMsg));
                    }
                } catch (error) {
                    log({
                        prefix: this.LOG_PREFIX,
                        message: `Failed to send entities keyframe to specific client: ${error}`,
                        debug: this.debugMode,
                        type: "error",
                    });
                }
            }),
        );
    }

    async sendEntityScriptsKeyframeNotification(
        wsArray: ServerWebSocket<WebSocketData>[],
        syncGroup?: string,
    ): Promise<void> {
        await Promise.all(
            wsArray.map(async (ws) => {
                const sessionId = this.wsToSessionMap.get(ws);
                const sessionToken = this.tokenMap.get(ws);

                if (!sessionId || !sessionToken) {
                    log({
                        prefix: this.LOG_PREFIX,
                        message: "Missing session data for WebSocket",
                        debug: this.debugMode,
                        type: "debug",
                    });
                    return;
                }

                try {
                    // Execute query in a transaction with the correct agent context
                    const [result] = await this.sql.begin(async (sql) => {
                        await this.setAgentContext(
                            sql,
                            sessionId,
                            sessionToken,
                        );

                        // Build the query based on whether syncGroup is provided
                        const query = syncGroup
                            ? sql<
                                  [{ entity_scripts: Entity.Script.I_Script[] }]
                              >`
                                SELECT array_agg(scripts.*) as entity_scripts
                                FROM entity.entity_scripts scripts
                                WHERE group__sync = ${syncGroup}
                            `
                            : sql<
                                  [{ entity_scripts: Entity.Script.I_Script[] }]
                              >`
                                SELECT array_agg(scripts.*) as entity_scripts
                                FROM entity.entity_scripts scripts
                            `;

                        return await query;
                    });

                    const notificationMsg =
                        Communication.WebSocket.createMessage<Communication.WebSocket.KeyframeEntityScriptsResponseMessage>(
                            {
                                type: Communication.WebSocket.MessageType
                                    .KEYFRAME_ENTITY_SCRIPTS_RESPONSE,
                                scripts: result?.entity_scripts || [],
                            },
                        );

                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify(notificationMsg));
                    }
                } catch (error) {
                    log({
                        prefix: this.LOG_PREFIX,
                        message: `Failed to send entity scripts keyframe to specific client: ${error}`,
                        debug: this.debugMode,
                        type: "error",
                    });
                }
            }),
        );
    }
}

// #endregion

// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------

// =============================================================================
// ================ WORLD API MANAGER: Server Startup and Routing ==================
// =============================================================================

// #region WorldApiManager

export class WorldApiManager {
    private authConfig: Config.I_ClientSettings["auth"] | undefined;
    private restManager: WorldRestManager | undefined;
    private wsManager: WorldWebSocketManager | undefined;
    private tickManager: WorldTickManager | undefined;
    private server: Server | undefined;

    // Private constructor ensures that the class can only be instantiated via the static async create() method.
    private constructor(
        private sql: postgres.Sql,
        private readonly debugMode: boolean,
        private readonly config: typeof VircadiaConfig_Server,
    ) {}

    /**
     * Static async factory method.
     *
     * Use:
     * const worldApiManager = await WorldApiManager.create(sql, debugMode, config);
     */
    public static async create(
        sql: postgres.Sql,
        debugMode: boolean,
        config: typeof VircadiaConfig_Server,
    ): Promise<WorldApiManager> {
        const instance = new WorldApiManager(sql, debugMode, config);
        await instance.initialize();
        return instance;
    }

    /**
     * Asynchronous initialization.
     * This sets up the auth configuration, REST manager, WebSocketManager, WorldTickManager,
     * and finally starts the Bun server.
     */
    private async initialize() {
        log({
            message: "Initializing world api manager",
            debug: this.debugMode,
            type: "debug",
        });

        // Load auth config
        const [configEntry] = await this.sql`
            SELECT value FROM config.config WHERE general__key = '${Config.CONFIG_KEYS.CLIENT_SETTINGS}'
        `;
        this.authConfig = (configEntry.value as Config.I_ClientSettings).auth;

        // Initialize components
        this.restManager = new WorldRestManager(
            this.sql,
            this.debugMode,
            this.authConfig,
        );

        this.wsManager = new WorldWebSocketManager(
            this.sql,
            this.debugMode,
            this.authConfig,
        );
        await this.wsManager.initialize();

        // Initialize Tick Manager after wsManager is ready.
        this.tickManager = new WorldTickManager(
            this.sql,
            this.debugMode,
            this.wsManager,
        );
        await this.tickManager.initialize();
        this.tickManager.start();

        // Start server
        this.server = Bun.serve({
            port: this.config.serverPort,
            hostname: this.config.serverHost,
            development: this.debugMode,

            fetch: async (req: Request, server: Server) => {
                const url = new URL(req.url);

                // Handle WebSocket upgrade
                if (url.pathname.startsWith(Communication.WS_PATH)) {
                    return await this.wsManager?.handleUpgrade(req, server);
                }

                // Handle HTTP routes
                if (url.pathname.startsWith(Communication.REST_BASE_PATH)) {
                    return await this.restManager?.handleRequest(req);
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
        this.tickManager?.stop();
        this.wsManager?.stop();
        this.restManager?.stop();
        this.server?.stop();
    }
}

// #endregion
