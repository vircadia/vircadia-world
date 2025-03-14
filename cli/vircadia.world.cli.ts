import { VircadiaConfig } from "../sdk/vircadia-world-sdk-ts/config/vircadia.config.ts";
import { log } from "../sdk/vircadia-world-sdk-ts/module/general/log.ts";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { sign } from "jsonwebtoken";
import { PostgresClient } from "../sdk/vircadia-world-sdk-ts/module/server/postgres.server.client.ts";
import {
    Client,
    Service,
} from "../sdk/vircadia-world-sdk-ts/schema/schema.general.ts";
import { createHash } from "node:crypto";

// TODO: Optimize the commands, get up and down rebuilds including init to work well.

export namespace Client_CLI {
    const CLIENT_DOCKER_COMPOSE_FILE = path.join(
        dirname(fileURLToPath(import.meta.url)),
        "../client/client.docker.compose.yml",
    );

    export async function runClientDockerCommand(data: {
        args: string[];
    }) {
        const processEnv = {
            ...process.env,
            PATH: process.env.PATH,

            VRCA_CLIENT_CONTAINER_NAME:
                VircadiaConfig.CLIENT.VRCA_CLIENT_CONTAINER_NAME,
            VRCA_CLIENT_WEB_BABYLON_JS_DEBUG:
                VircadiaConfig.CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG.toString(),
            VRCA_CLIENT_WEB_BABYLON_JS_SUPPRESS:
                VircadiaConfig.CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_SUPPRESS.toString(),

            VRCA_CLIENT_WEB_BABYLON_JS_PRODUCTION_HOST_CONTAINER_EXTERNAL:
                VircadiaConfig.CLIENT
                    .VRCA_CLIENT_WEB_BABYLON_JS_PRODUCTION_HOST_CONTAINER_EXTERNAL,
            VRCA_CLIENT_WEB_BABYLON_JS_PRODUCTION_PORT_CONTAINER_EXTERNAL:
                VircadiaConfig.CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_PRODUCTION_PORT_CONTAINER_EXTERNAL.toString(),
            VRCA_CLIENT_WEB_BABYLON_JS_PRODUCTION_PORT_CONTAINER_INTERNAL:
                VircadiaConfig.CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_PRODUCTION_PORT_CONTAINER_INTERNAL.toString(),

            VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN:
                VircadiaConfig.CLIENT
                    .VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN,

            VRCA_CLIENT_WEB_BABYLON_JS_META_TITLE_BASE:
                VircadiaConfig.CLIENT
                    .VRCA_CLIENT_WEB_BABYLON_JS_META_TITLE_BASE,
            VRCA_CLIENT_WEB_BABYLON_JS_META_DESCRIPTION:
                VircadiaConfig.CLIENT
                    .VRCA_CLIENT_WEB_BABYLON_JS_META_DESCRIPTION,
            VRCA_CLIENT_WEB_BABYLON_JS_META_OG_IMAGE:
                VircadiaConfig.CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_META_OG_IMAGE,
            VRCA_CLIENT_WEB_BABYLON_JS_META_OG_TYPE:
                VircadiaConfig.CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_META_OG_TYPE,
            VRCA_CLIENT_WEB_BABYLON_JS_META_FAVICON:
                VircadiaConfig.CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_META_FAVICON,

            VRCA_CLIENT_WEB_BABYLON_JS_APP_URL:
                VircadiaConfig.CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_APP_URL,

            VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_SERVER_URI:
                VircadiaConfig.CLIENT
                    .VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_SERVER_URI,
            VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_SERVER_URI_USING_SSL:
                VircadiaConfig.CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_SERVER_URI_USING_SSL.toString(),
        };

        let dockerArgs = [
            "docker",
            "compose",
            "-f",
            CLIENT_DOCKER_COMPOSE_FILE,
        ];

        dockerArgs = [...dockerArgs, ...data.args];

        log({
            prefix: "Docker Command",
            message: dockerArgs.join(" "),
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
                prefix: "Docker Command Output",
                message: stdout,
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
                (spawnedProcess.exitCode !== 0 &&
                    spawnedProcess.exitCode !== null);

            log({
                prefix: "Docker Command Output",
                message: stderr,
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
                `CLIENT Docker command failed with exit code ${exitCode}.\nStdout: ${stdout}\nStderr: ${stderr}`,
            );
        }
    }

    // Client health check function
    export async function isWebBabylonJsHealthy(
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

        const checkWebBabylonJs = async (): Promise<{
            isHealthy: boolean;
            error?: Error;
        }> => {
            try {
                const response = await fetch(
                    `http://${VircadiaConfig.CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_PRODUCTION_HOST_CONTAINER_EXTERNAL}:${VircadiaConfig.CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_PRODUCTION_PORT_CONTAINER_EXTERNAL}`,
                );
                const isHealthy = response.ok;
                return {
                    isHealthy,
                    error: isHealthy
                        ? undefined
                        : new Error("Service not responding"),
                };
            } catch (error) {
                return {
                    isHealthy: false,
                    error:
                        error instanceof Error
                            ? error
                            : new Error(String(error)),
                };
            }
        };

        // If waiting is not enabled, just check once
        if (!waitConfig) {
            return await checkWebBabylonJs();
        }

        // With waiting enabled, retry until timeout
        const startTime = Date.now();
        let lastError: Error | undefined;

        while (Date.now() - startTime < waitConfig.timeout) {
            const result = await checkWebBabylonJs();
            if (result.isHealthy) {
                return result;
            }
            lastError = result.error;
            await Bun.sleep(waitConfig.interval);
        }

        return { isHealthy: false, error: lastError };
    }
}

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
                VircadiaConfig.SERVER.VRCA_SERVER_CONTAINER_NAME,
            VRCA_SERVER_DEBUG:
                VircadiaConfig.SERVER.VRCA_SERVER_DEBUG.toString(),
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
        let dockerArgs = [
            "docker",
            "compose",
            "-f",
            SERVER_DOCKER_COMPOSE_FILE,
        ];

        dockerArgs = [...dockerArgs, ...data.args];

        log({
            prefix: "Docker Command",
            message: dockerArgs.join(" "),
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
                prefix: "Docker Command Output",
                message: stdout,
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
                (spawnedProcess.exitCode !== 0 &&
                    spawnedProcess.exitCode !== null);

            log({
                prefix: "Docker Command Output",
                message: stderr,
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
                const db = PostgresClient.getInstance({
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                });

                const sql = await db.getSuperClient({
                    postgres: {
                        host: VircadiaConfig.CLI.VRCA_CLI_SERVICE_POSTGRES_HOST,
                        port: VircadiaConfig.CLI.VRCA_CLI_SERVICE_POSTGRES_PORT,
                        database:
                            VircadiaConfig.CLI
                                .VRCA_CLI_SERVICE_POSTGRES_DATABASE,
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

    export async function isApiHealthy(
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

        // If waiting is not enabled, just check once
        if (!waitConfig) {
            return await checkApi();
        }

        // With waiting enabled, retry until timeout
        const startTime = Date.now();
        let lastError: Error | undefined;

        while (Date.now() - startTime < waitConfig.timeout) {
            const result = await checkApi();
            if (result.isHealthy) {
                return result;
            }
            lastError = result.error;
            await Bun.sleep(waitConfig.interval);
        }

        return { isHealthy: false, error: lastError };
    }

    export async function isTickHealthy(
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

        // If waiting is not enabled, just check once
        if (!waitConfig) {
            return await checkTick();
        }

        // With waiting enabled, retry until timeout
        const startTime = Date.now();
        let lastError: Error | undefined;

        while (Date.now() - startTime < waitConfig.timeout) {
            const result = await checkTick();
            if (result.isHealthy) {
                return result;
            }
            lastError = result.error;
            await Bun.sleep(waitConfig.interval);
        }

        return { isHealthy: false, error: lastError };
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

        try {
            // Get list of migration files
            const resets = await readdir(
                VircadiaConfig.CLI.VRCA_CLI_SERVICE_POSTGRES_RESET_DIR,
            );
            const resetSqlFiles = resets
                .filter((f) => f.endsWith(".sql"))
                .sort();

            // Run pending migrations
            for (const file of resetSqlFiles) {
                try {
                    const filePath = path.join(
                        VircadiaConfig.CLI.VRCA_CLI_SERVICE_POSTGRES_RESET_DIR,
                        file,
                    );
                    const sqlContent = await readFile(filePath, "utf-8");

                    await sql.begin(async (sql) => {
                        // Set isolation level to SERIALIZABLE for the reset
                        await sql.unsafe(
                            "SET TRANSACTION ISOLATION LEVEL SERIALIZABLE",
                        );
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
        } catch (error) {
            log({
                message: `Database reset failed: ${error}`,
                type: "error",
                suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
            });
            throw error;
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
                        VircadiaConfig.CLI
                            .VRCA_CLI_SERVICE_POSTGRES_MIGRATION_DIR,
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
            const contentHash = createHash("md5")
                .update(sqlContent)
                .digest("hex");

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
}

// If this file is run directly
if (import.meta.main) {
    const command = Bun.argv[2];
    const additionalArgs = Bun.argv.slice(3);

    if (!command) {
        log({
            message: "No command provided",
            type: "error",
            suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
            debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
        });
        process.exit(1);
    }

    try {
        switch (command) {
            // SERVER CONTAINER HEALTH
            case "server:container:postgres:health": {
                let waitInterval: number | undefined;
                let waitTimeout: number | undefined;

                if (additionalArgs.length > 0) {
                    waitInterval = Number.parseInt(additionalArgs[0]);
                    waitTimeout = Number.parseInt(additionalArgs[1]);
                }

                const health = await Server_CLI.isPostgresHealthy(
                    waitInterval && waitTimeout
                        ? {
                              interval: waitInterval,
                              timeout: waitTimeout,
                          }
                        : true,
                );
                log({
                    message: `PostgreSQL: ${health.isHealthy ? "healthy" : "unhealthy"}`,
                    data: health,
                    type: health.isHealthy ? "success" : "error",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                if (!health.isHealthy) {
                    process.exit(1);
                } else {
                    process.exit(0);
                }
                break;
            }

            case "server:container:pgweb:health": {
                let waitInterval: number | undefined;
                let waitTimeout: number | undefined;

                if (additionalArgs.length > 0) {
                    waitInterval = Number.parseInt(additionalArgs[0]);
                    waitTimeout = Number.parseInt(additionalArgs[1]);
                }
                const health = await Server_CLI.isPgwebHealthy(
                    waitInterval && waitTimeout
                        ? {
                              interval: waitInterval,
                              timeout: waitTimeout,
                          }
                        : undefined,
                );
                log({
                    message: `PGWEB: ${health.isHealthy ? "healthy" : "unhealthy"}`,
                    data: health,
                    type: health.isHealthy ? "success" : "error",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                if (!health.isHealthy) {
                    process.exit(1);
                } else {
                    process.exit(0);
                }
                break;
            }

            case "server:container:api:health": {
                let waitInterval: number | undefined;
                let waitTimeout: number | undefined;

                if (additionalArgs.length > 0) {
                    waitInterval = Number.parseInt(additionalArgs[0]);
                    waitTimeout = Number.parseInt(additionalArgs[1]);
                }

                const health = await Server_CLI.isApiHealthy(
                    waitInterval && waitTimeout
                        ? {
                              interval: waitInterval,
                              timeout: waitTimeout,
                          }
                        : undefined,
                );
                log({
                    message: `API: ${health.isHealthy ? "healthy" : "unhealthy"}`,
                    data: health,
                    type: health.isHealthy ? "success" : "error",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                if (!health.isHealthy) {
                    process.exit(1);
                } else {
                    process.exit(0);
                }
                break;
            }

            case "server:container:tick:health": {
                let waitInterval: number | undefined;
                let waitTimeout: number | undefined;

                if (additionalArgs.length > 0) {
                    waitInterval = Number.parseInt(additionalArgs[0]);
                    waitTimeout = Number.parseInt(additionalArgs[1]);
                }

                const health = await Server_CLI.isTickHealthy(
                    waitInterval && waitTimeout
                        ? {
                              interval: waitInterval,
                              timeout: waitTimeout,
                          }
                        : undefined,
                );
                log({
                    message: `Tick: ${health.isHealthy ? "healthy" : "unhealthy"}`,
                    data: health,
                    type: health.isHealthy ? "success" : "error",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                if (!health.isHealthy) {
                    process.exit(1);
                } else {
                    process.exit(0);
                }
                break;
            }

            // SERVER POSTGRES DATABASE COMMANDS
            case "server:container:postgres:migrate": {
                log({
                    message: "Running database migrations...",
                    type: "info",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                await Server_CLI.migrate();
                log({
                    message: "Migrations ran successfully",
                    type: "success",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                break;
            }

            case "server:container:postgres:wipe": {
                log({
                    message: "Wiping database...",
                    type: "info",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                await Server_CLI.wipeDatabase();
                log({
                    message: "Database wiped",
                    type: "success",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                break;
            }

            case "server:container:postgres:connection-string": {
                const connectionString =
                    await Server_CLI.generateDbConnectionString();
                log({
                    message: `Database connection string:\n[ ${connectionString} ]`,
                    type: "info",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                break;
            }

            case "server:container:postgres:system-token": {
                log({
                    message: "Generating system token...",
                    type: "info",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                const { token, sessionId, agentId } =
                    await Server_CLI.generateDbSystemToken();
                log({
                    message: `System agent token: ${token}`,
                    data: { sessionId, agentId },
                    type: "success",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                break;
            }

            case "server:container:postgres:system-token:invalidate-all": {
                log({
                    message: "Invalidating all system tokens...",
                    type: "info",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                const invalidatedCount =
                    await Server_CLI.invalidateDbSystemTokens();
                log({
                    message: `Invalidated ${invalidatedCount} system tokens`,
                    type: "success",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                break;
            }

            case "server:container:postgres:seed": {
                log({
                    message: "Running database seeds...",
                    type: "info",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                await Server_CLI.seed({ seedPath: additionalArgs[0] });
                log({
                    message: `${VircadiaConfig.SERVER.VRCA_SERVER_CONTAINER_NAME} container seeds applied.`,
                    type: "success",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                break;
            }

            // SERVER PGWEB COMMANDS
            case "server:container:pgweb:access-command": {
                const pgwebAccessURL =
                    await Server_CLI.generatePgwebAccessURL();
                log({
                    message: `Access PGWEB at:\n[ ${pgwebAccessURL} ]`,
                    data: { pgwebAccessURL },
                    type: "success",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                break;
            }

            // CLIENT CONTAINER HEALTH
            case "client:container:web-babylon-js:health": {
                let waitInterval: number | undefined;
                let waitTimeout: number | undefined;

                if (additionalArgs.length > 0) {
                    waitInterval = Number.parseInt(additionalArgs[0]);
                    waitTimeout = Number.parseInt(additionalArgs[1]);
                }

                const health = await Client_CLI.isWebBabylonJsHealthy(
                    waitInterval && waitTimeout
                        ? {
                              interval: waitInterval,
                              timeout: waitTimeout,
                          }
                        : undefined,
                );
                log({
                    message: `Web Babylon JS: ${health.isHealthy ? "healthy" : "unhealthy"}`,
                    data: health,
                    type: health.isHealthy ? "success" : "error",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                if (!health.isHealthy) {
                    process.exit(1);
                } else {
                    process.exit(0);
                }
                break;
            }

            // New generic docker command support
            case "server:container:run-command":
                await Server_CLI.runServerDockerCommand({
                    args: additionalArgs,
                });
                break;

            case "client:container:run-command":
                await Client_CLI.runClientDockerCommand({
                    args: additionalArgs,
                });
                break;

            default:
                log({
                    message: `Unknown command: ${command}`,
                    type: "error",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                process.exit(1);
        }

        process.exit(0);
    } catch (error) {
        log({
            message: `Error: ${error}`,
            type: "error",
            suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
            debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
        });
        process.exit(1);
    }
}
