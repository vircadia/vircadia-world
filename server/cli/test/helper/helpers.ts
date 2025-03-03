import type postgres from "postgres";
import { sign } from "jsonwebtoken";
import { expect } from "bun:test";
import { log } from "../../module/general/log";
import { VircadiaConfig } from "../../config/vircadia.config";
import type { Auth } from "../../schema/schema.general";

export const TEST_SYNC_GROUP = "public.REALTIME";
export const DB_TEST_PREFIX = "RESERVED_vtw908ncjw98t3t8kgr8y9ngv3w8b_db_test_";
export const ADMIN_AGENT_USERNAME = "admin";
export const REGULAR_AGENT_USERNAME = "agent";
export const ANON_AGENT_USERNAME = "anon";

export interface TestAccount {
    id: string;
    token: string;
    sessionId: string;
}

export async function initTestAccounts(data: {
    superUserSql: postgres.Sql;
}): Promise<{
    adminAgent: TestAccount;
    regularAgent: TestAccount;
    anonAgent: TestAccount;
}> {
    let adminAgent: TestAccount | undefined;
    let regularAgent: TestAccount | undefined;
    let anonAgent: TestAccount | undefined;

    await data.superUserSql.begin(async (tx) => {
        // First create a system token with superuser privileges using system auth provider
        const [systemAuthProviderConfig] = await data.superUserSql<
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

        const [anonAuthProviderConfig] = await data.superUserSql<
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
        const [adminAgentAccount] = await data.superUserSql`
                INSERT INTO auth.agent_profiles (profile__username, auth__email, auth__is_admin)
                VALUES (${DB_TEST_PREFIX + ADMIN_AGENT_USERNAME}::text, 'test_admin@test.com', true)
                RETURNING general__agent_profile_id
            `;
        expect(adminAgentAccount.general__agent_profile_id).toBeDefined();
        const adminAgentId = adminAgentAccount.general__agent_profile_id;

        // Create test regular agent account
        const [regularAgentAccount] = await data.superUserSql`
                INSERT INTO auth.agent_profiles (profile__username, auth__email)
                VALUES (${DB_TEST_PREFIX + REGULAR_AGENT_USERNAME}::text, 'test_agent@test.com')
                RETURNING general__agent_profile_id
          `;
        expect(regularAgentAccount.general__agent_profile_id).toBeDefined();
        const regularAgentId = regularAgentAccount.general__agent_profile_id;

        // Create test anon agent account
        const [anonAgentAccount] = await data.superUserSql`
                INSERT INTO auth.agent_profiles (profile__username, auth__email, auth__is_anon)
                VALUES (${DB_TEST_PREFIX + ANON_AGENT_USERNAME}::text, 'test_anon@test.com', true)
                RETURNING general__agent_profile_id
            `;
        expect(anonAgentAccount.general__agent_profile_id).toBeDefined();
        const anonAgentId = anonAgentAccount.general__agent_profile_id;

        // Create sessions
        const [adminAgentSession] = await data.superUserSql`
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

        const [regularAgentSession] = await data.superUserSql`
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

        const [anonAgentSession] = await data.superUserSql`
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
        await data.superUserSql`
                UPDATE auth.agent_sessions 
                SET session__jwt = ${adminAgentToken}
                WHERE general__session_id = ${adminAgentSessionId}
            `;

        await data.superUserSql`
                UPDATE auth.agent_sessions 
                SET session__jwt = ${regularAgentToken}
                WHERE general__session_id = ${regularAgentSessionId}
            `;

        await data.superUserSql`
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

        // Add sync group permissions for regularAgent
        await tx`
            INSERT INTO auth.agent_sync_group_roles (
                auth__agent_id,
                group__sync,
                permissions__can_read,
                permissions__can_insert,
                permissions__can_update,
                permissions__can_delete
            )
            VALUES (
                ${regularAgent.id},
                ${TEST_SYNC_GROUP},
                true,
                true,
                true,
                true
            )
        `;

        // For adminAgent, permissions are implicitly granted by auth__is_admin=true
        // For anonAgent, we add read-only permissions
        await tx`
            INSERT INTO auth.agent_sync_group_roles (
                auth__agent_id,
                group__sync,
                permissions__can_read,
                permissions__can_insert,
                permissions__can_update,
                permissions__can_delete
            )
            VALUES (
                ${anonAgent.id},
                ${TEST_SYNC_GROUP},
                true,
                false,
                false,
                false
            )
        `;

        // Verify admin account using tx
        const [adminProfile] = await tx<[Auth.I_Profile]>`
                SELECT * FROM auth.agent_profiles
                WHERE general__agent_profile_id = ${adminAgent.id}
            `;
        expect(adminProfile.profile__username).toBe(
            DB_TEST_PREFIX + ADMIN_AGENT_USERNAME,
        );
        expect(adminProfile.auth__is_admin).toBe(true);

        // Verify regular account using tx
        const [regularProfile] = await tx<[Auth.I_Profile]>`
                SELECT * FROM auth.agent_profiles
                WHERE general__agent_profile_id = ${regularAgent.id}
            `;
        expect(regularProfile.profile__username).toBe(
            DB_TEST_PREFIX + REGULAR_AGENT_USERNAME,
        );
        expect(regularProfile.auth__is_admin).toBe(false);

        // Verify anon account using tx
        const [anonProfile] = await tx<[Auth.I_Profile]>`
                SELECT * FROM auth.agent_profiles
                WHERE general__agent_profile_id = ${anonAgent.id}
            `;
        expect(anonProfile.profile__username).toBe(
            DB_TEST_PREFIX + ANON_AGENT_USERNAME,
        );
        expect(anonProfile.auth__is_admin).toBe(false);

        log({
            message: "Initialized test accounts",
            type: "debug",
            debug: VircadiaConfig.SERVER.DEBUG,
            suppress: VircadiaConfig.SERVER.SUPPRESS,
        });
    });

    if (!adminAgent || !regularAgent || !anonAgent) {
        throw new Error("Failed to initialize test accounts");
    }

    return {
        adminAgent,
        regularAgent,
        anonAgent,
    };
}

export async function cleanupTestAccounts(data: {
    superUserSql: postgres.Sql;
}): Promise<void> {
    await data.superUserSql.begin(async (tx) => {
        try {
            // Delete all accounts with the test prefix
            await tx`
                    DELETE FROM auth.agent_profiles 
                    WHERE profile__username LIKE ${`${DB_TEST_PREFIX}%`}
                `;

            // Verify no test accounts remain
            const remainingProfiles = await tx<Auth.I_Profile[]>`
                    SELECT * FROM auth.agent_profiles
                    WHERE profile__username LIKE ${`${DB_TEST_PREFIX}%`}
                `;
            expect(remainingProfiles).toHaveLength(0);

            log({
                message: "Cleaned up test accounts",
                type: "debug",
                debug: VircadiaConfig.SERVER.DEBUG,
                suppress: VircadiaConfig.SERVER.SUPPRESS,
            });
        } catch (error) {
            log({
                message: "Failed to cleanup test accounts",
                type: "error",
                error,
                debug: VircadiaConfig.SERVER.DEBUG,
                suppress: VircadiaConfig.SERVER.SUPPRESS,
            });
            throw error;
        }
    });
}

export async function cleanupTestEntities(data: {
    superUserSql: postgres.Sql;
}): Promise<void> {
    await data.superUserSql.begin(async (tx) => {
        try {
            await tx`
                DELETE FROM entity.entities 
                WHERE general__entity_name LIKE ${`%${DB_TEST_PREFIX}%`}
            `;

            // Verify no test entities remain
            const remainingEntities = await tx`
                SELECT * FROM entity.entities 
                WHERE general__entity_name LIKE ${`%${DB_TEST_PREFIX}%`}
            `;
            expect(remainingEntities).toHaveLength(0);

            log({
                message: "Cleaned up test entities",
                type: "debug",
                debug: VircadiaConfig.SERVER.DEBUG,
                suppress: VircadiaConfig.SERVER.SUPPRESS,
            });
        } catch (error) {
            log({
                message: "Failed to cleanup test entities",
                type: "error",
                error,
                debug: VircadiaConfig.SERVER.DEBUG,
                suppress: VircadiaConfig.SERVER.SUPPRESS,
            });
            throw error;
        }
    });
}

export async function cleanupTestScripts(data: {
    superUserSql: postgres.Sql;
}): Promise<void> {
    await data.superUserSql.begin(async (tx) => {
        try {
            await tx`
                DELETE FROM entity.entity_scripts 
                WHERE general__script_name LIKE ${`%${DB_TEST_PREFIX}%`}
            `;

            // Verify no test scripts remain
            const remainingScripts = await tx`
                SELECT * FROM entity.entity_scripts 
                WHERE general__script_name LIKE ${`%${DB_TEST_PREFIX}%`}
            `;
            expect(remainingScripts).toHaveLength(0);

            log({
                message: "Cleaned up test scripts",
                type: "debug",
                debug: VircadiaConfig.SERVER.DEBUG,
                suppress: VircadiaConfig.SERVER.SUPPRESS,
            });
        } catch (error) {
            log({
                message: "Failed to cleanup test scripts",
                type: "error",
                error,
                debug: VircadiaConfig.SERVER.DEBUG,
                suppress: VircadiaConfig.SERVER.SUPPRESS,
            });
            throw error;
        }
    });
}

export async function cleanupTestAssets(data: {
    superUserSql: postgres.Sql;
}): Promise<void> {
    await data.superUserSql.begin(async (tx) => {
        try {
            await tx`
                DELETE FROM entity.entity_assets 
                WHERE general__asset_name LIKE ${`%${DB_TEST_PREFIX}%`}
            `;

            // Verify no test assets remain
            const remainingAssets = await tx`
                SELECT * FROM entity.entity_assets 
                WHERE general__asset_name LIKE ${`%${DB_TEST_PREFIX}%`}
            `;
            expect(remainingAssets).toHaveLength(0);

            log({
                message: "Cleaned up test assets",
                type: "debug",
                debug: VircadiaConfig.SERVER.DEBUG,
                suppress: VircadiaConfig.SERVER.SUPPRESS,
            });
        } catch (error) {
            log({
                message: "Failed to cleanup test assets",
                type: "error",
                error,
                debug: VircadiaConfig.SERVER.DEBUG,
                suppress: VircadiaConfig.SERVER.SUPPRESS,
            });
            throw error;
        }
    });
}
