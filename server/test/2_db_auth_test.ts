import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import type postgres from "postgres";
import { log } from "../../sdk/vircadia-world-sdk-ts/module/general/log";
import { PostgresClient } from "../database/postgres/postgres_client";
import type { Auth } from "../../sdk/vircadia-world-sdk-ts/schema/schema.general";
import { sign } from "jsonwebtoken";
import { VircadiaConfig } from "../../sdk/vircadia-world-sdk-ts/config/vircadia.config";
import { isHealthy, up } from "../container/docker/docker_cli";
import { randomUUIDv7 } from "bun";

interface TestAccount {
    id: string;
    token: string;
    sessionId: string;
}

describe("DB -> Auth Tests", () => {
    let superUserSql: postgres.Sql;
    let proxyUserSql: postgres.Sql;
    let adminAgent: TestAccount;
    let regularAgent: TestAccount;
    let anonAgent: TestAccount;

    const adminAgentUsername = "test_admin";
    const regularAgentUsername = "test_agent";
    const anonAgentUsername = "test_anon";

    // Setup before all tests
    beforeAll(async () => {
        if (!(await isHealthy()).isHealthy) {
            await up();

            const healthyAfterUp = await isHealthy();
            if (!healthyAfterUp.isHealthy) {
                throw new Error("Failed to start services");
            }
        }
        // Initialize database connection using PostgresClient

        superUserSql = await PostgresClient.getInstance().getSuperClient();
        proxyUserSql = await PostgresClient.getInstance().getProxyClient();
    });

    async function cleanup(): Promise<void> {
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

    async function createTestAccounts(): Promise<{
        adminAgent: TestAccount;
        regularAgent: TestAccount;
        anonAgent: TestAccount;
    }> {
        try {
            await cleanup();

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

            if (
                !systemAuthProviderConfig.provider__jwt_secret ||
                !systemAuthProviderConfig.provider__session_duration_ms ||
                !anonAuthProviderConfig.provider__jwt_secret ||
                !anonAuthProviderConfig.provider__session_duration_ms
            ) {
                throw new Error("Auth provider settings not found in database");
            }

            // Create test admin account
            const [adminAgentAccount] = await superUserSql`
                INSERT INTO auth.agent_profiles (profile__username, auth__email, auth__is_admin)
                VALUES (${adminAgentUsername}::text, 'test_admin@test.com', true)
                RETURNING general__agent_profile_id
            `;
            const adminAgentId = adminAgentAccount.general__agent_profile_id;

            // Create test regular agent account
            const [regularAgentAccount] = await superUserSql`
                INSERT INTO auth.agent_profiles (profile__username, auth__email)
                VALUES (${regularAgentUsername}::text, 'test_agent@test.com')
                RETURNING general__agent_profile_id
            `;
            const regularAgentId =
                regularAgentAccount.general__agent_profile_id;

            // Create test anon agent account
            const [anonAgentAccount] = await superUserSql`
                INSERT INTO auth.agent_profiles (profile__username, auth__email)
                VALUES (${anonAgentUsername}::text, 'test_anon@test.com')
                RETURNING general__agent_profile_id
            `;
            const anonAgentId = anonAgentAccount.general__agent_profile_id;

            // Create sessions
            const [adminAgentSession] = await superUserSql`
                SELECT * FROM auth.create_agent_session(${adminAgentId}, 'system')
            `;
            const adminAgentSessionId = adminAgentSession.general__session_id;

            const [regularAgentSession] = await superUserSql`
                SELECT * FROM auth.create_agent_session(${regularAgentId}, 'system')
            `;
            const regularAgentSessionId =
                regularAgentSession.general__session_id;

            const [anonAgentSession] = await superUserSql`
                SELECT * FROM auth.create_agent_session(${anonAgentId}, 'anon')
            `;
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
                    expiresIn:
                        anonAuthProviderConfig.provider__session_duration_ms,
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

            return {
                adminAgent: {
                    id: adminAgentId,
                    token: adminAgentToken,
                    sessionId: adminAgentSessionId,
                },
                regularAgent: {
                    id: regularAgentId,
                    token: regularAgentToken,
                    sessionId: regularAgentSessionId,
                },
                anonAgent: {
                    id: anonAgentId,
                    token: anonAgentToken,
                    sessionId: anonSessionId,
                },
            };
        } catch (error) {
            log({
                message: "Failed to create test accounts",
                type: "error",
                error,
            });
            throw error;
        }
    }

    describe("Internal Role Management", () => {
        test("Superuser SQL connection works", async () => {
            const [result] = await superUserSql`SELECT current_database()`;
            expect(result.current_database).toBeDefined();

            // Check if superuser can access function directly
            const [isSystemAgent] = await superUserSql`
                SELECT has_function_privilege(
                    'vircadia_agent_proxy', 
                    'auth.is_system_agent()', 
                    'EXECUTE'
                ) as has_execute_permission
            `;
            expect(isSystemAgent.has_execute_permission).toBe(true);

            // Verify superuser status
            const [isSuperUser] =
                await superUserSql`SELECT auth.is_system_agent()`;
            expect(isSuperUser.is_system_agent).toBe(true);
        });

        test("Proxy user SQL connection works", async () => {
            const [result] = await proxyUserSql`SELECT current_database()`;
            expect(result.current_database).toBeDefined();

            // First verify we can call function through proxy user
            const [isSystemAgent] = await proxyUserSql`
                SELECT auth.is_system_agent() as is_system_agent
            `;
            expect(isSystemAgent.is_system_agent).toBe(false);

            // Verify proxy agent status
            const [isProxyAgent] =
                await proxyUserSql`SELECT auth.is_proxy_agent()`;
            expect(isProxyAgent.is_proxy_agent).toBe(true);
        });
    });

    // describe("Account Management", () => {
    //     test("should create and verify test accounts", async () => {
    //         await superUserSql.begin(async (tx) => {
    //             // Use the transaction tx for all queries in this test
    //             const accounts = await createTestAccounts();
    //             adminAgent = accounts.adminAgent;
    //             regularAgent = accounts.regularAgent;
    //             anonAgent = accounts.anonAgent;

    //             // Verify admin account using tx
    //             const [adminProfile] = await tx<[Auth.I_Profile]>`
    //                 SELECT * FROM auth.agent_profiles
    //                 WHERE general__agent_profile_id = ${adminAgent.id}
    //             `;
    //             expect(adminProfile.profile__username).toBe(adminAgentUsername);
    //             expect(adminProfile.auth__is_admin).toBe(true);

    //             // Verify regular account using tx
    //             const [regularProfile] = await tx<[Auth.I_Profile]>`
    //                 SELECT * FROM auth.agent_profiles
    //                 WHERE general__agent_profile_id = ${regularAgent.id}
    //             `;
    //             expect(regularProfile.profile__username).toBe(
    //                 regularAgentUsername,
    //             );
    //             expect(regularProfile.auth__is_admin).toBe(false);

    //             // Verify anon account using tx
    //             const [anonProfile] = await tx<[Auth.I_Profile]>`
    //                 SELECT * FROM auth.agent_profiles
    //                 WHERE general__agent_profile_id = ${anonAgent.id}
    //             `;
    //             expect(anonProfile.profile__username).toBe(anonAgentUsername);
    //             expect(anonProfile.auth__is_admin).toBe(false);
    //         });
    //     });
    // });

    // describe("Permission Management", () => {
    //     test("should verify admin agent permissions", async () => {
    //         await proxyUserSql.begin(async (tx) => {
    //             await tx`SELECT auth.set_agent_context(${adminAgent.id}::uuid)`; // Set to admin context

    //             const [isAdmin] =
    //                 await tx`SELECT auth.is_admin_agent() as is_admin`;
    //             expect(isAdmin.is_admin).toBe(true);
    //             const [isSystem] =
    //                 await tx`SELECT auth.is_system_agent() as is_system`;
    //             expect(isSystem.is_system).toBe(true);

    //             const [currentAgentId] =
    //                 await tx`SELECT auth.current_agent_id()`;
    //             expect(currentAgentId.current_agent_id).toBe(adminAgent.id);
    //         });
    //     });

    //     test("should verify system permissions", async () => {
    //         await superUserSql.begin(async (tx) => {
    //             const [isAdmin] =
    //                 await tx`SELECT auth.is_admin_agent() as is_admin`;
    //             expect(isAdmin.is_admin).toBe(false);
    //             const [isSystem] =
    //                 await tx`SELECT auth.is_system_agent() as is_system`;
    //             expect(isSystem.is_system).toBe(true);

    //             const [systemAgentId] =
    //                 await tx`SELECT auth.get_system_agent_id()`; // Get system agent id

    //             const [currentAgentId] =
    //                 await tx`SELECT auth.current_agent_id()`;
    //             expect(currentAgentId.current_agent_id).toBe(systemAgentId);
    //         });
    //     });

    //     test("should verify non-admin agent permissions", async () => {
    //         await superUserSql.begin(async (tx) => {
    //             await tx`SELECT auth.set_agent_context(${regularAgent.id}::uuid)`; // Set to agent context

    //             const [isAdmin] =
    //                 await tx`SELECT auth.is_admin_agent() as is_admin`;
    //             expect(isAdmin.is_admin).toBe(false);
    //             const [isSystem] =
    //                 await tx`SELECT auth.is_system_agent() as is_system`;
    //             expect(isSystem.is_system).toBe(false);

    //             const [agentId] = await tx`SELECT auth.current_agent_id()`; // Get current agent id
    //             expect(agentId.current_agent_id).toBe(regularAgent.id);
    //         });
    //     });

    //     test("should verify anon agent permissions", async () => {
    //         await proxyUserSql.begin(async (tx) => {
    //             await tx`SELECT auth.set_agent_context(${anonAgent.id}::uuid)`; // Set to anon context

    //             const [isAdmin] =
    //                 await tx`SELECT auth.is_admin_agent() as is_admin`;
    //             expect(isAdmin.is_admin).toBe(false);
    //             const [isSystem] =
    //                 await tx`SELECT auth.is_system_agent() as is_system`;
    //             expect(isSystem.is_system).toBe(false);

    //             const [anonId] = await tx`SELECT auth.get_anon_agent_id()`;
    //             const [currentAgentId] =
    //                 await tx`SELECT auth.current_agent_id()`; // Get current agent id
    //             expect(currentAgentId.current_agent_id).toBe(
    //                 anonId.get_anon_agent_id,
    //             );
    //         });
    //     });

    //     test("should handle set invalid agent context gracefully", async () => {
    //         await proxyUserSql.begin(async (tx) => {
    //             const [contextResult] = await tx`
    //                 SELECT auth.set_agent_context(${randomUUIDv7()}::uuid) as success
    //             `;
    //             expect(contextResult.success).toBe(false);
    //         });
    //     });
    // });

    // describe("Session Management", () => {
    //     test("should handle expired sessions correctly", async () => {
    //         await sql.begin(async (tx) => {
    //             await tx`SELECT auth.set_agent_context(${admin.id}::uuid)`; // Set to admin context

    //             const [expiredSession] = await tx`
    //                 INSERT INTO auth.agent_sessions (
    //                     auth__agent_id,
    //                     auth__provider_name,
    //                     session__expires_at,
    //                     session__is_active,
    //                     session__jwt
    //                 ) VALUES (
    //                     ${admin.id},
    //                     'test',
    //                     NOW() - INTERVAL '1 second',
    //                     true,
    //                     'test_token'
    //                 ) RETURNING general__session_id
    //             `;
    //             await tx`SELECT auth.cleanup_old_sessions()`;
    //             await tx`SELECT auth.set_agent_context(${expiredSession.general__session_id})`;
    //             const [currentAgent] = await tx`SELECT auth.current_agent_id()`;
    //             const [anonId] = await tx`SELECT auth.get_anon_agent_id()`;
    //             expect(currentAgent.current_agent_id).toBe(
    //                 anonId.get_anon_agent_id,
    //             );
    //             const [sessionStatus] = await tx`
    //                 SELECT session__is_active
    //                 FROM auth.agent_sessions
    //                 WHERE general__session_id = ${expiredSession.general__session_id}
    //             `;
    //             expect(sessionStatus.session__is_active).toBe(false);
    //         });
    //     });

    //     test("should enforce max sessions per agent", async () => {
    //         await sql.begin(async (tx) => {
    //             await tx`SELECT auth.set_agent_context(${admin.id}::uuid)`; // Set to admin context

    //             const [authConfig] = await tx<
    //                 [
    //                     {
    //                         auth_config__default_session_max_per_agent: number;
    //                     },
    //                 ]
    //             >`
    //                 SELECT auth_config__default_session_max_per_agent FROM config.auth_config
    //             `;
    //             const maxSessions =
    //                 authConfig.auth_config__default_session_max_per_agent;

    //             // Create sessions up to the limit
    //             for (let i = 0; i < maxSessions + 1; i++) {
    //                 await tx`SELECT * FROM auth.create_agent_session(${agent.id}, 'test')`;
    //             }
    //             // Verify that oldest session was invalidated
    //             const [activeSessions] = await tx<{ count: string }[]>`
    //                 SELECT COUNT(*)::TEXT as count
    //                 FROM auth.agent_sessions
    //                 WHERE auth__agent_id = ${agent.id}
    //                 AND session__is_active = true
    //             `;
    //             expect(Number.parseInt(activeSessions.count)).toBe(maxSessions);
    //         });
    //     });
    // });

    // describe("Sync Group Management", () => {
    //     test("should verify default sync groups exist", async () => {
    //         await sql.begin(async (tx) => {
    //             await tx`SELECT auth.set_agent_context(${admin.id}::uuid)`; // Set to admin context

    //             const syncGroups = await tx`
    //                 SELECT * FROM auth.sync_groups
    //                 ORDER BY general__sync_group
    //             `;
    //             expect(syncGroups).toHaveLength(8); // 4 public + 4 admin groups
    //             expect(syncGroups.map((g) => g.general__sync_group)).toContain(
    //                 "public.REALTIME",
    //             );
    //             expect(syncGroups.map((g) => g.general__sync_group)).toContain(
    //                 "admin.STATIC",
    //             );
    //         });
    //     });

    //     test("should manage sync group roles correctly", async () => {
    //         await sql.begin(async (tx) => {
    //             await tx`SELECT auth.set_agent_context(${admin.id}::uuid)`; // Set to admin context

    //             await tx`
    //                 INSERT INTO auth.agent_sync_group_roles (
    //                     auth__agent_id,
    //                     group__sync,
    //                     permissions__can_insert,
    //                     permissions__can_update,
    //                     permissions__can_delete
    //                 ) VALUES (
    //                     ${agent.id},
    //                     'public.REALTIME',
    //                     true,
    //                     true,
    //                     false
    //                 )
    //             `;
    //             const [role] = await tx`
    //                 SELECT * FROM auth.agent_sync_group_roles
    //                 WHERE auth__agent_id = ${agent.id}
    //             `;
    //             expect(role.group__sync).toBe("public.REALTIME");
    //             expect(role.permissions__can_insert).toBe(true);
    //             expect(role.permissions__can_update).toBe(true);
    //             expect(role.permissions__can_delete).toBe(false);

    //             // Set to non-admin agent context to test permissions
    //             await tx`SELECT auth.set_agent_context(${agent.sessionId})`;

    //             const [hasRead] = await tx`
    //                 SELECT auth.has_sync_group_read_access('public.REALTIME') as has_access
    //             `;
    //             const [hasInsert] = await tx`
    //                 SELECT auth.has_sync_group_insert_access('public.REALTIME') as has_access
    //             `;
    //             const [hasUpdate] = await tx`
    //                 SELECT auth.has_sync_group_update_access('public.REALTIME') as has_access
    //             `;
    //             const [hasDelete] = await tx`
    //                 SELECT auth.has_sync_group_delete_access('public.REALTIME') as has_access
    //             `;
    //             expect(hasRead.has_access).toBe(true);
    //             expect(hasInsert.has_access).toBe(true);
    //             expect(hasUpdate.has_access).toBe(true);
    //             expect(hasDelete.has_access).toBe(false);
    //         });
    //     });

    //     test("should handle active sessions view correctly", async () => {
    //         await sql.begin(async (tx) => {
    //             await tx`SELECT auth.set_agent_context(${admin.id}::uuid)`; // Set to admin context

    //             await tx`
    //                 INSERT INTO auth.agent_sync_group_roles (
    //                     auth__agent_id,
    //                     group__sync,
    //                     permissions__can_insert,
    //                     permissions__can_update,
    //                     permissions__can_delete
    //                 ) VALUES (
    //                     ${admin.id},
    //                     'admin.REALTIME',
    //                     true,
    //                     true,
    //                     true
    //                 )
    //             `;
    //             await tx`SELECT auth.refresh_active_sessions()`;
    //             const [sessions] = await tx`
    //                 SELECT active_session_ids as session_ids
    //                 FROM auth.active_sync_group_sessions
    //                 WHERE group__sync = 'admin.REALTIME'
    //             `;
    //             expect(sessions.session_ids).toContain(admin.sessionId);
    //         });
    //     });
    // });

    // describe("Session Cleanup", () => {
    //     test("should handle session invalidation", async () => {
    //         await sql.begin(async (tx) => {
    //             await tx`SELECT auth.set_agent_context(${admin.id}::uuid)`; // Set to admin context

    //             // Ensure agent session is active
    //             await tx`
    //                 UPDATE auth.agent_sessions
    //                 SET
    //                     session__is_active = true,
    //                     session__expires_at = NOW() + INTERVAL '1 hour'
    //                 WHERE general__session_id = ${agent.sessionId}
    //             `;

    //             // Verify session is active before invalidation
    //             const [initialState] = await tx`
    //                 SELECT session__is_active
    //                 FROM auth.agent_sessions
    //                 WHERE general__session_id = ${agent.sessionId}
    //             `;
    //             expect(initialState.session__is_active).toBe(true);

    //             // Invalidate session
    //             const [success] = await tx`
    //                 SELECT auth.invalidate_session(${agent.sessionId}) as success
    //             `;
    //             expect(success.success).toBe(true);

    //             // Verify session is invalid
    //             const [session] = await tx`
    //                 SELECT session__is_active
    //                 FROM auth.agent_sessions
    //                 WHERE general__session_id = ${agent.sessionId}
    //             `;
    //             expect(session.session__is_active).toBe(false);
    //         });
    //     });

    //     test("should cleanup inactive sessions", async () => {
    //         await sql.begin(async (tx) => {
    //             await tx`SELECT auth.set_agent_context(${admin.id}::uuid)`; // Set to admin context

    //             // Create an inactive session
    //             await tx`
    //                 UPDATE auth.agent_sessions
    //                 SET session__last_seen_at = NOW() - INTERVAL '1 hour'
    //                 WHERE general__session_id = ${agent.sessionId}
    //             `;

    //             const cleanedCount =
    //                 await tx`SELECT auth.cleanup_old_sessions()`;
    //             expect(cleanedCount[0].cleanup_old_sessions).toBeGreaterThan(0);
    //         });
    //     });
    // });

    describe("Test Cleanup", () => {
        test("should cleanup test accounts", async () => {
            await cleanup();
        });
    });

    afterAll(async () => {
        // Disconnect using PostgresClient
        await PostgresClient.getInstance().disconnect();
    });
});
