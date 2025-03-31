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

    describe("System Script Tests", () => {
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
                        ${tx.array(["entity_model.ts"])},
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
                engine: engine,
                scene: scene,
                debug: true,
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

        // Add more specific system script tests here as they're created
        // Each system script should have its own dedicated test that verifies its specific functionality
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
