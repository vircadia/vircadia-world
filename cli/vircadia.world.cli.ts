import { VircadiaConfig_CLI } from "../sdk/vircadia-world-sdk-ts/config/vircadia.cli.config.ts";
import { VircadiaConfig_BROWSER_CLIENT } from "../sdk/vircadia-world-sdk-ts/config/vircadia.browser.client.config.ts";
import { VircadiaConfig_SERVER } from "../sdk/vircadia-world-sdk-ts/config/vircadia.server.config.ts";
import { log } from "../sdk/vircadia-world-sdk-ts/module/general/log.ts";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import {
    readdir,
    readFile,
    watch,
    writeFile,
    type FileChangeInfo,
} from "node:fs/promises";
import { sign } from "jsonwebtoken";
import { PostgresClient } from "../sdk/vircadia-world-sdk-ts/module/server/postgres.server.client.ts";
import {
    Entity,
    Service,
    type Auth,
} from "../sdk/vircadia-world-sdk-ts/schema/schema.general.ts";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { basename } from "node:path";

// TODO: Optimize the commands, get up and down rebuilds including init to work well.

// https://github.com/tj/commander.js
// https://www.npmjs.com/package/inquirer

export namespace WebScript_CLI {
    const VALID_SCRIPT_TYPES = [
        "BABYLON_NODE",
        "BABYLON_BUN",
        "BABYLON_BROWSER",
    ];

    interface ScriptInfo {
        name: string;
        type: string;
        sourceHash: string;
        compiledHash: string;
        lastChecked: Date;
    }

    // Track all ongoing compilations
    const activeCompilations = new Set<AbortController>();

    // Function to compile script based on type
    export async function compileScript(
        source: string,
        type: string,
        filePath: string,
    ): Promise<{
        data: string;
        hash: string;
        status: Entity.Script.E_CompilationStatus;
    }> {
        const abortController = new AbortController();
        activeCompilations.add(abortController);

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
                            hash: "", // We'll calculate this in the database
                            status: Entity.Script.E_CompilationStatus.FAILED,
                        };
                    }

                    if (nodeResult.outputs.length > 1) {
                        log({
                            message: `Node compilation produced multiple outputs: ${nodeResult.outputs.length}`,
                            type: "error",
                            suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                            debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                        });
                        return {
                            data: source, // Return source on compilation failure
                            hash: "", // We'll calculate this in the database
                            status: Entity.Script.E_CompilationStatus.FAILED,
                        };
                    }

                    compiledData = await nodeResult.outputs[0].text();
                    break;
                }
                case Entity.Script.E_ScriptType.BABYLON_BUN: {
                    // For Bun scripts, use Bun's transpiler with IIFE format
                    const bunResult = await Bun.build({
                        entrypoints: [filePath],
                        format: "esm",
                        target: "bun",
                        minify: true,
                    });

                    if (!bunResult.success) {
                        return {
                            data: source, // Return source on compilation failure
                            hash: "", // We'll calculate this in the database
                            status: Entity.Script.E_CompilationStatus.FAILED,
                        };
                    }

                    if (bunResult.outputs.length > 1) {
                        log({
                            message: `Bun compilation produced multiple outputs: ${bunResult.outputs.length}`,
                            type: "error",
                            suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                            debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                        });
                        return {
                            data: source, // Return source on compilation failure
                            hash: "", // We'll calculate this in the database
                            status: Entity.Script.E_CompilationStatus.FAILED,
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
                            hash: "", // We'll calculate this in the database
                            status: Entity.Script.E_CompilationStatus.FAILED,
                        };
                    }

                    if (browserResult.outputs.length > 1) {
                        log({
                            message: `Browser compilation produced multiple outputs: ${browserResult.outputs.length}`,
                            type: "error",
                            suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                            debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                        });
                        return {
                            data: source, // Return source on compilation failure
                            hash: "", // We'll calculate this in the database
                            status: Entity.Script.E_CompilationStatus.FAILED,
                        };
                    }

                    compiledData = await browserResult.outputs[0].text();
                    break;
                }
                default:
                    // Default fallback - no compilation
                    compiledData = source;
            }

            return {
                data: compiledData || source,
                hash: "", // We'll calculate this in the database
                status: compiledData
                    ? Entity.Script.E_CompilationStatus.COMPILED
                    : Entity.Script.E_CompilationStatus.FAILED,
            };
        } catch (error) {
            log({
                message: `Compilation error: ${error}`,
                type: "error",
                error,
                suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
            });

            return {
                data: source,
                hash: "", // We'll calculate this in the database
                status: Entity.Script.E_CompilationStatus.FAILED,
            };
        } finally {
            activeCompilations.delete(abortController);
        }
    }

    // Main function to handle hot sync of scripts
    export async function startSync(options?: {
        syncGroup?: string;
    }): Promise<void> {
        const RETRIEVE_NEW_SCRIPTS_INTERVAL = 500;
        const COMPILE_FORCE = false;
        const syncGroup = options?.syncGroup;

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

                // Check if script exists in database and belongs to specified sync group
                const scriptQuery = syncGroup
                    ? sql`
                        SELECT COUNT(*) as count 
                        FROM entity.entity_scripts 
                        WHERE general__script_file_name = ${fileName}
                        AND group__sync = ${syncGroup}
                      `
                    : sql`
                        SELECT COUNT(*) as count 
                        FROM entity.entity_scripts 
                        WHERE general__script_file_name = ${fileName}
                      `;

                const [scriptExists] = await scriptQuery;

                if (!scriptExists || scriptExists.count === 0) {
                    log({
                        message: syncGroup
                            ? `Skipping script: ${fileName} - does not exist in database or not in sync group '${syncGroup}'`
                            : `Skipping script: ${fileName} - does not exist in database`,
                        type: "info",
                        suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                        debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                    });
                    return;
                }

                // Get current hash from database using pgcrypto
                const [currentHash] = await sql<[{ source_hash: string }]>`
                    SELECT encode(digest(script__source__data, 'sha256'), 'hex') as source_hash
                    FROM entity.entity_scripts
                    WHERE general__script_file_name = ${fileName}
                `;

                // Calculate new hash using pgcrypto
                const [newHash] = await sql<[{ source_hash: string }]>`
                    SELECT encode(digest(${content}, 'sha256'), 'hex') as source_hash
                `;

                // Check if we need to update
                if (
                    !COMPILE_FORCE &&
                    currentHash?.source_hash === newHash?.source_hash
                ) {
                    // No changes detected
                    return;
                }

                // Get script type from database
                const [scriptRecord] = await sql<
                    Array<Pick<Entity.Script.I_Script, "script__platform">>
                >`
                    SELECT script__platform 
                    FROM entity.entity_scripts 
                    WHERE general__script_file_name = ${fileName}
                `;

                const scriptType =
                    scriptRecord?.script__platform ||
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

                log({
                    message: `Successfully compiled script: ${fileName}`,
                    type: "info",
                    suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                });

                // Update the database with compiled result
                await sql`
                    UPDATE entity.entity_scripts
                    SET script__compiled__data = ${compiledResult.data},
                        script__compiled__status = ${compiledResult.status},
                        script__compiled__updated_at = CURRENT_TIMESTAMP
                    WHERE general__script_file_name = ${fileName}
                `;

                // Update local tracking map
                localScriptInfoMap.set(fileName, {
                    name: fileName,
                    type: scriptType,
                    sourceHash: compiledResult.hash,
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
                // Filter scripts by sync group if specified
                const scriptsQuery = syncGroup
                    ? sql`
                        SELECT * FROM entity.entity_scripts 
                        WHERE group__sync = ${syncGroup}
                      `
                    : sql`
                        SELECT * FROM entity.entity_scripts
                      `;

                const scripts = await scriptsQuery;

                // Log the filtering status
                log({
                    message: syncGroup
                        ? `Retrieved ${scripts.length} scripts with sync group: ${syncGroup}`
                        : `Retrieved ${scripts.length} scripts from database`,
                    type: "debug",
                    suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                });

                for (const script of scripts) {
                    const fileName = script.general__script_file_name;
                    const filePath = path.join(syncDir, fileName);

                    // Check if file already exists locally
                    try {
                        if (existsSync(filePath)) {
                            // File exists, get its content and calculate hash using pgcrypto
                            const localContent = await readFile(
                                filePath,
                                "utf-8",
                            );
                            const [{ local_hash }] = await sql<
                                [{ local_hash: string }]
                            >`
                                SELECT encode(digest(${localContent}, 'sha256'), 'hex') as local_hash
                            `;

                            // Skip if local file exists and we're not supposed to overwrite
                            if (local_hash !== script.script__source__sha256) {
                                log({
                                    message: `Skipping download of ${fileName} - local file exists with different hash`,
                                    type: "debug",
                                    suppress:
                                        VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                                });
                            }
                        } else {
                            log({
                                message: `Downloading new script from database: ${fileName}`,
                                type: "info",
                                suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                                debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                            });

                            // File doesn't exist locally, download it
                            await writeFile(
                                filePath,
                                script.script__source__data,
                            );

                            // Update local tracking map
                            localScriptInfoMap.set(fileName, {
                                name: fileName,
                                type: script.script__platform,
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
            const fileName = basename(filePath);

            try {
                // Check if file belongs to specified sync group before processing
                if (syncGroup) {
                    // Query to check if file belongs to the specified sync group
                    const [fileInSyncGroup] = await sql<[{ count: number }]>`
                        SELECT COUNT(*) as count 
                        FROM entity.entity_scripts 
                        WHERE general__script_file_name = ${fileName}
                        AND group__sync = ${syncGroup}
                    `;

                    if (!fileInSyncGroup || fileInSyncGroup.count === 0) {
                        log({
                            message: `Skipping file change for ${fileName} - not in sync group '${syncGroup}'`,
                            type: "info",
                            suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                            debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                        });
                        return;
                    }
                }

                // Proceed with normal file change handling
                log({
                    message: `Detected change in script: ${fileName}`,
                    type: "info",
                    suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                });

                await updateScriptInDatabase(filePath, fileName);
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
        let watcher: AsyncIterable<FileChangeInfo<string>>;
        let watcherActive = true;

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
            // In cleanup, abort any active compilations
            for (const controller of activeCompilations) {
                controller.abort();
            }
            activeCompilations.clear();
        };

        try {
            watcher = watch(syncDir, { recursive: true });

            // Process watcher events with better error handling
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
                    log({ message: `Watcher error: ${error}`, type: "error" });
                    if (watcherActive) cleanup();
                } finally {
                    if (watcherActive) {
                        // If we exited the loop but are still active, restart watcher
                        log({
                            message:
                                "Watcher stopped unexpectedly, restarting...",
                            type: "warn",
                        });
                        // Code to restart watcher
                    }
                }
            })();
        } catch (error) {
            log({
                message: `Failed to create watcher: ${error}`,
                type: "error",
            });
            cleanup();
        }

        // Set up polling interval for database changes using setInterval
        const pollTimer = setInterval(async () => {
            try {
                await downloadScriptsFromDatabase();
            } catch (error) {
                log({ message: `Poll error: ${error}`, type: "error" });
            }
        }, RETRIEVE_NEW_SCRIPTS_INTERVAL);

        process.on("SIGINT", cleanup);
        process.on("SIGTERM", cleanup);
        process.on("SIGHUP", cleanup);
        process.on("uncaughtException", (error) => {
            log({ message: `Uncaught exception: ${error}`, type: "error" });
            cleanup();
            process.exit(1);
        });
        process.on("unhandledRejection", (reason) => {
            log({ message: `Unhandled rejection: ${reason}`, type: "error" });
            cleanup();
            process.exit(1);
        });

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
                    const filesInSystemSqlDir = await readdir(systemSqlDir);
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
                    const filesInUserSqlDir = await readdir(userSqlDir);
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
            let systemAssetFiles: string[] = [];
            if (systemAssetDir) {
                try {
                    const filesInSystemAssetDir = await readdir(systemAssetDir);
                    systemAssetFiles = filesInSystemAssetDir.filter((file) => {
                        const ext = path.extname(file).toLowerCase();
                        return [
                            ".jpg",
                            ".jpeg",
                            ".png",
                            ".gif",
                            ".webp",
                            ".svg",
                            ".glb",
                            ".gltf",
                            ".bin",
                            ".mp3",
                            ".wav",
                            ".ogg",
                        ].includes(ext);
                    });

                    log({
                        message: `Found ${systemAssetFiles.length} system asset files in ${systemAssetDir}`,
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
            let userAssetFiles: string[] = [];
            if (userAssetDir) {
                try {
                    const filesInUserAssetDir = await readdir(userAssetDir);
                    userAssetFiles = filesInUserAssetDir.filter((file) => {
                        const ext = path.extname(file).toLowerCase();
                        return [
                            ".jpg",
                            ".jpeg",
                            ".png",
                            ".gif",
                            ".webp",
                            ".svg",
                            ".glb",
                            ".gltf",
                            ".bin",
                            ".mp3",
                            ".wav",
                            ".ogg",
                        ].includes(ext);
                    });

                    log({
                        message: `Found ${userAssetFiles.length} user asset files in ${userAssetDir}`,
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

            if (systemAssetFiles.length === 0 && userAssetFiles.length === 0) {
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
                ? systemAssetFiles.map((file) => {
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
                ? userAssetFiles.map((file) => {
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

    export async function seedScripts(data: {
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

        // Get paths for both system and user script directories
        const systemScriptDir =
            VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_SEED_SYSTEM_SCRIPT_DIR;
        const userScriptDir =
            VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_SEED_USER_SCRIPT_DIR;

        try {
            // Get all scripts from the database with one query
            const dbScripts = await sql<
                Array<
                    Pick<
                        Entity.Script.I_Script,
                        "general__script_file_name" | "script__platform"
                    >
                >
            >`
                SELECT general__script_file_name, script__platform FROM entity.entity_scripts
            `;

            log({
                message: `Found ${dbScripts.length} scripts in database`,
                type: "debug",
                suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
            });

            // Process system script files
            let systemScriptFiles: string[] = [];
            if (systemScriptDir) {
                try {
                    const filesInSystemScriptDir =
                        await readdir(systemScriptDir);
                    systemScriptFiles = filesInSystemScriptDir.filter((f) =>
                        /\.(js|ts|jsx|tsx)$/.test(f),
                    );

                    log({
                        message: `Found ${systemScriptFiles.length} system script files in ${systemScriptDir}`,
                        type: "debug",
                        suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                        debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                    });
                } catch (error) {
                    log({
                        message: `No system script files found or error accessing directory: ${systemScriptDir}`,
                        type: "warn",
                        error,
                        suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                        debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                    });
                }
            } else {
                log({
                    message: "System script directory not configured",
                    type: "warn",
                    suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                });
            }

            // Process user script files
            let userScriptFiles: string[] = [];
            if (userScriptDir) {
                try {
                    const filesInUserScriptDir = await readdir(userScriptDir);
                    userScriptFiles = filesInUserScriptDir.filter((f) =>
                        /\.(js|ts|jsx|tsx)$/.test(f),
                    );

                    log({
                        message: `Found ${userScriptFiles.length} user script files in ${userScriptDir}`,
                        type: "debug",
                        suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                        debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                    });
                } catch (error) {
                    log({
                        message: `No user script files found or error accessing directory: ${userScriptDir}`,
                        type: "warn",
                        error,
                        suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                        debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                    });
                }
            } else {
                log({
                    message: "User script directory not configured",
                    type: "warn",
                    suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                });
            }

            if (
                systemScriptFiles.length === 0 &&
                userScriptFiles.length === 0
            ) {
                log({
                    message: `No script files found in either ${systemScriptDir || "undefined"} or ${userScriptDir || "undefined"}`,
                    type: "info",
                    suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                });
                return;
            }

            // Prepare system script files for processing
            const systemScriptFileNames = systemScriptDir
                ? systemScriptFiles.map((file) => {
                      const parsedName = path.parse(file);
                      return {
                          fileName: file,
                          searchName: parsedName.name + parsedName.ext,
                          directory: systemScriptDir,
                      };
                  })
                : [];

            // Prepare user script files for processing
            const userScriptFileNames = userScriptDir
                ? userScriptFiles.map((file) => {
                      const parsedName = path.parse(file);
                      return {
                          fileName: file,
                          searchName: parsedName.name + parsedName.ext,
                          directory: userScriptDir,
                      };
                  })
                : [];

            // Combine all script files, with user scripts taking precedence
            // over system scripts with the same name
            const allScriptFileNames = [...systemScriptFileNames];

            // Add user scripts, overriding any system scripts with the same searchName
            for (const userScript of userScriptFileNames) {
                const systemScriptIndex = allScriptFileNames.findIndex(
                    (script) => script.searchName === userScript.searchName,
                );

                if (systemScriptIndex >= 0) {
                    // Replace the system script with the user script
                    allScriptFileNames[systemScriptIndex] = userScript;
                    log({
                        message: `User script '${userScript.fileName}' overrides system script with the same name`,
                        type: "debug",
                        suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                        debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                    });
                } else {
                    // Add the user script
                    allScriptFileNames.push(userScript);
                }
            }

            // Function to process a single script file
            const processScriptFile = async ({
                fileName,
                searchName,
                directory,
            }: { fileName: string; searchName: string; directory: string }) => {
                const scriptPath = path.join(directory, fileName);

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
                            // Set status to COMPILING and update source
                            await sql`
                                UPDATE entity.entity_scripts
                                SET script__compiled__status = ${Entity.Script.E_CompilationStatus.COMPILING},
                                    script__source__data = ${scriptData},
                                    script__source__updated_at = CURRENT_TIMESTAMP
                                WHERE general__script_file_name = ${dbScript.general__script_file_name}
                            `;

                            log({
                                message: `Compiling script: ${dbScript.general__script_file_name} (${dbScript.script__platform}) (${Entity.Script.E_CompilationStatus.COMPILING})`,
                                type: "info",
                                suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                                debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                            });

                            // Compile the script using WebScript_CLI.compileScript
                            const compiledResult =
                                await WebScript_CLI.compileScript(
                                    scriptData,
                                    dbScript.script__platform,
                                    scriptPath,
                                );

                            // Update with compiled result
                            await sql`
                                UPDATE entity.entity_scripts
                                SET script__compiled__data = ${compiledResult.data},
                                    script__compiled__status = ${compiledResult.status},
                                    script__compiled__updated_at = CURRENT_TIMESTAMP
                                WHERE general__script_file_name = ${dbScript.general__script_file_name}
                            `;

                            log({
                                message: `Updated script: ${dbScript.general__script_file_name} (${compiledResult.status})`,
                                type:
                                    compiledResult.status ===
                                    Entity.Script.E_CompilationStatus.COMPILED
                                        ? "success"
                                        : "warn",
                                suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                                debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                            });
                        }
                    });

                    log({
                        message: `Processed ${matchingScripts.length} scripts from file ${fileName}`,
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

            // Filter scripts by sync group if specified
            let scriptsToProcess = allScriptFileNames;

            if (syncGroup) {
                // Get all scripts in the specified sync group
                const syncGroupScripts = await sql<
                    { general__script_file_name: string }[]
                >`
                    SELECT general__script_file_name 
                    FROM entity.entity_scripts 
                    WHERE group__sync = ${syncGroup}
                `;

                log({
                    message: `Found ${syncGroupScripts.length} scripts in sync group: ${syncGroup}`,
                    type: "info",
                    suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                });

                // Only process scripts that belong to this sync group
                scriptsToProcess = allScriptFileNames.filter((script) =>
                    syncGroupScripts.some((dbScript) =>
                        dbScript.general__script_file_name.includes(
                            script.searchName,
                        ),
                    ),
                );

                log({
                    message: `Will process ${scriptsToProcess.length} script files for sync group: ${syncGroup}`,
                    type: "info",
                    suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                });
            }

            // Then update the processing loops to use scriptsToProcess instead of allScriptFileNames:
            if (options.parallelProcessing) {
                // Process in batches
                for (
                    let i = 0;
                    i < scriptsToProcess.length;
                    i += options.batchSize
                ) {
                    const batch = scriptsToProcess.slice(
                        i,
                        i + options.batchSize,
                    );
                    await Promise.all(batch.map(processScriptFile));
                }
            } else {
                for (const scriptFile of scriptsToProcess) {
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
                const syncGroupIndex = additionalArgs.indexOf("--sync-group");
                const syncGroup =
                    syncGroupIndex > -1
                        ? additionalArgs[syncGroupIndex + 1]
                        : undefined;

                // Add timeout to force exit if stuck
                const timeoutId = setTimeout(
                    () => {
                        log({
                            message:
                                "Hot sync process timed out after 24 hours",
                            type: "warn",
                        });
                        process.exit(0);
                    },
                    24 * 60 * 60 * 1000,
                ); // 24 hour timeout

                try {
                    await WebScript_CLI.startSync({ syncGroup });
                } catch (error) {
                    log({
                        message: `Hot sync failed: ${error}`,
                        type: "error",
                    });
                } finally {
                    clearTimeout(timeoutId);
                    process.exit(0);
                }
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
