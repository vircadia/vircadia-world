import { describe, test, expect, beforeAll } from "bun:test";
import { VircadiaConfig } from "../../sdk/vircadia-world-sdk-ts/config/vircadia.config";
import { Communication } from "../../sdk/vircadia-world-sdk-ts/schema/schema.general";
import { generateDbSystemToken } from "../container/docker/docker_cli";

describe("WorldApiManager Integration Tests", () => {
    const config = VircadiaConfig.server;
    const baseUrl = `http://${config.serverHost}:${config.serverPort}`;
    const wsBaseUrl = `ws://${config.serverHost}:${config.serverPort}${Communication.WS_BASE_URL}`;

    let mockToken: string;
    let mockAgentId: string;
    let mockSessionId: string;

    // Setup before all tests
    beforeAll(async () => {
        // Get system token for testing
        const systemAuth = await generateDbSystemToken();
        mockToken = systemAuth.token;
        mockAgentId = systemAuth.agentId;
        mockSessionId = systemAuth.sessionId;
    });

    describe("REST API Tests", () => {
        test("should validate a valid session token", async () => {
            const response = await fetch(
                `${baseUrl}${Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.path}`,
                {
                    method: "GET",
                    headers: {
                        Authorization: `Bearer ${mockToken}`,
                    },
                },
            );

            const data =
                (await response.json()) as Communication.REST.SessionValidationSuccessResponse;
            expect(response.status).toBe(200);
            expect(data.success).toBe(true);
            expect(data.data.isValid).toBe(true);
            expect(data.data.agentId).toBe(mockAgentId);
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
                        Authorization: `Bearer ${mockToken}`,
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
            const wsUrl = `${wsBaseUrl}?token=${mockToken}`;
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
            expect(message.agentId).toBe(mockAgentId);

            ws.close();
        });

        test("should reject WebSocket connection with invalid token", async () => {
            const wsUrl = `${wsBaseUrl}?token=invalid_token`;
            const ws = new WebSocket(wsUrl);

            const connected = await new Promise((resolve) => {
                ws.onopen = () => resolve(true);
                ws.onerror = () => resolve(false);
                setTimeout(() => resolve(false), 1000); // Add 1s timeout
            });

            expect(connected).toBe(false);
            ws.close();
        });

        test("should handle heartbeat messages", async () => {
            const wsUrl = `${wsBaseUrl}?token=${mockToken}`;
            const ws = new WebSocket(wsUrl);

            // Wait for connection and initial message
            await new Promise<void>((resolve) => {
                ws.onopen = () => resolve();
            });

            // Handle the initial CONNECTION_ESTABLISHED message
            await new Promise((resolve) => {
                ws.onmessage = (event) => resolve(JSON.parse(event.data));
            });

            // Send heartbeat message
            const heartbeatMsg = Communication.WebSocket.createMessage({
                type: Communication.WebSocket.MessageType.HEARTBEAT,
            });
            ws.send(JSON.stringify(heartbeatMsg));

            // Wait for heartbeat acknowledgment
            const response =
                await new Promise<Communication.WebSocket.HeartbeatAckMessage>(
                    (resolve) => {
                        ws.onmessage = (event) => {
                            resolve(JSON.parse(event.data));
                        };
                    },
                );

            expect(response.type).toBe(
                Communication.WebSocket.MessageType.HEARTBEAT_ACK,
            );

            ws.close();
        });

        test("should receive client config on request", async () => {
            const wsUrl = `${wsBaseUrl}?token=${mockToken}`;
            const ws = new WebSocket(wsUrl);

            // Wait for connection and initial message
            await new Promise<void>((resolve) => {
                ws.onopen = () => resolve();
            });

            // Handle the initial CONNECTION_ESTABLISHED message
            await new Promise((resolve) => {
                ws.onmessage = (event) => resolve(JSON.parse(event.data));
            });

            // Send config request
            const configRequest = Communication.WebSocket.createMessage({
                type: Communication.WebSocket.MessageType.CONFIG_REQUEST,
            });
            ws.send(JSON.stringify(configRequest));

            // Wait for config response
            const response =
                await new Promise<Communication.WebSocket.ConfigResponseMessage>(
                    (resolve) => {
                        ws.onmessage = (event) => {
                            resolve(JSON.parse(event.data));
                        };
                    },
                );

            expect(response.type).toBe(
                Communication.WebSocket.MessageType.CONFIG_RESPONSE,
            );
            expect(response.config).toBeDefined();
            expect(response.config.heartbeat).toBeDefined();
            expect(response.config.session).toBeDefined();

            ws.close();
        });
    });
});
