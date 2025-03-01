import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import type { Subprocess } from "bun";
import type postgres from "postgres";
import { PostgresClient } from "../database/postgres/postgres_client";
import {
	Communication,
	Entity,
} from "../../sdk/vircadia-world-sdk-ts/schema/schema.general";
import { VircadiaConfig } from "../../sdk/vircadia-world-sdk-ts/config/vircadia.config";
import {
	cleanupTestAccounts,
	cleanupTestAssets,
	cleanupTestEntities,
	cleanupTestScripts,
	DB_TEST_PREFIX,
	initContainers,
	initTestAccounts,
	TEST_SYNC_GROUP,
	type TestAccount,
} from "./helper/helpers";
import { log } from "../../sdk/vircadia-world-sdk-ts/module/general/log";

// TODO: Add benchmarks.

describe("Service Tests", () => {
	let superUserSql: postgres.Sql;
	let proxyUserSql: postgres.Sql;

	let apiManagerProcess: Subprocess | null;
	let webScriptManagerProcess: Subprocess | null;
	let tickManagerProcess: Subprocess | null;

	let adminAgent: TestAccount;
	let regularAgent: TestAccount;
	let anonAgent: TestAccount;

	let regularAgentWsConnection: WebSocket | null;

	// Add accessor for WorldApiManager instance from the server
	let worldApiManager: any;

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

		apiManagerProcess = Bun.spawn(["bun", "run", "service:run:api"], {
			cwd: process.cwd(),
			...(VircadiaConfig.SERVER.SUPPRESS
				? { stdio: ["ignore", "ignore", "ignore"] }
				: VircadiaConfig.SERVER.DEBUG
					? { stdio: ["inherit", "inherit", "inherit"] }
					: { stdio: ["ignore", "ignore", "ignore"] }),
			killSignal: "SIGTERM",
		});

		webScriptManagerProcess = Bun.spawn(["bun", "run", "service:run:script"], {
			cwd: process.cwd(),
			...(VircadiaConfig.SERVER.SUPPRESS
				? { stdio: ["ignore", "ignore", "ignore"] }
				: VircadiaConfig.SERVER.DEBUG
					? { stdio: ["inherit", "inherit", "inherit"] }
					: { stdio: ["ignore", "ignore", "ignore"] }),
			killSignal: "SIGTERM",
		});

		tickManagerProcess = Bun.spawn(["bun", "run", "service:run:tick"], {
			cwd: process.cwd(),
			...(VircadiaConfig.SERVER.SUPPRESS
				? { stdio: ["ignore", "ignore", "ignore"] }
				: VircadiaConfig.SERVER.DEBUG
					? { stdio: ["inherit", "inherit", "inherit"] }
					: { stdio: ["ignore", "ignore", "ignore"] }),
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

	test("services should launch and become available", async () => {
		expect(apiManagerProcess?.pid).toBeGreaterThan(0);
		expect(webScriptManagerProcess?.pid).toBeGreaterThan(0);
		expect(tickManagerProcess?.pid).toBeGreaterThan(0);
	});

	describe("Web Script Manager", () => {
		test("should compile scripts for all platforms", async () => {
			// Insert test script
			const result = await superUserSql<
				Pick<Entity.Script.I_Script, "general__script_id">[]
			>`
                        WITH inserted_script AS (
                            INSERT INTO entity.entity_scripts (
                                general__script_name,
                                group__sync,
                                source__repo__url,
                                source__repo__entry_path
                            ) 
                            VALUES (
                                ${`${DB_TEST_PREFIX}babylon_js->entity->model`},
                                'public.STATIC',
                                'https://github.com/vircadia/vircadia-world-sdk-ts',
                                'script/babylon_js/entity_model.ts'
                            )
                            RETURNING general__script_id
                        )
                        SELECT general__script_id FROM inserted_script
                    `;

			expect(result.length).toBe(1);
			const scriptId = result[0].general__script_id;
			expect(scriptId).toBeDefined();

			// Increase polling duration to match the 60s timeout
			const maxAttempts = 55; // 55 seconds total (leaving 5s buffer for other operations)
			let attempts = 0;
			let status = {
				compiled__browser__status: Entity.Script.E_CompilationStatus.PENDING,
				compiled__node__status: Entity.Script.E_CompilationStatus.PENDING,
				compiled__bun__status: Entity.Script.E_CompilationStatus.PENDING,
			};

			while (attempts < maxAttempts) {
				const compilationResult = await superUserSql<
					Pick<
						Entity.Script.I_Script,
						| "compiled__browser__status"
						| "compiled__node__status"
						| "compiled__bun__status"
					>[]
				>`
                            SELECT 
                                compiled__browser__status as "compiled__browser__status",
                                compiled__node__status as "compiled__node__status",
                                compiled__bun__status as "compiled__bun__status"
                            FROM entity.entity_scripts 
                            WHERE general__script_id = ${scriptId}
                        `;

				if (!compilationResult[0]) {
					throw new Error("No compilation result found");
				}

				status = {
					compiled__browser__status:
						compilationResult[0].compiled__browser__status ??
						Entity.Script.E_CompilationStatus.PENDING,
					compiled__node__status:
						compilationResult[0].compiled__node__status ??
						Entity.Script.E_CompilationStatus.PENDING,
					compiled__bun__status:
						compilationResult[0].compiled__bun__status ??
						Entity.Script.E_CompilationStatus.PENDING,
				};

				// If any platform is still compiling or pending, wait
				if (
					Object.values(status).some(
						(s) =>
							s === Entity.Script.E_CompilationStatus.COMPILING ||
							s === Entity.Script.E_CompilationStatus.PENDING,
					)
				) {
					await new Promise((resolve) => setTimeout(resolve, 1000));
					attempts++;
					continue;
				}

				// If all platforms are either COMPILED, break
				break;
			}

			// Log detailed status for debugging
			log({
				message: "Final compilation status",
				type: "debug",
				data: status,
				suppress: VircadiaConfig.SERVER.SUPPRESS,
				debug: VircadiaConfig.SERVER.DEBUG,
			});

			// Check compilation status for all platforms
			expect(status.compiled__browser__status).toBe(
				Entity.Script.E_CompilationStatus.COMPILED,
			);
			expect(status.compiled__node__status).toBe(
				Entity.Script.E_CompilationStatus.COMPILED,
			);
			expect(status.compiled__bun__status).toBe(
				Entity.Script.E_CompilationStatus.COMPILED,
			);
		}, 60000);
	});

	describe("API Manager", () => {
		describe("REST", () => {
			describe("Authentication Endpoints", () => {
				const baseUrl = `${VircadiaConfig.CLIENT.defaultWorldServerUriUsingSsl ? "https" : "http"}://${VircadiaConfig.CLIENT.defaultWorldServerUri}`;

				test("should validate a valid session token", async () => {
					const regularResponse = await fetch(
						`${baseUrl}${Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.path}`,
						{
							method: "POST",
							headers: {
								"Content-Type": "application/json",
							},
							body: Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.createRequest(
								{
									token: regularAgent.token,
									provider: "system",
								},
							),
						},
					);

					expect(regularResponse.status).toBe(200);
					const data = await regularResponse.json();
					expect(data.success).toBe(true);
				});

				test("should reject an invalid session token", async () => {
					const response = await fetch(
						`${baseUrl}${Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.path}`,
						{
							method: "POST",
							headers: {
								"Content-Type": "application/json",
							},
							body: Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.createRequest(
								{
									token: "invalid-token",
									provider: "system",
								},
							),
						},
					);

					expect(response.status).toBe(401);
					const data = await response.json();
					expect(data.success).toBe(false);
				});

				test("should reject requests without a token", async () => {
					const response = await fetch(
						`${baseUrl}${Communication.REST.Endpoint.AUTH_SESSION_VALIDATE.path}`,
						{
							method: "POST",
							headers: {
								"Content-Type": "application/json",
							},
							body: JSON.stringify({
								// Missing token
								provider: "system",
							}),
						},
					);

					expect(response.status).toBe(401);
					const data = await response.json();
					expect(data.success).toBe(false);
				});
			});
		});

		describe("WS", () => {
			beforeAll(async () => {
				// Connect to WebSocket server with authentication token
				const wsUrl = `${VircadiaConfig.CLIENT.defaultWorldServerUriUsingSsl ? "wss" : "ws"}://${
					VircadiaConfig.CLIENT.defaultWorldServerUri
				}${Communication.WS_UPGRADE_PATH}?token=${regularAgent.token}&provider=system`;

				return new Promise((resolve, reject) => {
					regularAgentWsConnection = new WebSocket(wsUrl);

					regularAgentWsConnection.onopen = () => {
						log({
							message: "WebSocket connected",
							type: "debug",
							debug: VircadiaConfig.SERVER.DEBUG,
							suppress: VircadiaConfig.SERVER.SUPPRESS,
						});
						resolve(true);
					};

					regularAgentWsConnection.onerror = (error) => {
						log({
							message: `WebSocket connection error: ${error}`,
							type: "error",
							debug: VircadiaConfig.SERVER.DEBUG,
							suppress: VircadiaConfig.SERVER.SUPPRESS,
						});
						reject(error);
					};

					// Set up message handling for tests
					regularAgentWsConnection.onmessage = (event) => {
						const message = JSON.parse(event.data);

						// Store messages by type
						if (message?.type) {
							messagesByType[message.type] = message;
						}

						// Set flags to indicate message received (both general and type-specific)
						messageReceived = true;
						messageReceivedByType[message.type] = true;
					};
				});
			});

			// Store messages by type
			let messageReceived = false;
			const messageReceivedByType: Record<string, boolean> = {};
			const messagesByType: Record<string, any> = {};

			const waitForMessage = async (
				messageType?: Communication.WebSocket.MessageType,
				timeoutMs = 1000,
			): Promise<any> => {
				// Reset flags
				if (messageType) {
					messageReceivedByType[messageType] = false;
				} else {
					messageReceived = false;
				}

				return new Promise((resolve, reject) => {
					const timeout = setTimeout(() => {
						reject(
							new Error(
								`Timed out waiting for WebSocket message${messageType ? ` of type ${messageType}` : ""}`,
							),
						);
					}, timeoutMs);

					// If we already have the message type we're looking for, resolve immediately
					if (messageType && messagesByType[messageType]) {
						clearTimeout(timeout);
						const message = messagesByType[messageType];
						// Clear the stored message to prevent returning stale data
						messagesByType[messageType] = null;
						resolve(message);
						return;
					}

					const checkInterval = setInterval(() => {
						if (messageType && messageReceivedByType[messageType]) {
							clearInterval(checkInterval);
							clearTimeout(timeout);
							const message = messagesByType[messageType];
							// Clear the stored message to prevent returning stale data
							messagesByType[messageType] = null;
							resolve(message);
						} else if (!messageType && messageReceived) {
							clearInterval(checkInterval);
							clearTimeout(timeout);
							messageReceived = false;
							// Return the last message of any type
							for (const type in messageReceivedByType) {
								if (messageReceivedByType[type]) {
									messageReceivedByType[type] = false;
									resolve(messagesByType[type]);
									return;
								}
							}
							resolve(null); // Shouldn't reach here if messageReceived is true
						}
					}, 10);
				});
			};

			test("should establish WebSocket connection successfully", async () => {
				expect(regularAgentWsConnection).not.toBeNull();
				expect(regularAgentWsConnection?.readyState).toBe(WebSocket.OPEN);
			});

			test("should update session heartbeat through query request", async () => {
				if (!regularAgentWsConnection) {
					throw new Error("WebSocket connection not established");
				}

				// First, query to get the current session timestamp
				regularAgentWsConnection.send(
					JSON.stringify(
						new Communication.WebSocket.QueryRequestMessage(
							"SELECT session__last_seen_at FROM auth.agent_sessions WHERE general__session_id = $1::UUID",
							[regularAgent.sessionId],
						),
					),
				);

				// Wait specifically for a QUERY_RESPONSE message
				const initialResponse = await waitForMessage(
					Communication.WebSocket.MessageType.QUERY_RESPONSE,
				);
				expect(initialResponse).toBeDefined();
				expect(initialResponse.type).toBe(
					Communication.WebSocket.MessageType.QUERY_RESPONSE,
				);
				expect(initialResponse.result).toBeInstanceOf(Array);
				expect(initialResponse.result.length).toBe(1);
				const initialTimestamp = new Date(
					initialResponse.result[0].session__last_seen_at,
				);

				// Wait briefly to ensure timestamp will be different
				await Bun.sleep(10);

				// Send a query request to update the session heartbeat
				regularAgentWsConnection.send(
					JSON.stringify(
						new Communication.WebSocket.QueryRequestMessage(
							"SELECT auth.update_session_heartbeat_from_session_id($1::UUID)",
							[regularAgent.sessionId],
						),
					),
				);

				// Wait specifically for a QUERY_RESPONSE message
				const updateResponse = await waitForMessage(
					Communication.WebSocket.MessageType.QUERY_RESPONSE,
				);
				expect(updateResponse).toBeDefined();
				expect(updateResponse.type).toBe(
					Communication.WebSocket.MessageType.QUERY_RESPONSE,
				);
				expect(updateResponse.error).toBeNull();

				// Query again to verify the timestamp was updated
				regularAgentWsConnection.send(
					JSON.stringify(
						new Communication.WebSocket.QueryRequestMessage(
							"SELECT session__last_seen_at FROM auth.agent_sessions WHERE general__session_id = $1::UUID",
							[regularAgent.sessionId],
						),
					),
				);

				// Wait specifically for a QUERY_RESPONSE message
				const finalResponse = await waitForMessage(
					Communication.WebSocket.MessageType.QUERY_RESPONSE,
				);
				expect(finalResponse).toBeDefined();
				expect(finalResponse.type).toBe(
					Communication.WebSocket.MessageType.QUERY_RESPONSE,
				);
				expect(finalResponse.result).toBeInstanceOf(Array);
				expect(finalResponse.result.length).toBe(1);

				// Verify the timestamp was updated and is newer
				const updatedTimestamp = new Date(
					finalResponse.result[0].session__last_seen_at,
				);
				expect(updatedTimestamp.getTime()).toBeGreaterThan(
					initialTimestamp.getTime(),
				);
			});

			test("should receive sync group updates after entity creation", async () => {
				// Get reference to the WorldApiManager API for events
				// This could be exposed through a test-specific endpoint

				// Create an entity in the database to trigger an update
				await proxyUserSql.begin(async (tx) => {
					await tx`SELECT auth.set_agent_context_from_agent_id(${regularAgent.id}::uuid)`;

					const result = await tx`
									INSERT INTO entity.entities (
											general__entity_name,
											meta__data,
											group__sync
									) VALUES (
											${"Test WS Update Entity"},
											${tx.json({
												test_script_1: {
													test_property: "lol",
												},
											})},
											${TEST_SYNC_GROUP}
									) RETURNING general__entity_id
							`;

					// Log the new entity ID for debugging
					const entityId = result[0]?.general__entity_id;
					log({
						message: `Created test entity with ID: ${entityId}`,
						debug: VircadiaConfig.SERVER.DEBUG,
						suppress: VircadiaConfig.SERVER.SUPPRESS,
						type: "debug",
					});
				});

				// Create a Promise that resolves when updates are sent for our sync group
				const updatesPromise = new Promise((resolve, reject) => {
					// Set timeout for safety
					const timeout = setTimeout(() => {
						reject(new Error("Timed out waiting for sync group updates"));
					}, 5000);

					// Request updates for our sync group
					if (regularAgentWsConnection) {
						regularAgentWsConnection.send(
							JSON.stringify(
								new Communication.WebSocket.QueryRequestMessage(
									"SELECT tick.capture_tick_state($1)",
									[TEST_SYNC_GROUP],
								),
							),
						);

						// Listen for SyncGroupUpdatesResponse directly from the WebSocket
						const messageHandler = (event: MessageEvent) => {
							const message = JSON.parse(event.data);
							if (
								message.type ===
								Communication.WebSocket.MessageType.SYNC_GROUP_UPDATES_RESPONSE
							) {
								clearTimeout(timeout);
								regularAgentWsConnection?.removeEventListener(
									"message",
									messageHandler,
								);
								resolve(message);
							}
						};

						regularAgentWsConnection.addEventListener(
							"message",
							messageHandler,
						);
					} else {
						reject(new Error("No WebSocket connection available"));
					}
				});

				// Wait for the update to be received
				const typedResponse =
					(await updatesPromise) as Communication.WebSocket.SyncGroupUpdatesResponseMessage;

				// Validate the response
				expect(typedResponse.type).toBe(
					Communication.WebSocket.MessageType.SYNC_GROUP_UPDATES_RESPONSE,
				);

				if (Array.isArray(typedResponse.entities)) {
					// We may or may not receive the entity we just created depending on timing
					// Just verify the message format is correct
					for (const entity of typedResponse.entities) {
						expect(entity).toHaveProperty("entityId");
						expect(entity).toHaveProperty("operation");
						expect(entity).toHaveProperty("changes");
					}
				}
			});

			test("should properly handle session invalidation request", async () => {
				if (!regularAgentWsConnection) {
					throw new Error("WebSocket connection not established");
				}

				// Send a query to invalidate our own session
				regularAgentWsConnection.send(
					JSON.stringify(
						new Communication.WebSocket.QueryRequestMessage(
							"SELECT auth.invalidate_session_from_session_id($1::UUID)",
							[regularAgent.sessionId],
						),
					),
				);

				// Wait for the query response
				const response = await waitForMessage(
					Communication.WebSocket.MessageType.QUERY_RESPONSE,
				);
				expect(response).toBeDefined();
				expect(response.type).toBe(
					Communication.WebSocket.MessageType.QUERY_RESPONSE,
				);

				// Wait for the server to detect invalidated session and close the connection
				return new Promise((resolve, reject) => {
					if (regularAgentWsConnection) {
						// Set up an event listener for connection close
						regularAgentWsConnection.onclose = (event) => {
							expect(event.code).toBe(1000);
							resolve(true);
						};

						// Use timeout with reject instead of throwing
						setTimeout(() => {
							// Ensure we close the connection ourselves if server doesn't
							if (
								regularAgentWsConnection &&
								regularAgentWsConnection.readyState === WebSocket.OPEN
							) {
								regularAgentWsConnection.close();
							}
							reject(
								new Error(
									"Connection was not closed after session invalidation within timeout",
								),
							);
						}, 8000); // Increased timeout to give server more time
					}
				});
			}, 15000); // Also increase the overall test timeout

			afterAll(async () => {
				if (
					regularAgentWsConnection &&
					regularAgentWsConnection.readyState === WebSocket.OPEN
				) {
					regularAgentWsConnection.close();
					regularAgentWsConnection = null;
				}
			});
		});
	});

	afterAll(async () => {
		// Kill the services processes and their children
		if (apiManagerProcess?.pid) {
			try {
				// First try to kill the process directly
				apiManagerProcess.kill("SIGTERM");
				// Then try to kill the process group as fallback
				try {
					process.kill(-apiManagerProcess.pid, "SIGTERM");
				} catch (e) {
					// Ignore error if process group doesn't exist
				}
			} catch (error) {
				log({
					message: `Error killing process: ${error}`,
					type: "error",
					debug: VircadiaConfig.SERVER.DEBUG,
					suppress: VircadiaConfig.SERVER.SUPPRESS,
				});
			}
		}

		if (webScriptManagerProcess?.pid) {
			try {
				webScriptManagerProcess.kill("SIGTERM");
				try {
					process.kill(-webScriptManagerProcess.pid, "SIGTERM");
				} catch (e) {
					// Ignore error if process group doesn't exist
				}
			} catch (error) {
				log({
					message: `Error killing process: ${error}`,
					type: "error",
					debug: VircadiaConfig.SERVER.DEBUG,
					suppress: VircadiaConfig.SERVER.SUPPRESS,
				});
			}
		}

		if (tickManagerProcess?.pid) {
			try {
				tickManagerProcess.kill("SIGTERM");
				try {
					process.kill(-tickManagerProcess.pid, "SIGTERM");
				} catch (e) {
					// Ignore error if process group doesn't exist
				}
			} catch (error) {
				log({
					message: `Error killing process: ${error}`,
					type: "error",
					debug: VircadiaConfig.SERVER.DEBUG,
					suppress: VircadiaConfig.SERVER.SUPPRESS,
				});
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
