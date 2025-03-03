import { log } from "../vircadia-world-sdk-ts/module/general/log";
import type postgres from "postgres";
import { build, type Subprocess } from "bun";
import { Entity } from "../vircadia-world-sdk-ts/schema/schema.general";
import { PostgresClient } from "../vircadia-world-sdk-ts/module/server/postgres.client";
import { VircadiaConfig } from "../vircadia-world-sdk-ts/config/vircadia.config";
import tmp from "tmp";
import { EventEmitter } from "node:events";

// Configure tmp for graceful cleanup
tmp.setGracefulCleanup();

export class WorldWebScriptManager {
    private static instance: WorldWebScriptManager;
    public events: EventEmitter = new EventEmitter();

    private superUserSql: postgres.Sql | null = null;
    private readonly heartbeatMs = 1000;
    private isHeartbeatRunning = false;
    private activeProcesses: Set<Subprocess> = new Set();

    public static getInstance(): WorldWebScriptManager {
        if (!WorldWebScriptManager.instance) {
            WorldWebScriptManager.instance = new WorldWebScriptManager();
        }
        return WorldWebScriptManager.instance;
    }

    // Add a getter for testing purposes
    public getEventEmitter(): EventEmitter {
        return this.events;
    }

    async initialize() {
        this.superUserSql = await PostgresClient.getInstance().getSuperClient({
            postgres: {
                host: VircadiaConfig.SERVER.SERVICE.POSTGRES.HOST_EXTERNAL,
                port: VircadiaConfig.SERVER.SERVICE.POSTGRES.PORT_EXTERNAL,
            },
        });

        try {
            log({
                message: "Initializing world script manager",
                debug: VircadiaConfig.SERVER.DEBUG,
                suppress: VircadiaConfig.SERVER.SUPPRESS,
                type: "info",
            });

            // Reset all non-completed script statuses
            const resetScriptIds = await this.resetPendingScripts();
            log({
                message: `Reset ${resetScriptIds.length} scripts`,
                debug: VircadiaConfig.SERVER.DEBUG,
                suppress: VircadiaConfig.SERVER.SUPPRESS,
                type: "info",
            });
            await this.startHeartbeat();

            log({
                message: "Initialized world web script manager",
                debug: VircadiaConfig.SERVER.DEBUG,
                suppress: VircadiaConfig.SERVER.SUPPRESS,
                type: "success",
            });

            // Add event emissions at key points
            this.events.emit("manager:initialized");
        } catch (error) {
            await this.cleanup();
            throw error;
        }
    }

    private async resetPendingScripts(): Promise<string[]> {
        if (!this.superUserSql) throw new Error("Database not connected");

        const resetScripts = await this.superUserSql<
            { general__script_id: string }[]
        >`
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
        if (!this.superUserSql) throw new Error("Database not connected");

        const platforms = [
            Entity.Script.E_Platform.NODE,
            Entity.Script.E_Platform.BROWSER,
            Entity.Script.E_Platform.BUN,
        ];

        const updates = platforms.reduce(
            (acc, platform) => ({
                // biome-ignore lint/performance/noAccumulatingSpread: <explanation>
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

        await this.superUserSql`
            UPDATE entity.entity_scripts 
            SET ${this.superUserSql(updates)}
            WHERE general__script_id = ${scriptId}
        `;
    }

    private async startHeartbeat() {
        if (this.isHeartbeatRunning) return;
        this.isHeartbeatRunning = true;

        while (this.isHeartbeatRunning) {
            if (!this.superUserSql) throw new Error("Database not connected");

            const scriptsToCompile = await this.superUserSql`
                SELECT general__script_id 
                FROM entity.entity_scripts 
                WHERE 
                    compiled__node__status = ${Entity.Script.E_CompilationStatus.PENDING} OR
                    compiled__bun__status = ${Entity.Script.E_CompilationStatus.PENDING} OR
                    compiled__browser__status = ${Entity.Script.E_CompilationStatus.PENDING}
                LIMIT 5
            `;

            for (const script of scriptsToCompile) {
                if (!this.isHeartbeatRunning) break;
                await this.compileScript(script.general__script_id);
                await Bun.sleep(100);
            }

            await Bun.sleep(this.heartbeatMs);
        }
    }

    private trackProcess(process: Subprocess) {
        this.activeProcesses.add(process);
        process.exited.then(() => {
            this.activeProcesses.delete(process);
        });
    }

    private async prepareGitRepo(
        repoUrl: string,
        entryPath: string,
    ): Promise<{ path: string; cleanup: () => Promise<void> }> {
        return new Promise((resolve, reject) => {
            tmp.dir({ unsafeCleanup: true }, async (err, tempDir, cleanup) => {
                if (err) return reject(err);

                try {
                    const clone = Bun.spawn(
                        ["git", "clone", repoUrl, tempDir],
                        {
                            stdout: "inherit",
                            stderr: "inherit",
                        },
                    );
                    this.trackProcess(clone);

                    const cloneSuccess = await clone.exited;
                    if (cloneSuccess !== 0) {
                        throw new Error(
                            `Failed to clone repository: ${repoUrl}`,
                        );
                    }

                    const install = Bun.spawn(["bun", "install"], {
                        cwd: tempDir,
                        stdout: "inherit",
                        stderr: "inherit",
                    });
                    this.trackProcess(install);

                    const installSuccess = await install.exited;
                    if (installSuccess !== 0) {
                        throw new Error(
                            `Failed to install dependencies for repository: ${repoUrl}`,
                        );
                    }

                    resolve({
                        path: `${tempDir}/${entryPath}`,
                        cleanup: async () => {
                            cleanup();
                        },
                    });
                } catch (error) {
                    cleanup();
                    reject(error);
                }
            });
        });
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
        if (!this.superUserSql) {
            throw new Error("Database not connected");
        }

        let cleanup: (() => Promise<void>) | undefined;

        try {
            this.events.emit("script:compilation:start", { scriptId });

            log({
                message: `Starting compilation for script ${scriptId}`,
                debug: VircadiaConfig.SERVER.DEBUG,
                suppress: VircadiaConfig.SERVER.SUPPRESS,
                type: "info",
            });

            // First, check if the script exists and needs compilation
            const [script] = await this.superUserSql<Entity.Script.I_Script[]>`
                SELECT * FROM entity.entity_scripts 
                WHERE general__script_id = ${scriptId}
            `;

            if (!script) {
                throw new Error(`Script ${scriptId} not found`);
            }

            // Set status to PENDING first if not already compiling
            await this.superUserSql`
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
            await this.superUserSql`
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
                debug: VircadiaConfig.SERVER.DEBUG,
                suppress: VircadiaConfig.SERVER.SUPPRESS,
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
                    debug: VircadiaConfig.SERVER.DEBUG,
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    type: "success",
                });

                this.events.emit("script:compilation:success", {
                    scriptId,
                    platforms: ["node", "browser", "bun"],
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
                    debug: VircadiaConfig.SERVER.DEBUG,
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    type: "error",
                    data: {
                        error: compilationResult.error,
                        scriptPath,
                        scriptId,
                    },
                });

                this.events.emit("script:compilation:failed", {
                    scriptId,
                    error: compilationResult.error,
                });

                await this.updateAllScriptStatuses(
                    scriptId,
                    Entity.Script.E_CompilationStatus.FAILED,
                );
            }
        } catch (error) {
            log({
                message: `Error during script compilation: ${error}`,
                debug: VircadiaConfig.SERVER.DEBUG,
                suppress: VircadiaConfig.SERVER.SUPPRESS,
                type: "error",
            });

            this.events.emit("script:compilation:error", {
                scriptId,
                error: error instanceof Error ? error.message : String(error),
            });

            // Update status to FAILED on error
            await this.superUserSql`
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
        if (!this.superUserSql) {
            throw new Error("Database not connected");
        }

        try {
            const scripts = await this.superUserSql`
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
                debug: VircadiaConfig.SERVER.DEBUG,
                suppress: VircadiaConfig.SERVER.SUPPRESS,
                type: "error",
            });
        }
    }

    public async cleanup() {
        this.isHeartbeatRunning = false;

        // Kill all active processes
        for (const process of this.activeProcesses) {
            process.kill();
        }
        this.activeProcesses.clear();

        this.superUserSql = null;
    }
}

if (import.meta.main) {
    const manager = WorldWebScriptManager.getInstance();

    process.on("SIGINT", async () => {
        log({
            message: "\nReceived SIGINT. Cleaning up...",
            debug: VircadiaConfig.SERVER.DEBUG,
            type: "debug",
        });
        await manager.cleanup();
        process.exit(0);
    });
    process.on("SIGTERM", async () => {
        log({
            message: "\nReceived SIGTERM. Cleaning up...",
            debug: VircadiaConfig.SERVER.DEBUG,
            type: "debug",
        });
        await manager.cleanup();
        process.exit(0);
    });

    try {
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
