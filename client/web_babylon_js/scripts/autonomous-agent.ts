#!/usr/bin/env bun

import { type Browser, launch } from "puppeteer";

const DEV_PORT = process.env.DEV_PORT || 3066;
const DEV_HOST = process.env.DEV_HOST || "localhost";
const BASE_URL = `http://${DEV_HOST}:${DEV_PORT}`;

async function runBasicTest(): Promise<void> {
    let browser: Browser | undefined;

    try {
        console.log(`🚀 Launching browser and connecting to ${BASE_URL}`);

        // Launch browser
        browser = await launch({
            headless: true,
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

        const page = await browser.newPage();

        // Set viewport size
        await page.setViewport({ width: 1280, height: 720 });

        console.log("📱 Navigating to application...");
        await page.goto(BASE_URL, { waitUntil: "networkidle0" });

        // Wait for the app to load
        await new Promise((resolve) => setTimeout(resolve, 10000));

        console.log("✅ Application loaded successfully!");

        // Take a screenshot
        const screenshot = await page.screenshot({
            path: "test-screenshot.png",
            fullPage: true,
        });
        console.log("📸 Screenshot saved as test-screenshot.png");

        // Get page title
        const title = await page.title();
        console.log(`📋 Page title: ${title}`);

        // Check if Babylon.js canvas is present
        const canvasExists = await page.$("canvas");
        if (canvasExists) {
            console.log(
                "🎨 Babylon.js canvas found - 3D scene should be rendering",
            );
        } else {
            console.log("⚠️  No canvas element found");
        }

        // Example: Check for specific elements in your app
        // Uncomment and modify based on your app's structure

        // const loginButton = await page.$('button:has-text("Login")');
        // if (loginButton) {
        //     console.log("🔐 Login button found");
        // }

        console.log("🎉 Basic test completed successfully!");
    } catch (error) {
        console.error("❌ Test failed:", error);
        throw error;
    } finally {
        if (browser) {
            await browser.close();
            console.log("🔒 Browser closed");
        }
    }
}

// Run the test
runBasicTest().catch((error) => {
    console.error("💥 Script failed:", error);
    process.exit(1);
});
