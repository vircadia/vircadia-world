#!/usr/bin/env bun

import { clientBrowserConfiguration } from "@vircadia/world-sdk/browser/vue";
import { type Browser, launch, type Page } from "puppeteer";

const DEV_PORT = clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEV_PORT;
const DEV_HOST = "localhost";
const BASE_URL = `http://${DEV_HOST}:${DEV_PORT}?is_autonomous_agent=true`;

let browser: Browser | undefined;
let page: Page | undefined;

async function startApplication(): Promise<void> {
    console.log(`🚀 Launching browser and connecting to ${BASE_URL} as anonymous autonomous agent`);

    browser = await launch({
        headless: false,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-accelerated-2d-canvas",
            "--no-first-run",
            "--no-zygote",
            "--enable-webgpu",
            "--enable-unsafe-webgpu",
        ],
    });

    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    await page.goto(BASE_URL, { waitUntil: "networkidle0" });

    // Wait for canvas element to exist
    await page.waitForSelector("canvas", { timeout: 10000 });
    console.log("✅ Canvas found");

    // Wait for Babylon.js scene to be ready by checking a global flag
    console.log("⏳ Waiting for Babylon.js scene to be ready...");
    await page.waitForFunction(
        () => {
            // Check if a global flag has been set indicating the scene is ready
            return (
                (
                    window as typeof window & {
                        __VIRCADIA_SCENE_READY__?: boolean;
                    }
                ).__VIRCADIA_SCENE_READY__ === true
            );
        },
        { timeout: 30000, polling: 1000 },
    );

    console.log("✅ Babylon.js scene is ready!");

    console.log("🎉 Application is ready! Press Ctrl+C to exit.");
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
