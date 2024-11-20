import { startBunScriptBundleService } from "./service/bun_script_bundle";
import { ClientCore } from "../client_core";
import { ClientCore__VircadiaConfig } from "../client_core/vircadia.client.config";
import { type Engine, NullEngine, Scene } from "@babylonjs/core";

let worldClient: ClientCore | null = null;

async function createHeadlessEngine(): Promise<Engine> {
    // Directly create and return NullEngine
    return new NullEngine();
}

async function initializeClientCore() {
    try {
        const engine = await createHeadlessEngine();
        const scene = new Scene(engine);

        worldClient = new ClientCore({
            url: ClientCore__VircadiaConfig.defaultWorldSupabaseUrl,
            key: ClientCore__VircadiaConfig.defaultWorldSupabaseAnonKey,
            scene: scene,
            email:
                ClientCore__VircadiaConfig.defaultWorldAccountUsername ??
                undefined,
            password:
                ClientCore__VircadiaConfig.defaultWorldAccountPassword ??
                undefined,
        });

        console.log("Client core initialized successfully");
        return worldClient;
    } catch (error) {
        console.error("Failed to initialize client core:", error);
        throw error;
    }
}

// Initialize and start services
async function startServices() {
    try {
        // Initialize client core
        await initializeClientCore();

        if (!worldClient) {
            throw new Error("Client core not initialized");
        }

        // Start the Bun Script Bundle Service
        await startBunScriptBundleService({
            debug: true,
            worldClient: worldClient,
        });

        console.log("All services started successfully");
    } catch (error) {
        console.error("Failed to start services:", error);
    }
}

startServices();
