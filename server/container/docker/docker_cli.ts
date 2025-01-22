import { VircadiaConfig_Server } from "../../../sdk/vircadia-world-sdk-ts/config/vircadia.config.ts";
import { log } from "../../../sdk/vircadia-world-sdk-ts/module/general/log.ts";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { createConnection } from "node:net";
import postgres from "postgres";
import { readdir, readFile } from "node:fs/promises";
import { sign } from "jsonwebtoken";

const DOCKER_COMPOSE_PATH = path.join(
    dirname(fileURLToPath(import.meta.url)),
    "/docker-compose.yml",
);

const POSTGRES_MIGRATIONS_DIR = path.join(
    dirname(fileURLToPath(import.meta.url)),
    "../../database/postgres/migration",
);

function getDockerEnv() {
    const config = VircadiaConfig_Server;
    return {
        CONTAINER_NAME: config.containerName,
        POSTGRES_DB: config.postgres.database,
        POSTGRES_USER: config.postgres.user,
        POSTGRES_PASSWORD: config.postgres.password,
        POSTGRES_PORT: config.postgres.port.toString(),
        POSTGRES_EXTENSIONS: config.postgres.extensions.join(","),
        PGWEB_PORT: config.pgweb.port.toString(),
    };
}

async function runDockerCommand(args: string[], env = getDockerEnv()) {
    const processEnv = {
        ...process.env,
        ...env,
        PATH: process.env.PATH,
    };

    // Log the command being executed
    log({
        message: `[Docker Command] docker-compose -f ${DOCKER_COMPOSE_PATH} ${args.join(" ")}`,
        type: "debug",
    });

    const spawnedProcess = Bun.spawn(
        ["docker", "compose", "-f", DOCKER_COMPOSE_PATH, ...args],
        {
            env: processEnv,
            stdout: "pipe",
            stderr: "pipe",
        },
    );

    const stdout = await new Response(spawnedProcess.stdout).text();
    const stderr = await new Response(spawnedProcess.stderr).text();

    // Always log output for better debugging
    if (stdout) {
        log({
            message: `[Docker Command Output]\n${stdout}`,
            type: "info",
        });
    }
    if (stderr) {
        log({
            message: `[Docker Command Output]\n${stderr}`,
            type: "info",
        });
    }

    const exitCode = await spawnedProcess.exitCode;

    // For 'down' commands and 'up' commands, stderr output is expected and not an error
    const isExpectedOutput = args.includes("down") || args.includes("up");
    if (exitCode !== 0 && !isExpectedOutput) {
        throw new Error(
            `Docker command failed with exit code ${exitCode}.\nStdout: ${stdout}\nStderr: ${stderr}`,
        );
    }
}

export async function isHealthy(): Promise<{
    postgres: boolean;
}> {
    const config = VircadiaConfig_Server;

    const checkPostgres = async (): Promise<boolean> => {
        return new Promise((resolve) => {
            const socket = createConnection({
                host: config.postgres.host,
                port: config.postgres.port,
            })
                .on("connect", () => {
                    socket.end();
                    resolve(true);
                })
                .on("error", () => {
                    resolve(false);
                });

            socket.setTimeout(1000);
            socket.on("timeout", () => {
                socket.destroy();
                resolve(false);
            });
        });
    };

    const [postgresHealth] = await Promise.all([checkPostgres()]);

    return { postgres: postgresHealth };
}

async function waitForHealthy(
    timeoutSeconds = 30,
    intervalMs = 1000,
): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutSeconds * 1000) {
        const health = await isHealthy();
        if (health.postgres) {
            return true;
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return false;
}

export async function up(env = getDockerEnv()) {
    log({
        message: `Starting ${env.CONTAINER_NAME} services...`,
        type: "info",
    });
    await runDockerCommand(["up", "-d", "--build"]);

    log({
        message: `Waiting for ${env.CONTAINER_NAME} services to be ready...`,
        type: "info",
    });
    if (!(await waitForHealthy())) {
        throw new Error(
            `${env.CONTAINER_NAME} services failed to start properly after 30 seconds`,
        );
    }
    log({
        message: `${env.CONTAINER_NAME} services are ready`,
        type: "success",
    });

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
        // Add migration execution here
        log({
            message: `Running initial migrations for ${env.CONTAINER_NAME}...`,
            type: "info",
        });
        await seed(sql); // Pass the existing SQL connection
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
        message: `${env.CONTAINER_NAME} container started with extensions installed and migrations applied`,
        type: "success",
    });
}

export async function down(env = getDockerEnv()) {
    log({
        message: `Stopping ${env.CONTAINER_NAME} container...`,
        type: "info",
    });
    await runDockerCommand(["down"]);
    log({
        message: `${env.CONTAINER_NAME} container stopped`,
        type: "success",
    });
}

export async function rebuildContainer(env = getDockerEnv()) {
    log({
        message: `Performing hard reset of ${env.CONTAINER_NAME} container...`,
        type: "info",
    });
    await runDockerCommand(["down", "-v"]);
    log({
        message: `Container ${env.CONTAINER_NAME} removed, rebuilding...`,
        type: "info",
    });
    await runDockerCommand(["up", "-d", "--build"]);
    log({
        message: `${env.CONTAINER_NAME} container reset complete, running migrations...`,
        type: "info",
    });
    await seed();
    log({
        message: `${env.CONTAINER_NAME} database migrations applied`,
        type: "success",
    });
}

export async function softResetDatabase(env = getDockerEnv()) {
    log({
        message: `Performing soft reset of ${env.CONTAINER_NAME} database...`,
        type: "info",
    });

    const config = VircadiaConfig_Server.postgres;
    const sql = postgres({
        host: config.host,
        port: config.port,
        database: config.database,
        username: config.user,
        password: config.password,
    });

    try {
        // Drop specific schemas and their contents
        await sql.unsafe(`
            DO $$ DECLARE
                r RECORD;
            BEGIN
                -- Drop specific schemas and all their contents
                DROP SCHEMA IF EXISTS public CASCADE;
                DROP SCHEMA IF EXISTS auth CASCADE;
                DROP SCHEMA IF EXISTS entity CASCADE;
                DROP SCHEMA IF EXISTS tick CASCADE;
                DROP SCHEMA IF EXISTS config CASCADE;
                -- Recreate the public schema (this is required for PostgreSQL)
                CREATE SCHEMA public;
                GRANT ALL ON SCHEMA public TO PUBLIC;
            END $$;
        `);

        log({
            message: `${env.CONTAINER_NAME} database reset complete. Running migrations...`,
            type: "info",
        });
        await seed(sql);
    } finally {
        await sql.end();
    }
}

export async function seed(
    existingClient?: postgres.Sql,
    env = getDockerEnv(),
) {
    const config = VircadiaConfig_Server;
    const sql =
        existingClient ||
        postgres({
            host: config.postgres.host,
            port: config.postgres.port,
            database: config.postgres.database,
            username: config.postgres.user,
            password: config.postgres.password,
        });

    try {
        for (const name of config.postgres.extensions) {
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

        log({
            message: `Running ${env.CONTAINER_NAME} database migrations...`,
            type: "info",
        });

        // Create migrations table if it doesn't exist
        await sql`
            CREATE TABLE IF NOT EXISTS migrations (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `;

        // Get list of migration files
        const files = await readdir(POSTGRES_MIGRATIONS_DIR);
        const sqlFiles = files.filter((f) => f.endsWith(".sql")).sort();

        // Get already executed migrations
        const result = await sql`SELECT name FROM migrations ORDER BY id`;
        const executedMigrations = result.map((r) => r.name);

        // Run pending migrations
        for (const file of sqlFiles) {
            if (!executedMigrations.includes(file)) {
                try {
                    const filePath = path.join(POSTGRES_MIGRATIONS_DIR, file);
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
        case "rebuild-container":
            await rebuildContainer();
            break;
        case "health": {
            const health = await isHealthy();
            log({
                message: `PostgreSQL: ${health.postgres ? "healthy" : "unhealthy"}`,
                type: "info",
            });
            break;
        }
        case "db:soft-reset":
            await softResetDatabase();
            break;
        case "db:migrate":
            await seed();
            break;
        case "db:connection-string": {
            const config = VircadiaConfig_Server.postgres;
            log({
                message: `PostgreSQL Connection String:\n\npostgres://${config.user}:${config.password}@${config.host}:${config.port}/${config.database}\n`,
                type: "info",
            });
            break;
        }
        case "restart":
            await restart();
            break;
        case "pgweb:access-command": {
            const config = VircadiaConfig_Server;
            const isRemoteHost = !["localhost", "127.0.0.1"].includes(
                config.postgres.host,
            );

            const accessMessage = isRemoteHost
                ? `1. First create SSH tunnel:\nssh -L ${config.pgweb.port}:localhost:${config.pgweb.port} username@${config.postgres.host}\n\n2. Then access pgweb at:`
                : "Access pgweb at:";

            log({
                message: `${accessMessage}\nhttp://localhost:${config.pgweb.port}\n`,
                type: "info",
            });
            break;
        }
        case "admin:token": {
            const config = VircadiaConfig_Server.postgres;
            const sql = postgres({
                host: config.host,
                port: config.port,
                database: config.database,
                username: config.user,
                password: config.password,
            });

            try {
                const [result] =
                    await sql`SELECT generate_admin_token() as token`;
                const tokenData = JSON.parse(result.token);

                // Generate JWT token
                const token = sign(
                    {
                        sessionId: tokenData.session_id,
                        agentId: tokenData.agent_id,
                    },
                    VircadiaConfig_Server.auth.jwt.secret,
                    {
                        expiresIn:
                            VircadiaConfig_Server.auth.adminToken
                                .sessionDuration,
                    },
                );

                log({
                    message: `Generated admin token:\n${token}\n\nExpires in ${VircadiaConfig_Server.auth.adminToken.sessionDuration}`,
                    type: "success",
                });
            } catch (error) {
                log({
                    message: `Failed to generate admin token: ${error.message}`,
                    type: "error",
                });
            } finally {
                await sql.end();
            }
            break;
        }
        default:
            console.error(
                "Valid commands: up, down, rebuild-container, health, db:soft-reset, db:migrate, db:connection-string, pgweb:access-command, restart",
            );
            process.exit(1);
    }
}
