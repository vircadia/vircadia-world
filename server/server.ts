import { parseArgs } from "node:util";
import { Supabase } from "./modules/supabase/supabase_manager.ts";
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

    await startSupabase(debugMode);
    await startBunServer(debugMode);
    await startServices(debugMode);
}

let worldTickManager: WorldTickManager | null = null;
let worldActionManager: WorldActionManager | null = null;

async function startServices(debugMode: boolean) {
    log({ message: "Starting world services", type: "info" });

    try {
        const supabase = Supabase.getInstance(debugMode);
        const supabaseClient = supabase.getAdminClient();

        if (!supabaseClient) {
            throw new Error("Supabase admin client not initialized");
        }

        // Initialize frame capture service with existing client
        worldTickManager = new WorldTickManager(supabaseClient, debugMode);

        await worldTickManager.initialize();
        worldTickManager.start();

        // Initialize action manager with existing client
        worldActionManager = new WorldActionManager(supabaseClient, debugMode);

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

async function startSupabase(debugMode: boolean) {
    log({ message: "Starting Supabase", type: "info" });
    if (debugMode) {
        log({ message: "Supabase debug mode enabled", type: "info" });
    }

    const supabase = Supabase.getInstance(debugMode);
    const forceRestart = config.forceRestartSupabase;
    const isRunning = await supabase.isRunning();

    if (!isRunning || forceRestart) {
        try {
            await supabase.initializeAndStart({
                forceRestart: forceRestart,
            });
        } catch (error) {
            log({
                message: `Failed to initialize and start Supabase: ${error}`,
                type: "error",
            });
            await supabase.debugStatus();
        }

        if (!(await supabase.isRunning())) {
            log({
                message:
                    "Supabase services are not running after initialization. Exiting.",
                type: "error",
            });
            process.exit(1);
        }
    }

    try {
        await supabase.initializeAdminClient({
            apiUrl: config.supabaseUrl,
            serviceRoleKey: config.supabaseServiceRoleKey,
        });
    } catch (error) {
        log({
            message: `Failed to initialize admin client: ${error}`,
            type: "error",
        });
        process.exit(1);
    }

    log({ message: "Supabase services are running correctly.", type: "info" });
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
