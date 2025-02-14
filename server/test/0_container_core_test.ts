import { describe, expect, test, beforeAll } from "bun:test";
import { up, down, restart, isHealthy } from "../container/docker/docker_cli";

describe("System Operations Tests", () => {
    beforeAll(async () => {
        try {
            if (!(await isHealthy()).isHealthy) {
                await up();

                const healthyAfterUp = await isHealthy();
                if (!healthyAfterUp.isHealthy) {
                    throw new Error("Failed to start services");
                }
            }
        } catch (error) {
            console.error("Failed to start services:", error);
            throw error;
        }
    });

    test("Docker containers are healthy", async () => {
        const health = await isHealthy();

        // Verify PostgreSQL health
        expect(health.services.postgres.isHealthy).toBe(true);
        expect(health.services.postgres.error).toBeUndefined();

        // Verify Pgweb health
        expect(health.services.pgweb.isHealthy).toBe(true);
        expect(health.services.pgweb.error).toBeUndefined();
    });

    test("Docker container restart works", async () => {
        await restart();
        const health = await isHealthy();
        expect(health.services.postgres.isHealthy).toBe(true);
        expect(health.services.pgweb.isHealthy).toBe(true);
    }, 30000);

    test("Docker container down and up cycle works", async () => {
        // Stop containers
        await down();
        const healthAfterDown = await isHealthy();
        expect(healthAfterDown.services.postgres.isHealthy).toBe(false);
        expect(healthAfterDown.services.pgweb.isHealthy).toBe(false);

        // Start containers again
        await up();
        const healthAfterUp = await isHealthy();
        expect(healthAfterUp.services.postgres.isHealthy).toBe(true);
        expect(healthAfterUp.services.pgweb.isHealthy).toBe(true);
    }, 30000);
});
