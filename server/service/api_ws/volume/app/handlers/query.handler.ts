
import type { ServerWebSocket } from "bun";
import { BunLogModule } from "../../../../../../sdk/vircadia-world-sdk-ts/bun/src/module/vircadia.common.bun.log.module";
import { Communication } from "../../../../../../sdk/vircadia-world-sdk-ts/schema/src/vircadia.schema.general";
import type { IMessageHandler, IWorldApiWsContext } from "./message.handler.interface";
import type { WorldSession, WebSocketData } from "../world.api.ws.manager";

const LOG_PREFIX = "QueryHandler";

export class QueryMessageHandler implements IMessageHandler {
    async handle(
        ws: ServerWebSocket<WebSocketData>,
        session: WorldSession,
        message: Communication.WebSocket.Message,
        context: IWorldApiWsContext
    ): Promise<void> {
        const typedRequest = message as Communication.WebSocket.QueryRequestMessage;
        const startTime = performance.now();
        const requestSize = new TextEncoder().encode(JSON.stringify(message)).length;
        let responseSize = 0;
        let success = false;
        const receivedAt = startTime; // Approximate

        try {
            await context.proxyUserSql?.begin(async (tx) => {
                // First set agent context
                await tx`SELECT auth.set_agent_context_from_agent_id(${session.agentId}::UUID)`;

                const results = await tx.unsafe(
                    typedRequest.query,
                    typedRequest.parameters || []
                );

                const responseData = {
                    type: Communication.WebSocket.MessageType.QUERY_RESPONSE,
                    timestamp: Date.now(),
                    requestId: typedRequest.requestId,
                    errorMessage: typedRequest.errorMessage,
                    result: results,
                };

                const responseParsed = Communication.WebSocket.Z.QueryResponse.safeParse(responseData);
                if (!responseParsed.success) {
                    throw new Error(`Invalid query response format: ${responseParsed.error.message}`);
                }

                const responseString = JSON.stringify(responseParsed.data);
                responseSize = new TextEncoder().encode(responseString).length;
                success = true;

                ws.send(responseString);
                
                BunLogModule({
                    prefix: LOG_PREFIX,
                    message: "WS QUERY_REQUEST handled",
                    debug: context.debug,
                    suppress: context.suppress,
                    type: "debug",
                    data: {
                        requestId: typedRequest.requestId,
                        durationMs: performance.now() - receivedAt,
                        requestSize,
                        responseSize,
                    },
                });
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);

            BunLogModule({
                message: `Query failed: ${errorMessage}`,
                debug: context.debug,
                suppress: context.suppress,
                type: "error",
                prefix: LOG_PREFIX,
                data: {
                    error,
                    query: typedRequest.query,
                },
            });

            const errorResponseData: Communication.WebSocket.QueryResponseMessage = {
                type: Communication.WebSocket.MessageType.QUERY_RESPONSE,
                timestamp: Date.now(),
                requestId: typedRequest.requestId,
                errorMessage,
                result: [],
            };

            const errorResponseParsed = Communication.WebSocket.Z.QueryResponse.safeParse(errorResponseData);
            if (!errorResponseParsed.success) {
                // Should not happen if we construct it correctly, but safety first
                 ws.send(JSON.stringify(errorResponseData));
            } else {
                 const errorResponseString = JSON.stringify(errorResponseParsed.data);
                responseSize = new TextEncoder().encode(errorResponseString).length;
                ws.send(errorResponseString);
            }
            success = false;

             BunLogModule({
                prefix: LOG_PREFIX,
                message: "WS QUERY_REQUEST error",
                debug: context.debug,
                suppress: context.suppress,
                type: "info",
                data: {
                    requestId: typedRequest.requestId,
                    durationMs: performance.now() - receivedAt,
                    requestSize,
                    responseSize,
                    errorMessage,
                },
            });
        } finally {
            // We can't easily record metrics back to the manager without exposing a method on context or manager
            // For now, metrics recording is skipped or needs to be added to context interface
             context.manager.recordEndpointMetrics(
                 "WS_QUERY_REQUEST",
                 startTime,
                 requestSize,
                 responseSize,
                 success
             );
        }
    }
}
