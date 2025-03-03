import { VircadiaConfig } from "../../sdk/vircadia-world-sdk-ts/config/vircadia.config.ts";
import { log } from "../../sdk/vircadia-world-sdk-ts/module/general/log.ts";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { sign } from "jsonwebtoken";
import { PostgresClient } from "../../sdk/vircadia-world-sdk-ts/module/server/postgres.client.ts";

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

        VRCA_SERVER_SERVICE_API_HOST_BIND:
            VircadiaConfig.SERVER_ENV.VRCA_SERVER_SERVICE_API_HOST_BIND,
        VRCA_SERVER_SERVICE_API_PORT_BIND:
            VircadiaConfig.SERVER_ENV.VRCA_SERVER_SERVICE_API_PORT_BIND.toString(),
        VRCA_SERVER_SERVICE_API_HOST_CLUSTER:
            VircadiaConfig.SERVER_ENV.VRCA_SERVER_SERVICE_API_HOST_CLUSTER,
        VRCA_SERVER_SERVICE_API_PORT_CLUSTER:
            VircadiaConfig.SERVER_ENV.VRCA_SERVER_SERVICE_API_PORT_CLUSTER.toString(),
        VRCA_SERVER_SERVICE_API_HOST_PUBLIC:
            VircadiaConfig.SERVER_ENV.VRCA_SERVER_SERVICE_API_HOST_PUBLIC,
        VRCA_SERVER_SERVICE_API_PORT_PUBLIC:
            VircadiaConfig.SERVER_ENV.VRCA_SERVER_SERVICE_API_PORT_PUBLIC.toString(),

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

        VRCA_SERVER_SERVICE_PGWEB_HOST_EXTERNAL:
            VircadiaConfig.SERVER_ENV.VRCA_SERVER_SERVICE_PGWEB_HOST_EXTERNAL,
        VRCA_SERVER_SERVICE_PGWEB_PORT_EXTERNAL:
            VircadiaConfig.SERVER_ENV.VRCA_SERVER_SERVICE_PGWEB_PORT_EXTERNAL.toString(),
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

// Update down function
export async function down(data: {
    service?: DOCKER_COMPOSE_SERVICE;
    wipeVolumes?: boolean;
}): Promise<void> {
    const { wipeVolumes } = data;
    // For down commands, don't append service - specify in docker-compose args
    const args = wipeVolumes ? ["down", "-v"] : ["down"];

    if (data.service) {
        args.push(data.service.toLowerCase());
    }

    await runDockerCommand({
        args,
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
            const response = await fetch(
                `http://${VircadiaConfig.SERVER.SERVICE.API.HOST_PUBLIC}:${VircadiaConfig.SERVER.SERVICE.API.PORT_PUBLIC}`,
            );
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
    return `http://${VircadiaConfig.SERVER.SERVICE.PGWEB.HOST_EXTERNAL}:${VircadiaConfig.SERVER.SERVICE.PGWEB.PORT_EXTERNAL}`;
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

        // Container commands
        container:up:all, 
        container:up:[service], 
        container:down:all, 
        container:down:[service], 
        container:rebuild:all, 
        container:rebuild:[service], 
        container:restart:all,
        container:restart:[service],
        container:health,

        // Container -> Database commands
        container:db:reset,
        container:db:wipe, 
        container:db:migrate, 
        container:db:connection-string, 
        container:db:system-token,
        container:db:seed [optional_seed_path],

        // Container -> PGWEB commands
        container:pgweb:access-command,
        
        // Available services: ${Object.keys(DOCKER_COMPOSE_SERVICE)
            .map((k) => k.toLowerCase().replace(/_/g, "-"))
            .join(", ")}
        `,
        type: "info",
    });
}

// If this file is run directly
if (import.meta.main) {
    const command = Bun.argv[2];
    if (!command) {
        printValidCommands();
        process.exit(1);
    }

    // Parse service from command (if present)
    let service: DOCKER_COMPOSE_SERVICE | undefined;

    // Check if this is a service-specific command
    const commandParts = command.split(":");
    if (commandParts.length >= 3) {
        const serviceIdentifier = commandParts[2];

        if (serviceIdentifier !== "all") {
            const upperServiceArg = serviceIdentifier
                .toUpperCase()
                .replace(/-/g, "_");
            if (upperServiceArg in DOCKER_COMPOSE_SERVICE) {
                service =
                    DOCKER_COMPOSE_SERVICE[
                        upperServiceArg as keyof typeof DOCKER_COMPOSE_SERVICE
                    ];
            } else {
                console.error(`Invalid service name: ${serviceIdentifier}`);
                console.error(
                    `Valid service names: ${Object.keys(DOCKER_COMPOSE_SERVICE)
                        .map((k) => k.toLowerCase().replace(/_/g, "-"))
                        .join(", ")}`,
                );
                process.exit(1);
            }
        }
    }

    try {
        // New command structure with clearer service specification
        switch (command) {
            // UP commands
            case "container:up:all":
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

            // Handle service-specific UP commands like container:up:postgres
            case `container:up:${service?.toLowerCase().replace(/_/g, "-")}`:
                log({
                    message: "Starting service(s)...",
                    type: "info",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                await up({ service, rebuild: false });
                break;

            // DOWN commands
            case "container:down:all":
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

            // Handle service-specific DOWN commands
            case `container:down:${service?.toLowerCase().replace(/_/g, "-")}`:
                log({
                    message: "Stopping service(s)...",
                    type: "info",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                await down({ service });
                break;

            // REBUILD commands
            case "container:rebuild:all": {
                log({
                    message: "Rebuilding all services...",
                    type: "info",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                await runForAllServices(async (svc) => {
                    log({
                        message: `Rebuilding ${svc.toLowerCase()} service...`,
                        type: "info",
                        suppress: VircadiaConfig.SERVER.SUPPRESS,
                        debug: VircadiaConfig.SERVER.DEBUG,
                    });
                    await down({ service: svc, wipeVolumes: true });
                    await up({ service: svc, rebuild: true });
                });

                // After rebuilding all services, run migrations and seed
                const health = await isHealthy();
                if (health.isHealthy) {
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
                } else {
                    log({
                        message: "Failed to start some services after rebuild",
                        type: "error",
                        suppress: VircadiaConfig.SERVER.SUPPRESS,
                        debug: VircadiaConfig.SERVER.DEBUG,
                    });
                }
                break;
            }

            // Handle service-specific REBUILD commands
            case `container:rebuild:${service?.toLowerCase().replace(/_/g, "-")}`: {
                log({
                    message: "Rebuilding service(s)...",
                    type: "info",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                await down({ service, wipeVolumes: true });
                log({
                    message: "Container down complete",
                    type: "success",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                await up({ service, rebuild: true });

                // Run additional steps for Postgres rebuild
                if (service === DOCKER_COMPOSE_SERVICE.POSTGRES) {
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
                }

                log({
                    message: "Service(s) rebuilt successfully",
                    type: "success",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                break;
            }

            // RESTART commands
            case "container:restart:all": {
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

            // Handle service-specific RESTART commands
            case `container:restart:${service?.toLowerCase().replace(/_/g, "-")}`: {
                log({
                    message: "Restarting service(s)...",
                    type: "info",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                await down({ service });
                await up({ service });
                log({
                    message: "Service(s) restarted",
                    type: "success",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
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

            case "container:db:migrate":
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
            case "container:db:wipe":
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
            case "container:db:reset":
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
            case "container:db:connection-string": {
                const connectionString = await generateDbConnectionString();
                log({
                    message: `Database connection string: ${connectionString}`,
                    type: "info",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                break;
            }
            case "container:db:system-token": {
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
            case "container:db:seed":
                log({
                    message: "Seeding database...",
                    type: "info",
                    suppress: VircadiaConfig.SERVER.SUPPRESS,
                    debug: VircadiaConfig.SERVER.DEBUG,
                });
                await seed({});
                break;
            case "container:pgweb:access-command": {
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
