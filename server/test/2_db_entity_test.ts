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
    Entity,
} from "../../sdk/vircadia-world-sdk-ts/schema/schema.general";
import { sign } from "jsonwebtoken";

interface TestAccount {
    id: string;
    token: string;
    sessionId: string;
}

interface TestResources {
    scriptId: string;
    entityId: string;
}

describe("Entity Database Tests", () => {
    let sql: postgres.Sql;
    let admin: TestAccount;
    let agent: TestAccount;
    let testResources: TestResources;

    // Setup before all tests
    beforeAll(async () => {
        sql = createSqlClient(true);
    });

    async function createTestAccounts(): Promise<{
        admin: TestAccount;
        agent: TestAccount;
    }> {
        try {
            // Get auth settings
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

            // Clean up any existing test accounts
            await sql`DELETE FROM auth.agent_profiles WHERE profile__username IN ('test_admin', 'test_agent')`;

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

            // Assign roles
            await sql`
                INSERT INTO auth.agent_sync_group_roles (
                    auth__agent_id, 
                    group__sync,
                    permissions__can_insert,
                    permissions__can_update,
                    permissions__can_delete
                ) VALUES 
                (${adminId}, 'public.NORMAL', true, true, true),
                (${agentId}, 'public.NORMAL', true, true, false)
            `;

            // Create sessions
            const [adminSession] =
                await sql`SELECT * FROM auth.create_agent_session(${adminId}, 'test')`;
            const [agentSession] =
                await sql`SELECT * FROM auth.create_agent_session(${agentId}, 'test')`;

            // Generate tokens
            const adminToken = sign(
                {
                    sessionId: adminSession.general__session_id,
                    agentId: adminId,
                },
                authSecretConfig.general__value,
                { expiresIn: authDurationConfig.general__value },
            );

            const agentToken = sign(
                {
                    sessionId: agentSession.general__session_id,
                    agentId: agentId,
                },
                authSecretConfig.general__value,
                { expiresIn: authDurationConfig.general__value },
            );

            // Update sessions with tokens
            await sql`
                UPDATE auth.agent_sessions 
                SET session__jwt = ${adminToken}
                WHERE general__session_id = ${adminSession.general__session_id}
            `;
            await sql`
                UPDATE auth.agent_sessions 
                SET session__jwt = ${agentToken}
                WHERE general__session_id = ${agentSession.general__session_id}
            `;

            return {
                admin: {
                    id: adminId,
                    token: adminToken,
                    sessionId: adminSession.general__session_id,
                },
                agent: {
                    id: agentId,
                    token: agentToken,
                    sessionId: agentSession.general__session_id,
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

    beforeEach(async () => {
        // Create test accounts if they don't exist
        if (!admin || !agent) {
            const accounts = await createTestAccounts();
            admin = accounts.admin;
            agent = accounts.agent;
        }
        // Set admin context for tests
        await sql`SELECT auth.set_agent_context(${admin.sessionId}, ${admin.token})`;
    });

    describe("Entity Operations", () => {
        test("should create and read an entity", async () => {
            const entityData = {
                customProperty: "test value",
                nestedData: {
                    someValue: 123,
                },
            };

            // Expect this to succeed
            const [entity] = await sql<[Entity.I_Entity]>`
                INSERT INTO entity.entities (
                    general__name,
                    meta__data,
                    group__sync
                ) VALUES (
                    ${"Test Entity"},
                    ${JSON.stringify(entityData)}::jsonb,
                    ${"public.NORMAL"}
                ) RETURNING *
            `;

            expect(entity.general__name).toBe("Test Entity");
            expect(entity.group__sync).toBe("public.NORMAL");
            const metaData =
                typeof entity.meta__data === "string"
                    ? JSON.parse(entity.meta__data)
                    : entity.meta__data;
            expect(metaData).toMatchObject(entityData);

            // Clean up
            await sql`DELETE FROM entity.entities WHERE general__entity_id = ${entity.general__entity_id}`;
        });

        test("should update an entity", async () => {
            // Create entity with any metadata
            const [entity] = await sql<[Entity.I_Entity]>`
                INSERT INTO entity.entities (
                    general__name,
                    meta__data,
                    group__sync
                ) VALUES (
                    ${"Test Entity"},
                    ${JSON.stringify({ someData: "test" })}::jsonb,
                    ${"public.NORMAL"}
                ) RETURNING *
            `;

            // Update entity name
            await sql`
                UPDATE entity.entities
                SET general__name = ${"Updated Entity"}
                WHERE general__entity_id = ${entity.general__entity_id}
            `;

            // Verify update
            const [updated] = await sql<[Entity.I_Entity]>`
                SELECT * FROM entity.entities
                WHERE general__entity_id = ${entity.general__entity_id}
            `;
            expect(updated.general__name).toBe("Updated Entity");

            // Clean up
            await sql`DELETE FROM entity.entities WHERE general__entity_id = ${entity.general__entity_id}`;
        });

        test("should handle entity scripts", async () => {
            // Create script
            const [script] = await sql<[Entity.Script.I_Script]>`
                INSERT INTO entity.entity_scripts (
                    compiled__browser__script,
                    compiled__browser__status,
                    group__sync
                ) VALUES (
                    ${'console.log("test")'},
                    ${Entity.Script.E_CompilationStatus.COMPILED},
                    ${"public.NORMAL"}
                ) RETURNING *
            `;

            // Create entity with script and simple metadata
            const [entity] = await sql<[Entity.I_Entity]>`
                INSERT INTO entity.entities (
                    general__name,
                    scripts__ids,
                    meta__data,
                    group__sync
                ) VALUES (
                    ${"Scripted Entity"},
                    ARRAY[${script.general__script_id}]::UUID[],
                    ${JSON.stringify({ type: "scripted" })}::jsonb,
                    ${"public.NORMAL"}
                ) RETURNING *
            `;

            expect(entity.scripts__ids).toContain(script.general__script_id);

            // Clean up
            await sql`DELETE FROM entity.entities WHERE general__entity_id = ${entity.general__entity_id}`;
            await sql`DELETE FROM entity.entity_scripts WHERE general__script_id = ${script.general__script_id}`;
        });
    });

    afterAll(async () => {
        // Clean up test accounts
        await sql`DELETE FROM auth.agent_profiles WHERE profile__username IN ('test_admin', 'test_agent')`;
        await sql.end();
    });
});
