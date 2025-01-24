import { describe, expect, test, beforeAll } from "bun:test";
import {
    up,
    isHealthy,
    generateDbSystemToken,
} from "../container/docker/docker_cli";

describe("System Startup Test", () => {
    beforeAll(async () => {
        try {
            // Start required services silently
            await up({ silent: true });
        } catch (error) {
            console.error("Failed to start services:", error);
            throw error;
        }
    });

    test("Docker containers are healthy", async () => {
        const health = await isHealthy();

        // Verify PostgreSQL health
        expect(health.postgres.isHealthy).toBe(true);
        expect(health.postgres.error).toBeUndefined();

        // Verify Pgweb health
        expect(health.pgweb.isHealthy).toBe(true);
        expect(health.pgweb.error).toBeUndefined();
    });

    test("System token generation works", async () => {
        const token = await generateDbSystemToken();
        expect(token).toBeDefined();
        expect(token.token).toBeDefined();
        expect(token.sessionId).toBeDefined();
        expect(token.agentId).toBeDefined();
    });
});
