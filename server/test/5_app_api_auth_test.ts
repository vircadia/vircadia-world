import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import type { Subprocess } from "bun";
import type postgres from "postgres";
import { PostgresClient } from "../database/postgres/postgres_client";
import type {
    Tick,
    Entity,
} from "../../sdk/vircadia-world-sdk-ts/schema/schema.general";
import { up } from "../container/docker/docker_cli";

describe("App -> Core Tests", () => {
    let sql: postgres.Sql;
    let serverProcess: Subprocess;

    // Setup before all tests
    beforeAll(async () => {
        await up(true);

        // Initialize database connection using PostgresClient
        await PostgresClient.getInstance().connect(false);
        sql = PostgresClient.getInstance().getClient();

        // Start the server using the package.json script
        serverProcess = Bun.spawn(["bun", "run", "app:dev"], {
            cwd: process.cwd(),
            stdio: ["inherit", "inherit", "inherit"],
        });

        // Give the server a moment to start up
        await new Promise((resolve) => setTimeout(resolve, 1000));
    });

    describe("Auth Operations", () => {
        test("should be able to connect to server", async () => {
            const response = await fetch("http://localhost:3000");
            expect(response.status).toBe(200);
        });
    });

    afterAll(async () => {
        // Kill the server process
        serverProcess.kill();

        // Disconnect using PostgresClient
        await PostgresClient.getInstance().disconnect();
    });
});
