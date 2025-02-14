import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import type { Subprocess } from "bun";
import type postgres from "postgres";
import { PostgresClient } from "../database/postgres/postgres_client";
import type { Auth } from "../../sdk/vircadia-world-sdk-ts/schema/schema.general";
import { isHealthy, up } from "../container/docker/docker_cli";
import { VircadiaConfig_Server } from "../../sdk/vircadia-world-sdk-ts/config/vircadia.config";

describe("Service -> Web Script Manager Tests", () => {
    let sql: postgres.Sql;
    let serverProcess: Subprocess | null;
    let testToken: string;
    let testAgentId: string;
    let testSessionId: string;

    // Setup before all tests
    beforeAll(async () => {
        if (!(await isHealthy()).isHealthy) {
            await up();

            const healthyAfterUp = await isHealthy();
            if (!healthyAfterUp.isHealthy) {
                throw new Error("Failed to start services");
            }
        }
        await PostgresClient.getInstance().connect(true);
        sql = PostgresClient.getInstance().getClient();

        // Create a test session and get token
        const [session] = await sql<
            [{ session_id: string; agent_id: string; session_token: string }]
        >`
            SELECT * FROM auth.create_session('test-agent'::UUID)
        `;
        testAgentId = session.agent_id;
        testSessionId = session.session_id;
        testToken = session.session_token;
    });

    describe("World API Manager -> REST API Tests", () => {
        test("service should launch and become available", async () => {
            serverProcess = Bun.spawn(["bun", "run", "service:run:api"], {
                cwd: process.cwd(),
                stdio: ["inherit", "inherit", "inherit"],
                killSignal: "SIGTERM",
            });

            expect(serverProcess).toBeGreaterThan(0);
        });

        describe("Authentication Endpoints", () => {
            const baseUrl = `http://${VircadiaConfig_Server.serverHost}:${VircadiaConfig_Server.serverPort}/api/v1`;

            test("should validate a valid session token", async () => {
                const response = await fetch(
                    `${baseUrl}/auth/session/validate`,
                    {
                        method: "GET",
                        headers: {
                            Authorization: `Bearer ${testToken}`,
                        },
                    },
                );

                expect(response.status).toBe(200);
                const data = await response.json();
                expect(data.success).toBe(true);
                expect(data.data.isValid).toBe(true);
                expect(data.data.agentId).toBe(testAgentId);
                expect(data.data.sessionId).toBe(testSessionId);
            });

            test("should reject an invalid session token", async () => {
                const response = await fetch(
                    `${baseUrl}/auth/session/validate`,
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
                    `${baseUrl}/auth/session/validate`,
                    {
                        method: "GET",
                    },
                );

                expect(response.status).toBe(401);
                const data = await response.json();
                expect(data.success).toBe(false);
            });

            test("should successfully logout with valid token", async () => {
                const response = await fetch(`${baseUrl}/auth/session/logout`, {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${testToken}`,
                    },
                });

                expect(response.status).toBe(200);
                const data = await response.json();
                expect(data.success).toBe(true);

                // Verify session is actually invalidated
                const validateResponse = await fetch(
                    `${baseUrl}/auth/session/validate`,
                    {
                        method: "GET",
                        headers: {
                            Authorization: `Bearer ${testToken}`,
                        },
                    },
                );

                const validateData = await validateResponse.json();
                expect(validateData.success).toBe(false);
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
        await PostgresClient.getInstance().disconnect();
    });
});
