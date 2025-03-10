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

namespace Client_CLI {
    const CLIENT_DOCKER_COMPOSE_FILE = path.join(
        dirname(fileURLToPath(import.meta.url)),
        "../client/client.docker.compose.yml",
    );

    async function runClientDockerCommand(data: {
        client?: Client.E_Client;
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

            VRCA_CLIENT_WEB_BABYLON_JS_HOST_CONTAINER_EXTERNAL:
                VircadiaConfig.CLIENT
                    .VRCA_CLIENT_WEB_BABYLON_JS_HOST_CONTAINER_EXTERNAL,
            VRCA_CLIENT_WEB_BABYLON_JS_PORT_CONTAINER_EXTERNAL:
                VircadiaConfig.CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_PORT_CONTAINER_EXTERNAL.toString(),
            VRCA_CLIENT_WEB_BABYLON_JS_PORT_CONTAINER_INTERNAL:
                VircadiaConfig.CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_PORT_CONTAINER_INTERNAL.toString(),

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

        if (data.client) {
            dockerArgs = [
                ...dockerArgs,
                ...data.args,
                data.client.toLowerCase(),
            ];
        } else {
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
                (spawnedProcess.exitCode !== 0 &&
                    spawnedProcess.exitCode !== null);

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
                `CLIENT Docker command failed with exit code ${exitCode}.\nStdout: ${stdout}\nStderr: ${stderr}`,
            );
        }
    }

    // Client functions similar to Server_CLI
    export async function up(data: {
        client?: Client.E_Client;
    }): Promise<void> {
        await runClientDockerCommand({
            client: data.client,
            args: ["up", "-d"],
        });
    }

    export async function upAndRebuild(data: {
        client?: Client.E_Client;
    }): Promise<void> {
        await runClientDockerCommand({
            client: data.client,
            args: ["up", "-d", "--build"],
        });
    }

    export async function down(data: {
        client?: Client.E_Client;
    }): Promise<void> {
        await runClientDockerCommand({
            client: data.client,
            args: ["down"],
        });
    }

    export async function downAndDestroy(data: {
        client?: Client.E_Client;
    }): Promise<void> {
        await runClientDockerCommand({
            client: data.client,
            args: ["down", "-v"],
        });
    }

    // Add a function to run operations on all clients
    export async function runForAllClients(
        operation: (client: Client.E_Client) => Promise<void>,
    ) {
        for (const clientKey of Object.keys(Client.E_Client) as Array<
            keyof typeof Client.E_Client
        >) {
            const client = Client.E_Client[clientKey];
            await operation(client);
        }
    }

    // Client health check function
    export async function isHealthy(): Promise<{
        isHealthy: boolean;
        clients: {
            web_babylon_js: {
                isHealthy: boolean;
                error?: Error;
            };
        };
    }> {
        const checkWebBabylonJs = async (): Promise<{
            isHealthy: boolean;
            error?: Error;
        }> => {
            try {
                // Implement client health check logic
                // For example, check if the service is responding
                const response = await fetch(
                    `http://${VircadiaConfig.CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_HOST_CONTAINER_EXTERNAL}:${VircadiaConfig.CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_PORT_CONTAINER_EXTERNAL}`,
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

        const [webBabylonJs] = await Promise.all([checkWebBabylonJs()]);

        return {
            isHealthy: webBabylonJs.isHealthy,
            clients: {
                web_babylon_js: webBabylonJs,
            },
        };
    }
}

namespace Server_CLI {
    const SERVER_DOCKER_COMPOSE_FILE = path.join(
        dirname(fileURLToPath(import.meta.url)),
        "../server/service/server.docker.compose.yml",
    );

    async function runServerDockerCommand(data: {
        service?: Service.E_Service;
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

        // Add service name if specified
        if (data.service) {
            // For commands with a specific service
            dockerArgs = [
                ...dockerArgs,
                ...data.args,
                data.service.toLowerCase(),
            ];
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
                (spawnedProcess.exitCode !== 0 &&
                    spawnedProcess.exitCode !== null);

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
                `SERVER Docker command failed with exit code ${exitCode}.\nStdout: ${stdout}\nStderr: ${stderr}`,
            );
        }
    }

    // Update up function
    export async function up(data: {
        service?: Service.E_Service;
    }): Promise<void> {
        await runServerDockerCommand({
            service: data.service,
            args: ["up", "-d"],
        });
    }

    export async function upAndRebuild(data: {
        service?: Service.E_Service;
    }): Promise<void> {
        await runServerDockerCommand({
            service: data.service,
            args: ["up", "--build", "-d"],
        });
    }

    export async function down(data: {
        service?: Service.E_Service;
    }): Promise<void> {
        await runServerDockerCommand({
            args: ["down"],
            service: data.service,
        });
    }

    export async function downAndDestroy(data: {
        service?: Service.E_Service;
    }): Promise<void> {
        await runServerDockerCommand({
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
}

function printValidCommands() {
    log({
        message: `Valid commands: 

        // Server Container commands - All services
        server-container-init
        server-container-up-all
        server-container-down-all
        server-container-rebuild-all
        server-container-restart-all
        server-container-health

        // Server Container commands - Individual services
        ${Object.keys(Service.E_Service)
            .map((k) => {
                const service = k.toLowerCase().replace(/_/g, "-");
                return `server-container-up-${service}\n        server-container-down-${service}\n        server-container-rebuild-${service}\n        server-container-restart-${service}\n        server-container-wipe-${service}`;
            })
            .join("\n        ")}

        // Client Container commands - All clients
        client-container-init
        client-container-up-all
        client-container-down-all
        client-container-rebuild-all
        client-container-restart-all
        client-container-health

        // Client Container commands - Individual clients
        ${Object.keys(Client.E_Client)
            .map((k) => {
                const client = k.toLowerCase().replace(/_/g, "-");
                return `client-container-up-${client}\n        client-container-down-${client}\n        client-container-rebuild-${client}\n        client-container-restart-${client}`;
            })
            .join("\n        ")}

        // Database commands
        database-reset
        database-wipe
        database-migrate
        database-seed [seedPath]
        database-connection-string
        database-system-token
        database-system-token-invalidate-all

        // PGWEB commands
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
            // SERVER CONTAINER COMMANDS - ALL SERVICES
            case "server-container-up-all":
                log({
                    message: "Starting all server services...",
                    type: "info",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                await Server_CLI.runForAllServices(async (svc) => {
                    log({
                        message: `Starting ${svc.toLowerCase()} service...`,
                        type: "info",
                        suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                        debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                    });
                    await Server_CLI.up({ service: svc });
                });
                break;

            case "server-container-down-all":
                log({
                    message: "Stopping all server services...",
                    type: "info",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                await Server_CLI.runForAllServices(async (svc) => {
                    log({
                        message: `Stopping ${svc.toLowerCase()} service...`,
                        type: "info",
                        suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                        debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                    });
                    await Server_CLI.down({ service: svc });
                });
                break;

            case "server-container-init":
            case "server-container-rebuild-all": {
                // First rebuild postgres only
                log({
                    message: "Rebuilding postgres service first...",
                    type: "info",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                await Server_CLI.downAndDestroy({
                    service: Service.E_Service.POSTGRES,
                });
                await Server_CLI.upAndRebuild({
                    service: Service.E_Service.POSTGRES,
                });

                // Wait for postgres to be healthy
                let pgHealthy = false;
                for (let i = 0; i < 10; i++) {
                    log({
                        message: "Waiting for postgres to be healthy...",
                        type: "info",
                    });
                    await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait 5 seconds
                    const health = await Server_CLI.isHealthy();
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
                const migrationsRan = await Server_CLI.migrate();
                log({ message: "Running database seeds...", type: "info" });
                await Server_CLI.seed({});

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
                    await Server_CLI.down({ service: svc });
                    await Server_CLI.upAndRebuild({ service: svc });
                }

                // Verify all services are healthy
                const finalHealth = await Server_CLI.isHealthy();
                if (!finalHealth.isHealthy) {
                    log({
                        message: "Failed to start some services after rebuild",
                        type: "error",
                        error: finalHealth.services,
                    });
                } else {
                    log({
                        message: "All server services rebuilt successfully",
                        type: "success",
                    });
                }
                break;
            }

            case "server-container-restart-all":
                log({
                    message: "Restarting all server services...",
                    type: "info",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                await Server_CLI.runForAllServices(async (svc) => {
                    log({
                        message: `Restarting ${svc.toLowerCase()} service...`,
                        type: "info",
                        suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                        debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                    });
                    await Server_CLI.down({ service: svc });
                    await Server_CLI.up({ service: svc });
                });

                log({
                    message: "All server services restarted",
                    type: "success",
                });
                break;

            // SERVER CONTAINER COMMANDS - POSTGRES
            case "server-container-up-postgres":
                log({
                    message: "Starting postgres service...",
                    type: "info",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                await Server_CLI.up({
                    service: Service.E_Service.POSTGRES,
                });
                break;

            case "server-container-down-postgres":
                log({
                    message: "Stopping postgres service...",
                    type: "info",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                await Server_CLI.down({ service: Service.E_Service.POSTGRES });
                break;

            case "server-container-rebuild-postgres": {
                log({
                    message: "Rebuilding postgres service...",
                    type: "info",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                await Server_CLI.down({
                    service: Service.E_Service.POSTGRES,
                });
                await Server_CLI.upAndRebuild({
                    service: Service.E_Service.POSTGRES,
                });

                // Run migrations and seed data after postgres rebuild
                const health = await Server_CLI.isHealthy();
                if (health.services.postgres.isHealthy) {
                    const migrationsRan = await Server_CLI.migrate();
                    if (migrationsRan) {
                        log({
                            message: "Migrations ran successfully",
                            type: "success",
                            suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                            debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                        });
                        await Server_CLI.seed({});
                        log({
                            message: `${VircadiaConfig.SERVER.VRCA_SERVER_CONTAINER_NAME} container seeds applied.`,
                            type: "debug",
                            suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                            debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
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

            case "server-container-restart-postgres":
                log({
                    message: "Restarting postgres service...",
                    type: "info",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                await Server_CLI.down({ service: Service.E_Service.POSTGRES });
                await Server_CLI.up({ service: Service.E_Service.POSTGRES });
                log({
                    message: "Postgres service restarted",
                    type: "success",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                break;

            // SERVER CONTAINER HEALTH
            case "server-container-health": {
                const health = await Server_CLI.isHealthy();
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
                    message: `API: ${health.services.api.isHealthy ? "healthy" : "unhealthy"}`,
                    data: health.services.api,
                    type: health.services.api.isHealthy ? "success" : "error",
                });
                log({
                    message: `Tick: ${health.services.tick.isHealthy ? "healthy" : "unhealthy"}`,
                    data: health.services.tick,
                    type: health.services.tick.isHealthy ? "success" : "error",
                });
                break;
            }

            // CLIENT CONTAINER COMMANDS - ALL CLIENTS
            case "client-container-init":
            case "client-container-up-all":
                log({
                    message: "Starting all client services...",
                    type: "info",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                await Client_CLI.runForAllClients(async (client) => {
                    log({
                        message: `Starting ${client.toLowerCase()} client...`,
                        type: "info",
                        suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                        debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                    });
                    await Client_CLI.up({ client });
                });
                break;

            case "client-container-down-all":
                log({
                    message: "Stopping all client services...",
                    type: "info",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                await Client_CLI.runForAllClients(async (client) => {
                    log({
                        message: `Stopping ${client.toLowerCase()} client...`,
                        type: "info",
                        suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                        debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                    });
                    await Client_CLI.down({ client });
                });
                break;

            case "client-container-rebuild-all":
                log({
                    message: "Rebuilding all client services...",
                    type: "info",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                await Client_CLI.runForAllClients(async (client) => {
                    log({
                        message: `Rebuilding ${client.toLowerCase()} client...`,
                        type: "info",
                        suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                        debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                    });
                    await Client_CLI.downAndDestroy({ client });
                    await Client_CLI.upAndRebuild({ client });
                });
                log({
                    message: "All client services rebuilt successfully",
                    type: "success",
                });
                break;

            case "client-container-restart-all":
                log({
                    message: "Restarting all client services...",
                    type: "info",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                await Client_CLI.runForAllClients(async (client) => {
                    log({
                        message: `Restarting ${client.toLowerCase()} client...`,
                        type: "info",
                        suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                        debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                    });
                    await Client_CLI.down({ client });
                    await Client_CLI.up({ client });
                });
                log({
                    message: "All client services restarted",
                    type: "success",
                });
                break;

            // CLIENT CONTAINER COMMANDS - INDIVIDUAL CLIENTS
            case "client-container-up-web-babylon-js":
                log({
                    message: "Starting web_babylon_js client...",
                    type: "info",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                await Client_CLI.up({ client: Client.E_Client.WEB_BABYLON_JS });
                break;

            case "client-container-down-web-babylon-js":
                log({
                    message: "Stopping web_babylon_js client...",
                    type: "info",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                await Client_CLI.down({
                    client: Client.E_Client.WEB_BABYLON_JS,
                });
                break;

            case "client-container-rebuild-web-babylon-js":
                log({
                    message: "Rebuilding web_babylon_js client...",
                    type: "info",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                await Client_CLI.downAndDestroy({
                    client: Client.E_Client.WEB_BABYLON_JS,
                });
                await Client_CLI.upAndRebuild({
                    client: Client.E_Client.WEB_BABYLON_JS,
                });
                log({
                    message: "Web Babylon JS client rebuilt successfully",
                    type: "success",
                });
                break;

            case "client-container-restart-web-babylon-js":
                log({
                    message: "Restarting web_babylon_js client...",
                    type: "info",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                await Client_CLI.down({
                    client: Client.E_Client.WEB_BABYLON_JS,
                });
                await Client_CLI.up({ client: Client.E_Client.WEB_BABYLON_JS });
                log({
                    message: "Web Babylon JS client restarted",
                    type: "success",
                });
                break;

            // CLIENT CONTAINER HEALTH
            case "client-container-health": {
                const health = await Client_CLI.isHealthy();
                log({
                    message: `Web Babylon JS: ${health.clients.web_babylon_js.isHealthy ? "healthy" : "unhealthy"}`,
                    data: health.clients.web_babylon_js,
                    type: health.clients.web_babylon_js.isHealthy
                        ? "success"
                        : "error",
                });
                break;
            }

            // DATABASE COMMANDS
            case "database-migrate": {
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
                });
                break;
            }

            case "database-wipe": {
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
                });
                break;
            }

            case "database-reset": {
                log({
                    message: "Resetting database...",
                    type: "info",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                await Server_CLI.wipeDatabase();
                await Server_CLI.migrate();
                await Server_CLI.seed({});
                log({
                    message: "Database reset",
                    type: "success",
                });
                break;
            }

            case "database-connection-string": {
                const connectionString =
                    await Server_CLI.generateDbConnectionString();
                log({
                    message: `Database connection string: ${connectionString}`,
                    type: "info",
                });
                break;
            }

            case "database-system-token": {
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
                    type: "info",
                });
                break;
            }

            case "database-system-token-invalidate-all": {
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
                });
                break;
            }

            case "database-seed": {
                log({
                    message: "Running database seeds...",
                    type: "info",
                    suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                });
                await Server_CLI.seed({ seedPath: additionalArgs[0] });
                log({
                    message: `${VircadiaConfig.SERVER.VRCA_SERVER_CONTAINER_NAME} container seeds applied.`,
                    type: "debug",
                });
                break;
            }

            // PGWEB COMMANDS
            case "pgweb-access-command": {
                const pgwebAccessURL =
                    await Server_CLI.generatePgwebAccessURL();
                log({
                    message: `Access PGWEB at: ${pgwebAccessURL}`,
                    type: "info",
                });
                break;
            }

            // Support legacy commands by mapping them to the new names
            case "container-up-all":
                log({
                    message:
                        "Warning: Using deprecated command. Please use server-container-up-all instead.",
                    type: "warning",
                });
                await Server_CLI.runForAllServices(async (svc) => {
                    log({
                        message: `Starting ${svc.toLowerCase()} service...`,
                        type: "info",
                        suppress: VircadiaConfig.CLI.VRCA_CLI_SUPPRESS,
                        debug: VircadiaConfig.CLI.VRCA_CLI_DEBUG,
                    });
                    await Server_CLI.up({ service: svc });
                });
                break;

            default:
                log({
                    message: `Unknown command: ${command}`,
                    type: "error",
                });
                printValidCommands();
                process.exit(1);
        }
    } catch (error) {
        // ... existing error handling code ...
    }
}
