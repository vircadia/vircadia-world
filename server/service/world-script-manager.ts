import { log } from "../../sdk/vircadia-world-sdk-ts/module/general/log";
import type postgres from "postgres";
import { temporaryDirectory } from "tempy";
import { build } from "bun";

export class WorldScriptManager {
    private compilationQueue: Set<string> = new Set();
    private subscription?: postgres.SubscriptionHandle;

    constructor(
        private readonly sql: postgres.Sql,
        private readonly debugMode: boolean = true,
    ) {
        this.sql = sql;
    }

    async initialize() {
        try {
            log({
                message: "Initializing world script manager",
                debug: this.debugMode,
                type: "debug",
            });

            // Set any pending compilations to failed state on startup
            await this.sql`
                UPDATE entity.entity_scripts 
                SET 
                    compiled__web__node__script_status = 'FAILED',
                    compiled__web__bun__script_status = 'FAILED',
                    compiled__web__browser__script_status = 'FAILED'
                WHERE 
                    compiled__web__node__script_status = 'PENDING' OR
                    compiled__web__bun__script_status = 'PENDING' OR
                    compiled__web__browser__script_status = 'PENDING'
            `;

            // Subscribe to script changes using logical replication
            this.subscription = await this.sql.subscribe(
                "*:entity.entity_scripts",
                async (row, { command }) => {
                    try {
                        // Handle script updates
                        if (command === "insert" || command === "update") {
                            const script = row as {
                                general__script_id: string;
                                source__git__repo_url: string;
                                source__git__repo_entry_path: string;
                                compiled__web__node__script_status: string;
                            };

                            // Trigger recompilation if script source was updated or status is PENDING
                            if (
                                script.compiled__web__node__script_status ===
                                "PENDING"
                            ) {
                                await this.compileScript(
                                    script.general__script_id,
                                );
                            }
                        }
                    } catch (error) {
                        log({
                            message: `Error processing script change: ${error}`,
                            debug: this.debugMode,
                            type: "error",
                        });
                    }
                },
                () => {
                    log({
                        message: "Connected to script changes subscription",
                        debug: this.debugMode,
                        type: "debug",
                    });
                },
            );

            log({
                message: "Initialized WorldScriptManager",
                debug: this.debugMode,
                type: "debug",
            });
        } catch (error) {
            log({
                message: `Failed to initialize WorldScriptManager: ${error}`,
                debug: this.debugMode,
                type: "error",
            });
            throw error;
        }
    }

    async destroy() {
        if (this.subscription) {
            this.subscription.unsubscribe();
        }
    }

    private async updateScriptStatus(
        scriptId: string,
        target: "node" | "bun" | "browser",
        status: "PENDING" | "COMPILED" | "FAILED",
        compiledScript?: string,
        scriptSha256?: string,
    ) {
        const updates = {
            [`compiled__web__${target}__script_status`]: status,
            ...(compiledScript && {
                [`compiled__web__${target}__script`]: compiledScript,
            }),
            ...(scriptSha256 && {
                [`compiled__web__${target}__script_sha256`]: scriptSha256,
            }),
        };

        await this.sql`
            UPDATE entity.entity_scripts 
            SET ${this.sql(updates)}
            WHERE general__script_id = ${scriptId}
        `;
    }

    private async prepareGitRepo(
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
                debug: this.debugMode,
            });
            throw error;
        }
    }

    private async compileScriptCode(path: string): Promise<{
        success: boolean;
        compiledCode?: { node: string; browser: string; bun: string };
        hashes?: { node: string; browser: string; bun: string };
        error?: string;
    }> {
        try {
            const results = await Promise.all([
                build({ entrypoints: [path], target: "node" }),
                build({ entrypoints: [path], target: "browser" }),
                build({ entrypoints: [path], target: "bun" }),
            ]);

            if (results.every((r) => r.success)) {
                const [nodeCode, browserCode, bunCode] = await Promise.all([
                    results[0].outputs[0].text(),
                    results[1].outputs[0].text(),
                    results[2].outputs[0].text(),
                ]);

                return {
                    success: true,
                    compiledCode: {
                        node: nodeCode,
                        browser: browserCode,
                        bun: bunCode,
                    },
                    hashes: {
                        node: Bun.hash(nodeCode).toString(),
                        browser: Bun.hash(browserCode).toString(),
                        bun: Bun.hash(bunCode).toString(),
                    },
                };
            }

            return {
                success: false,
                error: `One or more builds failed: ${results.map((r) => r.logs).join("\n")}`,
            };
        } catch (error) {
            return {
                success: false,
                error: `Compilation error: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
    }

    async compileScript(scriptId: string, gitRef?: string) {
        const queueKey = `${scriptId}:${gitRef || "latest"}`;

        if (this.compilationQueue.has(queueKey)) {
            log({
                message: `Script ${scriptId} is already being compiled`,
                debug: this.debugMode,
                type: "warn",
            });
            return;
        }

        try {
            this.compilationQueue.add(queueKey);

            const [script] = await this.sql`
                SELECT * FROM entity.entity_scripts 
                WHERE general__script_id = ${scriptId}
            `;

            if (!script) {
                throw new Error(`Script ${scriptId} not found`);
            }

            // Set all compilation statuses to PENDING
            await Promise.all([
                this.updateScriptStatus(scriptId, "node", "PENDING"),
                this.updateScriptStatus(scriptId, "browser", "PENDING"),
                this.updateScriptStatus(scriptId, "bun", "PENDING"),
            ]);

            const scriptPath = await this.prepareGitRepo(
                script.source__git__repo_url,
                script.source__git__repo_entry_path,
            );

            const compilationResult = await this.compileScriptCode(scriptPath);

            if (
                compilationResult.success &&
                compilationResult.compiledCode &&
                compilationResult.hashes
            ) {
                await Promise.all([
                    this.updateScriptStatus(
                        scriptId,
                        "node",
                        "COMPILED",
                        compilationResult.compiledCode.node,
                        compilationResult.hashes.node,
                    ),
                    this.updateScriptStatus(
                        scriptId,
                        "browser",
                        "COMPILED",
                        compilationResult.compiledCode.browser,
                        compilationResult.hashes.browser,
                    ),
                    this.updateScriptStatus(
                        scriptId,
                        "bun",
                        "COMPILED",
                        compilationResult.compiledCode.bun,
                        compilationResult.hashes.bun,
                    ),
                ]);
            } else {
                await Promise.all([
                    this.updateScriptStatus(scriptId, "node", "FAILED"),
                    this.updateScriptStatus(scriptId, "browser", "FAILED"),
                    this.updateScriptStatus(scriptId, "bun", "FAILED"),
                ]);

                log({
                    message: `Compilation failed for script ${scriptId}: ${compilationResult.error}`,
                    type: "error",
                    debug: this.debugMode,
                });
            }
        } catch (error) {
            log({
                message: `Error during script compilation: ${error}`,
                debug: this.debugMode,
                type: "error",
            });
        } finally {
            this.compilationQueue.delete(queueKey);
        }
    }

    async compileScriptsByRepo(
        repoUrl: string,
        entryPath: string,
        gitRef?: string,
    ) {
        try {
            const scripts = await this.sql`
                SELECT general__script_id 
                FROM entity.entity_scripts 
                WHERE 
                    source__git__repo_url = ${repoUrl} 
                    AND source__git__repo_entry_path = ${entryPath}
            `;

            for (const script of scripts) {
                await this.compileScript(script.general__script_id, gitRef);
            }
        } catch (error) {
            log({
                message: `Error during repo scripts compilation: ${error}`,
                debug: this.debugMode,
                type: "error",
            });
        }
    }
}
