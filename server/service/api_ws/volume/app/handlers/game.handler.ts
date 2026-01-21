
import type { ServerWebSocket } from "bun";
import { Communication } from "../../../../../../sdk/vircadia-world-sdk-ts/schema/src/vircadia.schema.general";
import type { IMessageHandler, IWorldApiWsContext } from "./message.handler.interface";
import type { WorldSession, WebSocketData } from "../world.api.ws.manager";

export class GameMessageHandler implements IMessageHandler {
    async handle(
        ws: ServerWebSocket<WebSocketData>,
        session: WorldSession,
        message: Communication.WebSocket.Message,
        context: IWorldApiWsContext
    ): Promise<void> {
        const typedRequest = message as Communication.WebSocket.GameInputMessage;

        // Route to the appropriate Game Loop based on user's current context
        // For now, we assume 1:1 sync group or determine it from session state?
        // Since GameInput doesn't carry syncGroup, we might need to find it from avatar/session.
        // However, GameLoopManager in the monolithic file didn't seem to fully wire this up yet either.
        // We will assume "default" or try to find where the user is.
        // But looking at WorldApiWsManager, it has `gameLoops: Map<string, GameLoopManager>`.
        // We need to know which loop to send it to.
        
        // Strategy: iterate all loops and check if agent is there? Or just broadcast to 'global' if applicable?
        // The original code stub for handleInput was inside GameLoopManager.
        // Here we need to find the right GameLoopManager instance.

        // For MVP refactor, we can iterate all game loops and try to handle it.
        // Ideally, session should track its current syncGroup.
        
        // We will expose a method on WorldApiWsManager to route input.
        context.manager.routeGameInput(session, typedRequest);
    }
}
