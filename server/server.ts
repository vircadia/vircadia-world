import { VircadiaConfig_Server } from "../sdk/vircadia-world-sdk-ts/config/vircadia.config.ts";
import { log } from "../sdk/vircadia-world-sdk-ts/module/general/log.ts";
import { PostgresClient } from "./database/postgres/postgres_client.ts";
import { WorldTickCaptureManager } from "./service/world-tick-capture-manager.ts";
import { WorldApiManager } from "./service/world-api-manager.ts";
import { WorldWebScriptManager } from "./service/world-web-script-manager.ts";

const config = VircadiaConfig_Server;
let worldTickCaptureManager: WorldTickCaptureManager | null = null;
let worldWebScriptManager: WorldWebScriptManager | null = null;
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
        worldTickCaptureManager = new WorldTickCaptureManager(
            postgresClient.getClient(),
            debugMode,
        );
        await worldTickCaptureManager.initialize();
        worldTickCaptureManager.start();

        // Initialize world script manager
        worldWebScriptManager = new WorldWebScriptManager(
            postgresClient.getClient(),
            debugMode,
        );
        await worldWebScriptManager.initialize();

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
