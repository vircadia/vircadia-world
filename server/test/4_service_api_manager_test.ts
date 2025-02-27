import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import type { Subprocess } from "bun";
import type postgres from "postgres";
import { PostgresClient } from "../database/postgres/postgres_client";
import { Communication } from "../../sdk/vircadia-world-sdk-ts/schema/schema.general";
import { VircadiaConfig } from "../../sdk/vircadia-world-sdk-ts/config/vircadia.config";
import {
    cleanupTestAccounts,
    cleanupTestAssets,
    cleanupTestEntities,
    cleanupTestScripts,
    initContainers,
    initTestAccounts,
    type TestAccount,
} from "./helper/helpers";

describe("Service -> API Manager Tests", () => {
    let superUserSql: postgres.Sql;
    let proxyUserSql: postgres.Sql;

    let serverProcess: Subprocess | null;

    let adminAgent: TestAccount;
    let regularAgent: TestAccount;
    let anonAgent: TestAccount;

    // Setup before all tests
    beforeAll(async () => {
        await initContainers();

        superUserSql = await PostgresClient.getInstance().getSuperClient();
        proxyUserSql = await PostgresClient.getInstance().getProxyClient();

        await cleanupTestAccounts({
            superUserSql,
        });
        await cleanupTestEntities({
            superUserSql,
        });
        await cleanupTestScripts({
            superUserSql,
        });
        await cleanupTestAssets({
            superUserSql,
        });
        const testAccounts = await initTestAccounts({
            superUserSql,
        });
        adminAgent = testAccounts.adminAgent;
        regularAgent = testAccounts.regularAgent;
        anonAgent = testAccounts.anonAgent;

        serverProcess = Bun.spawn(["bun", "run", "service:run:api"], {
            cwd: process.cwd(),
            ...(VircadiaConfig.SERVER.SUPPRESS
                ? { stdio: ["ignore", "ignore", "ignore"] }
                : { stdio: ["inherit", "inherit", "inherit"] }),
            killSignal: "SIGTERM",
        });

        // Wait for server to be ready by polling the health endpoint
        const baseUrl = `${VircadiaConfig.CLIENT.defaultWorldServerUriUsingSsl ? "https" : "http"}://${VircadiaConfig.CLIENT.defaultWorldServerUri}`;
        const maxAttempts = 10;
        let attempts = 0;

        while (attempts < maxAttempts) {
            try {
                const response = await fetch(baseUrl);
                if (response.status === 404) {
                    // Server is up but returns 404 for root path
                    break;
                }
            } catch (error) {
                attempts++;
                if (attempts === maxAttempts) {
                    throw new Error("Server failed to start in time");
                }
                await Bun.sleep(500); // 500ms between attempts
            }
        }
    });

    describe("REST API Tests", () => {
        test("service should launch and become available", async () => {
            expect(serverProcess?.pid).toBeGreaterThan(0);
        });

        describe("Authentication Endpoints", () => {
            const baseUrl = `${VircadiaConfig.CLIENT.defaultWorldServerUriUsingSsl ? "https" : "http"}://${VircadiaConfig.CLIENT.defaultWorldServerUri}`;

            test("should validate a valid session token", async () => {
                const regularResponse = await fetch(
                    `${baseUrl}${Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.path}`,
                    {
                        method: "GET",
                        headers: {
                            Authorization: `Bearer ${regularAgent.token}`,
                        },
                    },
                );

                expect(regularResponse.status).toBe(200);
                const data = await regularResponse.json();
                expect(data.success).toBe(true);
                expect(data.data.isValid).toBe(true);
                expect(data.data.agentId).toBe(regularAgent.id);
                expect(data.data.sessionId).toBe(regularAgent.sessionId);

                const adminResponse = await fetch(
                    `${baseUrl}${Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.path}`,
                    {
                        method: "GET",
                        headers: {
                            Authorization: `Bearer ${adminAgent.token}`,
                        },
                    },
                );

                expect(adminResponse.status).toBe(200);
                const adminData = await adminResponse.json();
                expect(adminData.success).toBe(true);
                expect(adminData.data.isValid).toBe(true);
                expect(adminData.data.agentId).toBe(adminAgent.id);
                expect(adminData.data.sessionId).toBe(adminAgent.sessionId);
            });

            test("should reject an invalid session token", async () => {
                const response = await fetch(
                    `${baseUrl}${Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.path}`,
                    {
                        method: "GET",
                        headers: {
                            Authorization: "Bearer invalid-token",
                        },
                    },
                );

                expect(response.status).toBe(200);
                const data = await response.json();
                expect(data.success).toBe(false);
            });

            test("should reject requests without a token", async () => {
                const response = await fetch(
                    `${baseUrl}${Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.path}`,
                    {
                        method: "GET",
                    },
                );

                expect(response.status).toBe(401);
                const data = await response.json();
                expect(data.success).toBe(false);
            });
        });
    });

    afterAll(async () => {
        // Kill the server process and its children
        if (serverProcess?.pid) {
            try {
                // First try to kill the process directly
                serverProcess.kill("SIGTERM");
                // Then try to kill the process group as fallback
                try {
                    process.kill(-serverProcess.pid, "SIGTERM");
                } catch (e) {
                    // Ignore error if process group doesn't exist
                }
            } catch (error) {
                console.error("Error killing process:", error);
            }
        }

        await cleanupTestAccounts({
            superUserSql,
        });
        await cleanupTestEntities({
            superUserSql,
        });
        await cleanupTestScripts({
            superUserSql,
        });
        await cleanupTestAssets({
            superUserSql,
        });

        await PostgresClient.getInstance().disconnect();
    });
});
