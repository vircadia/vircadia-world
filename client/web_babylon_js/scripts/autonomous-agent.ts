#!/usr/bin/env bun

// TODO: Make this a CLI script in the CLI file if the global variables will work.

import { clientBrowserConfiguration } from "@vircadia/world-sdk/browser/vue";
import { type Browser, chromium, type Page } from "playwright";

// Local declaration to satisfy linting without requiring @types/node in this script context
declare const process: any;

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
    page.on("pageerror", (err) => {
        console.error("\n💥 Page error:", err);
    });
    page.on("console", (msg) => {
        const loc = msg.location();
        console.log(
            `📜 [browser:${msg.type()}] ${msg.text()} (${loc.url}:${loc.lineNumber}:${loc.columnNumber})`,
        );
    });

    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });

    // Wait for canvas element to exist
    await page.waitForSelector("canvas", { timeout: 30000 });
    console.log("✅ Canvas found");

    // Wait for Babylon.js scene to be ready by checking the window state
    // Note: This flag is set by clientBrowserState singleton in MainScene.vue
    // State is stored on window.__VircadiaClientBrowserState__ for easy access
    console.log("⏳ Waiting for Babylon.js scene to be ready...");
    await page.waitForFunction(
        () => {
            const win = window as unknown as {
                __VircadiaClientBrowserState__?: { sceneReady?: boolean };
            };
            return win.__VircadiaClientBrowserState__?.sceneReady === true;
        },
        { timeout: 30000 },
    );

    console.log("✅ Babylon.js scene is ready!");

    // Ensure autonomous agent state exists before polling
    await page.waitForFunction(
        () => {
            const win = window as unknown as {
                __VircadiaClientBrowserState__?: { autonomousAgent?: unknown };
            };
            return (
                win.__VircadiaClientBrowserState__?.autonomousAgent !==
                undefined
            );
        },
        { timeout: 15000 },
    );

    console.log("🎉 Application is ready! Press Ctrl+C to exit.");

    // Start polling and logging autonomous agent state
    if (page) {
        startStatePolling(page);
    }
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
startApplication().catch((error) => {
    console.error("💥 Failed to start application:", error);
    process.exit(1);
});
