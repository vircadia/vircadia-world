import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { VircadiaConfig } from "../../sdk/vircadia-world-sdk-ts/config/vircadia.config";
import { Communication } from "../../sdk/vircadia-world-sdk-ts/schema/schema.general";
import type postgres from "postgres";
import { log } from "../../sdk/vircadia-world-sdk-ts/module/general/log";
import { sign } from "jsonwebtoken";
import { createSqlClient, up } from "../container/docker/docker_cli";

describe("WorldApiManager Integration Tests", () => {
    const config = VircadiaConfig.server;
    const baseUrl = `http://${config.serverHost}:${config.serverPort}`;
    const wsBaseUrl = `ws://${config.serverHost}:${config.serverPort}${Communication.WS_BASE_URL}`;

    let sql: postgres.Sql;
    let testAdminId: string;
    let testAdminToken: string;
    let testAdminSessionId: string;
    let testAgentId: string;
    let testAgentToken: string;
    let testAgentSessionId: string;
    let testEntityId: string;
    let testScriptId: string;

    async function cleanupTestAccounts() {
        // Clean up profiles (roles and sessions will cascade)
        await sql`
            DELETE FROM auth.agent_profiles 
            WHERE profile__username IN ('test_admin', 'test_agent')
        `;
    }

    // Setup before all tests
    beforeAll(async () => {
        // Initialize database connection
        sql = createSqlClient(true);

        // Clean up any existing test accounts first
        await cleanupTestAccounts();

        // Get auth settings from config
        const [authConfig] = await sql`
            SELECT value FROM config.config 
            WHERE key = 'auth_settings'
        `;

        if (!authConfig?.value) {
            throw new Error("Auth settings not found in database");
        }

        // Create test admin account
        const [adminAccount] = await sql`
            INSERT INTO auth.agent_profiles (profile__username, auth__email)
            VALUES ('test_admin', 'test_admin@test.com')
            RETURNING general__uuid
        `;
        testAdminId = adminAccount.general__uuid;

        // Assign admin role
        await sql`
            INSERT INTO auth.agent_roles (auth__agent_id, auth__role_name, auth__is_active)
            VALUES (${testAdminId}, 'admin', true)
        `;

        // Create test regular agent account
        const [agentAccount] = await sql`
            INSERT INTO auth.agent_profiles (profile__username, auth__email)
            VALUES ('test_agent', 'test_agent@test.com')
            RETURNING general__uuid
        `;
        testAgentId = agentAccount.general__uuid;

        // Assign agent role
        await sql`
            INSERT INTO auth.agent_roles (auth__agent_id, auth__role_name, auth__is_active)
            VALUES (${testAgentId}, 'agent', true)
        `;

        // Create sessions for both accounts
        const [adminSession] = await sql`
            SELECT * FROM create_agent_session(${testAdminId}, 'test')
        `;
        testAdminSessionId = adminSession.general__session_id;

        const [agentSession] = await sql`
            SELECT * FROM create_agent_session(${testAgentId}, 'test')
        `;
        testAgentSessionId = agentSession.general__session_id;

        // Generate JWT tokens
        testAdminToken = sign(
            {
                sessionId: testAdminSessionId,
                agentId: testAdminId,
            },
            authConfig.value.jwt_secret,
            {
                expiresIn: authConfig.value.jwt_session_duration,
            },
        );

        testAgentToken = sign(
            {
                sessionId: testAgentSessionId,
                agentId: testAgentId,
            },
            authConfig.value.jwt_secret,
            {
                expiresIn: authConfig.value.jwt_session_duration,
            },
        );

        // Update sessions with JWT tokens
        await sql`
            UPDATE auth.agent_sessions 
            SET session__jwt = ${testAdminToken}
            WHERE general__session_id = ${testAdminSessionId}
        `;

        await sql`
            UPDATE auth.agent_sessions 
            SET session__jwt = ${testAgentToken}
            WHERE general__session_id = ${testAgentSessionId}
        `;

        // Create a test script
        const [scriptResult] = await sql<[{ general__script_id: string }]>`
            INSERT INTO entity.entity_scripts (
                compiled__web__node__script,
                compiled__web__node__script_status,
                source__git__repo_entry_path
            ) VALUES (
                'console.log("test script")',
                'COMPILED',
                'test/script.ts'
            ) RETURNING general__script_id
        `;
        testScriptId = scriptResult.general__script_id;

        // Create a test entity
        const [entityResult] = await sql<[{ general__uuid: string }]>`
            INSERT INTO entity.entities (
                general__name,
                scripts__ids,
                permissions__roles__view,
                permissions__roles__full
            ) VALUES (
                'Test Entity',
                ARRAY[${testScriptId}]::UUID[],
                ARRAY['agent']::TEXT[],
                ARRAY['admin']::TEXT[]
            ) RETURNING general__uuid
        `;
        testEntityId = entityResult.general__uuid;
    });

    afterAll(async () => {
        // Clean up test data
        await sql`DELETE FROM entity.entities WHERE general__uuid = ${testEntityId}`;
        await sql`DELETE FROM entity.entity_scripts WHERE general__script_id = ${testScriptId}`;

        // Clean up test accounts
        await cleanupTestAccounts();

        await sql.end();

        // Add server process termination
        await serverProcess.kill();
    });

    describe("REST API Tests", () => {
        test("should validate a valid session token", async () => {
            const response = await fetch(
                `${baseUrl}${Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.path}`,
                {
                    method: "GET",
                    headers: {
                        Authorization: `Bearer ${testAdminToken}`,
                    },
                },
            );

            try {
                const data =
                    (await response.json()) as Communication.REST.SessionValidationSuccessResponse;
                expect(response.status).toBe(200);
                expect(data.success).toBe(true);
                expect(data.data.isValid).toBe(true);
                expect(data.data.agentId).toBe(testAdminId);
                expect(data.data.sessionId).toBe(testAdminSessionId);
            } catch (error) {
                log({
                    message: "Session validation failed",
                    data: {
                        testAdminId,
                        testAdminSessionId,
                        testAdminToken,
                    },
                    type: "error",
                    error,
                });
                throw error;
            }
        });

        test("should reject an invalid session token", async () => {
            const response = await fetch(
                `${baseUrl}${Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.path}`,
                {
                    method: "GET",
                    headers: {
                        Authorization: "Bearer invalid_token",
                    },
                },
            );

            const data =
                (await response.json()) as Communication.REST.SessionValidationErrorResponse;
            expect(response.status).toBe(200);
            expect(data.success).toBe(false);
            expect(data.error).toBe("Invalid token");
        });

        test("should successfully logout a valid session", async () => {
            const response = await fetch(
                `${baseUrl}${Communication.REST.Endpoint.AUTH_SESSION_LOGOUT.path}`,
                {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${testAgentToken}`,
                    },
                },
            );

            const data =
                (await response.json()) as Communication.REST.SessionLogoutSuccessResponse;
            expect(response.status).toBe(200);
            expect(data.success).toBe(true);
            expect(data.timestamp).toBeDefined();
        });

        test("should handle logout with invalid token", async () => {
            const response = await fetch(
                `${baseUrl}${Communication.REST.Endpoint.AUTH_SESSION_LOGOUT.path}`,
                {
                    method: "POST",
                    headers: {
                        Authorization: "Bearer invalid_token",
                    },
                },
            );

            const data =
                (await response.json()) as Communication.REST.SessionLogoutSuccessResponse;
            expect(response.status).toBe(200);
            expect(data.success).toBe(true); // Even invalid tokens return success since the session is already invalid/gone
        });

        test("should handle logout without token", async () => {
            const response = await fetch(
                `${baseUrl}${Communication.REST.Endpoint.AUTH_SESSION_LOGOUT.path}`,
                {
                    method: "POST",
                },
            );

            const data =
                (await response.json()) as Communication.REST.SessionLogoutErrorResponse;
            expect(response.status).toBe(401);
            expect(data.success).toBe(false);
            expect(data.error).toBe("No token provided");
        });
    });

    describe("WebSocket Tests", () => {
        test("should establish WebSocket connection with valid token", async () => {
            const wsUrl = `${wsBaseUrl}?token=${testAgentToken}`;
            const ws = new WebSocket(wsUrl);

            const connected = await new Promise((resolve) => {
                ws.onopen = () => resolve(true);
                ws.onerror = () => resolve(false);
            });

            expect(connected).toBe(true);

            // Wait for connection established message
            const message =
                await new Promise<Communication.WebSocket.ConnectionEstablishedMessage>(
                    (resolve) => {
                        ws.onmessage = (event) => {
                            resolve(JSON.parse(event.data));
                        };
                    },
                );

            expect(message.type).toBe(
                Communication.WebSocket.MessageType.CONNECTION_ESTABLISHED,
            );
            expect(message.agentId).toBe(testAgentId);

            ws.close();
        });

        test("should handle entity queries", async () => {
            const wsUrl = `${wsBaseUrl}?token=${testAgentToken}`;
            const ws = new WebSocket(wsUrl);

            await new Promise<void>((resolve) => {
                ws.onopen = () => resolve();
            });

            // Handle initial connection message
            await new Promise((resolve) => {
                ws.onmessage = () => resolve(true);
            });

            // Send query request
            const queryMsg = Communication.WebSocket.createMessage({
                type: Communication.WebSocket.MessageType.QUERY,
                requestId: "test-query",
                query: "SELECT * FROM entity.entities WHERE general__uuid = $1",
                parameters: [testEntityId],
            });
            ws.send(JSON.stringify(queryMsg));

            // Wait for query response
            const response =
                await new Promise<Communication.WebSocket.QueryResponseMessage>(
                    (resolve) => {
                        ws.onmessage = (event) => {
                            resolve(JSON.parse(event.data));
                        };
                    },
                );

            expect(response.type).toBe(
                Communication.WebSocket.MessageType.QUERY_RESPONSE,
            );
            expect(response.requestId).toBe("test-query");
            expect(response.results).toBeDefined();
            expect(response.results?.[0].general__uuid).toBe(testEntityId);

            ws.close();
        });

        test("should handle entity change notifications", async () => {
            const wsUrl = `${wsBaseUrl}?token=${testAgentToken}`;
            const ws = new WebSocket(wsUrl);

            await new Promise<void>((resolve) => {
                ws.onopen = () => resolve();
            });

            // Handle initial connection message
            await new Promise((resolve) => {
                ws.onmessage = () => resolve(true);
            });

            // Subscribe to entity changes
            const subMsg = Communication.WebSocket.createMessage({
                type: Communication.WebSocket.MessageType.SUBSCRIBE,
                channel: "entity_changes",
            });
            ws.send(JSON.stringify(subMsg));

            // Wait for subscription confirmation
            const subResponse =
                await new Promise<Communication.WebSocket.SubscribeResponseMessage>(
                    (resolve) => {
                        ws.onmessage = (event) => {
                            resolve(JSON.parse(event.data));
                        };
                    },
                );

            expect(subResponse.type).toBe(
                Communication.WebSocket.MessageType.SUBSCRIBE_RESPONSE,
            );
            expect(subResponse.success).toBe(true);

            // Update the entity to trigger a notification
            const updatePromise =
                new Promise<Communication.WebSocket.NotificationMessage>(
                    (resolve) => {
                        ws.onmessage = (event) => {
                            resolve(JSON.parse(event.data));
                        };
                    },
                );

            await sql`
                UPDATE entity.entities
                SET general__name = 'Updated Test Entity'
                WHERE general__uuid = ${testEntityId}
            `;

            const notification = await updatePromise;
            expect(notification.type).toBe(
                Communication.WebSocket.MessageType.NOTIFICATION,
            );
            expect(notification.channel).toBe("entity_changes");
            expect(notification.payload.entity_id).toBe(testEntityId);
            expect(notification.payload.operation).toBe("UPDATE");

            // Unsubscribe from entity changes
            const unsubMsg = Communication.WebSocket.createMessage({
                type: Communication.WebSocket.MessageType.UNSUBSCRIBE,
                channel: "entity_changes",
            });
            ws.send(JSON.stringify(unsubMsg));

            // Wait for unsubscribe confirmation
            const unsubResponse =
                await new Promise<Communication.WebSocket.UnsubscribeResponseMessage>(
                    (resolve) => {
                        ws.onmessage = (event) => {
                            resolve(JSON.parse(event.data));
                        };
                    },
                );

            expect(unsubResponse.type).toBe(
                Communication.WebSocket.MessageType.UNSUBSCRIBE_RESPONSE,
            );
            expect(unsubResponse.success).toBe(true);

            ws.close();
        });
    });
});
