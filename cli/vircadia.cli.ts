import { CLIConfiguration } from "./vircadia.cli.config";
import { ServerConfiguration } from "../sdk/vircadia-world-sdk-ts/src/server/config/vircadia.server.config";
import { BunLogModule } from "../sdk/vircadia-world-sdk-ts/src/client/module/bun/vircadia.client.bun.log";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { sign } from "jsonwebtoken";
import { BunPostgresClientModule } from "../sdk/vircadia-world-sdk-ts/src/client/module/bun/vircadia.client.bun.postgres";
import {
    type Entity,
    Service,
    type Auth,
} from "../sdk/vircadia-world-sdk-ts/src/schema/vircadia.schema.general";

// TODO: Optimize the commands, get up and down rebuilds including init to work well.

// https://github.com/tj/commander.js
// https://www.npmjs.com/package/inquirer

export namespace Server_CLI {
    const SERVER_DOCKER_COMPOSE_FILE = path.join(
        dirname(fileURLToPath(import.meta.url)),
        "../server/service/server.docker.compose.yml",
    );

    export async function runServerDockerCommand(data: {
        args: string[];
    }) {
        const processEnv = {
            ...process.env,
            PATH: process.env.PATH,

            VRCA_SERVER_CONTAINER_NAME:
                ServerConfiguration.VRCA_SERVER_CONTAINER_NAME,
            VRCA_SERVER_DEBUG: ServerConfiguration.VRCA_SERVER_DEBUG.toString(),
            VRCA_SERVER_SUPPRESS:
                ServerConfiguration.VRCA_SERVER_SUPPRESS.toString(),

            VRCA_SERVER_SERVICE_POSTGRES_CONTAINER_NAME:
                ServerConfiguration.VRCA_SERVER_SERVICE_POSTGRES_CONTAINER_NAME,
            VRCA_SERVER_SERVICE_POSTGRES_SUPER_USER_USERNAME:
                ServerConfiguration.VRCA_SERVER_SERVICE_POSTGRES_SUPER_USER_USERNAME,
            VRCA_SERVER_SERVICE_POSTGRES_SUPER_USER_PASSWORD:
                ServerConfiguration.VRCA_SERVER_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
            VRCA_SERVER_SERVICE_POSTGRES_AGENT_PROXY_USER_USERNAME:
                ServerConfiguration.VRCA_SERVER_SERVICE_POSTGRES_AGENT_PROXY_USER_USERNAME,
            VRCA_SERVER_SERVICE_POSTGRES_AGENT_PROXY_USER_PASSWORD:
                ServerConfiguration.VRCA_SERVER_SERVICE_POSTGRES_AGENT_PROXY_USER_PASSWORD,
            VRCA_SERVER_SERVICE_POSTGRES_HOST_CONTAINER_BIND_EXTERNAL:
                ServerConfiguration.VRCA_SERVER_SERVICE_POSTGRES_HOST_CONTAINER_BIND_EXTERNAL,
            VRCA_SERVER_SERVICE_POSTGRES_PORT_CONTAINER_BIND_EXTERNAL:
                ServerConfiguration.VRCA_SERVER_SERVICE_POSTGRES_PORT_CONTAINER_BIND_EXTERNAL.toString(),
            VRCA_SERVER_SERVICE_POSTGRES_DATABASE:
                ServerConfiguration.VRCA_SERVER_SERVICE_POSTGRES_DATABASE,
            VRCA_SERVER_SERVICE_POSTGRES_EXTENSIONS:
                ServerConfiguration.VRCA_SERVER_SERVICE_POSTGRES_EXTENSIONS.join(
                    ",",
                ),

            VRCA_SERVER_SERVICE_PGWEB_CONTAINER_NAME:
                ServerConfiguration.VRCA_SERVER_SERVICE_PGWEB_CONTAINER_NAME,
            VRCA_SERVER_SERVICE_PGWEB_HOST_CONTAINER_BIND_EXTERNAL:
                ServerConfiguration.VRCA_SERVER_SERVICE_PGWEB_HOST_CONTAINER_BIND_EXTERNAL,
            VRCA_SERVER_SERVICE_PGWEB_PORT_CONTAINER_BIND_EXTERNAL:
                ServerConfiguration.VRCA_SERVER_SERVICE_PGWEB_PORT_CONTAINER_BIND_EXTERNAL.toString(),

            VRCA_SERVER_SERVICE_WORLD_API_MANAGER_CONTAINER_NAME:
                ServerConfiguration.VRCA_SERVER_SERVICE_WORLD_API_MANAGER_CONTAINER_NAME,
            VRCA_SERVER_SERVICE_WORLD_API_MANAGER_HOST_CONTAINER_BIND_INTERNAL:
                ServerConfiguration.VRCA_SERVER_SERVICE_WORLD_API_MANAGER_HOST_CONTAINER_BIND_INTERNAL,
            VRCA_SERVER_SERVICE_WORLD_API_MANAGER_PORT_CONTAINER_BIND_INTERNAL:
                ServerConfiguration.VRCA_SERVER_SERVICE_WORLD_API_MANAGER_PORT_CONTAINER_BIND_INTERNAL.toString(),
            VRCA_SERVER_SERVICE_WORLD_API_MANAGER_HOST_CONTAINER_BIND_EXTERNAL:
                ServerConfiguration.VRCA_SERVER_SERVICE_WORLD_API_MANAGER_HOST_CONTAINER_BIND_EXTERNAL,
            VRCA_SERVER_SERVICE_WORLD_API_MANAGER_PORT_CONTAINER_BIND_EXTERNAL:
                ServerConfiguration.VRCA_SERVER_SERVICE_WORLD_API_MANAGER_PORT_CONTAINER_BIND_EXTERNAL.toString(),
            VRCA_SERVER_SERVICE_WORLD_API_MANAGER_HOST_PUBLIC_AVAILABLE_AT:
                ServerConfiguration.VRCA_SERVER_SERVICE_WORLD_API_MANAGER_HOST_PUBLIC_AVAILABLE_AT,
            VRCA_SERVER_SERVICE_WORLD_API_MANAGER_PORT_PUBLIC_AVAILABLE_AT:
                ServerConfiguration.VRCA_SERVER_SERVICE_WORLD_API_MANAGER_PORT_PUBLIC_AVAILABLE_AT.toString(),

            VRCA_SERVER_SERVICE_WORLD_TICK_MANAGER_CONTAINER_NAME:
                ServerConfiguration.VRCA_SERVER_SERVICE_WORLD_TICK_MANAGER_CONTAINER_NAME,
            VRCA_SERVER_SERVICE_WORLD_TICK_MANAGER_HOST_CONTAINER_BIND_INTERNAL:
                ServerConfiguration.VRCA_SERVER_SERVICE_WORLD_TICK_MANAGER_HOST_CONTAINER_BIND_INTERNAL,
            VRCA_SERVER_SERVICE_WORLD_TICK_MANAGER_PORT_CONTAINER_BIND_INTERNAL:
                ServerConfiguration.VRCA_SERVER_SERVICE_WORLD_TICK_MANAGER_PORT_CONTAINER_BIND_INTERNAL.toString(),
            VRCA_SERVER_SERVICE_WORLD_TICK_MANAGER_HOST_CONTAINER_BIND_EXTERNAL:
                ServerConfiguration.VRCA_SERVER_SERVICE_WORLD_TICK_MANAGER_HOST_CONTAINER_BIND_EXTERNAL,
            VRCA_SERVER_SERVICE_WORLD_TICK_MANAGER_PORT_CONTAINER_BIND_EXTERNAL:
                ServerConfiguration.VRCA_SERVER_SERVICE_WORLD_TICK_MANAGER_PORT_CONTAINER_BIND_EXTERNAL.toString(),
        };

        // Construct the command
        let dockerArgs = [
            "docker",
            "compose",
            "-f",
            SERVER_DOCKER_COMPOSE_FILE,
        ];

        dockerArgs = [...dockerArgs, ...data.args];

        BunLogModule({
            prefix: "Docker Command",
            message: dockerArgs.join(" "),
            type: "debug",
            suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
            debug: CLIConfiguration.VRCA_CLI_DEBUG,
        });

        const spawnedProcess = Bun.spawn(dockerArgs, {
            env: processEnv,
            stdout: "pipe",
            stderr: "pipe",
        });

        const stdout = await new Response(spawnedProcess.stdout).text();
        const stderr = await new Response(spawnedProcess.stderr).text();

        if (stdout) {
            BunLogModule({
                prefix: "Docker Command Output",
                message: stdout,
                type: "debug",
                suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                debug: CLIConfiguration.VRCA_CLI_DEBUG,
            });
        }
        if (stderr) {
            // Check if stderr actually contains error indicators or just status messages
            const isActualError =
                stderr.includes("Error:") ||
                stderr.includes("error:") ||
                stderr.includes("failed") ||
                (spawnedProcess.exitCode !== 0 &&
                    spawnedProcess.exitCode !== null);

            BunLogModule({
                prefix: "Docker Command Output",
                message: stderr,
                type: isActualError ? "error" : "debug",
                suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                debug: CLIConfiguration.VRCA_CLI_DEBUG,
            });
        }

        const exitCode = spawnedProcess.exitCode;

        const isExpectedOutput =
            data.args.includes("down") ||
            data.args.includes("up") ||
            data.args.includes("exec");
        if (exitCode !== 0 && !isExpectedOutput) {
            throw new Error(
                `SERVER Docker command failed with exit code ${exitCode}.\nStdout: ${stdout}\nStderr: ${stderr}`,
            );
        }
    }

    export async function isPostgresHealthy(
        wait?: { interval: number; timeout: number } | boolean,
    ): Promise<{
        isHealthy: boolean;
        error?: Error;
    }> {
        // Default wait settings for postgres
        const defaultWait = { interval: 100, timeout: 10000 };

        // If wait is true, use default wait settings
        const waitConfig =
            wait === true
                ? defaultWait
                : wait && typeof wait !== "boolean"
                  ? wait
                  : null;

        const checkPostgres = async (): Promise<{
            isHealthy: boolean;
            error?: Error;
        }> => {
            try {
                const db = BunPostgresClientModule.getInstance({
                    debug: CLIConfiguration.VRCA_CLI_DEBUG,
                    suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                });

                const sql = await db.getSuperClient({
                    postgres: {
                        host: CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_HOST,
                        port: CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_PORT,
                        database:
                            CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_DATABASE,
                        username:
                            CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_USERNAME,
                        password:
                            CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
                    },
                });
                await sql`SELECT 1`;
                return { isHealthy: true };
            } catch (error: unknown) {
                return { isHealthy: false, error: error as Error };
            }
        };

        // If waiting is not enabled, just check once
        if (!waitConfig) {
            return await checkPostgres();
        }

        // With waiting enabled, retry until timeout
        const startTime = Date.now();
        let lastError: Error | undefined;

        while (Date.now() - startTime < waitConfig.timeout) {
            const result = await checkPostgres();
            if (result.isHealthy) {
                return result;
            }
            lastError = result.error;
            await Bun.sleep(waitConfig.interval);
        }

        return { isHealthy: false, error: lastError };
    }

    export async function isPgwebHealthy(
        wait?:
            | {
                  interval: number;
                  timeout: number;
              }
            | boolean,
    ): Promise<{
        isHealthy: boolean;
        error?: Error;
    }> {
        const defaultWait = { interval: 100, timeout: 10000 };

        const waitConfig =
            wait === true
                ? defaultWait
                : wait && typeof wait !== "boolean"
                  ? wait
                  : null;

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

        // If waiting is not enabled, just check once
        if (!waitConfig) {
            return await checkPgweb();
        }

        // With waiting enabled, retry until timeout
        const startTime = Date.now();
        let lastError: Error | undefined;

        while (Date.now() - startTime < waitConfig.timeout) {
            const result = await checkPgweb();
            if (result.isHealthy) {
                return result;
            }
            lastError = result.error;
            await Bun.sleep(waitConfig.interval);
        }

        return { isHealthy: false, error: lastError };
    }

    export async function isWorldApiManagerHealthy(
        wait?:
            | {
                  interval: number;
                  timeout: number;
              }
            | boolean,
    ): Promise<{
        isHealthy: boolean;
        error?: Error;
    }> {
        const defaultWait = { interval: 100, timeout: 10000 };

        const waitConfig =
            wait === true
                ? defaultWait
                : wait && typeof wait !== "boolean"
                  ? wait
                  : null;

        const checkWorldApiManager = async (): Promise<{
            isHealthy: boolean;
            error?: Error;
        }> => {
            try {
                const url = `http://${CLIConfiguration.VRCA_CLI_SERVICE_WORLD_API_MANAGER_HOST}:${CLIConfiguration.VRCA_CLI_SERVICE_WORLD_API_MANAGER_PORT}${Service.API.Stats_Endpoint.path}`;
                const response = await fetch(url, {
                    method: "POST",
                    body: Service.API.Stats_Endpoint.createRequest(),
                });
                return { isHealthy: response.ok };
            } catch (error: unknown) {
                return { isHealthy: false, error: error as Error };
            }
        };

        // If waiting is not enabled, just check once
        if (!waitConfig) {
            return await checkWorldApiManager();
        }

        // With waiting enabled, retry until timeout
        const startTime = Date.now();
        let lastError: Error | undefined;

        while (Date.now() - startTime < waitConfig.timeout) {
            const result = await checkWorldApiManager();
            if (result.isHealthy) {
                return result;
            }
            lastError = result.error;
            await Bun.sleep(waitConfig.interval);
        }

        return { isHealthy: false, error: lastError };
    }

    export async function isWorldTickManagerHealthy(
        wait?:
            | {
                  interval: number;
                  timeout: number;
              }
            | boolean,
    ): Promise<{
        isHealthy: boolean;
        error?: Error;
    }> {
        const defaultWait = { interval: 100, timeout: 10000 };

        const waitConfig =
            wait === true
                ? defaultWait
                : wait && typeof wait !== "boolean"
                  ? wait
                  : null;

        const checkWorldTickManager = async (): Promise<{
            isHealthy: boolean;
            error?: Error;
        }> => {
            try {
                const url = `http://${CLIConfiguration.VRCA_CLI_SERVICE_WORLD_TICK_MANAGER_HOST}:${CLIConfiguration.VRCA_CLI_SERVICE_WORLD_TICK_MANAGER_PORT}${Service.Tick.Stats_Endpoint.path}`;
                const response = await fetch(url, {
                    method: "POST",
                    body: Service.Tick.Stats_Endpoint.createRequest(),
                });
                return { isHealthy: response.ok };
            } catch (error: unknown) {
                return { isHealthy: false, error: error as Error };
            }
        };

        // If waiting is not enabled, just check once
        if (!waitConfig) {
            return await checkWorldTickManager();
        }

        // With waiting enabled, retry until timeout
        const startTime = Date.now();
        let lastError: Error | undefined;

        while (Date.now() - startTime < waitConfig.timeout) {
            const result = await checkWorldTickManager();
            if (result.isHealthy) {
                return result;
            }
            lastError = result.error;
            await Bun.sleep(waitConfig.interval);
        }

        return { isHealthy: false, error: lastError };
    }

    export async function wipeDatabase() {
        const db = BunPostgresClientModule.getInstance({
            debug: CLIConfiguration.VRCA_CLI_DEBUG,
            suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
        });
        const sql = await db.getSuperClient({
            postgres: {
                host: CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_HOST,
                port: CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_PORT,
                database: CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_DATABASE,
                username:
                    CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_USERNAME,
                password:
                    CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
            },
        });

        try {
            // Get list of migration files
            const systemResetDir =
                CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_SYSTEM_RESET_DIR;
            const userResetDir =
                CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_USER_RESET_DIR;

            // Process system reset files
            let systemResetFiles: string[] = [];
            try {
                systemResetFiles = await readdir(systemResetDir, {
                    recursive: true,
                });

                if (systemResetFiles.length === 0) {
                    BunLogModule({
                        message: `No system reset files found in ${systemResetDir}`,
                        type: "debug",
                        suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                        debug: CLIConfiguration.VRCA_CLI_DEBUG,
                    });
                }
            } catch (error) {
                BunLogModule({
                    message: `Error accessing system reset directory: ${systemResetDir}`,
                    type: "warn",
                    error,
                    suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                    debug: CLIConfiguration.VRCA_CLI_DEBUG,
                });
            }

            // Process user reset files
            let userResetFiles: string[] = [];
            if (userResetDir) {
                try {
                    userResetFiles = await readdir(userResetDir, {
                        recursive: true,
                    });

                    if (userResetFiles.length === 0) {
                        BunLogModule({
                            message: `No user reset files found in ${userResetDir}`,
                            type: "debug",
                            suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                            debug: CLIConfiguration.VRCA_CLI_DEBUG,
                        });
                    }
                } catch (error) {
                    BunLogModule({
                        message: `Error accessing user reset directory: ${userResetDir}`,
                        type: "warn",
                        error,
                        suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                        debug: CLIConfiguration.VRCA_CLI_DEBUG,
                    });
                }
            } else {
                BunLogModule({
                    message: "User reset directory not configured",
                    type: "debug",
                    suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                    debug: CLIConfiguration.VRCA_CLI_DEBUG,
                });
            }

            // Combine and filter SQL files
            const resetSqlFiles = [...systemResetFiles, ...userResetFiles]
                .filter((f) => f.endsWith(".sql"))
                .sort();

            if (resetSqlFiles.length === 0) {
                BunLogModule({
                    message: "No reset SQL files found",
                    type: "warn",
                    suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                    debug: CLIConfiguration.VRCA_CLI_DEBUG,
                });
            }

            // Run pending migrations
            for (const file of resetSqlFiles) {
                try {
                    // Determine the correct directory for the file
                    const isUserResetFile = userResetFiles.includes(file);
                    const fileDir =
                        isUserResetFile && userResetDir
                            ? userResetDir
                            : systemResetDir;
                    const filePath = path.join(fileDir, file);

                    const sqlContent = await readFile(filePath, "utf-8");

                    await sql.begin(async (sql) => {
                        // Set isolation level to SERIALIZABLE for the reset
                        await sql.unsafe(
                            "SET TRANSACTION ISOLATION LEVEL SERIALIZABLE",
                        );
                        await sql.unsafe(sqlContent);
                    });

                    BunLogModule({
                        message: `Reset ${file} executed successfully`,
                        type: "debug",
                        suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                        debug: CLIConfiguration.VRCA_CLI_DEBUG,
                    });
                } catch (error) {
                    BunLogModule({
                        message: `Failed to run reset ${file}.`,
                        type: "error",
                        error: error,
                        suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                        debug: CLIConfiguration.VRCA_CLI_DEBUG,
                    });
                    throw error;
                }
            }
        } catch (error) {
            BunLogModule({
                message: `Database reset failed: ${error}`,
                type: "error",
                suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                debug: CLIConfiguration.VRCA_CLI_DEBUG,
            });
            throw error;
        }
    }

    export async function migrate(): Promise<boolean> {
        const db = BunPostgresClientModule.getInstance({
            debug: CLIConfiguration.VRCA_CLI_DEBUG,
            suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
        });
        const sql = await db.getSuperClient({
            postgres: {
                host: CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_HOST,
                port: CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_PORT,
                database: CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_DATABASE,
                username:
                    CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_USERNAME,
                password:
                    CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
            },
        });

        let migrationsRan = false;

        for (const name of ServerConfiguration.VRCA_SERVER_SERVICE_POSTGRES_EXTENSIONS) {
            BunLogModule({
                message: `Installing PostgreSQL extension: ${name}...`,
                type: "debug",
                suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                debug: CLIConfiguration.VRCA_CLI_DEBUG,
            });
            await sql`CREATE EXTENSION IF NOT EXISTS ${sql(name)};`;
            BunLogModule({
                message: `PostgreSQL extension ${name} installed successfully`,
                type: "debug",
                suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                debug: CLIConfiguration.VRCA_CLI_DEBUG,
            });
        }

        // Create config schema and migrations table if they don't exist
        await sql.unsafe("CREATE SCHEMA IF NOT EXISTS config");

        await sql.unsafe(`
        CREATE TABLE IF NOT EXISTS config.migrations (
            general__name VARCHAR(255) UNIQUE PRIMARY KEY NOT NULL,
            general__executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

        // Get list of migration files
        const migrations = await readdir(
            CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_MIGRATION_DIR,
            {
                recursive: true,
            },
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

        BunLogModule({
            message: `Attempting to read migrations directory: ${migrations}, found ${migrationSqlFiles.length} files`,
            type: "debug",
            suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
            debug: CLIConfiguration.VRCA_CLI_DEBUG,
        });

        // Get already executed migrations
        const result = await sql<
            {
                general__name: string;
            }[]
        >`SELECT general__name FROM config.migrations ORDER BY general__name`;
        const executedMigrations = result.map((r) => r.general__name);

        // Run pending migrations
        for (const file of migrationSqlFiles) {
            if (!executedMigrations.includes(file)) {
                migrationsRan = true;
                try {
                    const filePath = path.join(
                        CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_MIGRATION_DIR,
                        file,
                    );
                    const sqlContent = await readFile(filePath, "utf-8");

                    BunLogModule({
                        message: `Executing migration ${file}...`,
                        type: "debug",
                        suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                        debug: CLIConfiguration.VRCA_CLI_DEBUG,
                    });

                    await sql.begin(async (sql) => {
                        await sql.unsafe(sqlContent);
                        await sql`
                        INSERT INTO config.migrations (general__name)
                        VALUES (${file})
                    `;
                    });

                    BunLogModule({
                        message: `Migration ${file} executed successfully`,
                        type: "debug",
                        suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                        debug: CLIConfiguration.VRCA_CLI_DEBUG,
                    });
                } catch (error) {
                    BunLogModule({
                        message: `Failed to run migration ${file}.`,
                        type: "error",
                        error: error,
                        suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                        debug: CLIConfiguration.VRCA_CLI_DEBUG,
                    });
                    throw error;
                }
            }
        }

        return migrationsRan;
    }

    // Separate seed functions for SQL and assets
    export async function seedSql() {
        const db = BunPostgresClientModule.getInstance({
            debug: CLIConfiguration.VRCA_CLI_DEBUG,
            suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
        });
        const sql = await db.getSuperClient({
            postgres: {
                host: CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_HOST,
                port: CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_PORT,
                database: CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_DATABASE,
                username:
                    CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_USERNAME,
                password:
                    CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
            },
        });

        // Ensure we resolve the seed path to absolute path
        const systemSqlDir =
            CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_SEED_SYSTEM_SQL_DIR;

        const userSqlDir =
            CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_SEED_USER_SQL_DIR;

        try {
            // Get already executed seeds - querying by hash
            const result =
                await sql`SELECT general__hash, general__name FROM config.seeds`;
            const executedHashes = new Set(result.map((r) => r.general__hash));
            const executedNames = new Map(
                result.map((r) => [r.general__name, r.general__hash]),
            );

            // Process system SQL files
            let systemSqlFiles: string[] = [];
            if (systemSqlDir) {
                try {
                    const filesInSystemSqlDir = await readdir(systemSqlDir, {
                        recursive: true,
                    });
                    systemSqlFiles = filesInSystemSqlDir
                        .filter((f) => f.endsWith(".sql"))
                        .sort();

                    BunLogModule({
                        message: `Found ${systemSqlFiles.length} system SQL seed files in ${systemSqlDir}`,
                        type: "debug",
                        suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                        debug: CLIConfiguration.VRCA_CLI_DEBUG,
                    });
                } catch (error) {
                    BunLogModule({
                        message: `No system SQL seed files found or error accessing directory: ${systemSqlDir}`,
                        type: "warn",
                        error,
                        suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                        debug: CLIConfiguration.VRCA_CLI_DEBUG,
                    });
                }
            } else {
                BunLogModule({
                    message: "System SQL directory not configured",
                    type: "warn",
                    suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                    debug: CLIConfiguration.VRCA_CLI_DEBUG,
                });
            }

            // Process user SQL files if directory exists
            let userSqlFiles: string[] = [];
            if (userSqlDir) {
                try {
                    const filesInUserSqlDir = await readdir(userSqlDir, {
                        recursive: true,
                    });
                    userSqlFiles = filesInUserSqlDir
                        .filter((f) => f.endsWith(".sql"))
                        .sort();

                    BunLogModule({
                        message: `Found ${userSqlFiles.length} user SQL seed files in ${userSqlDir}`,
                        type: "debug",
                        suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                        debug: CLIConfiguration.VRCA_CLI_DEBUG,
                    });
                } catch (error) {
                    BunLogModule({
                        message: `No user SQL seed files found or error accessing directory: ${userSqlDir}`,
                        type: "warn",
                        error,
                        suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                        debug: CLIConfiguration.VRCA_CLI_DEBUG,
                    });
                }
            } else {
                BunLogModule({
                    message: "User SQL directory not configured",
                    type: "warn",
                    suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                    debug: CLIConfiguration.VRCA_CLI_DEBUG,
                });
            }

            if (systemSqlFiles.length === 0 && userSqlFiles.length === 0) {
                BunLogModule({
                    message: `No SQL seed files found in either ${systemSqlDir || "undefined"} or ${userSqlDir || "undefined"}`,
                    type: "info",
                    suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                    debug: CLIConfiguration.VRCA_CLI_DEBUG,
                });
                return;
            }

            // Process SQL files sequentially (required for SQL)
            for (const sqlFile of systemSqlFiles) {
                if (systemSqlDir) {
                    await processSqlFile(sqlFile, systemSqlDir);
                }
            }

            for (const sqlFile of userSqlFiles) {
                if (userSqlDir) {
                    await processSqlFile(sqlFile, userSqlDir);
                }
            }

            // Helper function to process a single SQL file
            async function processSqlFile(sqlFile: string, directory: string) {
                BunLogModule({
                    message: `Found seed ${sqlFile}...`,
                    type: "debug",
                    suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                    debug: CLIConfiguration.VRCA_CLI_DEBUG,
                });

                const filePath = path.join(directory, sqlFile);
                const sqlContent = await readFile(filePath, "utf-8");

                // Calculate hash using pgcrypto instead of MD5
                const [{ content_hash }] = await sql<
                    [{ content_hash: string }]
                >`
                    SELECT encode(digest(${sqlContent}, 'sha256'), 'hex') as content_hash
                `;

                if (!executedHashes.has(content_hash)) {
                    // If the seed name exists but with a different hash, log a warning
                    if (
                        executedNames.has(sqlFile) &&
                        executedNames.get(sqlFile) !== content_hash
                    ) {
                        BunLogModule({
                            message: `Warning: Seed ${sqlFile} has changed since it was last executed`,
                            type: "warn",
                            suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                            debug: CLIConfiguration.VRCA_CLI_DEBUG,
                        });
                    }

                    BunLogModule({
                        message: `Executing seed ${sqlFile} (hash: ${content_hash})...`,
                        type: "debug",
                        suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                        debug: CLIConfiguration.VRCA_CLI_DEBUG,
                    });

                    try {
                        // Run the seed in a transaction
                        await sql.begin(async (sql) => {
                            await sql.unsafe(sqlContent);
                            await sql`
                                INSERT INTO config.seeds (general__hash, general__name)
                                VALUES (${content_hash}, ${sqlFile})
                            `;
                        });

                        BunLogModule({
                            message: `Seed ${sqlFile} executed successfully`,
                            type: "debug",
                            suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                            debug: CLIConfiguration.VRCA_CLI_DEBUG,
                        });
                    } catch (error) {
                        BunLogModule({
                            message: `Failed to run seed ${sqlFile}`,
                            data: {
                                directory,
                            },
                            type: "error",
                            error: error,
                            suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                            debug: CLIConfiguration.VRCA_CLI_DEBUG,
                        });
                        throw error;
                    }
                } else {
                    BunLogModule({
                        message: `Seed ${sqlFile} already executed`,
                        type: "debug",
                        suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                        debug: CLIConfiguration.VRCA_CLI_DEBUG,
                    });
                }
            }

            BunLogModule({
                message: "SQL seeding completed successfully",
                type: "success",
                suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                debug: CLIConfiguration.VRCA_CLI_DEBUG,
            });
        } catch (error) {
            BunLogModule({
                message: `Error processing SQL seed files: ${error instanceof Error ? error.message : String(error)}`,
                type: "error",
                suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                debug: CLIConfiguration.VRCA_CLI_DEBUG,
            });
            throw error;
        }
    }

    export async function seedAssets(data: {
        options?: {
            parallelProcessing?: boolean;
            batchSize?: number;
            syncGroup?: string;
        };
    }) {
        const syncGroup = data.options?.syncGroup;
        const options = {
            parallelProcessing: true,
            batchSize: 10,
            ...data.options,
        };

        const db = BunPostgresClientModule.getInstance({
            debug: CLIConfiguration.VRCA_CLI_DEBUG,
            suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
        });
        const sql = await db.getSuperClient({
            postgres: {
                host: CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_HOST,
                port: CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_PORT,
                database: CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_DATABASE,
                username:
                    CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_USERNAME,
                password:
                    CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
            },
        });

        // Get paths for both system and user asset directories
        const systemAssetDir =
            CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_SEED_SYSTEM_ASSET_DIR;
        const userAssetDir =
            CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_SEED_USER_ASSET_DIR;

        try {
            // Get all assets from the database with one query
            const dbAssets = await sql<
                Pick<Entity.Asset.I_Asset, "general__asset_file_name">[]
            >`
                SELECT general__asset_file_name FROM entity.entity_assets
            `;

            BunLogModule({
                message: `Found ${dbAssets.length} assets in database`,
                type: "debug",
                suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                debug: CLIConfiguration.VRCA_CLI_DEBUG,
            });

            // Process system asset files
            let filesInSystemAssetDir: string[] = [];
            if (systemAssetDir) {
                try {
                    filesInSystemAssetDir = await readdir(systemAssetDir, {
                        recursive: true,
                    });

                    BunLogModule({
                        message: `Found ${filesInSystemAssetDir.length} system asset files in ${systemAssetDir}`,
                        type: "debug",
                        suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                        debug: CLIConfiguration.VRCA_CLI_DEBUG,
                    });
                } catch (error) {
                    BunLogModule({
                        message: `No system asset files found or error accessing directory: ${systemAssetDir}`,
                        type: "warn",
                        error,
                        suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                        debug: CLIConfiguration.VRCA_CLI_DEBUG,
                    });
                }
            } else {
                BunLogModule({
                    message: "System asset directory not configured",
                    type: "warn",
                    suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                    debug: CLIConfiguration.VRCA_CLI_DEBUG,
                });
            }

            // Process user asset files
            let filesInUserAssetDir: string[] = [];
            if (userAssetDir) {
                try {
                    filesInUserAssetDir = await readdir(userAssetDir, {
                        recursive: true,
                    });

                    BunLogModule({
                        message: `Found ${filesInUserAssetDir.length} user asset files in ${userAssetDir}`,
                        type: "debug",
                        suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                        debug: CLIConfiguration.VRCA_CLI_DEBUG,
                    });
                } catch (error) {
                    BunLogModule({
                        message: `No user asset files found or error accessing directory: ${userAssetDir}`,
                        type: "warn",
                        error,
                        suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                        debug: CLIConfiguration.VRCA_CLI_DEBUG,
                    });
                }
            } else {
                BunLogModule({
                    message: "User asset directory not configured",
                    type: "warn",
                    suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                    debug: CLIConfiguration.VRCA_CLI_DEBUG,
                });
            }

            if (
                filesInSystemAssetDir.length === 0 &&
                filesInUserAssetDir.length === 0
            ) {
                BunLogModule({
                    message: `No asset files found in either ${systemAssetDir || "undefined"} or ${userAssetDir || "undefined"}`,
                    type: "info",
                    suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                    debug: CLIConfiguration.VRCA_CLI_DEBUG,
                });
                return;
            }

            // Prepare system asset files for processing
            const systemAssetFileNames = systemAssetDir
                ? filesInSystemAssetDir.map((file) => {
                      const parsedName = path.parse(file);
                      return {
                          fileName: file,
                          searchName: parsedName.name + parsedName.ext,
                          directory: systemAssetDir,
                      };
                  })
                : [];

            // Prepare user asset files for processing
            const userAssetFileNames = userAssetDir
                ? filesInUserAssetDir.map((file) => {
                      const parsedName = path.parse(file);
                      return {
                          fileName: file,
                          searchName: parsedName.name + parsedName.ext,
                          directory: userAssetDir,
                      };
                  })
                : [];

            // Combine all asset files, with user assets taking precedence
            // over system assets with the same name
            const allAssetFileNames = [...systemAssetFileNames];

            // Add user assets, overriding any system assets with the same searchName
            for (const userAsset of userAssetFileNames) {
                const systemAssetIndex = allAssetFileNames.findIndex(
                    (asset) => asset.searchName === userAsset.searchName,
                );

                if (systemAssetIndex >= 0) {
                    // Replace the system asset with the user asset
                    allAssetFileNames[systemAssetIndex] = userAsset;
                    BunLogModule({
                        message: `User asset '${userAsset.fileName}' overrides system asset with the same name`,
                        type: "debug",
                        suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                        debug: CLIConfiguration.VRCA_CLI_DEBUG,
                    });
                } else {
                    // Add the user asset
                    allAssetFileNames.push(userAsset);
                }
            }

            // Function to process a single asset file
            const processAssetFile = async ({
                fileName,
                searchName,
                directory,
            }: { fileName: string; searchName: string; directory: string }) => {
                const assetPath = path.join(directory, fileName);

                // When using S3-style paths, we need to check for exact matches or create a new asset
                // instead of matching based on parts of the filename
                const matchingAssets = dbAssets.filter(
                    (dbAsset) =>
                        dbAsset.general__asset_file_name === searchName,
                );

                // Read asset file content as buffer
                const file = Bun.file(assetPath);
                const buffer = await file.arrayBuffer();

                const assetDataBinary = Buffer.from(buffer);

                // Get the file extension for asset type
                const fileExt = path
                    .extname(fileName)
                    .toUpperCase()
                    .substring(1);

                if (matchingAssets.length === 0) {
                    // Asset doesn't exist in DB yet, create a new one with the full path as name
                    try {
                        await sql`
                            INSERT INTO entity.entity_assets
                            (general__asset_file_name, asset__data__bytea, asset__mime_type, group__sync)
                            VALUES (${searchName}, ${assetDataBinary}, ${fileExt}, 
                                ${syncGroup || "public.NORMAL"})
                        `;

                        BunLogModule({
                            message: `Added new asset to database: ${searchName}`,
                            type: "debug",
                            suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                            debug: CLIConfiguration.VRCA_CLI_DEBUG,
                        });
                    } catch (error) {
                        BunLogModule({
                            message: `Failed to add new asset to database: ${searchName}`,
                            type: "error",
                            error: error,
                            suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                            debug: CLIConfiguration.VRCA_CLI_DEBUG,
                        });
                    }
                    return;
                }

                // Update existing assets
                try {
                    await sql.begin(async (sql) => {
                        for (const dbAsset of matchingAssets) {
                            await sql`
                                UPDATE entity.entity_assets 
                                SET 
                                    asset__data__bytea = ${assetDataBinary}
                                WHERE general__asset_file_name = ${dbAsset.general__asset_file_name}
                            `;
                        }
                    });

                    BunLogModule({
                        message: `Updated ${matchingAssets.length} assets from file ${fileName}`,
                        type: "debug",
                        suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                        debug: CLIConfiguration.VRCA_CLI_DEBUG,
                    });
                } catch (error) {
                    BunLogModule({
                        message: `Failed to update assets from file ${fileName}`,
                        type: "error",
                        error: error,
                        suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                        debug: CLIConfiguration.VRCA_CLI_DEBUG,
                    });
                }
            };

            // When processing assets, filter by sync group
            let assetsToProcess = allAssetFileNames;

            if (syncGroup) {
                // Get all assets in the specified sync group
                const syncGroupAssets = await sql<
                    { general__asset_file_name: string }[]
                >`
                    SELECT general__asset_file_name 
                    FROM entity.entity_assets 
                    WHERE group__sync = ${syncGroup}
                `;

                // Only process assets that belong to this sync group
                assetsToProcess = allAssetFileNames.filter((asset) =>
                    syncGroupAssets.some((dbAsset) =>
                        dbAsset.general__asset_file_name.includes(
                            asset.searchName,
                        ),
                    ),
                );
            }

            // Process assets in parallel or sequentially
            if (options.parallelProcessing) {
                // Process in batches
                for (
                    let i = 0;
                    i < assetsToProcess.length;
                    i += options.batchSize
                ) {
                    const batch = assetsToProcess.slice(
                        i,
                        i + options.batchSize,
                    );
                    await Promise.all(batch.map(processAssetFile));
                }
            } else {
                for (const assetFile of assetsToProcess) {
                    await processAssetFile(assetFile);
                }
            }

            BunLogModule({
                message: "Asset seeding completed successfully",
                type: "success",
                suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                debug: CLIConfiguration.VRCA_CLI_DEBUG,
            });
        } catch (error) {
            BunLogModule({
                message: `Error processing asset files: ${error instanceof Error ? error.message : String(error)}`,
                type: "error",
                suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                debug: CLIConfiguration.VRCA_CLI_DEBUG,
            });
            throw error;
        }
    }

    export async function generateDbSystemToken(): Promise<{
        token: string;
        sessionId: string;
        agentId: string;
    }> {
        const db = BunPostgresClientModule.getInstance({
            debug: CLIConfiguration.VRCA_CLI_DEBUG,
            suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
        });
        const sql = await db.getSuperClient({
            postgres: {
                host: CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_HOST,
                port: CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_PORT,
                database: CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_DATABASE,
                username:
                    CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_USERNAME,
                password:
                    CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
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
        const systemAgentId = systemId.get_system_agent_id;

        // Insert a new session for the system agent directly, computing expiration from the provider's duration
        const [sessionResult] = await sql`
            INSERT INTO auth.agent_sessions (
                auth__agent_id,
                auth__provider_name,
                session__expires_at
            )
            VALUES (
                ${systemAgentId},
                'system',
                (NOW() + (${jwtDuration} || ' milliseconds')::INTERVAL)
            )
            RETURNING *
        `;

        // Generate JWT token using the provider config
        const token = sign(
            {
                sessionId: sessionResult.general__session_id,
                agentId: systemAgentId,
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

        // Get all available sync groups
        const syncGroups = await sql<[Auth.SyncGroup.I_SyncGroup]>`
            SELECT general__sync_group
            FROM auth.sync_groups
        `;

        // Assign the system agent to all sync groups with full permissions
        for (const group of syncGroups) {
            await sql`
                INSERT INTO auth.agent_sync_group_roles (
                    auth__agent_id,
                    group__sync,
                    permissions__can_read,
                    permissions__can_insert,
                    permissions__can_update,
                    permissions__can_delete
                ) VALUES (
                    ${systemAgentId},
                    ${group.general__sync_group},
                    true,
                    true,
                    true,
                    true
                )
                ON CONFLICT (auth__agent_id, group__sync) 
                DO UPDATE SET
                    permissions__can_read = true,
                    permissions__can_insert = true,
                    permissions__can_update = true,
                    permissions__can_delete = true
            `;
        }

        return {
            token,
            sessionId: sessionResult.general__session_id,
            agentId: systemAgentId,
        };
    }

    export async function invalidateDbSystemTokens(): Promise<number> {
        const db = BunPostgresClientModule.getInstance({
            debug: CLIConfiguration.VRCA_CLI_DEBUG,
            suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
        });
        const sql = await db.getSuperClient({
            postgres: {
                host: CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_HOST,
                port: CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_PORT,
                database: CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_DATABASE,
                username:
                    CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_USERNAME,
                password:
                    CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
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
        return `postgres://${CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_USERNAME}:${CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_PASSWORD}@${CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_HOST}:${CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_PORT}/${CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_DATABASE}`;
    }

    export async function generatePgwebAccessURL(): Promise<string> {
        return `http://${CLIConfiguration.VRCA_CLI_SERVICE_PGWEB_HOST}:${CLIConfiguration.VRCA_CLI_SERVICE_PGWEB_PORT}`;
    }

    export async function downloadAssetsFromDatabase(data: {
        options?: {
            parallelProcessing?: boolean;
            batchSize?: number;
            syncGroup?: string;
            outputDir?: string;
        };
    }) {
        const options = {
            parallelProcessing: true,
            batchSize: 10,
            ...data.options,
        };

        // Use the configured sync directory or the one provided in options
        const outputDir =
            options.outputDir ||
            CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_SYNC_ASSET_DIR;

        if (!outputDir) {
            throw new Error("Output directory not configured");
        }

        const db = BunPostgresClientModule.getInstance({
            debug: CLIConfiguration.VRCA_CLI_DEBUG,
            suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
        });
        const sql = await db.getSuperClient({
            postgres: {
                host: CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_HOST,
                port: CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_PORT,
                database: CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_DATABASE,
                username:
                    CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_USERNAME,
                password:
                    CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
            },
        });

        BunLogModule({
            message: `Starting asset download to ${outputDir}...`,
            type: "info",
            suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
            debug: CLIConfiguration.VRCA_CLI_DEBUG,
        });

        try {
            // Ensure output directory exists
            if (!existsSync(outputDir)) {
                await mkdir(outputDir, { recursive: true });
            }

            // Query assets, optionally filtering by sync group
            const assetsQuery = options.syncGroup
                ? sql<
                      Pick<
                          Entity.Asset.I_Asset,
                          | "general__asset_file_name"
                          | "asset__data__bytea"
                          | "asset__mime_type"
                      >[]
                  >`
                    SELECT 
                        general__asset_file_name, 
                        asset__data__bytea,
                        asset__mime_type 
                    FROM entity.entity_assets 
                    WHERE group__sync = ${options.syncGroup}
                  `
                : sql<
                      Pick<
                          Entity.Asset.I_Asset,
                          | "general__asset_file_name"
                          | "asset__data__bytea"
                          | "asset__mime_type"
                      >[]
                  >`
                    SELECT 
                        general__asset_file_name, 
                        asset__data__bytea,
                        asset__mime_type 
                    FROM entity.entity_assets
                  `;

            const assets = await assetsQuery;

            BunLogModule({
                message: options.syncGroup
                    ? `Retrieved ${assets.length} assets with sync group: ${options.syncGroup}`
                    : `Retrieved ${assets.length} assets from database`,
                type: "info",
                suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                debug: CLIConfiguration.VRCA_CLI_DEBUG,
            });

            // Function to process a single asset
            const processAsset = async (asset: {
                general__asset_file_name: string;
                asset__data__bytea?: Buffer | Uint8Array | null;
                asset__mime_type?: string;
                [key: string]: unknown;
            }) => {
                try {
                    const fileName = asset.general__asset_file_name;

                    // Handle S3-style paths in the filename (folders encoded in the name)
                    // This preserves any folder structure in the asset name
                    const filePath = path.join(outputDir, fileName);

                    // Ensure the directory exists
                    const dirPath = path.dirname(filePath);
                    if (!existsSync(dirPath)) {
                        await mkdir(dirPath, { recursive: true });
                    }

                    // Save the binary data to file
                    if (asset.asset__data__bytea) {
                        await writeFile(
                            filePath,
                            Buffer.from(asset.asset__data__bytea),
                        );

                        BunLogModule({
                            message: `Downloaded asset: ${fileName}`,
                            type: "debug",
                            suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                            debug: CLIConfiguration.VRCA_CLI_DEBUG,
                        });
                    } else {
                        BunLogModule({
                            message: `No binary data for asset: ${fileName}`,
                            type: "warn",
                            suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                            debug: CLIConfiguration.VRCA_CLI_DEBUG,
                        });
                    }
                } catch (error) {
                    BunLogModule({
                        message: `Error downloading asset: ${asset.general__asset_file_name}`,
                        type: "error",
                        error,
                        suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                        debug: CLIConfiguration.VRCA_CLI_DEBUG,
                    });
                }
            };

            // Process assets in parallel or sequentially
            if (options.parallelProcessing) {
                // Process in batches
                for (let i = 0; i < assets.length; i += options.batchSize) {
                    const batch = assets.slice(i, i + options.batchSize);
                    await Promise.all(batch.map(processAsset));
                }
            } else {
                for (const asset of assets) {
                    await processAsset(asset);
                }
            }

            BunLogModule({
                message: `Asset download completed successfully. Downloaded ${assets.length} assets.`,
                type: "success",
                suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                debug: CLIConfiguration.VRCA_CLI_DEBUG,
            });
        } catch (error) {
            BunLogModule({
                message: "Error downloading assets from database",
                type: "error",
                error,
                suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                debug: CLIConfiguration.VRCA_CLI_DEBUG,
            });
        }
    }

    export async function backupDatabase() {
        // Config values - ensure these are correctly loaded from your config setup
        const dbUser =
            CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_USERNAME;
        const dbName = CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_DATABASE;
        const backupFilePathHost =
            CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_BACKUP_FILE; // Path on the host machine where the backup will be saved
        const containerName =
            ServerConfiguration.VRCA_SERVER_SERVICE_POSTGRES_CONTAINER_NAME;

        try {
            // Ensure backup directory exists on host
            const backupDir = path.dirname(backupFilePathHost);
            if (!existsSync(backupDir)) {
                mkdirSync(backupDir, { recursive: true });
                BunLogModule({
                    message: `Created backup directory: ${backupDir}`,
                    type: "info",
                    suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                    debug: CLIConfiguration.VRCA_CLI_DEBUG,
                });
            }

            // Check if the database is running using isPostgresHealthy
            const health = await isPostgresHealthy(false);
            if (!health.isHealthy) {
                throw new Error(
                    `PostgreSQL database is not available. Please start the server with 'server:run-command up -d'. Error: ${health.error?.message || "Unknown error"}`,
                );
            }

            // Execute pg_dump directly to stdout and pipe it to a file on the host
            BunLogModule({
                message: `Running pg_dump and saving directly to: ${backupFilePathHost}`,
                type: "debug",
                suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                debug: CLIConfiguration.VRCA_CLI_DEBUG,
            });

            // Use direct Bun.spawn for running docker command (not using compose to avoid stream redirection issues)
            const pgDumpProcess = Bun.spawn(
                [
                    "docker",
                    "exec",
                    containerName,
                    "pg_dump",
                    "-U",
                    dbUser,
                    "-d",
                    dbName,
                    "-F",
                    "c", // Use custom format for binary dumps
                ],
                {
                    stdout: "pipe",
                    stderr: "pipe",
                },
            );

            // Create a write stream to the backup file
            const file = Bun.file(backupFilePathHost);
            const writer = file.writer();

            // Stream the output to the file
            const reader = pgDumpProcess.stdout.getReader();
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    writer.write(value);
                }
            } finally {
                reader.releaseLock();
                await writer.end();
            }

            // Check for errors
            const stderr = await new Response(pgDumpProcess.stderr).text();
            if (stderr) {
                BunLogModule({
                    prefix: "pg_dump Error",
                    message: stderr,
                    type: "error",
                    suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                    debug: CLIConfiguration.VRCA_CLI_DEBUG,
                });
            }

            // Verify the backup file exists and has content
            if (!existsSync(backupFilePathHost)) {
                throw new Error(
                    `Backup file was not created at: ${backupFilePathHost}`,
                );
            }

            const stats = statSync(backupFilePathHost);
            if (stats.size === 0) {
                throw new Error(
                    `Backup file was created but is empty: ${backupFilePathHost}`,
                );
            }
        } catch (error) {
            BunLogModule({
                message: `Database backup failed: ${error instanceof Error ? error.message : String(error)}`,
                type: "error",
                error,
                suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                debug: CLIConfiguration.VRCA_CLI_DEBUG,
            });
            throw error;
        }
    }

    // Restore database from backup file
    export async function restoreDatabase() {
        const dbUser =
            CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_USERNAME;
        const dbName = CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_DATABASE;
        const restoreFilePathHost =
            CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_RESTORE_FILE;
        const containerName =
            ServerConfiguration.VRCA_SERVER_SERVICE_POSTGRES_CONTAINER_NAME;

        try {
            // Check if restore file exists
            if (!existsSync(restoreFilePathHost)) {
                throw new Error(
                    `Restore file not found: ${restoreFilePathHost}`,
                );
            }

            // Check if the database is running using isPostgresHealthy
            const health = await isPostgresHealthy(false);
            if (!health.isHealthy) {
                throw new Error(
                    `PostgreSQL database is not available. Please start the server with 'server:run-command up -d'. Error: ${health.error?.message || "Unknown error"}`,
                );
            }

            // Read the backup file
            const stats = statSync(restoreFilePathHost);
            BunLogModule({
                message: `Reading backup file (${(stats.size / 1024 / 1024).toFixed(2)} MB)...`,
                type: "debug",
                suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                debug: CLIConfiguration.VRCA_CLI_DEBUG,
            });

            // Create a read stream from the backup file
            const file = Bun.file(restoreFilePathHost);
            const fileArrayBuffer = await file.arrayBuffer();
            const fileBuffer = Buffer.from(fileArrayBuffer);

            // Use direct Bun.spawn for running docker command with input pipe
            BunLogModule({
                message: "Running pg_restore...",
                type: "debug",
                suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                debug: CLIConfiguration.VRCA_CLI_DEBUG,
            });

            const pgRestoreProcess = Bun.spawn(
                [
                    "docker",
                    "exec",
                    "-i", // Interactive mode to allow stdin
                    containerName,
                    "pg_restore",
                    "-U",
                    dbUser,
                    "-d",
                    dbName,
                    "-c", // Clean (drop) database objects before recreating
                    "-Fc", // Format is custom
                    "--if-exists", // Add IF EXISTS to drop commands
                    "/dev/stdin", // Read from stdin instead of a file
                ],
                {
                    stdout: "pipe",
                    stderr: "pipe",
                    stdin: fileBuffer,
                },
            );

            // Wait for the process to complete
            const stdout = await new Response(pgRestoreProcess.stdout).text();
            const stderr = await new Response(pgRestoreProcess.stderr).text();

            if (stdout) {
                BunLogModule({
                    prefix: "pg_restore Output",
                    message: stdout,
                    type: "debug",
                    suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                    debug: CLIConfiguration.VRCA_CLI_DEBUG,
                });
            }

            if (stderr) {
                // pg_restore often outputs some warnings that aren't fatal errors
                const isActualError = pgRestoreProcess.exitCode !== 0;
                BunLogModule({
                    prefix: "pg_restore Output",
                    message: stderr,
                    type: isActualError ? "error" : "warn",
                    suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                    debug: CLIConfiguration.VRCA_CLI_DEBUG,
                });

                if (isActualError) {
                    throw new Error(
                        `Database restore failed. Exit code: ${pgRestoreProcess.exitCode}. Error: ${stderr}`,
                    );
                }
            }
        } catch (error) {
            BunLogModule({
                message: `Database restore failed: ${error instanceof Error ? error.message : String(error)}`,
                type: "error",
                error,
                suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                debug: CLIConfiguration.VRCA_CLI_DEBUG,
            });
            throw error;
        }
    }
}

// If this file is run directly
if (import.meta.main) {
    const command = Bun.argv[2];
    const additionalArgs = Bun.argv.slice(3);

    if (!command) {
        BunLogModule({
            message: "No command provided",
            type: "error",
            suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
            debug: CLIConfiguration.VRCA_CLI_DEBUG,
        });
        process.exit(1);
    }

    try {
        switch (command) {
            // SERVER CONTAINER HEALTH
            case "server:postgres:health": {
                let waitInterval: number | undefined;
                let waitTimeout: number | undefined;

                // Parse named arguments
                for (let i = 0; i < additionalArgs.length; i++) {
                    if (
                        additionalArgs[i] === "--interval" &&
                        i + 1 < additionalArgs.length
                    ) {
                        waitInterval = Number.parseInt(additionalArgs[i + 1]);
                        i++; // Skip the next argument since we've already processed it
                    } else if (
                        additionalArgs[i] === "--timeout" &&
                        i + 1 < additionalArgs.length
                    ) {
                        waitTimeout = Number.parseInt(additionalArgs[i + 1]);
                        i++; // Skip the next argument since we've already processed it
                    }
                }

                const health = await Server_CLI.isPostgresHealthy(
                    waitInterval && waitTimeout
                        ? {
                              interval: waitInterval,
                              timeout: waitTimeout,
                          }
                        : true,
                );
                BunLogModule({
                    message: `PostgreSQL: ${health.isHealthy ? "healthy" : "unhealthy"}`,
                    data: health,
                    type: health.isHealthy ? "success" : "error",
                    suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                    debug: CLIConfiguration.VRCA_CLI_DEBUG,
                });
                if (!health.isHealthy) {
                    process.exit(1);
                } else {
                    process.exit(0);
                }
                break;
            }

            case "server:pgweb:health": {
                let waitInterval: number | undefined;
                let waitTimeout: number | undefined;

                // Parse named arguments
                for (let i = 0; i < additionalArgs.length; i++) {
                    if (
                        additionalArgs[i] === "--interval" &&
                        i + 1 < additionalArgs.length
                    ) {
                        waitInterval = Number.parseInt(additionalArgs[i + 1]);
                        i++; // Skip the next argument since we've already processed it
                    } else if (
                        additionalArgs[i] === "--timeout" &&
                        i + 1 < additionalArgs.length
                    ) {
                        waitTimeout = Number.parseInt(additionalArgs[i + 1]);
                        i++; // Skip the next argument since we've already processed it
                    }
                }

                const health = await Server_CLI.isPgwebHealthy(
                    waitInterval && waitTimeout
                        ? {
                              interval: waitInterval,
                              timeout: waitTimeout,
                          }
                        : undefined,
                );
                BunLogModule({
                    message: `PGWEB: ${health.isHealthy ? "healthy" : "unhealthy"}`,
                    data: health,
                    type: health.isHealthy ? "success" : "error",
                    suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                    debug: CLIConfiguration.VRCA_CLI_DEBUG,
                });
                if (!health.isHealthy) {
                    process.exit(1);
                } else {
                    process.exit(0);
                }
                break;
            }

            case "server:world-api-manager:health": {
                let waitInterval: number | undefined;
                let waitTimeout: number | undefined;

                // Parse named arguments
                for (let i = 0; i < additionalArgs.length; i++) {
                    if (
                        additionalArgs[i] === "--interval" &&
                        i + 1 < additionalArgs.length
                    ) {
                        waitInterval = Number.parseInt(additionalArgs[i + 1]);
                        i++; // Skip the next argument since we've already processed it
                    } else if (
                        additionalArgs[i] === "--timeout" &&
                        i + 1 < additionalArgs.length
                    ) {
                        waitTimeout = Number.parseInt(additionalArgs[i + 1]);
                        i++; // Skip the next argument since we've already processed it
                    }
                }

                const health = await Server_CLI.isWorldApiManagerHealthy(
                    waitInterval && waitTimeout
                        ? {
                              interval: waitInterval,
                              timeout: waitTimeout,
                          }
                        : undefined,
                );
                BunLogModule({
                    message: `World API Manager: ${health.isHealthy ? "healthy" : "unhealthy"}`,
                    data: health,
                    type: health.isHealthy ? "success" : "error",
                    suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                    debug: CLIConfiguration.VRCA_CLI_DEBUG,
                });
                if (!health.isHealthy) {
                    process.exit(1);
                } else {
                    process.exit(0);
                }
                break;
            }

            case "server:world-tick-manager:health": {
                let waitInterval: number | undefined;
                let waitTimeout: number | undefined;

                // Parse named arguments
                for (let i = 0; i < additionalArgs.length; i++) {
                    if (
                        additionalArgs[i] === "--interval" &&
                        i + 1 < additionalArgs.length
                    ) {
                        waitInterval = Number.parseInt(additionalArgs[i + 1]);
                        i++; // Skip the next argument since we've already processed it
                    } else if (
                        additionalArgs[i] === "--timeout" &&
                        i + 1 < additionalArgs.length
                    ) {
                        waitTimeout = Number.parseInt(additionalArgs[i + 1]);
                        i++; // Skip the next argument since we've already processed it
                    }
                }

                const health = await Server_CLI.isWorldTickManagerHealthy(
                    waitInterval && waitTimeout
                        ? {
                              interval: waitInterval,
                              timeout: waitTimeout,
                          }
                        : undefined,
                );
                BunLogModule({
                    message: `World Tick Manager: ${health.isHealthy ? "healthy" : "unhealthy"}`,
                    data: health,
                    type: health.isHealthy ? "success" : "error",
                    suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                    debug: CLIConfiguration.VRCA_CLI_DEBUG,
                });
                if (!health.isHealthy) {
                    process.exit(1);
                } else {
                    process.exit(0);
                }
                break;
            }

            // SERVER POSTGRES DATABASE COMMANDS
            case "server:postgres:migrate": {
                BunLogModule({
                    message: "Running database migrations...",
                    type: "info",
                    suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                    debug: CLIConfiguration.VRCA_CLI_DEBUG,
                });
                await Server_CLI.migrate();
                BunLogModule({
                    message: "Migrations ran successfully",
                    type: "success",
                    suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                    debug: CLIConfiguration.VRCA_CLI_DEBUG,
                });
                break;
            }

            case "server:postgres:wipe": {
                BunLogModule({
                    message: "Wiping database...",
                    type: "info",
                    suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                    debug: CLIConfiguration.VRCA_CLI_DEBUG,
                });
                await Server_CLI.wipeDatabase();
                BunLogModule({
                    message: "Database wiped",
                    type: "success",
                    suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                    debug: CLIConfiguration.VRCA_CLI_DEBUG,
                });
                break;
            }

            case "server:postgres:connection-string": {
                const connectionString =
                    await Server_CLI.generateDbConnectionString();
                BunLogModule({
                    message: `Database connection string:\n[ ${connectionString} ]`,
                    type: "info",
                    suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                    debug: CLIConfiguration.VRCA_CLI_DEBUG,
                });
                break;
            }

            case "server:postgres:system-token": {
                let printOnlyToken = false;

                if (additionalArgs.length > 0) {
                    printOnlyToken = Boolean(additionalArgs[0]);
                }

                if (!printOnlyToken) {
                    BunLogModule({
                        message: "Generating system token...",
                        type: "info",
                        suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                        debug: CLIConfiguration.VRCA_CLI_DEBUG,
                    });
                }

                const { token, sessionId, agentId } =
                    await Server_CLI.generateDbSystemToken();
                if (printOnlyToken) {
                    console.log(token);
                } else {
                    BunLogModule({
                        message: `System agent token: ${token}`,
                        data: { sessionId, agentId },
                        type: "success",
                        suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                        debug: CLIConfiguration.VRCA_CLI_DEBUG,
                    });
                }
                break;
            }

            case "server:postgres:system-token:invalidate-all": {
                BunLogModule({
                    message: "Invalidating all system tokens...",
                    type: "info",
                    suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                    debug: CLIConfiguration.VRCA_CLI_DEBUG,
                });
                const invalidatedCount =
                    await Server_CLI.invalidateDbSystemTokens();
                BunLogModule({
                    message: `Invalidated ${invalidatedCount} system tokens`,
                    type: "success",
                    suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                    debug: CLIConfiguration.VRCA_CLI_DEBUG,
                });
                break;
            }

            case "server:postgres:seed:sql": {
                BunLogModule({
                    message: "Running database SQL seeds...",
                    type: "info",
                    suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                    debug: CLIConfiguration.VRCA_CLI_DEBUG,
                });
                await Server_CLI.seedSql();
                BunLogModule({
                    message: "SQL seeds applied.",
                    type: "success",
                    suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                    debug: CLIConfiguration.VRCA_CLI_DEBUG,
                });
                break;
            }

            case "server:postgres:seed:assets": {
                BunLogModule({
                    message: "Running database asset seeds...",
                    type: "info",
                    suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                    debug: CLIConfiguration.VRCA_CLI_DEBUG,
                });
                await Server_CLI.seedAssets({
                    options: {
                        parallelProcessing:
                            additionalArgs.length > 0
                                ? Boolean(additionalArgs[0])
                                : true,
                        batchSize:
                            additionalArgs.length > 1
                                ? Number.parseInt(additionalArgs[1])
                                : 10,
                    },
                });
                BunLogModule({
                    message: "Asset seeds applied.",
                    type: "success",
                    suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                    debug: CLIConfiguration.VRCA_CLI_DEBUG,
                });
                break;
            }

            case "server:postgres:backup": {
                BunLogModule({
                    message: `Backing up database to [${CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_BACKUP_FILE}]...`,
                    type: "info",
                    suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                    debug: CLIConfiguration.VRCA_CLI_DEBUG,
                });
                await Server_CLI.backupDatabase();
                BunLogModule({
                    message: "Database backed up.",
                    type: "success",
                    suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                    debug: CLIConfiguration.VRCA_CLI_DEBUG,
                });
                break;
            }

            case "server:postgres:restore": {
                BunLogModule({
                    message: `Restoring database from [${CLIConfiguration.VRCA_CLI_SERVICE_POSTGRES_RESTORE_FILE}]...`,
                    type: "info",
                    suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                    debug: CLIConfiguration.VRCA_CLI_DEBUG,
                });
                await Server_CLI.restoreDatabase();
                BunLogModule({
                    message: "Database restored.",
                    type: "success",
                    suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                    debug: CLIConfiguration.VRCA_CLI_DEBUG,
                });
                break;
            }

            // SERVER PGWEB COMMANDS
            case "server:pgweb:access-command": {
                const pgwebAccessURL =
                    await Server_CLI.generatePgwebAccessURL();
                BunLogModule({
                    message: `Access PGWEB at:\n[ ${pgwebAccessURL} ]`,
                    data: { pgwebAccessURL },
                    type: "success",
                    suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                    debug: CLIConfiguration.VRCA_CLI_DEBUG,
                });
                break;
            }

            // Generic docker command support
            case "server:run-command":
                await Server_CLI.runServerDockerCommand({
                    args: additionalArgs,
                });
                break;

            // HOT SYNC MODULE

            case "dev:hot-sync:assets": {
                // await AssetHotSync.hotSyncAssets({
                //     pollIntervalMs: 5000,
                //     debug: CLIConfiguration.VRCA_CLI_DEBUG,
                //     compileForce: true,
                // });
                break;
            }

            default:
                BunLogModule({
                    message: `Unknown command: ${command}`,
                    type: "error",
                    suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
                    debug: CLIConfiguration.VRCA_CLI_DEBUG,
                });
                process.exit(1);
        }

        process.exit(0);
    } catch (error) {
        BunLogModule({
            message: `Error: ${error}`,
            type: "error",
            suppress: CLIConfiguration.VRCA_CLI_SUPPRESS,
            debug: CLIConfiguration.VRCA_CLI_DEBUG,
        });
        process.exit(1);
    }
}
