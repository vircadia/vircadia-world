import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import type { Subprocess } from "bun";
import type postgres from "postgres";
import { PostgresClient } from "../database/postgres/postgres_client";
import {
    Communication,
    type Config,
} from "../../sdk/vircadia-world-sdk-ts/schema/schema.general";
import { isHealthy, up } from "../container/docker/docker_cli";
import {
    VircadiaConfig_Client,
    VircadiaConfig_Server,
} from "../../sdk/vircadia-world-sdk-ts/config/vircadia.config";
import { sign } from "jsonwebtoken";

describe("Service -> Web API Manager Tests", () => {
    let sql: postgres.Sql;
    let serverProcess: Subprocess | null;
    let admin: { id: string; token: string; sessionId: string };
    let agent: { id: string; token: string; sessionId: string };

    async function createTestAccounts() {
        // Get auth config
        const [authConfig] = await sql<[Config.I_Config<"auth">]>`
            SELECT * FROM config.config 
            WHERE general__key = 'auth'
        `;

        const authSecretConfig = authConfig.general__value.jwt_secret;
        const authDurationConfigMs =
            authConfig.general__value.default_session_duration_ms;

        if (!authSecretConfig || !authDurationConfigMs) {
            throw new Error("Auth settings not found in database");
        }

        // Clean up existing test accounts
        await sql`
            DELETE FROM auth.agent_profiles 
            WHERE profile__username IN ('test_admin', 'test_agent')
        `;

        // Create test admin account
        const [adminAccount] = await sql`
            INSERT INTO auth.agent_profiles (profile__username, auth__email, auth__is_admin)
            VALUES ('test_admin', 'test_admin@test.com', true)
            RETURNING general__agent_profile_id
        `;
        const adminId = adminAccount.general__agent_profile_id;

        // Create test agent account
        const [agentAccount] = await sql`
            INSERT INTO auth.agent_profiles (profile__username, auth__email)
            VALUES ('test_agent', 'test_agent@test.com')
            RETURNING general__agent_profile_id
        `;
        const agentId = agentAccount.general__agent_profile_id;

        // Create sessions
        const [adminSession] = await sql<
            [
                {
                    general__session_id: string;
                    session__jwt: string;
                    session__expires_at: Date;
                },
            ]
        >`
            SELECT * FROM auth.create_agent_session(${adminId}, 'test')
        `;
        const [agentSession] = await sql<
            [
                {
                    general__session_id: string;
                    session__jwt: string;
                    session__expires_at: Date;
                },
            ]
        >`
            SELECT * FROM auth.create_agent_session(${agentId}, 'test')
        `;

        // Generate JWT tokens
        const adminToken = sign(
            { sessionId: adminSession.general__session_id, agentId: adminId },
            authSecretConfig,
            { expiresIn: authDurationConfigMs },
        );

        const agentToken = sign(
            { sessionId: agentSession.general__session_id, agentId: agentId },
            authSecretConfig,
            { expiresIn: authDurationConfigMs },
        );

        // Update sessions with tokens
        await sql`
            UPDATE auth.agent_sessions 
            SET session__jwt = ${adminToken}
            WHERE general__session_id = ${adminSession.general__session_id}
        `;

        await sql`
            UPDATE auth.agent_sessions 
            SET session__jwt = ${agentToken}
            WHERE general__session_id = ${agentSession.general__session_id}
        `;

        return {
            admin: {
                id: adminId,
                token: adminToken,
                sessionId: adminSession.general__session_id,
            },
            agent: {
                id: agentId,
                token: agentToken,
                sessionId: agentSession.general__session_id,
            },
        };
    }

    // Setup before all tests
    beforeAll(async () => {
        if (!(await isHealthy()).isHealthy) {
            await up();

            const healthyAfterUp = await isHealthy();
            if (!healthyAfterUp.isHealthy) {
                throw new Error("Failed to start services");
            }
        }
        await PostgresClient.getInstance().connect();
        sql = PostgresClient.getInstance().getClient();

        // Create test accounts
        const accounts = await createTestAccounts();
        admin = accounts.admin;
        agent = accounts.agent;

        serverProcess = Bun.spawn(["bun", "run", "service:run:api"], {
            cwd: process.cwd(),
            ...(VircadiaConfig_Server.SUPPRESS
                ? { stdio: ["ignore", "ignore", "ignore"] }
                : { stdio: ["inherit", "inherit", "inherit"] }),
            killSignal: "SIGTERM",
        });

        // Wait for server to be ready by polling the health endpoint
        const baseUrl = `${VircadiaConfig_Client.defaultWorldServerUriUsingSsl ? "https" : "http"}://${VircadiaConfig_Client.defaultWorldServerUri}`;
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

    describe("World API Manager -> REST API Tests", () => {
        test("service should launch and become available", async () => {
            expect(serverProcess?.pid).toBeGreaterThan(0);
        });

        describe("Authentication Endpoints", () => {
            const baseUrl = `${VircadiaConfig_Client.defaultWorldServerUriUsingSsl ? "https" : "http"}://${VircadiaConfig_Client.defaultWorldServerUri}`;

            test("should validate a valid session token", async () => {
                const agentResponse = await fetch(
                    `${baseUrl}${Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.path}`,
                    {
                        method: "GET",
                        headers: {
                            Authorization: `Bearer ${agent.token}`,
                        },
                    },
                );

                expect(agentResponse.status).toBe(200);
                const data = await agentResponse.json();
                expect(data.success).toBe(true);
                expect(data.data.isValid).toBe(true);
                expect(data.data.agentId).toBe(agent.id);
                expect(data.data.sessionId).toBe(agent.sessionId);

                const adminResponse = await fetch(
                    `${baseUrl}${Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.path}`,
                    {
                        method: "GET",
                        headers: {
                            Authorization: `Bearer ${admin.token}`,
                        },
                    },
                );

                expect(adminResponse.status).toBe(200);
                const adminData = await adminResponse.json();
                expect(adminData.success).toBe(true);
                expect(adminData.data.isValid).toBe(true);
                expect(adminData.data.agentId).toBe(admin.id);
                expect(adminData.data.sessionId).toBe(admin.sessionId);
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

            test("should successfully logout with valid token", async () => {
                // Use the agent token that was created in createTestAccounts
                const response = await fetch(
                    `${baseUrl}${Communication.REST.Endpoint.AUTH_SESSION_LOGOUT.path}`,
                    {
                        method: "POST",
                        headers: {
                            Authorization: `Bearer ${agent.token}`,
                        },
                    },
                );

                expect(response.status).toBe(200);
                const data = await response.json();
                expect(data.success).toBe(true);

                // Verify session is actually invalidated
                const validateResponse = await fetch(
                    `${baseUrl}${Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.path}`,
                    {
                        method: "GET",
                        headers: {
                            Authorization: `Bearer ${agent.token}`,
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
