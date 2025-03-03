import { VircadiaConfig } from "../../sdk/vircadia-world-sdk-ts/config/vircadia.config.ts";
import { log } from "../../sdk/vircadia-world-sdk-ts/module/general/log.ts";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { sign } from "jsonwebtoken";
import { PostgresClient } from "../../sdk/vircadia-world-sdk-ts/module/server/postgres.client.ts";
import { Communication } from "../../sdk/vircadia-world-sdk-ts/schema/schema.general.ts";

enum DOCKER_COMPOSE_SERVICE {
    POSTGRES = "postgres",
    PGWEB = "pgweb",
    API = "api",
    TICK = "tick",
    SCRIPT_WEB = "script_web",
}

const DOCKER_COMPOSE_FILE = path.join(
    dirname(fileURLToPath(import.meta.url)),
    "../service/docker.compose.yml",
);

// Update runDockerCommand to use the single compose file
async function runDockerCommand(data: {
    service?: DOCKER_COMPOSE_SERVICE;
    args: string[];
}) {
    const processEnv = {
        ...process.env,
        PATH: process.env.PATH,

        VRCA_GLOBAL_CONSTS_DB_SUPER_USER:
            VircadiaConfig.GLOBAL_CONSTS.DB_SUPER_USER,
        VRCA_GLOBAL_CONSTS_DB_AGENT_PROXY_USER:
            VircadiaConfig.GLOBAL_CONSTS.DB_AGENT_PROXY_USER,

        VRCA_SERVER_CONTAINER_NAME: VircadiaConfig.SERVER.CONTAINER_NAME,
        VRCA_SERVER_DEBUG: VircadiaConfig.SERVER.DEBUG.toString(),
        VRCA_SERVER_SUPPRESS: VircadiaConfig.SERVER.SUPPRESS.toString(),

        VRCA_SERVER_SERVICE_API_HOST_CLUSTER:
            VircadiaConfig.SERVER_ENV.VRCA_SERVER_SERVICE_API_HOST_CLUSTER,
        VRCA_SERVER_SERVICE_API_PORT_CLUSTER:
            VircadiaConfig.SERVER_ENV.VRCA_SERVER_SERVICE_API_PORT_CLUSTER.toString(),
        VRCA_SERVER_SERVICE_API_HOST_PUBLIC:
            VircadiaConfig.SERVER_ENV.VRCA_SERVER_SERVICE_API_HOST_PUBLIC,
        VRCA_SERVER_SERVICE_API_PORT_PUBLIC:
            VircadiaConfig.SERVER_ENV.VRCA_SERVER_SERVICE_API_PORT_PUBLIC.toString(),
        VRCA_SERVER_SERVICE_API_HOST_CONTAINER_EXTERNAL:
            VircadiaConfig.SERVER_ENV
                .VRCA_SERVER_SERVICE_API_HOST_CONTAINER_EXTERNAL,
        VRCA_SERVER_SERVICE_API_PORT_CONTAINER_EXTERNAL:
            VircadiaConfig.SERVER_ENV.VRCA_SERVER_SERVICE_API_PORT_CONTAINER_EXTERNAL.toString(),

        VRCA_SERVER_SERVICE_POSTGRES_HOST_CONTAINER_EXTERNAL:
            VircadiaConfig.SERVER_ENV
                .VRCA_SERVER_SERVICE_POSTGRES_HOST_CONTAINER_EXTERNAL,
        VRCA_SERVER_SERVICE_POSTGRES_PORT_CONTAINER_EXTERNAL:
            VircadiaConfig.SERVER_ENV.VRCA_SERVER_SERVICE_POSTGRES_PORT_CONTAINER_EXTERNAL.toString(),
        VRCA_SERVER_SERVICE_POSTGRES_HOST_CLUSTER:
            VircadiaConfig.SERVER_ENV.VRCA_SERVER_SERVICE_POSTGRES_HOST_CLUSTER,
        VRCA_SERVER_SERVICE_POSTGRES_PORT_CLUSTER:
            VircadiaConfig.SERVER_ENV.VRCA_SERVER_SERVICE_POSTGRES_PORT_CLUSTER.toString(),
        VRCA_SERVER_SERVICE_POSTGRES_DATABASE:
            VircadiaConfig.SERVER_ENV.VRCA_SERVER_SERVICE_POSTGRES_DATABASE,
        VRCA_SERVER_SERVICE_POSTGRES_PASSWORD:
            VircadiaConfig.SERVER_ENV.VRCA_SERVER_SERVICE_POSTGRES_PASSWORD,
        VRCA_SERVER_SERVICE_POSTGRES_AGENT_PROXY_PASSWORD:
            VircadiaConfig.SERVER.SERVICE.POSTGRES.AGENT_PROXY_PASSWORD,
        VRCA_SERVER_SERVICE_POSTGRES_EXTENSIONS:
            VircadiaConfig.SERVER.SERVICE.POSTGRES.EXTENSIONS.join(","),

        VRCA_SERVER_SERVICE_PGWEB_HOST_CONTAINER_EXTERNAL:
            VircadiaConfig.SERVER_ENV
                .VRCA_SERVER_SERVICE_PGWEB_HOST_CONTAINER_EXTERNAL,
        VRCA_SERVER_SERVICE_PGWEB_PORT_CONTAINER_EXTERNAL:
            VircadiaConfig.SERVER_ENV.VRCA_SERVER_SERVICE_PGWEB_PORT_CONTAINER_EXTERNAL.toString(),
    };

    // Construct the command
    let dockerArgs = ["docker", "compose", "-f", DOCKER_COMPOSE_FILE];

    // Add service name if specified
    if (data.service && !data.args.includes("down")) {
        // For 'up' commands with a specific service
        dockerArgs = [...dockerArgs, ...data.args, data.service.toLowerCase()];
    } else {
        // For 'down' commands or when no specific service is provided
        dockerArgs = [...dockerArgs, ...data.args];
    }

    log({
        message: `[Docker Command]\n${dockerArgs.join(" ")}`,
        type: "debug",
        suppress: VircadiaConfig.SERVER.SUPPRESS,
        debug: VircadiaConfig.SERVER.DEBUG,
    });

    const spawnedProcess = Bun.spawn(dockerArgs, {
        env: processEnv,
        stdout: "pipe",
        stderr: "pipe",
    });

    const stdout = await new Response(spawnedProcess.stdout).text();
    const stderr = await new Response(spawnedProcess.stderr).text();

    if (stdout) {
        log({
            message: `[Docker Command Output] INFO\n${stdout}`,
            type: "info",
            suppress: VircadiaConfig.SERVER.SUPPRESS,
            debug: VircadiaConfig.SERVER.DEBUG,
        });
    }
    if (stderr) {
        log({
            message: `[Docker Command Output] ERROR\n${stderr}`,
            type: "info",
            suppress: VircadiaConfig.SERVER.SUPPRESS,
            debug: VircadiaConfig.SERVER.DEBUG,
        });
    }

    const exitCode = await spawnedProcess.exitCode;

    const isExpectedOutput =
        data.args.includes("down") || data.args.includes("up");
    if (exitCode !== 0 && !isExpectedOutput) {
        throw new Error(
            `Docker command failed with exit code ${exitCode}.\nStdout: ${stdout}\nStderr: ${stderr}`,
        );
    }
}

// Update up function
export async function up(data: {
    service?: DOCKER_COMPOSE_SERVICE;
    rebuild?: boolean;
}): Promise<void> {
    if (data.rebuild) {
        await runDockerCommand({
            service: data.service,
            args: ["up", "-d", "--build"],
        });
    } else {
        await runDockerCommand({
            service: data.service,
            args: ["up", "-d"],
        });
    }
}

export async function down(data: {
    service?: DOCKER_COMPOSE_SERVICE;
}): Promise<void> {
    let args: string[];

    if (data.service) {
        // For a specific service, just remove the container
        args = ["rm", "-f", data.service.toLowerCase()];
    } else {
        // For all services, just down without -v
        // Ignoring wipeVolumes parameter for safety
        args = ["down"];
    }

    await runDockerCommand({
        args,
    });
}

export async function downAndWipeAllServices(): Promise<void> {
    await runDockerCommand({
        args: ["down", "-v"],
    });
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
        api: {
            isHealthy: boolean;
            error?: Error;
        };
        script_web: {
            isHealthy: boolean;
            error?: Error;
        };
        tick: {
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

            const sql = await db.getSuperClient({
                postgres: {
                    host: VircadiaConfig.CLI.POSTGRES.HOST,
                    port: VircadiaConfig.CLI.POSTGRES.PORT,
                },
            });
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
            const pgwebAccessURL = await generatePgwebAccessURL();

            const response = await fetch(pgwebAccessURL);
            return { isHealthy: response.ok };
        } catch (error: unknown) {
            return { isHealthy: false, error: error as Error };
        }
    };

    const checkApi = async (): Promise<{
        isHealthy: boolean;
        error?: Error;
    }> => {
        try {
            const url = `http://${VircadiaConfig.SERVER.SERVICE.API.HOST_PUBLIC}:${VircadiaConfig.SERVER.SERVICE.API.PORT_PUBLIC}${Communication.REST.Endpoint.STATS.path}`;
            const response = await fetch(url, {
                method: "POST",
                body: Communication.REST.Endpoint.STATS.createRequest(),
            });
            return { isHealthy: response.ok };
        } catch (error: unknown) {
            return { isHealthy: false, error: error as Error };
        }
    };

    const checkScriptWeb = async (): Promise<{
        isHealthy: boolean;
        error?: Error;
    }> => {
        try {
            return { isHealthy: true };
        } catch (error: unknown) {
            return { isHealthy: false, error: error as Error };
        }
    };

    const checkTick = async (): Promise<{
        isHealthy: boolean;
        error?: Error;
    }> => {
        try {
            return { isHealthy: true };
        } catch (error: unknown) {
            return { isHealthy: false, error: error as Error };
        }
    };

    const [
        postgresHealth,
        pgwebHealth,
        apiHealth,
        scriptWebHealth,
        tickHealth,
    ] = await Promise.all([
        checkPostgres(),
        checkPgweb(),
        checkApi(),
        checkScriptWeb(),
        checkTick(),
    ]);

    return {
        isHealthy:
            postgresHealth.isHealthy &&
            pgwebHealth.isHealthy &&
            apiHealth.isHealthy &&
            scriptWebHealth.isHealthy &&
            tickHealth.isHealthy,
        services: {
            postgres: postgresHealth,
            pgweb: pgwebHealth,
            api: apiHealth,
            script_web: scriptWebHealth,
            tick: tickHealth,
        },
    };
}

export async function wipeDatabase() {
    const db = PostgresClient.getInstance();
    const sql = await db.getSuperClient({
        postgres: {
            host: VircadiaConfig.CLI.POSTGRES.HOST,
            port: VircadiaConfig.CLI.POSTGRES.PORT,
        },
    });

    // Get list of migration files
    const resets = await readdir(VircadiaConfig.CLI.POSTGRES.RESET_DIR);
    const resetSqlFiles = resets.filter((f) => f.endsWith(".sql")).sort();

    // Run pending migrations
    for (const file of resetSqlFiles) {
        try {
            const filePath = path.join(
                VircadiaConfig.CLI.POSTGRES.RESET_DIR,
                file,
            );
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
    const sql = await db.getSuperClient({
        postgres: {
            host: VircadiaConfig.CLI.POSTGRES.HOST,
            port: VircadiaConfig.CLI.POSTGRES.PORT,
        },
    });

    let migrationsRan = false;

    for (const name of VircadiaConfig.SERVER.SERVICE.POSTGRES.EXTENSIONS) {
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

    // Get list of migration files
    const migrations = await readdir(VircadiaConfig.CLI.POSTGRES.MIGRATION_DIR);
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

    log({
        message: `Attempting to read migrations directory: ${migrations}, found ${migrationSqlFiles.length} files`,
        type: "info",
        suppress: VircadiaConfig.SERVER.SUPPRESS,
        debug: VircadiaConfig.SERVER.DEBUG,
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
                const filePath = path.join(
                    VircadiaConfig.CLI.POSTGRES.MIGRATION_DIR,
                    file,
                );
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
    const sql = await db.getSuperClient({
        postgres: {
            host: VircadiaConfig.CLI.POSTGRES.HOST,
            port: VircadiaConfig.CLI.POSTGRES.PORT,
        },
    });

    // Ensure we resolve the seed path to absolute path
    const seedDir = data.seedPath
        ? path.resolve(data.seedPath)
        : VircadiaConfig.CLI.POSTGRES.SEED_DIR;

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
    const sql = await db.getSuperClient({
        postgres: {
            host: VircadiaConfig.CLI.POSTGRES.HOST,
            port: VircadiaConfig.CLI.POSTGRES.PORT,
        },
    });

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
    const sql = await db.getSuperClient({
        postgres: {
            host: VircadiaConfig.CLI.POSTGRES.HOST,
            port: VircadiaConfig.CLI.POSTGRES.PORT,
        },
    });

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
    return `postgres://${VircadiaConfig.GLOBAL_CONSTS.DB_SUPER_USER}:${VircadiaConfig.SERVER.SERVICE.POSTGRES.PASSWORD}@${VircadiaConfig.SERVER.SERVICE.POSTGRES.HOST_CONTAINER_EXTERNAL}:${VircadiaConfig.SERVER.SERVICE.POSTGRES.PORT_CONTAINER_EXTERNAL}/${VircadiaConfig.SERVER.SERVICE.POSTGRES.DATABASE}`;
}

export async function generatePgwebAccessURL(): Promise<string> {
    return `http://${VircadiaConfig.SERVER.SERVICE.PGWEB.HOST_CONTAINER_EXTERNAL}:${VircadiaConfig.SERVER.SERVICE.PGWEB.PORT_CONTAINER_EXTERNAL}`;
}

// Add a new helper function to run operations on all services
async function runForAllServices(
    operation: (service: DOCKER_COMPOSE_SERVICE) => Promise<void>,
) {
    for (const serviceKey of Object.keys(DOCKER_COMPOSE_SERVICE) as Array<
        keyof typeof DOCKER_COMPOSE_SERVICE
    >) {
        const service = DOCKER_COMPOSE_SERVICE[serviceKey];
        await operation(service);
    }
}

function printValidCommands() {
    log({
        message: `Valid commands: 

        // Container commands - All services
        container-up-all
        container-down-all
        container-rebuild-all
        container-restart-all
        container-health

        // Container commands - Individual services
        ${Object.keys(DOCKER_COMPOSE_SERVICE)
            .map((k) => {
                const service = k.toLowerCase().replace(/_/g, "-");
                return `container-up-${service}\n        container-down-${service}\n        container-rebuild-${service}\n        container-restart-${service}\n        container-wipe-${service}`;
            })
            .join("\n        ")}

        // Database commands
        database-reset
        database-wipe
        database-migrate
        database-connection-string
        database-system-token
        database-seed

        // PGWeb commands
        pgweb-access-command
        `,
        type: "info",
    });
}

// If this file is run directly
if (import.meta.main) {
    const command = Bun.argv[2];
    const additionalArgs = Bun.argv.slice(3);

    if (!command) {
        printValidCommands();
        process.exit(1);
    }

    try {
        switch (command) {
            // ALL SERVICES COMMANDS
            case "container-up-all":
                log({
                    message: "Starting all services...",
                    type: "info",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                await runForAllServices(async (svc) => {
                    log({
                        message: `Starting ${svc.toLowerCase()} service...`,
                        type: "info",
                        suppress: VircadiaConfig.SERVER.SUPPRESS,
                        debug: VircadiaConfig.SERVER.DEBUG,
                    });
                    await up({ service: svc, rebuild: false });
                });
                break;

            case "container-down-all":
                log({
                    message: "Stopping all services...",
                    type: "info",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                await runForAllServices(async (svc) => {
                    log({
                        message: `Stopping ${svc.toLowerCase()} service...`,
                        type: "info",
                        suppress: VircadiaConfig.SERVER.SUPPRESS,
                        debug: VircadiaConfig.SERVER.DEBUG,
                    });
                    await down({ service: svc });
                });
                break;

            case "container-rebuild-all": {
                log({
                    message: "Rebuilding all services...",
                    type: "info",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                await downAndWipeAllServices();
                await runForAllServices(async (svc) => {
                    log({
                        message: `Rebuilding ${svc.toLowerCase()} service...`,
                        type: "info",
                        suppress: VircadiaConfig.SERVER.SUPPRESS,
                        debug: VircadiaConfig.SERVER.DEBUG,
                    });
                    await up({ service: svc, rebuild: true });
                });

                // After rebuilding all services, run migrations and seed
                const health = await isHealthy();
                if (health.services.postgres.isHealthy) {
                    const migrationsRan = await migrate();
                    if (migrationsRan) {
                        log({
                            message: "Migrations ran successfully",
                            type: "success",
                            suppress: VircadiaConfig.SERVER.SUPPRESS,
                            debug: VircadiaConfig.SERVER.DEBUG,
                        });
                        await seed({});
                    }
                    log({
                        message: "All services rebuilt successfully",
                        type: "success",
                        suppress: VircadiaConfig.SERVER.SUPPRESS,
                        debug: VircadiaConfig.SERVER.DEBUG,
                    });
                }

                if (!health.isHealthy) {
                    log({
                        message: "Failed to start some services after rebuild",
                        type: "error",
                        data: health.services,
                        suppress: VircadiaConfig.SERVER.SUPPRESS,
                        debug: VircadiaConfig.SERVER.DEBUG,
                    });
                }
                break;
            }

            case "container-restart-all": {
                log({
                    message: "Restarting all services...",
                    type: "info",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                await runForAllServices(async (svc) => {
                    log({
                        message: `Restarting ${svc.toLowerCase()} service...`,
                        type: "info",
                        suppress: VircadiaConfig.SERVER.SUPPRESS,
                        debug: VircadiaConfig.SERVER.DEBUG,
                    });
                    await down({ service: svc });
                    await up({ service: svc });
                });

                log({
                    message: "All services restarted",
                    type: "success",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                break;
            }

            // INDIVIDUAL SERVICES COMMANDS

            // POSTGRES COMMANDS
            case "container-up-postgres":
                log({
                    message: "Starting postgres service...",
                    type: "info",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                await up({
                    service: DOCKER_COMPOSE_SERVICE.POSTGRES,
                    rebuild: false,
                });
                break;

            case "container-down-postgres":
                log({
                    message: "Stopping postgres service...",
                    type: "info",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                await down({ service: DOCKER_COMPOSE_SERVICE.POSTGRES });
                break;

            case "container-rebuild-postgres": {
                log({
                    message: "Rebuilding postgres service...",
                    type: "info",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                await down({
                    service: DOCKER_COMPOSE_SERVICE.POSTGRES,
                });
                await up({
                    service: DOCKER_COMPOSE_SERVICE.POSTGRES,
                    rebuild: true,
                });

                // Run migrations and seed data after postgres rebuild
                const health = await isHealthy();
                if (health.services.postgres.isHealthy) {
                    const migrationsRan = await migrate();
                    if (migrationsRan) {
                        log({
                            message: "Migrations ran successfully",
                            type: "success",
                            suppress: VircadiaConfig.SERVER.SUPPRESS,
                            debug: VircadiaConfig.SERVER.DEBUG,
                        });
                        await seed({});
                    }
                }
                log({
                    message: "Postgres service rebuilt successfully",
                    type: "success",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                break;
            }

            case "container-restart-postgres": {
                log({
                    message: "Restarting postgres service...",
                    type: "info",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                await down({ service: DOCKER_COMPOSE_SERVICE.POSTGRES });
                await up({ service: DOCKER_COMPOSE_SERVICE.POSTGRES });
                log({
                    message: "Postgres service restarted",
                    type: "success",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                break;
            }

            // PGWEB COMMANDS
            case "container-up-pgweb":
                log({
                    message: "Starting pgweb service...",
                    type: "info",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                await up({
                    service: DOCKER_COMPOSE_SERVICE.PGWEB,
                    rebuild: false,
                });
                break;

            case "container-down-pgweb":
                log({
                    message: "Stopping pgweb service...",
                    type: "info",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                await down({ service: DOCKER_COMPOSE_SERVICE.PGWEB });
                break;

            case "container-rebuild-pgweb": {
                log({
                    message: "Rebuilding pgweb service...",
                    type: "info",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                await down({
                    service: DOCKER_COMPOSE_SERVICE.PGWEB,
                });
                await up({
                    service: DOCKER_COMPOSE_SERVICE.PGWEB,
                    rebuild: true,
                });
                log({
                    message: "PGWEB service rebuilt successfully",
                    type: "success",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                break;
            }

            case "container-restart-pgweb": {
                log({
                    message: "Restarting pgweb service...",
                    type: "info",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                await down({ service: DOCKER_COMPOSE_SERVICE.PGWEB });
                await up({ service: DOCKER_COMPOSE_SERVICE.PGWEB });
                log({
                    message: "PGWEB service restarted",
                    type: "success",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                break;
            }

            // API COMMANDS
            case "container-up-api":
                log({
                    message: "Starting API service...",
                    type: "info",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                await up({
                    service: DOCKER_COMPOSE_SERVICE.API,
                    rebuild: false,
                });
                break;

            case "container-down-api":
                log({
                    message: "Stopping API service...",
                    type: "info",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                await down({ service: DOCKER_COMPOSE_SERVICE.API });
                break;

            case "container-rebuild-api": {
                log({
                    message: "Rebuilding API service...",
                    type: "info",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                await down({ service: DOCKER_COMPOSE_SERVICE.API }); // No wipeVolumes here
                await up({
                    service: DOCKER_COMPOSE_SERVICE.API,
                    rebuild: true,
                });
                log({
                    message: "API service rebuilt successfully",
                    type: "success",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                break;
            }

            case "container-restart-api": {
                log({
                    message: "Restarting API service...",
                    type: "info",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                await down({ service: DOCKER_COMPOSE_SERVICE.API });
                await up({ service: DOCKER_COMPOSE_SERVICE.API });
                log({
                    message: "API service restarted",
                    type: "success",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                break;
            }

            // TICK COMMANDS
            case "container-up-tick":
                log({
                    message: "Starting tick service...",
                    type: "info",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                await up({
                    service: DOCKER_COMPOSE_SERVICE.TICK,
                    rebuild: false,
                });
                break;

            case "container-down-tick":
                log({
                    message: "Stopping tick service...",
                    type: "info",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                await down({ service: DOCKER_COMPOSE_SERVICE.TICK });
                break;

            case "container-rebuild-tick": {
                log({
                    message: "Rebuilding tick service...",
                    type: "info",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                await down({
                    service: DOCKER_COMPOSE_SERVICE.TICK,
                });
                await up({
                    service: DOCKER_COMPOSE_SERVICE.TICK,
                    rebuild: true,
                });
                log({
                    message: "Tick service rebuilt successfully",
                    type: "success",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                break;
            }

            case "container-restart-tick": {
                log({
                    message: "Restarting tick service...",
                    type: "info",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                await down({ service: DOCKER_COMPOSE_SERVICE.TICK });
                await up({ service: DOCKER_COMPOSE_SERVICE.TICK });
                log({
                    message: "Tick service restarted",
                    type: "success",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                break;
            }

            // SCRIPT_WEB COMMANDS
            case "container-up-script-web":
                log({
                    message: "Starting script-web service...",
                    type: "info",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                await up({
                    service: DOCKER_COMPOSE_SERVICE.SCRIPT_WEB,
                    rebuild: false,
                });
                break;

            case "container-down-script-web":
                log({
                    message: "Stopping script-web service...",
                    type: "info",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                await down({ service: DOCKER_COMPOSE_SERVICE.SCRIPT_WEB });
                break;

            case "container-rebuild-script-web": {
                log({
                    message: "Rebuilding script-web service...",
                    type: "info",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                await down({
                    service: DOCKER_COMPOSE_SERVICE.SCRIPT_WEB,
                });
                await up({
                    service: DOCKER_COMPOSE_SERVICE.SCRIPT_WEB,
                    rebuild: true,
                });
                log({
                    message: "Script web service rebuilt successfully",
                    type: "success",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                break;
            }

            case "container-restart-script-web": {
                log({
                    message: "Restarting script-web service...",
                    type: "info",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                await down({ service: DOCKER_COMPOSE_SERVICE.SCRIPT_WEB });
                await up({ service: DOCKER_COMPOSE_SERVICE.SCRIPT_WEB });
                log({
                    message: "Script web service restarted",
                    type: "success",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                break;
            }

            // CONTAINER HEALTH
            case "container-health": {
                const health = await isHealthy();
                log({
                    message: `PostgreSQL: ${health.services.postgres.isHealthy ? "healthy" : "unhealthy"}`,
                    data: health.services.postgres,
                    type: health.services.postgres.isHealthy
                        ? "success"
                        : "error",
                });
                log({
                    message: `PGWEB: ${health.services.pgweb.isHealthy ? "healthy" : "unhealthy"}`,
                    data: health.services.pgweb,
                    type: health.services.pgweb.isHealthy ? "success" : "error",
                });
                log({
                    message: `API Manager: ${health.services.api.isHealthy ? "healthy" : "unhealthy"}`,
                    data: health.services.api,
                    type: health.services.api.isHealthy ? "success" : "error",
                });
                log({
                    message: `Script Web Manager: ${health.services.script_web.isHealthy ? "healthy" : "unhealthy"}`,
                    data: health.services.script_web,
                    type: health.services.script_web.isHealthy
                        ? "success"
                        : "error",
                });
                log({
                    message: `Tick Manager: ${health.services.tick.isHealthy ? "healthy" : "unhealthy"}`,
                    data: health.services.tick,
                    type: health.services.tick.isHealthy ? "success" : "error",
                });
                break;
            }

            // DATABASE COMMANDS
            case "database-migrate":
                log({
                    message: "Running migrations...",
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

            case "database-wipe":
                log({
                    message: "Wiping database...",
                    type: "info",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                await wipeDatabase();
                log({
                    message: "Database wiped",
                    type: "success",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                break;

            case "database-reset":
                log({
                    message: "Resetting database...",
                    type: "info",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                await wipeDatabase();
                await migrate();
                await seed({});
                log({
                    message: "Database reset",
                    type: "success",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                break;

            case "database-connection-string": {
                const connectionString = await generateDbConnectionString();
                log({
                    message: `Database connection string: ${connectionString}`,
                    type: "info",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                break;
            }

            case "database-system-token": {
                log({
                    message: "Generating system agent token...",
                    type: "info",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                const { token, sessionId, agentId } =
                    await generateDbSystemToken();
                log({
                    message: `System agent token: ${token}`,
                    data: { sessionId, agentId },
                    type: "success",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                break;
            }

            case "database-seed":
                log({
                    message: "Seeding database...",
                    type: "info",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                await seed({ seedPath: additionalArgs[0] });
                break;

            // PGWEB COMMANDS
            case "pgweb-access-command": {
                const pgwebAccessURL = await generatePgwebAccessURL();
                log({
                    message: `Access PGWEB at: ${pgwebAccessURL}`,
                    type: "info",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                break;
            }

            default:
                printValidCommands();
                process.exit(1);
        }
    } finally {
        // Clean up database connection if it was used
        const db = PostgresClient.getInstance();
        await db.disconnect();
    }
}
