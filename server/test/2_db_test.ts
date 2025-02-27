import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import type postgres from "postgres";
import { log } from "../../sdk/vircadia-world-sdk-ts/module/general/log";
import { PostgresClient } from "../database/postgres/postgres_client";
import {
    Entity,
    type Auth,
    type Tick,
} from "../../sdk/vircadia-world-sdk-ts/schema/schema.general";
import { sign } from "jsonwebtoken";
import { isHealthy, up } from "../container/docker/docker_cli";

const syncGroupToTest = "public.REALTIME";
const scriptNamespace = "test_script_1";

const adminAgentUsername = "test_admin";
const regularAgentUsername = "test_agent";
const anonAgentUsername = "test_anon";

interface TestAccount {
    id: string;
    token: string;
    sessionId: string;
}

let superUserSql: postgres.Sql;
let proxyUserSql: postgres.Sql;
let adminAgent: TestAccount;
let regularAgent: TestAccount;
let anonAgent: TestAccount;

const createdEntityIds: string[] = [];
const createdScriptIds: string[] = [];
const createdAssetIds: string[] = [];

async function initContainers(): Promise<void> {
    if (!(await isHealthy()).isHealthy) {
        await up();

        const healthyAfterUp = await isHealthy();
        if (!healthyAfterUp.isHealthy) {
            throw new Error("Failed to start services");
        }
    }
}

async function initTestConnections(): Promise<void> {
    superUserSql = await PostgresClient.getInstance().getSuperClient();
    proxyUserSql = await PostgresClient.getInstance().getProxyClient();
}

async function cleanupTestConnections(): Promise<void> {
    await PostgresClient.getInstance().disconnect();
}

async function initTestAccounts(): Promise<void> {
    await superUserSql.begin(async (tx) => {
        // First create a system token with superuser privileges using system auth provider
        const [systemAuthProviderConfig] = await superUserSql<
            [
                {
                    provider__jwt_secret: string;
                    provider__session_duration_ms: number;
                },
            ]
        >`
			SELECT provider__jwt_secret, provider__session_duration_ms
			FROM auth.auth_providers 
			WHERE provider__name = 'system'
		`;
        expect(systemAuthProviderConfig.provider__jwt_secret).toBeDefined();
        expect(
            systemAuthProviderConfig.provider__session_duration_ms,
        ).toBeDefined();

        const [anonAuthProviderConfig] = await superUserSql<
            [
                {
                    provider__jwt_secret: string;
                    provider__session_duration_ms: number;
                },
            ]
        >`
			SELECT provider__jwt_secret, provider__session_duration_ms
			FROM auth.auth_providers 
			WHERE provider__name = 'anon'
		`;
        expect(anonAuthProviderConfig.provider__jwt_secret).toBeDefined();
        expect(
            anonAuthProviderConfig.provider__session_duration_ms,
        ).toBeDefined();

        // Create test admin account
        const [adminAgentAccount] = await superUserSql`
			INSERT INTO auth.agent_profiles (profile__username, auth__email, auth__is_admin)
			VALUES (${adminAgentUsername}::text, 'test_admin@test.com', true)
			RETURNING general__agent_profile_id
		`;
        expect(adminAgentAccount.general__agent_profile_id).toBeDefined();
        const adminAgentId = adminAgentAccount.general__agent_profile_id;

        // Create test regular agent account
        const [regularAgentAccount] = await superUserSql`
			INSERT INTO auth.agent_profiles (profile__username, auth__email)
			VALUES (${regularAgentUsername}::text, 'test_agent@test.com')
			RETURNING general__agent_profile_id
	  `;
        expect(regularAgentAccount.general__agent_profile_id).toBeDefined();
        const regularAgentId = regularAgentAccount.general__agent_profile_id;

        // Create test anon agent account
        const [anonAgentAccount] = await superUserSql`
			INSERT INTO auth.agent_profiles (profile__username, auth__email, auth__is_anon)
			VALUES (${anonAgentUsername}::text, 'test_anon@test.com', true)
			RETURNING general__agent_profile_id
		`;
        expect(anonAgentAccount.general__agent_profile_id).toBeDefined();
        const anonAgentId = anonAgentAccount.general__agent_profile_id;

        // Create sessions
        const [adminAgentSession] = await superUserSql`
			INSERT INTO auth.agent_sessions (
				auth__agent_id,
				auth__provider_name,
				session__expires_at
			)
			VALUES (
				${adminAgentId},
				'system',
				(NOW() + (${systemAuthProviderConfig.provider__session_duration_ms} || ' milliseconds')::INTERVAL)
			)
			RETURNING *
		`;
        expect(adminAgentSession.general__session_id).toBeDefined();
        expect(adminAgentSession.session__expires_at).toBeDefined();
        expect(adminAgentSession.session__jwt).toBeDefined();
        const adminAgentSessionId = adminAgentSession.general__session_id;

        const [regularAgentSession] = await superUserSql`
			INSERT INTO auth.agent_sessions (
				auth__agent_id,
				auth__provider_name,
				session__expires_at
			)
			VALUES (
				${regularAgentId},
				'system',
				(NOW() + (${systemAuthProviderConfig.provider__session_duration_ms} || ' milliseconds')::INTERVAL)
			)
			RETURNING *
		`;
        expect(regularAgentSession.general__session_id).toBeDefined();
        expect(regularAgentSession.session__expires_at).toBeDefined();
        expect(regularAgentSession.session__jwt).toBeDefined();
        const regularAgentSessionId = regularAgentSession.general__session_id;

        const [anonAgentSession] = await superUserSql`
			INSERT INTO auth.agent_sessions (
				auth__agent_id,
				auth__provider_name,
				session__expires_at
			)
			VALUES (
				${anonAgentId},
				'anon',
				(NOW() + (${anonAuthProviderConfig.provider__session_duration_ms} || ' milliseconds')::INTERVAL)
			)
			RETURNING *
		`;
        expect(anonAgentSession.general__session_id).toBeDefined();
        expect(anonAgentSession.session__expires_at).toBeDefined();
        expect(anonAgentSession.session__jwt).toBeDefined();
        const anonSessionId = anonAgentSession.general__session_id;

        // Generate JWT tokens using the new provider config structure
        const adminAgentToken = sign(
            {
                sessionId: adminAgentSessionId,
                agentId: adminAgentId,
            },
            systemAuthProviderConfig.provider__jwt_secret,
            {
                expiresIn:
                    systemAuthProviderConfig.provider__session_duration_ms,
            },
        );

        const regularAgentToken = sign(
            {
                sessionId: regularAgentSessionId,
                agentId: regularAgentId,
            },
            systemAuthProviderConfig.provider__jwt_secret,
            {
                expiresIn:
                    systemAuthProviderConfig.provider__session_duration_ms,
            },
        );

        const anonAgentToken = sign(
            {
                sessionId: anonSessionId,
                agentId: anonAgentId,
            },
            anonAuthProviderConfig.provider__jwt_secret,
            {
                expiresIn: anonAuthProviderConfig.provider__session_duration_ms,
            },
        );

        // Update sessions with JWT tokens
        await superUserSql`
			UPDATE auth.agent_sessions 
			SET session__jwt = ${adminAgentToken}
			WHERE general__session_id = ${adminAgentSessionId}
		`;

        await superUserSql`
			UPDATE auth.agent_sessions 
			SET session__jwt = ${regularAgentToken}
			WHERE general__session_id = ${regularAgentSessionId}
		`;

        await superUserSql`
			UPDATE auth.agent_sessions 
			SET session__jwt = ${anonAgentToken}
			WHERE general__session_id = ${anonSessionId}
		`;

        adminAgent = {
            id: adminAgentId,
            token: adminAgentToken,
            sessionId: adminAgentSessionId,
        };
        regularAgent = {
            id: regularAgentId,
            token: regularAgentToken,
            sessionId: regularAgentSessionId,
        };
        anonAgent = {
            id: anonAgentId,
            token: anonAgentToken,
            sessionId: anonSessionId,
        };

        // Verify admin account using tx
        const [adminProfile] = await tx<[Auth.I_Profile]>`
			SELECT * FROM auth.agent_profiles
			WHERE general__agent_profile_id = ${adminAgent.id}
		`;
        expect(adminProfile.profile__username).toBe(adminAgentUsername);
        expect(adminProfile.auth__is_admin).toBe(true);

        // Verify regular account using tx
        const [regularProfile] = await tx<[Auth.I_Profile]>`
			SELECT * FROM auth.agent_profiles
			WHERE general__agent_profile_id = ${regularAgent.id}
		`;
        expect(regularProfile.profile__username).toBe(regularAgentUsername);
        expect(regularProfile.auth__is_admin).toBe(false);

        // Verify anon account using tx
        const [anonProfile] = await tx<[Auth.I_Profile]>`
			SELECT * FROM auth.agent_profiles
			WHERE general__agent_profile_id = ${anonAgent.id}
		`;
        expect(anonProfile.profile__username).toBe(anonAgentUsername);
        expect(anonProfile.auth__is_admin).toBe(false);
    });
}

async function cleanupTestAccounts(): Promise<void> {
    await superUserSql.begin(async (tx) => {
        try {
            const usernames = [
                anonAgentUsername,
                regularAgentUsername,
                adminAgentUsername,
            ];
            await tx`
				DELETE FROM auth.agent_profiles 
				WHERE profile__username = ANY(${usernames}::text[])
			`;
            const remainingProfiles = await tx<Auth.I_Profile[]>`
				SELECT * FROM auth.agent_profiles
				WHERE profile__username = ANY(${usernames}::text[])
			`;
            expect(remainingProfiles).toHaveLength(0);
        } catch (error) {
            log({
                message: "Failed to cleanup test accounts",
                type: "error",
                error,
            });
            throw error;
        }
    });
}

describe("DB", () => {
    beforeAll(async () => {
        await initContainers();
        await initTestConnections();
        await cleanupTestAccounts();
        await initTestAccounts();
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
                        WHERE general__sync_group = ${syncGroupToTest}
                        ORDER BY general__sync_group
                    `;
                    expect(syncGroups[0].general__sync_group).toBe(
                        syncGroupToTest,
                    );
                });
            });
            test("should manage sync group roles correctly", async () => {
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
                            ${syncGroupToTest},
                            true,
                            true,
                            true,
                            false
                        )
                    `;
                    const [checkAddedRole] = await tx`
                        SELECT * FROM auth.agent_sync_group_roles
                        WHERE auth__agent_id = ${regularAgent.id}
                    `;
                    expect(checkAddedRole.group__sync).toBe(syncGroupToTest);
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
                    AND group__sync = ${syncGroupToTest}
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
                        WHERE group__sync = ${syncGroupToTest};
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
                            ${"Test Entity"},
                            ${tx.json(entityData)},
                            ${"public.NORMAL"}
                        ) RETURNING *
                    `;
                    expect(entity.general__entity_name).toBe("Test Entity");
                    expect(entity.group__sync).toBe("public.NORMAL");
                    const metaData =
                        typeof entity.meta__data === "string"
                            ? JSON.parse(entity.meta__data)
                            : entity.meta__data;
                    expect(metaData).toMatchObject(entityData);
                    await tx`DELETE FROM entity.entities WHERE general__entity_id = ${entity.general__entity_id}`;
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
                            ${"Test Entity"},
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
                            general__entity_name = ${"Updated Entity"},
                            meta__data = ${tx.json({
                                script1: { status: "ready" },
                                script2: { counter: 1 },
                            })}
                        WHERE general__entity_id = ${entity.general__entity_id}
                    `;
                    const [updated] = await tx<[Entity.I_Entity]>`
                        SELECT * FROM entity.entities
                        WHERE general__entity_id = ${entity.general__entity_id}
                    `;
                    expect(updated.general__entity_name).toBe("Updated Entity");
                    expect(updated.meta__data).toMatchObject({
                        script1: { status: "ready" },
                        script2: { counter: 1 },
                    });
                    await tx`DELETE FROM entity.entities WHERE general__entity_id = ${entity.general__entity_id}`;
                });
            });
        });
        describe("Entity Scripts Operations", () => {
            test("should create a script and associate it with an entity", async () => {
                await proxyUserSql.begin(async (tx) => {
                    await tx`SELECT auth.set_agent_context_from_agent_id(${adminAgent.id}::uuid)`;
                    const [script] = await tx<[Entity.Script.I_Script]>`
        			INSERT INTO entity.entity_scripts (
        				compiled__browser__script,
        				compiled__browser__status,
        				group__sync
        			) VALUES (
        				${'console.log("test")'},
        				${Entity.Script.E_CompilationStatus.COMPILED},
        				${syncGroupToTest}
        			) RETURNING *
        		`;
                    const scriptNamespace = `script_${script.general__script_id}`;
                    const [entity] = await tx<[Entity.I_Entity]>`
        			INSERT INTO entity.entities (
        				general__entity_name,
        				scripts__ids,
        				meta__data,
        				group__sync
        			) VALUES (
        				${"Scripted Entity"},
        				ARRAY[${script.general__script_id}]::UUID[],
        				${tx.json({
                            [scriptNamespace]: {
                                initialized: true,
                                lastRun: new Date().toISOString(),
                            },
                        })},
        				${"public.NORMAL"}
        			) RETURNING *
        		`;
                    expect(entity.scripts__ids).toContain(
                        script.general__script_id,
                    );
                    expect(entity.meta__data[scriptNamespace]).toMatchObject({
                        initialized: true,
                    });
                    await tx`DELETE FROM entity.entities WHERE general__entity_id = ${entity.general__entity_id}`;
                    await tx`DELETE FROM entity.entity_scripts WHERE general__script_id = ${script.general__script_id}`;
                });
            });
        });
        describe("Entity Assets Operations", () => {
            test("should create an asset and verify its metadata", async () => {
                await proxyUserSql.begin(async (tx) => {
                    await tx`SELECT auth.set_agent_context_from_agent_id(${adminAgent.id}::uuid)`;
                    // Creating an asset that mirrors the world_1_ENTITY_ASSET.sql structure.
                    const assetData = {
                        extra: "data",
                        info: { version: 1 },
                    };
                    const [asset] = await tx<[Entity.Asset.I_Asset]>`
        			INSERT INTO entity.entity_assets (
        				general__asset_name,
        				asset__data,
        				meta__data,
        				group__sync
        			) VALUES (
        				${"Test Asset"},
        				${Buffer.from("sample asset binary data")},
        				${tx.json(assetData)},
        				${"public.NORMAL"}
        			) RETURNING *
        		`;
                    expect(asset.general__asset_name).toBe("Test Asset");
                    expect(asset.meta__data).toMatchObject(assetData);
                    await tx`DELETE FROM entity.entity_assets WHERE general__asset_id = ${asset.general__asset_id}`;
                });
            });
        });
        describe("Relations Operations", () => {
            test("should create an entity with related asset and script, then delete the entity", async () => {
                await proxyUserSql.begin(async (tx) => {
                    await tx`SELECT auth.set_agent_context_from_agent_id(${adminAgent.id}::uuid)`;
                    // Insert an asset record.
                    const [asset] = await tx`
                        INSERT INTO entity.entity_assets (
                            general__asset_name,
                            group__sync,
                            meta__data,
                            asset__data
                        ) VALUES (
                            ${"Test Asset"},
                            ${"public.NORMAL"},
                            ${tx.json({ type: "texture", description: "Test asset" })},
                            decode('deadbeef', 'hex')
                        ) RETURNING *
                    `;
                    // Insert a script record.
                    const [script] = await tx`
                        INSERT INTO entity.entity_scripts (
                            general__script_name,
                            group__sync,
                            source__repo__entry_path,
                            source__repo__url
                        ) VALUES (
                            ${"Test Script"},
                            ${"public.NORMAL"},
                            ${"path/to/script"},
                            ${"https://github.com/example/repo"}
                        ) RETURNING *
                    `;
                    // Insert an entity that references the created script (and asset via metadata).
                    const [entity] = await tx`
                        INSERT INTO entity.entities (
                            general__entity_name,
                            assets__ids,
                            scripts__ids,
                            group__sync
                        ) VALUES (
                            ${"Entity with asset and script"},
                            ${[asset.general__asset_id]},
                            ${[script.general__script_id]},
                            ${"public.NORMAL"}
                        ) RETURNING *
                    `;
                    // Validate the entity data.
                    expect(entity.general__entity_name).toBe(
                        "Entity with asset and script",
                    );
                    expect(entity.assets__ids).toContain(
                        asset.general__asset_id,
                    );
                    expect(entity.scripts__ids).toContain(
                        script.general__script_id,
                    );
                    // Delete the entity record after all checks.
                    await tx`DELETE FROM entity.entities WHERE general__entity_id = ${entity.general__entity_id}`;
                    // Optionally clean up asset and script records.
                    await tx`DELETE FROM entity.entity_assets WHERE general__asset_id = ${asset.general__asset_id}`;
                    await tx`DELETE FROM entity.entity_scripts WHERE general__script_id = ${script.general__script_id}`;
                });
            });
            test("should remove asset id from entity when corresponding asset is deleted", async () => {
                await proxyUserSql.begin(async (tx) => {
                    await tx`SELECT auth.set_agent_context_from_agent_id(${adminAgent.id}::uuid)`;

                    // Insert an asset record.
                    const [asset] = await tx`
        			INSERT INTO entity.entity_assets (
        				general__asset_name,
        				group__sync,
        				meta__data,
        				asset__data
        			) VALUES (
        				${"Asset to delete"},
        				${"public.NORMAL"},
        				${tx.json({ type: "texture", description: "Asset for deletion" })},
        				decode('deadbeef', 'hex')
        			) RETURNING *
        		`;
                    // Insert an entity referencing the asset.
                    const [entity] = await tx`
        			INSERT INTO entity.entities (
        				general__entity_name,
        				assets__ids,
        				group__sync
        			) VALUES (
        				${"Entity with asset"},
        				${[asset.general__asset_id]},
        				${"public.NORMAL"}
        			) RETURNING *
        		`;
                    // Delete the asset.
                    await tx`DELETE FROM entity.entity_assets WHERE general__asset_id = ${asset.general__asset_id}`;
                    // Re-read the entity to ensure the asset id is removed.
                    const [updatedEntity] = await tx`
        			SELECT * FROM entity.entities WHERE general__entity_id = ${entity.general__entity_id}
        		`;
                    expect(updatedEntity.assets__ids).not.toContain(
                        asset.general__asset_id,
                    );
                    // Clean up
                    await tx`DELETE FROM entity.entities WHERE general__entity_id = ${entity.general__entity_id}`;
                });
            });
            test("should remove script id from entity when corresponding script is deleted", async () => {
                await proxyUserSql.begin(async (tx) => {
                    await tx`SELECT auth.set_agent_context_from_agent_id(${adminAgent.id}::uuid)`;

                    // Insert a script record.
                    const [script] = await tx`
        			INSERT INTO entity.entity_scripts (
        				general__script_name,
        				group__sync,
        				source__repo__entry_path,
        				source__repo__url,
        				compiled__node__status,
        				compiled__bun__status,
        				compiled__browser__status
        			) VALUES (
        				${"Script to delete"},
        				${"public.NORMAL"},
        				${"path/to/script"},
        				${"https://github.com/example/repo"},
        				${"COMPILED"},
        				${"COMPILED"},
        				${"COMPILED"}
        			) RETURNING *
        		`;
                    // Insert an entity referencing the script.
                    const [entity] = await tx`
        			INSERT INTO entity.entities (
        				general__entity_name,
        				scripts__ids,
        				group__sync
        			) VALUES (
        				${"Entity with script"},
        				${[script.general__script_id]},
        				${"public.NORMAL"}
        			) RETURNING *
        		`;
                    // Delete the script.
                    await tx`DELETE FROM entity.entity_scripts WHERE general__script_id = ${script.general__script_id}`;
                    // Re-read the entity to ensure the script id is removed.
                    const [updatedEntity] = await tx`
        			SELECT * FROM entity.entities WHERE general__entity_id = ${entity.general__entity_id}
        		`;
                    expect(updatedEntity.scripts__ids).not.toContain(
                        script.general__script_id,
                    );
                    // Clean up
                    await tx`DELETE FROM entity.entities WHERE general__entity_id = ${entity.general__entity_id}`;
                });
            });
            test("should propagate script status changes to update entity scripts__status", async () => {
                await proxyUserSql.begin(async (tx) => {
                    await tx`SELECT auth.set_agent_context_from_agent_id(${adminAgent.id}::uuid)`;

                    // Insert a script record with compiled statuses
                    const [script] = await tx`
        			INSERT INTO entity.entity_scripts (
        				general__script_name,
        				group__sync,
        				source__repo__entry_path,
        				source__repo__url,
        				compiled__node__status,
        				compiled__bun__status,
        				compiled__browser__status
        			) VALUES (
        				${"Script for status propagation"},
        				${"public.NORMAL"},
        				${"path/to/script"},
        				${"https://github.com/example/repo"},
        				${"COMPILED"},
        				${"COMPILED"},
        				${"COMPILED"}
        			) RETURNING *
        		`;
                    // Insert an entity referencing the script.
                    const [entity] = await tx`
        			INSERT INTO entity.entities (
        				general__entity_name,
        				scripts__ids,
        				scripts__status,
        				group__sync
        			) VALUES (
        				${"Entity for script status propagation"},
        				${[script.general__script_id]},
        				${"ACTIVE"},
        				${"public.NORMAL"}
        			) RETURNING *
        		`;
                    // Update the script to a pending status (simulate a status change).
                    await tx`
        			UPDATE entity.entity_scripts
        			SET compiled__node__status = ${"PENDING"}
        			WHERE general__script_id = ${script.general__script_id}
        		`;
                    // The trigger on entity.entity_scripts should update affected entities.
                    // Re-read the entity to check the updated status.
                    const [updatedEntity] = await tx`
        			SELECT * FROM entity.entities WHERE general__entity_id = ${entity.general__entity_id}
        		`;
                    // Expect the entity's scripts__status to be updated to 'AWAITING_SCRIPTS'
                    expect(updatedEntity.scripts__status).toBe(
                        "AWAITING_SCRIPTS",
                    );
                    // Clean up
                    await tx`DELETE FROM entity.entities WHERE general__entity_id = ${entity.general__entity_id}`;
                    await tx`DELETE FROM entity.entity_scripts WHERE general__script_id = ${script.general__script_id}`;
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
                    SELECT * FROM tick.capture_tick_state(${syncGroupToTest})
                `;
                    expect(tickRecord1).toBeTruthy();
                    expect(tickRecord1.group__sync).toBe(syncGroupToTest);
                    expect(
                        Number(tickRecord1.tick__entity_states_processed),
                    ).toBeGreaterThanOrEqual(0);
                    expect(
                        Number(tickRecord1.tick__script_states_processed),
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
                    SELECT * FROM tick.capture_tick_state(${syncGroupToTest})
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

            describe("Script Operations", () => {
                test("should create multiple test scripts and capture their tick states", async () => {
                    await superUserSql.begin(async (tx) => {
                        // Create two test script records
                        const [script1] = await tx<
                            [{ general__script_id: string }]
                        >`
                    INSERT INTO entity.entity_scripts (
                        general__script_name,
                        group__sync
                    ) VALUES (
                        ${"Test Script 1"},
                        ${syncGroupToTest}
                    ) RETURNING general__script_id
                `;
                        const [script2] = await tx<
                            [{ general__script_id: string }]
                        >`
                    INSERT INTO entity.entity_scripts (
                        general__script_name,
                        group__sync
                    ) VALUES (
                        ${"Test Script 2"},
                        ${syncGroupToTest}
                    ) RETURNING general__script_id
                `;

                        // Track created scripts for cleanup
                        createdScriptIds.push(
                            script1.general__script_id,
                            script2.general__script_id,
                        );

                        // Capture a tick so that the scripts are processed
                        await tx`SELECT * FROM tick.capture_tick_state(${syncGroupToTest})`;

                        // Retrieve all script states at latest tick and verify the scripts are present
                        const scripts = await tx<
                            Array<{
                                general__script_id: string;
                                general__script_name: string;
                                group__sync: string;
                            }>
                        >`
                    SELECT * FROM entity.entity_scripts WHERE group__sync = ${syncGroupToTest}
                `;

                        const retrievedIds = scripts.map(
                            (s) => s.general__script_id,
                        );
                        expect(retrievedIds).toContain(
                            script1.general__script_id,
                        );
                        expect(retrievedIds).toContain(
                            script2.general__script_id,
                        );
                    });
                });
                test("should detect script changes between ticks and only include changed fields", async () => {
                    // First transaction - create initial script and capture first tick
                    let script1: Entity.Script.I_Script;
                    let tick1: any;

                    await superUserSql.begin(async (tx) => {
                        // Create initial script
                        [script1] = await tx<[Entity.Script.I_Script]>`
                            INSERT INTO entity.entity_scripts (
                                general__script_name,
                                compiled__browser__script,
                                compiled__browser__status,
                                source__repo__url,
                                group__sync
                            ) VALUES (
                                ${"Original Script"},
                                ${'console.log("initial version")'},
                                ${"COMPILED"},
                                ${"https://original-repo.git"},
                                ${syncGroupToTest}
                            ) RETURNING *
                        `;

                        // Track for cleanup
                        createdScriptIds.push(script1.general__script_id);
                    });

                    // Force a small delay to ensure timestamps are different
                    await new Promise((resolve) => setTimeout(resolve, 10));

                    // Capture first tick in separate transaction
                    await superUserSql.begin(async (tx) => {
                        [tick1] =
                            await tx`SELECT * FROM tick.capture_tick_state(${syncGroupToTest})`;
                        console.log(
                            "First tick captured:",
                            tick1.general__tick_id,
                            tick1.tick__start_time,
                        );
                    });

                    // Force another small delay
                    await new Promise((resolve) => setTimeout(resolve, 10));

                    // Update the script in a separate transaction
                    await superUserSql.begin(async (tx) => {
                        // Update script - only change name and status but not repo URL
                        await tx`
                            UPDATE entity.entity_scripts
                            SET 
                                general__script_name = ${"Updated Script"},
                                compiled__browser__script = ${'console.log("updated version")'},
                                compiled__browser__status = ${"PENDING"}
                            WHERE general__script_id = ${script1.general__script_id}
                        `;
                    });

                    // Force another small delay
                    await new Promise((resolve) => setTimeout(resolve, 10));

                    // Capture second tick in separate transaction
                    let tick2: any;
                    await superUserSql.begin(async (tx) => {
                        [tick2] =
                            await tx`SELECT * FROM tick.capture_tick_state(${syncGroupToTest})`;
                        console.log(
                            "Second tick captured:",
                            tick2.general__tick_id,
                            tick2.tick__start_time,
                        );
                    });

                    // Verify changes in separate transaction
                    await superUserSql.begin(async (tx) => {
                        // Retrieve script changes between ticks and verify
                        const scriptChanges = await tx<
                            Array<{
                                general__script_id: string;
                                operation: string;
                                changes: any;
                            }>
                        >`
                            SELECT * FROM tick.get_changed_script_states_between_latest_ticks(${syncGroupToTest})
                        `;
                        console.log("Script changes detected:", scriptChanges);

                        // Find our script in the changes
                        const scriptChange = scriptChanges.find(
                            (c) =>
                                c.general__script_id ===
                                script1.general__script_id,
                        );

                        expect(scriptChange).toBeDefined();
                        expect(scriptChange?.operation).toBe("UPDATE");

                        // Check that only changed fields are included
                        expect(scriptChange?.changes.general__script_name).toBe(
                            "Updated Script",
                        );
                        expect(
                            scriptChange?.changes.compiled__browser__status,
                        ).toBe("PENDING");

                        // The URL field wasn't changed, so it shouldn't be included
                        expect(
                            scriptChange?.changes.source__repo__url,
                        ).toBeUndefined();
                    });
                });
            });

            describe("Asset Operations", () => {
                test("should create multiple test assets and capture their tick states", async () => {
                    await superUserSql.begin(async (tx) => {
                        // Create two test asset records
                        const [asset1] = await tx<
                            [{ general__asset_id: string }]
                        >`
                    INSERT INTO entity.entity_assets (
                        general__asset_name,
                        group__sync,
                        asset__data,
                        meta__data
                    ) VALUES (
                        ${"Test Asset 1"},
                        ${syncGroupToTest},
                        ${Buffer.from("asset data 1")},
                        ${tx.json({ info: "asset 1 meta" })}
                    ) RETURNING general__asset_id
                `;
                        const [asset2] = await tx<
                            [{ general__asset_id: string }]
                        >`
                    INSERT INTO entity.entity_assets (
                        general__asset_name,
                        group__sync,
                        asset__data,
                        meta__data
                    ) VALUES (
                        ${"Test Asset 2"},
                        ${syncGroupToTest},
                        ${Buffer.from("asset data 2")},
                        ${tx.json({ info: "asset 2 meta" })}
                    ) RETURNING general__asset_id
                `;

                        // Track created assets for cleanup
                        createdAssetIds.push(
                            asset1.general__asset_id,
                            asset2.general__asset_id,
                        );

                        // Capture a tick so that the asset changes are processed
                        await tx`SELECT * FROM tick.capture_tick_state(${syncGroupToTest})`;

                        // Retrieve all assets and verify they are present
                        const assets = await tx<
                            Array<{
                                general__asset_id: string;
                                group__sync: string;
                                general__asset_name: string;
                            }>
                        >`
                    SELECT * FROM entity.entity_assets WHERE group__sync = ${syncGroupToTest}
                `;

                        const retrievedAssetIds = assets.map(
                            (a) => a.general__asset_id,
                        );
                        expect(retrievedAssetIds).toContain(
                            asset1.general__asset_id,
                        );
                        expect(retrievedAssetIds).toContain(
                            asset2.general__asset_id,
                        );
                    });
                });
            });

            describe("Entity Operations", () => {
                test("should create multiple test entities and capture their tick states", async () => {
                    await superUserSql.begin(async (tx) => {
                        const entityNames = [
                            "Entity One",
                            "Entity Two",
                            "Entity Three",
                        ];
                        const createdEntities = [];

                        for (const name of entityNames) {
                            const [entity] = await tx<[Entity.I_Entity]>`
                        INSERT INTO entity.entities (
                            general__entity_name,
                            meta__data,
                            group__sync,
                            scripts__ids,
                            scripts__status,
                            assets__ids
                        ) VALUES (
                            ${name},
                            ${tx.json({
                                [scriptNamespace]: {
                                    position: {
                                        x: 0,
                                        y: 0,
                                        z: 0,
                                    },
                                },
                            })},
                            ${syncGroupToTest},
                            ${tx.array([])},
                            ${"ACTIVE"},
                            ${tx.array([])}
                        ) RETURNING *
                    `;
                            createdEntities.push(entity);
                            createdEntityIds.push(entity.general__entity_id);
                        }

                        // Capture tick state
                        const [tickRecord] = await tx<[Tick.I_Tick]>`
                    SELECT * FROM tick.capture_tick_state(${syncGroupToTest})
                `;

                        // Verify entities exist
                        const states = await tx<
                            Array<{ general__entity_id: string }>
                        >`
                    SELECT general__entity_id
                    FROM entity.entities
                    WHERE group__sync = ${syncGroupToTest}
                `;

                        const stateIds = states.map(
                            (s) => s.general__entity_id,
                        );
                        for (const entity of createdEntities) {
                            expect(stateIds).toContain(
                                entity.general__entity_id,
                            );
                        }
                    });
                });

                test("should detect entity changes between ticks for multiple entities", async () => {
                    await superUserSql.begin(async (tx) => {
                        const [entity1] = await tx<[Entity.I_Entity]>`
                    INSERT INTO entity.entities (
                        general__entity_name,
                        meta__data,
                        group__sync,
                        scripts__ids,
                        scripts__status,
                        assets__ids
                    ) VALUES (
                        ${"Original Entity 1"},
                        ${tx.json({
                            [scriptNamespace]: {
                                position: {
                                    x: 0,
                                    y: 0,
                                    z: 0,
                                },
                            },
                        })},
                        ${syncGroupToTest},
                        ${tx.array([])},
                        ${"ACTIVE"},
                        ${tx.array([])}
                    ) RETURNING *
                `;
                        const [entity2] = await tx<[Entity.I_Entity]>`
                    INSERT INTO entity.entities (
                        general__entity_name,
                        meta__data,
                        group__sync,
                        scripts__ids,
                        scripts__status,
                        assets__ids
                    ) VALUES (
                        ${"Original Entity 2"},
                        ${tx.json({ [scriptNamespace]: { position: { x: 10, y: 10, z: 10 } } })},
                        ${syncGroupToTest},
                        ${tx.array([])},
                        ${"ACTIVE"},
                        ${tx.array([])}
                    ) RETURNING *
                `;
                        // Track created entities for cleanup
                        createdEntityIds.push(
                            entity1.general__entity_id,
                            entity2.general__entity_id,
                        );

                        // Capture first tick
                        await tx`SELECT * FROM tick.capture_tick_state(${syncGroupToTest})`;

                        // Update both entities
                        await tx`
                    UPDATE entity.entities
                    SET general__entity_name = ${"Updated Entity 1"},
                        meta__data = ${tx.json({ [scriptNamespace]: { position: { x: 5, y: 5, z: 5 } } })}
                    WHERE general__entity_id = ${entity1.general__entity_id}
                `;
                        await tx`
                    UPDATE entity.entities
                    SET general__entity_name = ${"Updated Entity 2"},
                        meta__data = ${tx.json({ [scriptNamespace]: { position: { x: 15, y: 15, z: 15 } } })}
                    WHERE general__entity_id = ${entity2.general__entity_id}
                `;

                        // Capture second tick
                        await tx`SELECT * FROM tick.capture_tick_state(${syncGroupToTest})`;

                        // Retrieve changed entity states between latest ticks and verify
                        const changes = await tx<Array<Tick.I_EntityUpdate>>`
                    SELECT * FROM tick.get_changed_entity_states_between_latest_ticks(${syncGroupToTest})
                `;
                        const changeIds = changes.map(
                            (c) => c.general__entity_id,
                        );
                        expect(changeIds).toEqual(
                            expect.arrayContaining([
                                entity1.general__entity_id,
                                entity2.general__entity_id,
                            ]),
                        );

                        // Verify updated details for one of the entities
                        const updatedChange = changes.find(
                            (c) =>
                                c.general__entity_id ===
                                entity1.general__entity_id,
                        );
                        expect(updatedChange).toBeTruthy();
                        expect(updatedChange?.operation).toBe("UPDATE");
                        expect(
                            updatedChange?.changes.general__entity_name,
                        ).toBe("Updated Entity 1");
                    });
                });
            });
        });
    });

    afterAll(async () => {
        await cleanupTestAccounts();
        await cleanupTestConnections();
    });
});
