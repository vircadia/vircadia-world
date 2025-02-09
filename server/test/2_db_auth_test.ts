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
import { createSqlClient } from "../container/docker/docker_cli";
import {
    Config,
    type Auth,
} from "../../sdk/vircadia-world-sdk-ts/schema/schema.general";
import { sign } from "jsonwebtoken";
import { VircadiaConfig_Server } from "../../sdk/vircadia-world-sdk-ts/config/vircadia.config";

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
        // Initialize database connection
        sql = createSqlClient(true);
    });

    async function createTestAccounts(): Promise<{
        admin: TestAccount;
        agent: TestAccount;
    }> {
        try {
            // First create a system token with superuser privileges
            const [authSecretConfig] = await sql<[Config.I_Config]>`
                SELECT * FROM config.config 
                WHERE general__key = ${Config.CONFIG_KEYS.AUTH_SECRET_JWT}
            `;
            const [authDurationConfig] = await sql<[Config.I_Config]>`
                SELECT * FROM config.config 
                WHERE general__key = ${Config.CONFIG_KEYS.AUTH_SESSION_DURATION_JWT}
            `;

            if (
                !authSecretConfig?.general__value ||
                !authDurationConfig?.general__value
            ) {
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
                    NOW() + ${authDurationConfig.general__value}::interval,
                    true
                ) RETURNING general__session_id
            `;

            // Generate system token
            const systemToken = sign(
                {
                    sessionId: systemSession.general__session_id,
                    agentId: await sql`SELECT auth.get_system_agent_id()`,
                },
                authSecretConfig.general__value,
                {
                    expiresIn: authDurationConfig.general__value,
                },
            );

            // Update system session with JWT
            await sql`
                UPDATE auth.agent_sessions 
                SET session__jwt = ${systemToken}
                WHERE general__session_id = ${systemSession.general__session_id}
            `;

            // Set system context
            await sql`SELECT auth.set_agent_context(${systemSession.general__session_id}, ${systemToken})`;

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
                authSecretConfig.general__value,
                {
                    expiresIn: authDurationConfig.general__value,
                },
            );

            const agentToken = sign(
                {
                    sessionId: agentSessionId,
                    agentId: agentId,
                },
                authSecretConfig.general__value,
                {
                    expiresIn: authDurationConfig.general__value,
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

    describe("Account Management", () => {
        test("should create and verify test accounts", async () => {
            // Create test accounts
            const accounts = await createTestAccounts();
            admin = accounts.admin;
            agent = accounts.agent;

            // Verify admin account
            const [adminProfile] = await sql<[Auth.I_Profile]>`
                SELECT * FROM auth.agent_profiles
                WHERE general__agent_profile_id = ${admin.id}
            `;
            expect(adminProfile.profile__username).toBe("test_admin");
            expect(adminProfile.auth__is_admin).toBe(true);

            // Verify agent account
            const [agentProfile] = await sql<[Auth.I_Profile]>`
                SELECT * FROM auth.agent_profiles
                WHERE general__agent_profile_id = ${agent.id}
            `;
            expect(agentProfile.profile__username).toBe("test_agent");
            expect(agentProfile.auth__is_admin).toBe(false);
        });
    });

    describe("Session Management", () => {
        beforeEach(async () => {
            // Reset admin context before each test
            await sql`SELECT auth.set_agent_context(${admin.sessionId}, ${admin.token})`;
        });

        test("should handle unset agent context gracefully", async () => {
            await sql`SELECT auth.clear_agent_context()`;

            // Get current agent id - should return anon user
            const [result] = await sql`SELECT auth.current_agent_id()`;
            const [anonId] = await sql`SELECT auth.get_anon_agent_id()`;
            expect(result.current_agent_id).toBe(anonId.get_anon_agent_id);
        });

        test("should handle invalid agent context gracefully", async () => {
            await sql`SELECT auth.clear_agent_context()`;
            await sql`SELECT set_config('app.current_agent_id', '', true)`;

            const [result] = await sql`SELECT auth.current_agent_id()`;
            const [anonId] = await sql`SELECT auth.get_anon_agent_id()`;
            expect(result.current_agent_id).toBe(anonId.get_anon_agent_id);
        });

        test("should handle valid agent context", async () => {
            const [session] = await sql`
                SELECT * FROM auth.agent_sessions 
                WHERE general__session_id = ${admin.sessionId}
            `;
            log({
                message: "Session check:",
                type: "debug",
                data: session,
                debug: VircadiaConfig_Server.debug,
            });

            const [contextResult] = await sql`
                SELECT auth.set_agent_context(${admin.sessionId}, ${admin.token}) as success
            `;
            expect(contextResult.success).toBe(true);

            const [result] = await sql`SELECT auth.current_agent_id()`;
            expect(result.current_agent_id).toBe(admin.id);
        });

        test("should handle expired sessions correctly", async () => {
            // Create a test session with immediate expiration
            const [expiredSession] = await sql`
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

            await sql`SELECT auth.cleanup_old_sessions()`;
            await sql`SELECT auth.set_agent_context(${expiredSession.general__session_id}, 'test_token')`;

            const [currentAgent] = await sql`SELECT auth.current_agent_id()`;
            const [anonId] = await sql`SELECT auth.get_anon_agent_id()`;
            expect(currentAgent.current_agent_id).toBe(
                anonId.get_anon_agent_id,
            );

            const [sessionStatus] = await sql`
                SELECT session__is_active 
                FROM auth.agent_sessions 
                WHERE general__session_id = ${expiredSession.general__session_id}
            `;
            expect(sessionStatus.session__is_active).toBe(false);
        });
    });

    describe("Sync Group Management", () => {
        beforeEach(async () => {
            await sql`SELECT auth.set_agent_context(${admin.sessionId}, ${admin.token})`;
        });

        test("should verify default sync groups exist", async () => {
            const syncGroups = await sql`
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

        test("should manage sync group roles correctly", async () => {
            // First switch to agent context
            await sql`SELECT auth.set_agent_context(${agent.sessionId}, ${agent.token})`;

            // Assign roles to test agent
            await sql`
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

            // Verify permissions
            const [hasRead] = await sql`
                SELECT auth.has_sync_group_read_access('public.REALTIME') as has_access
            `;
            const [hasInsert] = await sql`
                SELECT auth.has_sync_group_insert_access('public.REALTIME') as has_access
            `;
            const [hasDelete] = await sql`
                SELECT auth.has_sync_group_delete_access('public.REALTIME') as has_access
            `;

            expect(hasRead.has_access).toBe(true);
            expect(hasInsert.has_access).toBe(true);
            expect(hasDelete.has_access).toBe(false);
        });

        test("should handle active sessions view correctly", async () => {
            // Assign role to admin
            await sql`
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

            // Refresh the materialized view
            await sql`SELECT auth.refresh_active_sessions()`;

            // Check active sessions
            const [sessions] = await sql`
                SELECT auth.get_sync_group_session_ids('admin.REALTIME') as session_ids
            `;
            expect(sessions.session_ids).toContain(admin.sessionId);
        });
    });

    describe("Permission Management", () => {
        beforeEach(async () => {
            await sql`SELECT auth.set_agent_context(${admin.sessionId}, ${admin.token})`;
        });

        test("should verify admin permissions", async () => {
            const [isAdmin] =
                await sql`SELECT auth.is_admin_agent() as is_admin`;
            expect(isAdmin.is_admin).toBe(true);
        });

        test("should verify non-admin permissions", async () => {
            await sql`SELECT auth.set_agent_context(${agent.sessionId}, ${agent.token})`;
            const [isAdmin] =
                await sql`SELECT auth.is_admin_agent() as is_admin`;
            expect(isAdmin.is_admin).toBe(false);
        });

        test("should handle super admin checks", async () => {
            const [isSuperAdmin] =
                await sql`SELECT auth.is_super_admin() as is_super`;
            // This will typically be false in test environment
            expect(typeof isSuperAdmin.is_super).toBe("boolean");
        });
    });

    describe("Session Cleanup", () => {
        test("should cleanup system tokens", async () => {
            // Create an expired system token
            await sql`
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

            const [result] =
                await sql`SELECT auth.cleanup_system_tokens() as cleaned`;
            expect(result.cleaned).toBeGreaterThan(0);
        });

        test("should handle session invalidation", async () => {
            const success = await sql`
                SELECT auth.invalidate_session(${agent.sessionId}) as success
            `;
            expect(success[0].success).toBe(true);

            // Verify session is invalid
            const [session] = await sql`
                SELECT session__is_active 
                FROM auth.agent_sessions 
                WHERE general__session_id = ${agent.sessionId}
            `;
            expect(session.session__is_active).toBe(false);
        });
    });

    describe("Test Cleanup", () => {
        test("should cleanup test accounts", async () => {
            try {
                await sql`
                    DELETE FROM auth.agent_profiles 
                    WHERE profile__username IN ('test_admin', 'test_agent')
                `;

                const profiles = await sql<Auth.I_Profile[]>`
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

    afterAll(async () => {
        // Close database connection
        await sql.end();
    });
});
