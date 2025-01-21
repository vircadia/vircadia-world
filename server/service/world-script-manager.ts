import { log } from "../../sdk/vircadia-world-sdk-ts/module/general/log";
import type postgres from "postgres";
import type { Hono } from "hono";
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
            await this.sql`
                UPDATE entity.entity_scripts 
                SET 
                    compiled__web__node__script_status = 'PENDING',
                    compiled__web__browser__script_status = 'PENDING',
                    compiled__web__bun__script_status = 'PENDING'
                WHERE general__script_id = ${scriptId}
            `;

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
                await this.sql`
                    UPDATE entity.entity_scripts 
                    SET 
                        compiled__web__node__script = ${compilationResult.compiledCode.node},
                        compiled__web__node__script_sha256 = ${compilationResult.hashes.node},
                        compiled__web__node__script_status = 'COMPILED',
                        compiled__web__browser__script = ${compilationResult.compiledCode.browser},
                        compiled__web__browser__script_sha256 = ${compilationResult.hashes.browser},
                        compiled__web__browser__script_status = 'COMPILED',
                        compiled__web__bun__script = ${compilationResult.compiledCode.bun},
                        compiled__web__bun__script_sha256 = ${compilationResult.hashes.bun},
                        compiled__web__bun__script_status = 'COMPILED',
                        general__updated_at = NOW()
                    WHERE general__script_id = ${scriptId}
                `;
            } else {
                await this.sql`
                    UPDATE entity.entity_scripts 
                    SET 
                        compiled__web__node__script_status = 'FAILED',
                        compiled__web__browser__script_status = 'FAILED',
                        compiled__web__bun__script_status = 'FAILED',
                        general__updated_at = NOW()
                    WHERE general__script_id = ${scriptId}
                `;

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

    addRoutes(app: Hono) {
        const routes = app.basePath("/services/world-script");

        // Webhook endpoint for triggering compilation
        routes.post("/compile", async (c) => {
            const body = await c.req.json();
            const { scriptId, repoUrl, entryPath, gitRef } = body;

            if (scriptId) {
                await this.compileScript(scriptId, gitRef);
                return c.json({ status: "compilation queued", scriptId });
            }

            if (repoUrl && entryPath) {
                await this.compileScriptsByRepo(repoUrl, entryPath, gitRef);
                return c.json({
                    status: "compilation queued",
                    repoUrl,
                    entryPath,
                });
            }

            return c.json({ error: "Invalid request parameters" }, 400);
        });

        // Get compilation status
        routes.get("/status/:scriptId", async (c) => {
            const scriptId = c.req.param("scriptId");
            const script = await this.sql`
                SELECT 
                    compiled__web__node__script_status as node_status,
                    compiled__web__bun__script_status as bun_status,
                    compiled__web__browser__script_status as browser_status
                FROM entity.entity_scripts 
                WHERE general__script_id = ${scriptId}
            `;

            if (!script.length) {
                return c.json({ error: "Script not found" }, 404);
            }

            return c.json(script[0]);
        });

        if (this.debugMode) {
            // Debug endpoints
            routes.get("/queue", (c) => {
                return c.json({
                    activeCompilations: Array.from(this.compilationQueue),
                });
            });
        }
    }
}
