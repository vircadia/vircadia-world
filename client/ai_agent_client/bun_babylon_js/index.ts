import { config } from "../../client_core/babylon_js/vircadia.config";
import { createClient } from "@supabase/supabase-js";
import { startBunScriptBundleService } from "./service/bun_script_bundle";

// Create Supabase client
const supabase = createClient(
    config.defaultWorldSupabaseUrl,
    config.defaultWorldSupabaseAnonKey,
);

// Initialize and start services
async function startServices() {
    try {
        // Start the Bun Script Bundle Service
        await startBunScriptBundleService({
            debug: true,
            supabase,
        });

        console.log("All services started successfully");
    } catch (error) {
        console.error("Failed to start services:", error);
    }
}

startServices();
