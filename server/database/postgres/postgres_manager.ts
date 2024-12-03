import postgres from "postgres";
import { log } from "../../../sdk/vircadia-world-sdk-ts/module/general/log.ts";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

export class PostgresManager {
    private static instance: PostgresManager | null = null;
    private static debugMode = false;
    private static readonly MIGRATIONS_DIR = path.join(
        dirname(fileURLToPath(import.meta.url)),
        "migration",
    );
    private static readonly CONTAINER_NAME = "vircadia-world-postgres";
    private sql: postgres.Sql | null = null;
    private config!: {
        host: string;
        port: number;
        database: string;
        user: string;
        password: string;
        extensions: string[];
        hardResetDatabase: boolean;
        softResetDatabase: boolean;
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
        extensions: string[];
        hardResetDatabase: boolean;
        softResetDatabase: boolean;
    }): Promise<void> {
        this.config = config;

        log({
            message: "Initializing PostgreSQL connection...",
            type: "info",
            debug: PostgresManager.debugMode,
        });

        try {
            const dockerComposePath = path.join(
                dirname(fileURLToPath(import.meta.url)),
                "docker/docker-compose.yml",
            );

            // Check if container exists and is running
            const process = Bun.spawn([
                "docker",
                "ps",
                "-q",
                "-f",
                `name=${PostgresManager.CONTAINER_NAME}`,
            ]);
            const containerStatus = await new Response(process.stdout).text();
            const containerExists = containerStatus.trim().length > 0;

            if (config.hardResetDatabase || !containerExists) {
                log({
                    message: config.hardResetDatabase
                        ? "Performing hard reset: Recreating PostgreSQL container and volume..."
                        : "PostgreSQL container not found. Creating new container...",
                    type: "info",
                    debug: PostgresManager.debugMode,
                });

                // Stop and remove container with its volume if it exists
                await Bun.spawn([
                    "docker-compose",
                    "-f",
                    dockerComposePath,
                    "down",
                    "-v",
                ]).exited;

                // Set up environment variables for docker-compose
                const env = {
                    POSTGRES_CONTAINER_NAME: PostgresManager.CONTAINER_NAME,
                    POSTGRES_DB: config.database,
                    POSTGRES_USER: config.user,
                    POSTGRES_PASSWORD: config.password,
                    POSTGRES_PORT: config.port.toString(),
                    POSTGRES_EXTENSIONS: config.extensions.join(","),
                };

                // Recreate the container with proper environment variables
                const dockerProcess = Bun.spawn(
                    ["docker-compose", "-f", dockerComposePath, "up", "-d"],
                    {
                        env: env,
                        stderr: "pipe",
                    },
                );

                // Handle stderr differently
                const stderrText = await new Response(
                    dockerProcess.stderr,
                ).text();
                if (stderrText && !stderrText.includes("WARN")) {
                    throw new Error(
                        `Failed to start PostgreSQL container: ${stderrText}`,
                    );
                }
                await dockerProcess.exited;

                // Give it a moment to start up
                await new Promise((resolve) => setTimeout(resolve, 2000));
            } else {
                log({
                    message: "Using existing PostgreSQL container",
                    type: "info",
                    debug: PostgresManager.debugMode,
                });
            }

            // Initialize the client and establish connection
            await this.initializeClient();
            await this.waitForHealthyConnection();
            await this.enableExtensions();

            // For soft reset, clean the database contents
            if (config.softResetDatabase) {
                log({
                    message:
                        "Performing soft reset: Cleaning database contents...",
                    type: "info",
                    debug: PostgresManager.debugMode,
                });
                await this.resetDatabase();
            }

            // Run migrations in all cases
            await this.runMigrations();
        } catch (error) {
            log({
                message: `PostgreSQL initialization failed: ${error.message}`,
                type: "error",
                debug: PostgresManager.debugMode,
            });
            throw error;
        }
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
    }

    private async waitForHealthyConnection(): Promise<void> {
        let attempts = 0;
        const maxAttempts = 30; // 30 seconds timeout

        while (attempts < maxAttempts) {
            try {
                await this.sql`SELECT 1`;
                log({
                    message: "PostgreSQL connection is healthy",
                    type: "success",
                    debug: PostgresManager.debugMode,
                });
                return;
            } catch (error) {
                attempts++;
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
        }

        throw new Error("PostgreSQL connection failed to become healthy");
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

        await Bun.spawn(["docker", "rm", "-f", PostgresManager.CONTAINER_NAME])
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

    public async resetMigrations(hard = false): Promise<void> {
        if (!this.sql) {
            throw new Error(
                "PostgreSQL client not initialized. Call initialize() first.",
            );
        }

        if (hard) {
            log({
                message:
                    "Performing hard reset: Recreating PostgreSQL container...",
                type: "info",
                debug: PostgresManager.debugMode,
            });

            // Stop current connection
            if (this.sql) {
                await this.sql.end();
                this.sql = null;
            }

            // Remove the container
            await Bun.spawn([
                "docker",
                "rm",
                "-f",
                PostgresManager.CONTAINER_NAME,
            ]).exited;

            // Reinitialize the client and wait for healthy connection
            await this.initializeClient();
            await this.waitForHealthyConnection();
        } else {
            log({
                message:
                    "Performing soft reset: Dropping all database objects...",
                type: "info",
                debug: PostgresManager.debugMode,
            });
        }

        // Drop all database objects
        await this.sql.unsafe(`
            DO $$ DECLARE
                r RECORD;
            BEGIN
                -- Drop all tables, views, and types
                FOR r IN (
                    SELECT tablename FROM pg_tables 
                    WHERE schemaname = current_schema()
                    UNION
                    SELECT viewname FROM pg_views 
                    WHERE schemaname = current_schema()
                    UNION
                    SELECT typname FROM pg_type 
                    WHERE typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())
                    AND typtype = 'e'  -- enum types
                ) LOOP
                    EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
                END LOOP;
            END $$;
        `);

        log({
            message: "Database reset complete. Running migrations...",
            type: "info",
            debug: PostgresManager.debugMode,
        });

        // Re-run migrations
        await this.runMigrations();
    }

    public getConnectionString(): string {
        if (!this.config) {
            throw new Error(
                "PostgreSQL not configured. Call initialize() first.",
            );
        }
        return `postgres://${this.config.user}:${this.config.password}@${this.config.host}:${this.config.port}/${this.config.database}`;
    }

    private async enableExtensions(): Promise<void> {
        if (!this.sql) {
            throw new Error("PostgreSQL client not initialized");
        }

        // Simply create the extensions as they should already be installed by Trunk
        for (const extension of this.config.extensions) {
            try {
                await this.sql.unsafe(
                    `CREATE EXTENSION IF NOT EXISTS "${extension}"`,
                );

                log({
                    message: `Enabled PostgreSQL extension: ${extension}`,
                    type: "success",
                    debug: PostgresManager.debugMode,
                });
            } catch (error) {
                log({
                    message: `Failed to enable extension ${extension}: ${error.message}`,
                    type: "warning",
                    debug: PostgresManager.debugMode,
                });
            }
        }
    }

    // New method to handle database reset
    private async resetDatabase(): Promise<void> {
        if (!this.sql) {
            throw new Error("PostgreSQL client not initialized");
        }

        log({
            message: "Dropping all database objects...",
            type: "info",
            debug: PostgresManager.debugMode,
        });

        // Drop all database objects including enums
        await this.sql.unsafe(`
            DO $$ DECLARE
                r RECORD;
            BEGIN
                -- Disable all triggers
                FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = current_schema()) LOOP
                    EXECUTE 'ALTER TABLE IF EXISTS ' || quote_ident(r.tablename) || ' DISABLE TRIGGER ALL';
                END LOOP;

                -- Drop all tables
                FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = current_schema()) LOOP
                    EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
                END LOOP;

                -- Drop all views
                FOR r IN (SELECT viewname FROM pg_views WHERE schemaname = current_schema()) LOOP
                    EXECUTE 'DROP VIEW IF EXISTS ' || quote_ident(r.viewname) || ' CASCADE';
                END LOOP;

                -- Drop all enums
                FOR r IN (
                    SELECT t.typname
                    FROM pg_type t
                    JOIN pg_namespace n ON t.typnamespace = n.oid
                    WHERE n.nspname = current_schema()
                    AND t.typtype = 'e'
                ) LOOP
                    EXECUTE 'DROP TYPE IF EXISTS ' || quote_ident(r.typname) || ' CASCADE';
                END LOOP;
            END $$;
        `);

        log({
            message: "Database reset complete",
            type: "info",
            debug: PostgresManager.debugMode,
        });
    }
}
