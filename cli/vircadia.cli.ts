import { serverConfiguration } from "../sdk/vircadia-world-sdk-ts/bun/src/config/vircadia.server.config";
import { cliConfiguration } from "./vircadia.cli.config";
import { clientBrowserConfiguration } from "../sdk/vircadia-world-sdk-ts/browser/src/config/vircadia.browser.config";
import { BunLogModule } from "../sdk/vircadia-world-sdk-ts/bun/src/module/vircadia.common.bun.log.module";
import path from "node:path";
import { $ } from "bun";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { sign } from "jsonwebtoken";
import { BunPostgresClientModule } from "../sdk/vircadia-world-sdk-ts/bun/src/module/vircadia.common.bun.postgres.module";
import { input, select, Separator } from "@inquirer/prompts";
import {
    type Entity,
    type Auth,
} from "../sdk/vircadia-world-sdk-ts/schema/src/vircadia.schema.general";

// Hardcoded system directories
const SYSTEM_SQL_DIR = path.join(
    dirname(fileURLToPath(import.meta.url)),
    "./database/seed/sql/",
);

const SYSTEM_ASSET_DIR = path.join(
    dirname(fileURLToPath(import.meta.url)),
    "./database/seed/asset/",
);

const SYSTEM_RESET_DIR = path.join(
    dirname(fileURLToPath(import.meta.url)),
    "./database/reset",
);

const MIGRATION_DIR = path.join(
    dirname(fileURLToPath(import.meta.url)),
    "./database/migration",
);

// Environment Variable Management Module
export namespace EnvManager {
    const CLI_ENV_FILE_PATH = path.join(
        dirname(fileURLToPath(import.meta.url)),
        ".env",
    );

    const CLIENT_ENV_FILE_PATH = path.join(
        dirname(fileURLToPath(import.meta.url)),
        "../client/web_babylon_js/.env",
    );

    export async function setVariable(
        key: string,
        value: string,
        envFile: "cli" | "client" = "cli",
    ): Promise<void> {
        try {
            const envFilePath =
                envFile === "cli" ? CLI_ENV_FILE_PATH : CLIENT_ENV_FILE_PATH;

            let content = "";

            // Read existing file if it exists
            if (existsSync(envFilePath)) {
                content = await readFile(envFilePath, "utf-8");
            }

            const lines = content.split("\n");
            const keyPattern = new RegExp(`^${key}=.*$`);
            let found = false;

            // Search for existing key and replace
            for (let i = 0; i < lines.length; i++) {
                if (keyPattern.test(lines[i].trim())) {
                    lines[i] = `${key}=${value}`;
                    found = true;
                    break;
                }
            }

            // If not found, add to end
            if (!found) {
                if (content && !content.endsWith("\n")) {
                    lines.push("");
                }
                lines.push(`${key}=${value}`);
            }

            // Write back to file
            const newContent = lines.join("\n");
            await writeFile(envFilePath, newContent, "utf-8");

            // Update current session
            process.env[key] = value;

            BunLogModule({
                message: `Set ${key}=${value}`,
                type: "success",
                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                debug: cliConfiguration.VRCA_CLI_DEBUG,
            });
        } catch (error) {
            throw new Error(`Failed to set environment variable: ${error}`);
        }
    }

    export async function unsetVariable(
        key: string,
        envFile: "cli" | "client" = "cli",
    ): Promise<void> {
        try {
            const envFilePath =
                envFile === "cli" ? CLI_ENV_FILE_PATH : CLIENT_ENV_FILE_PATH;

            if (!existsSync(envFilePath)) {
                BunLogModule({
                    message: `Environment file does not exist: ${envFilePath}`,
                    type: "warn",
                    suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                    debug: cliConfiguration.VRCA_CLI_DEBUG,
                });
                return;
            }

            const content = await readFile(envFilePath, "utf-8");
            const lines = content.split("\n");
            const keyPattern = new RegExp(`^${key}=.*$`);

            // Filter out the line with the key
            const filteredLines = lines.filter(
                (line) => !keyPattern.test(line.trim()),
            );

            // Write back to file
            const newContent = filteredLines.join("\n");
            await writeFile(envFilePath, newContent, "utf-8");

            // Remove from current session
            delete process.env[key];

            BunLogModule({
                message: `Unset ${key}`,
                type: "success",
                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                debug: cliConfiguration.VRCA_CLI_DEBUG,
            });
        } catch (error) {
            throw new Error(`Failed to unset environment variable: ${error}`);
        }
    }

    export async function getVariable(
        key: string,
        envFile: "cli" | "client" = "cli",
    ): Promise<string | undefined> {
        try {
            const envFilePath =
                envFile === "cli" ? CLI_ENV_FILE_PATH : CLIENT_ENV_FILE_PATH;

            if (!existsSync(envFilePath)) {
                return undefined;
            }

            const content = await readFile(envFilePath, "utf-8");
            const lines = content.split("\n");
            const keyPattern = new RegExp(`^${key}=(.*)$`);

            for (const line of lines) {
                const match = line.trim().match(keyPattern);
                if (match) {
                    return match[1];
                }
            }

            return undefined;
        } catch (error) {
            BunLogModule({
                message: `Failed to read environment variable ${key}: ${error}`,
                type: "warn",
                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                debug: cliConfiguration.VRCA_CLI_DEBUG,
            });
            return undefined;
        }
    }
}

export namespace Server_CLI {
    const SERVER_DOCKER_COMPOSE_FILE = path.join(
        dirname(fileURLToPath(import.meta.url)),
        "../server/service/server.docker.compose.yml",
    );

    async function isContainerHealthyByDocker(
        containerName: string,
    ): Promise<{ isHealthy: boolean; error?: Error }> {
        try {
            const proc = Bun.spawn(["docker", "inspect", containerName], {
                stdout: "pipe",
                stderr: "pipe",
            });
            const stdout = await new Response(proc.stdout).text();
            const stderr = await new Response(proc.stderr).text();
            if (proc.exitCode !== 0) {
                return {
                    isHealthy: false,
                    error: new Error(
                        `docker inspect failed (${proc.exitCode}): ${stderr || "no stderr"}`,
                    ),
                };
            }
            const info = JSON.parse(stdout);
            const state = Array.isArray(info) ? info[0]?.State : info?.State;
            const status: string | undefined = state?.Health?.Status;
            if (status === "healthy") {
                return { isHealthy: true };
            }
            return {
                isHealthy: false,
                error: new Error(
                    `container health: ${status ?? "unknown"} (state: ${state?.Status ?? "unknown"})`,
                ),
            };
        } catch (error) {
            return { isHealthy: false, error: error as Error };
        }
    }

    export async function runServerDockerCommand(data: {
        args: string[];
        /** If true, treat 'exec' on non-zero exit as an error */
        throwOnNonZeroExec?: boolean;
    }) {
        const { args, throwOnNonZeroExec = false } = data;
        const processEnv = {
            ...process.env,
            PATH: process.env.PATH,

            VRCA_SERVER_CONTAINER_NAME:
                serverConfiguration.VRCA_SERVER_CONTAINER_NAME,
            VRCA_SERVER_DEBUG: serverConfiguration.VRCA_SERVER_DEBUG.toString(),
            VRCA_SERVER_SUPPRESS:
                serverConfiguration.VRCA_SERVER_SUPPRESS.toString(),

            VRCA_SERVER_SERVICE_POSTGRES_CONTAINER_NAME:
                serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_CONTAINER_NAME,
            VRCA_SERVER_SERVICE_POSTGRES_SUPER_USER_USERNAME:
                serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_SUPER_USER_USERNAME,
            VRCA_SERVER_SERVICE_POSTGRES_SUPER_USER_PASSWORD:
                serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
            VRCA_SERVER_SERVICE_POSTGRES_AGENT_PROXY_USER_USERNAME:
                serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_AGENT_PROXY_USER_USERNAME,
            VRCA_SERVER_SERVICE_POSTGRES_AGENT_PROXY_USER_PASSWORD:
                serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_AGENT_PROXY_USER_PASSWORD,
            VRCA_SERVER_SERVICE_POSTGRES_HOST_CONTAINER_BIND_EXTERNAL:
                serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_HOST_CONTAINER_BIND_EXTERNAL,
            VRCA_SERVER_SERVICE_POSTGRES_PORT_CONTAINER_BIND_EXTERNAL:
                serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_PORT_CONTAINER_BIND_EXTERNAL.toString(),
            VRCA_SERVER_SERVICE_POSTGRES_DATABASE:
                serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_DATABASE,
            VRCA_SERVER_SERVICE_POSTGRES_EXTENSIONS:
                serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_EXTENSIONS,

            VRCA_SERVER_SERVICE_PGWEB_CONTAINER_NAME:
                serverConfiguration.VRCA_SERVER_SERVICE_PGWEB_CONTAINER_NAME,
            VRCA_SERVER_SERVICE_PGWEB_HOST_CONTAINER_BIND_EXTERNAL:
                serverConfiguration.VRCA_SERVER_SERVICE_PGWEB_HOST_CONTAINER_BIND_EXTERNAL,
            VRCA_SERVER_SERVICE_PGWEB_PORT_CONTAINER_BIND_EXTERNAL:
                serverConfiguration.VRCA_SERVER_SERVICE_PGWEB_PORT_CONTAINER_BIND_EXTERNAL.toString(),

            // Caddy reverse proxy
            VRCA_SERVER_SERVICE_CADDY_CONTAINER_NAME:
                serverConfiguration.VRCA_SERVER_SERVICE_CADDY_CONTAINER_NAME,
            VRCA_SERVER_SERVICE_CADDY_HOST_CONTAINER_BIND_EXTERNAL:
                serverConfiguration.VRCA_SERVER_SERVICE_CADDY_HOST_CONTAINER_BIND_EXTERNAL,
            VRCA_SERVER_SERVICE_CADDY_PORT_CONTAINER_BIND_EXTERNAL_HTTP:
                serverConfiguration.VRCA_SERVER_SERVICE_CADDY_PORT_CONTAINER_BIND_EXTERNAL_HTTP.toString(),
            VRCA_SERVER_SERVICE_CADDY_PORT_CONTAINER_BIND_EXTERNAL_HTTPS:
                serverConfiguration.VRCA_SERVER_SERVICE_CADDY_PORT_CONTAINER_BIND_EXTERNAL_HTTPS.toString(),
            VRCA_SERVER_SERVICE_CADDY_DOMAIN_API:
                serverConfiguration.VRCA_SERVER_SERVICE_CADDY_DOMAIN_API,
            VRCA_SERVER_SERVICE_CADDY_DOMAIN_APP:
                serverConfiguration.VRCA_SERVER_SERVICE_CADDY_DOMAIN_APP,
            VRCA_SERVER_SERVICE_CADDY_EMAIL:
                serverConfiguration.VRCA_SERVER_SERVICE_CADDY_EMAIL,
            VRCA_SERVER_SERVICE_CADDY_TLS_API:
                serverConfiguration.VRCA_SERVER_SERVICE_CADDY_TLS_API,
            VRCA_SERVER_SERVICE_CADDY_TLS_APP:
                serverConfiguration.VRCA_SERVER_SERVICE_CADDY_TLS_APP,

            // API WS Manager
            VRCA_SERVER_SERVICE_WORLD_API_WS_MANAGER_CONTAINER_NAME:
                serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_WS_MANAGER_CONTAINER_NAME,
            VRCA_SERVER_SERVICE_WORLD_API_WS_MANAGER_HOST_CONTAINER_BIND_EXTERNAL:
                serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_WS_MANAGER_HOST_CONTAINER_BIND_EXTERNAL,
            VRCA_SERVER_SERVICE_WORLD_API_WS_MANAGER_PORT_CONTAINER_BIND_EXTERNAL:
                serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_WS_MANAGER_PORT_CONTAINER_BIND_EXTERNAL.toString(),
            VRCA_SERVER_SERVICE_WORLD_API_WS_MANAGER_HOST_PUBLIC_AVAILABLE_AT:
                serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_WS_MANAGER_HOST_PUBLIC_AVAILABLE_AT,
            VRCA_SERVER_SERVICE_WORLD_API_WS_MANAGER_PORT_PUBLIC_AVAILABLE_AT:
                serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_WS_MANAGER_PORT_PUBLIC_AVAILABLE_AT.toString(),
            VRCA_SERVER_SERVICE_WORLD_API_WS_MANAGER_DEBUG:
                serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_WS_MANAGER_DEBUG.toString(),
            VRCA_SERVER_SERVICE_WORLD_API_WS_MANAGER_SUPPRESS:
                serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_WS_MANAGER_SUPPRESS.toString(),

            // API REST Auth Manager
            VRCA_SERVER_SERVICE_WORLD_API_REST_AUTH_MANAGER_CONTAINER_NAME:
                serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_AUTH_MANAGER_CONTAINER_NAME,
            VRCA_SERVER_SERVICE_WORLD_API_REST_AUTH_MANAGER_HOST_CONTAINER_BIND_EXTERNAL:
                serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_AUTH_MANAGER_HOST_CONTAINER_BIND_EXTERNAL,
            VRCA_SERVER_SERVICE_WORLD_API_REST_AUTH_MANAGER_PORT_CONTAINER_BIND_EXTERNAL:
                serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_AUTH_MANAGER_PORT_CONTAINER_BIND_EXTERNAL.toString(),
            VRCA_SERVER_SERVICE_WORLD_API_REST_AUTH_MANAGER_HOST_PUBLIC_AVAILABLE_AT:
                serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_AUTH_MANAGER_HOST_PUBLIC_AVAILABLE_AT,
            VRCA_SERVER_SERVICE_WORLD_API_REST_AUTH_MANAGER_PORT_PUBLIC_AVAILABLE_AT:
                serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_AUTH_MANAGER_PORT_PUBLIC_AVAILABLE_AT.toString(),    
            VRCA_SERVER_SERVICE_WORLD_API_REST_AUTH_MANAGER_DEBUG:
                serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_AUTH_MANAGER_DEBUG.toString(),
            VRCA_SERVER_SERVICE_WORLD_API_REST_AUTH_MANAGER_SUPPRESS:
                serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_AUTH_MANAGER_SUPPRESS.toString(),

            // API REST Asset Manager
            VRCA_SERVER_SERVICE_WORLD_API_REST_ASSET_MANAGER_CONTAINER_NAME:
                serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_ASSET_MANAGER_CONTAINER_NAME,
            VRCA_SERVER_SERVICE_WORLD_API_REST_ASSET_MANAGER_HOST_CONTAINER_BIND_EXTERNAL:
                serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_ASSET_MANAGER_HOST_CONTAINER_BIND_EXTERNAL,
            VRCA_SERVER_SERVICE_WORLD_API_REST_ASSET_MANAGER_PORT_CONTAINER_BIND_EXTERNAL:
                serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_ASSET_MANAGER_PORT_CONTAINER_BIND_EXTERNAL.toString(),
            VRCA_SERVER_SERVICE_WORLD_API_REST_ASSET_MANAGER_HOST_PUBLIC_AVAILABLE_AT:
                serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_ASSET_MANAGER_HOST_PUBLIC_AVAILABLE_AT,
            VRCA_SERVER_SERVICE_WORLD_API_REST_ASSET_MANAGER_PORT_PUBLIC_AVAILABLE_AT:
                serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_ASSET_MANAGER_PORT_PUBLIC_AVAILABLE_AT.toString(),
            VRCA_SERVER_SERVICE_WORLD_API_REST_ASSET_MANAGER_ASSET_CACHE_MAX_BYTES:
                serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_ASSET_MANAGER_ASSET_CACHE_MAX_BYTES.toString(),
            VRCA_SERVER_SERVICE_WORLD_API_REST_ASSET_MANAGER_ASSET_CACHE_DIR:
                serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_ASSET_MANAGER_ASSET_CACHE_DIR,
            VRCA_SERVER_SERVICE_WORLD_API_REST_ASSET_MANAGER_ASSET_CACHE_MAINTENANCE_INTERVAL_MS:
                serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_ASSET_MANAGER_ASSET_CACHE_MAINTENANCE_INTERVAL_MS.toString(),    
            VRCA_SERVER_SERVICE_WORLD_API_REST_ASSET_MANAGER_DEBUG:
                serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_ASSET_MANAGER_DEBUG.toString(),
            VRCA_SERVER_SERVICE_WORLD_API_REST_ASSET_MANAGER_SUPPRESS:
                serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_ASSET_MANAGER_SUPPRESS.toString(),

            // State Manager
            VRCA_SERVER_SERVICE_WORLD_STATE_MANAGER_CONTAINER_NAME:
                serverConfiguration.VRCA_SERVER_SERVICE_WORLD_STATE_MANAGER_CONTAINER_NAME,
            VRCA_SERVER_SERVICE_WORLD_STATE_MANAGER_DEBUG:
                serverConfiguration.VRCA_SERVER_SERVICE_WORLD_STATE_MANAGER_DEBUG.toString(),
            VRCA_SERVER_SERVICE_WORLD_STATE_MANAGER_SUPPRESS:
                serverConfiguration.VRCA_SERVER_SERVICE_WORLD_STATE_MANAGER_SUPPRESS.toString(),

            // Web Babylon JS Client service
            VRCA_SERVER_SERVICE_CLIENT_WEB_BABYLON_JS_CONTAINER_NAME:
                serverConfiguration.VRCA_SERVER_SERVICE_CLIENT_WEB_BABYLON_JS_CONTAINER_NAME,
            VRCA_SERVER_SERVICE_CLIENT_WEB_BABYLON_JS_HOST_CONTAINER_BIND_EXTERNAL:
                serverConfiguration.VRCA_SERVER_SERVICE_CLIENT_WEB_BABYLON_JS_HOST_CONTAINER_BIND_EXTERNAL,
            VRCA_SERVER_SERVICE_CLIENT_WEB_BABYLON_JS_PORT_CONTAINER_BIND_EXTERNAL:
                serverConfiguration.VRCA_SERVER_SERVICE_CLIENT_WEB_BABYLON_JS_PORT_CONTAINER_BIND_EXTERNAL.toString(),
            VRCA_CLIENT_WEB_BABYLON_JS_DEBUG:
                clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG.toString(),
            VRCA_CLIENT_WEB_BABYLON_JS_SUPPRESS:
                clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_SUPPRESS.toString(),
            VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN:
                clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN,
            VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN_PROVIDER:
                clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN_PROVIDER,
            VRCA_CLIENT_WEB_BABYLON_JS_META_TITLE_BASE:
                clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_META_TITLE_BASE,
            VRCA_CLIENT_WEB_BABYLON_JS_META_DESCRIPTION:
                clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_META_DESCRIPTION,
            VRCA_CLIENT_WEB_BABYLON_JS_META_OG_IMAGE:
                clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_META_OG_IMAGE,
            VRCA_CLIENT_WEB_BABYLON_JS_META_OG_TYPE:
                clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_META_OG_TYPE,
            VRCA_CLIENT_WEB_BABYLON_JS_META_FAVICON:
                clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_META_FAVICON,
            VRCA_CLIENT_WEB_BABYLON_JS_APP_URL:
                clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_APP_URL,
            VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_WS_URI:
                clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_WS_URI,
            VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_WS_URI_USING_SSL:
                clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_WS_URI_USING_SSL.toString(),
            VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_REST_AUTH_URI:
                clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_REST_AUTH_URI,
            VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_REST_AUTH_URI_USING_SSL:
                clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_REST_AUTH_URI_USING_SSL.toString(),
            VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_REST_ASSET_URI:
                clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_REST_ASSET_URI,
            VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_REST_ASSET_URI_USING_SSL:
                clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_REST_ASSET_URI_USING_SSL.toString(),
            VRCA_CLIENT_WEB_BABYLON_JS_PROD_HOST:
                clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_PROD_HOST,
            VRCA_CLIENT_WEB_BABYLON_JS_PROD_PORT:
                clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_PROD_PORT.toString(),
            VRCA_CLIENT_WEB_BABYLON_JS_DEV_HOST:
                clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEV_HOST,
            VRCA_CLIENT_WEB_BABYLON_JS_DEV_PORT:
                clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEV_PORT.toString(),
        };

        // Construct the command
        let dockerArgs = [
            "docker",
            "compose",
            "-f",
            SERVER_DOCKER_COMPOSE_FILE,
        ];

        dockerArgs = [...dockerArgs, ...args];

        BunLogModule({
            prefix: "Docker Command",
            message: dockerArgs.join(" "),
            type: "debug",
            suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
            debug: cliConfiguration.VRCA_CLI_DEBUG,
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
                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                debug: cliConfiguration.VRCA_CLI_DEBUG,
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
                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                debug: cliConfiguration.VRCA_CLI_DEBUG,
            });
        }

        const exitCode = spawnedProcess.exitCode;

        const isExpectedOutput =
            args.includes("down") ||
            args.includes("up") ||
            (args.includes("exec") && !throwOnNonZeroExec);
        if (exitCode !== 0 && !isExpectedOutput) {
            throw new Error(
                `SERVER Docker command failed with exit code ${exitCode}.\nStdout: ${stdout}\nStderr: ${stderr}`,
            );
        }
    }

    export async function printEgressInfo(): Promise<void> {
        const apiWsHostExternal =
            (await EnvManager.getVariable(
                "VRCA_SERVER_SERVICE_WORLD_API_WS_MANAGER_HOST_CONTAINER_BIND_EXTERNAL",
                "cli",
            )) ||
            process.env
                .VRCA_SERVER_SERVICE_WORLD_API_WS_MANAGER_HOST_CONTAINER_BIND_EXTERNAL ||
            serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_WS_MANAGER_HOST_CONTAINER_BIND_EXTERNAL;

        const apiWsPortExternal =
            (await EnvManager.getVariable(
                "VRCA_SERVER_SERVICE_WORLD_API_WS_MANAGER_PORT_CONTAINER_BIND_EXTERNAL",
                "cli",
            )) ||
            process.env
                .VRCA_SERVER_SERVICE_WORLD_API_WS_MANAGER_PORT_CONTAINER_BIND_EXTERNAL ||
            serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_WS_MANAGER_PORT_CONTAINER_BIND_EXTERNAL.toString();

        const apiAuthHostExternal =
            (await EnvManager.getVariable(
                "VRCA_SERVER_SERVICE_WORLD_API_REST_AUTH_MANAGER_HOST_CONTAINER_BIND_EXTERNAL",
                "cli",
            )) ||
            process.env
                .VRCA_SERVER_SERVICE_WORLD_API_REST_AUTH_MANAGER_HOST_CONTAINER_BIND_EXTERNAL ||
            serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_AUTH_MANAGER_HOST_CONTAINER_BIND_EXTERNAL;

        const apiAuthPortExternal =
            (await EnvManager.getVariable(
                "VRCA_SERVER_SERVICE_WORLD_API_REST_AUTH_MANAGER_PORT_CONTAINER_BIND_EXTERNAL",
                "cli",
            )) ||
            process.env
                .VRCA_SERVER_SERVICE_WORLD_API_REST_AUTH_MANAGER_PORT_CONTAINER_BIND_EXTERNAL ||
            serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_AUTH_MANAGER_PORT_CONTAINER_BIND_EXTERNAL.toString();

        const apiAssetHostExternal =
            (await EnvManager.getVariable(
                "VRCA_SERVER_SERVICE_WORLD_API_REST_ASSET_MANAGER_HOST_CONTAINER_BIND_EXTERNAL",
                "cli",
            )) ||
            process.env
                .VRCA_SERVER_SERVICE_WORLD_API_REST_ASSET_MANAGER_HOST_CONTAINER_BIND_EXTERNAL ||
            serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_ASSET_MANAGER_HOST_CONTAINER_BIND_EXTERNAL;

        const apiAssetPortExternal =
            (await EnvManager.getVariable(
                "VRCA_SERVER_SERVICE_WORLD_API_REST_ASSET_MANAGER_PORT_CONTAINER_BIND_EXTERNAL",
                "cli",
            )) ||
            process.env
                .VRCA_SERVER_SERVICE_WORLD_API_REST_ASSET_MANAGER_PORT_CONTAINER_BIND_EXTERNAL ||
            serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_ASSET_MANAGER_PORT_CONTAINER_BIND_EXTERNAL.toString();
            
        const appHostExternal =
            (await EnvManager.getVariable(
                "VRCA_SERVER_SERVICE_CLIENT_WEB_BABYLON_JS_HOST_CONTAINER_BIND_EXTERNAL",
                "cli",
            )) ||
            process.env
                .VRCA_SERVER_SERVICE_CLIENT_WEB_BABYLON_JS_HOST_CONTAINER_BIND_EXTERNAL ||
            serverConfiguration.VRCA_SERVER_SERVICE_CLIENT_WEB_BABYLON_JS_HOST_CONTAINER_BIND_EXTERNAL;


        const appPortExternal =
            (await EnvManager.getVariable(
                "VRCA_SERVER_SERVICE_CLIENT_WEB_BABYLON_JS_PORT_CONTAINER_BIND_EXTERNAL",
                "cli",
            )) ||
            process.env
                .VRCA_SERVER_SERVICE_CLIENT_WEB_BABYLON_JS_PORT_CONTAINER_BIND_EXTERNAL ||
            serverConfiguration.VRCA_SERVER_SERVICE_CLIENT_WEB_BABYLON_JS_PORT_CONTAINER_BIND_EXTERNAL.toString();

        const apiWsUpstream = `${apiWsHostExternal}:${apiWsPortExternal}`;
        const apiAuthUpstream = `${apiAuthHostExternal}:${apiAuthPortExternal}`;
        const apiAssetUpstream = `${apiAssetHostExternal}:${apiAssetPortExternal}`;
        const appUpstream = `${appHostExternal}:${appPortExternal}`;

        BunLogModule({
            message: "Reverse proxy egress points (what to proxy):",
            type: "info",
            suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
            debug: cliConfiguration.VRCA_CLI_DEBUG,
        });

        console.log(`\nHost-published endpoints (for proxies on the host):`);
        console.log(
            `  API WS Manager:  http://${apiWsHostExternal}:${apiWsPortExternal}`,
        );
        console.log(
            `  API REST Auth Manager:  http://${apiAuthHostExternal}:${apiAuthPortExternal}`,
        );
        console.log(
            `  API REST Asset Manager:  http://${apiAssetHostExternal}:${apiAssetPortExternal}`,
        );
        console.log(
            `  Web Babylon.js Client App:   http://${appHostExternal}:${appPortExternal}`,
        );

        console.log(`\nDocker network upstreams (for proxies inside Docker):`);
        console.log(`  API WS Manager:  ${apiWsUpstream}`);
        console.log(`  API REST Auth Manager:  ${apiAuthUpstream}`);
        console.log(`  API REST Asset Manager:  ${apiAssetUpstream}`);
        console.log(`  Web Babylon.js Client App:   ${appUpstream}`);
    }

    export async function isPostgresHealthy(
        wait?: { interval: number; timeout: number } | boolean,
    ): Promise<{
        isHealthy: boolean;
        error?: Error;
    }> {
        async function isContainerHealthyByDocker(
            containerName: string,
        ): Promise<{ isHealthy: boolean; error?: Error }> {
            try {
                const proc = Bun.spawn(["docker", "inspect", containerName], {
                    stdout: "pipe",
                    stderr: "pipe",
                });
                const stdout = await new Response(proc.stdout).text();
                const stderr = await new Response(proc.stderr).text();
                if (proc.exitCode !== 0) {
                    return {
                        isHealthy: false,
                        error: new Error(
                            `docker inspect failed (${proc.exitCode}): ${stderr || "no stderr"}`,
                        ),
                    };
                }
                const info = JSON.parse(stdout);
                const state = Array.isArray(info) ? info[0]?.State : info?.State;
                const status: string | undefined = state?.Health?.Status;
                if (status === "healthy") {
                    return { isHealthy: true };
                }
                return {
                    isHealthy: false,
                    error: new Error(
                        `container health: ${status ?? "unknown"} (state: ${state?.Status ?? "unknown"})`,
                    ),
                };
            } catch (error) {
                return { isHealthy: false, error: error as Error };
            }
        }

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
            const containerName =
                serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_CONTAINER_NAME;
            return await isContainerHealthyByDocker(containerName);
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

    export async function isPostgresDbReady(
        wait?: { interval: number; timeout: number } | boolean,
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

        const checkDbReady = async (): Promise<{
            isHealthy: boolean;
            error?: Error;
        }> => {
            try {
                const db = BunPostgresClientModule.getInstance({
                    debug: cliConfiguration.VRCA_CLI_DEBUG,
                    suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                });
                const sql = await db.getSuperClient({
                    postgres: {
                        host: cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_HOST,
                        port: cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_PORT,
                        database:
                            cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_DATABASE,
                        username:
                            cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_USERNAME,
                        password:
                            cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
                    },
                });

                // Minimal check that succeeds pre-migration
                await sql`SELECT 1`;
                return { isHealthy: true };
            } catch (error) {
                return { isHealthy: false, error: error as Error };
            }
        };

        if (!waitConfig) {
            return await checkDbReady();
        }

        const startTime = Date.now();
        let lastError: Error | undefined;
        while (Date.now() - startTime < waitConfig.timeout) {
            const result = await checkDbReady();
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
            const containerName =
                serverConfiguration.VRCA_SERVER_SERVICE_PGWEB_CONTAINER_NAME;
            return await isContainerHealthyByDocker(containerName);
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

    export async function markDatabaseAsReady(): Promise<void> {
        const db = BunPostgresClientModule.getInstance({
            debug: cliConfiguration.VRCA_CLI_DEBUG,
            suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
        });
        const sql = await db.getSuperClient({
            postgres: {
                host: cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_HOST,
                port: cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_PORT,
                database: cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_DATABASE,
                username:
                    cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_USERNAME,
                password:
                    cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
            },
        });

        // Set the setup timestamp to now() in the config.database_config table
        await sql`
            UPDATE config.database_config
            SET database_config__setup_timestamp = NOW()
        `;
    }

    export async function isWorldApiWsManagerHealthy(
        wait?:
            | {
                  interval: number;
                  timeout: number;
              }
            | boolean,
    ): Promise<{
        isHealthy: boolean;
        error?: Error;
        waitConfig?: {
            interval: number;
            timeout: number;
        };
    }> {
        const defaultWait = { interval: 100, timeout: 10000 };

        const waitConfig =
            wait === true
                ? defaultWait
                : wait && typeof wait !== "boolean"
                  ? wait
                  : null;

        const checkWorldApiWsManager = async (): Promise<{
            isHealthy: boolean;
            error?: Error;
        }> => {
            const containerName =
                serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_WS_MANAGER_CONTAINER_NAME;
            return await isContainerHealthyByDocker(containerName);
        };

        // If waiting is not enabled, just check once
        if (!waitConfig) {
            return await checkWorldApiWsManager();
        }

        // With waiting enabled, retry until timeout
        const startTime = Date.now();
        let lastError: Error | undefined;

        while (Date.now() - startTime < waitConfig.timeout) {
            const result = await checkWorldApiWsManager();
            if (result.isHealthy) {
                return result;
            }
            lastError = result.error;
            await Bun.sleep(waitConfig.interval);
        }

        return {
            isHealthy: false,
            error: lastError,
            waitConfig: waitConfig,
        };
    }

    export async function isWorldApiRestAuthManagerHealthy( 
        wait?:
            | {
                  interval: number;
                  timeout: number;
              }
            | boolean,
    ): Promise<{
        isHealthy: boolean;
        error?: Error;
        waitConfig?: {
            interval: number;
            timeout: number;
        };
    }> {

        const defaultWait = { interval: 100, timeout: 10000 };

        const waitConfig =
            wait === true
                ? defaultWait
                : wait && typeof wait !== "boolean"
                  ? wait
                  : null;

        const checkWorldApiRestAuthManager = async (): Promise<{
            isHealthy: boolean;
            error?: Error;
        }> => {
            const containerName =
                serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_AUTH_MANAGER_CONTAINER_NAME;
            return await isContainerHealthyByDocker(containerName);
        };

        // If waiting is not enabled, just check once
        if (!waitConfig) {
            return await checkWorldApiRestAuthManager();
        }

        // With waiting enabled, retry until timeout
        const startTime = Date.now();
        let lastError: Error | undefined;

        while (Date.now() - startTime < waitConfig.timeout) {
            const result = await checkWorldApiRestAuthManager();
            if (result.isHealthy) {
                return result;
            }
            lastError = result.error;
            await Bun.sleep(waitConfig.interval);
        }

        return {
            isHealthy: false,
            error: lastError,
            waitConfig: waitConfig,
        };
    }

    export async function isWorldApiRestAssetManagerHealthy(
        wait?:
            | {
                  interval: number;
                  timeout: number;
              }
            | boolean,
    ): Promise<{
        isHealthy: boolean;
        error?: Error;
        waitConfig?: {
            interval: number;
            timeout: number;
        };
    }> {

        const defaultWait = { interval: 100, timeout: 10000 };

        const waitConfig =
            wait === true
                ? defaultWait
                : wait && typeof wait !== "boolean"
                  ? wait
                  : null;

        const checkWorldApiRestAssetManager = async (): Promise<{
            isHealthy: boolean;
            error?: Error;
        }> => {
            const containerName =
                serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_ASSET_MANAGER_CONTAINER_NAME;
            return await isContainerHealthyByDocker(containerName);
        };

        // If waiting is not enabled, just check once
        if (!waitConfig) {
            return await checkWorldApiRestAssetManager();
        }

        // With waiting enabled, retry until timeout
        const startTime = Date.now();
        let lastError: Error | undefined;

        while (Date.now() - startTime < waitConfig.timeout) {
            const result = await checkWorldApiRestAssetManager();
            if (result.isHealthy) {
                return result;
            }
            lastError = result.error;
            await Bun.sleep(waitConfig.interval);
        }

        return {
            isHealthy: false,
            error: lastError,
            waitConfig: waitConfig,
        };
    }   

    export async function isWorldStateManagerHealthy(
        wait?:
            | {
                  interval: number;
                  timeout: number;
              }
            | boolean,
    ): Promise<{
        isHealthy: boolean;
        error?: Error;
        waitConfig?: {
            interval: number;
            timeout: number;
        };
    }> {
        const defaultWait = { interval: 100, timeout: 10000 };

        const waitConfig =
            wait === true
                ? defaultWait
                : wait && typeof wait !== "boolean"
                  ? wait
                  : null;

        const checkWorldStateManager = async (): Promise<{
            isHealthy: boolean;
            error?: Error;
        }> => {
            const containerName =
                serverConfiguration.VRCA_SERVER_SERVICE_WORLD_STATE_MANAGER_CONTAINER_NAME;
            return await isContainerHealthyByDocker(containerName);
        };

        // If waiting is not enabled, just check once
        if (!waitConfig) {
            return await checkWorldStateManager();
        }

        // With waiting enabled, retry until timeout
        const startTime = Date.now();
        let lastError: Error | undefined;

        while (Date.now() - startTime < waitConfig.timeout) {
            const result = await checkWorldStateManager();
            if (result.isHealthy) {
                return result;
            }
            lastError = result.error;
            await Bun.sleep(waitConfig.interval);
        }

        return {
            isHealthy: false,
            error: lastError,
            waitConfig: waitConfig,
        };
    }

    export async function isClientWebBabylonJsHealthy(
        wait?:
            | {
                  interval: number;
                  timeout: number;
              }
            | boolean,
    ): Promise<{
        isHealthy: boolean;
        error?: Error;
        waitConfig?: {
            interval: number;
            timeout: number;
        };
    }> {
        const defaultWait = { interval: 100, timeout: 10000 };

        const waitConfig =
            wait === true
                ? defaultWait
                : wait && typeof wait !== "boolean"
                  ? wait
                  : null;

        const checkClientWebBabylonJs = async (): Promise<{
            isHealthy: boolean;
            error?: Error;
        }> => {
            const containerName =
                serverConfiguration.VRCA_SERVER_SERVICE_CLIENT_WEB_BABYLON_JS_CONTAINER_NAME;
            return await isContainerHealthyByDocker(containerName);
        };

        if (!waitConfig) {
            return await checkClientWebBabylonJs();
        }

        const startTime = Date.now();
        let lastError: Error | undefined;

        while (Date.now() - startTime < waitConfig.timeout) {
            const result = await checkClientWebBabylonJs();
            if (result.isHealthy) {
                return result;
            }
            lastError = result.error;
            await Bun.sleep(waitConfig.interval);
        }

        return {
            isHealthy: false,
            error: lastError,
            waitConfig: waitConfig,
        };
    }

    export async function isCaddyHealthy(
        wait?:
            | {
                  interval: number;
                  timeout: number;
              }
            | boolean,
    ): Promise<{
        isHealthy: boolean;
        error?: Error;
        waitConfig?: {
            interval: number;
            timeout: number;
        };
    }> {
        const defaultWait = { interval: 100, timeout: 10000 };

        const waitConfig =
            wait === true
                ? defaultWait
                : wait && typeof wait !== "boolean"
                  ? wait
                  : null;

        const checkCaddy = async (): Promise<{
            isHealthy: boolean;
            error?: Error;
        }> => {
            const containerName =
                serverConfiguration.VRCA_SERVER_SERVICE_CADDY_CONTAINER_NAME;
            return await isContainerHealthyByDocker(containerName);
        };

        if (!waitConfig) {
            return await checkCaddy();
        }

        const startTime = Date.now();
        let lastError: Error | undefined;

        while (Date.now() - startTime < waitConfig.timeout) {
            const result = await checkCaddy();
            if (result.isHealthy) {
                return result;
            }
            lastError = result.error;
            await Bun.sleep(waitConfig.interval);
        }

        return {
            isHealthy: false,
            error: lastError,
            waitConfig: waitConfig,
        };
    }

    export async function wipeDatabase() {
        const db = BunPostgresClientModule.getInstance({
            debug: cliConfiguration.VRCA_CLI_DEBUG,
            suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
        });
        const sql = await db.getSuperClient({
            postgres: {
                host: cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_HOST,
                port: cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_PORT,
                database: cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_DATABASE,
                username:
                    cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_USERNAME,
                password:
                    cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
            },
        });

        try {
            // Use hardcoded system reset directory
            const systemResetDir = SYSTEM_RESET_DIR;
            const userResetDir =
                cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_RESET_USER_DIR;

            // Process system reset files
            let systemResetFiles: string[] = [];
            if (systemResetDir) {
                try {
                    systemResetFiles = await readdir(systemResetDir, {
                        recursive: true,
                    });

                    if (systemResetFiles.length === 0) {
                        BunLogModule({
                            message: `No system reset files found in ${systemResetDir}`,
                            type: "debug",
                            suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                            debug: cliConfiguration.VRCA_CLI_DEBUG,
                        });
                    }
                } catch (error) {
                    BunLogModule({
                        message: `Error accessing system reset directory: ${systemResetDir}`,
                        type: "warn",
                        error,
                        suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                        debug: cliConfiguration.VRCA_CLI_DEBUG,
                    });
                }
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
                            suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                            debug: cliConfiguration.VRCA_CLI_DEBUG,
                        });
                    }
                } catch (error) {
                    BunLogModule({
                        message: `Error accessing user reset directory: ${userResetDir}`,
                        type: "warn",
                        error,
                        suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                        debug: cliConfiguration.VRCA_CLI_DEBUG,
                    });
                }
            } else {
                BunLogModule({
                    message: "User reset directory not configured",
                    type: "debug",
                    suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                    debug: cliConfiguration.VRCA_CLI_DEBUG,
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
                    suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                    debug: cliConfiguration.VRCA_CLI_DEBUG,
                });
            }

            // Run pending migrations
            for (const file of resetSqlFiles) {
                try {
                    // Determine the correct directory for the file
                    const isUserResetFile = userResetFiles.includes(file);
                    const isSystemResetFile = systemResetFiles.includes(file);
                    const fileDir =
                        isUserResetFile && userResetDir
                            ? userResetDir
                            : isSystemResetFile && systemResetDir
                              ? systemResetDir
                              : null;
                    if (!fileDir) {
                        continue;
                    }
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
                        suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                        debug: cliConfiguration.VRCA_CLI_DEBUG,
                    });
                } catch (error) {
                    BunLogModule({
                        message: `Failed to run reset ${file}.`,
                        type: "error",
                        error: error,
                        suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                        debug: cliConfiguration.VRCA_CLI_DEBUG,
                    });
                    throw error;
                }
            }
        } catch (error) {
            BunLogModule({
                message: `Database reset failed: ${error}`,
                type: "error",
                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                debug: cliConfiguration.VRCA_CLI_DEBUG,
            });
            throw error;
        }
    }

    export async function migrate(): Promise<boolean> {
        const db = BunPostgresClientModule.getInstance({
            debug: cliConfiguration.VRCA_CLI_DEBUG,
            suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
        });
        const sql = await db.getSuperClient({
            postgres: {
                host: cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_HOST,
                port: cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_PORT,
                database: cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_DATABASE,
                username:
                    cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_USERNAME,
                password:
                    cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
            },
        });

        let migrationsRan = false;

        for (const name of serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_EXTENSIONS.split(",")) {
            BunLogModule({
                message: `Installing PostgreSQL extension: ${name}...`,
                type: "debug",
                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                debug: cliConfiguration.VRCA_CLI_DEBUG,
            });
            await sql`CREATE EXTENSION IF NOT EXISTS ${sql(name)};`;
            BunLogModule({
                message: `PostgreSQL extension ${name} installed successfully`,
                type: "debug",
                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                debug: cliConfiguration.VRCA_CLI_DEBUG,
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
            MIGRATION_DIR,
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
            suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
            debug: cliConfiguration.VRCA_CLI_DEBUG,
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
                        MIGRATION_DIR,
                        file,
                    );
                    const sqlContent = await readFile(filePath, "utf-8");

                    BunLogModule({
                        message: `Executing migration ${file}...`,
                        type: "debug",
                        suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                        debug: cliConfiguration.VRCA_CLI_DEBUG,
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
                        suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                        debug: cliConfiguration.VRCA_CLI_DEBUG,
                    });
                } catch (error) {
                    BunLogModule({
                        message: `Failed to run migration ${file}.`,
                        type: "error",
                        error: error,
                        suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                        debug: cliConfiguration.VRCA_CLI_DEBUG,
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
            debug: cliConfiguration.VRCA_CLI_DEBUG,
            suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
        });
        const sql = await db.getSuperClient({
            postgres: {
                host: cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_HOST,
                port: cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_PORT,
                database: cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_DATABASE,
                username:
                    cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_USERNAME,
                password:
                    cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
            },
        });

        // Use hardcoded system SQL directory
        const systemSqlDir = SYSTEM_SQL_DIR;

        const userSqlDir =
            cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_SEED_USER_SQL_DIR;

        try {
            // Get already executed seeds - querying by hash
            const result =
                await sql`SELECT general__hash, general__name FROM config.seeds`;
            const executedHashes = new Set(result.map((r: any) => r.general__hash));
            const executedNames = new Map(
                result.map((r: any) => [r.general__name, r.general__hash]),
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
                        suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                        debug: cliConfiguration.VRCA_CLI_DEBUG,
                    });
                } catch (error) {
                    BunLogModule({
                        message: `No system SQL seed files found or error accessing directory: ${systemSqlDir}`,
                        type: "warn",
                        error,
                        suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                        debug: cliConfiguration.VRCA_CLI_DEBUG,
                    });
                }
            } else {
                BunLogModule({
                    message: "System SQL directory not configured",
                    type: "warn",
                    suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                    debug: cliConfiguration.VRCA_CLI_DEBUG,
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
                        suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                        debug: cliConfiguration.VRCA_CLI_DEBUG,
                    });
                } catch (error) {
                    BunLogModule({
                        message: `No user SQL seed files found or error accessing directory: ${userSqlDir}`,
                        type: "warn",
                        error,
                        suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                        debug: cliConfiguration.VRCA_CLI_DEBUG,
                    });
                }
            } else {
                BunLogModule({
                    message: "User SQL directory not configured",
                    type: "warn",
                    suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                    debug: cliConfiguration.VRCA_CLI_DEBUG,
                });
            }

            if (systemSqlFiles.length === 0 && userSqlFiles.length === 0) {
                BunLogModule({
                    message: `No SQL seed files found in either ${systemSqlDir || "undefined"} or ${userSqlDir || "undefined"}`,
                    type: "info",
                    suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                    debug: cliConfiguration.VRCA_CLI_DEBUG,
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
                    suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                    debug: cliConfiguration.VRCA_CLI_DEBUG,
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
                            suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                            debug: cliConfiguration.VRCA_CLI_DEBUG,
                        });
                    }

                    BunLogModule({
                        message: `Executing seed ${sqlFile} (hash: ${content_hash})...`,
                        type: "debug",
                        suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                        debug: cliConfiguration.VRCA_CLI_DEBUG,
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
                            suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                            debug: cliConfiguration.VRCA_CLI_DEBUG,
                        });
                    } catch (error) {
                        BunLogModule({
                            message: `Failed to run seed ${sqlFile}`,
                            data: {
                                directory,
                            },
                            type: "error",
                            error: error,
                            suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                            debug: cliConfiguration.VRCA_CLI_DEBUG,
                        });
                        throw error;
                    }
                } else {
                    BunLogModule({
                        message: `Seed ${sqlFile} already executed`,
                        type: "debug",
                        suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                        debug: cliConfiguration.VRCA_CLI_DEBUG,
                    });
                }
            }

            BunLogModule({
                message: "SQL seeding completed successfully",
                data: {
                    "System SQL Files": systemSqlFiles.length,
                    "User SQL Files": userSqlFiles.length,
                    "Total SQL Files":
                        systemSqlFiles.length + userSqlFiles.length,
                },
                type: "success",
                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                debug: cliConfiguration.VRCA_CLI_DEBUG,
            });
        } catch (error) {
            BunLogModule({
                message: `Error processing SQL seed files: ${error instanceof Error ? error.message : String(error)}`,
                type: "error",
                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                debug: cliConfiguration.VRCA_CLI_DEBUG,
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
            debug: cliConfiguration.VRCA_CLI_DEBUG,
            suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
        });
        const sql = await db.getSuperClient({
            postgres: {
                host: cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_HOST,
                port: cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_PORT,
                database: cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_DATABASE,
                username:
                    cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_USERNAME,
                password:
                    cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
            },
        });

        // Use hardcoded system asset directory
        const systemAssetDir = SYSTEM_ASSET_DIR;
        const userAssetDir =
            cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_SEED_USER_ASSET_DIR;

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
                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                debug: cliConfiguration.VRCA_CLI_DEBUG,
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
                        suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                        debug: cliConfiguration.VRCA_CLI_DEBUG,
                    });
                } catch (error) {
                    BunLogModule({
                        message: `No system asset files found or error accessing directory: ${systemAssetDir}`,
                        type: "warn",
                        error,
                        suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                        debug: cliConfiguration.VRCA_CLI_DEBUG,
                    });
                }
            } else {
                BunLogModule({
                    message: "System asset directory not configured",
                    type: "warn",
                    suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                    debug: cliConfiguration.VRCA_CLI_DEBUG,
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
                        suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                        debug: cliConfiguration.VRCA_CLI_DEBUG,
                    });
                } catch (error) {
                    BunLogModule({
                        message: `No user asset files found or error accessing directory: ${userAssetDir}`,
                        type: "warn",
                        error,
                        suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                        debug: cliConfiguration.VRCA_CLI_DEBUG,
                    });
                }
            } else {
                BunLogModule({
                    message: "User asset directory not configured",
                    type: "warn",
                    suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                    debug: cliConfiguration.VRCA_CLI_DEBUG,
                });
            }

            if (
                filesInSystemAssetDir.length === 0 &&
                filesInUserAssetDir.length === 0
            ) {
                BunLogModule({
                    message: `No asset files found in either ${systemAssetDir || "undefined"} or ${userAssetDir || "undefined"}`,
                    type: "info",
                    suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                    debug: cliConfiguration.VRCA_CLI_DEBUG,
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
                        suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                        debug: cliConfiguration.VRCA_CLI_DEBUG,
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
            }: {
                fileName: string;
                searchName: string;
                directory: string;
            }) => {
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
                            suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                            debug: cliConfiguration.VRCA_CLI_DEBUG,
                        });
                    } catch (error) {
                        BunLogModule({
                            message: `Failed to add new asset to database: ${searchName}`,
                            type: "error",
                            error: error,
                            suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                            debug: cliConfiguration.VRCA_CLI_DEBUG,
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

                            BunLogModule({
                                message: `Updated asset in database: ${dbAsset.general__asset_file_name}`,
                                type: "debug",
                                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                                debug: cliConfiguration.VRCA_CLI_DEBUG,
                            });
                        }
                    });

                    BunLogModule({
                        message: `Updated ${matchingAssets.length} assets from file ${fileName}`,
                        type: "debug",
                        suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                        debug: cliConfiguration.VRCA_CLI_DEBUG,
                    });
                } catch (error) {
                    BunLogModule({
                        message: `Failed to update assets from file ${fileName}`,
                        type: "error",
                        error: error,
                        suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                        debug: cliConfiguration.VRCA_CLI_DEBUG,
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
                data: {
                    "System Assets": systemAssetFileNames.length,
                    "User Assets": userAssetFileNames.length,
                    "Total Assets": allAssetFileNames.length,
                },
                type: "success",
                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                debug: cliConfiguration.VRCA_CLI_DEBUG,
            });
        } catch (error) {
            BunLogModule({
                message: `Error processing asset files: ${error instanceof Error ? error.message : String(error)}`,
                type: "error",
                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                debug: cliConfiguration.VRCA_CLI_DEBUG,
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
            debug: cliConfiguration.VRCA_CLI_DEBUG,
            suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
        });
        const sql = await db.getSuperClient({
            postgres: {
                host: cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_HOST,
                port: cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_PORT,
                database: cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_DATABASE,
                username:
                    cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_USERNAME,
                password:
                    cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
            },
        });

        // Get auth provider settings for the system provider
        const [providerConfig] = await sql<
            [
                {
                    provider__jwt_secret: string;
                    provider__session_duration_ms: number;
                    provider__default_permissions__can_read: string[];
                    provider__default_permissions__can_insert: string[];
                    provider__default_permissions__can_update: string[];
                    provider__default_permissions__can_delete: string[];
                },
            ]
        >`
            SELECT provider__jwt_secret, 
                   provider__session_duration_ms,
                   provider__default_permissions__can_read,
                   provider__default_permissions__can_insert,
                   provider__default_permissions__can_update,
                   provider__default_permissions__can_delete
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

        // Manually assign permissions to system agent for all sync groups (system provider defaults)
        await sql`
            INSERT INTO auth.agent_sync_group_roles (
                auth__agent_id,
                group__sync,
                permissions__can_read,
                permissions__can_insert,
                permissions__can_update,
                permissions__can_delete
            ) VALUES
                (${systemAgentId}, 'public.REALTIME', true, true, true, true),
                (${systemAgentId}, 'public.NORMAL', true, true, true, true),
                (${systemAgentId}, 'public.BACKGROUND', true, true, true, true),
                (${systemAgentId}, 'public.STATIC', true, true, true, true)
            ON CONFLICT (auth__agent_id, group__sync)
            DO UPDATE SET
                permissions__can_read = true,
                permissions__can_insert = true,
                permissions__can_update = true,
                permissions__can_delete = true
        `;

        return {
            token,
            sessionId: sessionResult.general__session_id,
            agentId: systemAgentId,
        };
    }

    export async function invalidateDbSystemTokens(): Promise<number> {
        const db = BunPostgresClientModule.getInstance({
            debug: cliConfiguration.VRCA_CLI_DEBUG,
            suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
        });
        const sql = await db.getSuperClient({
            postgres: {
                host: cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_HOST,
                port: cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_PORT,
                database: cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_DATABASE,
                username:
                    cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_USERNAME,
                password:
                    cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
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
        return `postgres://${cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_USERNAME}:${cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_PASSWORD}@${cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_HOST}:${cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_PORT}/${cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_DATABASE}`;
    }

    export async function generatePgwebAccessURL(): Promise<string> {
        // Fall back to server config for host-published PGWEB address
        return `http://${serverConfiguration.VRCA_SERVER_SERVICE_PGWEB_HOST_CONTAINER_BIND_EXTERNAL}:${serverConfiguration.VRCA_SERVER_SERVICE_PGWEB_PORT_CONTAINER_BIND_EXTERNAL}`;
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
            cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_SYNC_ASSET_DIR;

        if (!outputDir) {
            throw new Error("Output directory not configured");
        }

        const db = BunPostgresClientModule.getInstance({
            debug: cliConfiguration.VRCA_CLI_DEBUG,
            suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
        });
        const sql = await db.getSuperClient({
            postgres: {
                host: cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_HOST,
                port: cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_PORT,
                database: cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_DATABASE,
                username:
                    cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_USERNAME,
                password:
                    cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
            },
        });

        BunLogModule({
            message: `Starting asset download to ${outputDir}...`,
            type: "info",
            suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
            debug: cliConfiguration.VRCA_CLI_DEBUG,
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
                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                debug: cliConfiguration.VRCA_CLI_DEBUG,
            });

            // Function to process a single asset
            const processAsset = async (asset: Pick<Entity.Asset.I_Asset, "general__asset_file_name" | "asset__data__bytea" | "asset__mime_type">) => {
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
                        let buffer: Buffer;
                        if (asset.asset__data__bytea instanceof ArrayBuffer) {
                            buffer = Buffer.from(asset.asset__data__bytea);
                        } else {
                            buffer = Buffer.from(asset.asset__data__bytea as Buffer);
                        }
                        await writeFile(filePath, buffer);

                        BunLogModule({
                            message: `Downloaded asset: ${fileName}`,
                            type: "debug",
                            suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                            debug: cliConfiguration.VRCA_CLI_DEBUG,
                        });
                    } else {
                        BunLogModule({
                            message: `No binary data for asset: ${fileName}`,
                            type: "warn",
                            suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                            debug: cliConfiguration.VRCA_CLI_DEBUG,
                        });
                    }
                } catch (error) {
                    BunLogModule({
                        message: `Error downloading asset: ${asset.general__asset_file_name}`,
                        type: "error",
                        error,
                        suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                        debug: cliConfiguration.VRCA_CLI_DEBUG,
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
                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                debug: cliConfiguration.VRCA_CLI_DEBUG,
            });
        } catch (error) {
            BunLogModule({
                message: "Error downloading assets from database",
                type: "error",
                error,
                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                debug: cliConfiguration.VRCA_CLI_DEBUG,
            });
        }
    }

    export async function backupDatabase() {
        // Config values - ensure these are correctly loaded from your config setup
        const dbUser =
            cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_USERNAME;
        const dbName = cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_DATABASE;
        const backupFilePathHost =
            cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_BACKUP_FILE; // Path on the host machine where the backup will be saved
        const containerName =
            serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_CONTAINER_NAME;

        try {
            // Ensure backup directory exists on host
            const backupDir = path.dirname(backupFilePathHost);
            if (!existsSync(backupDir)) {
                mkdirSync(backupDir, { recursive: true });
                BunLogModule({
                    message: `Created backup directory: ${backupDir}`,
                    type: "info",
                    suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                    debug: cliConfiguration.VRCA_CLI_DEBUG,
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
                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                debug: cliConfiguration.VRCA_CLI_DEBUG,
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
                    suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                    debug: cliConfiguration.VRCA_CLI_DEBUG,
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
                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                debug: cliConfiguration.VRCA_CLI_DEBUG,
            });
            throw error;
        }
    }

    // Restore database from backup file
    export async function restoreDatabase() {
        const dbUser =
            cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_USERNAME;
        const dbName = cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_DATABASE;
        const restoreFilePathHost =
            cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_RESTORE_FILE;
        const containerName =
            serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_CONTAINER_NAME;

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
                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                debug: cliConfiguration.VRCA_CLI_DEBUG,
            });

            // Create a read stream from the backup file
            const file = Bun.file(restoreFilePathHost);
            const fileArrayBuffer = await file.arrayBuffer();
            const fileBuffer = Buffer.from(fileArrayBuffer);

            // Use direct Bun.spawn for running docker command with input pipe
            BunLogModule({
                message: "Running pg_restore...",
                type: "debug",
                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                debug: cliConfiguration.VRCA_CLI_DEBUG,
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
                    suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                    debug: cliConfiguration.VRCA_CLI_DEBUG,
                });
            }

            if (stderr) {
                // pg_restore often outputs some warnings that aren't fatal errors
                const isActualError = pgRestoreProcess.exitCode !== 0;
                BunLogModule({
                    prefix: "pg_restore Output",
                    message: stderr,
                    type: isActualError ? "error" : "warn",
                    suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                    debug: cliConfiguration.VRCA_CLI_DEBUG,
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
                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                debug: cliConfiguration.VRCA_CLI_DEBUG,
            });
            throw error;
        }
    }
}


// No dedicated rebuild helper: we run `bun run server:rebuild-all` in current working directory

// Helper: parse --interval, --timeout, --no-wait
function parseWaitFlags(
    args: string[],
): boolean | { interval: number; timeout: number } {
    let wait = true;
    let interval: number | undefined;
    let timeout: number | undefined;

    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === "--no-wait") {
            wait = false;
        } else if (a === "--interval" && i + 1 < args.length) {
            interval = Number.parseInt(args[++i]);
        } else if (a === "--timeout" && i + 1 < args.length) {
            timeout = Number.parseInt(args[++i]);
        }
    }

    if (!wait) {
        return false; // user asked to skip waiting
    }
    if (interval != null && timeout != null) {
        return { interval, timeout };
    }
    return true; // default wait with built-in defaults
}

// Tiny wrapper that does the loop, logs and exits appropriately.
async function runHealthCommand(
    label: string,
    healthFn: (
        wait?: boolean | { interval: number; timeout: number },
    ) => Promise<{
        isHealthy: boolean;
        error?: Error;
        waitConfig?: { interval: number; timeout: number };
    }>,
    args: string[],
) {
    const waitParam = parseWaitFlags(args);
    const health = await healthFn(waitParam);

    BunLogModule({
        message: `${label}: ${health.isHealthy ? "healthy" : "unhealthy"}`,
        data: health,
        type: health.isHealthy ? "success" : "error",
        suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
        debug: cliConfiguration.VRCA_CLI_DEBUG,
    });

    process.exit(health.isHealthy ? 0 : 1);
}

// If this file is run directly
if (import.meta.main) {
    const command = Bun.argv[2];
    const additionalArgs = Bun.argv.slice(3);

    if (!command) {
        BunLogModule({
            message: "No command provided",
            type: "error",
            suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
            debug: cliConfiguration.VRCA_CLI_DEBUG,
        });
        process.exit(1);
    }

    try {
        switch (command) {
            // SERVER CONTAINER HEALTH
            case "server:postgres:health":
                if (
                    additionalArgs.includes("--db") ||
                    additionalArgs.includes("--mode=db")
                ) {
                    await runHealthCommand(
                        "PostgreSQL (DB Ready)",
                        Server_CLI.isPostgresDbReady,
                        additionalArgs,
                    );
                } else {
                    await runHealthCommand(
                        "PostgreSQL (DB Healthy)",
                        Server_CLI.isPostgresHealthy,
                        additionalArgs,
                    );
                }
                break;

            case "server:postgres:mark-as-ready": {
                BunLogModule({
                    message: "Marking database as ready...",
                    type: "info",
                    suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                    debug: cliConfiguration.VRCA_CLI_DEBUG,
                });
                await Server_CLI.markDatabaseAsReady();
                BunLogModule({
                    message: "Database marked as ready.",
                    type: "success",
                    suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                    debug: cliConfiguration.VRCA_CLI_DEBUG,
                });
                break;
            }

            case "server:pgweb:health":
                await runHealthCommand(
                    "PGWEB",
                    Server_CLI.isPgwebHealthy,
                    additionalArgs,
                );
                break;

            case "server:world-api-ws-manager:health":
                await runHealthCommand(
                    "World API WS Manager",
                    Server_CLI.isWorldApiWsManagerHealthy,
                    additionalArgs,
                );
                break;

            case "server:world-api-rest-auth-manager:health":
                await runHealthCommand(
                    "World API REST Auth Manager",
                    Server_CLI.isWorldApiRestAuthManagerHealthy,
                    additionalArgs,
                );
                break;

            case "server:world-api-rest-asset-manager:health":
                await runHealthCommand(
                    "World API REST Asset Manager",
                    Server_CLI.isWorldApiRestAssetManagerHealthy,
                    additionalArgs,
                );
                break;

            case "server:world-state-manager:health":
                await runHealthCommand(
                    "World State Manager",
                    Server_CLI.isWorldStateManagerHealthy,
                    additionalArgs,
                );
                break;

            case "server:client-web-babylon-js:health":
                await runHealthCommand(
                    "Client Web Babylon JS",
                    Server_CLI.isClientWebBabylonJsHealthy,
                    additionalArgs,
                );
                break;

            // SERVER POSTGRES DATABASE COMMANDS
            case "server:postgres:migrate": {
                BunLogModule({
                    message: "Running database migrations...",
                    type: "info",
                    suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                    debug: cliConfiguration.VRCA_CLI_DEBUG,
                });
                await Server_CLI.migrate();
                BunLogModule({
                    message: "Migrations ran successfully",
                    type: "success",
                    suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                    debug: cliConfiguration.VRCA_CLI_DEBUG,
                });
                break;
            }

            case "server:postgres:wipe": {
                BunLogModule({
                    message: "Wiping database...",
                    type: "info",
                    suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                    debug: cliConfiguration.VRCA_CLI_DEBUG,
                });
                await Server_CLI.wipeDatabase();
                BunLogModule({
                    message: "Database wiped",
                    type: "success",
                    suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                    debug: cliConfiguration.VRCA_CLI_DEBUG,
                });
                break;
            }

            case "server:postgres:connection-string": {
                const connectionString =
                    await Server_CLI.generateDbConnectionString();
                BunLogModule({
                    message: `Database connection string:\n[ ${connectionString} ]`,
                    type: "info",
                    suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                    debug: cliConfiguration.VRCA_CLI_DEBUG,
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
                        suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                        debug: cliConfiguration.VRCA_CLI_DEBUG,
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
                        suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                        debug: cliConfiguration.VRCA_CLI_DEBUG,
                    });
                }
                break;
            }

            case "server:postgres:system-token:invalidate-all": {
                BunLogModule({
                    message: "Invalidating all system tokens...",
                    type: "info",
                    suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                    debug: cliConfiguration.VRCA_CLI_DEBUG,
                });
                const invalidatedCount =
                    await Server_CLI.invalidateDbSystemTokens();
                BunLogModule({
                    message: `Invalidated ${invalidatedCount} system tokens`,
                    type: "success",
                    suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                    debug: cliConfiguration.VRCA_CLI_DEBUG,
                });
                break;
            }

            case "server:postgres:seed:sql": {
                BunLogModule({
                    message: "Running database SQL seeds...",
                    type: "info",
                    suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                    debug: cliConfiguration.VRCA_CLI_DEBUG,
                });
                await Server_CLI.seedSql();
                BunLogModule({
                    message: "SQL seeds applied.",
                    type: "success",
                    suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                    debug: cliConfiguration.VRCA_CLI_DEBUG,
                });
                break;
            }

            case "server:postgres:seed:assets": {
                BunLogModule({
                    message: "Running database asset seeds...",
                    type: "info",
                    suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                    debug: cliConfiguration.VRCA_CLI_DEBUG,
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
                    suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                    debug: cliConfiguration.VRCA_CLI_DEBUG,
                });
                break;
            }

            case "server:postgres:backup": {
                BunLogModule({
                    message: `Backing up database to [${cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_BACKUP_FILE}]...`,
                    type: "info",
                    suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                    debug: cliConfiguration.VRCA_CLI_DEBUG,
                });
                await Server_CLI.backupDatabase();
                BunLogModule({
                    message: "Database backed up.",
                    type: "success",
                    suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                    debug: cliConfiguration.VRCA_CLI_DEBUG,
                });
                break;
            }

            case "server:postgres:restore": {
                BunLogModule({
                    message: `Restoring database from [${cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_RESTORE_FILE}]...`,
                    type: "info",
                    suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                    debug: cliConfiguration.VRCA_CLI_DEBUG,
                });
                await Server_CLI.restoreDatabase();
                BunLogModule({
                    message: "Database restored.",
                    type: "success",
                    suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                    debug: cliConfiguration.VRCA_CLI_DEBUG,
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
                    suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                    debug: cliConfiguration.VRCA_CLI_DEBUG,
                });
                break;
            }

            case "server:egress:list": {
                await Server_CLI.printEgressInfo();
                break;
            }

            // Generic docker command support
            case "server:run-command":
                await Server_CLI.runServerDockerCommand({
                    args: additionalArgs,
                });
                break;

            case "configure": {
                // Configuration loop - keeps showing main menu until user exits
                let continueConfiguring = true;

                while (continueConfiguring) {
                    // Get current values from environment (refresh each time)
                    // Read from client .env first, then process.env, then config defaults
                    const currentWsUri =
                        (await EnvManager.getVariable(
                            "VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_WS_URI",
                            "client",
                        )) ??
                        clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_WS_URI;

                    const currentSslEnabled =
                        (await EnvManager.getVariable(
                            "VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_WS_URI_USING_SSL",
                            "client",
                        )) ??
                        clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_WS_URI_USING_SSL;

                    const currentRestAuthUri =
                        (await EnvManager.getVariable(
                            "VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_REST_AUTH_URI",
                            "client",
                        )) ??
                        clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_REST_AUTH_URI;

                    const currentRestAuthUriUsingSsl =
                        (await EnvManager.getVariable(
                            "VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_REST_AUTH_URI_USING_SSL",
                            "client",
                        )) ??
                        clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_REST_AUTH_URI_USING_SSL;

                    const currentRestAssetUri =
                        (await EnvManager.getVariable(
                            "VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_REST_ASSET_URI",
                            "client",
                        )) ??
                        clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_REST_ASSET_URI;

                    const currentRestAssetUriUsingSsl =
                        (await EnvManager.getVariable(
                            "VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_REST_ASSET_URI_USING_SSL",
                            "client",
                        )) ??
                        clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_REST_ASSET_URI_USING_SSL;

                    const currentCaddyDomainApi =
                        (await EnvManager.getVariable(
                            "VRCA_SERVER_SERVICE_CADDY_DOMAIN_API",
                            "cli",
                        )) ||
                        process.env.VRCA_SERVER_SERVICE_CADDY_DOMAIN_API ||
                        serverConfiguration.VRCA_SERVER_SERVICE_CADDY_DOMAIN_API;

                    const currentCaddyDomainApp =
                        (await EnvManager.getVariable(
                            "VRCA_SERVER_SERVICE_CADDY_DOMAIN_APP",
                            "cli",
                        )) ||
                        process.env.VRCA_SERVER_SERVICE_CADDY_DOMAIN_APP ||
                        serverConfiguration.VRCA_SERVER_SERVICE_CADDY_DOMAIN_APP;

                    const currentCaddyHostBind =
                        (await EnvManager.getVariable(
                            "VRCA_SERVER_SERVICE_CADDY_HOST_CONTAINER_BIND_EXTERNAL",
                            "cli",
                        )) ||
                        process.env
                            .VRCA_SERVER_SERVICE_CADDY_HOST_CONTAINER_BIND_EXTERNAL ||
                        serverConfiguration.VRCA_SERVER_SERVICE_CADDY_HOST_CONTAINER_BIND_EXTERNAL;

                    const currentCaddyPortBindHttp =
                        (await EnvManager.getVariable(
                            "VRCA_SERVER_SERVICE_CADDY_PORT_CONTAINER_BIND_EXTERNAL_HTTP",
                            "cli",
                        )) ||
                        process.env
                            .VRCA_SERVER_SERVICE_CADDY_PORT_CONTAINER_BIND_EXTERNAL_HTTP ||
                        serverConfiguration.VRCA_SERVER_SERVICE_CADDY_PORT_CONTAINER_BIND_EXTERNAL_HTTP;

                    const currentCaddyPortBindHttps =
                        (await EnvManager.getVariable(
                            "VRCA_SERVER_SERVICE_CADDY_PORT_CONTAINER_BIND_EXTERNAL_HTTPS",
                            "cli",
                        )) ||
                        process.env
                            .VRCA_SERVER_SERVICE_CADDY_PORT_CONTAINER_BIND_EXTERNAL_HTTPS ||
                        serverConfiguration.VRCA_SERVER_SERVICE_CADDY_PORT_CONTAINER_BIND_EXTERNAL_HTTPS;

                    const currentCaddyTlsApi =
                        (await EnvManager.getVariable(
                            "VRCA_SERVER_SERVICE_CADDY_TLS_API",
                            "cli",
                        )) ||
                        process.env.VRCA_SERVER_SERVICE_CADDY_TLS_API ||
                        serverConfiguration.VRCA_SERVER_SERVICE_CADDY_TLS_API;

                    const currentCaddyTlsApp =
                        (await EnvManager.getVariable(
                            "VRCA_SERVER_SERVICE_CADDY_TLS_APP",
                            "cli",
                        )) ||
                        process.env.VRCA_SERVER_SERVICE_CADDY_TLS_APP ||
                        serverConfiguration.VRCA_SERVER_SERVICE_CADDY_TLS_APP;

                    // Model Definitions configuration has been removed

                    // Get current CLI environment values
                    // Read from CLI .env first, then process.env, then config defaults
                    const currentUserSqlDir =
                        (await EnvManager.getVariable(
                            "VRCA_CLI_SERVICE_POSTGRES_SEED_USER_SQL_DIR",
                            "cli",
                        )) ||
                        process.env
                            .VRCA_CLI_SERVICE_POSTGRES_SEED_USER_SQL_DIR ||
                        cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_SEED_USER_SQL_DIR ||
                        "Not set";

                    const currentUserAssetDir =
                        (await EnvManager.getVariable(
                            "VRCA_CLI_SERVICE_POSTGRES_SEED_USER_ASSET_DIR",
                            "cli",
                        )) ||
                        process.env
                            .VRCA_CLI_SERVICE_POSTGRES_SEED_USER_ASSET_DIR ||
                        cliConfiguration.VRCA_CLI_SERVICE_POSTGRES_SEED_USER_ASSET_DIR ||
                        "Not set";

                    // First ask what to configure
                    const configOption = await select({
                        message: "What would you like to configure?\n",
                        pageSize: 15,
                        choices: [
                            new Separator("=== 🌐 Browser Client ==="),
                            {
                                name: `User Browser Client -> Public World API WS URI\n    Current: ${currentWsUri}`,
                                value: "world-api-ws-uri",
                                description:
                                    "The default world API WS URI for the browser client to connect to.\nBy default, this should be the same as the Caddy API Domain.",
                            },
                            {
                                name: `User Browser Client -> Public World API WS SSL Enabled\n    Current: ${currentSslEnabled}`,
                                value: "world-api-ws-ssl",
                                description:
                                    "Whether the world API WS uses SSL (HTTPS).",
                            },
                            {
                                name: `User Browser Client -> Public World API REST Auth URI\n    Current: ${currentRestAuthUri}`,
                                value: "world-api-rest-auth-uri",
                                description:
                                    "The default world API REST Auth URI for the browser client to connect to.\nBy default, this should be the same as the Caddy API Domain.",
                            },
                            {
                                name: `User Browser Client -> Public World API REST Auth SSL Enabled\n    Current: ${currentRestAuthUriUsingSsl}`,
                                value: "world-api-rest-auth-ssl",
                                description:
                                    "Whether the world API REST Auth uses SSL (HTTPS).",
                            },
                            {
                                name: `User Browser Client -> Public World API REST Asset URI\n    Current: ${currentRestAssetUri}`,
                                value: "world-api-rest-asset-uri",
                                description:
                                    "The default world API REST Asset URI for the browser client to connect to.\nBy default, this should be the same as the Caddy API Domain.",
                            },
                            {
                                name: `User Browser Client -> Public World API REST Asset SSL Enabled\n    Current: ${currentRestAssetUriUsingSsl}`,
                                value: "world-api-rest-asset-ssl",
                                description:
                                    "Whether the world API REST Asset uses SSL (HTTPS).",
                            },
                            new Separator("=== 🔄 Caddy (Reverse Proxy) ==="),
                            {
                                name: `Caddy Public World API Domain\n    Current: ${currentCaddyDomainApi}`,
                                value: "caddy-domain-api",
                                description:
                                    "The public domain for the world API.",
                            },
                            {
                                name: `Caddy Public Browser Client App Domain\n    Current: ${currentCaddyDomainApp}`,
                                value: "caddy-domain-app",
                                description:
                                    "The public domain for the browser client app.",
                            },
                            {
                                name: `Caddy Container Host Bind\n    Current: ${currentCaddyHostBind}`,
                                value: "caddy-host-bind",
                                description:
                                    "The host bind for the Caddy container.",
                            },
                            {
                                name: `Caddy Container HTTP Port Bind\n    Current: ${currentCaddyPortBindHttp}`,
                                value: "caddy-port-bind-http",
                                description:
                                    "The HTTP port bind for the Caddy container.",
                            },
                            {
                                name: `Caddy Container HTTPS Port Bind\n    Current: ${currentCaddyPortBindHttps}`,
                                value: "caddy-port-bind-https",
                                description:
                                    "The HTTPS port bind for the Caddy container.",
                            },
                            {
                                name: `Caddy TLS Mode (API)\n    Current: ${currentCaddyTlsApi || "Default (SSL enabled)"}`,
                                value: "caddy-tls-api",
                                description:
                                    "Configure TLS for the API domain. Use 'tls internal' for internal CA or leave empty for ACME.",
                            },
                            {
                                name: `Caddy TLS Mode (APP)\n    Current: ${currentCaddyTlsApp || "Default (SSL enabled)"}`,
                                value: "caddy-tls-app",
                                description:
                                    "Configure TLS for the APP domain. Use 'tls internal' for internal CA or leave empty for ACME.",
                            },
                            new Separator("=== 🗄️ Database ==="),
                            {
                                name: `User SQL Seed Directory\n    Current: ${currentUserSqlDir}`,
                                value: "user-sql-dir",
                                description:
                                    "The directory with the user SQL seed files. (Optional)",
                            },
                            {
                                name: `User Asset Seed Directory\n    Current: ${currentUserAssetDir}`,
                                value: "user-asset-dir",
                                description:
                                    "The directory with the user asset seed files. (Optional)",
                            },
                            new Separator(">>>>>> ⚙️ Actions <<<<<<"),
                            {
                                name: "Show egress points",
                                value: "show-egress",
                                description:
                                    "Show the egress points to setup reverse proxies.",
                            },
                            {
                                name: "View all current configuration",
                                value: "view-all",
                            },
                            {
                                name: "Exit configuration",
                                value: "exit",
                            },
                        ],
                    });

                    // Handle exit option
                    if (configOption === "exit") {
                        continueConfiguring = false;
                        break;
                    }

                    if (configOption === "world-api-ws-uri") {
                        const action = await select({
                            message:
                                "What would you like to do with the World API WS URI?\n",

                            pageSize: 15,
                            choices: [
                                {
                                    name: `Set variable in client .env\n    Current: ${currentWsUri}`,
                                    value: "set",
                                },
                                {
                                    name: "Unset variable (remove from client .env)",
                                    value: "unset",
                                },
                            ],
                        });

                        if (action === "set") {
                            const newUri = await input({
                                message: "Enter World API WS URI:",
                                default: currentWsUri,
                                transformer: (value: string) => value.trim(),
                            });

                            await EnvManager.setVariable(
                                "VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_WS_URI",
                                newUri,
                                "client",
                            );

                            BunLogModule({
                                message: `World API WS URI set to: ${newUri} (persisted to client .env file)`,
                                type: "success",
                                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                                debug: cliConfiguration.VRCA_CLI_DEBUG,
                            });
                        } else if (action === "unset") {
                            await EnvManager.unsetVariable(
                                "VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_WS_URI",
                                "client",
                            );

                            BunLogModule({
                                message:
                                    "World API WS URI variable unset (removed from client .env file)",
                                type: "success",
                                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                                debug: cliConfiguration.VRCA_CLI_DEBUG,
                            });
                        }
                    } else if (configOption === "world-api-rest-auth-uri") {
                        const action = await select({
                            message:
                                "What would you like to do with World API REST Auth URI?\n",

                            pageSize: 15,
                            choices: [
                                {
                                    name: `Set variable in client .env\n    Current: ${currentRestAuthUri}`,
                                    value: "set",
                                },
                                {
                                    name: "Unset variable (remove from client .env)",
                                    value: "unset",
                                },
                            ],
                        });

                        if (action === "set") {
                            const newUri = await input({
                                message: "Enter World API REST Auth URI:",
                                default: currentRestAuthUri,
                                transformer: (value: string) => value.trim(),
                            });

                            await EnvManager.setVariable(
                                "VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_REST_AUTH_URI",
                                newUri,
                                "client",
                            );

                            BunLogModule({
                                message: `World API REST Auth URI set to: ${newUri} (persisted to client .env file)`,
                                type: "success",
                                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                                debug: cliConfiguration.VRCA_CLI_DEBUG,
                            });
                        } else if (action === "unset") {
                            await EnvManager.unsetVariable(
                                "VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_REST_AUTH_URI",
                                "client",
                            );

                            BunLogModule({
                                message:
                                    "World API REST Auth URI variable unset (removed from client .env file)",
                                type: "success",
                                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                                debug: cliConfiguration.VRCA_CLI_DEBUG,
                            });
                        }
                    } else if (configOption === "world-api-rest-asset-uri") {
                        const action = await select({
                            message:
                                "What would you like to do with World API REST Asset URI?\n",

                            pageSize: 15,
                            choices: [
                                {
                                    name: `Set variable in client .env\n    Current: ${currentRestAssetUri}`,
                                    value: "set",
                                },
                                {
                                    name: "Unset variable (remove from client .env)",
                                    value: "unset",
                                },
                            ],
                        });

                    if (action === "set") {
                        const newUri = await input({
                            message: "Enter World API REST Asset URI:",
                            default: currentRestAssetUri,
                            transformer: (value: string) => value.trim(),
                        });

                        await EnvManager.setVariable(
                            "VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_REST_ASSET_URI",
                            newUri,
                            "client",
                        );

                        BunLogModule({
                            message: `World API REST Asset URI set to: ${newUri} (persisted to client .env file)`,
                            type: "success",
                            suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                            debug: cliConfiguration.VRCA_CLI_DEBUG,
                        });
                    } else if (action === "unset") {
                        await EnvManager.unsetVariable(
                            "VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_REST_ASSET_URI",
                            "client",
                        );

                        BunLogModule({
                            message: `World API REST Asset URI variable unset (removed from client .env file)`,
                            type: "success",
                            suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                            debug: cliConfiguration.VRCA_CLI_DEBUG,
                        });
                    }
                    } else if (configOption === "user-sql-dir") {
                        const action = await select({
                            message:
                                "What would you like to do with User SQL Seed Directory?\n",

                            pageSize: 15,
                            choices: [
                                {
                                    name: `Set variable in CLI .env\n    Current: ${currentUserSqlDir}`,
                                    value: "set",
                                },
                                {
                                    name: "Unset variable (remove from CLI .env)",
                                    value: "unset",
                                },
                            ],
                        });

                        if (action === "set") {
                            const newDir = await input({
                                message: "Enter User SQL Seed Directory path:",
                                default:
                                    currentUserSqlDir !== "Not set"
                                        ? currentUserSqlDir
                                        : "",
                                transformer: (value: string) => value.trim(),
                            });

                            await EnvManager.setVariable(
                                "VRCA_CLI_SERVICE_POSTGRES_SEED_USER_SQL_DIR",
                                newDir,
                                "cli",
                            );

                            BunLogModule({
                                message: `User SQL Seed Directory set to: ${newDir} (persisted to CLI .env file)`,
                                type: "success",
                                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                                debug: cliConfiguration.VRCA_CLI_DEBUG,
                            });
                        } else if (action === "unset") {
                            await EnvManager.unsetVariable(
                                "VRCA_CLI_SERVICE_POSTGRES_SEED_USER_SQL_DIR",
                                "cli",
                            );

                            BunLogModule({
                                message:
                                    "User SQL Seed Directory variable unset (removed from CLI .env file)",
                                type: "success",
                                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                                debug: cliConfiguration.VRCA_CLI_DEBUG,
                            });
                        }
                    } else if (configOption === "world-api-ws-ssl") {
                        const action = await select({
                            message:
                                "What would you like to do with World API SSL?\n",

                            pageSize: 15,
                            choices: [
                                {
                                    name: `Set variable in client .env\n    Current: ${currentSslEnabled}`,
                                    value: "set",
                                },
                                {
                                    name: "Unset variable (remove from client .env)",
                                    value: "unset",
                                },
                            ],
                        });

                        if (action === "set") {
                            const newSslEnabled = await select({
                                message: "Enable SSL for World API?",
                                choices: [
                                    { name: "Yes", value: "true" },
                                    { name: "No", value: "false" },
                                ],
                                default: currentSslEnabled ? "true" : "false",
                            });

                            await EnvManager.setVariable(
                                "VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_WS_URI_USING_SSL",
                                newSslEnabled,
                                "client",
                            );

                            BunLogModule({
                                message: `World API SSL set to: ${newSslEnabled} (persisted to client .env file)`,
                                type: "success",
                                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                                debug: cliConfiguration.VRCA_CLI_DEBUG,
                            });
                        } else if (action === "unset") {
                            await EnvManager.unsetVariable(
                                "VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_WS_URI_USING_SSL",
                                "client",
                            );

                            BunLogModule({
                                message:
                                    "World API SSL variable unset (removed from client .env file)",
                                type: "success",
                                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                                debug: cliConfiguration.VRCA_CLI_DEBUG,
                            });
                        }
                    } else if (configOption === "world-api-rest-auth-ssl") {
                        const action = await select({
                            message:
                                "What would you like to do with World API REST Auth SSL?\n",

                            pageSize: 15,
                            choices: [
                                {
                                    name: `Set variable in client .env\n    Current: ${currentRestAuthUriUsingSsl}`,
                                    value: "set",
                                },
                                {
                                    name: "Unset variable (remove from client .env)",
                                    value: "unset",
                                },
                            ],
                        });

                        if (action === "set") {
                            const newSslEnabled = await select({
                                message: "Enable SSL for REST Auth API?",
                                choices: [
                                    { name: "Yes", value: "true" },
                                    { name: "No", value: "false" },
                                ],
                                default: currentRestAuthUriUsingSsl ? "true" : "false",
                            });

                            await EnvManager.setVariable(
                                "VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_REST_AUTH_URI_USING_SSL",
                                newSslEnabled,
                                "client",
                            );

                            BunLogModule({
                                message: `World API REST Auth SSL set to: ${newSslEnabled} (persisted to client .env file)`,
                                type: "success",
                                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                                debug: cliConfiguration.VRCA_CLI_DEBUG,
                            });
                        } else if (action === "unset") {
                            await EnvManager.unsetVariable(
                                "VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_REST_AUTH_URI_USING_SSL",
                                "client",
                            );

                            BunLogModule({
                                message:
                                    "World API REST Auth SSL variable unset (removed from client .env file)",
                                type: "success",
                                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                                debug: cliConfiguration.VRCA_CLI_DEBUG,
                            });
                        }
                    } else if (configOption === "world-api-rest-asset-ssl") {
                        const action = await select({
                            message:
                                "What would you like to do with World API REST Asset SSL?\n",

                            pageSize: 15,
                            choices: [
                                {
                                    name: `Set variable in client .env\n    Current: ${currentRestAssetUriUsingSsl}`,
                                    value: "set",
                                },
                                {
                                    name: "Unset variable (remove from client .env)",
                                    value: "unset",
                                },
                            ],
                        });

                        if (action === "set") {
                            const newSslEnabled = await select({
                                message: "Enable SSL for REST Asset API?",
                                choices: [
                                    { name: "Yes", value: "true" },
                                    { name: "No", value: "false" },
                                ],
                                default: currentRestAssetUriUsingSsl ? "true" : "false",
                            });

                            await EnvManager.setVariable(
                                "VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_REST_ASSET_URI_USING_SSL",
                                newSslEnabled,
                                "client",
                            );

                            BunLogModule({
                                message: `World API REST Asset SSL set to: ${newSslEnabled} (persisted to client .env file)`,
                                type: "success",
                                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                                debug: cliConfiguration.VRCA_CLI_DEBUG,
                            });
                        } else if (action === "unset") {
                            await EnvManager.unsetVariable(
                                "VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_REST_ASSET_URI_USING_SSL",
                                "client",
                            );

                            BunLogModule({
                                message:
                                    "World API REST Asset SSL variable unset (removed from client .env file)",
                                type: "success",
                                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                                debug: cliConfiguration.VRCA_CLI_DEBUG,
                            });
                        }
                    } else if (configOption === "caddy-domain-api") {
                        const action = await select({
                            message:
                                "What would you like to do with Caddy API Domain?\n",

                            pageSize: 15,
                            choices: [
                                {
                                    name: `Set variable in CLI .env\n    Current: ${currentCaddyDomainApi}`,
                                    value: "set",
                                },
                                {
                                    name: "Unset variable (remove from CLI .env)",
                                    value: "unset",
                                },
                            ],
                        });

                        if (action === "set") {
                            const newDomain = await input({
                                message: "Enter Caddy API Domain:",
                                default: currentCaddyDomainApi,
                                transformer: (value: string) => value.trim(),
                            });

                            await EnvManager.setVariable(
                                "VRCA_SERVER_SERVICE_CADDY_DOMAIN_API",
                                newDomain,
                                "cli",
                            );

                            BunLogModule({
                                message: `Caddy API Domain set to: ${newDomain} (persisted to CLI .env file)`,
                                type: "success",
                                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                                debug: cliConfiguration.VRCA_CLI_DEBUG,
                            });
                        } else if (action === "unset") {
                            await EnvManager.unsetVariable(
                                "VRCA_SERVER_SERVICE_CADDY_DOMAIN_API",
                                "cli",
                            );

                            BunLogModule({
                                message:
                                    "Caddy API Domain variable unset (removed from CLI .env file)",
                                type: "success",
                                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                                debug: cliConfiguration.VRCA_CLI_DEBUG,
                            });
                        }
                    } else if (configOption === "caddy-domain-app") {
                        const action = await select({
                            message:
                                "What would you like to do with Caddy App Domain?\n",

                            pageSize: 15,
                            choices: [
                                {
                                    name: `Set variable in CLI .env\n    Current: ${currentCaddyDomainApp}`,
                                    value: "set",
                                },
                                {
                                    name: "Unset variable (remove from CLI .env)",
                                    value: "unset",
                                },
                            ],
                        });

                        if (action === "set") {
                            const newDomain = await input({
                                message: "Enter Caddy App Domain:",
                                default: currentCaddyDomainApp,
                                transformer: (value: string) => value.trim(),
                            });

                            await EnvManager.setVariable(
                                "VRCA_SERVER_SERVICE_CADDY_DOMAIN_APP",
                                newDomain,
                                "cli",
                            );

                            BunLogModule({
                                message: `Caddy App Domain set to: ${newDomain} (persisted to CLI .env file)`,
                                type: "success",
                                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                                debug: cliConfiguration.VRCA_CLI_DEBUG,
                            });
                        } else if (action === "unset") {
                            await EnvManager.unsetVariable(
                                "VRCA_SERVER_SERVICE_CADDY_DOMAIN_APP",
                                "cli",
                            );

                            BunLogModule({
                                message:
                                    "Caddy App Domain variable unset (removed from CLI .env file)",
                                type: "success",
                                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                                debug: cliConfiguration.VRCA_CLI_DEBUG,
                            });
                        }
                    } else if (configOption === "caddy-host-bind") {
                        const action = await select({
                            message:
                                "What would you like to do with Caddy Host Bind?\n",

                            pageSize: 15,
                            choices: [
                                {
                                    name: `Set variable in CLI .env\n    Current: ${currentCaddyHostBind}`,
                                    value: "set",
                                },
                                {
                                    name: "Unset variable (remove from CLI .env)",
                                    value: "unset",
                                },
                            ],
                        });

                        if (action === "set") {
                            const newHost = await input({
                                message: "Enter Caddy Host Bind:",
                                default: currentCaddyHostBind,
                                transformer: (value: string) => value.trim(),
                            });

                            await EnvManager.setVariable(
                                "VRCA_SERVER_SERVICE_CADDY_HOST_CONTAINER_BIND_EXTERNAL",
                                newHost,
                                "cli",
                            );

                            BunLogModule({
                                message: `Caddy Host Bind set to: ${newHost} (persisted to CLI .env file)`,
                                type: "success",
                                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                                debug: cliConfiguration.VRCA_CLI_DEBUG,
                            });
                        } else if (action === "unset") {
                            await EnvManager.unsetVariable(
                                "VRCA_SERVER_SERVICE_CADDY_HOST_CONTAINER_BIND_EXTERNAL",
                                "cli",
                            );

                            BunLogModule({
                                message:
                                    "Caddy Host Bind variable unset (removed from CLI .env file)",
                                type: "success",
                                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                                debug: cliConfiguration.VRCA_CLI_DEBUG,
                            });
                        }
                    } else if (configOption === "caddy-port-bind-http") {
                        const action = await select({
                            message:
                                "What would you like to do with Caddy HTTP Port Bind?\n",

                            pageSize: 15,
                            choices: [
                                {
                                    name: `Set variable in CLI .env\n    Current: ${currentCaddyPortBindHttp}`,
                                    value: "set",
                                },
                                {
                                    name: "Unset variable (remove from CLI .env)",
                                    value: "unset",
                                },
                            ],
                        });

                        if (action === "set") {
                            const newPort = await input({
                                message: "Enter Caddy HTTP Port Bind:",
                                default: currentCaddyPortBindHttp.toString(),
                                transformer: (value: string) => value.trim(),
                            });

                            await EnvManager.setVariable(
                                "VRCA_SERVER_SERVICE_CADDY_PORT_CONTAINER_BIND_EXTERNAL_HTTP",
                                newPort,
                                "cli",
                            );

                            BunLogModule({
                                message: `Caddy HTTP Port Bind set to: ${newPort} (persisted to CLI .env file)`,
                                type: "success",
                                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                                debug: cliConfiguration.VRCA_CLI_DEBUG,
                            });
                        } else if (action === "unset") {
                            await EnvManager.unsetVariable(
                                "VRCA_SERVER_SERVICE_CADDY_PORT_CONTAINER_BIND_EXTERNAL_HTTP",
                                "cli",
                            );

                            BunLogModule({
                                message:
                                    "Caddy HTTP Port Bind variable unset (removed from CLI .env file)",
                                type: "success",
                                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                                debug: cliConfiguration.VRCA_CLI_DEBUG,
                            });
                        }
                    } else if (configOption === "caddy-port-bind-https") {
                        const action = await select({
                            message:
                                "What would you like to do with Caddy HTTPS Port Bind?\n",

                            pageSize: 15,
                            choices: [
                                {
                                    name: `Set variable in CLI .env\n    Current: ${currentCaddyPortBindHttps}`,
                                    value: "set",
                                },
                                {
                                    name: "Unset variable (remove from CLI .env)",
                                    value: "unset",
                                },
                            ],
                        });

                        if (action === "set") {
                            const newPort = await input({
                                message: "Enter Caddy HTTPS Port Bind:",
                                default: currentCaddyPortBindHttps.toString(),
                                transformer: (value: string) => value.trim(),
                            });

                            await EnvManager.setVariable(
                                "VRCA_SERVER_SERVICE_CADDY_PORT_CONTAINER_BIND_EXTERNAL_HTTPS",
                                newPort,
                                "cli",
                            );

                            BunLogModule({
                                message: `Caddy HTTPS Port Bind set to: ${newPort} (persisted to CLI .env file)`,
                                type: "success",
                                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                                debug: cliConfiguration.VRCA_CLI_DEBUG,
                            });
                        } else if (action === "unset") {
                            await EnvManager.unsetVariable(
                                "VRCA_SERVER_SERVICE_CADDY_PORT_CONTAINER_BIND_EXTERNAL_HTTPS",
                                "cli",
                            );

                            BunLogModule({
                                message:
                                    "Caddy HTTPS Port Bind variable unset (removed from CLI .env file)",
                                type: "success",
                                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                                debug: cliConfiguration.VRCA_CLI_DEBUG,
                            });
                        }
                    } else if (configOption === "caddy-tls") {
                        // Back-compat: map legacy TLS option to API TLS
                        const action = await select({
                            message:
                                "What would you like to do with Caddy TLS Mode (API)?\n",

                            pageSize: 15,
                            choices: [
                                {
                                    name: `Set variable in CLI .env\n    Current: ${currentCaddyTlsApi || "Default (SSL enabled)"}`,
                                    value: "set",
                                },
                                {
                                    name: "Unset variable (remove from CLI .env)",
                                    value: "unset",
                                },
                            ],
                        });

                        if (action === "set") {
                            const newTlsMode = await input({
                                message:
                                    "Enter Caddy TLS Mode (API) (leave empty for SSL enabled, 'tls internal' for internal):",
                                default: currentCaddyTlsApi || "",
                                transformer: (value: string) => value.trim(),
                            });

                            await EnvManager.setVariable(
                                "VRCA_SERVER_SERVICE_CADDY_TLS_API",
                                newTlsMode,
                                "cli",
                            );

                            BunLogModule({
                                message: `Caddy TLS Mode (API) set to: ${newTlsMode || "Default (SSL enabled)"} (persisted to CLI .env file)`,
                                type: "success",
                                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                                debug: cliConfiguration.VRCA_CLI_DEBUG,
                            });
                        } else if (action === "unset") {
                            await EnvManager.unsetVariable(
                                "VRCA_SERVER_SERVICE_CADDY_TLS_API",
                                "cli",
                            );

                            BunLogModule({
                                message:
                                    "Caddy TLS Mode (API) variable unset (removed from CLI .env file)",
                                type: "info",
                                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                                debug: cliConfiguration.VRCA_CLI_DEBUG,
                            });
                        }
                    } else if (configOption === "caddy-tls-api") {
                        const action = await select({
                            message:
                                "What would you like to do with Caddy TLS Mode (API)?\n",

                            pageSize: 15,
                            choices: [
                                {
                                    name: `Set variable in CLI .env\n    Current: ${currentCaddyTlsApi || "Default (SSL enabled)"}`,
                                    value: "set",
                                },
                                {
                                    name: "Unset variable (remove from CLI .env)",
                                    value: "unset",
                                },
                            ],
                        });

                        if (action === "set") {
                            const newTlsMode = await input({
                                message:
                                    "Enter Caddy TLS Mode (API) (leave empty for SSL enabled, 'tls internal' for internal):",
                                default: currentCaddyTlsApi || "",
                                transformer: (value: string) => value.trim(),
                            });

                            await EnvManager.setVariable(
                                "VRCA_SERVER_SERVICE_CADDY_TLS_API",
                                newTlsMode,
                                "cli",
                            );

                            BunLogModule({
                                message: `Caddy TLS Mode (API) set to: ${newTlsMode || "Default (SSL enabled)"} (persisted to CLI .env file)`,
                                type: "success",
                                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                                debug: cliConfiguration.VRCA_CLI_DEBUG,
                            });
                        } else if (action === "unset") {
                            await EnvManager.unsetVariable(
                                "VRCA_SERVER_SERVICE_CADDY_TLS_API",
                                "cli",
                            );

                            BunLogModule({
                                message:
                                    "Caddy TLS Mode (API) variable unset (removed from CLI .env file)",
                                type: "info",
                                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                                debug: cliConfiguration.VRCA_CLI_DEBUG,
                            });
                        }
                    } else if (configOption === "caddy-tls-app") {
                        const action = await select({
                            message:
                                "What would you like to do with Caddy TLS Mode (APP)?\n",

                            pageSize: 15,
                            choices: [
                                {
                                    name: `Set variable in CLI .env\n    Current: ${currentCaddyTlsApp || "Default (SSL enabled)"}`,
                                    value: "set",
                                },
                                {
                                    name: "Unset variable (remove from CLI .env)",
                                    value: "unset",
                                },
                            ],
                        });

                        if (action === "set") {
                            const newTlsMode = await input({
                                message:
                                    "Enter Caddy TLS Mode (APP) (leave empty for SSL enabled, 'tls internal' for internal CA or 'tls off' to disable):",
                                default: currentCaddyTlsApp || "",
                                transformer: (value: string) => value.trim(),
                            });

                            await EnvManager.setVariable(
                                "VRCA_SERVER_SERVICE_CADDY_TLS_APP",
                                newTlsMode,
                                "cli",
                            );

                            BunLogModule({
                                message: `Caddy TLS Mode (APP) set to: ${newTlsMode || "Default (SSL enabled)"} (persisted to CLI .env file)`,
                                type: "success",
                                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                                debug: cliConfiguration.VRCA_CLI_DEBUG,
                            });
                        } else if (action === "unset") {
                            await EnvManager.unsetVariable(
                                "VRCA_SERVER_SERVICE_CADDY_TLS_APP",
                                "cli",
                            );

                            BunLogModule({
                                message:
                                    "Caddy TLS Mode (APP) variable unset (removed from CLI .env file)",
                                type: "info",
                                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                                debug: cliConfiguration.VRCA_CLI_DEBUG,
                            });
                        }
                    } else if (configOption === "user-asset-dir") {
                        const action = await select({
                            message:
                                "What would you like to do with User Asset Seed Directory?\n",

                            pageSize: 15,
                            choices: [
                                {
                                    name: `Set variable in CLI .env\n    Current: ${currentUserAssetDir}`,
                                    value: "set",
                                },
                                {
                                    name: "Unset variable (remove from CLI .env)",
                                    value: "unset",
                                },
                            ],
                        });

                        if (action === "set") {
                            const newDir = await input({
                                message:
                                    "Enter User Asset Seed Directory path:",
                                default:
                                    currentUserAssetDir !== "Not set"
                                        ? currentUserAssetDir
                                        : "",
                                transformer: (value: string) => value.trim(),
                            });

                            await EnvManager.setVariable(
                                "VRCA_CLI_SERVICE_POSTGRES_SEED_USER_ASSET_DIR",
                                newDir,
                                "cli",
                            );

                            BunLogModule({
                                message: `User Asset Seed Directory set to: ${newDir} (persisted to CLI .env file)`,
                                type: "success",
                                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                                debug: cliConfiguration.VRCA_CLI_DEBUG,
                            });
                        } else if (action === "unset") {
                            await EnvManager.unsetVariable(
                                "VRCA_CLI_SERVICE_POSTGRES_SEED_USER_ASSET_DIR",
                                "cli",
                            );

                            BunLogModule({
                                message:
                                    "User Asset Seed Directory variable unset (removed from CLI .env file)",
                                type: "success",
                                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                                debug: cliConfiguration.VRCA_CLI_DEBUG,
                            });
                        }
                    } else if (configOption === "show-egress") {
                        await Server_CLI.printEgressInfo();
                    } else if (configOption === "view-all") {
                        BunLogModule({
                            message: "Current Configuration:",
                            type: "info",
                            suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                            debug: cliConfiguration.VRCA_CLI_DEBUG,
                        });

                        console.log(`\nBrowser Client Configuration:`);
                        console.log(`  World API WS URI: ${currentWsUri}`);
                        console.log(
                            `  World API WS SSL Enabled: ${currentSslEnabled}`,
                        );
                        console.log(
                            `  World API REST Auth URI: ${currentRestAuthUri}`,
                        );
                        console.log(
                            `  World API REST Auth SSL Enabled: ${currentRestAuthUriUsingSsl}`,
                        );
                        console.log(
                            `  World API REST Asset URI: ${currentRestAssetUri}`,
                        );
                        console.log(
                            `  World API REST Asset SSL Enabled: ${currentRestAssetUriUsingSsl}`,
                        );

                        console.log(`\nCaddy (Reverse Proxy):`);
                        console.log(`  API Domain: ${currentCaddyDomainApi}`);
                        console.log(`  App Domain: ${currentCaddyDomainApp}`);
                        console.log(`  Host Bind: ${currentCaddyHostBind}`);
                        console.log(
                            `  HTTP Port Bind: ${currentCaddyPortBindHttp}`,
                        );
                        console.log(
                            `  HTTPS Port Bind: ${currentCaddyPortBindHttps}`,
                        );
                        console.log(`  TLS Mode (API): ${currentCaddyTlsApi || "Default (SSL enabled)"}`);
                        console.log(`  TLS Mode (APP): ${currentCaddyTlsApp || "Default (SSL enabled)"}`);

                        console.log(`\nCLI Configuration:`);
                        console.log(
                            `  User SQL Seed Directory: ${currentUserSqlDir}`,
                        );
                        console.log(
                            `  User Asset Seed Directory: ${currentUserAssetDir}`,
                        );
                    }
                } // Close the while loop
                break;
            }

            // HOT SYNC MODULE

            case "dev:hot-sync:assets": {
                // await AssetHotSync.hotSyncAssets({
                //     pollIntervalMs: 5000,
                //     debug: cliConfiguration.VRCA_CLI_DEBUG,
                //     compileForce: true,
                // });
                break;
            }

            // PROJECT AUTO-UPGRADE (one-time upgrade)
            case "project:auto-upgrade": {
                const isCore = additionalArgs.includes("--core");
                const isAll = additionalArgs.includes("--all");
                const result = await $`git rev-parse --abbrev-ref HEAD`;
                const currentBranch = result.stdout.toString().trim();

                BunLogModule({
                    message: `Starting one-time auto-upgrade on current branch for ${isCore ? "core services only" : "all services" }`,
                    data: { currentBranch },
                    type: "info",
                    suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                    debug: cliConfiguration.VRCA_CLI_DEBUG,
                });

                await $`git fetch --all --prune --recurse-submodules`.nothrow();

                try {
                    BunLogModule({
                        message: `Updating current branch '${currentBranch}' for ${isCore ? "core services only" : "all services" }...`,
                        type: "info",
                        suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                        debug: cliConfiguration.VRCA_CLI_DEBUG,
                    });

                    // Update submodules recursively
                    await $`git submodule update --init --recursive`.nothrow();

                    // Fetch and pull current branch with recursive submodules
                    const pull = await $`git pull --rebase --recurse-submodules origin ${currentBranch}`.nothrow().quiet();
                    if (pull.exitCode !== 0) throw new Error(`pull failed: ${pull.stderr.toString()}`);

                    BunLogModule({
                        message: `Rebuilding ${isCore ? "core services only" : "all services" }...`,
                        type: "info",
                        suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                        debug: cliConfiguration.VRCA_CLI_DEBUG,
                    });
                    const result = await $`bun run server:rebuild-${isCore ? "core" : "all"}`.nothrow();
                    if (result.exitCode !== 0) {
                        throw new Error(`rebuild failed: ${result.stderr.toString()}`);
                    }

                    BunLogModule({
                        message: `Auto-upgrade completed successfully for ${isCore ? "core services only" : "all services" }`,
                        type: "success",
                        suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                        debug: cliConfiguration.VRCA_CLI_DEBUG,
                    });
                } catch (error) {
                    BunLogModule({
                        message: `Auto-upgrade failed for ${isCore ? "core services only" : "all services" }: ${error instanceof Error ? error.message : String(error)}`,
                        type: "error",
                        suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                        debug: cliConfiguration.VRCA_CLI_DEBUG,
                    });
                    throw error;
                }
                break;
            }

            default:
                BunLogModule({
                    message: `Unknown command: ${command}`,
                    type: "error",
                    suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                    debug: cliConfiguration.VRCA_CLI_DEBUG,
                });
                process.exit(1);
        }

        process.exit(0);
    } catch (error) {
        BunLogModule({
            message: `Error: ${error}`,
            type: "error",
            suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
            debug: cliConfiguration.VRCA_CLI_DEBUG,
        });
        process.exit(1);
    }
}
