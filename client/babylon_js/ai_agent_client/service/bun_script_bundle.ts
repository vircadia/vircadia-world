import type { SupabaseClient, RealtimeChannel } from "@supabase/supabase-js";
import { type BuildOutput, build } from "bun";
import { temporaryDirectory } from "tempy";
import { log } from "../../../../sdk/vircadia-world-sdk-ts/module/general/log";
import { World } from "../../../../sdk/vircadia-world-sdk-ts/schema/schema";
import type { ClientCore } from "../../client_core";

// Helper function to clone and prepare git repos
async function prepareGitRepo(
    repoUrl: string,
    entryPath: string,
): Promise<string> {
    const tempDir = temporaryDirectory();

    try {
        const clone = Bun.spawn(["git", "clone", repoUrl, tempDir], {
            stdout: "inherit",
            stderr: "inherit",
        });

        const cloneSuccess = await clone.exited;
        if (cloneSuccess !== 0) {
            throw new Error(`Failed to clone repository: ${repoUrl}`);
        }

        // Add bun install after cloning
        const install = Bun.spawn(["bun", "install"], {
            cwd: tempDir,
            stdout: "inherit",
            stderr: "inherit",
        });

        const installSuccess = await install.exited;
        if (installSuccess !== 0) {
            throw new Error(
                `Failed to install dependencies for repository: ${repoUrl}`,
            );
        }

        return `${tempDir}/${entryPath}`;
    } catch (error) {
        log({
            message: `Error cloning repository ${repoUrl}: ${error}`,
            type: "error",
        });
        throw error;
    }
}

async function compileScript(path: string, debugMode: boolean) {
    try {
        log({
            message: `Attempting to compile script at path: ${path}`,
            type: "info",
            debug: debugMode,
        });
        const results: BuildOutput[] = await Promise.all([
            build({ entrypoints: [path], target: "node" }),
            build({ entrypoints: [path], target: "browser" }),
            build({ entrypoints: [path], target: "bun" }),
        ]);

        // Log build results
        results.forEach((result, index) => {
            const target = ["node", "browser", "bun"][index];
            log({
                message: `Build result for ${target}: ${result.success}`,
                type: "info",
                debug: debugMode,
            });
            if (!result.success) {
                log({
                    message: `Build errors for ${target}: ${result.logs}`,
                    type: "error",
                    debug: debugMode,
                });
            }
        });

        if (results[0].success && results[1].success && results[2].success) {
            // Make sure we're awaiting all text() promises
            const [nodeCode, browserCode, bunCode] = await Promise.all([
                results[0].outputs[0].text(),
                results[1].outputs[0].text(),
                results[2].outputs[0].text(),
            ]);

            // Calculate SHA256 hashes for each compiled script
            const nodeHash = Bun.hash(nodeCode).toString();
            const browserHash = Bun.hash(browserCode).toString();
            const bunHash = Bun.hash(bunCode).toString();

            return {
                compiled_node_script: nodeCode,
                compiled_node_script_sha256: nodeHash,
                compiled_node_script_status:
                    World.Babylon.Script.E_CompilationStatus.COMPILED,
                compiled_browser_script: browserCode,
                compiled_browser_script_sha256: browserHash,
                compiled_browser_script_status:
                    World.Babylon.Script.E_CompilationStatus.COMPILED,
                compiled_bun_script: bunCode,
                compiled_bun_script_sha256: bunHash,
                compiled_bun_script_status:
                    World.Babylon.Script.E_CompilationStatus.COMPILED,
            };
        }

        return {
            compiled_node_script_status:
                World.Babylon.Script.E_CompilationStatus.FAILED,
            compiled_browser_script_status:
                World.Babylon.Script.E_CompilationStatus.FAILED,
            compiled_bun_script_status:
                World.Babylon.Script.E_CompilationStatus.FAILED,
            error: "One or more builds failed",
            build_logs: results.map((r) => r.logs),
        };
    } catch (error) {
        log({
            message: `Error bundling script ${path}: ${error}`,
            type: "error",
            debug: debugMode,
        });
        return {
            compiled_node_script_status:
                World.Babylon.Script.E_CompilationStatus.FAILED,
            compiled_browser_script_status:
                World.Babylon.Script.E_CompilationStatus.FAILED,
            compiled_bun_script_status:
                World.Babylon.Script.E_CompilationStatus.FAILED,
            error: `Bundling error: ${error.message}`,
            ...(debugMode && { stack: error.stack }),
        };
    }
}

async function handleEntityChange(
    payload: any,
    debug: boolean,
    supabase: SupabaseClient,
) {
    // Log the incoming payload for debugging
    log({
        message: `Received entity change: ${JSON.stringify(payload, null, 2).substring(0, 100)}`,
        type: "info",
        debug: debug,
    });

    if (payload.eventType === "DELETE") return;

    const entity = payload.new;
    const oldEntity = payload.old;

    const needsCompilation = checkIfCompilationNeeded(entity);

    // For debugging, log why we're proceeding or not
    log({
        message: `Entity ${entity.general__uuid} needs compilation: ${needsCompilation}`,
        type: "info",
        debug: debug,
    });

    if (!needsCompilation) return;

    try {
        const compiledLocalScripts: World.Babylon.Script.I_BABYLON_SCRIPT_SOURCE[] =
            [];
        const compiledPersistentScripts: World.Babylon.Script.I_BABYLON_SCRIPT_SOURCE[] =
            [];

        // Handle local scripts
        if (Array.isArray(entity.babylonjs__script_local_scripts)) {
            for (const script of entity.babylonjs__script_local_scripts) {
                if (script.source__git__repo_url && script.source__git__repo_entry_path) {
                    const scriptPath = await prepareGitRepo(
                        script.source__git__repo_url,
                        script.source__git__repo_entry_path,
                    );
                    const compiled = await compileScript(scriptPath, debug);
                    compiledLocalScripts.push({
                        source__git__repo_url: script.source__git__repo_url,
                        source__git__repo_entry_path: script.source__git__repo_entry_path,
                        compiled_browser_script:
                            compiled.compiled_browser_script,
                        compiled_browser_script_sha256:
                            compiled.compiled_browser_script_sha256,
                        compiled_browser_script_status:
                            compiled.compiled_browser_script_status,
                        compiled_bun_script: compiled.compiled_bun_script,
                        compiled_bun_script_sha256:
                            compiled.compiled_bun_script_sha256,
                        compiled_bun_script_status:
                            compiled.compiled_bun_script_status,
                        compiled_node_script: compiled.compiled_node_script,
                        compiled_node_script_sha256:
                            compiled.compiled_node_script_sha256,
                        compiled_node_script_status:
                            compiled.compiled_node_script_status,
                    });
                }
            }
        }

        // Handle persistent scripts
        if (Array.isArray(entity.babylonjs__script_persistent_scripts)) {
            for (const script of entity.babylonjs__script_persistent_scripts) {
                if (script.source__git__repo_url && script.source__git__repo_entry_path) {
                    const scriptPath = await prepareGitRepo(
                        script.source__git__repo_url,
                        script.source__git__repo_entry_path,
                    );
                    const compiled = await compileScript(scriptPath, debug);
                    compiledPersistentScripts.push({
                        source__git__repo_url: script.source__git__repo_url,
                        source__git__repo_entry_path: script.source__git__repo_entry_path,
                        compiled_node_script: compiled.compiled_node_script,
                        compiled_node_script_sha256:
                            compiled.compiled_node_script_sha256,
                        compiled_node_script_status:
                            compiled.compiled_node_script_status,
                        compiled_browser_script:
                            compiled.compiled_browser_script,
                        compiled_browser_script_sha256:
                            compiled.compiled_browser_script_sha256,
                        compiled_browser_script_status:
                            compiled.compiled_browser_script_status,
                        compiled_bun_script: compiled.compiled_bun_script,
                        compiled_bun_script_sha256:
                            compiled.compiled_bun_script_sha256,
                        compiled_bun_script_status:
                            compiled.compiled_bun_script_status,
                    });
                }
            }
        }

        // Update the entity with compiled scripts
        const { error } = await supabase
            .from("entities")
            .update({
                babylonjs__script_local_scripts: compiledLocalScripts.map(
                    (script) => ({
                        ...script,
                    }),
                ),
                babylonjs__script_persistent_scripts:
                    compiledPersistentScripts.map((script) => ({
                        ...script,
                    })),
            })
            .eq("general__uuid", entity.general__uuid);

        if (error) {
            log({
                message: "Error updating entity with compiled scripts:",
                type: "error",
                debug: debug,
            });
        }
    } catch (error) {
        log({
            message: `Error processing scripts for entity: ${entity.general__uuid}`,
            type: "error",
            debug: debug,
        });
    }
}

function checkIfCompilationNeeded(entity: any): boolean {
    const verifyScriptHash = (script: any) => {
        if (!script.source__git__repo_url || !script.source__git__repo_entry_path) return false;

        // Check if any compilation is missing
        if (
            !script.compiled_node_script ||
            !script.compiled_browser_script ||
            !script.compiled_bun_script
        ) {
            return true;
        }

        // Verify hashes match their compiled code
        const nodeHash = Bun.hash(script.compiled_node_script).toString();
        const browserHash = Bun.hash(script.compiled_browser_script).toString();
        const bunHash = Bun.hash(script.compiled_bun_script).toString();

        return (
            nodeHash !== script.compiled_node_script_sha256 ||
            browserHash !== script.compiled_browser_script_sha256 ||
            bunHash !== script.compiled_bun_script_sha256
        );
    };

    const needsLocalCompilation =
        Array.isArray(entity.babylonjs__script_local_scripts) &&
        entity.babylonjs__script_local_scripts.some(verifyScriptHash);

    const needsPersistentCompilation =
        Array.isArray(entity.babylonjs__script_persistent_scripts) &&
        entity.babylonjs__script_persistent_scripts.some(verifyScriptHash);

    return needsLocalCompilation || needsPersistentCompilation;
}

export class BunScriptBundleService {
    private worldClient: ClientCore;
    private debug: boolean;
    private subscription: RealtimeChannel | undefined = undefined;

    constructor(config: {
        worldClient: ClientCore;
        debug: boolean;
    }) {
        this.worldClient = config.worldClient;
        this.debug = config.debug;
    }

    async start() {
        log({
            message: "Starting Babylon Script Bundle Service...",
            type: "info",
            debug: this.debug,
        });

        this.subscription = this.worldClient.client
            ?.channel("entity-script-changes")
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "entities",
                },
                (payload) => this.handleEntityChange(payload),
            )
            .subscribe();

        log({
            message: "Babylon Script Bundle Service started successfully",
            type: "success",
            debug: this.debug,
        });
    }

    async stop() {
        if (this.subscription) {
            await this.subscription.unsubscribe();
            this.subscription = undefined;
            log({
                message: "Babylon Script Bundle Service stopped",
                type: "info",
                debug: this.debug,
            });
        }
    }

    private async handleEntityChange(payload: any) {
        return handleEntityChange(payload, this.debug, this.worldClient.client);
    }
}

export async function startBunScriptBundleService(config: {
    worldClient: ClientCore;
    debug: boolean;
}) {
    const service = new BunScriptBundleService(config);
    await service.start();
    return service;
}
