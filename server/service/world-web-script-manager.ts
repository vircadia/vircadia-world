import { log } from "../../sdk/vircadia-world-sdk-ts/module/general/log";
import type postgres from "postgres";
import { build } from "bun";
import {
    Entity,
    type Tick,
} from "../../sdk/vircadia-world-sdk-ts/schema/schema.general";
import { PostgresClient } from "../database/postgres/postgres_client";
import { VircadiaConfig_Server } from "../../sdk/vircadia-world-sdk-ts/config/vircadia.config";

export class WorldWebScriptManager {
    private static instance: WorldWebScriptManager;

    private sql: postgres.Sql | null = null;
    private readonly debugMode: boolean;
    private readonly heartbeatMs: number;
    private isHeartbeatRunning: boolean = false;
    private heartbeatController: AbortController | null = null;

    private constructor() {
        this.debugMode = VircadiaConfig_Server.debug;
        this.heartbeatMs = 1000;
    }

    public static getInstance(): WorldWebScriptManager {
        if (!WorldWebScriptManager.instance) {
            WorldWebScriptManager.instance = new WorldWebScriptManager();
        }
        return WorldWebScriptManager.instance;
    }

    async initialize() {
        await PostgresClient.getInstance().connect(true);
        this.sql = PostgresClient.getInstance().getClient();

        try {
            log({
                message: "Initializing world script manager",
                debug: this.debugMode,
                type: "info",
            });

            // Reset all non-completed script statuses
            const resetScriptIds = await this.resetPendingScripts();
            log({
                message: `Reset ${resetScriptIds.length} scripts`,
                debug: this.debugMode,
                type: "info",
            });
            await this.startHeartbeat();

            log({
                message: "Initialized world web script manager",
                debug: this.debugMode,
                type: "success",
            });
        } catch (error) {
            await this.cleanup();
            throw error;
        }
    }

    private async resetPendingScripts(): Promise<string[]> {
        if (!this.sql) throw new Error("Database not connected");

        const resetScripts = await this.sql<{ general__script_id: string }[]>`
            UPDATE entity.entity_scripts 
            SET 
                compiled__node__status = ${Entity.Script.E_CompilationStatus.PENDING},
                compiled__bun__status = ${Entity.Script.E_CompilationStatus.PENDING},
                compiled__browser__status = ${Entity.Script.E_CompilationStatus.PENDING}
            WHERE 
                compiled__node__status IN (${Entity.Script.E_CompilationStatus.PENDING}, ${Entity.Script.E_CompilationStatus.COMPILING}) OR
                compiled__bun__status IN (${Entity.Script.E_CompilationStatus.PENDING}, ${Entity.Script.E_CompilationStatus.COMPILING}) OR
                compiled__browser__status IN (${Entity.Script.E_CompilationStatus.PENDING}, ${Entity.Script.E_CompilationStatus.COMPILING})
            RETURNING general__script_id
        `;

        return resetScripts.map((script) => script.general__script_id);
    }

    private async updateAllScriptStatuses(
        scriptId: string,
        status: Entity.Script.E_CompilationStatus,
        compiledCode?: { node: string; browser: string; bun: string },
        hashes?: { node: string; browser: string; bun: string },
    ) {
        if (!this.sql) throw new Error("Database not connected");

        const platforms = [
            Entity.Script.E_Platform.NODE,
            Entity.Script.E_Platform.BROWSER,
            Entity.Script.E_Platform.BUN,
        ];

        const updates = platforms.reduce(
            (acc, platform) => ({
                ...acc,
                [`compiled__${platform}__status`]: status,
                ...(compiledCode && {
                    [`compiled__${platform}__script`]: compiledCode[platform],
                }),
                ...(hashes && {
                    [`compiled__${platform}__script_sha256`]: hashes[platform],
                }),
                ...(status === Entity.Script.E_CompilationStatus.COMPILED && {
                    [`compiled__${platform}__updated_at`]: new Date(),
                }),
            }),
            {},
        );

        await this.sql`
            UPDATE entity.entity_scripts 
            SET ${this.sql(updates)}
            WHERE general__script_id = ${scriptId}
        `;
    }

    private async prepareGitRepo(
        repoUrl: string,
        entryPath: string,
    ): Promise<{ path: string; cleanup: () => Promise<void> }> {
        const tempDir = `${Bun.env.BUN_TMPDIR || "/tmp"}/${Date.now()}-${Math.random().toString(36).slice(2)}`;

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

            return {
                path: `${tempDir}/${entryPath}`,
                cleanup: async () => {
                    await Bun.spawn(["rm", "-rf", tempDir]).exited;
                },
            };
        } catch (error) {
            // Cleanup on error
            await Bun.spawn(["rm", "-rf", tempDir]).exited;
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
        if (!this.sql) {
            throw new Error("Database not connected");
        }

        let cleanup: (() => Promise<void>) | undefined;

        try {
            log({
                message: `Starting compilation for script ${scriptId}`,
                debug: this.debugMode,
                type: "info",
            });

            // First, check if the script exists and needs compilation
            const [script] = await this.sql<Entity.Script.I_Script[]>`
                SELECT * FROM entity.entity_scripts 
                WHERE general__script_id = ${scriptId}
            `;

            if (!script) {
                throw new Error(`Script ${scriptId} not found`);
            }

            // Set status to PENDING first if not already compiling
            await this.sql`
                UPDATE entity.entity_scripts 
                SET 
                    compiled__node__status = ${Entity.Script.E_CompilationStatus.PENDING},
                    compiled__browser__status = ${Entity.Script.E_CompilationStatus.PENDING},
                    compiled__bun__status = ${Entity.Script.E_CompilationStatus.PENDING}
                WHERE 
                    general__script_id = ${scriptId}
                    AND compiled__node__status != ${Entity.Script.E_CompilationStatus.COMPILING}
                    AND compiled__browser__status != ${Entity.Script.E_CompilationStatus.COMPILING}
                    AND compiled__bun__status != ${Entity.Script.E_CompilationStatus.COMPILING}
            `;

            // Then update to COMPILING
            await this.sql`
                UPDATE entity.entity_scripts 
                SET 
                    compiled__node__status = ${Entity.Script.E_CompilationStatus.COMPILING},
                    compiled__browser__status = ${Entity.Script.E_CompilationStatus.COMPILING},
                    compiled__bun__status = ${Entity.Script.E_CompilationStatus.COMPILING}
                WHERE general__script_id = ${scriptId}
            `;

            const { path: scriptPath, cleanup: cleanupFn } =
                await this.prepareGitRepo(
                    script.source__repo__url || "",
                    script.source__repo__entry_path || "",
                );
            cleanup = cleanupFn;

            log({
                message: `Starting compilation for script at path: ${scriptPath}`,
                debug: this.debugMode,
                type: "info",
            });

            const compilationResult = await this.compileScriptCode(scriptPath);

            if (
                compilationResult.success &&
                compilationResult.compiledCode &&
                compilationResult.hashes
            ) {
                log({
                    message: `Compilation successful for script ${scriptId}`,
                    debug: this.debugMode,
                    type: "success",
                });

                await this.updateAllScriptStatuses(
                    scriptId,
                    Entity.Script.E_CompilationStatus.COMPILED,
                    compilationResult.compiledCode,
                    compilationResult.hashes,
                );
            } else {
                log({
                    message: `Compilation failed for script ${scriptId}`,
                    debug: this.debugMode,
                    type: "error",
                    data: {
                        error: compilationResult.error,
                        scriptPath,
                        scriptId,
                    },
                });

                await this.updateAllScriptStatuses(
                    scriptId,
                    Entity.Script.E_CompilationStatus.FAILED,
                );
            }
        } catch (error) {
            log({
                message: `Error during script compilation: ${error}`,
                debug: this.debugMode,
                type: "error",
            });

            // Update status to FAILED on error
            await this.sql`
                UPDATE entity.entity_scripts 
                SET 
                    compiled__node__status = ${Entity.Script.E_CompilationStatus.FAILED},
                    compiled__browser__status = ${Entity.Script.E_CompilationStatus.FAILED},
                    compiled__bun__status = ${Entity.Script.E_CompilationStatus.FAILED}
                WHERE general__script_id = ${scriptId}
            `;
        } finally {
            if (cleanup) {
                await cleanup();
            }
        }
    }

    async compileScriptsByRepo(
        repoUrl: string,
        entryPath: string,
        gitRef?: string,
    ) {
        if (!this.sql) {
            throw new Error("Database not connected");
        }

        try {
            const scripts = await this.sql`
                SELECT general__script_id 
                FROM entity.entity_scripts 
                WHERE 
                    script__source__node__repo__url = ${repoUrl} 
                    AND script__source__node__repo__entry_path = ${entryPath}
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

    private async startHeartbeat() {
        if (this.isHeartbeatRunning) return;

        this.isHeartbeatRunning = true;
        this.heartbeatController = new AbortController();
        const { signal } = this.heartbeatController;

        try {
            while (!signal.aborted) {
                if (!this.sql) throw new Error("Database not connected");

                const scriptsToCompile = await this.sql`
                    WITH needs_compilation AS (
                        SELECT 
                            general__script_id,
                            general__updated_at,
                            GREATEST(
                                compiled__node__updated_at,
                                compiled__bun__updated_at,
                                compiled__browser__updated_at
                            ) as last_compilation
                        FROM entity.entity_scripts 
                        WHERE 
                            compiled__node__status NOT IN (${Entity.Script.E_CompilationStatus.COMPILED}, ${Entity.Script.E_CompilationStatus.PENDING}, ${Entity.Script.E_CompilationStatus.COMPILING}) OR
                            compiled__bun__status NOT IN (${Entity.Script.E_CompilationStatus.COMPILED}, ${Entity.Script.E_CompilationStatus.PENDING}, ${Entity.Script.E_CompilationStatus.COMPILING}) OR
                            compiled__browser__status NOT IN (${Entity.Script.E_CompilationStatus.COMPILED}, ${Entity.Script.E_CompilationStatus.PENDING}, ${Entity.Script.E_CompilationStatus.COMPILING})
                    )
                    SELECT general__script_id 
                    FROM needs_compilation
                    WHERE last_compilation IS NULL 
                       OR general__updated_at > last_compilation
                    LIMIT 5
                `;

                for (const script of scriptsToCompile) {
                    if (signal.aborted) break;
                    await this.compileScript(script.general__script_id);
                    await Bun.sleep(100);
                }

                await Bun.sleep(this.heartbeatMs);
            }
        } catch (error) {
            log({
                message: `Error in heartbeat: ${error}`,
                debug: this.debugMode,
                type: "error",
            });
        } finally {
            this.isHeartbeatRunning = false;
        }
    }

    public async cleanup() {
        await this.stopHeartbeat();
        // Allow time for any in-progress compilations to complete
        await Bun.sleep(100);
        this.sql = null;
    }

    public async stopHeartbeat() {
        if (this.heartbeatController) {
            this.heartbeatController.abort();
            this.heartbeatController = null;
        }
        this.isHeartbeatRunning = false;
    }
}

if (import.meta.main) {
    try {
        const manager = WorldWebScriptManager.getInstance();
        await manager.initialize();
    } catch (error) {
        log({
            message: `Failed to start world web script manager: ${error}`,
            type: "error",
            debug: true,
        });
        process.exit(1);
    }
}
