import { describe, test, expect } from "bun:test";
import {
    VircadiaConfig,
    VircadiaConfig_CLIENT,
} from "../vircadia-world-sdk-ts/config/vircadia.config";
import { log } from "../vircadia-world-sdk-ts/module/general/log";
import { fetch } from "bun";

describe(`${VircadiaConfig_CLIENT.VRCA_CLIENT_CONTAINER_NAME} - HEALTH`, () => {
    test("Health Check", async () => {
        // Construct the stats endpoint URL
        const clientAppUrl = `http://localhost:${VircadiaConfig_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_PRODUCTION_PORT_CONTAINER_INTERNAL}`;

        // Send request to the stats endpoint
        const response = await fetch(clientAppUrl, {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                // Add localhost headers to ensure access is granted
                "X-Forwarded-For": "127.0.0.1",
            },
        });

        // Check if the response was successful
        expect(response.status).toBe(200);

        // Log success for debugging
        log({
            message: "Stats endpoint health check successful",
            debug: VircadiaConfig_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG,
            type: "debug",
            suppress: VircadiaConfig_CLIENT.VRCA_CLIENT_WEB_BABYLON_JS_SUPPRESS,
        });
    });
});
