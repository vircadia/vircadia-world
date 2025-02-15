// =============================================================================
// ============================== IMPORTS, TYPES, AND INTERFACES ==============================
// =============================================================================

import { log } from "../../sdk/vircadia-world-sdk-ts/module/general/log";
import type postgres from "postgres";
import { sign, verify } from "jsonwebtoken";
import { VircadiaConfig_Server } from "../../sdk/vircadia-world-sdk-ts/config/vircadia.config.ts";
import {
    Communication,
    type Auth,
    type Tick,
} from "../../sdk/vircadia-world-sdk-ts/schema/schema.general";
import type { Server, ServerWebSocket } from "bun";
import type {
    Config,
    Entity,
} from "../../sdk/vircadia-world-sdk-ts/schema/schema.general";
import { PostgresClient } from "../database/postgres/postgres_client";

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

namespace SessionValidation {
    export async function validateJWTAndSession(data: {
        sql: postgres.Sql;
        jwtSecret?: string;
        token: string;
    }): Promise<{ agentId: string; sessionId: string; isValid: boolean }> {
        const { sql, jwtSecret, token } = data;

        try {
            if (!jwtSecret) {
                throw new Error("JWT secret is not set");
            }

            // Check for empty or malformed token first
            if (!token || token.split(".").length !== 3) {
                return {
                    agentId: "",
                    sessionId: "",
                    isValid: false,
                };
            }

            const decoded = verify(token, jwtSecret) as {
                sessionId: string;
                agentId: string;
            };

            const [validation] = await sql`
            SELECT * FROM auth.validate_session(${decoded.sessionId}::UUID)
        `;

            log({
                message: "Session validation result",
                debug: VircadiaConfig_Server.debug,
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
                debug: VircadiaConfig_Server.debug,
                type: "debug",
                data: {
                    error:
                        error instanceof Error ? error.message : String(error),
                },
            });
            return {
                agentId: "",
                sessionId: "",
                isValid: false,
            };
        }
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
        private readonly config: Config.I_Config<"auth">,
    ) {}

    private readonly LOG_PREFIX = "WorldRestManager";

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

        const validation = await SessionValidation.validateJWTAndSession({
            sql: this.sql,
            jwtSecret: this.config.general__value?.jwt_secret,
            token,
        });

        // Set the current agent ID for RLS
        if (validation.isValid) {
            await this
                .sql`SELECT set_config('app.current_agent_id', ${validation.agentId}::text, true)`;
        }

        log({
            message: "Auth endpoint - Session validation result",
            debug: VircadiaConfig_Server.debug,
            type: "debug",
            prefix: this.LOG_PREFIX,
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

        const validation = await SessionValidation.validateJWTAndSession({
            sql: this.sql,
            jwtSecret: this.config.general__value?.jwt_secret,
            token,
        });

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
                debug: VircadiaConfig_Server.debug,
                type: "debug",
                prefix: this.LOG_PREFIX,
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
                debug: VircadiaConfig_Server.debug,
                type: "error",
                prefix: this.LOG_PREFIX,
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
    private syncGroups: Map<string, Auth.SyncGroup.I_SyncGroup> = new Map();
    private tickCounts: Map<string, number> = new Map();

    private readonly LOG_PREFIX = "WorldTickManager";

    constructor(
        private readonly sql: postgres.Sql,
        private readonly wsManager: WorldWebSocketManager,
    ) {}

    async initialize() {
        try {
            // Updated to use auth schema for sync groups
            const syncGroupsData = await this.sql<Auth.SyncGroup.I_SyncGroup[]>`
                SELECT * FROM auth.sync_groups
            `;

            for (const group of syncGroupsData) {
                this.syncGroups.set(group.general__sync_group, group);
            }
        } catch (error) {
            log({
                message: `Failed to initialize tick manager: ${error}`,
                debug: VircadiaConfig_Server.debug,
                suppress: VircadiaConfig_Server.suppress,
                type: "error",
            });
            throw error;
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

            // Use performance.now() for precise timing
            let nextTickTime = performance.now();

            const tickLoop = () => {
                const now = performance.now();
                const delay = Math.max(0, nextTickTime - now);

                // Schedule next tick
                nextTickTime += config.server__tick__rate_ms;
                this.intervalIds.set(syncGroup, setTimeout(tickLoop, delay));

                // Process tick asynchronously
                this.processTick(syncGroup).catch((error) => {
                    log({
                        message: `Error in tick processing for ${syncGroup}.`,
                        error: error,
                        prefix: this.LOG_PREFIX,
                        suppress: VircadiaConfig_Server.suppress,
                        debug: VircadiaConfig_Server.debug,
                        type: "error",
                    });
                });
            };

            tickLoop();
        }
    }

    private async processTick(syncGroup: string) {
        const localTotalStartTime = performance.now();

        const syncGroupConfig = this.syncGroups.get(syncGroup);
        if (!syncGroupConfig) {
            throw new Error(`Sync group ${syncGroup} not found`);
        }

        // Measure the time taken for the database operations
        const localDbStartTime = performance.now();
        const result = await this.sql.begin(async (sql) => {
            // Capture the tick state and get metadata directly
            const [tickData] = await sql<[Tick.I_Tick]>`
                    SELECT * FROM tick.capture_tick_state(${syncGroup})
                `;

            if (!tickData) {
                return null;
            }

            // Get entity changes using the new function
            let entityChanges: Tick.I_EntityUpdate[] = [];
            try {
                entityChanges = await sql<Tick.I_EntityUpdate[]>`
                    SELECT 
                        general__entity_id as entity_id,
                        operation,
                        changes,
                        sync_group_session_ids
                    FROM tick.get_changed_entity_states_between_latest_ticks(${syncGroup})
                `;
            } catch (error) {
                log({
                    message: `Failed to get entity changes for ${syncGroup}`,
                    debug: VircadiaConfig_Server.debug,
                    suppress: VircadiaConfig_Server.suppress,
                    error: error,
                    type: "error",
                });
            }

            // Get script changes using the new function
            let scriptChanges: Tick.I_ScriptUpdate[] = [];
            try {
                scriptChanges = await sql<Tick.I_ScriptUpdate[]>`
                    SELECT 
                        script_id,
                        operation,
                        changes,
                        sync_group_session_ids
                    FROM tick.get_changed_script_states_between_latest_ticks(${syncGroup})
                `;
            } catch (error) {
                log({
                    message: `Failed to get script changes for ${syncGroup}`,
                    debug: VircadiaConfig_Server.debug,
                    suppress: VircadiaConfig_Server.suppress,
                    error: error,
                    type: "error",
                });
            }

            // Update tick count for internal metrics
            const currentCount = this.tickCounts.get(syncGroup) || 0;
            this.tickCounts.set(syncGroup, currentCount + 1);

            return {
                tick_data: tickData,
                entity_updates: entityChanges,
                script_updates: scriptChanges,
            };
        });
        const localDbProcessingTime = performance.now() - localDbStartTime;

        if (result) {
            // Handle regular entity updates
            if (
                Array.isArray(result.entity_updates) &&
                result.entity_updates.length > 0
            ) {
                // Group updates by session ID
                const sessionUpdates = new Map<string, Tick.I_EntityUpdate[]>();

                for (const update of result.entity_updates) {
                    for (const sessionId of update.sync_group_session_ids) {
                        if (!sessionUpdates.has(sessionId)) {
                            sessionUpdates.set(sessionId, []);
                        }
                        sessionUpdates.get(sessionId)?.push(update);
                    }
                }

                // Send updates to each session asynchronously
                const updatePromises = Array.from(sessionUpdates.entries()).map(
                    ([sessionId, updates]) => {
                        const session =
                            this.wsManager.activeSessions.get(sessionId);
                        if (session?.ws) {
                            return this.wsManager.sendEntitiesUpdatesNotification(
                                session.ws as ServerWebSocket<WebSocketData>,
                                updates,
                                result.tick_data,
                            );
                        }
                        return Promise.resolve();
                    },
                );

                // Fire and forget - don't await the promises
                Promise.all(updatePromises).catch((error) => {
                    log({
                        message: `Error sending entity updates: ${error}`,
                        debug: VircadiaConfig_Server.debug,
                        suppress: VircadiaConfig_Server.suppress,
                        type: "error",
                    });
                });
            }

            // Handle script updates
            if (
                Array.isArray(result.script_updates) &&
                result.script_updates.length > 0
            ) {
                // Group updates by session ID
                const sessionUpdates = new Map<string, Tick.I_ScriptUpdate[]>();

                for (const update of result.script_updates) {
                    for (const sessionId of update.sync_group_session_ids) {
                        if (!sessionUpdates.has(sessionId)) {
                            sessionUpdates.set(sessionId, []);
                        }
                        sessionUpdates.get(sessionId)?.push(update);
                    }
                }

                // Send updates to each session asynchronously
                const updatePromises = Array.from(sessionUpdates.entries()).map(
                    ([sessionId, updates]) => {
                        const session =
                            this.wsManager.activeSessions.get(sessionId);
                        if (session?.ws) {
                            return this.wsManager.sendEntityScriptsUpdatesNotification(
                                session.ws as ServerWebSocket<WebSocketData>,
                                updates,
                                result.tick_data,
                            );
                        }
                        return Promise.resolve();
                    },
                );

                // Fire and forget - don't await the promises
                Promise.all(updatePromises).catch((error) => {
                    log({
                        message: `Error sending script updates: ${error}`,
                        debug: VircadiaConfig_Server.debug,
                        suppress: VircadiaConfig_Server.suppress,
                        type: "error",
                    });
                });
            }
        }

        const localTotalProcessingTime =
            performance.now() - localTotalStartTime;
        const tickRate = syncGroupConfig.server__tick__rate_ms;
        const isLocallyTotalDelayed = localTotalProcessingTime > tickRate;
        const isLocallyDbDelayed = localDbProcessingTime > tickRate;
        const isRemotelyDbDelayed = result?.tick_data.tick__is_delayed || false;

        if (
            isLocallyTotalDelayed ||
            isLocallyDbDelayed ||
            isRemotelyDbDelayed
        ) {
            log({
                message: `Tick processing is delayed for ${syncGroup}\nLocally: ${isLocallyDbDelayed || isLocallyTotalDelayed}\nRemotely: ${isRemotelyDbDelayed}`,
                debug: VircadiaConfig_Server.debug,
                suppress: VircadiaConfig_Server.suppress,
                type: "warning",
                data: {
                    localDbProcessingTime: `Local database processing time: ${localDbProcessingTime}ms`,
                    localTotalProcessingTime: `Local total processing time: ${localTotalProcessingTime}ms`,
                    remoteDbProcessingTime: `Remote database processing time: ${result?.tick_data.tick__duration_ms}ms`,
                    tickRate: `Tick rate: ${tickRate}ms`,
                },
            });
        }
    }

    stop() {
        for (const [syncGroup, intervalId] of this.intervalIds.entries()) {
            clearTimeout(intervalId);
            this.intervalIds.delete(syncGroup);
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

    private readonly LOG_PREFIX = "WorldWebSocketManager";

    constructor(
        private readonly sql: postgres.Sql,
        private readonly config: Config.I_Config<"auth">,
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
        this.heartbeatInterval = setInterval(
            () => this.checkHeartbeats(),
            1000,
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
                debug: VircadiaConfig_Server.debug,
                type: "debug",
            });
            return new Response("Authentication required", { status: 401 });
        }

        const validation = await SessionValidation.validateJWTAndSession({
            sql: this.sql,
            jwtSecret: this.config.general__value?.jwt_secret,
            token,
        });

        if (!validation.isValid) {
            log({
                prefix: this.LOG_PREFIX,
                message: "Token validation failed",
                debug: VircadiaConfig_Server.debug,
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
                debug: VircadiaConfig_Server.debug,
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
            debug: VircadiaConfig_Server.debug,
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
                debug: VircadiaConfig_Server.debug,
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
                debug: VircadiaConfig_Server.debug,
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
                debug: VircadiaConfig_Server.debug,
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
            const validation = await SessionValidation.validateJWTAndSession({
                sql: this.sql,
                jwtSecret: this.config.general__value?.jwt_secret,
                token: sessionToken,
            });

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
            ) as Communication.WebSocket.Message;

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
                case Communication.WebSocket.MessageType
                    .CLIENT_CONFIG_REQUEST: {
                    if (!this.config) {
                        throw new Error("Client config not initialized");
                    }
                    const configMsg =
                        Communication.WebSocket.createMessage<Communication.WebSocket.ClientConfigResponseMessage>(
                            {
                                type: Communication.WebSocket.MessageType
                                    .CLIENT_CONFIG_RESPONSE,
                                // TODO: Add client config
                                config: {},
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
                debug: VircadiaConfig_Server.debug,
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
                if (!this.config.general__value?.heartbeat_inactive_expiry_ms) {
                    throw new Error("WebSocket check interval not set");
                }

                // Check heartbeat timeout first
                if (
                    now - session.lastHeartbeat >
                    this.config.general__value?.heartbeat_inactive_expiry_ms
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
                            debug: VircadiaConfig_Server.debug,
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
        changes: Tick.I_EntityUpdate[],
        tickData: Tick.I_Tick,
    ) {
        try {
            const notificationMsg =
                Communication.WebSocket.createMessage<Communication.WebSocket.NotificationEntityUpdatesMessage>(
                    {
                        type: Communication.WebSocket.MessageType
                            .NOTIFICATION_ENTITY_UPDATE,
                        tickMetadata: tickData,
                        entities: changes.map((change) => ({
                            id: change.general__entity_id,
                            operation: change.operation,
                            entityChanges: change.changes,
                        })),
                    },
                );

            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(notificationMsg));
            }
        } catch (error) {
            log({
                prefix: this.LOG_PREFIX,
                message: `Failed to send entities updates: ${error}`,
                debug: VircadiaConfig_Server.debug,
                type: "error",
            });
        }
    }

    async sendEntityScriptsUpdatesNotification(
        ws: ServerWebSocket<WebSocketData>,
        scriptChanges: Tick.I_ScriptUpdate[],
        tickData: Tick.I_Tick,
    ) {
        try {
            const notificationMsg =
                Communication.WebSocket.createMessage<Communication.WebSocket.NotificationEntityScriptUpdatesMessage>(
                    {
                        type: Communication.WebSocket.MessageType
                            .NOTIFICATION_ENTITY_SCRIPT_UPDATE,
                        tickMetadata: tickData,
                        scripts: scriptChanges.map((change) => ({
                            id: change.general__script_id,
                            operation: change.operation,
                            scriptChanges: change.changes,
                        })),
                    },
                );

            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(notificationMsg));
            }
        } catch (error) {
            log({
                prefix: this.LOG_PREFIX,
                message: `Failed to send entity scripts updates: ${error}`,
                debug: VircadiaConfig_Server.debug,
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
                        debug: VircadiaConfig_Server.debug,
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
                        debug: VircadiaConfig_Server.debug,
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
                        debug: VircadiaConfig_Server.debug,
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
                                FROM entity.entity_scripts es
                                WHERE es.group__sync = ${syncGroup}
                            `
                            : sql<
                                  [{ entity_scripts: Entity.Script.I_Script[] }]
                              >`
                                SELECT array_agg(es.*) as entity_scripts
                                FROM entity.entity_scripts es
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
                        debug: VircadiaConfig_Server.debug,
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
    private restManager: WorldRestManager | undefined;
    private wsManager: WorldWebSocketManager | undefined;
    private tickManager: WorldTickManager | undefined;
    private server: Server | undefined;
    private sql: postgres.Sql | undefined;

    async initialize() {
        try {
            log({
                message: "Initializing world api manager",
                debug: VircadiaConfig_Server.debug,
                type: "debug",
            });

            // Initialize database connection using PostgresClient
            const postgresClient = PostgresClient.getInstance();
            await postgresClient.connect();
            this.sql = postgresClient.getClient();

            // Load full config with proper typing
            const [authConfig] = await this.sql<[Config.I_Config<"auth">]>`
                SELECT general__value 
                FROM config.config 
                WHERE general__key = 'auth'
            `;

            if (!authConfig.general__value) {
                log({
                    message: "Failed to load auth configuration",
                    error: authConfig,
                    suppress: VircadiaConfig_Server.suppress,
                    debug: VircadiaConfig_Server.debug,
                    type: "error",
                });
                throw new Error("Failed to load auth configuration");
            }

            // Initialize components with typed config
            this.restManager = new WorldRestManager(this.sql, authConfig);

            this.wsManager = new WorldWebSocketManager(this.sql, authConfig);
            await this.wsManager.initialize();

            // Initialize Tick Manager after wsManager is ready
            this.tickManager = new WorldTickManager(this.sql, this.wsManager);
            await this.tickManager.initialize();
            this.tickManager.start();

            // Start server
            this.server = Bun.serve({
                port: VircadiaConfig_Server.serverPort,
                hostname: VircadiaConfig_Server.serverHost,
                development: VircadiaConfig_Server.debug,

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
                            debug: VircadiaConfig_Server.debug,
                            type: "debug",
                        });
                        this.wsManager?.handleMessage(ws, message);
                    },
                    open: (ws: ServerWebSocket<WebSocketData>) => {
                        log({
                            message: "WebSocket connection opened",
                            debug: VircadiaConfig_Server.debug,
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
                            debug: VircadiaConfig_Server.debug,
                            type: "debug",
                        });
                        this.wsManager?.handleDisconnect(ws.data.sessionId);
                    },
                },
            });

            log({
                message: `Bun HTTP+WS World API Server running at http://${VircadiaConfig_Server.serverHost}:${VircadiaConfig_Server.serverPort}`,
                type: "success",
            });
        } catch (error) {
            log({
                message: `Failed to initialize WorldApiManager: ${error}`,
                type: "error",
                debug: true,
            });
            throw error;
        }
    }

    cleanup() {
        this.tickManager?.stop();
        this.wsManager?.stop();
        this.restManager?.stop();
        this.server?.stop();
        PostgresClient.getInstance().disconnect();
    }
}

// Add command line entry point
if (import.meta.main) {
    try {
        const manager = new WorldApiManager();
        await manager.initialize();

        // Handle cleanup on process termination
        process.on("SIGINT", () => {
            log({
                message: "\nReceived SIGINT. Cleaning up...",
                debug: VircadiaConfig_Server.debug,
                type: "debug",
            });
            manager.cleanup();
            process.exit(0);
        });

        process.on("SIGTERM", () => {
            log({
                message: "\nReceived SIGTERM. Cleaning up...",
                debug: VircadiaConfig_Server.debug,
                type: "debug",
            });
            manager.cleanup();
            process.exit(0);
        });
    } catch (error) {
        log({
            message: `Failed to start WorldApiManager: ${error}`,
            type: "error",
            debug: true,
        });
        process.exit(1);
    }
}

// #endregion
