import { readdir, readFile, writeFile, mkdir, watch } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { log } from "../../sdk/vircadia-world-sdk-ts/module/general/log.ts";
import { VircadiaConfig_CLI } from "../../sdk/vircadia-world-sdk-ts/config/vircadia.cli.config.ts";
import { PostgresClient } from "../../sdk/vircadia-world-sdk-ts/module/server/postgres.server.client.ts";
import { existsSync } from "node:fs";
import { Entity } from "../../sdk/vircadia-world-sdk-ts/schema/schema.general.ts";

// Interface for tracking script information
interface ScriptInfo {
    name: string;
    type: string;
    sourceHash: string;
    compiledHash: string;
    lastChecked: Date;
}

// Helper function to calculate SHA-256 hash of content
const calculateHash = (content: string): string => {
    return createHash("sha256").update(content).digest("hex");
};

// Define valid script types
const VALID_SCRIPT_TYPES = ["BABYLON_NODE", "BABYLON_BUN", "BABYLON_BROWSER"];

export namespace AssetHotSync {}

export namespace WebScriptHotSync {
    // Function to compile script based on type
    async function compileScript(
        source: string,
        type: string,
        debug?: boolean,
    ): Promise<{ data: string; hash: string; status: string }> {
        try {
            let compiledData: string;

            switch (type) {
                case Entity.Script.E_ScriptType.BABYLON_NODE: {
                    // For Node/Bun scripts, use Bun's transpiler
                    const result = await Bun.build({
                        entrypoints: [
                            new URL(
                                `data:application/javascript;base64,${btoa(source)}`,
                            ).toString(),
                        ],
                        format: "esm",
                        target: "node",
                        minify: true,
                    });

                    if (!result.success) {
                        return {
                            data: source, // Return source on compilation failure
                            hash: calculateHash(source),
                            status: "FAILED",
                        };
                    }

                    compiledData = await result.outputs[0].text();
                    break;
                }
                case Entity.Script.E_ScriptType.BABYLON_BUN: {
                    // For Bun scripts, use Bun's transpiler
                    const result = await Bun.build({
                        entrypoints: [
                            new URL(
                                `data:application/javascript;base64,${btoa(source)}`,
                            ).toString(),
                        ],
                        format: "esm",
                        target: "bun",
                        minify: true,
                    });

                    if (!result.success) {
                        return {
                            data: source, // Return source on compilation failure
                            hash: calculateHash(source),
                            status: "FAILED",
                        };
                    }

                    compiledData = await result.outputs[0].text();
                    break;
                }
                case Entity.Script.E_ScriptType.BABYLON_BROWSER: {
                    // For browser scripts, use browser target
                    const browserResult = await Bun.build({
                        entrypoints: [
                            new URL(
                                `data:application/javascript;base64,${btoa(source)}`,
                            ).toString(),
                        ],
                        format: "esm",
                        target: "browser",
                        minify: true,
                    });

                    if (!browserResult.success) {
                        return {
                            data: source, // Return source on compilation failure
                            hash: calculateHash(source),
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

            const hash = calculateHash(compiledData);
            return { data: compiledData, hash, status: "COMPILED" };
        } catch (error) {
            log({
                message: `Compilation error: ${error}`,
                type: "error",
                error,
                suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                debug,
            });

            return {
                data: source, // Return source on compilation error
                hash: calculateHash(source),
                status: "FAILED",
            };
        }
    }

    // Main function to handle hot sync of scripts
    export async function startSync(): Promise<void> {
        const RETRIEVE_NEW_SCRIPTS_INTERVAL = 5000; // Default to 5 seconds
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
                const sourceHash = calculateHash(content);

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
                    scriptRecord?.script__type || "BABYLON_BROWSER";

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
                    SET script__compiled__status = 'COMPILING',
                        script__source__data = ${content},
                        script__source__sha256 = ${sourceHash},
                        script__source__updated_at = CURRENT_TIMESTAMP
                    WHERE general__script_file_name = ${fileName}
                `;

                log({
                    message: `Compiling script: ${fileName} (${scriptType})`,
                    type: "info",
                    suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                });

                // Compile the script
                const compiledResult = await compileScript(content, scriptType);

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
                        compiledResult.status === "COMPILED"
                            ? "success"
                            : "warn",
                    suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                });
            } catch (error) {
                // Set script compilation to failed.
                await sql`
                    UPDATE entity.entity_scripts
                    SET script__compiled__status = 'FAILED',
                        script__compiled__updated_at = CURRENT_TIMESTAMP
                    WHERE general__script_file_name = ${fileName}
                `;

                log({
                    message: `Error updating script in database: ${fileName}`,
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
                        script__source__sha256,
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
                            const localHash = calculateHash(localContent);

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
                message: "Hot web script sync running.",
                data: {
                    syncDir,
                },
                type: "success",
                suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
            });
        });
    }
}
