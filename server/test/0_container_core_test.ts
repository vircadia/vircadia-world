import { describe, expect, test, beforeAll } from "bun:test";
import { up, down, restart, isHealthy } from "../container/docker/docker_cli";

describe("System Operations Tests", () => {
    beforeAll(async () => {
        try {
            // Start required services silently
            await up(true);
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

    test("Docker container restart works", async () => {
        await restart(true);
        const health = await isHealthy();
        expect(health.postgres.isHealthy).toBe(true);
        expect(health.pgweb.isHealthy).toBe(true);
    }, 30000);

    test("Docker container down and up cycle works", async () => {
        // Stop containers
        await down(true);
        const healthAfterDown = await isHealthy();
        expect(healthAfterDown.postgres.isHealthy).toBe(false);
        expect(healthAfterDown.pgweb.isHealthy).toBe(false);

        // Start containers again
        await up(true);
        const healthAfterUp = await isHealthy();
        expect(healthAfterUp.postgres.isHealthy).toBe(true);
        expect(healthAfterUp.pgweb.isHealthy).toBe(true);
    }, 30000);
});
