import { VircadiaConfig } from "../sdk/vircadia-world-sdk-ts/config/vircadia.config.ts";
import { log } from "../sdk/vircadia-world-sdk-ts/module/general/log.ts";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { sign } from "jsonwebtoken";
import { PostgresClient } from "../sdk/vircadia-world-sdk-ts/module/server/postgres.server.client.ts";
import { Service } from "../sdk/vircadia-world-sdk-ts/schema/schema.general.ts";
import { createHash } from "node:crypto";

const SERVER_DOCKER_COMPOSE_FILE = path.join(
    dirname(fileURLToPath(import.meta.url)),
    "../server/service/docker.compose.yml",
);

// Update runDockerCommand to use the single compose file
async function runDockerCommand(data: {
    service?: Service.E_Service;
    args: string[];
}) {
    const processEnv = {
        ...process.env,
        PATH: process.env.PATH,

        VRCA_SERVER_CONTAINER_NAME:
            VircadiaConfig.SERVER.VRCA_SERVER_CONTAINER_NAME,
        VRCA_SERVER_DEBUG: VircadiaConfig.SERVER.VRCA_SERVER_DEBUG.toString(),
        VRCA_SERVER_SUPPRESS:
            VircadiaConfig.SERVER.VRCA_SERVER_SUPPRESS.toString(),

        VRCA_SERVER_SERVICE_POSTGRES_SUPER_USER_USERNAME:
            VircadiaConfig.SERVER
                .VRCA_SERVER_SERVICE_POSTGRES_SUPER_USER_USERNAME,
        VRCA_SERVER_SERVICE_POSTGRES_SUPER_USER_PASSWORD:
            VircadiaConfig.SERVER
                .VRCA_SERVER_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
        VRCA_SERVER_SERVICE_POSTGRES_AGENT_PROXY_USER_USERNAME:
            VircadiaConfig.SERVER
                .VRCA_SERVER_SERVICE_POSTGRES_AGENT_PROXY_USER_USERNAME,
        VRCA_SERVER_SERVICE_POSTGRES_AGENT_PROXY_USER_PASSWORD:
            VircadiaConfig.SERVER
                .VRCA_SERVER_SERVICE_POSTGRES_AGENT_PROXY_USER_PASSWORD,
        VRCA_SERVER_SERVICE_POSTGRES_HOST_CONTAINER_EXTERNAL:
            VircadiaConfig.SERVER
                .VRCA_SERVER_SERVICE_POSTGRES_HOST_CONTAINER_EXTERNAL,
        VRCA_SERVER_SERVICE_POSTGRES_PORT_CONTAINER_EXTERNAL:
            VircadiaConfig.SERVER.VRCA_SERVER_SERVICE_POSTGRES_PORT_CONTAINER_EXTERNAL.toString(),
        VRCA_SERVER_SERVICE_POSTGRES_HOST_CONTAINER_CLUSTER:
            VircadiaConfig.SERVER
                .VRCA_SERVER_SERVICE_POSTGRES_HOST_CONTAINER_CLUSTER,
        VRCA_SERVER_SERVICE_POSTGRES_PORT_CONTAINER_CLUSTER:
            VircadiaConfig.SERVER.VRCA_SERVER_SERVICE_POSTGRES_PORT_CONTAINER_CLUSTER.toString(),
        VRCA_SERVER_SERVICE_POSTGRES_DATABASE:
            VircadiaConfig.SERVER.VRCA_SERVER_SERVICE_POSTGRES_DATABASE,
        VRCA_SERVER_SERVICE_POSTGRES_EXTENSIONS:
            VircadiaConfig.SERVER.VRCA_SERVER_SERVICE_POSTGRES_EXTENSIONS.join(
                ",",
            ),

        VRCA_SERVER_SERVICE_PGWEB_HOST_CONTAINER_EXTERNAL:
            VircadiaConfig.SERVER
                .VRCA_SERVER_SERVICE_PGWEB_HOST_CONTAINER_EXTERNAL,
        VRCA_SERVER_SERVICE_PGWEB_PORT_CONTAINER_EXTERNAL:
            VircadiaConfig.SERVER.VRCA_SERVER_SERVICE_PGWEB_PORT_CONTAINER_EXTERNAL.toString(),

        VRCA_SERVER_SERVICE_API_HOST_CONTAINER_CLUSTER:
            VircadiaConfig.SERVER
                .VRCA_SERVER_SERVICE_API_HOST_CONTAINER_CLUSTER,
        VRCA_SERVER_SERVICE_API_PORT_CONTAINER_CLUSTER:
            VircadiaConfig.SERVER.VRCA_SERVER_SERVICE_API_PORT_CONTAINER_CLUSTER.toString(),
        VRCA_SERVER_SERVICE_API_HOST_PUBLIC:
            VircadiaConfig.SERVER.VRCA_SERVER_SERVICE_API_HOST_PUBLIC,
        VRCA_SERVER_SERVICE_API_PORT_PUBLIC:
            VircadiaConfig.SERVER.VRCA_SERVER_SERVICE_API_PORT_PUBLIC.toString(),
        VRCA_SERVER_SERVICE_API_HOST_CONTAINER_EXTERNAL:
            VircadiaConfig.SERVER
                .VRCA_SERVER_SERVICE_API_HOST_CONTAINER_EXTERNAL,
        VRCA_SERVER_SERVICE_API_PORT_CONTAINER_EXTERNAL:
            VircadiaConfig.SERVER.VRCA_SERVER_SERVICE_API_PORT_CONTAINER_EXTERNAL.toString(),

        VRCA_SERVER_SERVICE_TICK_HOST_CONTAINER_EXTERNAL:
            VircadiaConfig.SERVER
                .VRCA_SERVER_SERVICE_TICK_HOST_CONTAINER_EXTERNAL,
        VRCA_SERVER_SERVICE_TICK_PORT_CONTAINER_EXTERNAL:
            VircadiaConfig.SERVER.VRCA_SERVER_SERVICE_TICK_PORT_CONTAINER_EXTERNAL.toString(),
    };

    // Construct the command
    let dockerArgs = ["docker", "compose", "-f", SERVER_DOCKER_COMPOSE_FILE];

    // Add service name if specified
    if (data.service) {
        // For commands with a specific service
        dockerArgs = [...dockerArgs, ...data.args, data.service.toLowerCase()];
    } else {
        // For when no specific service is provided
        dockerArgs = [...dockerArgs, ...data.args];
    }

    log({
        message: `[Docker Command]\n${dockerArgs.join(" ")}`,
        type: "debug",
        suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
        debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
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
            type: "debug",
            suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
            debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
        });
    }
    if (stderr) {
        // Check if stderr actually contains error indicators or just status messages
        const isActualError =
            stderr.includes("Error:") ||
            stderr.includes("error:") ||
            stderr.includes("failed") ||
            (spawnedProcess.exitCode !== 0 && spawnedProcess.exitCode !== null);

        log({
            message: `[Docker Command Output] ${isActualError ? "ERROR" : "STATUS"}\n${stderr}`,
            type: isActualError ? "error" : "debug",
            suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
            debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
        });
    }

    const exitCode = spawnedProcess.exitCode;

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
    service?: Service.E_Service;
}): Promise<void> {
    await runDockerCommand({
        service: data.service,
        args: ["up", "-d"],
    });
}

export async function upAndRebuild(data: {
    service?: Service.E_Service;
}): Promise<void> {
    await runDockerCommand({
        service: data.service,
        args: ["up", "--build", "-d"],
    });
}

export async function down(data: {
    service?: Service.E_Service;
}): Promise<void> {
    await runDockerCommand({
        args: ["down"],
        service: data.service,
    });
}

export async function downAndDestroy(data: {
    service?: Service.E_Service;
}): Promise<void> {
    await runDockerCommand({
        args: ["down", "-v"],
        service: data.service,
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
            const db = PostgresClient.getInstance({
                debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
            });

            const sql = await db.getSuperClient({
                postgres: {
                    host: VircadiaConfig.CLI.VRCA_CLI_SERVICE_POSTGRES_HOST,
                    port: VircadiaConfig.CLI.VRCA_CLI_SERVICE_POSTGRES_PORT,
                    database:
                        VircadiaConfig.CLI.VRCA_CLI_SERVICE_POSTGRES_DATABASE,
                    username:
                        VircadiaConfig.CLI
                            .VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_USERNAME,
                    password:
                        VircadiaConfig.CLI
                            .VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
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
            const url = `http://${VircadiaConfig.SERVER.VRCA_SERVER_SERVICE_API_HOST_PUBLIC}:${VircadiaConfig.SERVER.VRCA_SERVER_SERVICE_API_PORT_PUBLIC}${Service.API.Stats_Endpoint.path}`;
            const response = await fetch(url, {
                method: "POST",
                body: Service.API.Stats_Endpoint.createRequest(),
            });
            return { isHealthy: response.ok };
        } catch (error: unknown) {
            return { isHealthy: false, error: error as Error };
        }
    };

    const checkTick = async (): Promise<{
        isHealthy: boolean;
        error?: Error;
    }> => {
        try {
            const url = `http://${VircadiaConfig.SERVER.VRCA_SERVER_SERVICE_TICK_HOST_CONTAINER_EXTERNAL}:${VircadiaConfig.SERVER.VRCA_SERVER_SERVICE_TICK_PORT_CONTAINER_EXTERNAL}${Service.Tick.Stats_Endpoint.path}`;
            const response = await fetch(url, {
                method: "POST",
                body: Service.Tick.Stats_Endpoint.createRequest(),
            });
            return { isHealthy: response.ok };
        } catch (error: unknown) {
            return { isHealthy: false, error: error as Error };
        }
    };

    const [postgresHealth, pgwebHealth, apiHealth, tickHealth] =
        await Promise.all([
            checkPostgres(),
            checkPgweb(),
            checkApi(),
            checkTick(),
        ]);

    return {
        isHealthy:
            postgresHealth.isHealthy &&
            pgwebHealth.isHealthy &&
            apiHealth.isHealthy &&
            tickHealth.isHealthy,
        services: {
            postgres: postgresHealth,
            pgweb: pgwebHealth,
            api: apiHealth,
            tick: tickHealth,
        },
    };
}

export async function wipeDatabase() {
    const db = PostgresClient.getInstance({
        debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
        suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
    });
    const sql = await db.getSuperClient({
        postgres: {
            host: VircadiaConfig.CLI.VRCA_CLI_SERVICE_POSTGRES_HOST,
            port: VircadiaConfig.CLI.VRCA_CLI_SERVICE_POSTGRES_PORT,
            database: VircadiaConfig.CLI.VRCA_CLI_SERVICE_POSTGRES_DATABASE,
            username:
                VircadiaConfig.CLI
                    .VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_USERNAME,
            password:
                VircadiaConfig.CLI
                    .VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
        },
    });

    // Get list of migration files
    const resets = await readdir(
        VircadiaConfig.CLI.VRCA_CLI_SERVICE_POSTGRES_RESET_DIR,
    );
    const resetSqlFiles = resets.filter((f) => f.endsWith(".sql")).sort();

    // Run pending migrations
    for (const file of resetSqlFiles) {
        try {
            const filePath = path.join(
                VircadiaConfig.CLI.VRCA_CLI_SERVICE_POSTGRES_RESET_DIR,
                file,
            );
            const sqlContent = await readFile(filePath, "utf-8");

            await sql.begin(async (sql) => {
                await sql.unsafe(sqlContent);
            });

            log({
                message: `Reset ${file} executed successfully`,
                type: "debug",
                suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
            });
        } catch (error) {
            log({
                message: `Failed to run reset ${file}.`,
                type: "error",
                error: error,
                suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
            });
            throw error;
        }
    }
}

export async function migrate(): Promise<boolean> {
    const db = PostgresClient.getInstance({
        debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
        suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
    });
    const sql = await db.getSuperClient({
        postgres: {
            host: VircadiaConfig.CLI.VRCA_CLI_SERVICE_POSTGRES_HOST,
            port: VircadiaConfig.CLI.VRCA_CLI_SERVICE_POSTGRES_PORT,
            database: VircadiaConfig.CLI.VRCA_CLI_SERVICE_POSTGRES_DATABASE,
            username:
                VircadiaConfig.CLI
                    .VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_USERNAME,
            password:
                VircadiaConfig.CLI
                    .VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
        },
    });

    let migrationsRan = false;

    for (const name of VircadiaConfig.SERVER
        .VRCA_SERVER_SERVICE_POSTGRES_EXTENSIONS) {
        log({
            message: `Installing PostgreSQL extension: ${name}...`,
            type: "debug",
            suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
            debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
        });
        await sql`CREATE EXTENSION IF NOT EXISTS ${sql(name)};`;
        log({
            message: `PostgreSQL extension ${name} installed successfully`,
            type: "debug",
            suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
            debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
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
    const migrations = await readdir(
        VircadiaConfig.CLI.VRCA_CLI_SERVICE_POSTGRES_MIGRATION_DIR,
    );
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
        type: "debug",
        suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
        debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
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
                    VircadiaConfig.CLI.VRCA_CLI_SERVICE_POSTGRES_MIGRATION_DIR,
                    file,
                );
                const sqlContent = await readFile(filePath, "utf-8");

                log({
                    message: `Executing migration ${file}...`,
                    type: "debug",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
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
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
            } catch (error) {
                log({
                    message: `Failed to run migration ${file}.`,
                    type: "error",
                    error: error,
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
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
    const db = PostgresClient.getInstance({
        debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
        suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
    });
    const sql = await db.getSuperClient({
        postgres: {
            host: VircadiaConfig.CLI.VRCA_CLI_SERVICE_POSTGRES_HOST,
            port: VircadiaConfig.CLI.VRCA_CLI_SERVICE_POSTGRES_PORT,
            database: VircadiaConfig.CLI.VRCA_CLI_SERVICE_POSTGRES_DATABASE,
            username:
                VircadiaConfig.CLI
                    .VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_USERNAME,
            password:
                VircadiaConfig.CLI
                    .VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
        },
    });

    // Ensure we resolve the seed path to absolute path
    const seedDir = data.seedPath
        ? path.resolve(data.seedPath)
        : VircadiaConfig.CLI.VRCA_CLI_SERVICE_POSTGRES_SEED_DIR;

    log({
        message: `Attempting to read seed directory: ${seedDir}`,
        type: "debug",
        suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
        debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
    });

    // Get list of seed files
    let files: string[] = [];
    try {
        files = await readdir(seedDir);
        log({
            message: `Directory contents: ${files.length ? files.join(", ") : "(empty directory)"}`,
            type: "debug",
            suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
            debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
        });
    } catch (error) {
        log({
            message: `Error reading seed directory: ${error instanceof Error ? error.message : String(error)}`,
            type: "error",
            suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
            debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
        });
        log({
            message: `No seed directory found at ${seedDir}`,
            type: "error",
            suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
            debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
        });
        return;
    }

    const sqlFiles = files.filter((f) => f.endsWith(".sql")).sort();

    // Get already executed seeds - querying by hash now
    const result =
        await sql`SELECT general__hash, general__name FROM config.seeds`;
    const executedHashes = new Set(result.map((r) => r.general__hash));
    const executedNames = new Map(
        result.map((r) => [r.general__name, r.general__hash]),
    );

    // Run pending seeds
    for (const file of sqlFiles) {
        log({
            message: `Found seed ${file}...`,
            type: "debug",
            suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
            debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
        });

        const filePath = path.join(seedDir, file);
        const sqlContent = await readFile(filePath, "utf-8");

        // Calculate MD5 hash of the seed content
        const contentHash = createHash("md5").update(sqlContent).digest("hex");

        if (!executedHashes.has(contentHash)) {
            // If the seed name exists but with a different hash, log a warning
            if (
                executedNames.has(file) &&
                executedNames.get(file) !== contentHash
            ) {
                log({
                    message: `Warning: Seed ${file} has changed since it was last executed`,
                    type: "warn",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
            }

            log({
                message: `Executing seed ${file} (hash: ${contentHash})...`,
                type: "debug",
                suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
            });

            try {
                // Run the seed in a transaction - updated to include hash
                await sql.begin(async (sql) => {
                    await sql.unsafe(sqlContent);
                    await sql`
                        INSERT INTO config.seeds (general__hash, general__name)
                        VALUES (${contentHash}, ${file})
                    `;
                });

                log({
                    message: `Seed ${file} executed successfully`,
                    type: "debug",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
            } catch (error) {
                log({
                    message: `Failed to run seed ${file}`,
                    type: "error",
                    error: error,
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                throw error;
            }
        } else {
            log({
                message: `Seed ${file} already executed`,
                type: "debug",
                suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
            });
        }
    }
}

export async function generateDbSystemToken(): Promise<{
    token: string;
    sessionId: string;
    agentId: string;
}> {
    const db = PostgresClient.getInstance({
        debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
        suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
    });
    const sql = await db.getSuperClient({
        postgres: {
            host: VircadiaConfig.CLI.VRCA_CLI_SERVICE_POSTGRES_HOST,
            port: VircadiaConfig.CLI.VRCA_CLI_SERVICE_POSTGRES_PORT,
            database: VircadiaConfig.CLI.VRCA_CLI_SERVICE_POSTGRES_DATABASE,
            username:
                VircadiaConfig.CLI
                    .VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_USERNAME,
            password:
                VircadiaConfig.CLI
                    .VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
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
    const db = PostgresClient.getInstance({
        debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
        suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
    });
    const sql = await db.getSuperClient({
        postgres: {
            host: VircadiaConfig.CLI.VRCA_CLI_SERVICE_POSTGRES_HOST,
            port: VircadiaConfig.CLI.VRCA_CLI_SERVICE_POSTGRES_PORT,
            database: VircadiaConfig.CLI.VRCA_CLI_SERVICE_POSTGRES_DATABASE,
            username:
                VircadiaConfig.CLI
                    .VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_USERNAME,
            password:
                VircadiaConfig.CLI
                    .VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
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
    return `postgres://${VircadiaConfig.CLI.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_USERNAME}:${VircadiaConfig.CLI.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_PASSWORD}@${VircadiaConfig.CLI.VRCA_CLI_SERVICE_POSTGRES_HOST}:${VircadiaConfig.CLI.VRCA_CLI_SERVICE_POSTGRES_PORT}/${VircadiaConfig.CLI.VRCA_CLI_SERVICE_POSTGRES_DATABASE}`;
}

export async function generatePgwebAccessURL(): Promise<string> {
    return `http://${VircadiaConfig.CLI.VRCA_CLI_SERVICE_PGWEB_HOST}:${VircadiaConfig.CLI.VRCA_CLI_SERVICE_PGWEB_PORT}`;
}

// Add a new helper function to run operations on all services
export async function runForAllServices(
    operation: (service: Service.E_Service) => Promise<void>,
) {
    for (const serviceKey of Object.keys(Service.E_Service) as Array<
        keyof typeof Service.E_Service
    >) {
        const service = Service.E_Service[serviceKey];
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
        ${Object.keys(Service.E_Service)
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
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                await runForAllServices(async (svc) => {
                    log({
                        message: `Starting ${svc.toLowerCase()} service...`,
                        type: "info",
                        suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                        debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                    });
                    await up({ service: svc });
                });
                break;

            case "container-down-all":
                log({
                    message: "Stopping all services...",
                    type: "info",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                await runForAllServices(async (svc) => {
                    log({
                        message: `Stopping ${svc.toLowerCase()} service...`,
                        type: "info",
                        suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                        debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                    });
                    await down({ service: svc });
                });
                break;

            case "container-rebuild-all": {
                // First rebuild postgres only
                log({
                    message: "Rebuilding postgres service first...",
                    type: "info",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                await downAndDestroy({ service: Service.E_Service.POSTGRES });
                await upAndRebuild({ service: Service.E_Service.POSTGRES });

                // Wait for postgres to be healthy
                let pgHealthy = false;
                for (let i = 0; i < 10; i++) {
                    log({
                        message: "Waiting for postgres to be healthy...",
                        type: "info",
                    });
                    await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait 5 seconds
                    const health = await isHealthy();
                    if (health.services.postgres.isHealthy) {
                        pgHealthy = true;
                        break;
                    }
                }

                if (!pgHealthy) {
                    throw new Error(
                        "Postgres failed to become healthy after rebuild",
                    );
                }

                // Run migrations and seed data
                log({
                    message: "Running database migrations...",
                    type: "info",
                });
                const migrationsRan = await migrate();
                log({ message: "Running database seeds...", type: "info" });
                await seed({});

                log({
                    message: `${VircadiaConfig.SERVER.VRCA_SERVER_CONTAINER_NAME} container seeds applied.`,
                    type: "debug",
                });

                // Now rebuild the remaining services
                const otherServices = Object.values(Service.E_Service).filter(
                    (svc) => svc !== Service.E_Service.POSTGRES,
                );

                for (const svc of otherServices) {
                    log({
                        message: `Rebuilding ${svc.toLowerCase()} service...`,
                        type: "info",
                        suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                        debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                    });
                    await down({ service: svc });
                    await upAndRebuild({ service: svc });
                }

                // Verify all services are healthy
                const finalHealth = await isHealthy();
                if (!finalHealth.isHealthy) {
                    log({
                        message: "Failed to start some services after rebuild",
                        type: "error",
                        error: finalHealth.services,
                    });
                } else {
                    log({
                        message: "All services rebuilt successfully",
                        type: "success",
                    });
                }
                break;
            }

            case "container-restart-all": {
                log({
                    message: "Restarting all services...",
                    type: "info",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                await runForAllServices(async (svc) => {
                    log({
                        message: `Restarting ${svc.toLowerCase()} service...`,
                        type: "info",
                        suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                        debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                    });
                    await down({ service: svc });
                    await up({ service: svc });
                });

                log({
                    message: "All services restarted",
                    type: "success",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                break;
            }

            // INDIVIDUAL SERVICES COMMANDS

            // POSTGRES COMMANDS
            case "container-up-postgres":
                log({
                    message: "Starting postgres service...",
                    type: "info",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                await up({
                    service: Service.E_Service.POSTGRES,
                });
                break;

            case "container-down-postgres":
                log({
                    message: "Stopping postgres service...",
                    type: "info",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                await down({ service: Service.E_Service.POSTGRES });
                break;

            case "container-rebuild-postgres": {
                log({
                    message: "Rebuilding postgres service...",
                    type: "info",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                await down({
                    service: Service.E_Service.POSTGRES,
                });
                await upAndRebuild({
                    service: Service.E_Service.POSTGRES,
                });

                // Run migrations and seed data after postgres rebuild
                const health = await isHealthy();
                if (health.services.postgres.isHealthy) {
                    const migrationsRan = await migrate();
                    if (migrationsRan) {
                        log({
                            message: "Migrations ran successfully",
                            type: "success",
                            suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                            debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                        });
                        await seed({});
                        log({
                            message: `${VircadiaConfig.SERVER.VRCA_SERVER_CONTAINER_NAME} container seeds applied.`,
                            type: "debug",
                        });
                    }
                }
                log({
                    message: "Postgres service rebuilt successfully",
                    type: "success",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                break;
            }

            case "container-restart-postgres": {
                log({
                    message: "Restarting postgres service...",
                    type: "info",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                await down({ service: Service.E_Service.POSTGRES });
                await up({ service: Service.E_Service.POSTGRES });
                log({
                    message: "Postgres service restarted",
                    type: "success",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                break;
            }

            // PGWEB COMMANDS
            case "container-up-pgweb":
                log({
                    message: "Starting pgweb service...",
                    type: "info",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                await up({
                    service: Service.E_Service.PGWEB,
                });
                break;

            case "container-down-pgweb":
                log({
                    message: "Stopping pgweb service...",
                    type: "info",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                await down({ service: Service.E_Service.PGWEB });
                break;

            case "container-rebuild-pgweb": {
                log({
                    message: "Rebuilding pgweb service...",
                    type: "info",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                await down({
                    service: Service.E_Service.PGWEB,
                });
                await upAndRebuild({
                    service: Service.E_Service.PGWEB,
                });
                log({
                    message: "PGWEB service rebuilt successfully",
                    type: "success",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                break;
            }

            case "container-restart-pgweb": {
                log({
                    message: "Restarting pgweb service...",
                    type: "info",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                await down({ service: Service.E_Service.PGWEB });
                await up({ service: Service.E_Service.PGWEB });
                log({
                    message: "PGWEB service restarted",
                    type: "success",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                break;
            }

            // API COMMANDS
            case "container-up-api":
                log({
                    message: "Starting API service...",
                    type: "info",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                await up({
                    service: Service.E_Service.API,
                });
                break;

            case "container-down-api":
                log({
                    message: "Stopping API service...",
                    type: "info",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                await down({ service: Service.E_Service.API });
                break;

            case "container-rebuild-api": {
                log({
                    message: "Rebuilding API service...",
                    type: "info",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                await down({ service: Service.E_Service.API }); // No wipeVolumes here
                await upAndRebuild({ service: Service.E_Service.API });
                log({
                    message: "API service rebuilt successfully",
                    type: "success",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                break;
            }

            case "container-restart-api": {
                log({
                    message: "Restarting API service...",
                    type: "info",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                await down({ service: Service.E_Service.API });
                await up({ service: Service.E_Service.API });
                log({
                    message: "API service restarted",
                    type: "success",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                break;
            }

            // TICK COMMANDS
            case "container-up-tick":
                log({
                    message: "Starting tick service...",
                    type: "info",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                await up({
                    service: Service.E_Service.TICK,
                });
                break;

            case "container-down-tick":
                log({
                    message: "Stopping tick service...",
                    type: "info",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                await down({ service: Service.E_Service.TICK });
                break;

            case "container-rebuild-tick": {
                log({
                    message: "Rebuilding tick service...",
                    type: "info",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                await down({
                    service: Service.E_Service.TICK,
                });
                await upAndRebuild({
                    service: Service.E_Service.TICK,
                });
                log({
                    message: "Tick service rebuilt successfully",
                    type: "success",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                break;
            }

            case "container-restart-tick": {
                log({
                    message: "Restarting tick service...",
                    type: "info",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                await down({ service: Service.E_Service.TICK });
                await up({ service: Service.E_Service.TICK });
                log({
                    message: "Tick service restarted",
                    type: "success",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
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
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                await migrate();
                log({
                    message: "Migrations ran successfully",
                    type: "success",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                break;

            case "database-wipe":
                log({
                    message: "Wiping database...",
                    type: "info",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                await wipeDatabase();
                log({
                    message: "Database wiped",
                    type: "success",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                break;

            case "database-reset":
                log({
                    message: "Resetting database...",
                    type: "info",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                await wipeDatabase();
                await migrate();
                await seed({});
                log({
                    message: "Database reset",
                    type: "success",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                break;

            case "database-connection-string": {
                const connectionString = await generateDbConnectionString();
                log({
                    message: `Database connection string: ${connectionString}`,
                    type: "info",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                break;
            }

            case "database-system-token": {
                log({
                    message: "Generating system agent token...",
                    type: "info",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                const { token, sessionId, agentId } =
                    await generateDbSystemToken();
                log({
                    message: `System agent token: ${token}`,
                    data: { sessionId, agentId },
                    type: "success",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                break;
            }

            case "database-seed":
                log({
                    message: "Seeding database...",
                    type: "info",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                await seed({ seedPath: additionalArgs[0] });
                log({
                    message: `${VircadiaConfig.SERVER.VRCA_SERVER_CONTAINER_NAME} container seeds applied.`,
                    type: "debug",
                });
                break;

            // PGWEB COMMANDS
            case "pgweb-access-command": {
                const pgwebAccessURL = await generatePgwebAccessURL();
                log({
                    message: `Access PGWEB at: ${pgwebAccessURL}`,
                    type: "info",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                break;
            }

            default:
                printValidCommands();
                process.exit(1);
        }
    } finally {
        // Clean up database connection if it was used
        const db = PostgresClient.getInstance({
            debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
            suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
        });
        await db.disconnect();
    }
}
