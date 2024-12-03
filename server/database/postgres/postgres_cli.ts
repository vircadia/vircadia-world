import { VircadiaConfig_Server } from "../../vircadia.server.config.ts";
import { log } from "../../../sdk/vircadia-world-sdk-ts/module/general/log.ts";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { createConnection } from "node:net";
import postgres from "postgres";
import { readdir, readFile } from "node:fs/promises";

const DOCKER_COMPOSE_PATH = path.join(
    dirname(fileURLToPath(import.meta.url)),
    "docker/docker-compose.yml",
);

const MIGRATIONS_DIR = path.join(
    dirname(fileURLToPath(import.meta.url)),
    "migration",
);

function getDockerEnv() {
    const config = VircadiaConfig_Server.postgres;
    return {
        POSTGRES_CONTAINER_NAME: config.containerName,
        POSTGRES_DB: config.database,
        POSTGRES_USER: config.user,
        POSTGRES_PASSWORD: config.password,
        POSTGRES_PORT: config.port.toString(),
        POSTGRES_EXTENSIONS: config.extensions.join(","),
    };
}

async function runDockerCommand(args: string[], env = getDockerEnv()) {
    const config = VircadiaConfig_Server;
    const process = Bun.spawn(
        ["docker-compose", "-f", DOCKER_COMPOSE_PATH, ...args],
        {
            env,
            stdout: "pipe",
            stderr: "pipe",
        },
    );

    const stdout = await new Response(process.stdout).text();
    const stderr = await new Response(process.stderr).text();

    if (config.debug) {
        log({
            message: `[Docker Command]\ndocker-compose -f ${DOCKER_COMPOSE_PATH} ${args.join(" ")}`,
            type: "debug",
        });
    }

    const exitCode = await process.exited;
    if (exitCode !== 0 || config.debug) {
        if (stdout) {
            log({
                message: `[Docker Command Output]\n${stdout}`,
                type: exitCode === 0 ? "debug" : "info",
            });
        }
        if (stderr) {
            log({
                message: `[Docker Command Error]\n${stderr}`,
                type: "error",
            });
        }
    }

    if (exitCode !== 0) {
        throw new Error(
            `Docker command failed with exit code ${exitCode}. Check logs above for details.`,
        );
    }
}

export async function isHealthy(): Promise<boolean> {
    const config = VircadiaConfig_Server.postgres;
    return new Promise((resolve) => {
        const socket = createConnection({
            host: config.host,
            port: config.port,
        })
            .on("connect", () => {
                socket.end();
                resolve(true);
            })
            .on("error", () => {
                resolve(false);
            });

        // Set timeout for connection attempt
        socket.setTimeout(1000);
        socket.on("timeout", () => {
            socket.destroy();
            resolve(false);
        });
    });
}

async function waitForHealthy(
    timeoutSeconds = 30,
    intervalMs = 1000,
): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutSeconds * 1000) {
        if (await isHealthy()) {
            return true;
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return false;
}

export async function up() {
    log({ message: "Starting PostgreSQL container...", type: "info" });
    await runDockerCommand(["up", "-d", "--build"]);

    // Wait for PostgreSQL to be healthy before continuing
    log({ message: "Waiting for PostgreSQL to be ready...", type: "info" });
    if (!(await waitForHealthy())) {
        throw new Error("PostgreSQL failed to start properly after 30 seconds");
    }
    log({ message: "PostgreSQL is ready", type: "success" });

    const config = VircadiaConfig_Server.postgres;

    // Add a small delay to ensure container is fully initialized
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Create and activate extensions
    const sql = postgres({
        host: config.host,
        port: config.port,
        database: config.database,
        username: config.user,
        password: config.password,
    });

    try {
        for (const name of config.extensions) {
            log({
                message: `Installing PostgreSQL extension: ${name}...`,
                type: "info",
            });
            await sql`CREATE EXTENSION IF NOT EXISTS ${sql(name)};`;
            log({
                message: `PostgreSQL extension ${name} installed successfully`,
                type: "success",
            });
        }

        // Add migration execution here
        log({ message: "Running initial migrations...", type: "info" });
        await runMigrations(sql); // Pass the existing SQL connection
    } catch (error) {
        log({
            message: `Failed to initialize database: ${error.message}`,
            type: "error",
        });
        throw error;
    } finally {
        await sql.end();
    }

    log({
        message:
            "PostgreSQL container started with extensions installed and migrations applied",
        type: "success",
    });
}

export async function down() {
    log({ message: "Stopping PostgreSQL container...", type: "info" });
    await runDockerCommand(["down"]);
    log({ message: "PostgreSQL container stopped", type: "success" });
}

export async function hardReset() {
    log({
        message: "Performing hard reset of PostgreSQL container...",
        type: "info",
    });
    await runDockerCommand(["down", "-v"]);
    await runDockerCommand(["up", "-d", "--build"]);
    log({ message: "PostgreSQL container reset complete", type: "success" });
}

export function connectionString(): void {
    const config = VircadiaConfig_Server.postgres;
    log({
        message: `PostgreSQL Connection String:\n\npostgres://${config.user}:${config.password}@${config.host}:${config.port}/${config.database}\n`,
        type: "info",
    });
}

export async function softResetDatabase() {
    log({ message: "Performing soft reset of database...", type: "info" });

    const config = VircadiaConfig_Server.postgres;
    const sql = postgres({
        host: config.host,
        port: config.port,
        database: config.database,
        username: config.user,
        password: config.password,
    });

    try {
        // Drop all database objects including enums
        await sql.unsafe(`
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
            message: "Database reset complete. Running migrations...",
            type: "info",
        });
        await runMigrations(sql);
    } finally {
        await sql.end();
    }
}

export async function runMigrations(existingClient?: postgres.Sql) {
    const config = VircadiaConfig_Server.postgres;
    const sql =
        existingClient ||
        postgres({
            host: config.host,
            port: config.port,
            database: config.database,
            username: config.user,
            password: config.password,
        });

    try {
        log({ message: "Running database migrations...", type: "info" });

        // Create migrations table if it doesn't exist
        await sql`
            CREATE TABLE IF NOT EXISTS migrations (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `;

        // Get list of migration files
        const files = await readdir(MIGRATIONS_DIR);
        const sqlFiles = files.filter((f) => f.endsWith(".sql")).sort();

        // Get already executed migrations
        const result = await sql`SELECT name FROM migrations ORDER BY id`;
        const executedMigrations = result.map((r) => r.name);

        // Run pending migrations
        for (const file of sqlFiles) {
            if (!executedMigrations.includes(file)) {
                try {
                    const filePath = path.join(MIGRATIONS_DIR, file);
                    const sqlContent = await readFile(filePath, "utf-8");

                    // Run the migration in a transaction
                    await sql.begin(async (sql) => {
                        await sql.unsafe(sqlContent);
                        await sql`
                            INSERT INTO migrations (name)
                            VALUES (${file})
                        `;
                    });

                    log({
                        message: `Migration ${file} executed successfully`,
                        type: "success",
                    });
                } catch (error) {
                    log({
                        message: `Failed to run migration ${file}: ${error.message}`,
                        type: "error",
                    });
                    throw error;
                }
            }
        }
    } finally {
        if (!existingClient) {
            await sql.end();
        }
    }
}

export async function restart() {
    await down();
    await up();
}

// If this file is run directly
if (import.meta.main) {
    const command = Bun.argv[2];
    switch (command) {
        case "up":
            await up();
            break;
        case "down":
            await down();
            break;
        case "hard-reset":
            await hardReset();
            break;
        case "health":
            console.log(await isHealthy());
            break;
        case "soft-reset":
            await softResetDatabase();
            break;
        case "migrate":
            await runMigrations();
            break;
        case "connection-string":
            connectionString();
            break;
        case "restart":
            await restart();
            break;
        default:
            console.error(
                "Valid commands: up, down, hard-reset, health, soft-reset, migrate, connection-string, restart",
            );
            process.exit(1);
    }
}
