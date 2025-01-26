import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { VircadiaConfig } from "../../sdk/vircadia-world-sdk-ts/config/vircadia.config";
import { Communication } from "../../sdk/vircadia-world-sdk-ts/schema/schema.general";
import type postgres from "postgres";
import { log } from "../../sdk/vircadia-world-sdk-ts/module/general/log";
import { sign } from "jsonwebtoken";
import { createSqlClient, up } from "../container/docker/docker_cli";
import WebSocket from "ws";

describe("WorldApiManager Integration Tests", () => {
    const config = VircadiaConfig.server;
    const baseUrl = `http://${config.serverHost}:${config.serverPort}`;
    const wsBaseUrl = `ws://${config.serverHost}:${config.serverPort}${Communication.WS_PATH}`;

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
        try {
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

            // Create test script and entity through WebSocket API
            const wsAdmin = new WebSocket(
                `${wsBaseUrl}?token=${testAdminToken}`,
            );

            // Wait for connection
            await new Promise<void>((resolve) => {
                wsAdmin.onopen = () => resolve();
            });

            // Handle initial connection message
            await new Promise((resolve) => {
                wsAdmin.onmessage = () => resolve(true);
            });

            // Create script
            const createScriptMsg = Communication.WebSocket.createMessage({
                type: Communication.WebSocket.MessageType.QUERY,
                requestId: "create-script",
                query: `
                    INSERT INTO entity.entity_scripts (
                        compiled__web__node__script,
                        compiled__web__node__script_status,
                        source__git__repo_entry_path
                    ) VALUES (
                        'console.log("test script")',
                        'COMPILED',
                        'test/script.ts'
                    ) RETURNING general__script_id
                `,
            });
            wsAdmin.send(JSON.stringify(createScriptMsg));

            // Wait for script creation response
            const scriptResponse =
                await new Promise<Communication.WebSocket.QueryResponseMessage>(
                    (resolve) => {
                        wsAdmin.onmessage = (event) => {
                            const msg = JSON.parse(event.data.toString());
                            if (msg.requestId === "create-script") {
                                resolve(msg);
                            }
                        };
                    },
                );
            testScriptId = scriptResponse.results?.[0].general__script_id;

            // Create entity
            const createEntityMsg = Communication.WebSocket.createMessage({
                type: Communication.WebSocket.MessageType.QUERY,
                requestId: "create-entity",
                query: `
                    INSERT INTO entity.entities (
                        general__name,
                        scripts__ids,
                        permissions__roles__view,
                        permissions__roles__full
                    ) VALUES (
                        'Test Entity',
                        ARRAY[$1]::UUID[],
                        ARRAY['agent']::TEXT[],
                        ARRAY['admin']::TEXT[]
                    ) RETURNING general__uuid
                `,
                parameters: [testScriptId],
            });
            wsAdmin.send(JSON.stringify(createEntityMsg));

            // Wait for entity creation response
            const entityResponse =
                await new Promise<Communication.WebSocket.QueryResponseMessage>(
                    (resolve) => {
                        wsAdmin.onmessage = (event) => {
                            const msg = JSON.parse(event.data.toString());
                            if (msg.requestId === "create-entity") {
                                resolve(msg);
                            }
                        };
                    },
                );
            testEntityId = entityResponse.results?.[0].general__uuid;

            wsAdmin.close();
        } catch (error) {
            log({
                message: "Failed to setup test environment.",
                type: "error",
                error,
            });
        }
    });

    afterAll(async () => {
        // Clean up entities and scripts through WebSocket API
        const wsAdmin = new WebSocket(`${wsBaseUrl}?token=${testAdminToken}`);

        await new Promise<void>((resolve) => {
            wsAdmin.onopen = () => resolve();
        });

        // Handle initial connection message
        await new Promise((resolve) => {
            wsAdmin.onmessage = () => resolve(true);
        });

        // Delete entity
        const deleteEntityMsg = Communication.WebSocket.createMessage({
            type: Communication.WebSocket.MessageType.QUERY,
            requestId: "delete-entity",
            query: "DELETE FROM entity.entities WHERE general__uuid = $1",
            parameters: [testEntityId],
        });
        wsAdmin.send(JSON.stringify(deleteEntityMsg));

        // Delete script
        const deleteScriptMsg = Communication.WebSocket.createMessage({
            type: Communication.WebSocket.MessageType.QUERY,
            requestId: "delete-script",
            query: "DELETE FROM entity.entity_scripts WHERE general__script_id = $1",
            parameters: [testScriptId],
        });
        wsAdmin.send(JSON.stringify(deleteScriptMsg));

        // Clean up test accounts (using SQL directly as this is test setup/cleanup)
        await cleanupTestAccounts();

        wsAdmin.close();
        await sql.end();
    });

    describe("WebSocket Tests", () => {
        let ws: WebSocket;

        // Helper function to wait for specific message types
        const waitForMessage = <T>(
            expectedType: Communication.WebSocket.MessageType,
        ): Promise<T> => {
            return new Promise((resolve) => {
                ws.onmessage = (event) => {
                    const message = JSON.parse(event.data.toString());
                    if (message.type === expectedType) {
                        resolve(message as T);
                    }
                };
            });
        };

        beforeAll(async () => {
            // Establish WebSocket connection before all tests
            const wsUrl = `${wsBaseUrl}?token=${testAgentToken}`;
            ws = new WebSocket(wsUrl);

            // Wait for connection with increased timeout
            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error("WebSocket connection timed out"));
                }, 10000); // 10 second timeout

                ws.onopen = () => {
                    clearTimeout(timeout);
                    resolve();
                };

                ws.onerror = (error) => {
                    clearTimeout(timeout);
                    reject(error);
                };
            });

            // Wait for initial connection established message
            const connMsg =
                await waitForMessage<Communication.WebSocket.ConnectionEstablishedMessage>(
                    Communication.WebSocket.MessageType.CONNECTION_ESTABLISHED,
                );
            expect(connMsg.type).toBe(
                Communication.WebSocket.MessageType.CONNECTION_ESTABLISHED,
            );
        });

        afterAll(() => {
            // Close WebSocket connection after all tests
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.close();
            }
        });

        test("should reject WebSocket connection with invalid token", async () => {
            // First make a regular HTTP request to get the rejection response
            const httpResponse = await fetch(
                `${wsBaseUrl.replace("ws:", "http:")}?token=invalid_token`,
            );
            expect(httpResponse.status).toBe(401);
            const responseBody = await httpResponse.text();
            expect(responseBody).toBe("Invalid token");

            // Then verify WebSocket connection also fails
            const wsUrl = `${wsBaseUrl}?token=invalid_token`;
            const ws = new WebSocket(wsUrl);

            // Wait for either connection or timeout after 1 second
            const connectionResult = await Promise.race([
                new Promise<"connected">((resolve) => {
                    ws.onopen = () => resolve("connected");
                }),
                new Promise<"timeout">((resolve) => {
                    setTimeout(() => resolve("timeout"), 1000);
                }),
            ]);

            // If we got a connection, that's a failure
            if (connectionResult === "connected") {
                ws.close();
                throw new Error(
                    "WebSocket connection succeeded when it should have failed",
                );
            }

            // Connection timeout means the server rejected it as expected
            expect(ws.readyState).toBe(WebSocket.CLOSED);
        });

        test("should handle entity queries", async () => {
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
                await waitForMessage<Communication.WebSocket.QueryResponseMessage>(
                    Communication.WebSocket.MessageType.QUERY_RESPONSE,
                );

            expect(response.type).toBe(
                Communication.WebSocket.MessageType.QUERY_RESPONSE,
            );
            expect(response.requestId).toBe("test-query");
            expect(response.results).toBeDefined();
            expect(response.results?.[0]?.general__uuid).toBe(testEntityId); // Access first row of results
        });

        test("should handle entity change notifications", async () => {
            // Subscribe to entity changes
            const subMsg = Communication.WebSocket.createMessage({
                type: Communication.WebSocket.MessageType.SUBSCRIBE,
                channel: testAgentSessionId,
            });
            ws.send(JSON.stringify(subMsg));

            // Wait for subscription confirmation
            const subResponse =
                await waitForMessage<Communication.WebSocket.SubscribeResponseMessage>(
                    Communication.WebSocket.MessageType.SUBSCRIBE_RESPONSE,
                );
            expect(subResponse.type).toBe(
                Communication.WebSocket.MessageType.SUBSCRIBE_RESPONSE,
            );
            expect(subResponse.success).toBe(true);

            // Set up notification listener before making the change
            const notificationPromise =
                waitForMessage<Communication.WebSocket.NotificationMessage>(
                    Communication.WebSocket.MessageType.NOTIFICATION,
                );

            // Update the entity using WS API
            const updateMsg = Communication.WebSocket.createMessage({
                type: Communication.WebSocket.MessageType.QUERY,
                requestId: "update-entity",
                query: `
                    UPDATE entity.entities 
                    SET general__name = $1
                    WHERE general__uuid = $2
                `,
                parameters: ["Updated Test Entity", testEntityId],
            });
            ws.send(JSON.stringify(updateMsg));

            // Wait for update confirmation
            const updateResponse =
                await waitForMessage<Communication.WebSocket.QueryResponseMessage>(
                    Communication.WebSocket.MessageType.QUERY_RESPONSE,
                );
            expect(updateResponse.requestId).toBe("update-entity");
            expect(updateResponse.error).toBeUndefined();

            // Wait for notification
            const notification = await notificationPromise;
            expect(notification.type).toBe(
                Communication.WebSocket.MessageType.NOTIFICATION,
            );
            expect(notification.channel).toBe("entity_changes");
            expect(notification.payload.entity_id).toBe(testEntityId);
            expect(notification.payload.operation).toBe("UPDATE");

            // Unsubscribe
            const unsubMsg = Communication.WebSocket.createMessage({
                type: Communication.WebSocket.MessageType.UNSUBSCRIBE,
                channel: "entity_changes",
            });
            ws.send(JSON.stringify(unsubMsg));

            // Wait for unsubscribe confirmation
            const unsubResponse =
                await waitForMessage<Communication.WebSocket.UnsubscribeResponseMessage>(
                    Communication.WebSocket.MessageType.UNSUBSCRIBE_RESPONSE,
                );
            expect(unsubResponse.type).toBe(
                Communication.WebSocket.MessageType.UNSUBSCRIBE_RESPONSE,
            );
            expect(unsubResponse.success).toBe(true);
        });
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
});
