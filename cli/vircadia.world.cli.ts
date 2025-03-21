import { VircadiaConfig_CLI } from "../sdk/vircadia-world-sdk-ts/config/vircadia.cli.config.ts";
import { VircadiaConfig_BROWSER_CLIENT } from "../sdk/vircadia-world-sdk-ts/config/vircadia.browser.client.config.ts";
import { VircadiaConfig_SERVER } from "../sdk/vircadia-world-sdk-ts/config/vircadia.server.config.ts";
import { log } from "../sdk/vircadia-world-sdk-ts/module/general/log.ts";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { readdir, readFile, watch, writeFile } from "node:fs/promises";
import { sign } from "jsonwebtoken";
import { PostgresClient } from "../sdk/vircadia-world-sdk-ts/module/server/postgres.server.client.ts";
import {
    Entity,
    Service,
} from "../sdk/vircadia-world-sdk-ts/schema/schema.general.ts";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";

// TODO: Optimize the commands, get up and down rebuilds including init to work well.

// https://github.com/tj/commander.js
// https://www.npmjs.com/package/inquirer

export namespace WebScript_CLI {
    const VALID_SCRIPT_TYPES = [
        "BABYLON_NODE",
        "BABYLON_BUN",
        "BABYLON_BROWSER",
    ];

    const hasher = new Bun.CryptoHasher("sha256");

    interface ScriptInfo {
        name: string;
        type: string;
        sourceHash: string;
        compiledHash: string;
        lastChecked: Date;
    }

    // Function to compile script based on type
    async function compileScript(
        source: string,
        type: string,
        filePath: string,
    ): Promise<{ data: string; hash: string; status: string }> {
        try {
            let compiledData: string;

            switch (type) {
                case Entity.Script.E_ScriptType.BABYLON_NODE: {
                    // For Node/Bun scripts, use Bun's transpiler
                    const nodeResult = await Bun.build({
                        entrypoints: [filePath],
                        format: "esm",
                        target: "node",
                        minify: true,
                    });

                    if (!nodeResult.success) {
                        return {
                            data: source, // Return source on compilation failure
                            hash: hasher.update(source).digest("hex"),
                            status: "FAILED",
                        };
                    }

                    compiledData = await nodeResult.outputs[0].text();
                    break;
                }
                case Entity.Script.E_ScriptType.BABYLON_BUN: {
                    // For Bun scripts, use Bun's transpiler
                    const bunResult = await Bun.build({
                        entrypoints: [filePath],
                        format: "esm",
                        target: "bun",
                        minify: true,
                    });

                    if (!bunResult.success) {
                        return {
                            data: source, // Return source on compilation failure
                            hash: hasher.update(source).digest("hex"),
                            status: "FAILED",
                        };
                    }

                    compiledData = await bunResult.outputs[0].text();
                    break;
                }
                case Entity.Script.E_ScriptType.BABYLON_BROWSER: {
                    // For browser scripts, use browser target
                    const browserResult = await Bun.build({
                        entrypoints: [filePath],
                        format: "esm",
                        target: "browser",
                        minify: true,
                    });

                    if (!browserResult.success) {
                        return {
                            data: source, // Return source on compilation failure
                            hash: hasher.update(source).digest("hex"),
                            status: "FAILED",
                        };
                    }

                    compiledData = await browserResult.outputs[0].text();
                    break;
                }
                default:
                    // Default fallback - no compilation
                    compiledData = source;
            }

            const hash = hasher.update(compiledData).digest("hex");
            return { data: compiledData, hash, status: "COMPILED" };
        } catch (error) {
            log({
                message: `Compilation error: ${error}`,
                type: "error",
                error,
                suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
            });

            return {
                data: source, // Return source on compilation error
                hash: hasher.update(source).digest("hex"),
                status: "FAILED",
            };
        }
    }

    // Main function to handle hot sync of scripts
    export async function startSync(): Promise<void> {
        const RETRIEVE_NEW_SCRIPTS_INTERVAL = 500;
        const COMPILE_FORCE = false;

        // Map to track local script info
        const localScriptInfoMap = new Map<string, ScriptInfo>();

        // Ensure sync directory exists
        const syncDir =
            VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_SYNC_SCRIPT_DIR;

        if (!existsSync(syncDir)) {
            await mkdir(syncDir, { recursive: true });
            log({
                message: `Created sync directory: ${syncDir}`,
                type: "info",
                suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
            });
        }

        // Connect to database
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
            message: "Starting hot script sync...",
            type: "info",
            suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
            debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
        });

        // Function to update database with local script changes
        const updateScriptInDatabase = async (
            filePath: string,
            fileName: string,
        ): Promise<void> => {
            try {
                const content = await readFile(filePath, "utf-8");
                const sourceHash = hasher.update(content).digest("hex");

                // Check if script exists in database
                const [scriptExists] = await sql<[{ count: number }]>`
                    SELECT COUNT(*) as count 
                    FROM entity.entity_scripts 
                    WHERE general__script_file_name = ${fileName}
                `;

                if (!scriptExists || scriptExists.count === 0) {
                    log({
                        message: `Skipping script: ${fileName} - does not exist in database`,
                        type: "info",
                        suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                        debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                    });
                    return;
                }

                // Check if we need to update
                const existingInfo = localScriptInfoMap.get(fileName);
                if (
                    existingInfo &&
                    existingInfo.sourceHash === sourceHash &&
                    !COMPILE_FORCE
                ) {
                    // No changes detected
                    return;
                }

                // Get script type from database
                const [scriptRecord] = await sql<
                    Array<Pick<Entity.Script.I_Script, "script__type">>
                >`
                    SELECT script__type 
                    FROM entity.entity_scripts 
                    WHERE general__script_file_name = ${fileName}
                `;

                const scriptType =
                    scriptRecord?.script__type ||
                    Entity.Script.E_ScriptType.BABYLON_BROWSER;

                // Only process valid script types
                if (!VALID_SCRIPT_TYPES.includes(scriptType)) {
                    log({
                        message: `Skipping script with unsupported type: ${scriptType}`,
                        type: "info",
                        suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                        debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                    });
                    return;
                }

                // Set status to COMPILING
                await sql`
                    UPDATE entity.entity_scripts
                    SET script__compiled__status = ${Entity.Script.E_CompilationStatus.COMPILING},
                        script__source__data = ${content},
                        script__source__sha256 = ${sourceHash},
                        script__source__updated_at = CURRENT_TIMESTAMP
                    WHERE general__script_file_name = ${fileName}
                `;

                log({
                    message: `Compiling script: ${fileName} (${scriptType}) (${Entity.Script.E_CompilationStatus.COMPILING})`,
                    type: "info",
                    suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                });

                // Compile the script
                const compiledResult = await compileScript(
                    content,
                    scriptType,
                    filePath,
                );

                // Update the database with compiled result
                await sql`
                    UPDATE entity.entity_scripts
                    SET script__compiled__data = ${compiledResult.data},
                        script__compiled__sha256 = ${compiledResult.hash},
                        script__compiled__status = ${compiledResult.status},
                        script__compiled__updated_at = CURRENT_TIMESTAMP
                    WHERE general__script_file_name = ${fileName}
                `;

                // Update local tracking map
                localScriptInfoMap.set(fileName, {
                    name: fileName,
                    type: scriptType,
                    sourceHash,
                    compiledHash: compiledResult.hash,
                    lastChecked: new Date(),
                });

                log({
                    message: `Updated script in database: ${fileName} (${compiledResult.status})`,
                    type:
                        compiledResult.status ===
                        Entity.Script.E_CompilationStatus.COMPILED
                            ? "success"
                            : "warn",
                    suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                });
            } catch (error) {
                // Set script compilation to failed.
                await sql`
                    UPDATE entity.entity_scripts
                    SET script__compiled__status = ${Entity.Script.E_CompilationStatus.FAILED},
                        script__compiled__updated_at = CURRENT_TIMESTAMP
                    WHERE general__script_file_name = ${fileName}
                `;

                log({
                    message: `Error updating script in database: ${fileName} (${Entity.Script.E_CompilationStatus.FAILED})`,
                    type: "error",
                    error,
                    suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                });
            }
        };

        // Function to download scripts from database to local sync directory
        const downloadScriptsFromDatabase = async (): Promise<void> => {
            try {
                // Get all scripts from database
                const dbScripts = await sql<
                    Array<
                        Pick<
                            Entity.Script.I_Script,
                            | "general__script_file_name"
                            | "script__type"
                            | "script__source__data"
                            | "script__source__sha256"
                        >
                    >
                >`
                    SELECT 
                        general__script_file_name, 
                        script__type, 
                        script__source__data, 
                        script__source__sha256
                    FROM entity.entity_scripts
                    WHERE script__type = ANY(${VALID_SCRIPT_TYPES})
                `;

                for (const script of dbScripts) {
                    const fileName = script.general__script_file_name;
                    const filePath = path.join(syncDir, fileName);

                    // Check if file already exists locally
                    try {
                        if (existsSync(filePath)) {
                            // File exists, get its content and hash
                            const localContent = await readFile(
                                filePath,
                                "utf-8",
                            );
                            const localHash = hasher
                                .update(localContent)
                                .digest("hex");

                            // Skip if local file exists and we're not supposed to overwrite
                            if (localHash !== script.script__source__sha256) {
                                log({
                                    message: `Skipping download of ${fileName} - local file exists with different hash`,
                                    type: "info",
                                    suppress:
                                        VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                                });
                            }
                        } else {
                            // File doesn't exist locally, download it
                            await writeFile(
                                filePath,
                                script.script__source__data,
                            );

                            // Update local tracking map
                            localScriptInfoMap.set(fileName, {
                                name: fileName,
                                type: script.script__type,
                                sourceHash: script.script__source__sha256,
                                compiledHash: "", // Will be updated later
                                lastChecked: new Date(),
                            });

                            log({
                                message: `Downloaded script from database: ${fileName}`,
                                type: "success",
                                suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                                debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                            });
                        }
                    } catch (error) {
                        log({
                            message: `Error processing script: ${fileName}`,
                            type: "error",
                            error,
                            suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                            debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                        });
                    }
                }
            } catch (error) {
                log({
                    message: "Error downloading scripts from database",
                    type: "error",
                    error,
                    suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                });
            }
        };

        // Handle file change event
        const handleFileChange = async (filePath: string): Promise<void> => {
            if (!filePath) return;

            const fileName = path.basename(filePath);
            if (!fileName) return;

            try {
                // Check if file exists
                if (existsSync(filePath)) {
                    log({
                        message: `Detected change in script: ${fileName}`,
                        type: "info",
                        suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                        debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                    });

                    await updateScriptInDatabase(filePath, fileName);
                }
            } catch (error) {
                log({
                    message: `Error handling file change: ${fileName}`,
                    type: "error",
                    error,
                    suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                });
            }
        };

        // Initial sync - download scripts from database
        await downloadScriptsFromDatabase();

        // Initial scan of local directory
        const initialFiles = await readdir(syncDir);
        for (const fileName of initialFiles) {
            const filePath = path.join(syncDir, fileName);
            try {
                // Process each file
                await updateScriptInDatabase(filePath, fileName);
            } catch (error) {
                log({
                    message: `Error processing file: ${fileName}`,
                    type: "error",
                    error,
                    suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                });
            }
        }

        // Set up file watcher for local script changes
        const watcher = watch(syncDir, {
            recursive: true,
        });

        // Process watcher events
        let watcherActive = true;
        (async () => {
            try {
                for await (const event of watcher) {
                    if (!watcherActive) break;
                    // Only process file events for JavaScript/TypeScript files
                    if (
                        event.filename &&
                        /\.(js|ts|jsx|tsx)$/.test(event.filename)
                    ) {
                        await handleFileChange(
                            path.join(syncDir, event.filename),
                        );
                    }
                }
            } catch (error) {
                if (watcherActive) {
                    log({
                        message: `Watcher error: ${error}`,
                        type: "error",
                        error,
                        suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                        debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                    });
                }
            }
        })();

        // Set up polling interval for database changes using setInterval
        const pollTimer = setInterval(async () => {
            await downloadScriptsFromDatabase();
        }, RETRIEVE_NEW_SCRIPTS_INTERVAL);

        // Handle cleanup on process termination
        const cleanup = () => {
            watcherActive = false;
            clearInterval(pollTimer);
            log({
                message: "Hot script sync stopped",
                type: "info",
                suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
            });
        };

        process.on("SIGINT", cleanup);
        process.on("SIGTERM", cleanup);

        // Keep process running
        return new Promise<void>(() => {
            // This promise intentionally never resolves to keep the process running
            log({
                message: `Hot web script sync running.\n    Sync directory: ${syncDir}\n    Retrieve new scripts interval: ${RETRIEVE_NEW_SCRIPTS_INTERVAL}ms`,
                type: "success",
                suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
            });
        });
    }
}

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

            VRCA_CLIENT_WEB_BABYLON_JS_DEV_CONTAINER_NAME:
                VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEV_CONTAINER_NAME,
            VRCA_CLIENT_WEB_BABYLON_JS_DEV_HOST_CONTAINER_BIND_EXTERNAL:
                VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEV_HOST_CONTAINER_BIND_EXTERNAL,
            VRCA_CLIENT_WEB_BABYLON_JS_DEV_PORT_CONTAINER_BIND_EXTERNAL:
                VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEV_PORT_CONTAINER_BIND_EXTERNAL.toString(),
            VRCA_CLIENT_WEB_BABYLON_JS_DEV_PORT_CONTAINER_BIND_INTERNAL:
                VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEV_PORT_CONTAINER_BIND_INTERNAL.toString(),

            VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN:
                VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN,

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

    // Client health check function
    export async function isWebBabylonJsHealthy(data: {
        type: "prod" | "dev";
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
                    data.type === "prod"
                        ? `http://${VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_PRODUCTION_HOST_CONTAINER_BIND_EXTERNAL}:${VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_PRODUCTION_PORT_CONTAINER_BIND_EXTERNAL}`
                        : `http://${VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEV_HOST_CONTAINER_BIND_EXTERNAL}:${VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEV_PORT_CONTAINER_BIND_EXTERNAL}`,
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

    // Separate seed functions for SQL, assets, and scripts
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
        const sqlDir =
            VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_SEED_SQL_DIR;

        try {
            const filesInSqlDir = await readdir(sqlDir);
            const sqlFiles = filesInSqlDir
                .filter((f) => f.endsWith(".sql"))
                .sort();

            if (sqlFiles.length === 0) {
                log({
                    message: `No SQL seed files found in ${sqlDir}`,
                    type: "info",
                    suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                });
                return;
            }

            log({
                message: `Found ${sqlFiles.length} SQL seed files in ${sqlDir}`,
                type: "debug",
                suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
            });

            // Get already executed seeds - querying by hash
            const result =
                await sql`SELECT general__hash, general__name FROM config.seeds`;
            const executedHashes = new Set(result.map((r) => r.general__hash));
            const executedNames = new Map(
                result.map((r) => [r.general__name, r.general__hash]),
            );

            // Process SQL files sequentially (required for SQL)
            for (const sqlFile of sqlFiles) {
                log({
                    message: `Found seed ${sqlFile}...`,
                    type: "debug",
                    suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                });

                const filePath = path.join(sqlDir, sqlFile);
                const sqlContent = await readFile(filePath, "utf-8");

                // Calculate MD5 hash of the seed content
                const contentHash = new Bun.CryptoHasher("md5")
                    .update(sqlContent)
                    .digest("hex");

                if (!executedHashes.has(contentHash)) {
                    // If the seed name exists but with a different hash, log a warning
                    if (
                        executedNames.has(sqlFile) &&
                        executedNames.get(sqlFile) !== contentHash
                    ) {
                        log({
                            message: `Warning: Seed ${sqlFile} has changed since it was last executed`,
                            type: "warn",
                            suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                            debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                        });
                    }

                    log({
                        message: `Executing seed ${sqlFile} (hash: ${contentHash})...`,
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
                                VALUES (${contentHash}, ${sqlFile})
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
        };
    }) {
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

        const assetDir =
            VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_SEED_ASSET_DIR;

        try {
            const assetFiles = await readdir(assetDir);

            if (assetFiles.length === 0) {
                log({
                    message: `No asset files found in ${assetDir}`,
                    type: "info",
                    suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                });
                return;
            }

            log({
                message: `Found ${assetFiles.length} asset files in ${assetDir}`,
                type: "debug",
                suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
            });

            // Prepare for efficient matching
            const assetFileNames = assetFiles.map((file) => {
                const parsedName = path.parse(file);
                return {
                    fileName: file,
                    searchName: parsedName.name + parsedName.ext,
                };
            });

            // Get all assets from the database with one query
            const dbAssets = await sql<{ general__asset_file_name: string }[]>`
                SELECT general__asset_file_name FROM entity.entity_assets
            `;

            log({
                message: `Found ${dbAssets.length} assets in database`,
                type: "debug",
                suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
            });

            // Function to process a single asset file
            const processAssetFile = async ({
                fileName,
                searchName,
            }: { fileName: string; searchName: string }) => {
                const assetPath = path.join(assetDir, fileName);

                // Find matches
                const matchingAssets = dbAssets.filter((dbAsset) =>
                    dbAsset.general__asset_file_name.includes(searchName),
                );

                if (matchingAssets.length === 0) {
                    log({
                        message: `No matching asset found in database for file: ${fileName}`,
                        type: "warn",
                        suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                        debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                    });
                    return;
                }

                // Read asset file content as buffer - only read once
                const assetData = await Bun.file(assetPath).arrayBuffer();
                const assetBuffer = Buffer.from(assetData);

                // Update all matching assets in a single transaction
                try {
                    await sql.begin(async (sql) => {
                        for (const dbAsset of matchingAssets) {
                            await sql`
                                UPDATE entity.entity_assets 
                                SET asset__data = ${assetBuffer}
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

            // Process assets in parallel or sequentially
            if (options.parallelProcessing) {
                // Process in batches
                for (
                    let i = 0;
                    i < assetFileNames.length;
                    i += options.batchSize
                ) {
                    const batch = assetFileNames.slice(
                        i,
                        i + options.batchSize,
                    );
                    await Promise.all(batch.map(processAssetFile));
                }
            } else {
                for (const assetFile of assetFileNames) {
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

    export async function seedScripts(data: {
        options?: {
            parallelProcessing?: boolean;
            batchSize?: number;
        };
    }) {
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

        const scriptDir =
            VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_SEED_SCRIPT_DIR;

        try {
            const scriptFiles = await readdir(scriptDir);

            if (scriptFiles.length === 0) {
                log({
                    message: `No script files found in ${scriptDir}`,
                    type: "info",
                    suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                });
                return;
            }

            log({
                message: `Found ${scriptFiles.length} script files in ${scriptDir}`,
                type: "debug",
                suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
            });

            // Prepare for efficient matching
            const scriptFileNames = scriptFiles.map((file) => {
                const parsedName = path.parse(file);
                return {
                    fileName: file,
                    searchName: parsedName.name + parsedName.ext,
                };
            });

            // Get all scripts from the database with one query
            const dbScripts = await sql<
                { general__script_file_name: string }[]
            >`
                SELECT general__script_file_name FROM entity.entity_scripts
            `;

            // Function to process a single script file
            const processScriptFile = async ({
                fileName,
                searchName,
            }: { fileName: string; searchName: string }) => {
                const scriptPath = path.join(scriptDir, fileName);

                // Find matches
                const matchingScripts = dbScripts.filter((dbScript) =>
                    dbScript.general__script_file_name.includes(searchName),
                );

                if (matchingScripts.length === 0) {
                    log({
                        message: `No matching script found in database for file: ${fileName}`,
                        type: "warn",
                        suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                        debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                    });
                    return;
                }

                // Read script file content - only read once
                const scriptData = await Bun.file(scriptPath).text();

                // Update all matching scripts in a single transaction
                try {
                    await sql.begin(async (sql) => {
                        for (const dbScript of matchingScripts) {
                            await sql`
                                UPDATE entity.entity_scripts 
                                SET script__compiled__data = ${scriptData}
                                WHERE general__script_file_name = ${dbScript.general__script_file_name}
                            `;
                        }
                    });

                    log({
                        message: `Updated ${matchingScripts.length} scripts from file ${fileName}`,
                        type: "debug",
                        suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                        debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                    });
                } catch (error) {
                    log({
                        message: `Failed to update scripts from file ${fileName}`,
                        type: "error",
                        error: error,
                        suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                        debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                    });
                }
            };

            // Process scripts in parallel or sequentially
            if (options.parallelProcessing) {
                // Process in batches
                for (
                    let i = 0;
                    i < scriptFileNames.length;
                    i += options.batchSize
                ) {
                    const batch = scriptFileNames.slice(
                        i,
                        i + options.batchSize,
                    );
                    await Promise.all(batch.map(processScriptFile));
                }
            } else {
                for (const scriptFile of scriptFileNames) {
                    await processScriptFile(scriptFile);
                }
            }

            log({
                message: "Script seeding completed successfully",
                type: "success",
                suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
            });
        } catch (error) {
            log({
                message: `Error processing script files: ${error instanceof Error ? error.message : String(error)}`,
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
                log({
                    message: "Generating system token...",
                    type: "info",
                    suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                });
                const { token, sessionId, agentId } =
                    await Server_CLI.generateDbSystemToken();
                log({
                    message: `System agent token: ${token}`,
                    data: { sessionId, agentId },
                    type: "success",
                    suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                });
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

            case "server:postgres:seed:scripts": {
                log({
                    message: "Running database script seeds...",
                    type: "info",
                    suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                });
                await Server_CLI.seedScripts({
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
                    message: "Script seeds applied.",
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

                const health = await Client_CLI.isWebBabylonJsHealthy({
                    type: "prod",
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

            case "client:web_babylon_js_dev:health": {
                let waitInterval: number | undefined;
                let waitTimeout: number | undefined;

                if (additionalArgs.length > 0) {
                    waitInterval = Number.parseInt(additionalArgs[0]);
                    waitTimeout = Number.parseInt(additionalArgs[1]);
                }

                const health = await Client_CLI.isWebBabylonJsHealthy({
                    type: "dev",
                    wait:
                        waitInterval && waitTimeout
                            ? {
                                  interval: waitInterval,
                                  timeout: waitTimeout,
                              }
                            : undefined,
                });
                log({
                    message: `Web Babylon JS (Development): ${health.isHealthy ? "healthy" : "unhealthy"}`,
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

            case "dev:hot-sync:web-scripts": {
                await WebScript_CLI.startSync();
                break;
            }

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
