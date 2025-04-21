import { VircadiaConfig_CLI } from "../sdk/vircadia-world-sdk-ts/config/vircadia.cli.config.ts";
import { VircadiaConfig_BROWSER_CLIENT } from "../sdk/vircadia-world-sdk-ts/config/vircadia.browser.client.config.ts";
import { VircadiaConfig_SERVER } from "../sdk/vircadia-world-sdk-ts/config/vircadia.server.config.ts";
import { log } from "../sdk/vircadia-world-sdk-ts/module/general/log.ts";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dirname, basename } from "node:path";
import {
    readdir,
    readFile,
    watch,
    writeFile,
    type FileChangeInfo,
    mkdir,
} from "node:fs/promises";
import { existsSync, type WatchEventType } from "node:fs";
import { sign } from "jsonwebtoken";
import { PostgresClient } from "../sdk/vircadia-world-sdk-ts/module/server/postgres.server.client.ts";
import {
    type Entity,
    Service,
    type Auth,
} from "../sdk/vircadia-world-sdk-ts/schema/schema.general.ts";
import type postgres from "postgres";

// TODO: Optimize the commands, get up and down rebuilds including init to work well.

// https://github.com/tj/commander.js
// https://www.npmjs.com/package/inquirer

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
                VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_CONTAINER_NAME,

            // Babylon.js
            VRCA_CLIENT_WEB_BABYLON_JS_DEBUG:
                VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG.toString(),
            VRCA_CLIENT_WEB_BABYLON_JS_SUPPRESS:
                VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_SUPPRESS.toString(),

            VRCA_CLIENT_WEB_BABYLON_JS_PRODUCTION_CONTAINER_NAME:
                VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_PRODUCTION_CONTAINER_NAME,
            VRCA_CLIENT_WEB_BABYLON_JS_PRODUCTION_HOST_CONTAINER_BIND_EXTERNAL:
                VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_PRODUCTION_HOST_CONTAINER_BIND_EXTERNAL,
            VRCA_CLIENT_WEB_BABYLON_JS_PRODUCTION_PORT_CONTAINER_BIND_EXTERNAL:
                VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_PRODUCTION_PORT_CONTAINER_BIND_EXTERNAL.toString(),
            VRCA_CLIENT_WEB_BABYLON_JS_PRODUCTION_PORT_CONTAINER_BIND_INTERNAL:
                VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_PRODUCTION_PORT_CONTAINER_BIND_INTERNAL.toString(),

            VRCA_CLIENT_WEB_BABYLON_JS_DEV_HOST:
                VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEV_HOST,
            VRCA_CLIENT_WEB_BABYLON_JS_DEV_PORT:
                VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEV_PORT.toString(),

            VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN:
                VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN,
            VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN_PROVIDER:
                VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN_PROVIDER,

            VRCA_CLIENT_WEB_BABYLON_JS_META_TITLE_BASE:
                VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_META_TITLE_BASE,
            VRCA_CLIENT_WEB_BABYLON_JS_META_DESCRIPTION:
                VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_META_DESCRIPTION,
            VRCA_CLIENT_WEB_BABYLON_JS_META_OG_IMAGE:
                VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_META_OG_IMAGE,
            VRCA_CLIENT_WEB_BABYLON_JS_META_OG_TYPE:
                VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_META_OG_TYPE,
            VRCA_CLIENT_WEB_BABYLON_JS_META_FAVICON:
                VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_META_FAVICON,

            VRCA_CLIENT_WEB_BABYLON_JS_APP_URL:
                VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_APP_URL,

            VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_URI:
                VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_URI,
            VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_URI_USING_SSL:
                VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_URI_USING_SSL.toString(),

            // Three.js
            VRCA_CLIENT_WEB_THREE_JS_DEBUG:
                VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_DEBUG.toString(),
            VRCA_CLIENT_WEB_THREE_JS_SUPPRESS:
                VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_SUPPRESS.toString(),

            VRCA_CLIENT_WEB_THREE_JS_PRODUCTION_CONTAINER_NAME:
                VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_PRODUCTION_CONTAINER_NAME,
            VRCA_CLIENT_WEB_THREE_JS_PRODUCTION_HOST_CONTAINER_BIND_EXTERNAL:
                VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_PRODUCTION_HOST_CONTAINER_BIND_EXTERNAL,
            VRCA_CLIENT_WEB_THREE_JS_PRODUCTION_PORT_CONTAINER_BIND_EXTERNAL:
                VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_PRODUCTION_PORT_CONTAINER_BIND_EXTERNAL.toString(),
            VRCA_CLIENT_WEB_THREE_JS_PRODUCTION_PORT_CONTAINER_BIND_INTERNAL:
                VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_PRODUCTION_PORT_CONTAINER_BIND_INTERNAL.toString(),

            VRCA_CLIENT_WEB_THREE_JS_DEV_HOST:
                VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_DEV_HOST,
            VRCA_CLIENT_WEB_THREE_JS_DEV_PORT:
                VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_DEV_PORT.toString(),
            VRCA_CLIENT_WEB_THREE_JS_DEBUG_SESSION_TOKEN:
                VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_DEBUG_SESSION_TOKEN,
            VRCA_CLIENT_WEB_THREE_JS_DEBUG_SESSION_TOKEN_PROVIDER:
                VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_DEBUG_SESSION_TOKEN_PROVIDER,

            VRCA_CLIENT_WEB_THREE_JS_META_TITLE_BASE:
                VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_META_TITLE_BASE,
            VRCA_CLIENT_WEB_THREE_JS_META_DESCRIPTION:
                VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_META_DESCRIPTION,
            VRCA_CLIENT_WEB_THREE_JS_META_OG_IMAGE:
                VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_META_OG_IMAGE,
            VRCA_CLIENT_WEB_THREE_JS_META_OG_TYPE:
                VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_META_OG_TYPE,
            VRCA_CLIENT_WEB_THREE_JS_META_FAVICON:
                VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_META_FAVICON,

            VRCA_CLIENT_WEB_THREE_JS_APP_URL:
                VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_APP_URL,

            VRCA_CLIENT_WEB_THREE_JS_DEFAULT_WORLD_API_URI:
                VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_DEFAULT_WORLD_API_URI,
            VRCA_CLIENT_WEB_THREE_JS_DEFAULT_WORLD_API_URI_USING_SSL:
                VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_DEFAULT_WORLD_API_URI_USING_SSL.toString(),
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
            suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
            debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
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
                suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
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
                suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
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

    // Web Babylon JS Prod Client health check function
    export async function isWebBabylonJsProdHealthy(data: {
        wait?:
            | {
                  interval: number;
                  timeout: number;
              }
            | boolean;
    }): Promise<{
        isHealthy: boolean;
        error?: Error;
    }> {
        const defaultWait = { interval: 100, timeout: 10000 };

        const waitConfig =
            data.wait === true
                ? defaultWait
                : data.wait && typeof data.wait !== "boolean"
                  ? data.wait
                  : null;

        const checkWebBabylonJs = async (): Promise<{
            isHealthy: boolean;
            error?: Error;
        }> => {
            try {
                const response = await fetch(
                    `http://${VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_PRODUCTION_HOST_CONTAINER_BIND_EXTERNAL}:${VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_PRODUCTION_PORT_CONTAINER_BIND_EXTERNAL}`,
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

    // Web Three JS Prod Client health check function
    export async function isWebThreeJsProdHealthy(data: {
        wait?: { interval: number; timeout: number } | boolean;
    }): Promise<{
        isHealthy: boolean;
        error?: Error;
    }> {
        const defaultWait = { interval: 100, timeout: 10000 };

        const waitConfig =
            data.wait === true
                ? defaultWait
                : data.wait && typeof data.wait !== "boolean"
                  ? data.wait
                  : null;

        const checkWebThreeJs = async (): Promise<{
            isHealthy: boolean;
            error?: Error;
        }> => {
            try {
                const response = await fetch(
                    `http://${VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_PRODUCTION_HOST_CONTAINER_BIND_EXTERNAL}:${VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_PRODUCTION_PORT_CONTAINER_BIND_EXTERNAL}`,
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
            return await checkWebThreeJs();
        }

        // With waiting enabled, retry until timeout
        const startTime = Date.now();
        let lastError: Error | undefined;

        while (Date.now() - startTime < waitConfig.timeout) {
            const result = await checkWebThreeJs();
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
                VircadiaConfig_SERVER.VRCA_SERVER_CONTAINER_NAME,
            VRCA_SERVER_DEBUG:
                VircadiaConfig_SERVER.VRCA_SERVER_DEBUG.toString(),
            VRCA_SERVER_SUPPRESS:
                VircadiaConfig_SERVER.VRCA_SERVER_SUPPRESS.toString(),

            VRCA_SERVER_SERVICE_POSTGRES_CONTAINER_NAME:
                VircadiaConfig_SERVER.VRCA_SERVER_SERVICE_POSTGRES_CONTAINER_NAME,
            VRCA_SERVER_SERVICE_POSTGRES_SUPER_USER_USERNAME:
                VircadiaConfig_SERVER.VRCA_SERVER_SERVICE_POSTGRES_SUPER_USER_USERNAME,
            VRCA_SERVER_SERVICE_POSTGRES_SUPER_USER_PASSWORD:
                VircadiaConfig_SERVER.VRCA_SERVER_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
            VRCA_SERVER_SERVICE_POSTGRES_AGENT_PROXY_USER_USERNAME:
                VircadiaConfig_SERVER.VRCA_SERVER_SERVICE_POSTGRES_AGENT_PROXY_USER_USERNAME,
            VRCA_SERVER_SERVICE_POSTGRES_AGENT_PROXY_USER_PASSWORD:
                VircadiaConfig_SERVER.VRCA_SERVER_SERVICE_POSTGRES_AGENT_PROXY_USER_PASSWORD,
            VRCA_SERVER_SERVICE_POSTGRES_HOST_CONTAINER_BIND_EXTERNAL:
                VircadiaConfig_SERVER.VRCA_SERVER_SERVICE_POSTGRES_HOST_CONTAINER_BIND_EXTERNAL,
            VRCA_SERVER_SERVICE_POSTGRES_PORT_CONTAINER_BIND_EXTERNAL:
                VircadiaConfig_SERVER.VRCA_SERVER_SERVICE_POSTGRES_PORT_CONTAINER_BIND_EXTERNAL.toString(),
            VRCA_SERVER_SERVICE_POSTGRES_DATABASE:
                VircadiaConfig_SERVER.VRCA_SERVER_SERVICE_POSTGRES_DATABASE,
            VRCA_SERVER_SERVICE_POSTGRES_EXTENSIONS:
                VircadiaConfig_SERVER.VRCA_SERVER_SERVICE_POSTGRES_EXTENSIONS.join(
                    ",",
                ),

            VRCA_SERVER_SERVICE_PGWEB_CONTAINER_NAME:
                VircadiaConfig_SERVER.VRCA_SERVER_SERVICE_PGWEB_CONTAINER_NAME,
            VRCA_SERVER_SERVICE_PGWEB_HOST_CONTAINER_BIND_EXTERNAL:
                VircadiaConfig_SERVER.VRCA_SERVER_SERVICE_PGWEB_HOST_CONTAINER_BIND_EXTERNAL,
            VRCA_SERVER_SERVICE_PGWEB_PORT_CONTAINER_BIND_EXTERNAL:
                VircadiaConfig_SERVER.VRCA_SERVER_SERVICE_PGWEB_PORT_CONTAINER_BIND_EXTERNAL.toString(),

            VRCA_SERVER_SERVICE_WORLD_API_MANAGER_CONTAINER_NAME:
                VircadiaConfig_SERVER.VRCA_SERVER_SERVICE_WORLD_API_MANAGER_CONTAINER_NAME,
            VRCA_SERVER_SERVICE_WORLD_API_MANAGER_HOST_CONTAINER_BIND_INTERNAL:
                VircadiaConfig_SERVER.VRCA_SERVER_SERVICE_WORLD_API_MANAGER_HOST_CONTAINER_BIND_INTERNAL,
            VRCA_SERVER_SERVICE_WORLD_API_MANAGER_PORT_CONTAINER_BIND_INTERNAL:
                VircadiaConfig_SERVER.VRCA_SERVER_SERVICE_WORLD_API_MANAGER_PORT_CONTAINER_BIND_INTERNAL.toString(),
            VRCA_SERVER_SERVICE_WORLD_API_MANAGER_HOST_CONTAINER_BIND_EXTERNAL:
                VircadiaConfig_SERVER.VRCA_SERVER_SERVICE_WORLD_API_MANAGER_HOST_CONTAINER_BIND_EXTERNAL,
            VRCA_SERVER_SERVICE_WORLD_API_MANAGER_PORT_CONTAINER_BIND_EXTERNAL:
                VircadiaConfig_SERVER.VRCA_SERVER_SERVICE_WORLD_API_MANAGER_PORT_CONTAINER_BIND_EXTERNAL.toString(),
            VRCA_SERVER_SERVICE_WORLD_API_MANAGER_HOST_PUBLIC_AVAILABLE_AT:
                VircadiaConfig_SERVER.VRCA_SERVER_SERVICE_WORLD_API_MANAGER_HOST_PUBLIC_AVAILABLE_AT,
            VRCA_SERVER_SERVICE_WORLD_API_MANAGER_PORT_PUBLIC_AVAILABLE_AT:
                VircadiaConfig_SERVER.VRCA_SERVER_SERVICE_WORLD_API_MANAGER_PORT_PUBLIC_AVAILABLE_AT.toString(),

            VRCA_SERVER_SERVICE_WORLD_TICK_MANAGER_CONTAINER_NAME:
                VircadiaConfig_SERVER.VRCA_SERVER_SERVICE_WORLD_TICK_MANAGER_CONTAINER_NAME,
            VRCA_SERVER_SERVICE_WORLD_TICK_MANAGER_HOST_CONTAINER_BIND_INTERNAL:
                VircadiaConfig_SERVER.VRCA_SERVER_SERVICE_WORLD_TICK_MANAGER_HOST_CONTAINER_BIND_INTERNAL,
            VRCA_SERVER_SERVICE_WORLD_TICK_MANAGER_PORT_CONTAINER_BIND_INTERNAL:
                VircadiaConfig_SERVER.VRCA_SERVER_SERVICE_WORLD_TICK_MANAGER_PORT_CONTAINER_BIND_INTERNAL.toString(),
            VRCA_SERVER_SERVICE_WORLD_TICK_MANAGER_HOST_CONTAINER_BIND_EXTERNAL:
                VircadiaConfig_SERVER.VRCA_SERVER_SERVICE_WORLD_TICK_MANAGER_HOST_CONTAINER_BIND_EXTERNAL,
            VRCA_SERVER_SERVICE_WORLD_TICK_MANAGER_PORT_CONTAINER_BIND_EXTERNAL:
                VircadiaConfig_SERVER.VRCA_SERVER_SERVICE_WORLD_TICK_MANAGER_PORT_CONTAINER_BIND_EXTERNAL.toString(),
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
            suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
            debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
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
                suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
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
                suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
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
                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                    suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                });

                const sql = await db.getSuperClient({
                    postgres: {
                        host: VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_HOST,
                        port: VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_PORT,
                        database:
                            VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_DATABASE,
                        username:
                            VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_USERNAME,
                        password:
                            VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
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
                const url = `http://${VircadiaConfig_CLI.VRCA_CLI_SERVICE_WORLD_API_MANAGER_HOST}:${VircadiaConfig_CLI.VRCA_CLI_SERVICE_WORLD_API_MANAGER_PORT}${Service.API.Stats_Endpoint.path}`;
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
                const url = `http://${VircadiaConfig_CLI.VRCA_CLI_SERVICE_WORLD_TICK_MANAGER_HOST}:${VircadiaConfig_CLI.VRCA_CLI_SERVICE_WORLD_TICK_MANAGER_PORT}${Service.Tick.Stats_Endpoint.path}`;
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
        const db = PostgresClient.getInstance({
            debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
            suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
        });
        const sql = await db.getSuperClient({
            postgres: {
                host: VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_HOST,
                port: VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_PORT,
                database: VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_DATABASE,
                username:
                    VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_USERNAME,
                password:
                    VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
            },
        });

        try {
            // Get list of migration files
            const resets = await readdir(
                VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_RESET_DIR,
                {
                    recursive: true,
                },
            );
            const resetSqlFiles = resets
                .filter((f) => f.endsWith(".sql"))
                .sort();

            // Run pending migrations
            for (const file of resetSqlFiles) {
                try {
                    const filePath = path.join(
                        VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_RESET_DIR,
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
                        suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                        debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                    });
                } catch (error) {
                    log({
                        message: `Failed to run reset ${file}.`,
                        type: "error",
                        error: error,
                        suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                        debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                    });
                    throw error;
                }
            }
        } catch (error) {
            log({
                message: `Database reset failed: ${error}`,
                type: "error",
                suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
            });
            throw error;
        }
    }

    export async function migrate(): Promise<boolean> {
        const db = PostgresClient.getInstance({
            debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
            suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
        });
        const sql = await db.getSuperClient({
            postgres: {
                host: VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_HOST,
                port: VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_PORT,
                database: VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_DATABASE,
                username:
                    VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_USERNAME,
                password:
                    VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
            },
        });

        let migrationsRan = false;

        for (const name of VircadiaConfig_SERVER.VRCA_SERVER_SERVICE_POSTGRES_EXTENSIONS) {
            log({
                message: `Installing PostgreSQL extension: ${name}...`,
                type: "debug",
                suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
            });
            await sql`CREATE EXTENSION IF NOT EXISTS ${sql(name)};`;
            log({
                message: `PostgreSQL extension ${name} installed successfully`,
                type: "debug",
                suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
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
            VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_MIGRATION_DIR,
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

        log({
            message: `Attempting to read migrations directory: ${migrations}, found ${migrationSqlFiles.length} files`,
            type: "debug",
            suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
            debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
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
                        VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_MIGRATION_DIR,
                        file,
                    );
                    const sqlContent = await readFile(filePath, "utf-8");

                    log({
                        message: `Executing migration ${file}...`,
                        type: "debug",
                        suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                        debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
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
                        suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                        debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                    });
                } catch (error) {
                    log({
                        message: `Failed to run migration ${file}.`,
                        type: "error",
                        error: error,
                        suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                        debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                    });
                    throw error;
                }
            }
        }

        return migrationsRan;
    }

    // Separate seed functions for SQL and assets
    export async function seedSql() {
        const db = PostgresClient.getInstance({
            debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
            suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
        });
        const sql = await db.getSuperClient({
            postgres: {
                host: VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_HOST,
                port: VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_PORT,
                database: VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_DATABASE,
                username:
                    VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_USERNAME,
                password:
                    VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
            },
        });

        // Ensure we resolve the seed path to absolute path
        const systemSqlDir =
            VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_SEED_SYSTEM_SQL_DIR;

        const userSqlDir =
            VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_SEED_USER_SQL_DIR;

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

                    log({
                        message: `Found ${systemSqlFiles.length} system SQL seed files in ${systemSqlDir}`,
                        type: "debug",
                        suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                        debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                    });
                } catch (error) {
                    log({
                        message: `No system SQL seed files found or error accessing directory: ${systemSqlDir}`,
                        type: "warn",
                        error,
                        suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                        debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                    });
                }
            } else {
                log({
                    message: "System SQL directory not configured",
                    type: "warn",
                    suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
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

                    log({
                        message: `Found ${userSqlFiles.length} user SQL seed files in ${userSqlDir}`,
                        type: "debug",
                        suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                        debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                    });
                } catch (error) {
                    log({
                        message: `No user SQL seed files found or error accessing directory: ${userSqlDir}`,
                        type: "warn",
                        error,
                        suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                        debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                    });
                }
            } else {
                log({
                    message: "User SQL directory not configured",
                    type: "warn",
                    suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                });
            }

            if (systemSqlFiles.length === 0 && userSqlFiles.length === 0) {
                log({
                    message: `No SQL seed files found in either ${systemSqlDir || "undefined"} or ${userSqlDir || "undefined"}`,
                    type: "info",
                    suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
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
                log({
                    message: `Found seed ${sqlFile}...`,
                    type: "debug",
                    suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
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
                        log({
                            message: `Warning: Seed ${sqlFile} has changed since it was last executed`,
                            type: "warn",
                            suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                            debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                        });
                    }

                    log({
                        message: `Executing seed ${sqlFile} (hash: ${content_hash})...`,
                        type: "debug",
                        suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                        debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
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

                        log({
                            message: `Seed ${sqlFile} executed successfully`,
                            type: "debug",
                            suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                            debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                        });
                    } catch (error) {
                        log({
                            message: `Failed to run seed ${sqlFile}`,
                            data: {
                                directory,
                            },
                            type: "error",
                            error: error,
                            suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                            debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                        });
                        throw error;
                    }
                } else {
                    log({
                        message: `Seed ${sqlFile} already executed`,
                        type: "debug",
                        suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                        debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                    });
                }
            }

            log({
                message: "SQL seeding completed successfully",
                type: "success",
                suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
            });
        } catch (error) {
            log({
                message: `Error processing SQL seed files: ${error instanceof Error ? error.message : String(error)}`,
                type: "error",
                suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
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

        const db = PostgresClient.getInstance({
            debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
            suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
        });
        const sql = await db.getSuperClient({
            postgres: {
                host: VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_HOST,
                port: VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_PORT,
                database: VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_DATABASE,
                username:
                    VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_USERNAME,
                password:
                    VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
            },
        });

        // Get paths for both system and user asset directories
        const systemAssetDir =
            VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_SEED_SYSTEM_ASSET_DIR;
        const userAssetDir =
            VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_SEED_USER_ASSET_DIR;

        try {
            // Get all assets from the database with one query
            const dbAssets = await sql<
                Pick<Entity.Asset.I_Asset, "general__asset_file_name">[]
            >`
                SELECT general__asset_file_name FROM entity.entity_assets
            `;

            log({
                message: `Found ${dbAssets.length} assets in database`,
                type: "debug",
                suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
            });

            // Process system asset files
            let filesInSystemAssetDir: string[] = [];
            if (systemAssetDir) {
                try {
                    filesInSystemAssetDir = await readdir(systemAssetDir, {
                        recursive: true,
                    });

                    log({
                        message: `Found ${filesInSystemAssetDir.length} system asset files in ${systemAssetDir}`,
                        type: "debug",
                        suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                        debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                    });
                } catch (error) {
                    log({
                        message: `No system asset files found or error accessing directory: ${systemAssetDir}`,
                        type: "warn",
                        error,
                        suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                        debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                    });
                }
            } else {
                log({
                    message: "System asset directory not configured",
                    type: "warn",
                    suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                });
            }

            // Process user asset files
            let filesInUserAssetDir: string[] = [];
            if (userAssetDir) {
                try {
                    filesInUserAssetDir = await readdir(userAssetDir, {
                        recursive: true,
                    });

                    log({
                        message: `Found ${filesInUserAssetDir.length} user asset files in ${userAssetDir}`,
                        type: "debug",
                        suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                        debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                    });
                } catch (error) {
                    log({
                        message: `No user asset files found or error accessing directory: ${userAssetDir}`,
                        type: "warn",
                        error,
                        suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                        debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                    });
                }
            } else {
                log({
                    message: "User asset directory not configured",
                    type: "warn",
                    suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                });
            }

            if (
                filesInSystemAssetDir.length === 0 &&
                filesInUserAssetDir.length === 0
            ) {
                log({
                    message: `No asset files found in either ${systemAssetDir || "undefined"} or ${userAssetDir || "undefined"}`,
                    type: "info",
                    suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
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
                    log({
                        message: `User asset '${userAsset.fileName}' overrides system asset with the same name`,
                        type: "debug",
                        suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                        debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
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

                // Store both base64 and binary formats for compatibility
                const assetDataBase64 = Buffer.from(buffer).toString("base64");
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
                            (general__asset_file_name, asset__data__base64, asset__data__bytea, asset__mime_type, group__sync)
                            VALUES (${searchName}, ${assetDataBase64}, ${assetDataBinary}, ${fileExt}, 
                                ${syncGroup || "public.NORMAL"})
                        `;

                        log({
                            message: `Added new asset to database: ${searchName}`,
                            type: "debug",
                            suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                            debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                        });
                    } catch (error) {
                        log({
                            message: `Failed to add new asset to database: ${searchName}`,
                            type: "error",
                            error: error,
                            suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                            debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
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
                                    asset__data__base64 = ${assetDataBase64},
                                    asset__data__bytea = ${assetDataBinary},
                                    asset__mime_type = ${fileExt}
                                WHERE general__asset_file_name = ${dbAsset.general__asset_file_name}
                            `;
                        }
                    });

                    log({
                        message: `Updated ${matchingAssets.length} assets from file ${fileName}`,
                        type: "debug",
                        suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                        debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                    });
                } catch (error) {
                    log({
                        message: `Failed to update assets from file ${fileName}`,
                        type: "error",
                        error: error,
                        suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                        debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
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

            log({
                message: "Asset seeding completed successfully",
                type: "success",
                suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
            });
        } catch (error) {
            log({
                message: `Error processing asset files: ${error instanceof Error ? error.message : String(error)}`,
                type: "error",
                suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
            });
            throw error;
        }
    }

    export async function generateDbSystemToken(): Promise<{
        token: string;
        sessionId: string;
        agentId: string;
    }> {
        const db = PostgresClient.getInstance({
            debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
            suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
        });
        const sql = await db.getSuperClient({
            postgres: {
                host: VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_HOST,
                port: VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_PORT,
                database: VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_DATABASE,
                username:
                    VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_USERNAME,
                password:
                    VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
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
        const db = PostgresClient.getInstance({
            debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
            suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
        });
        const sql = await db.getSuperClient({
            postgres: {
                host: VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_HOST,
                port: VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_PORT,
                database: VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_DATABASE,
                username:
                    VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_USERNAME,
                password:
                    VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
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
        return `postgres://${VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_USERNAME}:${VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_PASSWORD}@${VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_HOST}:${VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_PORT}/${VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_DATABASE}`;
    }

    export async function generatePgwebAccessURL(): Promise<string> {
        return `http://${VircadiaConfig_CLI.VRCA_CLI_SERVICE_PGWEB_HOST}:${VircadiaConfig_CLI.VRCA_CLI_SERVICE_PGWEB_PORT}`;
    }

    export async function downloadAssetsFromDatabase(data: {
        options?: {
            parallelProcessing?: boolean;
            batchSize?: number;
            syncGroup?: string;
            outputDir?: string;
        };
    }) {
        const syncGroup = data.options?.syncGroup;
        const options = {
            parallelProcessing: true,
            batchSize: 10,
            ...data.options,
        };

        // Use the configured sync directory or the one provided in options
        const outputDir =
            options.outputDir ||
            VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_SYNC_ASSET_DIR;

        const db = PostgresClient.getInstance({
            debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
            suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
        });
        const sql = await db.getSuperClient({
            postgres: {
                host: VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_HOST,
                port: VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_PORT,
                database: VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_DATABASE,
                username:
                    VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_USERNAME,
                password:
                    VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
            },
        });

        log({
            message: `Starting asset download to ${outputDir}...`,
            type: "info",
            suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
            debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
        });

        try {
            // Ensure output directory exists
            if (!existsSync(outputDir)) {
                await mkdir(outputDir, { recursive: true });
            }

            // Query assets, optionally filtering by sync group
            const assetsQuery = syncGroup
                ? sql`
                    SELECT 
                        general__asset_file_name, 
                        asset__data__bytea,
                        asset__mime_type 
                    FROM entity.entity_assets 
                    WHERE group__sync = ${syncGroup}
                  `
                : sql`
                    SELECT 
                        general__asset_file_name, 
                        asset__data__bytea,
                        asset__mime_type 
                    FROM entity.entity_assets
                  `;

            const assets = await assetsQuery;

            log({
                message: syncGroup
                    ? `Retrieved ${assets.length} assets with sync group: ${syncGroup}`
                    : `Retrieved ${assets.length} assets from database`,
                type: "info",
                suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
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

                        log({
                            message: `Downloaded asset: ${fileName}`,
                            type: "debug",
                            suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                            debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                        });
                    } else {
                        log({
                            message: `No binary data for asset: ${fileName}`,
                            type: "warn",
                            suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                            debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                        });
                    }
                } catch (error) {
                    log({
                        message: `Error downloading asset: ${asset.general__asset_file_name}`,
                        type: "error",
                        error,
                        suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                        debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
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

            log({
                message: `Asset download completed successfully. Downloaded ${assets.length} assets.`,
                type: "success",
                suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
            });
        } catch (error) {
            log({
                message: "Error downloading assets from database",
                type: "error",
                error,
                suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
            });
        }
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
            suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
            debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
        });
        process.exit(1);
    }

    try {
        switch (command) {
            // SERVER CONTAINER HEALTH
            case "server:postgres:health": {
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
                    suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
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
                    suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
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

                if (additionalArgs.length > 0) {
                    waitInterval = Number.parseInt(additionalArgs[0]);
                    waitTimeout = Number.parseInt(additionalArgs[1]);
                }

                const health = await Server_CLI.isWorldApiManagerHealthy(
                    waitInterval && waitTimeout
                        ? {
                              interval: waitInterval,
                              timeout: waitTimeout,
                          }
                        : undefined,
                );
                log({
                    message: `World API Manager: ${health.isHealthy ? "healthy" : "unhealthy"}`,
                    data: health,
                    type: health.isHealthy ? "success" : "error",
                    suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
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

                if (additionalArgs.length > 0) {
                    waitInterval = Number.parseInt(additionalArgs[0]);
                    waitTimeout = Number.parseInt(additionalArgs[1]);
                }

                const health = await Server_CLI.isWorldTickManagerHealthy(
                    waitInterval && waitTimeout
                        ? {
                              interval: waitInterval,
                              timeout: waitTimeout,
                          }
                        : undefined,
                );
                log({
                    message: `World Tick Manager: ${health.isHealthy ? "healthy" : "unhealthy"}`,
                    data: health,
                    type: health.isHealthy ? "success" : "error",
                    suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
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
                log({
                    message: "Running database migrations...",
                    type: "info",
                    suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                });
                await Server_CLI.migrate();
                log({
                    message: "Migrations ran successfully",
                    type: "success",
                    suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                });
                break;
            }

            case "server:postgres:wipe": {
                log({
                    message: "Wiping database...",
                    type: "info",
                    suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                });
                await Server_CLI.wipeDatabase();
                log({
                    message: "Database wiped",
                    type: "success",
                    suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                });
                break;
            }

            case "server:postgres:connection-string": {
                const connectionString =
                    await Server_CLI.generateDbConnectionString();
                log({
                    message: `Database connection string:\n[ ${connectionString} ]`,
                    type: "info",
                    suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                });
                break;
            }

            case "server:postgres:system-token": {
                let printOnlyToken = false;

                if (additionalArgs.length > 0) {
                    printOnlyToken = Boolean(additionalArgs[0]);
                }

                if (!printOnlyToken) {
                    log({
                        message: "Generating system token...",
                        type: "info",
                        suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                        debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                    });
                }

                const { token, sessionId, agentId } =
                    await Server_CLI.generateDbSystemToken();
                if (printOnlyToken) {
                    console.log(token);
                } else {
                    log({
                        message: `System agent token: ${token}`,
                        data: { sessionId, agentId },
                        type: "success",
                        suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                        debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                    });
                }
                break;
            }

            case "server:postgres:system-token:invalidate-all": {
                log({
                    message: "Invalidating all system tokens...",
                    type: "info",
                    suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                });
                const invalidatedCount =
                    await Server_CLI.invalidateDbSystemTokens();
                log({
                    message: `Invalidated ${invalidatedCount} system tokens`,
                    type: "success",
                    suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                });
                break;
            }

            case "server:postgres:seed:sql": {
                log({
                    message: "Running database SQL seeds...",
                    type: "info",
                    suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                });
                await Server_CLI.seedSql();
                log({
                    message: "SQL seeds applied.",
                    type: "success",
                    suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                });
                break;
            }

            case "server:postgres:seed:assets": {
                log({
                    message: "Running database asset seeds...",
                    type: "info",
                    suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
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
                log({
                    message: "Asset seeds applied.",
                    type: "success",
                    suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                });
                break;
            }

            // SERVER PGWEB COMMANDS
            case "server:pgweb:access-command": {
                const pgwebAccessURL =
                    await Server_CLI.generatePgwebAccessURL();
                log({
                    message: `Access PGWEB at:\n[ ${pgwebAccessURL} ]`,
                    data: { pgwebAccessURL },
                    type: "success",
                    suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                });
                break;
            }

            // CLIENT CONTAINER HEALTH
            case "client:web_babylon_js_prod:health": {
                let waitInterval: number | undefined;
                let waitTimeout: number | undefined;

                if (additionalArgs.length > 0) {
                    waitInterval = Number.parseInt(additionalArgs[0]);
                    waitTimeout = Number.parseInt(additionalArgs[1]);
                }

                const health = await Client_CLI.isWebBabylonJsProdHealthy({
                    wait:
                        waitInterval && waitTimeout
                            ? {
                                  interval: waitInterval,
                                  timeout: waitTimeout,
                              }
                            : undefined,
                });
                log({
                    message: `Web Babylon JS (Production): ${health.isHealthy ? "healthy" : "unhealthy"}`,
                    data: health,
                    type: health.isHealthy ? "success" : "error",
                    suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                });
                if (!health.isHealthy) {
                    process.exit(1);
                } else {
                    process.exit(0);
                }
                break;
            }

            case "client:web_three_js_prod:health": {
                let waitInterval: number | undefined;
                let waitTimeout: number | undefined;

                if (additionalArgs.length > 0) {
                    waitInterval = Number.parseInt(additionalArgs[0]);
                    waitTimeout = Number.parseInt(additionalArgs[1]);
                }

                const health = await Client_CLI.isWebThreeJsProdHealthy({
                    wait:
                        waitInterval && waitTimeout
                            ? {
                                  interval: waitInterval,
                                  timeout: waitTimeout,
                              }
                            : undefined,
                });
                log({
                    message: `Web Three JS (Production): ${health.isHealthy ? "healthy" : "unhealthy"}`,
                    data: health,
                    type: health.isHealthy ? "success" : "error",
                    suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                });
                if (!health.isHealthy) {
                    process.exit(1);
                } else {
                    process.exit(0);
                }
                break;
            }

            // Generic docker command support
            case "server:run-command":
                await Server_CLI.runServerDockerCommand({
                    args: additionalArgs,
                });
                break;

            case "client:run-command":
                await Client_CLI.runClientDockerCommand({
                    args: additionalArgs,
                });
                break;

            // HOT SYNC MODULE

            case "dev:hot-sync:assets": {
                // await AssetHotSync.hotSyncAssets({
                //     pollIntervalMs: 5000,
                //     debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                //     compileForce: true,
                // });
                break;
            }

            default:
                log({
                    message: `Unknown command: ${command}`,
                    type: "error",
                    suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                });
                process.exit(1);
        }

        process.exit(0);
    } catch (error) {
        log({
            message: `Error: ${error}`,
            type: "error",
            suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
            debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
        });
        process.exit(1);
    }
}
