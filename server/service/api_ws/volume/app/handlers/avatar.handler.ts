
import type { ServerWebSocket } from "bun";
import { BunLogModule } from "../../../../../../sdk/vircadia-world-sdk-ts/bun/src/module/vircadia.common.bun.log.module";
import { Communication } from "../../../../../../sdk/vircadia-world-sdk-ts/schema/src/vircadia.schema.general";
import { Avatar } from "../../../../../../sdk/vircadia-world-sdk-ts/schema/src/vircadia.schema.avatar";
import type { IMessageHandler, IWorldApiWsContext } from "./message.handler.interface";
import type { WorldSession, WebSocketData } from "../world.api.ws.manager";

const LOG_PREFIX = "AvatarHandler";

export class AvatarMessageHandler implements IMessageHandler {
    async handle(
        ws: ServerWebSocket<WebSocketData>,
        session: WorldSession,
        message: Communication.WebSocket.Message,
        context: IWorldApiWsContext
    ): Promise<void> {
        // Cast type to any to avoid enum union issues during refactor
        switch (message.type as any) {
             case Communication.WebSocket.AvatarMessageType.AVATAR_SET_REQUEST:
                await this.handleAvatarSet(ws, session, message as unknown as Avatar.AvatarSetRequestMessage, context);
                break;
             case Communication.WebSocket.AvatarMessageType.AVATAR_QUERY_REQUEST:
                await this.handleAvatarQuery(ws, session, message as unknown as Avatar.AvatarQueryRequestMessage, context);
                break;
        }
    }

    private async handleAvatarSet(
        ws: ServerWebSocket<WebSocketData>,
        session: WorldSession,
        message: Avatar.AvatarSetRequestMessage,
        context: IWorldApiWsContext
    ) {
        // Permission check
        if (!context.aclService.canUpdate(session.agentId, message.syncGroup)) {
             // respond with error
             ws.send(JSON.stringify(new Avatar.AvatarSetResponseMessage({
                 requestId: message.requestId,
                 success: false,
                 errorMessage: "Permission denied"
             })));
             return;
        }

        // Update logic: route to GameLoopManager
        const gameLoop = context.manager.getGameLoop(message.syncGroup);
        if (gameLoop) {
            gameLoop.updateAvatar(session.agentId, message.avatarData);
            
            ws.send(JSON.stringify(new Avatar.AvatarSetResponseMessage({
                requestId: message.requestId,
                success: true
            })));
        } else {
             ws.send(JSON.stringify(new Avatar.AvatarSetResponseMessage({
                requestId: message.requestId,
                success: false,
                errorMessage: "Game loop not found for sync group"
            })));
        }
    }

    private async handleAvatarQuery(
        ws: ServerWebSocket<WebSocketData>,
        session: WorldSession,
        message: Avatar.AvatarQueryRequestMessage,
        context: IWorldApiWsContext
    ) {
        if (!context.aclService.canRead(session.agentId, message.syncGroup)) {
             ws.send(JSON.stringify(new Avatar.AvatarQueryResponseMessage({
                 requestId: message.requestId,
                 success: false,
                 avatars: [],
                 errorMessage: "Permission denied"
             })));
             return;
        }

        const gameLoop = context.manager.getGameLoop(message.syncGroup);
        if (gameLoop) {
            const avatars = gameLoop.getAvatars();
            ws.send(JSON.stringify(new Avatar.AvatarQueryResponseMessage({
                requestId: message.requestId,
                success: true,
                avatars
            })));
        } else {
             ws.send(JSON.stringify(new Avatar.AvatarQueryResponseMessage({
                requestId: message.requestId,
                success: false,
                avatars: [],
                errorMessage: "Game loop not found"
            })));
        }
    }
}
