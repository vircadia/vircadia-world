import { VircadiaConfig_Server } from "./vircadia.server.config.ts";
import { log } from "../sdk/vircadia-world-sdk-ts/module/general/log.ts";
import { SQLiteManager } from "./database/sqlite/sqlite_manager.ts";
import { WorldTickManager } from "./service/world-tick-manager.ts";
import { WorldActionManager } from "./service/world-action-manager.ts";
import { AuthManager } from "./auth/auth_manager.ts";

const config = VircadiaConfig_Server;
let worldTickManager: WorldTickManager | null = null;
let worldActionManager: WorldActionManager | null = null;

async function init() {
    const debugMode = config.debug;

    if (debugMode) {
        log({ message: "Server debug mode enabled", type: "info" });
    }

    log({ message: "Starting Vircadia World Server", type: "info" });

    try {
        // ===== Database Initialization =====
        log({ message: "Initializing database", type: "info" });
        const sqliteManager = SQLiteManager.getInstance(debugMode);
        sqliteManager.runMigrations();

        // ===== Auth Manager =====
        log({ message: "Initializing auth manager", type: "info" });
        const authManager = AuthManager.getInstance(debugMode);

        // ===== HTTP Server =====
        log({ message: "Starting Bun HTTP server", type: "info" });
        const server = Bun.serve({
            port: config.serverPort,
            hostname: config.serverHost,
            development: debugMode,
            fetch: async (req) => {
                return new Response("Not Found", { status: 404 });
            },
        });
        log({
            message: `Bun HTTP server running at http://${config.serverHost}:${config.serverPort}`,
            type: "success",
        });

        // ===== World Services =====
        log({ message: "Starting world services", type: "info" });

        // Initialize world tick manager
        worldTickManager = new WorldTickManager(debugMode);
        await worldTickManager.initialize();
        worldTickManager.start();

        // Initialize world action manager
        worldActionManager = new WorldActionManager(sqliteManager, debugMode);
        await worldActionManager.initialize();
        worldActionManager.start();

        log({
            message: "World services started successfully",
            type: "success",
        });
    } catch (error) {
        log({
            message: `Server initialization failed: ${JSON.stringify(error)}`,
            type: "error",
        });
        process.exit(1);
    }
}

await init();
