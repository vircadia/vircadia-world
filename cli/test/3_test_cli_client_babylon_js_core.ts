import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { NullEngine, Scene } from "@babylonjs/core";
import { PostgresClient } from "../../sdk/vircadia-world-sdk-ts/module/server/postgres.server.client";
import { VircadiaBabylonCore } from "../../sdk/vircadia-world-sdk-ts/module/client/core/vircadia.babylon.core";
import {
    Communication,
    type Entity,
} from "../../sdk/vircadia-world-sdk-ts/schema/schema.general";
import {
    cleanupTestAccounts,
    cleanupTestAssets,
    cleanupTestEntities,
    cleanupTestScripts,
    DB_TEST_PREFIX,
    TEST_SYNC_GROUP,
    initTestAccounts,
    type TestAccount,
    SYSTEM_AUTH_PROVIDER_NAME,
    ANON_AUTH_PROVIDER_NAME,
} from "./helper/helpers";
import { VircadiaConfig_CLI } from "../../sdk/vircadia-world-sdk-ts/config/vircadia.cli.config";
import { VircadiaConfig_SERVER } from "../../sdk/vircadia-world-sdk-ts/config/vircadia.server.config";
import { log } from "../../sdk/vircadia-world-sdk-ts/module/general/log";
import type postgres from "postgres";

// Add these variables to hold test accounts
let adminAgent: TestAccount;
let regularAgent: TestAccount;
let anonAgent: TestAccount;

let superUserSql: postgres.Sql;
const testEntityIds: string[] = [];

describe("Babylon.js Client Core Integration", () => {
    beforeAll(async () => {
        // Get database super user client
        log({
            message: "Getting super user client...",
            type: "debug",
            suppress: VircadiaConfig_SERVER.VRCA_SERVER_SUPPRESS,
            debug: VircadiaConfig_SERVER.VRCA_SERVER_DEBUG,
        });

        superUserSql = await PostgresClient.getInstance({
            debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
            suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
        }).getSuperClient({
            postgres: {
                host: VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_HOST,
                port: VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_PORT,
                database: VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_DATABASE,
                username:
                    VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_USERNAME,
                password:
                    VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
            },
        });

        // Initialize test accounts
        log({
            message: "Initializing test accounts...",
            type: "debug",
            suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
            debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
        });

        // Clean up any existing test accounts first
        await cleanupTestAccounts({ superUserSql });

        // Initialize test accounts
        const testAccounts = await initTestAccounts({ superUserSql });
        adminAgent = testAccounts.adminAgent;
        regularAgent = testAccounts.regularAgent;
        anonAgent = testAccounts.anonAgent;

        log({
            message: "All test accounts initialized.",
            type: "debug",
            suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
            debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
        });
    });

    describe("Setup Test Resources", () => {
        test("should create test entities for interaction tests", async () => {
            // Clean up any existing test entities first
            await cleanupTestEntities({ superUserSql });

            // Create a test entity
            await superUserSql.begin(async (tx: postgres.TransactionSql) => {
                const [entity] = await tx<[Entity.I_Entity]>`
                    INSERT INTO entity.entities (
                        general__entity_name,
                        meta__data,
                        group__sync
                    ) VALUES (
                        ${`${DB_TEST_PREFIX}Test Babylon Entity`},
                        ${tx.json({
                            test_script: {
                                state: "initialized",
                                config: { enabled: true },
                            },
                            position: {
                                x: 0,
                                y: 1,
                                z: 0,
                            },
                            rotation: {
                                x: 0,
                                y: 0,
                                z: 0,
                                w: 1,
                            },
                        })},
                        ${TEST_SYNC_GROUP}
                    ) RETURNING *
                `;

                testEntityIds.push(entity.general__entity_id);

                log({
                    message: `Created test entity with ID: ${entity.general__entity_id}`,
                    type: "debug",
                    suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                });
            });

            expect(testEntityIds.length).toBeGreaterThan(0);
        });
    });

    describe("Core functionality", () => {
        test("should initialize VircadiaBabylonCore and connect to server", async () => {
            // Create a NullEngine and Scene for testing
            const engine = new NullEngine();
            const scene = new Scene(engine);

            // Initialize VircadiaBabylonCore with admin token
            const core = new VircadiaBabylonCore({
                serverUrl: `ws://${VircadiaConfig_CLI.VRCA_CLI_SERVICE_WORLD_API_MANAGER_HOST}:${VircadiaConfig_CLI.VRCA_CLI_SERVICE_WORLD_API_MANAGER_PORT}${Communication.WS_UPGRADE_PATH}`,
                authToken: adminAgent.token,
                authProvider: SYSTEM_AUTH_PROVIDER_NAME,
                engine: engine,
                scene: scene,
                debug: true,
            });

            await core.initialize();

            log({
                message: "Connection status:",
                type: "debug",
                suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                data: {
                    isConnecting: core.getConnection().isConnecting(),
                    isClientConnected: core.getConnection().isClientConnected(),
                    isReconnecting: core.getConnection().isReconnecting(),
                },
            });

            // Verify connection was established
            expect(core.getConnection().isClientConnected()).toBe(true);

            // Verify scene was set up correctly
            expect(core.getEntityManager().getScene()).toBeDefined();

            // Clean up
            core.dispose();
        });

        test("should execute database queries through the connection", async () => {
            const engine = new NullEngine();
            const core = new VircadiaBabylonCore({
                serverUrl: `ws://${VircadiaConfig_CLI.VRCA_CLI_SERVICE_WORLD_API_MANAGER_HOST}:${VircadiaConfig_CLI.VRCA_CLI_SERVICE_WORLD_API_MANAGER_PORT}${Communication.WS_UPGRADE_PATH}`,
                authToken: adminAgent.token,
                authProvider: SYSTEM_AUTH_PROVIDER_NAME,
                engine: engine,
                debug: true,
            });

            await core.initialize();

            expect(core.getConnection().isConnecting()).toBe(false);
            expect(core.getConnection().isClientConnected()).toBe(true);

            // Test querying the database through the connection
            const queryResponse = await core
                .getConnection()
                .sendQueryAsync<Entity.I_Entity[]>(
                    "SELECT * FROM entity.entities",
                );

            expect(queryResponse.result).toBeDefined();
            expect(queryResponse.errorMessage).toBeNull();
            expect(queryResponse.result.length).toBeGreaterThan(0);
            // Clean up
            core.dispose();
        });
    });

    // Example of using the admin account in tests:
    describe("Core functionality with various account types", () => {
        test("should initialize VircadiaBabylonCore with admin account", async () => {
            // Create a NullEngine and Scene for testing
            const engine = new NullEngine();
            const scene = new Scene(engine);

            // Initialize VircadiaBabylonCore with admin token
            const core = new VircadiaBabylonCore({
                serverUrl: `ws://${VircadiaConfig_CLI.VRCA_CLI_SERVICE_WORLD_API_MANAGER_HOST}:${VircadiaConfig_CLI.VRCA_CLI_SERVICE_WORLD_API_MANAGER_PORT}${Communication.WS_UPGRADE_PATH}`,
                authToken: adminAgent.token,
                authProvider: SYSTEM_AUTH_PROVIDER_NAME,
                engine: engine,
                scene: scene,
                debug: true,
            });

            await core.initialize();

            // Verify connection was established
            expect(core.getConnection().isClientConnected()).toBe(true);

            // Clean up
            core.dispose();
        });

        test("should initialize VircadiaBabylonCore with regular account", async () => {
            const engine = new NullEngine();
            const scene = new Scene(engine);

            const core = new VircadiaBabylonCore({
                serverUrl: `ws://${VircadiaConfig_CLI.VRCA_CLI_SERVICE_WORLD_API_MANAGER_HOST}:${VircadiaConfig_CLI.VRCA_CLI_SERVICE_WORLD_API_MANAGER_PORT}${Communication.WS_UPGRADE_PATH}`,
                authToken: regularAgent.token,
                authProvider: "system",
                engine: engine,
                scene: scene,
                debug: true,
            });

            await core.initialize();

            expect(core.getConnection().isClientConnected()).toBe(true);

            core.dispose();
        });

        test("should initialize VircadiaBabylonCore with anonymous account", async () => {
            const engine = new NullEngine();
            const scene = new Scene(engine);

            const core = new VircadiaBabylonCore({
                serverUrl: `ws://${VircadiaConfig_CLI.VRCA_CLI_SERVICE_WORLD_API_MANAGER_HOST}:${VircadiaConfig_CLI.VRCA_CLI_SERVICE_WORLD_API_MANAGER_PORT}${Communication.WS_UPGRADE_PATH}`,
                authToken: anonAgent.token,
                authProvider: ANON_AUTH_PROVIDER_NAME,
                engine: engine,
                scene: scene,
                debug: true,
            });

            await core.initialize();

            expect(core.getConnection().isClientConnected()).toBe(true);

            core.dispose();
        });
    });

    /*
    describe("Entity interaction", () => {
        test("should be able to create and update entities", async () => {
            // Create a NullEngine and Scene for testing
            const engine = new NullEngine();
            const scene = new Scene(engine);

            // Initialize VircadiaBabylonCore
            const core = new VircadiaBabylonCore({
                serverUrl: `ws://${VircadiaConfig_CLI.VRCA_CLI_SERVICE_WORLD_API_MANAGER_HOST}:${VircadiaConfig_CLI.VRCA_CLI_SERVICE_WORLD_API_MANAGER_PORT}${Communication.WS_UPGRADE_PATH}`,
                authToken: systemTestAccount.sessionId,
                authProvider: "system",
                engine: engine,
                scene: scene,
                debug: true,
            });

            await core.initialize();

            // Create a new entity through the client
            const newEntityData = {
                general__entity_name: "Client Created Entity",
                meta__data: {
                    test_property: "test_value",
                    counter: 0,
                },
                group__sync: TEST_SYNC_GROUP,
                position__x: 10,
                position__y: 5,
                position__z: 10,
            };

            const createdEntity = await core.createEntity(newEntityData);
            expect(createdEntity).toBeDefined();
            expect(createdEntity.general__entity_name).toBe(
                "Client Created Entity",
            );

            // Verify the entity exists and has the correct properties
            const entityFromCore = core.getEntity(
                createdEntity.general__entity_id,
            );
            expect(entityFromCore).toBeDefined();
            expect(entityFromCore?.general__entity_name).toBe(
                "Client Created Entity",
            );
            expect(entityFromCore?.position__x).toBe(10);

            // Update the entity
            const updateResult = await core.updateEntity({
                general__entity_id: createdEntity.general__entity_id,
                general__entity_name: "Updated Entity Name",
                meta__data: {
                    test_property: "updated_value",
                    counter: 1,
                },
            });

            expect(updateResult).toBeTruthy();

            // Verify the update was applied
            const updatedEntity = core.getEntity(
                createdEntity.general__entity_id,
            );
            expect(updatedEntity?.general__entity_name).toBe(
                "Updated Entity Name",
            );
            expect(updatedEntity?.meta__data.test_property).toBe(
                "updated_value",
            );
            expect(updatedEntity?.meta__data.counter).toBe(1);

            // Clean up
            await core.deleteEntity(createdEntity.general__entity_id);
            core.dispose();
        });

        test("should receive entity updates from the server", async () => {
            // Create a NullEngine and Scene for testing
            const engine = new NullEngine();
            const scene = new Scene(engine);

            // Initialize VircadiaBabylonCore
            const core = new VircadiaBabylonCore({
                serverUrl: `ws://${VircadiaConfig_CLI.VRCA_CLI_SERVICE_WORLD_API_MANAGER_HOST}:${VircadiaConfig_CLI.VRCA_CLI_SERVICE_WORLD_API_MANAGER_PORT}${Communication.WS_UPGRADE_PATH}`,
                authToken: systemTestAccount.sessionId,
                authProvider: "system",
                engine: engine,
                scene: scene,
                debug: true,
            });

            await core.initialize();

            // Save the current position of our test entity
            const entityBefore = core.getEntity(testEntityIds[0]);
            expect(entityBefore).toBeDefined();

            // Update the entity directly in the database
            await superUserSql.begin(async (tx: postgres.TransactionSql) => {
                await tx`
                    UPDATE entity.entities
                    SET 
                        position__x = ${20},
                        position__y = ${30},
                        position__z = ${40},
                        meta__data = ${tx.json({
                            test_script: {
                                state: "updated",
                                lastUpdate: new Date().toISOString(),
                                config: { enabled: true },
                            },
                        })}
                    WHERE general__entity_id = ${testEntityIds[0]}
                `;
            });

            // Wait for a tick to process the update
            await Bun.sleep(500);

            // Verify the client received the update
            const entityAfter = core.getEntity(testEntityIds[0]);
            expect(entityAfter).toBeDefined();
            expect(entityAfter?.position__x).toBe(20);
            expect(entityAfter?.position__y).toBe(30);
            expect(entityAfter?.position__z).toBe(40);
            expect(entityAfter?.meta__data.test_script.state).toBe("updated");

            // Clean up
            core.dispose();
        });
    });
    */

    // Additional test scenarios could include:
    // - Testing script execution
    // - Asset loading
    // - Entity manipulation
    // - Error handling

    afterAll(async () => {
        // Clean up test data
        log({
            message: "Cleaning up test data...",
            type: "debug",
            suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
            debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
        });

        await cleanupTestEntities({ superUserSql });
        await cleanupTestScripts({ superUserSql });
        await cleanupTestAssets({ superUserSql });
        await cleanupTestAccounts({ superUserSql });

        // Disconnect from database
        await PostgresClient.getInstance({
            debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
            suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
        }).disconnect();

        log({
            message: "Cleanup complete.",
            type: "debug",
            suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
            debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
        });
    });
});
