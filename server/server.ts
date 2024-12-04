import { VircadiaConfig_Server } from "./vircadia.server.config.ts";
import { log } from "../sdk/vircadia-world-sdk-ts/module/general/log.ts";
import { PostgresClient } from "./database/postgres/postgres_client.ts";
import { WorldTickManager } from "./service/world-tick-manager.ts";
import { WorldActionManager } from "./service/world-action-manager.ts";
import { Hono } from "hono";
import { logger } from "hono/logger";

const config = VircadiaConfig_Server;
let worldTickManager: WorldTickManager | null = null;
let worldActionManager: WorldActionManager | null = null;

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
        worldTickManager = new WorldTickManager(postgresClient, debugMode);
        await worldTickManager.initialize();
        worldTickManager.addRoutes(app);
        worldTickManager.start();

        // Initialize world action manager
        worldActionManager = new WorldActionManager(postgresClient, debugMode);
        await worldActionManager.initialize();
        worldActionManager.addRoutes(app);
        worldActionManager.start();

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
