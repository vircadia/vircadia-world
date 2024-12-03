import postgres from "postgres";
import { log } from "../../../sdk/vircadia-world-sdk-ts/module/general/log.ts";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export class PostgresManager {
    private static instance: PostgresManager | null = null;
    private static debugMode = false;
    private static readonly MIGRATIONS_DIR = "./migration";
    private sql: postgres.Sql | null = null;
    private config!: {
        host: string;
        port: number;
        database: string;
        user: string;
        password: string;
        containerName: string;
    };

    private constructor() {}

    public static getInstance(debug = false): PostgresManager {
        if (!PostgresManager.instance) {
            PostgresManager.instance = new PostgresManager();
        }
        PostgresManager.debugMode = debug;
        return PostgresManager.instance;
    }

    public async initialize(config: {
        host: string;
        port: number;
        database: string;
        user: string;
        password: string;
        containerName: string;
    }): Promise<void> {
        this.config = config;

        log({
            message: "Initializing PostgreSQL...",
            type: "info",
            debug: PostgresManager.debugMode,
        });

        try {
            await this.startContainer();
            await this.waitForHealthyContainer();
            await this.initializeClient();
        } catch (error) {
            log({
                message: `PostgreSQL initialization failed: ${error.message}`,
                type: "error",
                debug: PostgresManager.debugMode,
            });
            throw error;
        }
    }

    private async startContainer(): Promise<void> {
        // Stop existing container if it exists - ignore errors
        try {
            await Bun.spawn(["docker", "rm", "-f", this.config.containerName])
                .exited;
        } catch (error) {
            // Ignore errors when container doesn't exist
            log({
                message: `Container removal skipped: ${error.message}`,
                type: "info",
                debug: PostgresManager.debugMode,
            });
        }

        // Pull the postgres image first
        log({
            message: "Pulling PostgreSQL image...",
            type: "info",
            debug: PostgresManager.debugMode,
        });

        const pullProc = Bun.spawn(["docker", "pull", "postgres:latest"], {
            stdout: "pipe",
        });

        // Stream the pull output
        const reader = pullProc.stdout.getReader();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const output = new TextDecoder().decode(value);
            log({
                message: output.trim(),
                type: "info",
                debug: PostgresManager.debugMode,
            });
        }

        const pullProcExitCode = await pullProc.exited;
        if (pullProcExitCode !== 0) {
            throw new Error("Failed to pull PostgreSQL image");
        }

        // Start the container
        const proc = Bun.spawn([
            "docker",
            "run",
            "-d",
            "--name",
            this.config.containerName,
            "-p",
            `${this.config.port}:5432`,
            "-e",
            `POSTGRES_DB=${this.config.database}`,
            "-e",
            `POSTGRES_USER=${this.config.user}`,
            "-e",
            `POSTGRES_PASSWORD=${this.config.password}`,
            "postgres:latest",
        ]);

        const procExitCode = await proc.exited;

        if (procExitCode !== 0) {
            throw new Error("Failed to start PostgreSQL container");
        }
    }

    private async waitForHealthyContainer(): Promise<void> {
        let attempts = 0;
        const maxAttempts = 30; // 30 seconds timeout

        while (attempts < maxAttempts) {
            const proc = Bun.spawn([
                "docker",
                "exec",
                this.config.containerName,
                "pg_isready",
                "-U",
                this.config.user,
            ]);

            const exitCode = await proc.exited;

            if (exitCode === 0) {
                log({
                    message: "PostgreSQL container is healthy",
                    type: "success",
                    debug: PostgresManager.debugMode,
                });
                return;
            }

            attempts++;
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        throw new Error("PostgreSQL container failed to become healthy");
    }

    private async initializeClient(): Promise<void> {
        this.sql = postgres({
            host: this.config.host,
            port: this.config.port,
            database: this.config.database,
            username: this.config.user,
            password: this.config.password,
            onnotice: () => {}, // Suppress notice messages
        });

        // Test connection
        try {
            await this.sql`SELECT 1`;
            log({
                message: "PostgreSQL client connected successfully",
                type: "success",
                debug: PostgresManager.debugMode,
            });
        } catch (error) {
            throw new Error(
                `Failed to connect to PostgreSQL: ${error.message}`,
            );
        }
    }

    private async createMigrationsTable(): Promise<void> {
        if (!this.sql) {
            throw new Error(
                "PostgreSQL client not initialized. Call initialize() first.",
            );
        }

        await this.sql`
            CREATE TABLE IF NOT EXISTS migrations (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `;
    }

    private async getExecutedMigrations(): Promise<string[]> {
        if (!this.sql) {
            throw new Error(
                "PostgreSQL client not initialized. Call initialize() first.",
            );
        }

        const result = await this.sql`
            SELECT name FROM migrations ORDER BY id
        `;
        return result.map((r) => r.name);
    }

    public async runMigrations(): Promise<void> {
        if (!this.sql) {
            throw new Error(
                "PostgreSQL client not initialized. Call initialize() first.",
            );
        }

        log({
            message: "Running database migrations...",
            type: "info",
            debug: PostgresManager.debugMode,
        });

        await this.createMigrationsTable();

        // Get list of migration files
        const files = await readdir(PostgresManager.MIGRATIONS_DIR);
        const sqlFiles = files.filter((f) => f.endsWith(".sql")).sort();

        // Get already executed migrations
        const executedMigrations = await this.getExecutedMigrations();

        // Run pending migrations
        for (const file of sqlFiles) {
            if (!executedMigrations.includes(file)) {
                try {
                    const filePath = path.join(
                        PostgresManager.MIGRATIONS_DIR,
                        file,
                    );
                    const sqlContent = await readFile(filePath, "utf-8");

                    // Run the migration in a transaction
                    await this.sql.begin(async (sql) => {
                        await sql.unsafe(sqlContent);
                        await sql`
                            INSERT INTO migrations (name)
                            VALUES (${file})
                        `;
                    });

                    log({
                        message: `Migration ${file} executed successfully`,
                        type: "success",
                        debug: PostgresManager.debugMode,
                    });
                } catch (error) {
                    log({
                        message: `Failed to run migration ${file}: ${error.message}`,
                        type: "error",
                        debug: PostgresManager.debugMode,
                    });
                    throw error;
                }
            }
        }
    }

    public getClient(): postgres.Sql {
        if (!this.sql) {
            throw new Error(
                "PostgreSQL client not initialized. Call initialize() first.",
            );
        }
        return this.sql;
    }

    public async stop(): Promise<void> {
        if (this.sql) {
            await this.sql.end();
            this.sql = null;
        }

        await Bun.spawn(["docker", "rm", "-f", this.config.containerName])
            .exited;

        log({
            message: "PostgreSQL stopped",
            type: "info",
            debug: PostgresManager.debugMode,
        });
    }

    public async isHealthy(): Promise<boolean> {
        if (!this.sql) return false;

        try {
            await this.sql`SELECT 1`;
            return true;
        } catch {
            return false;
        }
    }
}
