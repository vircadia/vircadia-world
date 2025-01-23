import { VircadiaConfig_Server } from "../sdk/vircadia-world-sdk-ts/config/vircadia.config.ts";
import { log } from "../sdk/vircadia-world-sdk-ts/module/general/log.ts";
import { PostgresClient } from "./database/postgres/postgres_client.ts";
import { WorldTickManager } from "./service/world-tick-manager.ts";
import { WorldApiManager } from "./service/world-api-manager.ts";
import { WorldScriptManager } from "./service/world-script-manager.ts";

const config = VircadiaConfig_Server;
let worldTickManager: WorldTickManager | null = null;
let worldScriptManager: WorldScriptManager | null = null;
let worldApiManager: WorldApiManager | null = null;

async function init() {
    const debugMode = config.debug;

    if (debugMode) {
        log({ message: "Server debug mode enabled", type: "info" });
    }

    log({ message: "Starting Vircadia World Server", type: "info" });

    try {
        // ===== Database Initialization =====
        log({ message: "Initializing database client", type: "info" });
        const postgresClient = PostgresClient.getInstance(debugMode);
        await postgresClient.initialize(config.postgres);

        // ===== World Services =====
        log({ message: "Starting world services", type: "info" });

        // Initialize world tick manager
        worldTickManager = new WorldTickManager(
            postgresClient.getClient(),
            debugMode,
        );
        await worldTickManager.initialize();
        worldTickManager.start();

        // Initialize world script manager
        worldScriptManager = new WorldScriptManager(
            postgresClient.getClient(),
            debugMode,
        );
        await worldScriptManager.initialize();

        // Initialize world api manager
        worldApiManager = new WorldApiManager(
            postgresClient.getClient(),
            debugMode,
            config,
        );
        await worldApiManager.initialize();
    } catch (error) {
        log({
            message: "Server initialization failed",
            type: "error",
            error: error,
        });
        process.exit(1);
    }
}

// Add global error handlers
process.on("unhandledRejection", (reason, promise) => {
    log({
        message: "Unhandled Promise Rejection",
        type: "error",
        error: reason,
    });
});

process.on("uncaughtException", (error) => {
    log({
        message: "Uncaught Exception",
        type: "error",
        error: error,
    });
    process.exit(1);
});

await init();
