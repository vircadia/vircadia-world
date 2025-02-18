import {
    describe,
    test,
    expect,
    beforeAll,
    afterAll,
    beforeEach,
} from "bun:test";
import type postgres from "postgres";
import { log } from "../../sdk/vircadia-world-sdk-ts/module/general/log";
import { PostgresClient } from "../database/postgres/postgres_client";
import type {
    Config,
    Auth,
} from "../../sdk/vircadia-world-sdk-ts/schema/schema.general";
import { sign } from "jsonwebtoken";
import { VircadiaConfig_Server } from "../../sdk/vircadia-world-sdk-ts/config/vircadia.config";
import { isHealthy, up } from "../container/docker/docker_cli";
import { randomUUIDv7 } from "bun";

interface TestAccount {
    id: string;
    token: string;
    sessionId: string;
}

describe("DB -> Auth Tests", () => {
    let sql: postgres.Sql;
    let admin: TestAccount;
    let agent: TestAccount;

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
        await PostgresClient.getInstance().connect();
        sql = PostgresClient.getInstance().getClient();
    });

    beforeEach(async () => {
        if (admin) await sql`SELECT auth.set_agent_context(${admin.sessionId})`;
    });

    async function createTestAccounts(): Promise<{
        admin: TestAccount;
        agent: TestAccount;
    }> {
        try {
            // First create a system token with superuser privileges
            const [authConfig] = await sql<[Config.I_Config<"auth">]>`
                SELECT * FROM config.config 
                WHERE general__key = 'auth'
            `;

            const authSecretConfig = authConfig.general__value.jwt_secret;
            const authDurationConfigMs =
                authConfig.general__value.default_session_duration_ms;

            if (!authSecretConfig || !authDurationConfigMs) {
                throw new Error("Auth settings not found in database");
            }

            // Create system session directly in the database
            const [systemSession] = await sql`
                INSERT INTO auth.agent_sessions (
                    auth__agent_id,
                    auth__provider_name,
                    session__expires_at,
                    session__is_active
                ) VALUES (
                    auth.get_system_agent_id(),
                    'system',
                    NOW() + ${authDurationConfigMs}::interval,
                    true
                ) RETURNING general__session_id
            `;

            // Generate system token
            const systemToken = sign(
                {
                    sessionId: systemSession.general__session_id,
                    agentId: await sql`SELECT auth.get_system_agent_id()`,
                },
                authSecretConfig,
                {
                    expiresIn: authDurationConfigMs,
                },
            );

            // Update system session with JWT
            await sql`
                UPDATE auth.agent_sessions 
                SET session__jwt = ${systemToken}
                WHERE general__session_id = ${systemSession.general__session_id}
            `;

            // Set system context
            await sql`SELECT auth.set_agent_context(${systemSession.general__session_id})`;

            // Clean up any existing test accounts
            await sql`
                DELETE FROM auth.agent_profiles 
                WHERE profile__username IN ('test_admin', 'test_agent')
            `;

            // Create test admin account
            const [adminAccount] = await sql`
                INSERT INTO auth.agent_profiles (profile__username, auth__email, auth__is_admin)
                VALUES ('test_admin', 'test_admin@test.com', true)
                RETURNING general__agent_profile_id
            `;
            const adminId = adminAccount.general__agent_profile_id;

            // Create test regular agent account
            const [agentAccount] = await sql`
                INSERT INTO auth.agent_profiles (profile__username, auth__email)
                VALUES ('test_agent', 'test_agent@test.com')
                RETURNING general__agent_profile_id
            `;
            const agentId = agentAccount.general__agent_profile_id;

            // Create sessions for both accounts
            const [adminSession] = await sql`
                SELECT * FROM auth.create_agent_session(${adminId}, 'test')
            `;
            const adminSessionId = adminSession.general__session_id;

            const [agentSession] = await sql`
                SELECT * FROM auth.create_agent_session(${agentId}, 'test')
            `;
            const agentSessionId = agentSession.general__session_id;

            // Generate JWT tokens using the new config structure
            const adminToken = sign(
                {
                    sessionId: adminSessionId,
                    agentId: adminId,
                },
                authSecretConfig,
                {
                    expiresIn: authDurationConfigMs,
                },
            );

            const agentToken = sign(
                {
                    sessionId: agentSessionId,
                    agentId: agentId,
                },
                authSecretConfig,
                {
                    expiresIn: authDurationConfigMs,
                },
            );

            // Update sessions with JWT tokens
            await sql`
                UPDATE auth.agent_sessions 
                SET session__jwt = ${adminToken}
                WHERE general__session_id = ${adminSessionId}
            `;

            await sql`
                UPDATE auth.agent_sessions 
                SET session__jwt = ${agentToken}
                WHERE general__session_id = ${agentSessionId}
            `;

            return {
                admin: {
                    id: adminId,
                    token: adminToken,
                    sessionId: adminSessionId,
                },
                agent: {
                    id: agentId,
                    token: agentToken,
                    sessionId: agentSessionId,
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

    describe("Superuser AC", () => {
        test("should verify that our connection is superuser.", async () => {
            await sql.begin(async (tx) => {
                const [result] =
                    await tx`SELECT auth.is_super_admin() as is_super`;
                expect(result.is_super).toBe(true);
            });
        });
    });

    describe("Account Management", () => {
        test("should create and verify test accounts", async () => {
            await sql.begin(async (tx) => {
                // Use the transaction tx for all queries in this test
                const accounts = await createTestAccounts();
                admin = accounts.admin;
                agent = accounts.agent;

                // Verify admin account using tx
                const [adminProfile] = await tx<[Auth.I_Profile]>`
                    SELECT * FROM auth.agent_profiles
                    WHERE general__agent_profile_id = ${admin.id}
                `;
                expect(adminProfile.profile__username).toBe("test_admin");
                expect(adminProfile.auth__is_admin).toBe(true);

                // Verify agent account using tx
                const [agentProfile] = await tx<[Auth.I_Profile]>`
                    SELECT * FROM auth.agent_profiles
                    WHERE general__agent_profile_id = ${agent.id}
                `;
                expect(agentProfile.profile__username).toBe("test_agent");
                expect(agentProfile.auth__is_admin).toBe(false);
            });
        });
    });

    describe("Session Management", () => {
        beforeEach(async () => {
            // Reset admin context before each test
            await sql`SELECT auth.set_agent_context(${admin.sessionId})`;
        });

        test("should handle unset agent context gracefully", async () => {
            await sql.begin(async (tx) => {
                await tx`SELECT auth.set_agent_context(auth.get_anon_agent_id()::text)`;
                const [result] = await tx`SELECT auth.current_agent_id()`;
                const [anonId] = await tx`SELECT auth.get_anon_agent_id()`;
                expect(result.current_agent_id).toBe(anonId.get_anon_agent_id);
            });
        });

        test("should handle invalid agent context gracefully", async () => {
            await sql.begin(async (tx) => {
                await tx`SELECT auth.set_agent_context(auth.get_anon_agent_id()::text)`; // Invalid session ID
                const [contextResult] = await tx`
                    SELECT auth.set_agent_context(${randomUUIDv7()}, '') as success
                `;
                expect(contextResult.success).toBe(false);
                const [result] = await tx`SELECT auth.current_agent_id()`;
                const [anonId] = await tx`SELECT auth.get_anon_agent_id()`;
                expect(result.current_agent_id).toBe(anonId.get_anon_agent_id);
            });
        });

        test("should handle valid agent context", async () => {
            await sql.begin(async (tx) => {
                const [session] = await tx`
                    SELECT * FROM auth.agent_sessions 
                    WHERE general__session_id = ${admin.sessionId}
                `;

                const [contextResult] = await tx`
                    SELECT auth.set_agent_context(${admin.sessionId}, ${admin.token}) as success
                `;
                expect(contextResult.success).toBe(true);
                const [result] = await tx`SELECT auth.current_agent_id()`;
                expect(result.current_agent_id).toBe(admin.id);
            });
        });

        test("should handle expired sessions correctly", async () => {
            await sql.begin(async (tx) => {
                const [expiredSession] = await tx`
                    INSERT INTO auth.agent_sessions (
                        auth__agent_id,
                        auth__provider_name,
                        session__expires_at,
                        session__is_active,
                        session__jwt
                    ) VALUES (
                        ${admin.id},
                        'test',
                        NOW() - INTERVAL '1 second',
                        true,
                        'test_token'
                    ) RETURNING general__session_id
                `;
                await tx`SELECT auth.cleanup_old_sessions()`;
                await tx`SELECT auth.set_agent_context(${expiredSession.general__session_id}, 'test_token')`;
                const [currentAgent] = await tx`SELECT auth.current_agent_id()`;
                const [anonId] = await tx`SELECT auth.get_anon_agent_id()`;
                expect(currentAgent.current_agent_id).toBe(
                    anonId.get_anon_agent_id,
                );
                const [sessionStatus] = await tx`
                    SELECT session__is_active 
                    FROM auth.agent_sessions 
                    WHERE general__session_id = ${expiredSession.general__session_id}
                `;
                expect(sessionStatus.session__is_active).toBe(false);
            });
        });

        test("should enforce max sessions per agent", async () => {
            await sql.begin(async (tx) => {
                const [authConfig] = await tx`
                    SELECT (general__value->>'session_max_per_agent')::INTEGER as max_sessions 
                    FROM config.config 
                    WHERE general__key = 'auth'
                `;
                const maxSessions = authConfig.max_sessions;

                // Create sessions up to the limit
                for (let i = 0; i < maxSessions + 1; i++) {
                    await tx`SELECT * FROM auth.create_agent_session(${agent.id}, 'test')`;
                }
                // Verify that oldest session was invalidated
                const [activeSessions] = await tx<{ count: string }[]>`
                    SELECT COUNT(*)::TEXT as count 
                    FROM auth.agent_sessions 
                    WHERE auth__agent_id = ${agent.id} 
                    AND session__is_active = true
                `;
                expect(Number.parseInt(activeSessions.count)).toBe(maxSessions);
            });
        });
    });

    describe("Sync Group Management", () => {
        test("should verify default sync groups exist", async () => {
            await sql.begin(async (tx) => {
                const syncGroups = await tx`
                    SELECT * FROM auth.sync_groups
                    ORDER BY general__sync_group
                `;
                expect(syncGroups).toHaveLength(8); // 4 public + 4 admin groups
                expect(syncGroups.map((g) => g.general__sync_group)).toContain(
                    "public.REALTIME",
                );
                expect(syncGroups.map((g) => g.general__sync_group)).toContain(
                    "admin.STATIC",
                );
            });
        });

        test("should manage sync group roles correctly", async () => {
            await sql.begin(async (tx) => {
                await tx`
                    INSERT INTO auth.agent_sync_group_roles (
                        auth__agent_id,
                        group__sync,
                        permissions__can_insert,
                        permissions__can_update,
                        permissions__can_delete
                    ) VALUES (
                        ${agent.id},
                        'public.REALTIME',
                        true,
                        true,
                        false
                    )
                `;
                const [role] = await tx`
                    SELECT * FROM auth.agent_sync_group_roles
                    WHERE auth__agent_id = ${agent.id}
                `;
                expect(role.group__sync).toBe("public.REALTIME");
                expect(role.permissions__can_insert).toBe(true);
                expect(role.permissions__can_update).toBe(true);
                expect(role.permissions__can_delete).toBe(false);
                await tx`SELECT auth.set_agent_context(${agent.sessionId}, ${agent.token})`;
                const [hasRead] = await tx`
                    SELECT auth.has_sync_group_read_access('public.REALTIME') as has_access
                `;
                const [hasInsert] = await tx`
                    SELECT auth.has_sync_group_insert_access('public.REALTIME') as has_access
                `;
                const [hasUpdate] = await tx`
                    SELECT auth.has_sync_group_update_access('public.REALTIME') as has_access
                `;
                const [hasDelete] = await tx`
                    SELECT auth.has_sync_group_delete_access('public.REALTIME') as has_access
                `;
                expect(hasRead.has_access).toBe(true);
                expect(hasInsert.has_access).toBe(true);
                expect(hasUpdate.has_access).toBe(true);
                expect(hasDelete.has_access).toBe(false);
            });
        });

        test("should handle active sessions view correctly", async () => {
            await sql.begin(async (tx) => {
                await tx`
                    INSERT INTO auth.agent_sync_group_roles (
                        auth__agent_id,
                        group__sync,
                        permissions__can_insert,
                        permissions__can_update,
                        permissions__can_delete
                    ) VALUES (
                        ${admin.id},
                        'admin.REALTIME',
                        true,
                        true,
                        true
                    )
                `;
                await tx`SELECT auth.refresh_active_sessions()`;
                const [sessions] = await tx`
                    SELECT active_session_ids as session_ids
                    FROM auth.active_sync_group_sessions
                    WHERE group__sync = 'admin.REALTIME'
                `;
                expect(sessions.session_ids).toContain(admin.sessionId);
            });
        });
    });

    describe("Permission Management", () => {
        test("should verify admin permissions", async () => {
            await sql.begin(async (tx) => {
                const [isAdmin] =
                    await tx`SELECT auth.is_admin_agent() as is_admin`;
                expect(isAdmin.is_admin).toBe(true);
            });
        });

        test("should verify non-admin permissions", async () => {
            await sql.begin(async (tx) => {
                await tx`SELECT auth.set_agent_context(${agent.sessionId}, ${agent.token})`;
                const [isAdmin] =
                    await tx`SELECT auth.is_admin_agent() as is_admin`;
                expect(isAdmin.is_admin).toBe(false);
            });
        });

        test("should handle super admin checks", async () => {
            await sql.begin(async (tx) => {
                const [isSuperAdmin] =
                    await tx`SELECT auth.is_super_admin() as is_super`;
                // This will typically be false in test environment
                expect(typeof isSuperAdmin.is_super).toBe("boolean");
            });
        });
    });

    describe("Session Cleanup", () => {
        test("should cleanup system tokens", async () => {
            await sql.begin(async (tx) => {
                await tx`
                    INSERT INTO auth.agent_sessions (
                        auth__agent_id,
                        auth__provider_name,
                        session__expires_at,
                        session__is_active
                    ) VALUES (
                        auth.get_system_agent_id(),
                        'system',
                        NOW() - INTERVAL '1 hour',
                        true
                    )
                `;
                const [result] = await tx`
                    SELECT auth.cleanup_system_tokens() as cleaned
                `;
                expect(result.cleaned).toBeGreaterThan(0);
            });
        });

        test("should handle session invalidation", async () => {
            await sql.begin(async (tx) => {
                // First set admin context on the same connection
                await tx`SELECT auth.set_agent_context(${admin.sessionId}, ${admin.token})`;

                // Ensure agent session is active
                await tx`
                    UPDATE auth.agent_sessions 
                    SET 
                        session__is_active = true,
                        session__expires_at = NOW() + INTERVAL '1 hour'
                    WHERE general__session_id = ${agent.sessionId}
                `;

                // Verify session is active before invalidation
                const [initialState] = await tx`
                    SELECT session__is_active 
                    FROM auth.agent_sessions 
                    WHERE general__session_id = ${agent.sessionId}
                `;
                expect(initialState.session__is_active).toBe(true);

                // Invalidate session
                const [success] = await tx`
                    SELECT auth.invalidate_session(${agent.sessionId}) as success
                `;
                expect(success.success).toBe(true);

                // Verify session is invalid
                const [session] = await tx`
                    SELECT session__is_active 
                    FROM auth.agent_sessions 
                    WHERE general__session_id = ${agent.sessionId}
                `;
                expect(session.session__is_active).toBe(false);
            });
        });

        test("should cleanup inactive sessions", async () => {
            await sql.begin(async (tx) => {
                // Create an inactive session
                await tx`
                    UPDATE auth.agent_sessions 
                    SET session__last_seen_at = NOW() - INTERVAL '1 hour'
                    WHERE general__session_id = ${agent.sessionId}
                `;

                const cleanedCount =
                    await tx`SELECT auth.cleanup_old_sessions()`;
                expect(cleanedCount[0].cleanup_old_sessions).toBeGreaterThan(0);
            });
        });
    });

    describe("Test Cleanup", () => {
        test("should cleanup test accounts", async () => {
            await sql.begin(async (tx) => {
                try {
                    await tx`
                        DELETE FROM auth.agent_profiles 
                        WHERE profile__username IN ('test_admin', 'test_agent')
                    `;
                    const profiles = await tx<Auth.I_Profile[]>`
                        SELECT * FROM auth.agent_profiles
                        WHERE profile__username IN ('test_admin', 'test_agent')
                    `;
                    expect(profiles).toHaveLength(0);
                } catch (error) {
                    log({
                        message: "Failed to cleanup test accounts",
                        type: "error",
                        error,
                    });
                    throw error;
                }
            });
        });
    });

    afterAll(async () => {
        // Disconnect using PostgresClient
        await PostgresClient.getInstance().disconnect();
    });
});
