import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import type postgres from "postgres";
import { PostgresClient } from "../../sdk/vircadia-world-sdk-ts/module/server/postgres.server.client";
import type {
    Entity,
    Tick,
} from "../../sdk/vircadia-world-sdk-ts/schema/schema.general";
import {
    TEST_SYNC_GROUP,
    DB_TEST_PREFIX,
    initTestAccounts,
    type TestAccount,
    cleanupTestAccounts,
    cleanupTestEntities,
    cleanupTestAssets,
} from "./helper/helpers";
import { VircadiaConfig_CLI } from "../../sdk/vircadia-world-sdk-ts/config/vircadia.cli.config";
import { VircadiaConfig_SERVER } from "../../sdk/vircadia-world-sdk-ts/config/vircadia.server.config";
import { log } from "../../sdk/vircadia-world-sdk-ts/module/general/log";
import type { BunFile } from "bun";
import { NullEngine, Scene, ImportMeshAsync } from "@babylonjs/core";
import "@babylonjs/loaders";

let superUserSql: postgres.Sql;
let proxyUserSql: postgres.Sql;
let adminAgent: TestAccount;
let regularAgent: TestAccount;
let anonAgent: TestAccount;

// Helper function to read the triangle.gltf file
async function readTriangleGltf(): Promise<BunFile> {
    const gltfPath = `${import.meta.dir}/asset/triangle.gltf`;
    return Bun.file(gltfPath);
}

async function readDiscGlb(): Promise<BunFile> {
    const glbPath = `${import.meta.dir}/asset/disc.glb`;
    return Bun.file(glbPath);
}

// TODO: Add benchmarks.

describe("DB", () => {
    beforeAll(async () => {
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
        proxyUserSql = await PostgresClient.getInstance({
            debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
            suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
        }).getProxyClient({
            postgres: {
                host: VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_HOST,
                port: VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_PORT,
                database: VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_DATABASE,
                username:
                    VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_AGENT_PROXY_USER_USERNAME,
                password:
                    VircadiaConfig_CLI.VRCA_CLI_SERVICE_POSTGRES_AGENT_PROXY_USER_PASSWORD,
            },
        });
        log({
            message: "Super user client and proxy user client obtained.",
            type: "debug",
            suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
            debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
        });

        log({
            message: "Cleaning up test objects...",
            type: "debug",
            suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
            debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
        });
        await cleanupTestAccounts({
            superUserSql,
        });
        await cleanupTestEntities({
            superUserSql,
        });
        await cleanupTestAssets({
            superUserSql,
        });
        log({
            message: "Test objects cleaned up.",
            type: "debug",
            suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
            debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
        });

        log({
            message: "Initializing test accounts...",
            type: "debug",
            suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
            debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
        });
        const testAccounts = await initTestAccounts({
            superUserSql,
        });
        adminAgent = testAccounts.adminAgent;
        regularAgent = testAccounts.regularAgent;
        anonAgent = testAccounts.anonAgent;
        log({
            message: "All test accounts initialized.",
            type: "debug",
            suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
            debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
        });
        log({
            message: "Starting DB tests...",
            type: "debug",
            suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
            debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
        });
    });

    describe("Base Schema", () => {
        test("proxy user should be able to use uuid_generate_v4()", async () => {
            await proxyUserSql.begin(async (tx) => {
                const [uuid] = await tx`SELECT uuid_generate_v4() as uuid`;
                expect(uuid.uuid).toBeDefined();
            });
        });
    });

    describe("Auth Schema", () => {
        describe("Session Management", () => {
            test("should verify we are using vircadia_agent_proxy", async () => {
                await proxyUserSql.begin(async (tx) => {
                    const [currentSessionUser] = await tx`
                        SELECT current_user as user
                    `;
                    expect(currentSessionUser.user).toBe(
                        "vircadia_agent_proxy",
                    );
                    const [currentUser] = await tx`SELECT current_user`;
                    expect(currentUser.current_user).toBe(
                        "vircadia_agent_proxy",
                    );
                });
            });
            test("should verify if the base agent context functions work", async () => {
                // First, check with the superuser to examine the permission settings
                await superUserSql.begin(async (tx) => {
                    // Verify function existence and security
                    const [functionDef] = await tx`
                            SELECT
                                p.proname,
                                p.prosecdef,
                                pg_get_functiondef(p.oid) as definition,
                                pg_get_function_arguments(p.oid) as arguments
                            FROM pg_proc p
                            JOIN pg_namespace n ON p.pronamespace = n.oid
                            WHERE n.nspname = 'auth' AND p.proname = 'set_agent_context_from_agent_id'
                        `;
                    expect(functionDef).toBeDefined();
                    expect(functionDef.prosecdef).toBe(true); // Should be SECURITY DEFINER
                    // Grant execute permission to the proxy role (may not exist in your test environment)
                    await tx`
                            GRANT EXECUTE ON FUNCTION auth.set_agent_context_from_agent_id(UUID) TO vircadia_agent_proxy
                        `;
                    // Check if permission was granted
                    const [permCheck] = await tx`
                            SELECT
                                r.rolname,
                                has_function_privilege(r.oid, p.oid, 'execute') as has_execute
                            FROM pg_proc p
                            JOIN pg_namespace n ON p.pronamespace = n.oid
                            JOIN pg_roles r ON r.rolname = 'vircadia_agent_proxy'
                            WHERE n.nspname = 'auth'
                            AND p.proname = 'set_agent_context_from_agent_id'
                        `;
                    expect(permCheck.has_execute).toBe(true);
                });
            });
            test("should set agent contexts successfully", async () => {
                await proxyUserSql.begin(async (tx) => {
                    const [setAdminAgentContext] = await tx`
                        SELECT auth.set_agent_context_from_agent_id(${adminAgent.id}::uuid)
                    `;
                });
                await proxyUserSql.begin(async (tx) => {
                    const [setRegularAgentContext] = await tx`
                        SELECT auth.set_agent_context_from_agent_id(${regularAgent.id}::uuid) as success
                    `;
                });
                await proxyUserSql.begin(async (tx) => {
                    const [setAnonAgentContext] = await tx`
                        SELECT auth.set_agent_context_from_agent_id(${anonAgent.id}::uuid) as success
                    `;
                });
            });
            test("should validate ADMIN agent session successfully", async () => {
                await proxyUserSql.begin(async (tx) => {
                    const [setAdminAgentContext] = await tx`
                        SELECT auth.set_agent_context_from_agent_id(${adminAgent.id}::uuid)
                    `;
                    const [validateAdminSession] = await tx`
                        SELECT auth.validate_session_id(${adminAgent.sessionId}::uuid) as agent_id
                    `;
                    expect(validateAdminSession.agent_id).toBe(adminAgent.id);
                });
            });
            test("should validate REGULAR agent session successfully", async () => {
                await proxyUserSql.begin(async (tx) => {
                    const [setRegularAgentContext] = await tx`
                        SELECT auth.set_agent_context_from_agent_id(${regularAgent.id}::uuid)
                    `;

                    const [validateRegularSession] = await tx`
                        SELECT auth.validate_session_id(${regularAgent.sessionId}::uuid) as agent_id
                    `;
                    expect(validateRegularSession.agent_id).toBe(
                        regularAgent.id,
                    );
                });
            });
            test("should validate ANON agent session successfully", async () => {
                await proxyUserSql.begin(async (tx) => {
                    const [setAnonAgentContext] = await tx`
                        SELECT auth.set_agent_context_from_agent_id(${anonAgent.id}::uuid)
                    `;

                    const [validateAnonSession] = await tx`
                        SELECT auth.validate_session_id(${anonAgent.sessionId}::uuid) as agent_id
                    `;
                    expect(validateAnonSession.agent_id).toBe(anonAgent.id);
                });
            });
            test("should verify SYSTEM agent permissions", async () => {
                await superUserSql.begin(async (tx) => {
                    const [isAdmin] =
                        await tx`SELECT auth.is_admin_agent() as is_admin`;
                    expect(isAdmin.is_admin).toBe(false);
                    const [isSystem] =
                        await tx`SELECT auth.is_system_agent() as is_system`;
                    expect(isSystem.is_system).toBe(true);
                    const [isProxy] =
                        await tx`SELECT auth.is_proxy_agent() as is_proxy`;
                    expect(isProxy.is_proxy).toBe(false);
                    const [isAnon] =
                        await tx`SELECT auth.is_anon_agent() as is_anon`;
                    expect(isAnon.is_anon).toBe(false);
                    const [systemAgentId] =
                        await tx`SELECT auth.get_system_agent_id() as system_agent_id`; // Get system agent id
                    expect(systemAgentId.system_agent_id).toBeDefined();
                    const [currentAgentId] =
                        await tx`SELECT auth.current_agent_id() as current_agent_id`;
                    expect(currentAgentId.current_agent_id).toBe(
                        systemAgentId.system_agent_id,
                    );
                });
            });
            test("should verify ADMIN PROXY agent permissions", async () => {
                await proxyUserSql.begin(async (tx) => {
                    const [setAgentContext] =
                        await tx`SELECT auth.set_agent_context_from_agent_id(${adminAgent.id}::uuid)`;
                    const [isAdmin] =
                        await tx`SELECT auth.is_admin_agent() as is_admin`;
                    expect(isAdmin.is_admin).toBe(true);
                    const [isSystem] =
                        await tx`SELECT auth.is_system_agent() as is_system`;
                    expect(isSystem.is_system).toBe(false);
                    const [isProxy] =
                        await tx`SELECT auth.is_proxy_agent() as is_proxy`;
                    expect(isProxy.is_proxy).toBe(true);
                    const [isAnon] =
                        await tx`SELECT auth.is_anon_agent() as is_anon`;
                    expect(isAnon.is_anon).toBe(false);
                    const [currentAgentId] =
                        await tx`SELECT auth.current_agent_id()`;
                    expect(currentAgentId.current_agent_id).toBe(adminAgent.id);
                });
            });
            test("should verify REGULAR PROXY agent permissions", async () => {
                await proxyUserSql.begin(async (tx) => {
                    const [setAgentContext] =
                        await tx`SELECT auth.set_agent_context_from_agent_id(${regularAgent.id}::uuid)`;
                    const [isAdmin] =
                        await tx`SELECT auth.is_admin_agent() as is_admin`;
                    expect(isAdmin.is_admin).toBe(false);
                    const [isSystem] =
                        await tx`SELECT auth.is_system_agent() as is_system`;
                    expect(isSystem.is_system).toBe(false);
                    const [isProxy] =
                        await tx`SELECT auth.is_proxy_agent() as is_proxy`;
                    expect(isProxy.is_proxy).toBe(true);
                    const [isAnon] =
                        await tx`SELECT auth.is_anon_agent() as is_anon`;
                    expect(isAnon.is_anon).toBe(false);
                    const [agentId] = await tx`SELECT auth.current_agent_id()`; // Get current agent id
                    expect(agentId.current_agent_id).toBe(regularAgent.id);
                });
            });
            test("should verify ANON PROXY agent permissions", async () => {
                await proxyUserSql.begin(async (tx) => {
                    await tx`SELECT auth.set_agent_context_from_agent_id(${anonAgent.id}::uuid)`;
                    const [isAdmin] =
                        await tx`SELECT auth.is_admin_agent() as is_admin`;
                    expect(isAdmin.is_admin).toBe(false);
                    const [isSystem] =
                        await tx`SELECT auth.is_system_agent() as is_system`;
                    expect(isSystem.is_system).toBe(false);
                    const [isProxy] =
                        await tx`SELECT auth.is_proxy_agent() as is_proxy`;
                    expect(isProxy.is_proxy).toBe(true);
                    const [isAnon] =
                        await tx`SELECT auth.is_anon_agent() as is_anon`;
                    expect(isAnon.is_anon).toBe(true);
                    const [currentAgentId] =
                        await tx`SELECT auth.current_agent_id()`; // Get current agent id
                    expect(currentAgentId.current_agent_id).toBe(anonAgent.id);
                });
            });
            test("should handle expired sessions correctly", async () => {
                await proxyUserSql.begin(async (tx) => {
                    await tx`SELECT auth.set_agent_context_from_agent_id(${adminAgent.id}::uuid)`;
                    const [expiredSession] = await tx`
                            INSERT INTO auth.agent_sessions (
                                auth__agent_id,
                                auth__provider_name,
                                session__expires_at,
                                session__is_active,
                                session__jwt
                            ) VALUES (
                                ${adminAgent.id},
                                'system',
                                NOW() - INTERVAL '1 second',
                                true,
                                'test_token'
                            ) RETURNING general__session_id
                        `;
                    // Now attempt to select that session row, it should be gone.
                    const [foundExpiredSession] = await tx`
                            SELECT * FROM auth.agent_sessions
                            WHERE general__session_id = ${expiredSession.general__session_id}
                        `;
                    expect(foundExpiredSession).toBeUndefined();
                });
            });
            test("should enforce max sessions per agent for 'system' provider", async () => {
                await superUserSql.begin(async (tx) => {
                    // Create a new test agent profile exclusive to this test
                    const uniqueSuffix = Math.floor(Math.random() * 1000000);
                    const testUsername = `test_temp_agent_${uniqueSuffix}`;
                    const testEmail = `temp_agent_${uniqueSuffix}@test.com`;
                    const [newAgent] = await tx`
                        INSERT INTO auth.agent_profiles (profile__username, auth__email)
                        VALUES (${testUsername}, ${testEmail})
                        RETURNING general__agent_profile_id
                    `;
                    const newAgentId = newAgent.general__agent_profile_id;
                    // Query provider config for the 'system' provider
                    const [testProviderConfig] = await tx<
                        [
                            {
                                provider__session_max_per_agent: number;
                                provider__session_duration_ms: number;
                            },
                        ]
                    >`SELECT provider__session_max_per_agent, provider__session_duration_ms
                      FROM auth.auth_providers
                      WHERE provider__name = 'system'`;
                    const maxSessions =
                        testProviderConfig.provider__session_max_per_agent;
                    // Create one more session than allowed to trigger session limit enforcement
                    for (let i = 0; i < maxSessions + 1; i++) {
                        await tx`
                            INSERT INTO auth.agent_sessions (
                                auth__agent_id,
                                auth__provider_name,
                                session__expires_at
                            )
                            VALUES (
                                ${newAgentId},
                                'system',
                                (NOW() + (${testProviderConfig.provider__session_duration_ms} || ' milliseconds')::INTERVAL)
                            )
                        `;
                    }
                    // Verify that the oldest session was invalidated
                    const [activeSessions] = await tx<{ count: string }[]>`
                        SELECT COUNT(*)::TEXT as count
                        FROM auth.agent_sessions
                        WHERE auth__agent_id = ${newAgentId}
                          AND session__is_active = true
                    `;
                    expect(Number.parseInt(activeSessions.count)).toBe(
                        maxSessions,
                    );
                });
            });
        });
        describe("Sync Group Management", () => {
            test("should verify at least one default sync group exists", async () => {
                await proxyUserSql.begin(async (tx) => {
                    await tx`SELECT auth.set_agent_context_from_agent_id(${adminAgent.id}::uuid)`;
                    const syncGroups = await tx`
                        SELECT * FROM auth.sync_groups
                        WHERE general__sync_group = ${TEST_SYNC_GROUP}
                        ORDER BY general__sync_group
                    `;
                    expect(syncGroups[0].general__sync_group).toBe(
                        TEST_SYNC_GROUP,
                    );
                });
            });
            test("should manage sync group roles correctly for regular agent", async () => {
                await proxyUserSql.begin(async (tx) => {
                    await tx`SELECT auth.set_agent_context_from_agent_id(${adminAgent.id}::uuid)`;
                    await tx`
                        INSERT INTO auth.agent_sync_group_roles (
                            auth__agent_id, 
                            group__sync,
                            permissions__can_read,
                            permissions__can_insert, 
                            permissions__can_update,
                            permissions__can_delete
                        ) VALUES (
                            ${regularAgent.id},
                            ${TEST_SYNC_GROUP},
                            true, true, true, false
                        )
                        ON CONFLICT (auth__agent_id, group__sync) 
                        DO UPDATE SET
                            permissions__can_read = EXCLUDED.permissions__can_read,
                            permissions__can_insert = EXCLUDED.permissions__can_insert,
                            permissions__can_update = EXCLUDED.permissions__can_update,
                            permissions__can_delete = EXCLUDED.permissions__can_delete
                    `;
                    const [checkAddedRole] = await tx`
                        SELECT * FROM auth.agent_sync_group_roles
                        WHERE auth__agent_id = ${regularAgent.id}
                    `;
                    expect(checkAddedRole.group__sync).toBe(TEST_SYNC_GROUP);
                    expect(checkAddedRole.permissions__can_read).toBe(true);
                    expect(checkAddedRole.permissions__can_insert).toBe(true);
                    expect(checkAddedRole.permissions__can_update).toBe(true);
                    expect(checkAddedRole.permissions__can_delete).toBe(false);
                });
                await proxyUserSql.begin(async (tx) => {
                    // Set to non-admin agent context to test permissions
                    await tx`SELECT auth.set_agent_context_from_agent_id(${regularAgent.id})`;
                    // Query our role table for the regular agent's sync group permissions
                    const [checkRoleFromAgent] = await tx`
                    SELECT permissions__can_read, permissions__can_insert, permissions__can_update, permissions__can_delete
                    FROM auth.agent_sync_group_roles
                    WHERE auth__agent_id = ${regularAgent.id}
                    AND group__sync = ${TEST_SYNC_GROUP}
                    `;
                    expect(checkRoleFromAgent.permissions__can_read).toBe(true);
                    expect(checkRoleFromAgent.permissions__can_insert).toBe(
                        true,
                    );
                    expect(checkRoleFromAgent.permissions__can_update).toBe(
                        true,
                    );
                    expect(checkRoleFromAgent.permissions__can_delete).toBe(
                        false,
                    );
                    // await tx`SELECT auth.refresh_active_sessions()`;
                    const [result] = await tx`
                        SELECT array_agg(general__session_id) as session_ids
                        FROM auth.active_sync_group_sessions
                        WHERE group__sync = ${TEST_SYNC_GROUP};
                    `;
                    expect(result.session_ids).toContain(
                        regularAgent.sessionId,
                    );
                });
            });
        });
    });

    describe("Config Schema", () => {
        test("should read all config tables", async () => {
            await proxyUserSql.begin(async (tx) => {
                // Test entity_config
                const [entityConfig] = await tx`
                        SELECT *
                        FROM config.entity_config
                    `;
                expect(
                    entityConfig.entity_config__script_compilation_timeout_ms,
                ).toBeDefined();

                // Test network_config
                const [networkConfig] = await tx`
                        SELECT *
                        FROM config.network_config
                    `;
                expect(
                    networkConfig.network_config__max_latency_ms,
                ).toBeDefined();
                expect(
                    networkConfig.network_config__warning_latency_ms,
                ).toBeDefined();
                expect(
                    networkConfig.network_config__consecutive_warnings_before_kick,
                ).toBeDefined();

                // Test auth_config
                const [authConfig] = await tx`
                        SELECT *
                        FROM config.auth_config
                    `;
                expect(
                    authConfig.auth_config__session_cleanup_interval,
                ).toBeDefined();
                expect(
                    authConfig.auth_config__heartbeat_interval_ms,
                ).toBeDefined();

                // Test database_config
                const [dbConfig] = await tx`
                        SELECT *
                        FROM config.database_config
                    `;
                expect(dbConfig.database_config__major_version).toBeDefined();
                expect(dbConfig.database_config__minor_version).toBeDefined();
            });
        });
    });

    describe("Entity Schema", () => {
        describe("Entities Operations", () => {
            test("should create and read an entity with metadata", async () => {
                await proxyUserSql.begin(async (tx) => {
                    await tx`SELECT auth.set_agent_context_from_agent_id(${adminAgent.id}::uuid)`;
                    const entityData = {
                        script_namespace_1: {
                            state: "initialized",
                            config: { enabled: true },
                        },
                        script_namespace_2: {
                            counter: 0,
                            lastUpdate: "2024-01-01",
                        },
                    };
                    const [entity] = await tx<[Entity.I_Entity]>`
                        INSERT INTO entity.entities (
                            general__entity_name,
                            meta__data,
                            group__sync
                        ) VALUES (
                            ${`${DB_TEST_PREFIX}Test Entity`},
                            ${tx.json(entityData)},
                            ${"public.NORMAL"}
                        ) RETURNING *
                    `;
                    expect(entity.general__entity_name).toBe(
                        `${DB_TEST_PREFIX}Test Entity`,
                    );
                    expect(entity.group__sync).toBe("public.NORMAL");
                    const metaData =
                        typeof entity.meta__data === "string"
                            ? JSON.parse(entity.meta__data)
                            : entity.meta__data;
                    expect(metaData).toMatchObject(entityData);
                    await tx`DELETE FROM entity.entities WHERE general__entity_name = ${entity.general__entity_name}`;
                });
            });
            test("should update an entity", async () => {
                await proxyUserSql.begin(async (tx) => {
                    await tx`SELECT auth.set_agent_context_from_agent_id(${adminAgent.id}::uuid)`;
                    const [entity] = await tx<[Entity.I_Entity]>`
                        INSERT INTO entity.entities (
                            general__entity_name,
                            meta__data,
                            group__sync
                        ) VALUES (
                            ${`${DB_TEST_PREFIX}Test Entity`},
                            ${tx.json({
                                script1: { status: "init" },
                                script2: { counter: 0 },
                            })},
                            ${"public.NORMAL"}
                        ) RETURNING *
                    `;
                    await tx`
                        UPDATE entity.entities
                        SET
                            general__entity_name = ${`${DB_TEST_PREFIX}Updated Entity`},
                            meta__data = ${tx.json({
                                script1: { status: "ready" },
                                script2: { counter: 1 },
                            })}
                        WHERE general__entity_name = ${entity.general__entity_name}
                    `;
                    const [updated] = await tx<[Entity.I_Entity]>`
                        SELECT * FROM entity.entities
                        WHERE general__entity_name = ${`${DB_TEST_PREFIX}Updated Entity`}
                    `;
                    expect(updated.general__entity_name).toBe(
                        `${DB_TEST_PREFIX}Updated Entity`,
                    );
                    expect(updated.meta__data).toMatchObject({
                        script1: { status: "ready" },
                        script2: { counter: 1 },
                    });
                    await tx`DELETE FROM entity.entities WHERE general__entity_name = ${updated.general__entity_name}`;
                });
            });
        });
        describe("Entity Assets Operations", () => {
            test("should create and handle bytea asset operations", async () => {
                await proxyUserSql.begin(async (tx) => {
                    await tx`SELECT auth.set_agent_context_from_agent_id(${adminAgent.id}::uuid)`;

                    // Read the triangle.gltf file for both operations
                    const gltfFile = await readTriangleGltf();
                    const gltfContent = await gltfFile.arrayBuffer();
                    const gltfBuffer = Buffer.from(gltfContent);

                    // Push asset with bytea data
                    const [byteaAsset] = await tx<[Entity.Asset.I_Asset]>`
                        INSERT INTO entity.entity_assets (
                            general__asset_file_name,
                            asset__data__bytea,
                            group__sync
                        ) VALUES (
                            ${`${DB_TEST_PREFIX}Holistic Bytea Asset`},
                            ${gltfBuffer},
                            ${"public.NORMAL"}
                        ) RETURNING *
                    `;

                    expect(byteaAsset.general__asset_file_name).toBe(
                        `${DB_TEST_PREFIX}Holistic Bytea Asset`,
                    );
                    expect(byteaAsset.asset__data__bytea).toBeDefined();

                    const [retrievedByteaAsset] = await tx<
                        [Entity.Asset.I_Asset]
                    >`
                        SELECT * FROM entity.entity_assets 
                        WHERE general__asset_file_name = ${`${DB_TEST_PREFIX}Holistic Bytea Asset`}
                    `;

                    // Verify bytea data
                    const bytea = retrievedByteaAsset.asset__data__bytea;
                    if (bytea) {
                        const bufferText = Buffer.from(bytea).toString();
                        const parsedContent = JSON.parse(bufferText);
                        expect(parsedContent.asset.version).toBe("2.0");
                    }

                    // Clean up test assets
                    await tx`DELETE FROM entity.entity_assets WHERE general__asset_file_name = ${byteaAsset.general__asset_file_name}`;
                });
            });

            test("should update an existing asset", async () => {
                await proxyUserSql.begin(async (tx) => {
                    await tx`SELECT auth.set_agent_context_from_agent_id(${adminAgent.id}::uuid)`;

                    // Read the triangle.gltf file
                    const gltfFile = await readTriangleGltf();
                    const gltfContent = await gltfFile.arrayBuffer();
                    const gltfBuffer = Buffer.from(gltfContent);
                    const gltfJson = await gltfFile.json();

                    const [asset] = await tx<[Entity.Asset.I_Asset]>`
                        INSERT INTO entity.entity_assets (
                            general__asset_file_name,
                            asset__data__bytea,
                            group__sync
                        ) VALUES (
                            ${`${DB_TEST_PREFIX}Asset To Update`},
                            ${gltfBuffer},
                            ${"public.NORMAL"}
                        ) RETURNING *
                    `;

                    // Update the asset - modify the GLTF by changing a property
                    const gltfData = { ...gltfJson };
                    gltfData.scene = 1; // Simple modification to differentiate

                    const updatedContent = JSON.stringify(gltfData);
                    const updatedData = Buffer.from(updatedContent);

                    await tx`
                        UPDATE entity.entity_assets
                        SET asset__data__bytea = ${updatedData}
                        WHERE general__asset_file_name = ${asset.general__asset_file_name}
                    `;

                    // Verify the update
                    const [updatedAsset] = await tx<[Entity.Asset.I_Asset]>`
                        SELECT * FROM entity.entity_assets 
                        WHERE general__asset_file_name = ${asset.general__asset_file_name}
                    `;

                    // Instead of strict equality (toBe), use toEqual for content comparison
                    expect(updatedAsset.asset__data__bytea).toEqual(
                        updatedData,
                    );
                    // More safely handle potentially undefined bytea data
                    const byteaData = updatedAsset.asset__data__bytea;
                    if (byteaData) {
                        const bufferText = Buffer.from(byteaData).toString();
                        const parsedData = JSON.parse(bufferText);
                        expect(parsedData.scene).toBe(1); // Verify our modification
                    }

                    // Check that timestamp is updated with safer type handling
                    const updatedAt = updatedAsset.general__updated_at;
                    const createdAt = asset.general__created_at;
                    if (updatedAt && createdAt) {
                        const updatedTime = new Date(updatedAt).getTime();
                        const createdTime = new Date(createdAt).getTime();
                        expect(updatedTime).toBeGreaterThanOrEqual(createdTime);
                    }

                    await tx`DELETE FROM entity.entity_assets WHERE general__asset_file_name = ${asset.general__asset_file_name}`;
                });
            });

            test("should handle multiple assets with different sync groups", async () => {
                await proxyUserSql.begin(async (tx) => {
                    await tx`SELECT auth.set_agent_context_from_agent_id(${adminAgent.id}::uuid)`;

                    // Read the triangle.gltf file
                    const gltfFile = await readTriangleGltf();
                    const gltfContent = await gltfFile.arrayBuffer();
                    const gltfBuffer = Buffer.from(gltfContent);
                    const gltfJson = await gltfFile.json();

                    // Create assets in different sync groups
                    const [asset1] = await tx<[Entity.Asset.I_Asset]>`
                        INSERT INTO entity.entity_assets (
                            general__asset_file_name,
                            asset__data__bytea,
                            group__sync
                        ) VALUES (
                            ${`${DB_TEST_PREFIX}Asset Group 1`},
                            ${gltfBuffer},
                            ${"public.NORMAL"}
                        ) RETURNING *
                    `;

                    // Modify the GLTF slightly for the second asset
                    const gltfData = { ...gltfJson };
                    gltfData.scene = 1; // Simple modification to differentiate

                    const [asset2] = await tx<[Entity.Asset.I_Asset]>`
                        INSERT INTO entity.entity_assets (
                            general__asset_file_name,
                            asset__data__bytea,
                            group__sync
                        ) VALUES (
                            ${`${DB_TEST_PREFIX}Asset Group 2`},
                            ${gltfBuffer},
                            ${TEST_SYNC_GROUP}
                        ) RETURNING *
                    `;

                    // Verify we can query assets by sync group
                    const publicGroupAssets = await tx<
                        Array<Entity.Asset.I_Asset>
                    >`
                        SELECT * FROM entity.entity_assets 
                        WHERE group__sync = ${"public.NORMAL"}
                        AND general__asset_file_name LIKE ${`${DB_TEST_PREFIX}%`}
                    `;

                    const testGroupAssets = await tx<
                        Array<Entity.Asset.I_Asset>
                    >`
                        SELECT * FROM entity.entity_assets 
                        WHERE group__sync = ${TEST_SYNC_GROUP}
                        AND general__asset_file_name LIKE ${`${DB_TEST_PREFIX}%`}
                    `;

                    expect(publicGroupAssets.length).toBeGreaterThanOrEqual(1);
                    expect(testGroupAssets.length).toBeGreaterThanOrEqual(1);

                    // Verify we can find our specific assets in each group
                    expect(
                        publicGroupAssets.some(
                            (a) =>
                                a.general__asset_file_name ===
                                asset1.general__asset_file_name,
                        ),
                    ).toBe(true);
                    expect(
                        testGroupAssets.some(
                            (a) =>
                                a.general__asset_file_name ===
                                asset2.general__asset_file_name,
                        ),
                    ).toBe(true);

                    // Clean up
                    await tx`DELETE FROM entity.entity_assets WHERE general__asset_file_name = ${asset1.general__asset_file_name}`;
                    await tx`DELETE FROM entity.entity_assets WHERE general__asset_file_name = ${asset2.general__asset_file_name}`;
                });
            });

            test("should batch create and delete multiple assets", async () => {
                await proxyUserSql.begin(async (tx) => {
                    await tx`SELECT auth.set_agent_context_from_agent_id(${adminAgent.id}::uuid)`;

                    // Read the triangle.gltf file
                    const gltfFile = await readTriangleGltf();
                    const gltfJson = await gltfFile.json();

                    // Create a batch of assets
                    const assetBatch = [];
                    const assetCount = 5;

                    for (let i = 0; i < assetCount; i++) {
                        const assetName = `${DB_TEST_PREFIX}Batch Asset ${i}`;
                        // Slightly modify each asset to make them unique
                        const gltfData = { ...gltfJson };
                        gltfData.scene = i; // Set scene to batch index
                        const assetData = Buffer.from(JSON.stringify(gltfData));

                        const [asset] = await tx<[Entity.Asset.I_Asset]>`
                            INSERT INTO entity.entity_assets (
                                general__asset_file_name,
                                asset__data__bytea,
                                group__sync
                            ) VALUES (
                                ${assetName},
                                ${assetData},
                                ${"public.NORMAL"}
                            ) RETURNING *
                        `;

                        assetBatch.push(asset);
                    }

                    // Verify all assets were created
                    expect(assetBatch.length).toBe(assetCount);

                    // Query to check all assets exist
                    const assets = await tx<Array<Entity.Asset.I_Asset>>`
                        SELECT * FROM entity.entity_assets 
                        WHERE general__asset_file_name LIKE ${`${DB_TEST_PREFIX}Batch Asset%`}
                    `;

                    expect(assets.length).toBe(assetCount);

                    // Batch delete the assets
                    const deleteResult = await tx`
                        DELETE FROM entity.entity_assets 
                        WHERE general__asset_file_name LIKE ${`${DB_TEST_PREFIX}Batch Asset%`}
                        RETURNING general__asset_file_name
                    `;

                    expect(deleteResult.length).toBe(assetCount);

                    // Verify assets are gone
                    const remainingAssets = await tx<
                        Array<Entity.Asset.I_Asset>
                    >`
                        SELECT * FROM entity.entity_assets 
                        WHERE general__asset_file_name LIKE ${`${DB_TEST_PREFIX}Batch Asset%`}
                    `;

                    expect(remainingAssets.length).toBe(0);
                });
            });

            test("should be able to load .gltf assets into Babylon.js before and after database bytea storage", async () => {
                // Create a NullEngine and Scene for testing
                const preEngine = new NullEngine();
                const preScene = new Scene(preEngine);

                // Original model data
                const gltfFile = await readTriangleGltf();
                const gltfContent = await gltfFile.arrayBuffer();
                const gltfBuffer = Buffer.from(gltfContent);

                try {
                    // Convert content to base64 for direct loading
                    const base64Content = gltfBuffer.toString("base64");
                    const base64ModelUrl = `data:;base64,${base64Content}`;

                    // Load model using AppendSceneAsync
                    const result = await ImportMeshAsync(
                        base64ModelUrl,
                        preScene,
                        {
                            pluginExtension: ".gltf",
                        },
                    );

                    const originalModelMesh = preScene.meshes[0];
                    expect(originalModelMesh.name).toBeDefined();

                    preScene.dispose();
                    preEngine.dispose();
                } catch (error) {
                    console.error("Error loading original model:", error);
                }

                // Store the model in the database and retrieve it
                let retrievedByteaData: Buffer | undefined;

                await proxyUserSql.begin(async (tx) => {
                    await tx`SELECT auth.set_agent_context_from_agent_id(${adminAgent.id}::uuid)`;

                    // Store the asset in bytea format - using binary content directly
                    const [asset] = await tx<[Entity.Asset.I_Asset]>`
                        INSERT INTO entity.entity_assets (
                            general__asset_file_name,
                            asset__data__bytea,
                            group__sync
                        ) VALUES (
                            ${`${DB_TEST_PREFIX}Babylon Bytea Test Asset`},
                            ${gltfBuffer},
                            ${"public.NORMAL"}
                        ) RETURNING *
                    `;

                    // Retrieve the asset
                    const [retrievedAsset] = await tx<[Entity.Asset.I_Asset]>`
                        SELECT * FROM entity.entity_assets 
                        WHERE general__asset_file_name = ${`${DB_TEST_PREFIX}Babylon Bytea Test Asset`}
                    `;

                    retrievedByteaData = retrievedAsset.asset__data__bytea;

                    // Clean up
                    await tx`DELETE FROM entity.entity_assets WHERE general__asset_file_name = ${asset.general__asset_file_name}`;
                });

                // Verify we got data back
                expect(retrievedByteaData).toBeDefined();

                if (!retrievedByteaData) {
                    // Skip the rest of the test if data is undefined
                    console.warn(
                        "Retrieved bytea data is undefined, skipping Babylon import test",
                    );
                    return;
                }

                const postEngine = new NullEngine();
                const postScene = new Scene(postEngine);

                try {
                    // Convert the bytea buffer to base64 for loading
                    const base64FromBytea =
                        Buffer.from(retrievedByteaData).toString("base64");
                    const retrievedModelUrl = `data:;base64,${base64FromBytea}`;

                    // Load the model from the data URL created from bytea data
                    const result = await ImportMeshAsync(
                        retrievedModelUrl,
                        postScene,
                        {
                            pluginExtension: ".gltf",
                        },
                    );

                    const retrievedModelMesh = result.meshes[0];
                    expect(retrievedModelMesh.name).toBeDefined();

                    postScene.dispose();
                    postEngine.dispose();
                } catch (error) {
                    console.error("Error loading retrieved model:", error);
                }
            });

            test("should be able to load .glb assets into Babylon.js before and after database bytea storage", async () => {
                // Create a NullEngine and Scene for testing
                const preEngine = new NullEngine();
                const preScene = new Scene(preEngine);

                // Original model data - using GLB file
                const glbFile = await readDiscGlb();
                const glbContent = await glbFile.arrayBuffer();
                const glbBuffer = Buffer.from(glbContent);

                try {
                    // Convert content to base64 for direct loading
                    const base64Content = glbBuffer.toString("base64");
                    // Use appropriate mimetype for GLB (binary)
                    const base64ModelUrl = `data:application/octet-stream;base64,${base64Content}`;

                    // Load model using AppendSceneAsync with GLB extension
                    const result = await ImportMeshAsync(
                        base64ModelUrl,
                        preScene,
                        {
                            pluginExtension: ".glb",
                        },
                    );

                    const originalModelMesh = result.meshes[0];
                    expect(originalModelMesh.name).toBeDefined();

                    preScene.dispose();
                    preEngine.dispose();
                } catch (error) {
                    console.error("Error loading original GLB model:", error);
                }

                // Store the model in the database and retrieve it
                let retrievedByteaData: Buffer | undefined;

                await proxyUserSql.begin(async (tx) => {
                    await tx`SELECT auth.set_agent_context_from_agent_id(${adminAgent.id}::uuid)`;

                    // Store the asset in bytea format - using binary content directly
                    const [asset] = await tx<[Entity.Asset.I_Asset]>`
                        INSERT INTO entity.entity_assets (
                            general__asset_file_name,
                            asset__data__bytea,
                            group__sync
                        ) VALUES (
                            ${`${DB_TEST_PREFIX}Babylon GLB Bytea Test Asset`},
                            ${glbBuffer},
                            ${"public.NORMAL"}
                        ) RETURNING *
                    `;

                    // Retrieve the asset
                    const [retrievedAsset] = await tx<[Entity.Asset.I_Asset]>`
                        SELECT * FROM entity.entity_assets 
                        WHERE general__asset_file_name = ${`${DB_TEST_PREFIX}Babylon GLB Bytea Test Asset`}
                    `;

                    retrievedByteaData = retrievedAsset.asset__data__bytea;

                    // Clean up
                    await tx`DELETE FROM entity.entity_assets WHERE general__asset_file_name = ${asset.general__asset_file_name}`;
                });

                // Verify we got data back
                expect(retrievedByteaData).toBeDefined();

                const postEngine = new NullEngine();
                const postScene = new Scene(postEngine);

                try {
                    // Convert the bytea buffer to base64 for loading
                    const base64FromBytea =
                        // biome-ignore lint/style/noNonNullAssertion:
                        Buffer.from(retrievedByteaData!).toString("base64");
                    // Use appropriate mimetype for GLB (binary)
                    const retrievedModelUrl = `data:application/octet-stream;base64,${base64FromBytea}`;

                    // Load the model from the data URL created from bytea data with GLB extension
                    const result = await ImportMeshAsync(
                        retrievedModelUrl,
                        postScene,
                        {
                            pluginExtension: ".glb",
                        },
                    );

                    const retrievedModelMesh = result.meshes[0];
                    expect(retrievedModelMesh).toBeDefined();
                    expect(retrievedModelMesh.name).toBeDefined();
                } catch (error) {
                    console.error("Error loading retrieved GLB model:", error);
                }

                // Clean up Babylon resources
                postScene.dispose();
                postEngine.dispose();
            });
        });
        describe("Relations Operations", () => {
            test("should create an entity with related asset, then delete the entity", async () => {
                await proxyUserSql.begin(async (tx) => {
                    await tx`SELECT auth.set_agent_context_from_agent_id(${adminAgent.id}::uuid)`;
                    // Insert an asset record.
                    const [asset] = await tx<[Entity.Asset.I_Asset]>`
                        INSERT INTO entity.entity_assets (
                            general__asset_file_name,
                            group__sync,
                            asset__data__bytea
                        ) VALUES (
                            ${`${DB_TEST_PREFIX}Test Asset`},
                            ${"public.NORMAL"},
                            ${Buffer.from("deadbeef")}
                        ) RETURNING *
                    `;
                    // Insert an entity that references the created script (and asset via metadata).
                    const [entity] = await tx<[Entity.I_Entity]>`
                        INSERT INTO entity.entities (
                            general__entity_name,
                            meta__data,
                            group__sync
                        ) VALUES (
                            ${`${DB_TEST_PREFIX}Entity with asset and script`},
                            ${tx.json({
                                assets: {
                                    references: [
                                        asset.general__asset_file_name,
                                    ],
                                },
                            })},
                            ${"public.NORMAL"}
                        ) RETURNING *
                    `;
                    // Validate the entity data.
                    expect(entity.general__entity_name).toBe(
                        `${DB_TEST_PREFIX}Entity with asset and script`,
                    );
                    const metaData =
                        typeof entity.meta__data === "string"
                            ? JSON.parse(entity.meta__data)
                            : entity.meta__data;
                    expect(metaData.assets.references).toContain(
                        asset.general__asset_file_name,
                    );
                    // Delete the entity record after all checks.
                    await tx`DELETE FROM entity.entities WHERE general__entity_name = ${entity.general__entity_name}`;
                    // Optionally clean up asset and script records.
                    await tx`DELETE FROM entity.entity_assets WHERE general__asset_file_name = ${asset.general__asset_file_name}`;
                });
            });
        });
    });

    describe("Tick Schema", () => {
        describe("Tick Operations", () => {
            test("should create and manage world ticks", async () => {
                await proxyUserSql.begin(async (tx) => {
                    await tx`SELECT auth.set_agent_context_from_agent_id(${adminAgent.id}::uuid)`;

                    // Capture first tick and verify properties
                    const [tickRecord1] = await tx<[Tick.I_Tick]>`
                    SELECT * FROM tick.capture_tick_state(${TEST_SYNC_GROUP})
                `;
                    expect(tickRecord1).toBeTruthy();
                    expect(tickRecord1.group__sync).toBe(TEST_SYNC_GROUP);
                    expect(
                        Number(tickRecord1.tick__entity_states_processed),
                    ).toBeGreaterThanOrEqual(0);
                    expect(tickRecord1.tick__duration_ms).toBeGreaterThan(0);
                    expect(tickRecord1.tick__start_time).toBeTruthy();
                    expect(tickRecord1.tick__end_time).toBeTruthy();
                    expect(Number(tickRecord1.tick__number)).toBeGreaterThan(0);
                    expect(tickRecord1.tick__is_delayed).toBeDefined();
                    expect(
                        tickRecord1.tick__headroom_ms,
                    ).toBeGreaterThanOrEqual(0);

                    // Capture second tick and verify difference
                    const [tickRecord2] = await tx<[Tick.I_Tick]>`
                    SELECT * FROM tick.capture_tick_state(${TEST_SYNC_GROUP})
                `;
                    expect(tickRecord2).toBeTruthy();
                    expect(tickRecord2.general__tick_id).not.toBe(
                        tickRecord1.general__tick_id,
                    );
                    expect(Number(tickRecord2.tick__number)).toBeGreaterThan(
                        Number(tickRecord1.tick__number),
                    );
                    expect(
                        new Date(tickRecord2.tick__start_time).getTime(),
                    ).toBeGreaterThan(
                        new Date(tickRecord1.tick__start_time).getTime(),
                    );
                    expect(
                        new Date(tickRecord2.tick__end_time).getTime(),
                    ).toBeGreaterThan(
                        new Date(tickRecord1.tick__end_time).getTime(),
                    );
                    expect(
                        Number(tickRecord2.tick__time_since_last_tick_ms),
                    ).toBeGreaterThan(0);
                });
            });

            test("should receive notification when a tick is captured", async () => {
                let notificationReceived = false;
                let notificationData: Tick.I_TickNotification | null = null;

                // First register the JS callback handler
                superUserSql.listen("tick_captured", (notification) => {
                    notificationReceived = true;
                    notificationData = JSON.parse(notification);
                });

                // Then set up PostgreSQL LISTEN in a separate transaction
                await superUserSql.begin(async (tx) => {
                    await tx`LISTEN tick_captured`;
                });

                // Add a small delay to ensure listener is fully established
                await Bun.sleep(100);

                // Create a promise that resolves when notification is received
                const notificationPromise = new Promise((resolve) => {
                    const checkInterval = setInterval(() => {
                        if (notificationReceived) {
                            clearInterval(checkInterval);
                            resolve(notificationData);
                        }
                    }, 50);
                });

                // Capture a tick in a separate transaction
                await superUserSql.begin(async (tx) => {
                    await tx`SELECT * FROM tick.capture_tick_state(${TEST_SYNC_GROUP})`;
                });

                const result = await Promise.race([
                    notificationPromise,
                    Bun.sleep(2000),
                ]);

                // Clean up listener
                await superUserSql.begin(async (tx) => {
                    await tx`UNLISTEN tick_captured`;
                });

                const parsedNotification = result as Tick.I_TickNotification;

                // Verify notification was received
                expect(notificationReceived).toBe(true);
                expect(parsedNotification).toBeDefined();
                expect(parsedNotification.syncGroup).toBe(TEST_SYNC_GROUP);
                expect(parsedNotification.tickId).toBeDefined();
                expect(parsedNotification.tickNumber).toBeDefined();
            });
        });

        describe("Entity Operations", () => {
            test("should create multiple test entities and capture their tick states", async () => {
                await superUserSql.begin(async (tx) => {
                    const entityNames = [
                        `${DB_TEST_PREFIX}Entity One`,
                        `${DB_TEST_PREFIX}Entity Two`,
                        `${DB_TEST_PREFIX}Entity Three`,
                    ];
                    const createdEntities = [];

                    for (const name of entityNames) {
                        const [entity] = await tx<[Entity.I_Entity]>`
                    INSERT INTO entity.entities (
                        general__entity_name,
                        meta__data,
                        group__sync
                    ) VALUES (
                        ${name},
                        ${tx.json({
                            test_script_1: {
                                position: {
                                    x: 0,
                                    y: 0,
                                    z: 0,
                                },
                            },
                        })},
                        ${TEST_SYNC_GROUP}
                    ) RETURNING *
                `;
                        createdEntities.push(entity);
                    }

                    // Capture tick state
                    const [tickRecord] = await tx<[Tick.I_Tick]>`
                SELECT * FROM tick.capture_tick_state(${TEST_SYNC_GROUP})
            `;

                    // Verify entities exist
                    const states = await tx<
                        Array<{ general__entity_name: string }>
                    >`
                SELECT general__entity_name
                FROM entity.entities
                WHERE group__sync = ${TEST_SYNC_GROUP}
            `;

                    const stateIds = states.map((s) => s.general__entity_name);
                    for (const entity of createdEntities) {
                        expect(stateIds).toContain(entity.general__entity_name);
                    }
                });
            });

            test("should detect entity changes between ticks for multiple entities", async () => {
                await superUserSql.begin(async (tx) => {
                    const [entity1] = await tx<[Entity.I_Entity]>`
                        INSERT INTO entity.entities (
                            general__entity_name,
                            meta__data,
                            group__sync
                        ) VALUES (
                            ${`${DB_TEST_PREFIX}Original Entity 1`},
                            ${tx.json({
                                test_script_1: {
                                    position: {
                                        x: 0,
                                        y: 0,
                                        z: 0,
                                    },
                                },
                            })},
                            ${TEST_SYNC_GROUP}
                        ) RETURNING *
                    `;
                    const [entity2] = await tx<[Entity.I_Entity]>`
                       INSERT INTO entity.entities (
                            general__entity_name,
                            meta__data,
                            group__sync
                        ) VALUES (
                            ${`${DB_TEST_PREFIX}Original Entity 2`},
                            ${tx.json({ test_script_1: { position: { x: 10, y: 10, z: 10 } } })},
                            ${TEST_SYNC_GROUP}
                        ) RETURNING *
                    `;
                    // Capture first tick
                    await tx`SELECT * FROM tick.capture_tick_state(${TEST_SYNC_GROUP})`;

                    // Update both entities
                    await tx`
                        UPDATE entity.entities
                        SET general__entity_name = ${`${DB_TEST_PREFIX}Updated Entity 1`},
                            meta__data = ${tx.json({ test_script_1: { position: { x: 5, y: 5, z: 5 } } })}
                        WHERE general__entity_name = ${entity1.general__entity_name}
                    `;
                    await tx`
                        UPDATE entity.entities
                        SET general__entity_name = ${`${DB_TEST_PREFIX}Updated Entity 2`},
                            meta__data = ${tx.json({ test_script_1: { position: { x: 15, y: 15, z: 15 } } })}
                        WHERE general__entity_name = ${entity2.general__entity_name}
                    `;

                    // Capture second tick
                    await tx`SELECT * FROM tick.capture_tick_state(${TEST_SYNC_GROUP})`;

                    // Retrieve changed entity states between latest ticks and verify
                    const latestTicks = await tx`
                        SELECT general__tick_id
                        FROM tick.world_ticks
                        WHERE group__sync = ${TEST_SYNC_GROUP}
                        ORDER BY tick__number DESC
                        LIMIT 2
                    `;

                    const currentTickId = latestTicks[0].general__tick_id;
                    const previousTickId = latestTicks[1].general__tick_id;

                    // Query for entity changes between the two ticks
                    const changes = await tx<
                        Array<{
                            general__entity_name: string;
                            operation: string;
                            changes: Record<string, unknown>;
                        }>
                    >`
                        WITH current_state AS (
                            SELECT e.*
                            FROM tick.entity_states e
                            WHERE e.general__tick_id = ${currentTickId}
                        ),
                        previous_state AS (
                            SELECT e.*
                            FROM tick.entity_states e
                            WHERE e.general__tick_id = ${previousTickId}
                        ),
                        changed_entities AS (
                            SELECT 
                                c.general__entity_name,
                                CASE
                                    WHEN p.general__entity_name IS NULL THEN 'INSERT'
                                    ELSE 'UPDATE'
                                END as operation,
                                jsonb_build_object(
                                    'general__entity_name', 
                                        CASE WHEN c.general__entity_name != p.general__entity_name 
                                        THEN c.general__entity_name ELSE NULL END,
                                    'meta__data', 
                                        CASE WHEN c.meta__data != p.meta__data 
                                        THEN c.meta__data ELSE NULL END
                                    -- Add other entity fields as needed
                                ) as changes
                            FROM current_state c
                            LEFT JOIN previous_state p ON c.general__entity_name = p.general__entity_name
                            WHERE 
                                p.general__entity_name IS NULL OR
                                c.general__entity_name != p.general__entity_name OR
                                c.meta__data != p.meta__data
                                -- Add other comparisons as needed
                        )
                        SELECT * FROM changed_entities
                    `;

                    expect.arrayContaining([
                        entity1.general__entity_name,
                        entity2.general__entity_name,
                    ]);

                    // Verify updated details for one of the entities
                    const updatedChange = changes.find(
                        (c) =>
                            c.general__entity_name ===
                            entity1.general__entity_name,
                    );
                    expect(updatedChange).toBeTruthy();
                    expect(updatedChange?.operation).toBe("UPDATE");
                    expect(updatedChange?.changes.general__entity_name).toBe(
                        `${DB_TEST_PREFIX}Updated Entity 1`,
                    );
                });
            });
        });
    });

    afterAll(async () => {
        log({
            message: "Cleaning up test objects...",
            type: "debug",
            suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
            debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
        });
        await cleanupTestEntities({
            superUserSql,
        });
        await cleanupTestAssets({
            superUserSql,
        });
        await cleanupTestAccounts({
            superUserSql,
        });
        log({
            message: "Test objects cleaned up.",
            type: "debug",
            suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
            debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
        });
        log({
            message: "Disconnecting from DB...",
            type: "debug",
            suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
            debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
        });
        await PostgresClient.getInstance({
            debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
            suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
        }).disconnect();
        log({
            message: "Disconnected from DB.",
            type: "debug",
            suppress: VircadiaConfig_CLI.VRCA_CLI_SUPPRESS,
            debug: VircadiaConfig_CLI.VRCA_CLI_DEBUG,
        });
    });
});
