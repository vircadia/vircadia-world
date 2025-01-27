import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { VircadiaConfig } from "../../sdk/vircadia-world-sdk-ts/config/vircadia.config";
import { Communication } from "../../sdk/vircadia-world-sdk-ts/schema/schema.general";
import type postgres from "postgres";
import { log } from "../../sdk/vircadia-world-sdk-ts/module/general/log";
import { createSqlClient } from "../container/docker/docker_cli";
import WebSocket from "ws";
import {
    createTestAccounts,
    cleanupTestAccounts,
    createTestResources,
    cleanupTestResources,
    type TestAccount,
    type TestResources,
} from "./test_helpers";

describe("WorldApiManager Integration Tests", () => {
    const config = VircadiaConfig.server;
    const baseUrl = `http://${config.serverHost}:${config.serverPort}`;
    const wsBaseUrl = `ws://${config.serverHost}:${config.serverPort}${Communication.WS_PATH}`;

    let sql: postgres.Sql;
    let admin: TestAccount;
    let agent: TestAccount;
    let testResources: TestResources;

    // Setup before all tests
    beforeAll(async () => {
        try {
            // Initialize database connection
            sql = createSqlClient(true);

            // Create test accounts
            const accounts = await createTestAccounts(sql);
            admin = accounts.admin;
            agent = accounts.agent;

            // Create test resources
            testResources = await createTestResources(sql);
        } catch (error) {
            log({
                message: "Failed to setup test environment.",
                type: "error",
                error,
            });
            throw error;
        }
    });

    afterAll(async () => {
        try {
            // Clean up test resources
            await cleanupTestResources(sql, testResources);

            // Clean up test accounts
            await cleanupTestAccounts(sql);

            // Close database connection
            await sql.end();
        } catch (error) {
            log({
                message: "Failed to cleanup test environment.",
                type: "error",
                error,
            });
            throw error;
        }
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
            const wsUrl = `${wsBaseUrl}?token=${agent.token}`;
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
                parameters: [testResources.entityId],
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
            expect(response.results?.[0]?.general__uuid).toBe(
                testResources.entityId,
            );
        });

        test("should handle entity change notifications", async () => {
            let notificationReceived = false;

            // Subscribe using the session ID as the channel
            const subMsg = Communication.WebSocket.createMessage({
                type: Communication.WebSocket.MessageType.SUBSCRIBE,
                channel: agent.sessionId, // Use session ID as the channel
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

            // Create notification promise before making changes
            const notificationPromise = new Promise<void>((resolve) => {
                ws.onmessage = (event) => {
                    const message = JSON.parse(event.data.toString());
                    if (
                        message.type ===
                        Communication.WebSocket.MessageType.NOTIFICATION
                    ) {
                        expect(message.channel).toBe(agent.sessionId); // Expect session ID as channel
                        expect(message.payload.entity_id).toBe(
                            testResources.entityId,
                        );
                        expect(message.payload.operation).toBe("UPDATE");
                        notificationReceived = true;
                        resolve();
                    }
                };
            });

            // Wait a bit to ensure listener is ready
            await new Promise((resolve) => setTimeout(resolve, 100));

            // Update the entity using WS API
            const updateMsg = Communication.WebSocket.createMessage({
                type: Communication.WebSocket.MessageType.QUERY,
                requestId: "update-entity",
                query: `
                    UPDATE entity.entities 
                    SET general__name = $1
                    WHERE general__uuid = $2
                `,
                parameters: ["Updated Test Entity", testResources.entityId],
            });
            ws.send(JSON.stringify(updateMsg));

            // Wait for the notification with a timeout
            await Promise.race([
                notificationPromise,
                new Promise((_, reject) =>
                    setTimeout(
                        () => reject(new Error("Notification timeout")),
                        5000,
                    ),
                ),
            ]);

            // Additional check to ensure we actually received the notification
            expect(notificationReceived).toBe(true);

            // Verify the update happened
            const verifyMsg = Communication.WebSocket.createMessage({
                type: Communication.WebSocket.MessageType.QUERY,
                requestId: "verify-update",
                query: "SELECT general__name FROM entity.entities WHERE general__uuid = $1",
                parameters: [testResources.entityId],
            });
            ws.send(JSON.stringify(verifyMsg));

            const verifyResponse =
                await waitForMessage<Communication.WebSocket.QueryResponseMessage>(
                    Communication.WebSocket.MessageType.QUERY_RESPONSE,
                );
            expect(verifyResponse.results?.[0]?.general__name).toBe(
                "Updated Test Entity",
            );

            // Unsubscribe using session ID
            const unsubMsg = Communication.WebSocket.createMessage({
                type: Communication.WebSocket.MessageType.UNSUBSCRIBE,
                channel: agent.sessionId, // Use session ID as the channel
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
                        Authorization: `Bearer ${admin.token}`,
                    },
                },
            );

            try {
                const data =
                    (await response.json()) as Communication.REST.SessionValidationSuccessResponse;
                expect(response.status).toBe(200);
                expect(data.success).toBe(true);
                expect(data.data.isValid).toBe(true);
                expect(data.data.agentId).toBe(admin.id);
                expect(data.data.sessionId).toBe(admin.sessionId);
            } catch (error) {
                log({
                    message: "Session validation failed",
                    data: {
                        adminId: admin.id,
                        adminSessionId: admin.sessionId,
                        adminToken: admin.token,
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
                        Authorization: `Bearer ${agent.token}`,
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
