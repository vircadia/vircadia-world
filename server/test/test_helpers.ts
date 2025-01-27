import type postgres from "postgres";
import { sign } from "jsonwebtoken";
import { log } from "../../sdk/vircadia-world-sdk-ts/module/general/log";

export interface TestAccount {
    id: string;
    token: string;
    sessionId: string;
}

export interface TestResources {
    scriptId: string;
    entityId: string;
}

export async function cleanupTestAccounts(sql: postgres.Sql) {
    // Clean up profiles (roles and sessions will cascade)
    await sql`
        DELETE FROM auth.agent_profiles 
        WHERE profile__username IN ('test_admin', 'test_agent')
    `;
}

export async function createTestAccounts(sql: postgres.Sql): Promise<{
    admin: TestAccount;
    agent: TestAccount;
}> {
    try {
        // Clean up any existing test accounts first
        await cleanupTestAccounts(sql);

        // Get auth settings from config
        const [authConfig] = await sql`
            SELECT value FROM config.config 
            WHERE key = 'auth_settings'
        `;

        if (!authConfig?.value) {
            throw new Error("Auth settings not found in database");
        }

        // Create test admin account
        const [adminAccount] = await sql`
            INSERT INTO auth.agent_profiles (profile__username, auth__email)
            VALUES ('test_admin', 'test_admin@test.com')
            RETURNING general__uuid
        `;
        const adminId = adminAccount.general__uuid;

        // Assign admin role
        await sql`
            INSERT INTO auth.agent_roles (auth__agent_id, auth__role_name, auth__is_active)
            VALUES (${adminId}, 'admin', true)
        `;

        // Create test regular agent account
        const [agentAccount] = await sql`
            INSERT INTO auth.agent_profiles (profile__username, auth__email)
            VALUES ('test_agent', 'test_agent@test.com')
            RETURNING general__uuid
        `;
        const agentId = agentAccount.general__uuid;

        // Assign agent role
        await sql`
            INSERT INTO auth.agent_roles (auth__agent_id, auth__role_name, auth__is_active)
            VALUES (${agentId}, 'agent', true)
        `;

        // Create sessions for both accounts
        const [adminSession] = await sql`
            SELECT * FROM create_agent_session(${adminId}, 'test')
        `;
        const adminSessionId = adminSession.general__session_id;

        const [agentSession] = await sql`
            SELECT * FROM create_agent_session(${agentId}, 'test')
        `;
        const agentSessionId = agentSession.general__session_id;

        // Generate JWT tokens
        const adminToken = sign(
            {
                sessionId: adminSessionId,
                agentId: adminId,
            },
            authConfig.value.jwt_secret,
            {
                expiresIn: authConfig.value.jwt_session_duration,
            },
        );

        const agentToken = sign(
            {
                sessionId: agentSessionId,
                agentId: agentId,
            },
            authConfig.value.jwt_secret,
            {
                expiresIn: authConfig.value.jwt_session_duration,
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

export async function createTestResources(
    sql: postgres.Sql,
): Promise<TestResources> {
    try {
        // Create test script
        const [scriptResult] = await sql`
            INSERT INTO entity.entity_scripts (
                compiled__web__node__script,
                compiled__web__node__script_status,
                source__git__repo_entry_path
            ) VALUES (
                'console.log("test script")',
                'COMPILED',
                'test/script.ts'
            ) RETURNING general__script_id
        `;
        const scriptId = scriptResult.general__script_id;

        // Create test entity
        const [entityResult] = await sql`
            INSERT INTO entity.entities (
                general__name,
                scripts__ids,
                permissions__roles__view,
                permissions__roles__full
            ) VALUES (
                'Test Entity',
                ARRAY[${scriptId}]::UUID[],
                ARRAY['agent']::TEXT[],
                ARRAY['admin']::TEXT[]
            ) RETURNING general__uuid
        `;
        const entityId = entityResult.general__uuid;

        return {
            scriptId,
            entityId,
        };
    } catch (error) {
        log({
            message: "Failed to create test resources",
            type: "error",
            error,
        });
        throw error;
    }
}

export async function cleanupTestResources(
    sql: postgres.Sql,
    resources: TestResources,
) {
    try {
        // Clean up entities and scripts
        await sql`DELETE FROM entity.entities WHERE general__uuid = ${resources.entityId}`;
        await sql`DELETE FROM entity.entity_scripts WHERE general__script_id = ${resources.scriptId}`;
    } catch (error) {
        log({
            message: "Failed to cleanup test resources",
            type: "error",
            error,
        });
        throw error;
    }
}
