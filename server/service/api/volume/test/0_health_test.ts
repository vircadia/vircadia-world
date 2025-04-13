import { describe, test, expect } from "bun:test";
import { VircadiaConfig_SERVER } from "../../../../../sdk/vircadia-world-sdk-ts/config/vircadia.server.config";
import { log } from "../../../../../sdk/vircadia-world-sdk-ts/module/general/log";
import { Service } from "../../../../../sdk/vircadia-world-sdk-ts/schema/schema.general";
import { fetch } from "bun";

describe("World API Manager - HEALTH", () => {
    test("Health Check - Internal Stats Endpoint", async () => {
        // Construct the stats endpoint URL
        const statsEndpoint = `http://${VircadiaConfig_SERVER.VRCA_SERVER_SERVICE_WORLD_API_MANAGER_HOST_CONTAINER_BIND_INTERNAL}:${VircadiaConfig_SERVER.VRCA_SERVER_SERVICE_WORLD_API_MANAGER_PORT_CONTAINER_BIND_INTERNAL}${Service.API.Stats_Endpoint.path}`;

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
            debug: VircadiaConfig_SERVER.VRCA_SERVER_DEBUG,
            type: "debug",
            suppress: VircadiaConfig_SERVER.VRCA_SERVER_SUPPRESS,
            data: { responseData },
        });
    });
});
