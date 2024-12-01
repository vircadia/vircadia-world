import { startBunScriptBundleService } from "./service/bun_script_bundle";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { type Engine, NullEngine, Scene } from "@babylonjs/core";
import { VircadiaConfig_Client } from "../../../sdk/vircadia-world-sdk-ts/config/vircadia.client.config";
import type { Database } from "../../../sdk/vircadia-world-sdk-ts/schema/schema.database";
import type { Script } from "../../../sdk/vircadia-world-sdk-ts/schema/schema.general";
import { log } from "../../../sdk/vircadia-world-sdk-ts/module/general/log";

let supabase: SupabaseClient<Database, "public"> | null = null;
let scene: Scene | null = null;
let seedScripts: {
    seedScriptRow: Database["public"]["Tables"]["seed_scripts"]["Row"];
    entityScriptRow:
        | Database["public"]["Tables"]["entity_scripts"]["Row"]
        | null;
    executionResult: {
        success: boolean;
        error: string | null;
        result: any | null;
        timestamp: string;
    } | null;
}[] = [];

async function createHeadlessEngine(): Promise<Engine> {
    return new NullEngine();
}

async function connect(url: string, key: string): Promise<SupabaseClient> {
    try {
        supabase = createClient(url, key, {
            auth: {
                persistSession: false,
                flowType: "pkce",
                detectSessionInUrl: false,
                autoRefreshToken: false,
            },
        });
        supabase.realtime.connect();

        log({
            message: `World connected successfully [${url}]`,
            type: "info",
        });

        return supabase;
    } catch (error) {
        log({
            message: `Failed to connect to world [${url}]: ${error}`,
            type: "error",
        });
        await destroy();
        throw error;
    }
}

async function loadSeedScripts() {
    if (!supabase) return;

    const { data, error } = await supabase
        .from("seed_scripts")
        .select(`
            general__seed_id,
            general__script_id,
            general__order,
            general__is_active,
            general__created_at,
            general__created_by,
            general__updated_at,
            entity_scripts (
                general__script_id,
                compiled__web__node__script,
                compiled__web__node__script_sha256,
                compiled__web__node__script_status,
                compiled__web__bun__script,
                compiled__web__bun__script_sha256,
                compiled__web__bun__script_status,
                compiled__web__browser__script,
                compiled__web__browser__script_sha256,
                compiled__web__browser__script_status,
                source__git__repo_entry_path,
                source__git__repo_url,
                general__created_at,
                general__updated_at,
                general__created_by,
                permissions__roles__view,
                permissions__roles__full
            )
        `)
        .eq("general__is_active", true)
        .order("general__order");

    if (error) {
        throw error;
    }

    seedScripts = data.map((seedScript) => ({
        seedScriptRow: {
            general__seed_id: seedScript.general__seed_id,
            general__script_id: seedScript.general__script_id,
            general__order: seedScript.general__order,
            general__is_active: seedScript.general__is_active,
            general__created_at: seedScript.general__created_at,
            general__created_by: seedScript.general__created_by,
            general__updated_at: seedScript.general__updated_at,
        },
        entityScriptRow: seedScript.entity_scripts
            ? seedScript.entity_scripts
            : null,
        executionResult: null,
    }));
}

async function executeSeedScripts(
    platform: "bun" | "node" | "browser",
): Promise<void> {
    if (!seedScripts.length) {
        log({
            message: "No seed scripts to execute",
            type: "info",
        });
        return;
    }

    for (const seedScript of seedScripts) {
        try {
            if (!supabase) {
                throw new Error("World not connected");
            }

            if (!scene) {
                throw new Error("Scene not found");
            }

            if (!seedScript.entityScriptRow) {
                throw new Error("No entity script found for execution");
            }

            let script: string | null = null;
            if (platform === "browser") {
                script =
                    seedScript.entityScriptRow.compiled__web__browser__script;
            } else if (platform === "node") {
                script = seedScript.entityScriptRow.compiled__web__node__script;
            } else if (platform === "bun") {
                script = seedScript.entityScriptRow.compiled__web__bun__script;
            }

            if (!script) {
                throw new Error(`No ${platform} script found for execution`);
            }

            const wrappedScript = `
                return function(context) {
                    with (context) {
                        ${script}
                    }
                };`;

            const scriptFunction = new Function(wrappedScript)();
            if (typeof scriptFunction !== "function") {
                throw new Error(
                    "Failed to create a valid function from the script",
                );
            }

            const context: Script.Babylon.I_Context = {
                Vircadia: {
                    WorldClient: supabase,
                    WorldScene: scene,
                    Meta: {
                        isRunningOnClient: true,
                        isRunningOnWorld: false,
                    },
                },
            };

            const result = await Promise.resolve(scriptFunction(context));
            seedScript.executionResult = {
                success: true,
                result,
                error: null,
                timestamp: new Date().toISOString(),
            };
        } catch (error) {
            log({
                message: `Error executing seed script ${seedScript.seedScriptRow.general__script_id}: ${error}`,
                type: "error",
                debug: true,
            });
            seedScript.executionResult = {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                result: null,
                timestamp: new Date().toISOString(),
            };
        }
    }
}

async function destroy() {
    try {
        if (supabase) {
            await supabase.auth.signOut();
            await supabase.removeAllChannels();
            supabase.realtime.disconnect();
            supabase = null;
        }

        scene?.dispose();
        scene = null;

        log({
            message: "World destroyed successfully",
            type: "info",
        });
    } catch (error) {
        log({
            message: `Error destroying world: ${error}`,
            type: "error",
        });
        throw error;
    }
}

async function initializeClientCore() {
    try {
        const engine = await createHeadlessEngine();
        scene = new Scene(engine);

        await connect(
            VircadiaConfig_Client.defaultWorldSupabaseUrl,
            VircadiaConfig_Client.defaultWorldSupabaseAnonKey,
        );

        // Optional login if credentials are provided
        if (
            VircadiaConfig_Client.defaultWorldAccountUsername &&
            VircadiaConfig_Client.defaultWorldAccountPassword &&
            supabase
        ) {
            await supabase.auth
                .signInWithPassword({
                    email: VircadiaConfig_Client.defaultWorldAccountUsername,
                    password:
                        VircadiaConfig_Client.defaultWorldAccountPassword,
                })
                .catch((error) => {
                    log({
                        message: `Failed to login to world: ${error}`,
                        type: "error",
                    });
                    throw error;
                });
        }

        log({
            message: "Client core initialized successfully",
            type: "info",
        });
        return supabase;
    } catch (error) {
        log({
            message: `Failed to initialize client core: ${error}`,
            type: "error",
        });
        throw error;
    }
}

// Initialize and start services
async function startServices() {
    try {
        await initializeClientCore();

        if (!supabase) {
            throw new Error("Client core not initialized");
        }

        // Load seed scripts
        await loadSeedScripts();

        // Start the Bun Script Bundle Service
        await startBunScriptBundleService({
            debug: true,
            worldClient: supabase,
        });

        log({
            message: "All services started successfully",
            type: "info",
        });
    } catch (error) {
        log({
            message: `Failed to start services: ${
                error instanceof Error ? error.message : JSON.stringify(error)
            }`,
            type: "error",
        });
    }
}

startServices();
