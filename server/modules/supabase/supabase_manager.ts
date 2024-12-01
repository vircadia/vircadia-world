import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { log } from "../../../sdk/vircadia-world-sdk-ts/module/general/log.ts";

export class Supabase {
    private static instance: Supabase | null = null;
    private static debugMode = false;
    private supabaseAdminClient: SupabaseClient | null = null;

    private appDir: string;

    private constructor() {
        const currentDir = new URL(".", import.meta.url).pathname;
        this.appDir = path.resolve(currentDir, "app", "docker");
    }

    public static getInstance(debug = false): Supabase {
        if (!Supabase.instance) {
            Supabase.instance = new Supabase();
        }
        Supabase.debugMode = debug;
        return Supabase.instance;
    }

    public static isDebug(): boolean {
        return Supabase.debugMode;
    }

    async initializeAndStart(data: { forceRestart: boolean }): Promise<void> {
        log({
            message: "Initializing and starting Supabase...",
            type: "info",
            debug: Supabase.isDebug(),
        });

        try {
            await this.initializeEnvFile();
            await this.pullDockerImages();
            await this.startSupabase(data.forceRestart);
        } catch (error) {
            log({
                message: `Failed to initialize and start Supabase: ${error.message}`,
                type: "error",
                debug: Supabase.isDebug(),
            });
            throw error;
        }

        log({
            message: "Supabase initialization and startup complete.",
            type: "success",
            debug: Supabase.isDebug(),
        });
    }

    private async initializeEnvFile(): Promise<void> {
        const envPath = path.join(this.appDir, ".env");
        const envExamplePath = path.join(this.appDir, ".env.example");

        try {
            await fs.access(envPath);
            log({
                message: ".env file already exists",
                type: "info",
                debug: Supabase.isDebug(),
            });
        } catch {
            log({
                message: "Creating .env file from .env.example",
                type: "info",
                debug: Supabase.isDebug(),
            });
            await fs.copyFile(envExamplePath, envPath);
        }
    }

    private async pullDockerImages(): Promise<void> {
        log({
            message: "Pulling latest Docker images...",
            type: "info",
            debug: Supabase.isDebug(),
        });

        const proc = Bun.spawn(["docker", "compose", "pull"], {
            cwd: this.appDir,
            stdout: "pipe",
            stderr: "pipe",
        });

        const output = await new Response(proc.stdout).text();
        log({
            message: `Docker pull output: ${output}`,
            type: "debug",
            debug: Supabase.isDebug(),
        });
    }

    private async startSupabase(forceRestart: boolean): Promise<void> {
        if (!forceRestart && (await this.isRunning())) {
            log({
                message: "Supabase services are already running",
                type: "info",
                debug: Supabase.isDebug(),
            });
            return;
        }

        if (forceRestart) {
            await this.stopSupabase();
        }

        log({
            message: "Starting Supabase services...",
            type: "info",
            debug: Supabase.isDebug(),
        });

        const proc = Bun.spawn(["docker", "compose", "up", "-d"], {
            cwd: this.appDir,
            stdout: "pipe",
            stderr: "pipe",
        });

        const output = await new Response(proc.stdout).text();
        log({
            message: `Docker compose up output: ${output}`,
            type: "debug",
            debug: Supabase.isDebug(),
        });
    }

    private async stopSupabase(): Promise<void> {
        this.supabaseAdminClient = null;
        log({
            message: "Stopping Supabase services...",
            type: "info",
            debug: Supabase.isDebug(),
        });

        const proc = Bun.spawn(["docker", "compose", "down"], {
            cwd: this.appDir,
            stdout: "pipe",
            stderr: "pipe",
        });

        const output = await new Response(proc.stdout).text();
        log({
            message: `Docker compose down output: ${output}`,
            type: "debug",
            debug: Supabase.isDebug(),
        });
    }

    async isRunning(): Promise<boolean> {
        try {
            const proc = Bun.spawn(["docker", "compose", "ps", "--format", "json"], {
                cwd: this.appDir,
                stdout: "pipe",
            });

            const output = await new Response(proc.stdout).text();
            // Split the output into lines and parse each line as a separate JSON object
            const containers = output
                .trim()
                .split('\n')
                .filter(line => line.length > 0)
                .map(line => JSON.parse(line));
            
            // Define critical services that must be running and healthy
            const criticalServices = [
                'db',          // Database
                'auth',        // Authentication
                'rest',        // REST API
                'storage',     // Storage API
                'kong',        // API Gateway
                'studio'       // Studio UI
            ];

            // Check if all critical services are running and (if applicable) healthy
            const allServicesRunning = criticalServices.every(serviceName => {
                const container = containers.find(c => 
                    c.Service === serviceName || 
                    c.Service === `supabase-${serviceName}`
                );
                
                if (!container) {
                    return false;
                }

                // If container has health check, verify it's healthy
                if (container.Health) {
                    return container.State === 'running' && container.Health === 'healthy';
                }
                
                // If no health check, just verify it's running
                return container.State === 'running';
            });

            return allServicesRunning;

        } catch (error) {
            log({
                message: `Error checking if Supabase is running: ${error}`,
                type: "error",
                debug: Supabase.isDebug(),
            });
            return false;
        }
    }

    async debugStatus(): Promise<void> {
        log({
            message: "Running Supabase debug commands...",
            type: "info",
            debug: Supabase.isDebug(),
        });
        try {
            const dockerPs = Bun.spawn(["docker", "ps", "-a"], {
                cwd: this.appDir,
                stdout: "pipe",
            });
            const dockerPsOutput = await new Response(dockerPs.stdout).text();
            log({
                message: `Docker Containers: ${dockerPsOutput}`,
                type: "info",
                debug: Supabase.isDebug(),
            });

            const dockerLogs = Bun.spawn(
                ["docker", "logs", "supabase_db_app"],
                {
                    cwd: this.appDir,
                    stdout: "pipe",
                },
            );
            const dockerLogsOutput = await new Response(
                dockerLogs.stdout,
            ).text();
            log({
                message: `Supabase DB App Logs: ${dockerLogsOutput}`,
                type: "info",
                debug: Supabase.isDebug(),
            });

            const dockerInspect = Bun.spawn(
                ["docker", "inspect", "supabase_db_app"],
                {
                    cwd: this.appDir,
                    stdout: "pipe",
                },
            );
            const dockerInspectOutput = await new Response(
                dockerInspect.stdout,
            ).text();
            log({
                message: `Supabase DB App Inspect: ${dockerInspectOutput}`,
                type: "info",
                debug: Supabase.isDebug(),
            });
        } catch (error) {
            log({
                message: `Error running debug commands: ${error}`,
                type: "error",
                debug: Supabase.isDebug(),
            });
        }
    }

    public async initializeAdminClient(data: {
        apiUrl: string;
        serviceRoleKey: string;
    }): Promise<void> {
        try {
            this.supabaseAdminClient = createClient(
                data.apiUrl,
                data.serviceRoleKey,
                {
                    auth: {
                        autoRefreshToken: false,
                        persistSession: false,
                    },
                },
            );

            log({
                message: "Supabase admin client initialized successfully",
                type: "success",
                debug: Supabase.isDebug(),
            });
        } catch (error) {
            log({
                message: `Failed to initialize Supabase admin client: ${error}`,
                type: "error",
                debug: Supabase.isDebug(),
            });
            throw error;
        }
    }

    public getAdminClient(): SupabaseClient {
        if (!this.supabaseAdminClient) {
            throw new Error(
                "Admin client not initialized. Ensure Supabase is started.",
            );
        }
        return this.supabaseAdminClient;
    }
}

export default Supabase.getInstance();
