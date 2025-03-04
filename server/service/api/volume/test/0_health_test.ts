import { describe, test, expect } from "bun:test";
import { VircadiaConfig } from "../vircadia-world-sdk-ts/config/vircadia.config";
import { log } from "../vircadia-world-sdk-ts/module/general/log";
import {
    Communication,
    Service,
} from "../vircadia-world-sdk-ts/schema/schema.general";
import { fetch } from "bun";

describe("World API Manager - HEALTH", () => {
    test("Health Check - Stats Endpoint", async () => {
        // Construct the stats endpoint URL
        const statsEndpoint = `http://${VircadiaConfig.SERVER.VRCA_SERVER_SERVICE_API_HOST_PUBLIC}:${VircadiaConfig.SERVER.VRCA_SERVER_SERVICE_API_PORT_PUBLIC}${Service.API.Stats_Endpoint.path}`;

        // Send request to the stats endpoint
        const response = await fetch(statsEndpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                // Add localhost headers to ensure access is granted
                "X-Forwarded-For": "127.0.0.1",
            },
            body: Service.API.Stats_Endpoint.createRequest(),
        });

        // Check if the response was successful
        expect(response.status).toBe(200);

        // Parse the response body
        const responseData = await response.json();

        // Verify that the response indicates success
        expect(responseData).toHaveProperty("success", true);

        // Log success for debugging
        log({
            message: "Stats endpoint health check successful",
            debug: VircadiaConfig.SERVER.VRCA_SERVER_DEBUG,
            type: "debug",
            suppress: VircadiaConfig.SERVER.VRCA_SERVER_SUPPRESS,
            data: { responseData },
        });
    });
});
