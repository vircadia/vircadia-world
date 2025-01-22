import { VircadiaConfig_Server } from "../sdk/vircadia-world-sdk-ts/config/vircadia.config.ts";
import { log } from "../sdk/vircadia-world-sdk-ts/module/general/log.ts";
import { PostgresClient } from "./database/postgres/postgres_client.ts";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { WorldTickManager } from "./service/world-tick-manager.ts";
import { WorldApiManager } from "./service/world-api-manager.ts";
import { WorldScriptManager } from "./service/world-script-manager.ts";

const config = VircadiaConfig_Server;
let worldTickManager: WorldTickManager | null = null;
let worldScriptManager: WorldScriptManager | null = null;
let worldApiManager: WorldApiManager | null = null;

async function init() {
    const debugMode = config.debug;
    const app = new Hono();

    // Add middleware
    app.use("*", logger());

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
            app,
            debugMode,
        );
        await worldApiManager.initialize();

        // ===== HTTP Server =====
        log({ message: "Starting Bun HTTP server", type: "info" });
        // Start HTTP server with Hono
        const bunServer = Bun.serve({
            port: config.serverPort,
            hostname: config.serverHost,
            development: debugMode,
            fetch: app.fetch,
        });

        log({
            message: `Bun HTTP server running at http://${config.serverHost}:${config.serverPort}`,
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
