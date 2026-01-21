
import type { Server, ServerWebSocket, SQL } from "bun";
import type { Sql } from "postgres";
import { AclService } from "../../../../../../sdk/vircadia-world-sdk-ts/bun/src/module/vircadia.server.auth.module";
import { Communication } from "../../../../../../sdk/vircadia-world-sdk-ts/schema/src/vircadia.schema.general";
import { WorldApiWsManager, type WorldSession, type WebSocketData } from "../world.api.ws.manager";

export interface IWorldApiWsContext {
    manager: WorldApiWsManager;
    server: Server<WebSocketData>;
    superUserSql: SQL;
    proxyUserSql: SQL;
    legacySuperUserSql: Sql;
    aclService: AclService;
    debug: boolean;
    suppress: boolean;
}

export interface IMessageHandler {
    handle(
        ws: ServerWebSocket<WebSocketData>,
        session: WorldSession,
        message: Communication.WebSocket.Message,
        context: IWorldApiWsContext
    ): Promise<void>;
}
