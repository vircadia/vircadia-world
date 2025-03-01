import { VircadiaConfig } from "../../sdk/vircadia-world-sdk-ts/config/vircadia.config.ts";
import { log } from "../../sdk/vircadia-world-sdk-ts/module/general/log.ts";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { sign } from "jsonwebtoken";
import { PostgresClient } from "../../sdk/vircadia-world-sdk-ts/module/server/postgres.client.ts";

// TODO: this should become vircadia.world.cli.ts and should be able to use bun watch to hot-reload migrations, scripts, etc. locally and/or remotely
// for remote use and local dev use.

const DOCKER_COMPOSE_PATH = path.join(
    dirname(fileURLToPath(import.meta.url)),
    "/docker-compose.yml",
);

const POSTGRES_MIGRATIONS_DIR = path.join(
    dirname(fileURLToPath(import.meta.url)),
    "../../database/postgres/migration",
);

const POSTGRES_RESETS_DIR = path.join(
    dirname(fileURLToPath(import.meta.url)),
    "../../database/postgres/reset",
);

const DEFAULT_POSTGRES_SEEDS_DIR = VircadiaConfig.SERVER.POSTGRES.SEED_PATH
    ? path.resolve(VircadiaConfig.SERVER.POSTGRES.SEED_PATH)
    : path.join(
          dirname(fileURLToPath(import.meta.url)),
          "../../database/postgres/seed",
      );

// Update runDockerCommand to use suppress from config
async function runDockerCommand(args: string[]) {
    const processEnv = {
        ...process.env,
        POSTGRES_DB: VircadiaConfig.SERVER.POSTGRES.DATABASE,
        POSTGRES_USER: VircadiaConfig.GLOBAL_CONSTS.DB_SUPER_USER,
        POSTGRES_PASSWORD: VircadiaConfig.SERVER.POSTGRES.PASSWORD,
        POSTGRES_PORT: VircadiaConfig.SERVER.POSTGRES.PORT.toString(),
        POSTGRES_HOST: VircadiaConfig.SERVER.POSTGRES.HOST,
        CONTAINER_NAME: VircadiaConfig.SERVER.CONTAINER_NAME,
        PGWEB_PORT: VircadiaConfig.SERVER.PGWEB.PORT.toString(),
        PATH: process.env.PATH,
    };

    log({
        message: `[Docker Command] docker-compose -f ${DOCKER_COMPOSE_PATH} ${args.join(" ")}`,
        type: "debug",
        suppress: VircadiaConfig.SERVER.SUPPRESS,
        debug: VircadiaConfig.SERVER.DEBUG,
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
            suppress: VircadiaConfig.SERVER.SUPPRESS,
            debug: VircadiaConfig.SERVER.DEBUG,
        });
    }
    if (stderr) {
        log({
            message: `[Docker Command Output]\n${stderr}`,
            type: "info",
            suppress: VircadiaConfig.SERVER.SUPPRESS,
            debug: VircadiaConfig.SERVER.DEBUG,
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
    const checkPostgres = async (): Promise<{
        isHealthy: boolean;
        error?: Error;
    }> => {
        try {
            const db = PostgresClient.getInstance();

            const sql = await db.getSuperClient();
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
                `http://localhost:${VircadiaConfig.SERVER.PGWEB.PORT}`,
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

export async function up(rebuildImages = false) {
    if (rebuildImages) {
        await runDockerCommand(["up", "-d", "--build"]);
    } else {
        await runDockerCommand(["up", "-d"]);
    }
}

// Update down function
export async function down(wipeVolumes = false) {
    if (wipeVolumes) {
        await runDockerCommand(["down", "-v"]);
    } else {
        await runDockerCommand(["down"]);
    }
}

export async function wipeDatabase() {
    const db = PostgresClient.getInstance();
    const sql = await db.getSuperClient();

    // Get list of migration files
    const resets = await readdir(POSTGRES_RESETS_DIR);
    const resetSqlFiles = resets.filter((f) => f.endsWith(".sql")).sort();

    // Run pending migrations
    for (const file of resetSqlFiles) {
        try {
            const filePath = path.join(POSTGRES_RESETS_DIR, file);
            const sqlContent = await readFile(filePath, "utf-8");

            await sql.begin(async (sql) => {
                await sql.unsafe(sqlContent);
            });

            log({
                message: `Reset ${file} executed successfully`,
                type: "debug",
                suppress: VircadiaConfig.SERVER.SUPPRESS,
                debug: VircadiaConfig.SERVER.DEBUG,
            });
        } catch (error) {
            log({
                message: `Failed to run reset ${file}.`,
                type: "error",
                error: error,
                suppress: VircadiaConfig.SERVER.SUPPRESS,
                debug: VircadiaConfig.SERVER.DEBUG,
            });
            throw error;
        }
    }
}

export async function migrate(): Promise<boolean> {
    const db = PostgresClient.getInstance();
    const sql = await db.getSuperClient();

    let migrationsRan = false;

    for (const name of VircadiaConfig.SERVER.POSTGRES.EXTENSIONS) {
        log({
            message: `Installing PostgreSQL extension: ${name}...`,
            type: "debug",
            suppress: VircadiaConfig.SERVER.SUPPRESS,
            debug: VircadiaConfig.SERVER.DEBUG,
        });
        await sql`CREATE EXTENSION IF NOT EXISTS ${sql(name)};`;
        log({
            message: `PostgreSQL extension ${name} installed successfully`,
            type: "debug",
            suppress: VircadiaConfig.SERVER.SUPPRESS,
            debug: VircadiaConfig.SERVER.DEBUG,
        });
    }

    // Create config schema and migrations table if they don't exist
    await sql.unsafe("CREATE SCHEMA IF NOT EXISTS config");

    await sql.unsafe(`
        CREATE TABLE IF NOT EXISTS config.migrations (
            general__id SERIAL PRIMARY KEY,
            general__name VARCHAR(255) NOT NULL,
            general__executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Seed the config environment
    for (const [key, value] of Object.entries(
        VircadiaConfig.SERVER.POSTGRES.SQL_ENV,
    )) {
        const keyToUse = `${VircadiaConfig.SERVER.POSTGRES.SQL_ENV_PREFIX}.${key}`;

        // Log the key (but not the value if it’s sensitive)
        log({
            message: `Setting Postgres config for ${keyToUse}`,
            type: "debug",
            suppress: VircadiaConfig.SERVER.SUPPRESS,
            debug: VircadiaConfig.SERVER.DEBUG,
        });
        // Use parameterized SQL for safety. Use sql.raw for the key since parameters cannot be used for identifiers.
        await sql.unsafe(`SET ${keyToUse} = '${value}'`);
    }

    // Get list of migration files
    const migrations = await readdir(POSTGRES_MIGRATIONS_DIR);
    const migrationSqlFiles = migrations
        .filter((f) => f.endsWith(".sql"))
        .sort((a, b) => {
            // Extract numeric prefixes if present (e.g., "001_" from "001_create_tables.sql")
            const numA = Number.parseInt(a.match(/^(\d+)/)?.[1] || "0");
            const numB = Number.parseInt(b.match(/^(\d+)/)?.[1] || "0");

            // If both have numeric prefixes, compare them numerically
            if (!Number.isNaN(numA) && !Number.isNaN(numB)) {
                return numA - numB;
            }

            // Fall back to lexicographic sorting
            return a.localeCompare(b);
        });

    // Get already executed migrations
    const result =
        await sql`SELECT general__name FROM config.migrations ORDER BY general__id`;
    const executedMigrations = result.map((r) => r.name);

    // Run pending migrations
    for (const file of migrationSqlFiles) {
        if (!executedMigrations.includes(file)) {
            migrationsRan = true;
            try {
                const filePath = path.join(POSTGRES_MIGRATIONS_DIR, file);
                const sqlContent = await readFile(filePath, "utf-8");

                log({
                    message: `Executing migration ${file}...`,
                    type: "debug",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });

                await sql.begin(async (sql) => {
                    await sql.unsafe(sqlContent);
                    await sql`
                        INSERT INTO config.migrations (general__name)
                        VALUES (${file})
                    `;
                });

                log({
                    message: `Migration ${file} executed successfully`,
                    type: "debug",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
            } catch (error) {
                log({
                    message: `Failed to run migration ${file}.`,
                    type: "error",
                    error: error,
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                throw error;
            }
        }
    }

    return migrationsRan;
}

// Update seed function signature
export async function seed(data: {
    seedPath?: string;
}) {
    const db = PostgresClient.getInstance();
    const sql = await db.getSuperClient();

    // Ensure we resolve the seed path to absolute path
    const seedDir = data.seedPath
        ? path.resolve(data.seedPath)
        : DEFAULT_POSTGRES_SEEDS_DIR;

    log({
        message: `Attempting to read seed directory: ${seedDir}`,
        type: "info",
        suppress: VircadiaConfig.SERVER.SUPPRESS,
        debug: VircadiaConfig.SERVER.DEBUG,
    });

    // Get list of seed files
    let files: string[] = [];
    try {
        files = await readdir(seedDir);
        log({
            message: `Directory contents: ${files.length ? files.join(", ") : "(empty directory)"}`,
            type: "info",
            suppress: VircadiaConfig.SERVER.SUPPRESS,
            debug: VircadiaConfig.SERVER.DEBUG,
        });
    } catch (error) {
        log({
            message: `Error reading seed directory: ${error instanceof Error ? error.message : String(error)}`,
            type: "error",
            suppress: VircadiaConfig.SERVER.SUPPRESS,
            debug: VircadiaConfig.SERVER.DEBUG,
        });
        log({
            message: `No seed directory found at ${seedDir}`,
            type: "info",
            suppress: VircadiaConfig.SERVER.SUPPRESS,
            debug: VircadiaConfig.SERVER.DEBUG,
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
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
            } catch (error) {
                log({
                    message: `Failed to run seed ${file}`,
                    type: "error",
                    error: error,
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                throw error;
            }
        }
    }

    log({
        message: `${VircadiaConfig.SERVER.CONTAINER_NAME} container seeds applied.`,
        type: "success",
    });
}

export async function generateDbSystemToken(): Promise<{
    token: string;
    sessionId: string;
    agentId: string;
}> {
    const db = PostgresClient.getInstance();
    const sql = await db.getSuperClient();

    // Get auth provider settings for the system provider
    const [providerConfig] = await sql<
        [
            {
                provider__jwt_secret: string;
                provider__session_duration_ms: number;
            },
        ]
    >`
        SELECT provider__jwt_secret, provider__session_duration_ms
        FROM auth.auth_providers
        WHERE provider__name = 'system'
        AND provider__enabled = true
    `;

    if (!providerConfig) {
        throw new Error("System auth provider not found or disabled");
    }

    const jwtSecret = providerConfig.provider__jwt_secret;
    const jwtDuration = providerConfig.provider__session_duration_ms;

    if (!jwtSecret) {
        throw new Error("JWT secret not configured for system provider");
    }

    // Get system agent ID
    const [systemId] = await sql`SELECT auth.get_system_agent_id()`;

    // Insert a new session for the system agent directly, computing expiration from the provider's duration
    const [sessionResult] = await sql`
		INSERT INTO auth.agent_sessions (
			auth__agent_id,
			auth__provider_name,
			session__expires_at
		)
		VALUES (
			${systemId.get_system_agent_id},
			'system',
			(NOW() + (${jwtDuration} || ' milliseconds')::INTERVAL)
		)
		RETURNING *
	`;

    // Generate JWT token using the provider config
    const token = sign(
        {
            sessionId: sessionResult.general__session_id,
            agentId: systemId.get_system_agent_id,
            provider: "system",
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

export async function invalidateDbSystemTokens(): Promise<number> {
    const db = PostgresClient.getInstance();
    const sql = await db.getSuperClient();

    // First update all active sessions for the system agent to inactive
    await sql`
        UPDATE auth.agent_sessions 
        SET session__is_active = false
        WHERE auth__agent_id = auth.get_system_agent_id()
        AND session__is_active = true
    `;

    // Then check how many sessions remain active for verification
    const [{ count }] = await sql`
        SELECT COUNT(*) as count
        FROM auth.agent_sessions
        WHERE auth__agent_id = auth.get_system_agent_id()
        AND session__is_active = true
    `;

    return Number(count);
}

export async function generateDbConnectionString(): Promise<string> {
    return `postgres://${VircadiaConfig.GLOBAL_CONSTS.DB_SUPER_USER}:${VircadiaConfig.SERVER.POSTGRES.PASSWORD}@${VircadiaConfig.SERVER.POSTGRES.HOST}:${VircadiaConfig.SERVER.POSTGRES.PORT}/${VircadiaConfig.SERVER.POSTGRES.DATABASE}`;
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
            case "container:rebuild": {
                log({
                    message: `Rebuilding ${VircadiaConfig.SERVER.CONTAINER_NAME} container...`,
                    type: "info",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                await down(true);
                log({
                    message: "Container down complete",
                    type: "success",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                await up(true);
                const health = await isHealthy();
                if (!health.isHealthy) {
                    log({
                        message: "Failed to start services",
                        type: "error",
                        suppress: VircadiaConfig.SERVER.SUPPRESS,
                        debug: VircadiaConfig.SERVER.DEBUG,
                    });
                } else {
                    log({
                        message: "Container rebuilt",
                        type: "success",
                        suppress: VircadiaConfig.SERVER.SUPPRESS,
                        debug: VircadiaConfig.SERVER.DEBUG,
                    });
                    const migrationsRan = await migrate();
                    if (migrationsRan) {
                        log({
                            message: "Migrations ran successfully",
                            type: "success",
                            suppress: VircadiaConfig.SERVER.SUPPRESS,
                            debug: VircadiaConfig.SERVER.DEBUG,
                        });
                        await seed({});
                        log({
                            message: "Seeding complete",
                            type: "success",
                            suppress: VircadiaConfig.SERVER.SUPPRESS,
                            debug: VircadiaConfig.SERVER.DEBUG,
                        });
                        log({
                            message: "Container rebuild is complete",
                            type: "success",
                            suppress: VircadiaConfig.SERVER.SUPPRESS,
                            debug: VircadiaConfig.SERVER.DEBUG,
                        });
                    } else {
                        log({
                            message: "No migrations ran!",
                            type: "info",
                            suppress: VircadiaConfig.SERVER.SUPPRESS,
                            debug: VircadiaConfig.SERVER.DEBUG,
                        });
                    }
                }
                break;
            }
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
            case "container:db:reset": {
                log({
                    message: `Performing wipe of ${VircadiaConfig.SERVER.CONTAINER_NAME} database...`,
                    type: "info",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                await wipeDatabase();
                log({
                    message: "Database wiped, running migrations...",
                    type: "info",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                await migrate();
                log({
                    message: "Migrations ran, seeding...",
                    type: "info",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                await seed({});
                log({
                    message: "Seeding complete.",
                    type: "info",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                log({
                    message: `${VircadiaConfig.SERVER.CONTAINER_NAME} database reset complete.`,
                    type: "success",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                break;
            }
            case "container:db:wipe":
                log({
                    message: `Performing wipe of ${VircadiaConfig.SERVER.CONTAINER_NAME} database...`,
                    type: "info",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                await wipeDatabase();
                log({
                    message: `${VircadiaConfig.SERVER.CONTAINER_NAME} database wiped.`,
                    type: "success",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                break;
            case "container:db:migrate":
                log({
                    message: `Running ${VircadiaConfig.SERVER.CONTAINER_NAME} database migrations...`,
                    type: "info",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                await migrate();
                log({
                    message: "Migrations ran successfully",
                    type: "success",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                break;
            case "container:db:connection-string": {
                const connectionString = await generateDbConnectionString();
                log({
                    message: `PostgreSQL Connection String:\n\n${connectionString}\n`,
                    type: "success",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                break;
            }
            case "container:restart": {
                log({
                    message: `Restarting ${VircadiaConfig.SERVER.CONTAINER_NAME} container...`,
                    type: "info",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                await down();
                log({
                    message:
                        "Container down complete, restarting the container...",
                    type: "success",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                await up();
                const health = await isHealthy();
                if (!health.isHealthy) {
                    log({
                        message: "Failed to start services",
                        type: "error",
                        suppress: VircadiaConfig.SERVER.SUPPRESS,
                        debug: VircadiaConfig.SERVER.DEBUG,
                    });
                } else {
                    log({
                        message: "Container restart is complete",
                        type: "success",
                        suppress: VircadiaConfig.SERVER.SUPPRESS,
                        debug: VircadiaConfig.SERVER.DEBUG,
                    });
                }
                break;
            }
            case "container:db:system-token": {
                const token = await generateDbSystemToken();
                log({
                    message: `System token:\n${token.token}\n\nSession ID: ${token.sessionId}\nAgent ID: ${token.agentId}\n\nThis token has system privileges - use with caution!`,
                    type: "success",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                break;
            }
            case "container:db:invalidate-system-tokens": {
                const result = await invalidateDbSystemTokens();
                log({
                    message: `Invalidated system tokens, ${result} system sessions remain active`,
                    type: "success",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                break;
            }
            case "container:db:seed": {
                const customPath =
                    Bun.argv.length > 3 ? Bun.argv[3] : undefined; // Check if arg exists
                await seed({ seedPath: customPath });
                break;
            }
            case "container:pgweb:access-command": {
                const isRemoteHost = !["localhost", "127.0.0.1"].includes(
                    VircadiaConfig.SERVER.POSTGRES.HOST,
                );

                const accessMessage = isRemoteHost
                    ? `1. First create SSH tunnel:\nssh -L ${VircadiaConfig.SERVER.PGWEB.PORT}:localhost:${VircadiaConfig.SERVER.PGWEB.PORT} username@${VircadiaConfig.SERVER.POSTGRES.HOST}\n\n2. Then access pgweb at:`
                    : "Access pgweb at:";

                log({
                    message: `${accessMessage}\nhttp://localhost:${VircadiaConfig.SERVER.PGWEB.PORT}\n`,
                    type: "info",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
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
					container:db:reset,
                    container:db:wipe, 
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
