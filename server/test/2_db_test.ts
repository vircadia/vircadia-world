import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import type postgres from "postgres";
import { log } from "../../sdk/vircadia-world-sdk-ts/module/general/log";
import { PostgresClient } from "../database/postgres/postgres_client";
import type { Auth } from "../../sdk/vircadia-world-sdk-ts/schema/schema.general";
import { sign } from "jsonwebtoken";
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

	const syncGroupToTest = "public.REALTIME";

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

	describe("Account Management", () => {
		test("should create and verify test accounts", async () => {
			await superUserSql.begin(async (tx) => {
				// Use the transaction tx for all queries in this test
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
						expiresIn: systemAuthProviderConfig.provider__session_duration_ms,
					},
				);

				const regularAgentToken = sign(
					{
						sessionId: regularAgentSessionId,
						agentId: regularAgentId,
					},
					systemAuthProviderConfig.provider__jwt_secret,
					{
						expiresIn: systemAuthProviderConfig.provider__session_duration_ms,
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
		});
	});

	describe("Session Management", () => {
		test("should validate sessions successfully", async () => {
			await proxyUserSql.begin(async (tx) => {
				const [validateAdminSession] = await tx`
                    SELECT auth.validate_session(${adminAgent.sessionId}) as agent_id
                `;
				expect(validateAdminSession.agent_id).toBe(adminAgent.id);

				const [validateRegularSession] = await tx`
                    SELECT auth.validate_session(${regularAgent.sessionId}) as agent_id
                `;
				expect(validateRegularSession.agent_id).toBe(regularAgent.id);

				const [validateAnonSession] = await tx`
                    SELECT auth.validate_session(${anonAgent.sessionId}) as agent_id
                `;
				expect(validateAnonSession.agent_id).toBe(anonAgent.id);
			});
		});

		test("should set agent contexts successfully", async () => {
			await proxyUserSql.begin(async (tx) => {
				const [setAdminAgentContext] = await tx`
                    SELECT auth.set_agent_context_from_session_id(${adminAgent.sessionId}::uuid)
                `;
			});

			await proxyUserSql.begin(async (tx) => {
				const [setRegularAgentContext] = await tx`
                    SELECT auth.set_agent_context_from_session_id(${regularAgent.sessionId}::uuid) as success
                `;
			});

			await proxyUserSql.begin(async (tx) => {
				const [setAnonAgentContext] = await tx`
                    SELECT auth.set_agent_context_from_session_id(${anonAgent.sessionId}::uuid) as success
                `;
			});
		});

		test("should verify SYSTEM agent permissions", async () => {
			await superUserSql.begin(async (tx) => {
				const [isAdmin] = await tx`SELECT auth.is_admin_agent() as is_admin`;
				expect(isAdmin.is_admin).toBe(false);
				const [isSystem] = await tx`SELECT auth.is_system_agent() as is_system`;
				expect(isSystem.is_system).toBe(true);
				const [isProxy] = await tx`SELECT auth.is_proxy_agent() as is_proxy`;
				expect(isProxy.is_proxy).toBe(false);
				const [isAnon] = await tx`SELECT auth.is_anon_agent() as is_anon`;
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
					await tx`SELECT auth.set_agent_context_from_session_id(${adminAgent.sessionId}::uuid)`;

				const [isAdmin] = await tx`SELECT auth.is_admin_agent() as is_admin`;
				expect(isAdmin.is_admin).toBe(true);
				const [isSystem] = await tx`SELECT auth.is_system_agent() as is_system`;
				expect(isSystem.is_system).toBe(false);
				const [isProxy] = await tx`SELECT auth.is_proxy_agent() as is_proxy`;
				expect(isProxy.is_proxy).toBe(true);
				const [isAnon] = await tx`SELECT auth.is_anon_agent() as is_anon`;
				expect(isAnon.is_anon).toBe(false);

				const [currentAgentId] = await tx`SELECT auth.current_agent_id()`;
				expect(currentAgentId.current_agent_id).toBe(adminAgent.id);
			});
		});

		test("should verify REGULAR PROXY agent permissions", async () => {
			await proxyUserSql.begin(async (tx) => {
				const [setAgentContext] =
					await tx`SELECT auth.set_agent_context_from_session_id(${regularAgent.sessionId}::uuid)`;

				const [isAdmin] = await tx`SELECT auth.is_admin_agent() as is_admin`;
				expect(isAdmin.is_admin).toBe(false);
				const [isSystem] = await tx`SELECT auth.is_system_agent() as is_system`;
				expect(isSystem.is_system).toBe(false);
				const [isProxy] = await tx`SELECT auth.is_proxy_agent() as is_proxy`;
				expect(isProxy.is_proxy).toBe(true);
				const [isAnon] = await tx`SELECT auth.is_anon_agent() as is_anon`;
				expect(isAnon.is_anon).toBe(false);

				const [agentId] = await tx`SELECT auth.current_agent_id()`; // Get current agent id
				expect(agentId.current_agent_id).toBe(regularAgent.id);
			});
		});

		test("should verify ANON PROXY agent permissions", async () => {
			await proxyUserSql.begin(async (tx) => {
				await tx`SELECT auth.set_agent_context_from_session_id(${anonAgent.sessionId}::uuid)`;

				const [isAdmin] = await tx`SELECT auth.is_admin_agent() as is_admin`;
				expect(isAdmin.is_admin).toBe(false);
				const [isSystem] = await tx`SELECT auth.is_system_agent() as is_system`;
				expect(isSystem.is_system).toBe(false);
				const [isProxy] = await tx`SELECT auth.is_proxy_agent() as is_proxy`;
				expect(isProxy.is_proxy).toBe(true);
				const [isAnon] = await tx`SELECT auth.is_anon_agent() as is_anon`;
				expect(isAnon.is_anon).toBe(true);

				const [currentAgentId] = await tx`SELECT auth.current_agent_id()`; // Get current agent id
				expect(currentAgentId.current_agent_id).toBe(anonAgent.id);
			});
		});

		test("should handle expired sessions correctly", async () => {
			await proxyUserSql.begin(async (tx) => {
				await tx`SELECT auth.set_agent_context_from_session_id(${adminAgent.sessionId}::uuid)`;

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

				const maxSessions = testProviderConfig.provider__session_max_per_agent;

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
				expect(Number.parseInt(activeSessions.count)).toBe(maxSessions);
			});
		});
	});

	describe("Sync Group Management", () => {
		test("should verify at least one default sync group exists", async () => {
			await proxyUserSql.begin(async (tx) => {
				await tx`SELECT auth.set_agent_context_from_session_id(${adminAgent.sessionId}::uuid)`;

				const syncGroups = await tx`
                    SELECT * FROM auth.sync_groups
                    WHERE general__sync_group = ${syncGroupToTest}
                    ORDER BY general__sync_group
                `;
				expect(syncGroups[0].general__sync_group).toBe(syncGroupToTest);
			});
		});

		test("should manage sync group roles correctly", async () => {
			await proxyUserSql.begin(async (tx) => {
				await tx`SELECT auth.set_agent_context_from_session_id(${adminAgent.sessionId}::uuid)`;

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
				await tx`SELECT auth.set_agent_context_from_session_id(${regularAgent.sessionId})`;

				// Query our role table for the regular agent's sync group permissions
				const [checkRoleFromAgent] = await tx`
                SELECT permissions__can_read, permissions__can_insert, permissions__can_update, permissions__can_delete
                FROM auth.agent_sync_group_roles
                WHERE auth__agent_id = ${regularAgent.id}
                AND group__sync = ${syncGroupToTest}
                `;

				expect(checkRoleFromAgent.permissions__can_read).toBe(true);
				expect(checkRoleFromAgent.permissions__can_insert).toBe(true);
				expect(checkRoleFromAgent.permissions__can_update).toBe(true);
				expect(checkRoleFromAgent.permissions__can_delete).toBe(false);

				// await tx`SELECT auth.refresh_active_sessions()`;
				const [result] = await tx`
                    SELECT array_agg(general__session_id) as session_ids
                    FROM auth.active_sync_group_sessions
                    WHERE group__sync = ${syncGroupToTest};
                `;

				expect(result.session_ids).toContain(regularAgent.sessionId);
			});
		});
	});

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
