
import type { ServerWebSocket } from "bun";
import { BunLogModule } from "../../../../../../sdk/vircadia-world-sdk-ts/bun/src/module/vircadia.common.bun.log.module";
import { Communication } from "../../../../../../sdk/vircadia-world-sdk-ts/schema/src/vircadia.schema.general";
import type { IMessageHandler, IWorldApiWsContext } from "./message.handler.interface";
import type { WorldSession, WebSocketData } from "../world.api.ws.manager";

const LOG_PREFIX = "ReflectHandler";

export class ReflectMessageHandler implements IMessageHandler {
    async handle(
        ws: ServerWebSocket<WebSocketData>,
        session: WorldSession,
        message: Communication.WebSocket.Message,
        context: IWorldApiWsContext
    ): Promise<void> {
        const typedRequest = message as Communication.WebSocket.ReflectPublishRequestMessage;
        
        // App-Layer Permission Check (Can Agent Update SyncGroup?)
        if (!context.aclService.canUpdate(session.agentId, typedRequest.syncGroup)) {
             // Access denied - silently drop or maybe send error? 
             // Existing implementation drops it but maybe logs?
             // We'll log a warning
             BunLogModule({
                prefix: LOG_PREFIX,
                message: `Reflect publish denied for ${session.agentId} to ${typedRequest.syncGroup}`,
                type: "warn",
                debug: context.debug,
                suppress: context.suppress
             });
             return;
        }

        // Queue for tick-based delivery
        context.manager.enqueueReflect(
            typedRequest.syncGroup,
            typedRequest.channel,
            session.sessionId,
            JSON.stringify({
                type: Communication.WebSocket.MessageType.REFLECT_MESSAGE_DELIVERY,
                timestamp: Date.now(),
                requestId: typedRequest.requestId, // Pass through request ID for correlation if needed
                errorMessage: null,
                syncGroup: typedRequest.syncGroup,
                channel: typedRequest.channel,
                fromSessionId: session.sessionId,
                payload: typedRequest.payload,
            } as Communication.WebSocket.ReflectDeliveryMessage),
            typedRequest.requestAcknowledgement ? typedRequest.requestId : undefined
        );
    }
}
