import { VircadiaConfig_Server } from "../../../sdk/vircadia-world-sdk-ts/config/vircadia.config.ts";
import { log } from "../../../sdk/vircadia-world-sdk-ts/module/general/log.ts";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { sign } from "jsonwebtoken";
import { PostgresClient } from "../../database/postgres/postgres_client";
import type { Config } from "../../../sdk/vircadia-world-sdk-ts/schema/schema.general.ts";

const DOCKER_COMPOSE_PATH = path.join(
    dirname(fileURLToPath(import.meta.url)),
    "/docker-compose.yml",
);

const POSTGRES_MIGRATIONS_DIR = path.join(
    dirname(fileURLToPath(import.meta.url)),
    "../../database/postgres/migration",
);

const DEFAULT_POSTGRES_SEEDS_DIR = VircadiaConfig_Server.postgres.seedsPath
    ? path.resolve(VircadiaConfig_Server.postgres.seedsPath)
    : path.join(
          dirname(fileURLToPath(import.meta.url)),
          "../../database/postgres/seed",
      );

export function getDockerEnv() {
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

// Update runDockerCommand to use suppress from config
async function runDockerCommand(args: string[]) {
    const processEnv = {
        ...process.env,
        ...getDockerEnv(),
        PATH: process.env.PATH,
    };

    log({
        message: `[Docker Command] docker-compose -f ${DOCKER_COMPOSE_PATH} ${args.join(" ")}`,
        type: "debug",
        suppress: VircadiaConfig_Server.suppress,
        debug: VircadiaConfig_Server.debug,
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

    if (stdout) {
        log({
            message: `[Docker Command Output]\n${stdout}`,
            type: "info",
            suppress: VircadiaConfig_Server.suppress,
            debug: VircadiaConfig_Server.debug,
        });
    }
    if (stderr) {
        log({
            message: `[Docker Command Output]\n${stderr}`,
            type: "info",
            suppress: VircadiaConfig_Server.suppress,
            debug: VircadiaConfig_Server.debug,
        });
    }

    const exitCode = await spawnedProcess.exitCode;

    const isExpectedOutput = args.includes("down") || args.includes("up");
    if (exitCode !== 0 && !isExpectedOutput) {
        throw new Error(
            `Docker command failed with exit code ${exitCode}.\nStdout: ${stdout}\nStderr: ${stderr}`,
        );
    }
}

export async function isHealthy(): Promise<{
    isHealthy: boolean;
    services: {
        postgres: {
            isHealthy: boolean;
            error?: Error;
        };
        pgweb: {
            isHealthy: boolean;
            error?: Error;
        };
    };
}> {
    const config = VircadiaConfig_Server;

    const checkPostgres = async (): Promise<{
        isHealthy: boolean;
        error?: Error;
    }> => {
        try {
            const db = PostgresClient.getInstance();
            await db.connect();
            const sql = db.getClient();
            await sql`SELECT 1`;
            return { isHealthy: true };
        } catch (error: unknown) {
            return { isHealthy: false, error: error as Error };
        }
    };

    const checkPgweb = async (): Promise<{
        isHealthy: boolean;
        error?: Error;
    }> => {
        try {
            const response = await fetch(
                `http://localhost:${config.pgweb.port}`,
            );
            return { isHealthy: response.ok };
        } catch (error: unknown) {
            return { isHealthy: false, error: error as Error };
        }
    };

    const [postgresHealth, pgwebHealth] = await Promise.all([
        checkPostgres(),
        checkPgweb(),
    ]);

    return {
        isHealthy: postgresHealth.isHealthy && pgwebHealth.isHealthy,
        services: {
            postgres: postgresHealth,
            pgweb: pgwebHealth,
        },
    };
}

async function waitForHealthy(
    timeoutSeconds = 30,
    intervalMs = 1000,
): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutSeconds * 1000) {
        const health = await isHealthy();
        if (health.isHealthy) {
            return true;
        }
        await Bun.sleep(intervalMs);
    }
    return false;
}

// Update function signatures to remove silent parameter
export async function up() {
    const env = getDockerEnv();

    log({
        message: `Starting ${env.CONTAINER_NAME} services...`,
        type: "info",
        suppress: VircadiaConfig_Server.suppress,
        debug: VircadiaConfig_Server.debug,
    });
    await runDockerCommand(["up", "-d", "--build"]);

    log({
        message: `Waiting for ${env.CONTAINER_NAME} services to be ready...`,
        type: "info",
        suppress: VircadiaConfig_Server.suppress,
        debug: VircadiaConfig_Server.debug,
    });
    if (!(await waitForHealthy())) {
        throw new Error(
            `${env.CONTAINER_NAME} services failed to start properly after 30 seconds`,
        );
    }
    log({
        message: `${env.CONTAINER_NAME} services are ready`,
        type: "success",
        suppress: VircadiaConfig_Server.suppress,
        debug: VircadiaConfig_Server.debug,
    });

    // Create and activate extensions
    const db = PostgresClient.getInstance();
    await db.connect();

    try {
        // Add migration execution here
        log({
            message: `Running initial migrations for ${env.CONTAINER_NAME}...`,
            type: "info",
            suppress: VircadiaConfig_Server.suppress,
            debug: VircadiaConfig_Server.debug,
        });
        await migrate({});
    } catch (error) {
        log({
            message: "Failed to initialize database.",
            type: "error",
            error: error,
            suppress: VircadiaConfig_Server.suppress,
            debug: VircadiaConfig_Server.debug,
        });
        throw error;
    }

    log({
        message: `${env.CONTAINER_NAME} container started successfully.`,
        type: "success",
        suppress: VircadiaConfig_Server.suppress,
        debug: VircadiaConfig_Server.debug,
    });
}

// Update down function
export async function down() {
    const env = getDockerEnv();

    log({
        message: `Stopping ${env.CONTAINER_NAME} container...`,
        type: "info",
        suppress: VircadiaConfig_Server.suppress,
        debug: VircadiaConfig_Server.debug,
    });
    await runDockerCommand(["down"]);
    log({
        message: `${env.CONTAINER_NAME} container stopped`,
        type: "success",
        suppress: VircadiaConfig_Server.suppress,
        debug: VircadiaConfig_Server.debug,
    });
}

// Update rebuildContainer function
export async function rebuildContainer() {
    const env = getDockerEnv();

    log({
        message: `Performing hard reset of ${env.CONTAINER_NAME} container...`,
        type: "info",
        suppress: VircadiaConfig_Server.suppress,
        debug: VircadiaConfig_Server.debug,
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
        suppress: VircadiaConfig_Server.suppress,
        debug: VircadiaConfig_Server.debug,
    });
    await migrate({
        runSeeds: true,
    });
    log({
        message: `${env.CONTAINER_NAME} database migrations applied`,
        type: "success",
        suppress: VircadiaConfig_Server.suppress,
        debug: VircadiaConfig_Server.debug,
    });
}

// Update softResetDatabase function
export async function softResetDatabase() {
    const env = getDockerEnv();

    log({
        message: `Performing soft reset of ${env.CONTAINER_NAME} database...`,
        type: "info",
        suppress: VircadiaConfig_Server.suppress,
        debug: VircadiaConfig_Server.debug,
    });

    const db = PostgresClient.getInstance();
    await db.connect();
    const sql = db.getClient();

    await sql.unsafe(`
        DO $$ 
        DECLARE
            pubname RECORD;
        BEGIN
            -- Drop publications if they exist
            FOR pubname IN (SELECT p.pubname AS publication_name FROM pg_publication p)
            LOOP
                EXECUTE 'DROP PUBLICATION ' || quote_ident(pubname.publication_name);
            END LOOP;

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
        suppress: VircadiaConfig_Server.suppress,
        debug: VircadiaConfig_Server.debug,
    });
    await migrate({
        runSeeds: true, // Always run seeds after a reset
    });

    log({
        message: `${env.CONTAINER_NAME} container soft reset complete.`,
        type: "success",
        suppress: VircadiaConfig_Server.suppress,
        debug: VircadiaConfig_Server.debug,
    });
}

// Update migrate function signature and remove silent parameter
export async function migrate(data: {
    runSeeds?: boolean;
}) {
    const env = getDockerEnv();
    let migrationsRan = false;

    const db = PostgresClient.getInstance();
    await db.connect();
    const sql = db.getClient();

    for (const name of VircadiaConfig_Server.postgres.extensions) {
        log({
            message: `Installing PostgreSQL extension: ${name}...`,
            type: "info",
            suppress: VircadiaConfig_Server.suppress,
            debug: VircadiaConfig_Server.debug,
        });
        await sql`CREATE EXTENSION IF NOT EXISTS ${sql(name)};`;
        log({
            message: `PostgreSQL extension ${name} installed successfully`,
            type: "success",
            suppress: VircadiaConfig_Server.suppress,
            debug: VircadiaConfig_Server.debug,
        });
    }

    log({
        message: `Running ${env.CONTAINER_NAME} database migrations...`,
        type: "info",
        suppress: VircadiaConfig_Server.suppress,
        debug: VircadiaConfig_Server.debug,
    });

    // Create config schema and migrations table if they don't exist
    await sql.unsafe("CREATE SCHEMA IF NOT EXISTS config");

    await sql.unsafe(`
        CREATE TABLE IF NOT EXISTS config.migrations (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Get list of migration files
    const files = await readdir(POSTGRES_MIGRATIONS_DIR);
    const sqlFiles = files.filter((f) => f.endsWith(".sql")).sort();

    // Get already executed migrations
    const result = await sql`SELECT name FROM config.migrations ORDER BY id`;
    const executedMigrations = result.map((r) => r.name);

    // Run pending migrations
    for (const file of sqlFiles) {
        if (!executedMigrations.includes(file)) {
            migrationsRan = true; // Set flag when a migration runs
            try {
                const filePath = path.join(POSTGRES_MIGRATIONS_DIR, file);
                const sqlContent = await readFile(filePath, "utf-8");

                // Run the migration in a transaction
                await sql.begin(async (sql) => {
                    await sql.unsafe(sqlContent);
                    await sql`
                        INSERT INTO config.migrations (name)
                        VALUES (${file})
                    `;
                });

                log({
                    message: `Migration ${file} executed successfully`,
                    type: "success",
                    suppress: VircadiaConfig_Server.suppress,
                    debug: VircadiaConfig_Server.debug,
                });
            } catch (error) {
                log({
                    message: `Failed to run migration ${file}.`,
                    type: "error",
                    error: error,
                    suppress: VircadiaConfig_Server.suppress,
                    debug: VircadiaConfig_Server.debug,
                });
                throw error;
            }
        }
    }

    // Run seeds if explicitly requested or if migrations were executed
    if (data.runSeeds || migrationsRan) {
        log({
            message: "Running seeds after migration...",
            type: "info",
        });
        await seed({});
    }

    log({
        message: `${env.CONTAINER_NAME} container migrations applied`,
        type: "success",
    });
}

// Update seed function signature
export async function seed(data: {
    seedPath?: string;
}) {
    const env = getDockerEnv();

    const db = PostgresClient.getInstance();
    await db.connect();
    const sql = db.getClient();

    // Ensure we resolve the seed path to absolute path
    const seedDir = data.seedPath
        ? path.resolve(data.seedPath)
        : DEFAULT_POSTGRES_SEEDS_DIR;

    log({
        message: `Attempting to read seed directory: ${seedDir}`,
        type: "info",
        suppress: VircadiaConfig_Server.suppress,
        debug: VircadiaConfig_Server.debug,
    });

    // Get list of seed files
    let files: string[] = [];
    try {
        files = await readdir(seedDir);
        log({
            message: `Directory contents: ${files.length ? files.join(", ") : "(empty directory)"}`,
            type: "info",
            suppress: VircadiaConfig_Server.suppress,
            debug: VircadiaConfig_Server.debug,
        });
    } catch (error) {
        log({
            message: `Error reading seed directory: ${error instanceof Error ? error.message : String(error)}`,
            type: "error",
            suppress: VircadiaConfig_Server.suppress,
            debug: VircadiaConfig_Server.debug,
        });
        log({
            message: `No seed directory found at ${seedDir}`,
            type: "info",
            suppress: VircadiaConfig_Server.suppress,
            debug: VircadiaConfig_Server.debug,
        });
        return;
    }

    const sqlFiles = files.filter((f) => f.endsWith(".sql")).sort();

    // Get already executed seeds - updated column names
    const result =
        await sql`SELECT general__name FROM config.seeds ORDER BY general__seed_id`;
    const executedSeeds = result.map((r) => r.general__name);

    // Run pending seeds
    for (const file of sqlFiles) {
        if (!executedSeeds.includes(file)) {
            try {
                const filePath = path.join(seedDir, file);
                const sqlContent = await readFile(filePath, "utf-8");

                // Run the seed in a transaction - updated column names
                await sql.begin(async (sql) => {
                    await sql.unsafe(sqlContent);
                    await sql`
                        INSERT INTO config.seeds (general__name)
                        VALUES (${file})
                    `;
                });

                log({
                    message: `Seed ${file} executed successfully`,
                    type: "success",
                    suppress: VircadiaConfig_Server.suppress,
                    debug: VircadiaConfig_Server.debug,
                });
            } catch (error) {
                log({
                    message: `Failed to run seed ${file}`,
                    type: "error",
                    error: error,
                    suppress: VircadiaConfig_Server.suppress,
                    debug: VircadiaConfig_Server.debug,
                });
                throw error;
            }
        }
    }

    log({
        message: `${env.CONTAINER_NAME} container seeds applied.`,
        type: "success",
    });
}

// Update restart function
export async function restart() {
    const env = getDockerEnv();

    log({
        message: `Restarting ${env.CONTAINER_NAME} container...`,
        type: "info",
        suppress: VircadiaConfig_Server.suppress,
        debug: VircadiaConfig_Server.debug,
    });
    await down();
    await up();
}

export async function generateDbSystemToken(): Promise<{
    token: string;
    sessionId: string;
    agentId: string;
}> {
    const db = PostgresClient.getInstance();
    await db.connect();
    const sql = db.getClient();

    // Get auth settings from config using the new JSONB structure
    const [authConfig] = await sql<[Config.I_Config<"auth">]>`
        SELECT general__value 
        FROM config.config 
        WHERE general__key = 'auth'
    `;

    if (!authConfig) {
        throw new Error("Auth settings not found in database");
    }

    const jwtSecret = authConfig.general__value.jwt_secret;
    const jwtDuration = authConfig.general__value.default_session_duration_ms;

    if (!jwtSecret || !jwtDuration) {
        throw new Error("Required auth settings missing from database");
    }

    // Get system agent ID
    const [systemId] = await sql`SELECT auth.get_system_agent_id()`;

    // Create a new session for the system agent
    const [sessionResult] = await sql`
        SELECT * FROM auth.create_agent_session(${systemId.get_system_agent_id}, 'test')
    `;

    // Generate JWT token using the config from database
    const token = sign(
        {
            sessionId: sessionResult.general__session_id,
            agentId: systemId.get_system_agent_id,
        },
        jwtSecret,
        {
            expiresIn: jwtDuration,
        },
    );

    // Update the session with the JWT
    await sql`
        UPDATE auth.agent_sessions 
        SET session__jwt = ${token}
        WHERE general__session_id = ${sessionResult.general__session_id}
    `;

    return {
        token,
        sessionId: sessionResult.general__session_id,
        agentId: systemId.get_system_agent_id,
    };
}

export async function cleanupSystemTokens() {
    const db = PostgresClient.getInstance();
    await db.connect();
    const sql = db.getClient();

    const [result] = await sql`SELECT cleanup_system_tokens()`;
    return result;
}

export async function generateDbConnectionString(): Promise<string> {
    const config = VircadiaConfig_Server.postgres;
    return `postgres://${config.user}:${config.password}@${config.host}:${config.port}/${config.database}`;
}

// If this file is run directly
if (import.meta.main) {
    const command = Bun.argv[2];
    try {
        switch (command) {
            case "container:up":
                await up();
                break;
            case "container:down":
                await down();
                break;
            case "container:rebuild":
                await rebuildContainer();
                break;
            case "container:health": {
                const health = await isHealthy();
                log({
                    message: `PostgreSQL: ${health.services.postgres.isHealthy ? "healthy" : "unhealthy"}`,
                    data: health.services.postgres,
                    type: health.services.postgres.isHealthy
                        ? "success"
                        : "error",
                });
                log({
                    message: `Pgweb: ${health.services.pgweb.isHealthy ? "healthy" : "unhealthy"}`,
                    data: health.services.pgweb,
                    type: health.services.pgweb.isHealthy ? "success" : "error",
                });
                break;
            }
            case "container:db:soft-reset":
                await softResetDatabase();
                break;
            case "container:db:migrate":
                await migrate({});
                break;
            case "container:db:connection-string": {
                const connectionString = await generateDbConnectionString();
                log({
                    message: `PostgreSQL Connection String:\n\n${connectionString}\n`,
                    type: "success",
                    suppress: VircadiaConfig_Server.suppress,
                    debug: VircadiaConfig_Server.debug,
                });
                break;
            }
            case "container:restart":
                await restart();
                break;
            case "container:db:system-token": {
                const token = await generateDbSystemToken();
                log({
                    message: `System token:\n${token.token}\n\nSession ID: ${token.sessionId}\nAgent ID: ${token.agentId}\n\nThis token has system privileges - use with caution!`,
                    type: "success",
                    suppress: VircadiaConfig_Server.suppress,
                    debug: VircadiaConfig_Server.debug,
                });
                break;
            }
            case "container:db:seed": {
                const customPath = Bun.argv[3]; // Optional custom seed path
                await seed({ seedPath: customPath });
                break;
            }
            case "container:pgweb:access-command": {
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
                    suppress: VircadiaConfig_Server.suppress,
                    debug: VircadiaConfig_Server.debug,
                });
                break;
            }
            default:
                console.error(
                    `Valid commands: 

                    // Container commands
                    container:up, 
                    container:down, 
                    container:rebuild, 
                    container:health,
                    container:restart, 

                    // Container -> Database commands
                    container:db:soft-reset, 
                    container:db:migrate, 
                    container:db:connection-string, 
                    container:db:system-token,
                    container:db:seed [optional_seed_path],

                    // Container -> Pgweb commands
                    container:pgweb:access-command,
                    `,
                );
                process.exit(1);
        }
    } finally {
        // Clean up database connection if it was used
        const db = PostgresClient.getInstance();
        await db.disconnect();
    }
}
