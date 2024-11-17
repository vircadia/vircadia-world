import { parseArgs } from "node:util";
import { Supabase } from "./modules/supabase/supabase_manager.ts";
import { log } from "../sdk/vircadia-world-sdk-ts/module/general/log.ts";
import { Config } from "../sdk/vircadia-world-sdk-ts/schema/schema.ts";

// Services
import { WorldTickManager } from "./service/world-tick-manager.ts";

const config = loadConfig();

async function init() {
    const debugMode = config[Config.E_SERVER_CONFIG.DEBUG];

    if (debugMode) {
        log({ message: "Server debug mode enabled", type: "info" });
    }

    log({ message: "Starting Vircadia World Server", type: "info" });

    await startSupabase(debugMode);
    await startBunServer(debugMode);
    await startServices(debugMode);
}

let worldTickManager: WorldTickManager | null = null;

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

        log({
            message: "World frame capture service started successfully",
            type: "success",
        });
    } catch (error) {
        log({
            message: `Failed to start world services: ${error}`,
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
    const forceRestart = config[Config.E_SERVER_CONFIG.FORCE_RESTART_SUPABASE];
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
        await supabase.initializeAdminClient();
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

    const host = config[Config.E_SERVER_CONFIG.INTERNAL_SERVER_HOST];
    const port = config[Config.E_SERVER_CONFIG.INTERNAL_SERVER_PORT];

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

export function loadConfig(): {
    [Config.E_SERVER_CONFIG.DEBUG]: boolean;
    [Config.E_SERVER_CONFIG.INTERNAL_SERVER_PORT]: number;
    [Config.E_SERVER_CONFIG.INTERNAL_SERVER_HOST]: string;
    [Config.E_SERVER_CONFIG.FORCE_RESTART_SUPABASE]: boolean;
} {
    const args = parseArgs({
        args: process.argv.slice(2),
        options: {
            [Config.E_SERVER_ARGUMENT.DEBUG]: { type: "boolean" },
            [Config.E_SERVER_ARGUMENT.INTERNAL_SERVER_PORT]: { type: "string" },
            [Config.E_SERVER_ARGUMENT.INTERNAL_SERVER_HOST]: { type: "string" },
            [Config.E_SERVER_ARGUMENT.FORCE_RESTART_SUPABASE]: {
                type: "boolean",
            },
        },
    });

    const debugMode =
        process.env[Config.E_SERVER_CONFIG.DEBUG] === "true" ||
        args.values[Config.E_SERVER_ARGUMENT.DEBUG] ||
        false;

    const serverPort = Number.parseInt(
        process.env[Config.E_SERVER_CONFIG.INTERNAL_SERVER_PORT] ||
            args.values[
                Config.E_SERVER_ARGUMENT.INTERNAL_SERVER_PORT
            ]?.toString() ||
            "3020",
    );

    const serverHost =
        process.env[Config.E_SERVER_CONFIG.INTERNAL_SERVER_HOST] ||
        args.values[Config.E_SERVER_ARGUMENT.INTERNAL_SERVER_HOST] ||
        "localhost";

    const forceRestartSupabase =
        process.env[Config.E_SERVER_CONFIG.FORCE_RESTART_SUPABASE] === "true" ||
        args.values[Config.E_SERVER_ARGUMENT.FORCE_RESTART_SUPABASE] ||
        false;

    return {
        [Config.E_SERVER_CONFIG.DEBUG]: debugMode,
        [Config.E_SERVER_CONFIG.INTERNAL_SERVER_PORT]: serverPort,
        [Config.E_SERVER_CONFIG.INTERNAL_SERVER_HOST]: serverHost,
        [Config.E_SERVER_CONFIG.FORCE_RESTART_SUPABASE]: forceRestartSupabase,
    };
}
