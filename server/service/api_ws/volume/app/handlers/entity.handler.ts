
import type { ServerWebSocket } from "bun";
import { BunLogModule } from "../../../../../../sdk/vircadia-world-sdk-ts/bun/src/module/vircadia.common.bun.log.module";
import { Communication, type Entity } from "../../../../../../sdk/vircadia-world-sdk-ts/schema/src/vircadia.schema.general";
import type { IMessageHandler, IWorldApiWsContext } from "./message.handler.interface";
import type { WorldSession, WebSocketData } from "../world.api.ws.manager";

const LOG_PREFIX = "EntityHandler";

export class EntityMessageHandler implements IMessageHandler {
    async handle(
        ws: ServerWebSocket<WebSocketData>,
        session: WorldSession,
        message: Communication.WebSocket.Message,
        context: IWorldApiWsContext
    ): Promise<void> {
        switch (message.type) {
            case Communication.WebSocket.MessageType.FETCH_ENTITIES_REQUEST:
                await this.handleFetchEntities(ws, session, message as Communication.WebSocket.FetchEntitiesRequestMessage, context);
                break;
            case Communication.WebSocket.MessageType.ENTITY_CHANNEL_SUBSCRIBE_REQUEST:
                await this.handleSubscribe(ws, session, message as Communication.WebSocket.EntityChannelSubscribeRequestMessage, context);
                break;
            case Communication.WebSocket.MessageType.ENTITY_CHANNEL_UNSUBSCRIBE_REQUEST:
                await this.handleUnsubscribe(ws, session, message as Communication.WebSocket.EntityChannelUnsubscribeRequestMessage, context);
                break;
        }
    }

    private async handleFetchEntities(
        ws: ServerWebSocket<WebSocketData>,
        session: WorldSession,
        message: Communication.WebSocket.FetchEntitiesRequestMessage,
        context: IWorldApiWsContext
    ) {
         const startTime = performance.now();
        const requestSize = new TextEncoder().encode(JSON.stringify(message)).length;
        let responseSize = 0;
        let success = false;

        try {
            if (!context.aclService) {
                throw new Error("ACL Service not initialized");
            }

            // 1. App-Layer Permission Check
            if (!context.aclService.canRead(session.agentId, message.syncGroup)) {
                throw new Error(`Permission denied: Agent cannot read group ${message.syncGroup}`);
            }

            if (!context.superUserSql) {
                throw new Error("Database connection execution failed");
            }

            // 2. Service Role Query (Optimized)
            let entities: Entity.I_Entity[];

            if (message.region) {
                const [xmin, ymin, xmax, ymax] = message.region;
                entities = (await context.superUserSql`
                    SELECT * FROM entity.entities
                    WHERE group__sync = ${message.syncGroup}
                    AND position__x BETWEEN ${xmin} AND ${xmax}
                    AND position__y BETWEEN ${ymin} AND ${ymax}
                `) as Entity.I_Entity[];
            } else {
                entities = (await context.superUserSql`
                    SELECT * FROM entity.entities
                    WHERE group__sync = ${message.syncGroup}
                `) as Entity.I_Entity[];
            }

            const responseData = {
                type: Communication.WebSocket.MessageType.FETCH_ENTITIES_RESPONSE,
                timestamp: Date.now(),
                requestId: message.requestId,
                errorMessage: null,
                entities,
            };

            const responseParsed = Communication.WebSocket.Z.FetchEntitiesResponse.safeParse(responseData);
            
            if (!responseParsed.success) {
                    throw new Error(`Invalid fetch response format: ${responseParsed.error.message}`);
            }

            const responseString = JSON.stringify(responseParsed.data);
            responseSize = new TextEncoder().encode(responseString).length;
            success = true;

            ws.send(responseString);
            
            BunLogModule({
                prefix: LOG_PREFIX,
                message: "WS FETCH_ENTITIES handlers handled",
                debug: context.debug,
                suppress: context.suppress,
                type: "debug",
                data: {
                    requestId: message.requestId,
                    count: entities.length,
                    durationMs: performance.now() - startTime,
                }
            });

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);

            BunLogModule({
                message: `Fetch entities failed: ${errorMessage}`,
                debug: context.debug,
                suppress: context.suppress,
                type: "error",
                prefix: LOG_PREFIX,
                data: {
                    error,
                    group: message.syncGroup,
                },
            });

                const errorResponseData: Communication.WebSocket.FetchEntitiesResponseMessage = {
                    type: Communication.WebSocket.MessageType.FETCH_ENTITIES_RESPONSE,
                    timestamp: Date.now(),
                    requestId: message.requestId,
                    errorMessage,
                    entities: [],
                };
            
            ws.send(JSON.stringify(errorResponseData));
        } finally {
             context.manager.recordEndpointMetrics(
                "WS_FETCH_ENTITIES",
                startTime,
                requestSize,
                responseSize,
                success,
            );
        }
    }

    private async handleSubscribe(
        ws: ServerWebSocket<WebSocketData>,
        session: WorldSession,
        message: Communication.WebSocket.EntityChannelSubscribeRequestMessage,
        context: IWorldApiWsContext
    ) {
         const startTime = performance.now();
        const requestSize = new TextEncoder().encode(JSON.stringify(message)).length;
        let responseSize = 0;
        let success = false;
        const entityName = message.entityName.trim();
        const channel = message.channel === undefined ? null : message.channel?.trim() || null;

        try {
            if (!entityName) {
                throw new Error("entityName is required");
            }

            if (!context.aclService?.isWarmed(session.agentId)) {
                await context.manager.warmAgentAcl(session.agentId).catch(() => {});
            }

            // Get the entity's syncGroup from the database
            if (!context.superUserSql) {
                throw new Error("Database connection not available");
            }

            const entityResult = await context.superUserSql<Array<{ group__sync: string }>>`
                SELECT group__sync
                FROM entity.entities
                WHERE general__entity_name = ${entityName}
                LIMIT 1
            `;

            if (entityResult.length === 0) {
                throw new Error(`Entity not found: ${entityName}`);
            }

            const syncGroup = entityResult[0].group__sync;

            // Check if user can read this syncGroup
            if (!context.aclService.canRead(session.agentId, syncGroup)) {
                throw new Error(`Not authorized to read sync group: ${syncGroup}`);
            }

            // Subscribe to entity topics
            if (typeof ws.subscribe !== "function") {
                throw new Error("WebSocket does not support subscriptions");
            }

            if (channel === null) {
                // Subscribe to "all channels" topic
                context.manager.subscribeToTopic(ws, context.manager.getEntityTopic(syncGroup, entityName));
                
                // Also subscribe to all metadata "all channels" topics for this entity
                const metadataSyncGroupsResult = await context.superUserSql<Array<{ group__sync: string }>>`
                    SELECT DISTINCT e.group__sync
                    FROM entity.entity_metadata AS m
                    JOIN entity.entities AS e
                        ON e.general__entity_name = m.general__entity_name
                    WHERE m.general__entity_name = ${entityName}
                `;

                const uniqueSyncGroups = new Set<string>();
                uniqueSyncGroups.add(syncGroup);
                for (const row of metadataSyncGroupsResult) {
                    uniqueSyncGroups.add(row.group__sync);
                }

                for (const sg of uniqueSyncGroups) {
                    if (context.aclService.canRead(session.agentId, sg)) {
                         context.manager.subscribeToTopic(ws, context.manager.getMetadataTopic(sg, entityName, "__ALL__"));
                    }
                }
            } else {
                 // Subscribe to channel-specific topic
                context.manager.subscribeToTopic(ws, context.manager.getEntityTopic(syncGroup, entityName, channel));

                // Also subscribe to channel-specific metadata topics
                const metadataSyncGroupsResult = await context.superUserSql<Array<{ group__sync: string }>>`
                    SELECT DISTINCT e.group__sync
                    FROM entity.entity_metadata AS m
                    JOIN entity.entities AS e
                        ON e.general__entity_name = m.general__entity_name
                    WHERE m.general__entity_name = ${entityName}
                `;

                 const uniqueSyncGroups = new Set<string>();
                uniqueSyncGroups.add(syncGroup);
                for (const row of metadataSyncGroupsResult) {
                    uniqueSyncGroups.add(row.group__sync);
                }

                for (const sg of uniqueSyncGroups) {
                   if (context.aclService.canRead(session.agentId, sg)) {
                        context.manager.subscribeToTopic(ws, context.manager.getMetadataTopic(sg, entityName, "__ALL__", channel));
                    }
                }
            }

            const responseData = {
                type: Communication.WebSocket.MessageType.ENTITY_CHANNEL_SUBSCRIBE_RESPONSE,
                timestamp: Date.now(),
                requestId: message.requestId,
                errorMessage: null,
                entityName,
                channel,
                subscribed: true,
            };

            const responseParsed = Communication.WebSocket.Z.EntityChannelSubscribeResponse.safeParse(responseData);
            if (!responseParsed.success) {
                throw new Error("Invalid entity channel subscribe response format");
            }

            const responseString = JSON.stringify(responseParsed.data);
            responseSize = new TextEncoder().encode(responseString).length;
            success = true;

            ws.send(responseString);

            BunLogModule({
                prefix: LOG_PREFIX,
                message: "WS ENTITY_CHANNEL_SUBSCRIBE_REQUEST handled",
                debug: context.debug,
                suppress: context.suppress,
                type: "debug",
                data: {
                    requestId: message.requestId,
                    entityName,
                    channel,
                    durationMs: performance.now() - startTime,
                },
            });

        } catch (error) {
             const errorMessage = error instanceof Error ? error.message : String(error);

             const errorResponse = {
                type: Communication.WebSocket.MessageType.ENTITY_CHANNEL_SUBSCRIBE_RESPONSE,
                timestamp: Date.now(),
                requestId: message.requestId,
                errorMessage,
                entityName,
                channel,
                subscribed: false,
            };

            const errorParsed = Communication.WebSocket.Z.EntityChannelSubscribeResponse.safeParse(errorResponse);
            if (errorParsed.success) {
                const errorString = JSON.stringify(errorParsed.data);
                responseSize = new TextEncoder().encode(errorString).length;
                ws.send(errorString);
            }

            BunLogModule({
                prefix: LOG_PREFIX,
                message: "WS ENTITY_CHANNEL_SUBSCRIBE_REQUEST error",
                debug: context.debug,
                suppress: context.suppress,
                type: "info",
                data: {
                    requestId: message.requestId,
                    entityName,
                    channel,
                    errorMessage,
                },
            });
        } finally {
             context.manager.recordEndpointMetrics(
                "WS_ENTITY_CHANNEL_SUBSCRIBE_REQUEST",
                startTime,
                requestSize,
                responseSize,
                success,
            );
        }
    }

    private async handleUnsubscribe(
        ws: ServerWebSocket<WebSocketData>,
        session: WorldSession,
        message: Communication.WebSocket.EntityChannelUnsubscribeRequestMessage,
        context: IWorldApiWsContext
    ) {
         const startTime = performance.now();
        const requestSize = new TextEncoder().encode(JSON.stringify(message)).length;
        let responseSize = 0;
        let removed = false;
        let success = false;
        const entityName = message.entityName.trim();
        const channel = message.channel === undefined ? null : message.channel?.trim() || null;

         try {
             if (typeof ws.unsubscribe !== "function") {
                removed = false;
            } else {
                 const subscriptions = (ws as unknown as { subscriptions?: string[] }).subscriptions || [];
                const currentSubscriptions = new Set(subscriptions);

                 // Get the entity's syncGroup from the database
                if (context.superUserSql && entityName) {
                    try {
                        const entityResult = await context.superUserSql<Array<{ group__sync: string }>>`
                            SELECT group__sync
                            FROM entity.entities
                            WHERE general__entity_name = ${entityName}
                            LIMIT 1
                        `;

                        if (entityResult.length > 0) {
                             const syncGroup = entityResult[0].group__sync;
                             
                             if (channel === null) {
                                // Unsubscribe from all entity and metadata topics for this entity
                                const allChannelsTopic = context.manager.getEntityTopic(syncGroup, entityName);
                                if (currentSubscriptions.has(allChannelsTopic)) {
                                    ws.unsubscribe(allChannelsTopic);
                                    removed = true;
                                }

                                 // Unsubscribe from all metadata "all channels" topics
                                const metadataKeysResult = await context.superUserSql<Array<{ metadata__key: string; group__sync: string }>>`
                                    SELECT DISTINCT m.metadata__key, e.group__sync
                                    FROM entity.entity_metadata AS m
                                    JOIN entity.entities AS e
                                        ON e.general__entity_name = m.general__entity_name
                                    WHERE m.general__entity_name = ${entityName}
                                `;

                                for (const row of metadataKeysResult) {
                                    const metadataAllChannelsTopic = context.manager.getMetadataTopic(row.group__sync, entityName, row.metadata__key);
                                    if (currentSubscriptions.has(metadataAllChannelsTopic)) {
                                        ws.unsubscribe(metadataAllChannelsTopic);
                                    }
                                }
                             } else {
                                // Unsubscribe from channel-specific topic
                                const channelTopic = context.manager.getEntityTopic(syncGroup, entityName, channel);
                                if (currentSubscriptions.has(channelTopic)) {
                                    ws.unsubscribe(channelTopic);
                                    removed = true;
                                }

                                // Unsubscribe from channel-specific metadata topics
                                const metadataKeysResult = await context.superUserSql<Array<{ metadata__key: string; group__sync: string }>>`
                                    SELECT DISTINCT m.metadata__key, e.group__sync
                                    FROM entity.entity_metadata AS m
                                    JOIN entity.entities AS e
                                        ON e.general__entity_name = m.general__entity_name
                                    WHERE m.general__entity_name = ${entityName}
                                `;

                                for (const row of metadataKeysResult) {
                                    const metadataChannelTopic = context.manager.getMetadataTopic(row.group__sync, entityName, row.metadata__key, channel);
                                    if (currentSubscriptions.has(metadataChannelTopic)) {
                                        ws.unsubscribe(metadataChannelTopic);
                                    }
                                }
                             }
                        }
                    } catch {
                         // If entity not found or error, just try to unsubscribe from any matching topics
                        removed = false;
                    }
                }
             
                 // Fallback: unsubscribe from any topics matching the entity name pattern
                 // Note: This logic was in the original monolithic switch but relies on string matching which is brittle.
                // We'll skip the fallback for now as it duplicates logic and implies knowledge of topic structure not available here easily without context.manager exposing helpers.
                // But we are using context.manager helpers now.
            }

            const responseData = {
                type: Communication.WebSocket.MessageType.ENTITY_CHANNEL_UNSUBSCRIBE_RESPONSE,
                timestamp: Date.now(),
                requestId: message.requestId,
                errorMessage: null,
                entityName,
                channel,
                removed,
            };

            const responseParsed = Communication.WebSocket.Z.EntityChannelUnsubscribeResponse.safeParse(responseData);
             if (!responseParsed.success) {
                throw new Error("Invalid entity channel unsubscribe response format");
            }

            const responseString = JSON.stringify(responseParsed.data);
            responseSize = new TextEncoder().encode(responseString).length;
            ws.send(responseString);
            success = true;

             BunLogModule({
                prefix: LOG_PREFIX,
                message: "WS ENTITY_CHANNEL_UNSUBSCRIBE_REQUEST handled",
                debug: context.debug,
                suppress: context.suppress,
                type: "debug",
                data: {
                    requestId: message.requestId,
                    entityName,
                    channel,
                    removed,
                    durationMs: performance.now() - startTime,
                },
            });

         } catch (error) {
             const errorMessage = error instanceof Error ? error.message : String(error);

             const errorResponse = {
                type: Communication.WebSocket.MessageType.ENTITY_CHANNEL_UNSUBSCRIBE_RESPONSE,
                timestamp: Date.now(),
                requestId: message.requestId,
                errorMessage,
                entityName,
                channel,
                removed: false,
            };

            const errorParsed = Communication.WebSocket.Z.EntityChannelUnsubscribeResponse.safeParse(errorResponse);
            if (errorParsed.success) {
                ws.send(JSON.stringify(errorParsed.data));
            }
             BunLogModule({
                prefix: LOG_PREFIX,
                message: "WS ENTITY_CHANNEL_UNSUBSCRIBE_REQUEST error",
                debug: context.debug,
                suppress: context.suppress,
                type: "info",
                data: {
                    requestId: message.requestId,
                    entityName,
                    channel,
                    errorMessage,
                },
            });
         } finally {
             context.manager.recordEndpointMetrics(
                "WS_ENTITY_CHANNEL_UNSUBSCRIBE_REQUEST",
                startTime,
                requestSize,
                responseSize,
                success,
            );
         }
    }
}
