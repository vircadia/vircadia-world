import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { NullEngine, Scene } from "@babylonjs/core";
import { PostgresClient } from "../../sdk/vircadia-world-sdk-ts/module/server/postgres.server.client";
import { VircadiaBabylonCore } from "../../sdk/vircadia-world-sdk-ts/module/client/core/vircadia.babylon.core";
import {
    Communication,
    Entity,
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
const testScriptIds: string[] = [];

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

        test("should create test scripts for script tests", async () => {
            // Clean up any existing test scripts first
            await cleanupTestScripts({ superUserSql });

            // Create a test script
            await superUserSql.begin(async (tx: postgres.TransactionSql) => {
                const [script] = await tx<[Entity.Script.I_Script]>`
                    INSERT INTO entity.entity_scripts (
                        general__script_file_name,
                        script__type,
                        script__source__data,
                        script__compiled__data,
                        script__compiled__status,
                        group__sync
                    ) VALUES (
                        ${`${DB_TEST_PREFIX}TestScript`},
                        ${Entity.Script.E_ScriptType.BABYLON_BROWSER},
                        ${`
                        function main(context) {
                            // Store received events for testing
                            const receivedEvents = {
                                onScriptInitialize: false,
                                onEntityUpdate: false,
                                onAssetUpdate: false,
                                onScriptUpdate: false,
                                initializeData: null,
                                updateData: null
                            };
                            
                            // Define hooks
                            context.Vircadia.v1.Hook.onScriptInitialize = function(entityData, entityAssets) {
                                receivedEvents.onScriptInitialize = true;
                                receivedEvents.initializeData = { entityData, entityAssets };
                            };
                            
                            context.Vircadia.v1.Hook.onEntityUpdate = function(entityData) {
                                receivedEvents.onEntityUpdate = true;
                                receivedEvents.updateData = entityData;
                            };
                            
                            context.Vircadia.v1.Hook.onAssetUpdate = function(assetData) {
                                receivedEvents.onAssetUpdate = true;
                            };
                            
                            context.Vircadia.v1.Hook.onScriptUpdate = function(scriptData) {
                                receivedEvents.onScriptUpdate = true;
                            };
                            
                            return {
                                getReceivedEvents: function() {
                                    return receivedEvents;
                                }
                            };
                        }
                        `},
                        ${`
                        function main(context) {
                            // Store received events for testing
                            const receivedEvents = {
                                onScriptInitialize: false,
                                onEntityUpdate: false,
                                onAssetUpdate: false,
                                onScriptUpdate: false,
                                initializeData: null,
                                updateData: null
                            };
                            
                            // Define hooks
                            context.Vircadia.v1.Hook.onScriptInitialize = function(entityData, entityAssets) {
                                receivedEvents.onScriptInitialize = true;
                                receivedEvents.initializeData = { entityData, entityAssets };
                            };
                            
                            context.Vircadia.v1.Hook.onEntityUpdate = function(entityData) {
                                receivedEvents.onEntityUpdate = true;
                                receivedEvents.updateData = entityData;
                            };
                            
                            context.Vircadia.v1.Hook.onAssetUpdate = function(assetData) {
                                receivedEvents.onAssetUpdate = true;
                            };
                            
                            context.Vircadia.v1.Hook.onScriptUpdate = function(scriptData) {
                                receivedEvents.onScriptUpdate = true;
                            };
                            
                            return {
                                getReceivedEvents: function() {
                                    return receivedEvents;
                                }
                            };
                        }
                        `},
                        ${Entity.Script.E_CompilationStatus.COMPILED},
                        ${TEST_SYNC_GROUP}
                    ) RETURNING *
                `;

                testScriptIds.push(script.general__script_file_name);

                log({
                    message: `Created test script with name: ${script.general__script_file_name}`,
                    type: "debug",
                    suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
                    debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                });
            });

            // Create another script with the asset update hook
            await superUserSql.begin(async (tx: postgres.TransactionSql) => {
                const [script] = await tx<[Entity.Script.I_Script]>`
                    INSERT INTO entity.entity_scripts (
                        general__script_file_name,
                        script__type,
                        script__source__data,
                        script__compiled__data,
                        script__compiled__status,
                        group__sync
                    ) VALUES (
                        ${`${DB_TEST_PREFIX}AssetTestScript`},
                        ${Entity.Script.E_ScriptType.BABYLON_BROWSER},
                        ${`
                        function main(context) {
                            // Track asset updates
                            const assetUpdates = [];
                            
                            context.Vircadia.v1.Hook.onAssetUpdate = function(assetData) {
                                assetUpdates.push(assetData);
                            };
                            
                            return {
                                getAssetUpdates: function() {
                                    return assetUpdates;
                                }
                            };
                        }
                        `},
                        ${`
                        function main(context) {
                            // Track asset updates
                            const assetUpdates = [];
                            
                            context.Vircadia.v1.Hook.onAssetUpdate = function(assetData) {
                                assetUpdates.push(assetData);
                            };
                            
                            return {
                                getAssetUpdates: function() {
                                    return assetUpdates;
                                }
                            };
                        }
                        `},
                        ${Entity.Script.E_CompilationStatus.COMPILED},
                        ${TEST_SYNC_GROUP}
                    ) RETURNING *
                `;

                testScriptIds.push(script.general__script_file_name);
            });

            expect(testScriptIds.length).toBeGreaterThan(0);
        });

        test("should associate scripts with test entities", async () => {
            // Update our test entity to include the script reference
            await superUserSql.begin(async (tx: postgres.TransactionSql) => {
                await tx`
                    UPDATE entity.entities
                    SET 
                        script__names = ${tx.array([testScriptIds[0]])},
                        meta__data = jsonb_set(meta__data, '{test_script}', '{"state": "initialized", "config": {"enabled": true}}')
                    WHERE general__entity_id = ${testEntityIds[0]}
                `;
            });

            // Verify the update
            const [entity] = await superUserSql<[Entity.I_Entity]>`
                SELECT * FROM entity.entities WHERE general__entity_id = ${testEntityIds[0]}
            `;

            expect(entity.script__names).toContain(testScriptIds[0]);
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
                    isConnecting: core.getConnectionManager().isConnecting(),
                    isClientConnected: core
                        .getConnectionManager()
                        .isClientConnected(),
                    isReconnecting: core
                        .getConnectionManager()
                        .isReconnecting(),
                },
            });

            // Verify connection was established
            expect(core.getConnectionManager().isClientConnected()).toBe(true);

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

            expect(core.getConnectionManager().isConnecting()).toBe(false);
            expect(core.getConnectionManager().isClientConnected()).toBe(true);

            // Test querying the database through the connection
            const queryResponse = await core
                .getConnectionManager()
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
            expect(core.getConnectionManager().isClientConnected()).toBe(true);

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

            expect(core.getConnectionManager().isClientConnected()).toBe(true);

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

            expect(core.getConnectionManager().isClientConnected()).toBe(true);

            core.dispose();
        });
    });

    describe("Script functionality", () => {
        test("should load and execute scripts", async () => {
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
            expect(core.getConnectionManager().isClientConnected()).toBe(true);

            // Load the test script directly
            const scriptManager = core.getScriptManager();
            const script = await scriptManager.loadScript(testScriptIds[0]);

            // Verify the script was loaded
            expect(script).toBeDefined();
            expect(script.general__script_file_name).toBe(testScriptIds[0]);
            expect(script.script__type).toBe(
                Entity.Script.E_ScriptType.BABYLON_BROWSER,
            );

            // Get the test entity to use with the script
            const entity = core.getEntityManager().getEntity(testEntityIds[0]);
            expect(entity).toBeDefined();

            // Execute the script with the entity
            if (entity) {
                await scriptManager.executeScript(script, entity, []);
            }

            // Verify the script instance exists
            const scriptInstance = scriptManager
                .getScriptInstances()
                .get(testScriptIds[0]);
            expect(scriptInstance).toBeDefined();

            // Verify hooks were registered
            if (scriptInstance) {
                expect(typeof scriptInstance.hooks.onScriptInitialize).toBe(
                    "function",
                );
                expect(typeof scriptInstance.hooks.onEntityUpdate).toBe(
                    "function",
                );
                expect(typeof scriptInstance.hooks.onAssetUpdate).toBe(
                    "function",
                );
                expect(typeof scriptInstance.hooks.onScriptUpdate).toBe(
                    "function",
                );
            }

            // Clean up
            core.dispose();
        });

        test("should trigger script hooks on entity updates", async () => {
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

            // Get the test entity
            const entity = core.getEntityManager().getEntity(testEntityIds[0]);
            expect(entity).toBeDefined();

            // Get the script instance
            const scriptManager = core.getScriptManager();
            const scriptInstance = scriptManager
                .getScriptInstances()
                .get(testScriptIds[0]);
            expect(scriptInstance).toBeDefined();

            // Set up a spy on the onEntityUpdate hook
            let hookCalled = false;
            let updateData: Entity.I_Entity | null = null;

            if (scriptInstance) {
                const originalHook = scriptInstance.hooks.onEntityUpdate;
                scriptInstance.hooks.onEntityUpdate = (
                    entityData: Entity.I_Entity,
                ) => {
                    hookCalled = true;
                    updateData = entityData;
                    if (originalHook) originalHook(entityData);
                };
            }

            // Update the entity
            if (entity) {
                const updatedEntity = {
                    ...entity,
                    general__entity_name: "Updated for script test",
                    meta__data: {
                        ...entity.meta__data,
                        scriptTest: { value: "test_value" },
                    },
                };

                // Simulate an entity update event
                core.getEntityManager().updateEntityAndNotifyScripts(
                    updatedEntity,
                );
            }

            // Verify the hook was called with the right data
            expect(hookCalled).toBe(true);
            expect(updateData).toBeDefined();
            if (entity && updateData) {
                const typedUpdateData = updateData as Entity.I_Entity;
                expect(typedUpdateData.general__entity_id).toBe(
                    entity.general__entity_id,
                );
                expect(typedUpdateData.general__entity_name).toBe(
                    "Updated for script test",
                );
                expect(
                    (typedUpdateData.meta__data.scriptTest as { value: string })
                        .value,
                ).toBe("test_value");
            }

            // Clean up
            core.dispose();
        });

        test("should support script reloading", async () => {
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

            // Get script manager
            const scriptManager = core.getScriptManager();

            // Get the first script instance
            const initialScriptInstance = scriptManager
                .getScriptInstances()
                .get(testScriptIds[0]);
            expect(initialScriptInstance).toBeDefined();

            // Set a flag to check teardown gets called
            let teardownCalled = false;
            if (initialScriptInstance) {
                initialScriptInstance.hooks.onScriptTeardown = () => {
                    teardownCalled = true;
                };
            }

            // Reload the script
            await scriptManager.reloadScript(testScriptIds[0]);

            // Verify teardown was called
            expect(teardownCalled).toBe(true);

            // Get the new instance and verify it's different
            const newScriptInstance = scriptManager
                .getScriptInstances()
                .get(testScriptIds[0]);
            expect(newScriptInstance).toBeDefined();
            expect(newScriptInstance).not.toBe(initialScriptInstance);

            // Clean up
            core.dispose();
        });
    });

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
