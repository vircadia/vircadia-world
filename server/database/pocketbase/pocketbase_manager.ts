import PocketBase from 'pocketbase';
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { log } from "../../../sdk/vircadia-world-sdk-ts/module/general/log.ts";

export class PocketBaseManager {
    private static instance: PocketBaseManager | null = null;
    private static debugMode = false;
    private pocketbaseClient: PocketBase | null = null;
    private pocketbaseProcess: any | null = null;

    private appDir: string;
    private dataDir: string;
    private migrationsDir: string;

    private constructor() {
        const currentDir = new URL(".", import.meta.url).pathname;
        this.appDir = path.resolve(currentDir, "app");
        this.dataDir = path.join(this.appDir, "pb_data");
        this.migrationsDir = path.join(this.appDir, "pb_migrations");
    }

    public static getInstance(debug = false): PocketBaseManager {
        if (!PocketBaseManager.instance) {
            PocketBaseManager.instance = new PocketBaseManager();
        }
        PocketBaseManager.debugMode = debug;
        return PocketBaseManager.instance;
    }

    public static isDebug(): boolean {
        return PocketBaseManager.debugMode;
    }

    async initializeAndStart(): Promise<void> {
        log({
            message: "Initializing and starting PocketBase...",
            type: "info",
            debug: PocketBaseManager.isDebug(),
        });

        try {
            await this.ensureDirectories();
            await this.startPocketBase();
        } catch (error) {
            log({
                message: `Failed to initialize and start PocketBase: ${error.message}`,
                type: "error",
                debug: PocketBaseManager.isDebug(),
            });
            throw error;
        }

        log({
            message: "PocketBase initialization and startup complete.",
            type: "success",
            debug: PocketBaseManager.isDebug(),
        });
    }

    private async ensureDirectories(): Promise<void> {
        try {
            await fs.mkdir(this.dataDir, { recursive: true });
            await fs.mkdir(this.migrationsDir, { recursive: true });
            
            log({
                message: "PocketBase directories initialized",
                type: "info",
                debug: PocketBaseManager.isDebug(),
            });
        } catch (error) {
            log({
                message: `Error creating PocketBase directories: ${error}`,
                type: "error",
                debug: PocketBaseManager.isDebug(),
            });
            throw error;
        }
    }

    private async startPocketBase(): Promise<void> {
        if (await this.isRunning()) {
            log({
                message: "PocketBase is already running",
                type: "info",
                debug: PocketBaseManager.isDebug(),
            });
            return;
        }

        log({
            message: "Starting PocketBase server...",
            type: "info",
            debug: PocketBaseManager.isDebug(),
        });

        try {
            // Start PocketBase process
            this.pocketbaseProcess = Bun.spawn(["./pocketbase", "serve"], {
                cwd: this.appDir,
                stdout: "pipe",
                stderr: "pipe",
            });

            // Handle stdout using Bun's stream reading
            const stdoutReader = this.pocketbaseProcess.stdout.getReader();
            (async () => {
                while (true) {
                    const { done, value } = await stdoutReader.read();
                    if (done) break;
                    
                    if (value) {
                        const output = new TextDecoder().decode(value);
                        log({
                            message: `PocketBase Output: ${output}`,
                            type: "info",
                            debug: PocketBaseManager.isDebug(),
                        });
                    }
                }
            })();

            // Handle stderr using Bun's stream reading
            const stderrReader = this.pocketbaseProcess.stderr.getReader();
            (async () => {
                while (true) {
                    const { done, value } = await stderrReader.read();
                    if (done) break;
                    
                    if (value) {
                        const error = new TextDecoder().decode(value);
                        log({
                            message: `PocketBase Error: ${error}`,
                            type: "error",
                            debug: PocketBaseManager.isDebug(),
                        });

                        // If we detect a migration error, we should throw it
                        if (error.includes("Failed to apply migration")) {
                            throw new Error(`Migration Error: ${error}`);
                        }
                    }
                }
            })();

            // Wait for server to be ready FIRST
            await this.waitForServer();

            // Initialize client AFTER server is confirmed ready
            this.initializeClient();

            log({
                message: "PocketBase server started successfully",
                type: "success",
                debug: PocketBaseManager.isDebug(),
            });
        } catch (error) {
            log({
                message: `Error starting PocketBase: ${error}`,
                type: "error",
                debug: PocketBaseManager.isDebug(),
            });
            throw error;
        }
    }

    private async stopPocketBase(): Promise<void> {
        if (this.pocketbaseProcess) {
            this.pocketbaseProcess.kill();
            this.pocketbaseProcess = null;
        }
        this.pocketbaseClient = null;

        log({
            message: "PocketBase server stopped",
            type: "info",
            debug: PocketBaseManager.isDebug(),
        });
    }

    private initializeClient(): void {
        try {
            this.pocketbaseClient = new PocketBase('http://127.0.0.1:8090');
            
            log({
                message: "PocketBase client initialized",
                type: "success",
                debug: PocketBaseManager.isDebug(),
            });
        } catch (error) {
            log({
                message: `Failed to initialize PocketBase client: ${error}`,
                type: "error",
                debug: PocketBaseManager.isDebug(),
            });
            throw error;
        }
    }

    private async waitForServer(): Promise<void> {
        const maxAttempts = 60;
        const delayMs = 500;
        
        log({
            message: "Waiting for PocketBase server to start...",
            type: "info",
            debug: PocketBaseManager.isDebug(),
        });

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            try {
                if (await this.isRunning()) {
                    log({
                        message: `PocketBase server responded after ${attempt + 1} attempts`,
                        type: "success",
                        debug: PocketBaseManager.isDebug(),
                    });
                    return;
                }
            } catch (error) {
                log({
                    message: `Attempt ${attempt + 1}/${maxAttempts} failed: ${error.message}`,
                    type: "warning",
                    debug: PocketBaseManager.isDebug(),
                });
            }

            if ((attempt + 1) % 10 === 0) {
                log({
                    message: `Still waiting for PocketBase server... (${attempt + 1}/${maxAttempts} attempts)`,
                    type: "info",
                    debug: PocketBaseManager.isDebug(),
                });
            }

            await new Promise(resolve => setTimeout(resolve, delayMs));
        }

        const error = new Error("PocketBase server failed to start within the timeout period");
        log({
            message: error.message,
            type: "error",
            debug: PocketBaseManager.isDebug(),
        });
        throw error;
    }

    async isRunning(): Promise<boolean> {
        try {
            // Create a temporary client if none exists
            const client = this.pocketbaseClient || new PocketBase('http://127.0.0.1:8090');
            await client.health.check();
            return true;
        } catch {
            return false;
        }
    }

    async debugStatus(): Promise<void> {
        log({
            message: "Running PocketBase debug commands...",
            type: "info",
            debug: PocketBaseManager.isDebug(),
        });

        try {
            if (this.pocketbaseProcess) {
                const output = await new Response(this.pocketbaseProcess.stdout).text();
                log({
                    message: `PocketBase Process Output: ${output}`,
                    type: "info",
                    debug: PocketBaseManager.isDebug(),
                });
            }

            const isRunning = await this.isRunning();
            log({
                message: `PocketBase Server Status: ${isRunning ? 'Running' : 'Stopped'}`,
                type: "info",
                debug: PocketBaseManager.isDebug(),
            });
        } catch (error) {
            log({
                message: `Error running debug commands: ${error}`,
                type: "error",
                debug: PocketBaseManager.isDebug(),
            });
        }
    }

    public getClient(): PocketBase {
        if (!this.pocketbaseClient) {
            throw new Error("PocketBase client not initialized. Ensure PocketBase is started.");
        }
        return this.pocketbaseClient;
    }
}

export default PocketBaseManager.getInstance();
