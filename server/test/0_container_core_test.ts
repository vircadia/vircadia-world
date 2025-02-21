import { describe, expect, test, beforeAll } from "bun:test";
import {
    up,
    down,
    isHealthy,
    seed,
    migrate,
} from "../container/docker/docker_cli";

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

    test("Docker container rebuild works", async () => {
        await down(true);
        await up(true);
        const health = await isHealthy();
        expect(health.services.postgres.isHealthy).toBe(true);
        expect(health.services.pgweb.isHealthy).toBe(true);

        const migrationsRan = await migrate();
        expect(migrationsRan).toBe(true);

        await seed({});

        // Verify database is still healthy after all operations
        const finalHealth = await isHealthy();
        expect(finalHealth.services.postgres.isHealthy).toBe(true);
        expect(finalHealth.services.pgweb.isHealthy).toBe(true);
    }, 60000); // Longer timeout since rebuild includes multiple operations
});
