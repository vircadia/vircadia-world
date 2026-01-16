import { existsSync, mkdirSync, statSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path, { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { input, Separator, select } from "@inquirer/prompts";
import { $ } from "bun";
import { sign } from "jsonwebtoken";
import { type Browser, chromium, type Page } from "playwright";
import { clientBrowserConfiguration } from "../../sdk/vircadia-world-sdk-ts/browser/src/config/vircadia.browser.config";
import { serverConfiguration } from "../../sdk/vircadia-world-sdk-ts/bun/src/config/vircadia.server.config";
import { BunLogModule } from "../../sdk/vircadia-world-sdk-ts/bun/src/module/vircadia.common.bun.log.module";
import { BunPostgresClientModule } from "../../sdk/vircadia-world-sdk-ts/bun/src/module/vircadia.common.bun.postgres.module";
import type { Entity } from "../../sdk/vircadia-world-sdk-ts/schema/src/vircadia.schema.general";
import { cliConfiguration } from "../vircadia.cli.config";

// Hardcoded system directories
const SYSTEM_SQL_DIR = path.join(
    dirname(fileURLToPath(import.meta.url)),
    "../database/seed/sql/",
);

const SYSTEM_ASSET_DIR = path.join(
    dirname(fileURLToPath(import.meta.url)),
    "../database/seed/asset/",
);

const SYSTEM_RESET_DIR = path.join(
    dirname(fileURLToPath(import.meta.url)),
    "../database/reset",
);

const MIGRATION_DIR = path.join(
    dirname(fileURLToPath(import.meta.url)),
    "../database/migration",
);

const PROJECT_ROOT = path.join(
    dirname(fileURLToPath(import.meta.url)),
    "../../",
);

// Environment Variable Management Module
export namespace EnvManager {
    const CLI_ENV_FILE_PATH = path.join(
        dirname(fileURLToPath(import.meta.url)),
        "../.env",
    );

    const CLIENT_ENV_FILE_PATH = path.join(
        dirname(fileURLToPath(import.meta.url)),
        "../../client/web_babylon_js/.env",
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

export namespace AutonomousAgent_CLI {
    const DEV_PORT = clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEV_PORT;
    const DEV_HOST = "localhost";
    const ORIGIN = `http://${DEV_HOST}:${DEV_PORT}`;
    const BASE_URL = `${ORIGIN}?is_autonomous_agent=true`;

    let browser: Browser | undefined;
    let page: Page | undefined;

    async function startApplication(): Promise<void> {
        console.log(
            `🚀 Launching browser and connecting to ${BASE_URL} as anonymous autonomous agent`,
        );

        browser = await chromium.launch({
            headless: true,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-accelerated-2d-canvas",
                "--no-first-run",
                "--no-zygote",
                // Disable WebGPU - use WebGL software rendering instead
                "--disable-webgpu",
                "--ignore-gpu-blocklist",
                // Cross-origin isolation and workers features for ONNX/Transformers
                "--enable-features=SharedArrayBuffer,WebAssemblyThreads,WebAssemblySimd,WebAssemblySimd128,WebAssemblyTiering,WebAssemblyLazyCompilation",
                // Use ANGLE SwiftShader for WebGL software rendering
                "--enable-unsafe-swiftshader",
                "--use-angle=swiftshader",
                "--use-gl=swiftshader",
                // Fake audio device support
                // "--use-fake-device-for-media-stream",
                "--use-fake-ui-for-media-stream",
                "--autoplay-policy=no-user-gesture-required",
            ],
        });

        const context = await browser.newContext({
            viewport: { width: 1280, height: 720 },
        });

        // Grant microphone permission before creating page
        await context.grantPermissions(["microphone"], { origin: ORIGIN });

        page = await context.newPage();

        // Stop gracefully if the page crashes or closes
        page.on("crash", async () => {
            console.error("\n💥 Page crashed. Stopping state monitoring.");
            await cleanup();
        });
        page.on("close", async () => {
            console.error("\n🔒 Page closed. Stopping state monitoring.");
            await cleanup();
        });
        page.on("pageerror", (err: Error) => {
            console.error("\n💥 Page error:", err);
        });
        page.on("console", (msg: { type: () => string; text: () => string; location: () => { url: string; lineNumber: number; columnNumber: number } }) => {
            const loc = msg.location();
            console.log(
                `📜 [browser:${msg.type()}] ${msg.text()} (${loc.url}:${loc.lineNumber}:${loc.columnNumber})`,
            );
        });

        await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });

        // Wait for canvas element to exist
        await page.waitForSelector("canvas", { timeout: 30000 });
        console.log("✅ Canvas found");

        console.log("🎉 Application is ready! Press Ctrl+C to exit.");
    }

    function startStatePolling(page: Page): void {
        console.log("\n📊 Starting autonomous agent state monitoring...");

        let interval: ReturnType<typeof setInterval>;
        let stopped = false;

        const logState = async () => {
            try {
                if (stopped || page.isClosed()) {
                    return;
                }

                const state = await page.evaluate(() => {
                    const win = window as unknown as {
                        __VircadiaClientBrowserState__?: {
                            autonomousAgent?: unknown;
                        };
                    };
                    return win.__VircadiaClientBrowserState__?.autonomousAgent;
                });

                if (state && typeof state === "object") {
                    const agentState = state as {
                        tts: {
                            loading: boolean;
                            step: string;
                            progressPct: number;
                            generating: boolean;
                            ready: boolean;
                        };
                        llm: {
                            loading: boolean;
                            step: string;
                            progressPct: number;
                            generating: boolean;
                            ready: boolean;
                        };
                        stt: {
                            loading: boolean;
                            step: string;
                            processing: boolean;
                            ready: boolean;
                            active: boolean;
                            attachedIds: string[];
                        };
                        vad: {
                            recording: boolean;
                            segmentsCount: number;
                            lastSegmentAt: number | null;
                        };
                        webrtc: {
                            connected: boolean;
                            peersCount: number;
                            localStream: boolean;
                        };
                        audio: { rmsLevel: number; rmsPct: number };
                        speaking: boolean;
                        transcriptsCount: number;
                        llmOutputsCount: number;
                        conversationItemsCount: number;
                    };

                    // Clear previous line and print updated state
                    process.stdout.write("\r\x1b[K"); // Clear line

                    const lines = [
                        `🤖 Autonomous Agent State:`,
                        `  TTS: ${agentState.tts.loading ? "Loading" : agentState.tts.ready ? "Ready" : "Idle"} ${agentState.tts.loading ? `(${agentState.tts.step}, ${Math.round(agentState.tts.progressPct)}%)` : ""} ${agentState.tts.generating ? "[Generating]" : ""}`,
                        `  LLM: ${agentState.llm.loading ? "Loading" : agentState.llm.ready ? "Ready" : "Idle"} ${agentState.llm.loading ? `(${agentState.llm.step}, ${Math.round(agentState.llm.progressPct)}%)` : ""} ${agentState.llm.generating ? "[Generating]" : ""}`,
                        `  STT: ${agentState.stt.loading ? "Loading" : agentState.stt.ready ? "Ready" : "Idle"} ${agentState.stt.loading ? `(${agentState.stt.step})` : ""} ${agentState.stt.processing ? "[Processing]" : ""} ${agentState.stt.active ? "[Active]" : "[Paused]"}`,
                        `  VAD: ${agentState.vad.recording ? "Recording" : "Idle"} | Segments: ${agentState.vad.segmentsCount}`,
                        `  WebRTC: ${agentState.webrtc.connected ? "Connected" : "Disconnected"} (${agentState.webrtc.peersCount} peers)`,
                        `  Audio RMS: ${agentState.audio.rmsLevel.toFixed(3)} (${agentState.audio.rmsPct}%)`,
                        `  Speaking: ${agentState.speaking ? "Yes" : "No"} | Transcripts: ${agentState.transcriptsCount} | LLM Outputs: ${agentState.llmOutputsCount} | Conversation: ${agentState.conversationItemsCount}`,
                    ];

                    // Print all lines
                    for (const line of lines) {
                        console.log(line);
                    }
                }
            } catch (error) {
                console.error("\n❌ Error polling state:", error);
                // If the target crashed, stop polling to avoid noisy logs
                const message = String(error ?? "");
                if (
                    (message.includes("Target crashed") ||
                        message.includes("has been closed")) &&
                    interval
                ) {
                    clearInterval(interval);
                    stopped = true;
                }
            }
        };

        // Log state every second
        interval = setInterval(logState, 1000);

        // Clean up interval on shutdown
        process.on("SIGINT", () => {
            clearInterval(interval);
            stopped = true;
        });

        process.on("SIGTERM", () => {
            clearInterval(interval);
            stopped = true;
        });
    }

    async function cleanup(): Promise<void> {
        if (browser) {
            await browser.close();
            console.log("🔒 Browser closed");
        }
    }

    export async function run(): Promise<void> {
        // Handle graceful shutdown
        process.on("SIGINT", async () => {
            console.log("\n🛑 Received SIGINT (Ctrl+C), shutting down gracefully...");
            await cleanup();
            process.exit(0);
        });

        process.on("SIGTERM", async () => {
            console.log("\n🛑 Received SIGTERM, shutting down gracefully...");
            await cleanup();
            process.exit(0);
        });

        // Handle uncaught exceptions
        process.on("uncaughtException", async (error) => {
            console.error("💥 Uncaught exception:", error);
            await cleanup();
            process.exit(1);
        });

        process.on("unhandledRejection", async (reason, promise) => {
            console.error("💥 Unhandled rejection at:", promise, "reason:", reason);
            await cleanup();
            process.exit(1);
        });

        // Start the application
        await startApplication().catch((error) => {
            console.error("💥 Failed to start application:", error);
            process.exit(1);
        });
    }
}

export namespace Server_CLI {
    const SERVER_DOCKER_COMPOSE_FILE = path.join(
        dirname(fileURLToPath(import.meta.url)),
        "../../server/service/server.docker.compose.yml",
    );

    export async function withWait<T>(
        fn: () => Promise<T>,
        wait: { interval: number; timeout: number } | boolean,
    ): Promise<T> {
        const defaultWait = { interval: 100, timeout: 10000 };
        const waitConfig =
            wait === true
                ? defaultWait
                : wait && typeof wait !== "boolean"
                  ? wait
                  : null;

        if (!waitConfig) {
            return fn();
        }

        const startTime = Date.now();
        let lastError: Error | undefined;

        while (Date.now() - startTime < waitConfig.timeout) {
            try {
                const result = await fn();
                return result;
            } catch (error) {
                lastError =
                    error instanceof Error ? error : new Error(String(error));
                await Bun.sleep(waitConfig.interval);
            }
        }

        const timeoutError = new Error(`Timeout after ${waitConfig.timeout}ms`);
        if (lastError) {
            timeoutError.cause = lastError;
        }
        throw timeoutError;
    }

    export async function checkContainer(containerName: string): Promise<void> {
        const proc = Bun.spawn(
            [
                "docker",
                "inspect",
                "-f",
                "{{.State.Health.Status}}",
                containerName,
            ],
            { stdout: "pipe", stderr: "pipe" },
        );
        const stdout = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();
        const exitCode = await proc.exited;
        const status = stdout.trim();
        console.info(`Container ${containerName} status: ${status}`);

        if (exitCode !== 0) {
            throw new Error(stderr);
        }

        if (status === "healthy") {
            return;
        }

        if (status === "<no value>" || status === "") {
            const runningProc = Bun.spawnSync([
                "docker",
                "inspect",
                "-f",
                "{{.State.Status}}",
                containerName,
            ]);
            const runningStatus = new TextDecoder()
                .decode(runningProc.stdout)
                .trim();
            if (runningStatus === "running") {
                return;
            }
            throw new Error(`container status: ${runningStatus}`);
        }

        throw new Error(`container health: ${status}`);
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
            VRCA_SERVER_ALLOWED_ORIGINS:
                serverConfiguration.VRCA_SERVER_ALLOWED_ORIGINS.join(","),
            VRCA_SERVER_DEFAULT_HOST: serverConfiguration.VRCA_SERVER_DEFAULT_HOST,
            VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_HOST:
                clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_HOST,

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
                serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_EXTENSIONS.join(
                    ",",
                ),

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
            VRCA_SERVER_SERVICE_CADDY_DOMAIN:
                (serverConfiguration.VRCA_SERVER_DEFAULT_HOST === "localhost" ||
                 serverConfiguration.VRCA_SERVER_DEFAULT_HOST === "127.0.0.1") &&
                !serverConfiguration.VRCA_SERVER_SERVICE_CADDY_DOMAIN.startsWith(
                    "http",
                )
                    ? `http://${serverConfiguration.VRCA_SERVER_SERVICE_CADDY_DOMAIN}`
                    : serverConfiguration.VRCA_SERVER_SERVICE_CADDY_DOMAIN,
            VRCA_SERVER_SERVICE_CADDY_EMAIL:
                serverConfiguration.VRCA_SERVER_SERVICE_CADDY_EMAIL,
            VRCA_SERVER_SERVICE_CADDY_TLS_MODE:
                serverConfiguration.VRCA_SERVER_SERVICE_CADDY_TLS_MODE,


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

            // API REST Inference Manager
            VRCA_SERVER_SERVICE_WORLD_API_REST_INFERENCE_MANAGER_CONTAINER_NAME:
                serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_INFERENCE_MANAGER_CONTAINER_NAME,
            VRCA_SERVER_SERVICE_WORLD_API_REST_INFERENCE_MANAGER_HOST_CONTAINER_BIND_EXTERNAL:
                serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_INFERENCE_MANAGER_HOST_CONTAINER_BIND_EXTERNAL,
            VRCA_SERVER_SERVICE_WORLD_API_REST_INFERENCE_MANAGER_PORT_CONTAINER_BIND_EXTERNAL:
                serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_INFERENCE_MANAGER_PORT_CONTAINER_BIND_EXTERNAL.toString(),
            VRCA_SERVER_SERVICE_WORLD_API_REST_INFERENCE_MANAGER_HOST_PUBLIC_AVAILABLE_AT:
                serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_INFERENCE_MANAGER_HOST_PUBLIC_AVAILABLE_AT,
            VRCA_SERVER_SERVICE_WORLD_API_REST_INFERENCE_MANAGER_PORT_PUBLIC_AVAILABLE_AT:
                serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_INFERENCE_MANAGER_PORT_PUBLIC_AVAILABLE_AT.toString(),
            VRCA_SERVER_SERVICE_WORLD_API_REST_INFERENCE_MANAGER_SSL_ENABLED_PUBLIC_AVAILABLE_AT:
                serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_INFERENCE_MANAGER_SSL_ENABLED_PUBLIC_AVAILABLE_AT.toString(),
            VRCA_SERVER_SERVICE_WORLD_API_REST_INFERENCE_MANAGER_DEBUG:
                serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_INFERENCE_MANAGER_DEBUG.toString(),
            VRCA_SERVER_SERVICE_WORLD_API_REST_INFERENCE_MANAGER_SUPPRESS:
                serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_INFERENCE_MANAGER_SUPPRESS.toString(),

            // State Manager
            VRCA_SERVER_SERVICE_WORLD_STATE_MANAGER_CONTAINER_NAME:
                serverConfiguration.VRCA_SERVER_SERVICE_WORLD_STATE_MANAGER_CONTAINER_NAME,
            VRCA_SERVER_SERVICE_WORLD_STATE_MANAGER_DEBUG:
                serverConfiguration.VRCA_SERVER_SERVICE_WORLD_STATE_MANAGER_DEBUG.toString(),
            VRCA_SERVER_SERVICE_WORLD_STATE_MANAGER_SUPPRESS:
                serverConfiguration.VRCA_SERVER_SERVICE_WORLD_STATE_MANAGER_SUPPRESS.toString(),



            // Azure Entra ID Auth (env-first)
            VRCA_SERVER_AUTH_AZURE_CLIENT_ID:
                serverConfiguration.VRCA_SERVER_AUTH_AZURE_CLIENT_ID,
            VRCA_SERVER_AUTH_AZURE_CLIENT_SECRET:
                serverConfiguration.VRCA_SERVER_AUTH_AZURE_CLIENT_SECRET,
            VRCA_SERVER_AUTH_AZURE_TENANT_ID:
                serverConfiguration.VRCA_SERVER_AUTH_AZURE_TENANT_ID,
            VRCA_SERVER_AUTH_AZURE_JWT_SECRET:
                serverConfiguration.VRCA_SERVER_AUTH_AZURE_JWT_SECRET,
            VRCA_SERVER_AUTH_AZURE_SCOPES: Array.isArray(
                serverConfiguration.VRCA_SERVER_AUTH_AZURE_SCOPES,
            )
                ? serverConfiguration.VRCA_SERVER_AUTH_AZURE_SCOPES.join(",")
                : String(serverConfiguration.VRCA_SERVER_AUTH_AZURE_SCOPES),
            VRCA_SERVER_AUTH_AZURE_ENABLED:
                serverConfiguration.VRCA_SERVER_AUTH_AZURE_ENABLED.toString(),
            VRCA_SERVER_AUTH_AZURE_DEFAULT_PERMISSIONS_CAN_READ:
                serverConfiguration.VRCA_SERVER_AUTH_AZURE_DEFAULT_PERMISSIONS_CAN_READ.join(
                    ",",
                ),
            VRCA_SERVER_AUTH_AZURE_DEFAULT_PERMISSIONS_CAN_INSERT:
                serverConfiguration.VRCA_SERVER_AUTH_AZURE_DEFAULT_PERMISSIONS_CAN_INSERT.join(
                    ",",
                ),
            VRCA_SERVER_AUTH_AZURE_DEFAULT_PERMISSIONS_CAN_UPDATE:
                serverConfiguration.VRCA_SERVER_AUTH_AZURE_DEFAULT_PERMISSIONS_CAN_UPDATE.join(
                    ",",
                ),
            VRCA_SERVER_AUTH_AZURE_DEFAULT_PERMISSIONS_CAN_DELETE:
                serverConfiguration.VRCA_SERVER_AUTH_AZURE_DEFAULT_PERMISSIONS_CAN_DELETE.join(
                    ",",
                ),
            VRCA_SERVER_AUTH_AZURE_REDIRECT_URIS:
                serverConfiguration.VRCA_SERVER_AUTH_AZURE_REDIRECT_URIS.join(
                    ",",
                ),

            // Inference Providers - Cerebras
            VRCA_SERVER_SERVICE_INFERENCE_CEREBRAS_API_KEY:
                serverConfiguration.VRCA_SERVER_SERVICE_INFERENCE_CEREBRAS_API_KEY,
            VRCA_SERVER_SERVICE_INFERENCE_CEREBRAS_MODEL:
                serverConfiguration.VRCA_SERVER_SERVICE_INFERENCE_CEREBRAS_MODEL,

            // Inference Providers - Groq
            VRCA_SERVER_SERVICE_INFERENCE_GROQ_API_KEY:
                serverConfiguration.VRCA_SERVER_SERVICE_INFERENCE_GROQ_API_KEY,
            VRCA_SERVER_SERVICE_INFERENCE_GROQ_STT_MODEL:
                serverConfiguration.VRCA_SERVER_SERVICE_INFERENCE_GROQ_STT_MODEL,
            VRCA_SERVER_SERVICE_INFERENCE_GROQ_TTS_MODEL:
                serverConfiguration.VRCA_SERVER_SERVICE_INFERENCE_GROQ_TTS_MODEL,
            VRCA_SERVER_SERVICE_INFERENCE_GROQ_TTS_VOICE:
                serverConfiguration.VRCA_SERVER_SERVICE_INFERENCE_GROQ_TTS_VOICE,
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

        const exitCode = await spawnedProcess.exited;

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

        const apiInferenceHostExternal =
            (await EnvManager.getVariable(
                "VRCA_SERVER_SERVICE_WORLD_API_REST_INFERENCE_MANAGER_HOST_CONTAINER_BIND_EXTERNAL",
                "cli",
            )) ||
            process.env
                .VRCA_SERVER_SERVICE_WORLD_API_REST_INFERENCE_MANAGER_HOST_CONTAINER_BIND_EXTERNAL ||
            serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_INFERENCE_MANAGER_HOST_CONTAINER_BIND_EXTERNAL;

        const apiInferencePortExternal =
            (await EnvManager.getVariable(
                "VRCA_SERVER_SERVICE_WORLD_API_REST_INFERENCE_MANAGER_PORT_CONTAINER_BIND_EXTERNAL",
                "cli",
            )) ||
            process.env
                .VRCA_SERVER_SERVICE_WORLD_API_REST_INFERENCE_MANAGER_PORT_CONTAINER_BIND_EXTERNAL ||
            serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_INFERENCE_MANAGER_PORT_CONTAINER_BIND_EXTERNAL.toString();



        const apiWsUpstream = `${apiWsHostExternal}:${apiWsPortExternal}`;
        const apiAuthUpstream = `${apiAuthHostExternal}:${apiAuthPortExternal}`;
        const apiAssetUpstream = `${apiAssetHostExternal}:${apiAssetPortExternal}`;
        const apiInferenceUpstream = `${apiInferenceHostExternal}:${apiInferencePortExternal}`;


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
            `  API REST Inference Manager:  http://${apiInferenceHostExternal}:${apiInferencePortExternal}`,
        );


        console.log(`\nDocker network upstreams (for proxies inside Docker):`);
        console.log(`  API WS Manager:  ${apiWsUpstream}`);
        console.log(`  API REST Auth Manager:  ${apiAuthUpstream}`);
        console.log(`  API REST Asset Manager:  ${apiAssetUpstream}`);
        console.log(`  API REST Inference Manager:  ${apiInferenceUpstream}`);

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

        for (const name of serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_EXTENSIONS) {
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
        const migrations = await readdir(MIGRATION_DIR, {
            recursive: true,
        });
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
                    const filePath = path.join(MIGRATION_DIR, file);
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
            const executedHashes = new Set(
                result.map((r: any) => r.general__hash),
            );
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

    // TODO: This should be able to work with remote DBs too, we should create a service token and let the API create these and issue them on behalf of system token granted users.
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
            const processAsset = async (
                asset: Pick<
                    Entity.Asset.I_Asset,
                    | "general__asset_file_name"
                    | "asset__data__bytea"
                    | "asset__mime_type"
                >,
            ) => {
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
                            buffer = Buffer.from(
                                asset.asset__data__bytea as Buffer,
                            );
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
            await Server_CLI.withWait<void>(
                () =>
                    Server_CLI.checkContainer(
                        serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_CONTAINER_NAME,
                    ),
                false,
            );

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
            await Server_CLI.withWait<void>(
                () =>
                    Server_CLI.checkContainer(
                        serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_CONTAINER_NAME,
                    ),
                false,
            );

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

// Helper to parse wait flags from command args
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

// If this file is run directly
