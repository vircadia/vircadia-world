import type {
    SupabaseClient,
    RealtimeChannel,
    RealtimePostgresChangesPayload,
} from "@supabase/supabase-js";
import { type BuildOutput, build } from "bun";
import { temporaryDirectory } from "tempy";
import { log } from "../../../../sdk/vircadia-world-sdk-ts/module/general/log";
import type { ClientCore } from "../../client_core";
import type {
    Database,
    Enums,
} from "../../../../sdk/vircadia-world-sdk-ts/schema/schema.database";
import type { Tables } from "../../../../sdk/vircadia-world-sdk-ts/schema/schema.database";
type EntityScript = Tables<"entity_scripts">;

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
                    "COMPILED" as Enums<"script_compilation_status">,
                compiled_browser_script: browserCode,
                compiled_browser_script_sha256: browserHash,
                compiled_browser_script_status:
                    "COMPILED" as Enums<"script_compilation_status">,
                compiled_bun_script: bunCode,
                compiled_bun_script_sha256: bunHash,
                compiled_bun_script_status:
                    "COMPILED" as Enums<"script_compilation_status">,
            };
        }

        return {
            compiled_node_script_status:
                "FAILED" as Enums<"script_compilation_status">,
            compiled_browser_script_status:
                "FAILED" as Enums<"script_compilation_status">,
            compiled_bun_script_status:
                "FAILED" as Enums<"script_compilation_status">,
            error: "One or more builds failed",
            build_logs: results.map((r) => r.logs),
        };
    } catch (error) {
        const errorMessage =
            error instanceof Error ? error.message : String(error);
        log({
            message: `Error bundling script ${path}: ${errorMessage}`,
            type: "error",
            debug: debugMode,
        });
        return {
            compiled_node_script_status:
                "FAILED" as Enums<"script_compilation_status">,
            compiled_browser_script_status:
                "FAILED" as Enums<"script_compilation_status">,
            compiled_bun_script_status:
                "FAILED" as Enums<"script_compilation_status">,
            error: `Bundling error: ${errorMessage}`,
            ...(debugMode && {
                stack: error instanceof Error ? error.stack : undefined,
            }),
        };
    }
}

export class BunScriptBundleService {
    private supabaseClient: SupabaseClient<Database, "public">;
    private debug: boolean;
    private subscription: RealtimeChannel | undefined = undefined;

    constructor(config: {
        worldClient: SupabaseClient<Database, "public">;
        debug: boolean;
    }) {
        this.supabaseClient = config.worldClient;
        this.debug = config.debug;
    }

    async start() {
        log({
            message: "Starting Babylon Script Bundle Service...",
            type: "info",
            debug: this.debug,
        });

        this.subscription = this.supabaseClient
            .channel("entity-script-changes")
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "entity_scripts",
                },
                async (payload) => {
                    log({
                        message: `Received script change: ${JSON.stringify(payload, null, 2).substring(0, 100)}`,
                        type: "info",
                        debug: this.debug,
                    });

                    if (payload.eventType === "DELETE") return;

                    const script = payload.new;

                    // Basic validation
                    if (
                        !script.source__git__repo_url ||
                        !script.source__git__repo_entry_path
                    )
                        return;

                    // Check if compilation is needed
                    const needsCompilation =
                        !script.compiled__web__node__script ||
                        !script.compiled__web__browser__script ||
                        !script.compiled__web__bun__script ||
                        (script.compiled__web__node__script &&
                            Bun.hash(
                                script.compiled__web__node__script,
                            ).toString() !==
                                script.compiled__web__node__script_sha256) ||
                        (script.compiled__web__browser__script &&
                            Bun.hash(
                                script.compiled__web__browser__script,
                            ).toString() !==
                                script.compiled__web__browser__script_sha256) ||
                        (script.compiled__web__bun__script &&
                            Bun.hash(
                                script.compiled__web__bun__script,
                            ).toString() !==
                                script.compiled__web__bun__script_sha256);

                    if (!needsCompilation) {
                        log({
                            message: `Script ${script.general__script_id} is up to date, skipping compilation`,
                            type: "info",
                            debug: this.debug,
                        });
                        return;
                    }

                    try {
                        const scriptPath = await prepareGitRepo(
                            script.source__git__repo_url,
                            script.source__git__repo_entry_path,
                        );

                        const compiled = await compileScript(
                            scriptPath,
                            this.debug,
                        );

                        // Update the script with compiled versions
                        const { error } = await this.supabaseClient
                            .from("entity_scripts")
                            .update({
                                compiled__web__browser__script:
                                    compiled.compiled_browser_script ?? null,
                                compiled__web__browser__script_sha256:
                                    compiled.compiled_browser_script_sha256 ??
                                    null,
                                compiled__web__browser__script_status:
                                    compiled.compiled_browser_script_status,
                                compiled__web__bun__script:
                                    compiled.compiled_bun_script ?? null,
                                compiled__web__bun__script_sha256:
                                    compiled.compiled_bun_script_sha256 ?? null,
                                compiled__web__bun__script_status:
                                    compiled.compiled_bun_script_status,
                                compiled__web__node__script:
                                    compiled.compiled_node_script ?? null,
                                compiled__web__node__script_sha256:
                                    compiled.compiled_node_script_sha256 ??
                                    null,
                                compiled__web__node__script_status:
                                    compiled.compiled_node_script_status,
                                general__updated_at: new Date().toISOString(),
                            })
                            .eq(
                                "general__script_id",
                                script.general__script_id,
                            );

                        if (error) {
                            log({
                                message: `Error updating script ${script.general__script_id}: ${error.message}`,
                                type: "error",
                                debug: this.debug,
                            });
                        }
                    } catch (error) {
                        const errorMessage =
                            error instanceof Error
                                ? error.message
                                : String(error);
                        log({
                            message: `Error processing script ${script.general__script_id}: ${errorMessage}`,
                            type: "error",
                            debug: this.debug,
                            ...(this.debug && {
                                stack:
                                    error instanceof Error
                                        ? error.stack
                                        : undefined,
                            }),
                        });
                    }
                },
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
}

export async function startBunScriptBundleService(config: {
    worldClient: SupabaseClient<Database, "public">;
    debug: boolean;
}) {
    const service = new BunScriptBundleService(config);
    await service.start();
    return service;
}
