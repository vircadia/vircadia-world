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

        // Cleanup
        await cleanupTestEntities({ superUserSql });
        await cleanupTestScripts({ superUserSql });
        await cleanupTestAssets({ superUserSql });
        await cleanupTestAccounts({ superUserSql });

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

                scene: scene,
                debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
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
            const scene = new Scene(engine);
            const core = new VircadiaBabylonCore({
                serverUrl: `ws://${VircadiaConfig_CLI.VRCA_CLI_SERVICE_WORLD_API_MANAGER_HOST}:${VircadiaConfig_CLI.VRCA_CLI_SERVICE_WORLD_API_MANAGER_PORT}${Communication.WS_UPGRADE_PATH}`,
                authToken: adminAgent.token,
                authProvider: SYSTEM_AUTH_PROVIDER_NAME,
                scene: scene,
                debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
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

                scene: scene,
                debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
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

                scene: scene,
                debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
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

                scene: scene,
                debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
            });

            await core.initialize();

            expect(core.getConnectionManager().isClientConnected()).toBe(true);

            core.dispose();
        });
    });

    describe("AssetManager Tests", () => {
        test("should load and manage assets", async () => {
            // Create a test asset in the database
            const assetName = `${DB_TEST_PREFIX}test_asset.gltf`;

            await superUserSql.begin(async (tx) => {
                const [asset] = await tx<[Entity.Asset.I_Asset]>`
                    INSERT INTO entity.entity_assets (
                        general__asset_file_name,
                        asset__data,
                        group__sync
                    ) VALUES (
                        ${assetName},
                        ${Buffer.from(
                            JSON.stringify({
                                test_data: "Sample asset data for testing",
                                format: "gltf",
                            }),
                        ).toString("base64")},
                        ${TEST_SYNC_GROUP}
                    ) RETURNING *
                `;
            });

            // Initialize VircadiaBabylonCore
            const engine = new NullEngine();
            const scene = new Scene(engine);
            const core = new VircadiaBabylonCore({
                serverUrl: `ws://${VircadiaConfig_CLI.VRCA_CLI_SERVICE_WORLD_API_MANAGER_HOST}:${VircadiaConfig_CLI.VRCA_CLI_SERVICE_WORLD_API_MANAGER_PORT}${Communication.WS_UPGRADE_PATH}`,
                authToken: adminAgent.token,
                authProvider: SYSTEM_AUTH_PROVIDER_NAME,
                scene: scene,
                debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
            });

            await core.initialize();

            // Test asset loading
            const asset = await core.getAssetManager().loadAsset(assetName);
            expect(asset).toBeDefined();
            expect(asset.general__asset_file_name).toBe(assetName);

            // Test asset retrieval from cache
            const cachedAsset = core.getAssetManager().getAsset(assetName);
            expect(cachedAsset).toBeDefined();
            expect(cachedAsset?.general__asset_file_name).toBe(assetName);

            // Test asset update notifications
            let notificationReceived = false;
            core.getAssetManager().addAssetUpdateListener((updatedAsset) => {
                notificationReceived = true;
                expect(updatedAsset.general__asset_file_name).toBe(assetName);
            });

            await core.getAssetManager().reloadAsset(assetName);
            expect(notificationReceived).toBe(true);

            // Clean up
            core.dispose();
        });
    });

    describe("EntityManager Tests", () => {
        test("should update entities and notify scripts", async () => {
            // Create a test entity with a script
            const entityName = `${DB_TEST_PREFIX}Entity Update Test`;
            let entityId: string;

            // First create a system script for testing entity updates if it doesn't exist
            const scriptName = `${DB_TEST_PREFIX}bun_entity_update_test.ts`;
            let scriptExists = false;

            const scriptCheckResult = await superUserSql<[{ count: number }]>`
                SELECT COUNT(*) as count FROM entity.entity_scripts 
                WHERE general__script_file_name = ${scriptName}
            `;

            scriptExists = scriptCheckResult[0].count > 0;

            if (!scriptExists) {
                await superUserSql.begin(async (tx) => {
                    const [script] = await tx<[Entity.Script.I_Script]>`
                        INSERT INTO entity.entity_scripts (
                            general__script_file_name,
                            script__source__data,
                            script__platform,
                            group__sync
                        ) VALUES (
                            ${scriptName},
                            ${"function vircadiaScriptMain(context) { return { hooks: { onEntityUpdate: (entity) => { console.log('Entity updated:', entity.general__entity_id); } } }; }"},
                            ${Entity.Script.E_ScriptType.BABYLON_BUN},
                            ${TEST_SYNC_GROUP}
                        ) RETURNING *
                    `;
                });
            }

            // Create the test entity
            await superUserSql.begin(async (tx) => {
                const [entity] = await tx<[Entity.I_Entity]>`
                    INSERT INTO entity.entities (
                        general__entity_name,
                        script__names,
                        meta__data,
                        group__sync
                    ) VALUES (
                        ${entityName},
                        ${tx.array([scriptName])},
                        ${tx.json({
                            transform__position: { x: 0, y: 1, z: 0 },
                            test_property: "initial value",
                        })},
                        ${TEST_SYNC_GROUP}
                    ) RETURNING *
                `;
                entityId = entity.general__entity_id;
                testEntityIds.push(entityId);
            });

            // Initialize VircadiaBabylonCore
            const engine = new NullEngine();
            const scene = new Scene(engine);
            const core = new VircadiaBabylonCore({
                serverUrl: `ws://${VircadiaConfig_CLI.VRCA_CLI_SERVICE_WORLD_API_MANAGER_HOST}:${VircadiaConfig_CLI.VRCA_CLI_SERVICE_WORLD_API_MANAGER_PORT}${Communication.WS_UPGRADE_PATH}`,
                authToken: adminAgent.token,
                authProvider: SYSTEM_AUTH_PROVIDER_NAME,

                scene: scene,
                debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
            });

            await core.initialize();

            // Get the entity from the manager
            const entity = core.getEntityManager().getEntity(entityId);
            expect(entity).toBeDefined();
            expect(entity?.general__entity_name).toBe(entityName);

            // Update the entity
            if (entity) {
                const updatedEntity: Entity.I_Entity = {
                    ...entity,
                    meta__data: {
                        ...entity.meta__data,
                        test_property: { value: "updated value" },
                        transform__position: { x: 5, y: 5, z: 5 },
                    },
                };

                // Update entity and notify scripts
                core.getEntityManager().updateEntityAndNotifyScripts(
                    updatedEntity,
                );

                // Verify the entity was updated in the manager
                const retrievedEntity = core
                    .getEntityManager()
                    .getEntity(entityId);
                expect(retrievedEntity?.meta__data.test_property.value).toBe(
                    "updated value",
                );
                expect(retrievedEntity?.meta__data.transform__position.x).toBe(
                    5,
                );
            }

            // Clean up
            core.dispose();
        });

        test("should load entities with priority ordering", async () => {
            // Create test entities with different priorities
            const highPriorityName = `${DB_TEST_PREFIX}High Priority Entity`;
            const mediumPriorityName = `${DB_TEST_PREFIX}Medium Priority Entity`;
            const lowPriorityName = `${DB_TEST_PREFIX}Low Priority Entity`;

            await superUserSql.begin(async (tx) => {
                // High priority entity (lower number = higher priority)
                const [highPriority] = await tx<[Entity.I_Entity]>`
                    INSERT INTO entity.entities (
                        general__entity_name,
                        group__load_priority,
                        meta__data,
                        group__sync
                    ) VALUES (
                        ${highPriorityName},
                        ${10},
                        ${tx.json({
                            test_property: "high priority",
                        })},
                        ${TEST_SYNC_GROUP}
                    ) RETURNING *
                `;
                testEntityIds.push(highPriority.general__entity_id);

                // Medium priority entity
                const [mediumPriority] = await tx<[Entity.I_Entity]>`
                    INSERT INTO entity.entities (
                        general__entity_name,
                        group__load_priority,
                        meta__data,
                        group__sync
                    ) VALUES (
                        ${mediumPriorityName},
                        ${50},
                        ${tx.json({
                            test_property: "medium priority",
                        })},
                        ${TEST_SYNC_GROUP}
                    ) RETURNING *
                `;
                testEntityIds.push(mediumPriority.general__entity_id);

                // Low priority entity
                const [lowPriority] = await tx<[Entity.I_Entity]>`
                    INSERT INTO entity.entities (
                        general__entity_name,
                        group__load_priority,
                        meta__data,
                        group__sync
                    ) VALUES (
                        ${lowPriorityName},
                        ${100},
                        ${tx.json({
                            test_property: "low priority",
                        })},
                        ${TEST_SYNC_GROUP}
                    ) RETURNING *
                `;
                testEntityIds.push(lowPriority.general__entity_id);
            });

            // Initialize VircadiaBabylonCore
            const engine = new NullEngine();
            const scene = new Scene(engine);

            const core = new VircadiaBabylonCore({
                serverUrl: `ws://${VircadiaConfig_CLI.VRCA_CLI_SERVICE_WORLD_API_MANAGER_HOST}:${VircadiaConfig_CLI.VRCA_CLI_SERVICE_WORLD_API_MANAGER_PORT}${Communication.WS_UPGRADE_PATH}`,
                authToken: adminAgent.token,
                authProvider: SYSTEM_AUTH_PROVIDER_NAME,
                scene: scene,
                debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
            });

            await core.initialize();

            // Get all entities
            const entities = core.getEntityManager().getEntities();

            // Find our test entities
            const highPriorityEntity = Array.from(entities.values()).find(
                (e) => e.general__entity_name === highPriorityName,
            );
            const mediumPriorityEntity = Array.from(entities.values()).find(
                (e) => e.general__entity_name === mediumPriorityName,
            );
            const lowPriorityEntity = Array.from(entities.values()).find(
                (e) => e.general__entity_name === lowPriorityName,
            );

            // Verify the entities were loaded
            expect(highPriorityEntity).toBeDefined();
            expect(mediumPriorityEntity).toBeDefined();
            expect(lowPriorityEntity).toBeDefined();

            // Verify their priorities
            expect(highPriorityEntity?.group__load_priority).toBe(10);
            expect(mediumPriorityEntity?.group__load_priority).toBe(50);
            expect(lowPriorityEntity?.group__load_priority).toBe(100);

            // Clean up
            core.dispose();
        });
    });

    describe("ConnectionManager Tests", () => {
        test("should handle connection errors gracefully", async () => {
            // Create a core instance with an invalid server URL
            const engine = new NullEngine();
            const scene = new Scene(engine);

            const core = new VircadiaBabylonCore({
                serverUrl: "ws://invalid-server-url:12345/invalid",
                authToken: adminAgent.token,
                authProvider: SYSTEM_AUTH_PROVIDER_NAME,
                scene: scene,
                debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                // Set a low reconnect delay for faster test execution
                reconnectDelay: 100,
                reconnectAttempts: 2,
            });

            // Initialize should fail but not throw
            try {
                await core.initialize();
                // If we get here, the connection somehow succeeded, which is unexpected
                expect(core.getConnectionManager().isClientConnected()).toBe(
                    false,
                );
            } catch (error) {
                // Expected behavior - initialization fails with connection error
                expect(error instanceof Error).toBe(true);
            }

            // Verify connection state
            expect(core.getConnectionManager().isClientConnected()).toBe(false);

            // Allow some time for reconnection attempts
            await new Promise((resolve) => setTimeout(resolve, 300));

            // Clean up
            core.dispose();
        });

        test("should handle database query errors", async () => {
            // Initialize VircadiaBabylonCore with valid connection
            const engine = new NullEngine();
            const scene = new Scene(engine);

            const core = new VircadiaBabylonCore({
                serverUrl: `ws://${VircadiaConfig_CLI.VRCA_CLI_SERVICE_WORLD_API_MANAGER_HOST}:${VircadiaConfig_CLI.VRCA_CLI_SERVICE_WORLD_API_MANAGER_PORT}${Communication.WS_UPGRADE_PATH}`,
                authToken: adminAgent.token,
                authProvider: SYSTEM_AUTH_PROVIDER_NAME,
                scene: scene,
                debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
            });

            await core.initialize();

            // Execute an invalid query that should return an error
            const queryResponse = await core
                .getConnectionManager()
                .sendQueryAsync<Entity.I_Entity[]>(
                    "SELECT * FROM non_existent_table",
                );

            // Response should contain an error message
            expect(queryResponse.errorMessage).not.toBeNull();

            // Clean up
            core.dispose();
        });
    });

    describe("ScriptManager Tests", () => {
        test("should load and execute entity_model.ts system script", async () => {
            // Create a NullEngine and Scene for testing
            const engine = new NullEngine();
            const scene = new Scene(engine);

            // First create a test entity in the database that has the entity_model script
            await superUserSql.begin(async (tx) => {
                await tx`
                    INSERT INTO entity.entities (
                        general__entity_name,
                        script__names,
                        meta__data,
                        group__sync
                    ) VALUES (
                        ${`${DB_TEST_PREFIX}Entity Model Test Entity`},
                        ${tx.array(["universal_entity_model.ts"])},
                        ${tx.json({
                            transform__position: { x: 0, y: 1, z: 0 },
                            entity_model: {
                                transform__position: { x: 0, y: 1, z: 0 },
                            },
                        })},
                        ${TEST_SYNC_GROUP}
                    )
                `;
            });

            // Initialize VircadiaBabylonCore with admin token
            const core = new VircadiaBabylonCore({
                serverUrl: `ws://${VircadiaConfig_CLI.VRCA_CLI_SERVICE_WORLD_API_MANAGER_HOST}:${VircadiaConfig_CLI.VRCA_CLI_SERVICE_WORLD_API_MANAGER_PORT}${Communication.WS_UPGRADE_PATH}`,
                authToken: adminAgent.token,
                authProvider: SYSTEM_AUTH_PROVIDER_NAME,

                scene: scene,
                debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
            });

            // This will load all entities including our test entity
            await core.initialize();

            // Get the loaded entity from the entity manager
            const entities = core.getEntityManager().getEntities();
            const testEntity = Array.from(entities.values()).find(
                (e) =>
                    e.general__entity_name ===
                    `${DB_TEST_PREFIX}Entity Model Test Entity`,
            );

            expect(testEntity).toBeDefined();

            // Allow time for the script to execute
            await new Promise((resolve) => setTimeout(resolve, 100));

            // Get the Babylon.js mesh that should have been created by the script
            const entityMesh = scene.getMeshByName(
                `entity-${testEntity?.general__entity_id}`,
            );
            expect(entityMesh).toBeDefined();

            // Test specific functionality of the entity_model script
            if (entityMesh) {
                // Test position
                expect(entityMesh.position.y).toBeCloseTo(1);

                // Test that it's a cube (or whatever the script creates)
                expect(entityMesh.getTotalVertices()).toBeGreaterThan(0);
            }

            // Test updating the entity and verifying the script responds
            if (testEntity) {
                const updatedEntity: Entity.I_Entity = {
                    ...testEntity,
                    meta__data: {
                        ...testEntity.meta__data,
                        transform__position: { x: 3, y: 2, z: 1 },
                    },
                };

                await core
                    .getEntityManager()
                    .updateEntityAndNotifyScripts(updatedEntity);

                // Allow time for the update to process
                await new Promise((resolve) => setTimeout(resolve, 100));

                // Verify the mesh was updated
                if (entityMesh) {
                    expect(entityMesh.position.x).toBeCloseTo(3);
                    expect(entityMesh.position.y).toBeCloseTo(2);
                    expect(entityMesh.scaling.x).toBeCloseTo(2);
                }
            }

            // Clean up
            core.dispose();
        });

        test("should detect platform correctly", async () => {
            // Initialize VircadiaBabylonCore
            const engine = new NullEngine();
            const scene = new Scene(engine);
            const core = new VircadiaBabylonCore({
                serverUrl: `ws://${VircadiaConfig_CLI.VRCA_CLI_SERVICE_WORLD_API_MANAGER_HOST}:${VircadiaConfig_CLI.VRCA_CLI_SERVICE_WORLD_API_MANAGER_PORT}${Communication.WS_UPGRADE_PATH}`,
                authToken: adminAgent.token,
                authProvider: SYSTEM_AUTH_PROVIDER_NAME,
                scene: scene,
                debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
            });

            await core.initialize();

            // Check the detected platform type
            const platform = core.getScriptManager().detectPlatform();

            // In the test environment, platform should be BABYLON_BUN
            expect(platform).toBe(Entity.Script.E_ScriptType.BABYLON_BUN);

            // Clean up
            core.dispose();
        });
    });

    describe("Cleanup and Dispose Tests", () => {
        test("should properly dispose resources", async () => {
            // Initialize VircadiaBabylonCore
            const engine = new NullEngine();
            const scene = new Scene(engine);

            const core = new VircadiaBabylonCore({
                serverUrl: `ws://${VircadiaConfig_CLI.VRCA_CLI_SERVICE_WORLD_API_MANAGER_HOST}:${VircadiaConfig_CLI.VRCA_CLI_SERVICE_WORLD_API_MANAGER_PORT}${Communication.WS_UPGRADE_PATH}`,
                authToken: adminAgent.token,
                authProvider: SYSTEM_AUTH_PROVIDER_NAME,
                scene: scene,
                debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
                suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
            });

            await core.initialize();

            // Verify core is initialized
            expect(core.isInitialized()).toBe(true);
            expect(core.getConnectionManager().isClientConnected()).toBe(true);

            // Dispose the core
            core.dispose();

            // Verify disposed state
            expect(core.isInitialized()).toBe(false);
            expect(core.getConnectionManager().isClientConnected()).toBe(false);
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
