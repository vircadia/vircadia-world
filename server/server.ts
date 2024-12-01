import { PocketBaseManager } from "./modules/pocketbase/pocketbase_manager.ts";
import { log } from "../sdk/vircadia-world-sdk-ts/module/general/log.ts";
import { VircadiaConfig_Server } from "./vircadia.config.server.ts";

// Services
import { WorldTickManager } from "./service/world-tick-manager.ts";
import { WorldActionManager } from "./service/world-action-manager.ts";

const config = VircadiaConfig_Server;

async function init() {
    const debugMode = config.debug;

    if (debugMode) {
        log({ message: "Server debug mode enabled", type: "info" });
    }

    log({ message: "Starting Vircadia World Server", type: "info" });

    await startPocketBase(debugMode);
    await startBunServer(debugMode);
    // await startServices(debugMode);
}

let worldTickManager: WorldTickManager | null = null;
let worldActionManager: WorldActionManager | null = null;

async function startServices(debugMode: boolean) {
    log({ message: "Starting world services", type: "info" });

    try {
        const pocketbase = PocketBaseManager.getInstance(debugMode);
        const pocketbaseClient = pocketbase.getClient();

        if (!pocketbaseClient) {
            throw new Error("PocketBase admin client not initialized");
        }

        // Initialize frame capture service with existing client
        worldTickManager = new WorldTickManager(pocketbaseClient, debugMode);

        await worldTickManager.initialize();
        worldTickManager.start();

        // Initialize action manager with existing client
        worldActionManager = new WorldActionManager(pocketbaseClient, debugMode);

        await worldActionManager.initialize();
        worldActionManager.start();

        log({
            message: "World frame capture service started successfully",
            type: "success",
        });
    } catch (error) {
        log({
            message: `Failed to start world services: ${JSON.stringify(error)}`,
            type: "error",
        });
        process.exit(1);
    }
}

async function startPocketBase(debugMode: boolean) {
    log({ message: "Starting PocketBase", type: "info" });

    const pocketbase = PocketBaseManager.getInstance(debugMode);
    await pocketbase.initializeAndStart();
}

async function startBunServer(debugMode: boolean) {
    log({ message: "Starting Bun HTTP server", type: "info" });

    const host = config.serverHost;
    const port = config.serverPort;

    const server = Bun.serve({
        port,
        hostname: host,
        development: debugMode,
        fetch: async (req) => {
            return new Response("Not Found", { status: 404 });
        },
    });

    log({
        message: `Bun HTTP server running at http://${host}:${port}`,
        type: "success",
    });
}

await init();
