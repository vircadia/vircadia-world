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
import { Entity } from "../../sdk/vircadia-world-sdk-ts/schema/schema.general";
import { sign } from "jsonwebtoken";
import { isHealthy, up } from "../container/docker/docker_cli";

interface TestAccount {
    id: string;
    token: string;
    sessionId: string;
}

describe("DB -> Entity Tests", () => {
    let sql: postgres.Sql;
    let admin: TestAccount;
    let agent: TestAccount;

    beforeAll(async () => {
        if (!(await isHealthy()).isHealthy) {
            await up();
            const healthyAfterUp = await isHealthy();
            if (!healthyAfterUp.isHealthy) {
                throw new Error("Failed to start services");
            }
        }
        await PostgresClient.getInstance().connect();
        sql = PostgresClient.getInstance().getClient();
    });

    async function createTestAccounts(): Promise<{
        admin: TestAccount;
        agent: TestAccount;
    }> {
        try {
            const [authConfig] = await sql<
                [
                    {
                        auth_config__jwt_secret: string;
                        auth_config__default_session_duration_ms: number;
                    },
                ]
            >`
                SELECT auth_config__jwt_secret, auth_config__default_session_duration_ms 
                FROM config.auth_config 
            `;
            if (
                !authConfig.auth_config__jwt_secret ||
                !authConfig.auth_config__default_session_duration_ms
            ) {
                throw new Error("Auth settings not found in database");
            }
            await sql`DELETE FROM auth.agent_profiles WHERE profile__username IN ('test_admin', 'test_agent')`;

            const [adminAccount] = await sql`
                INSERT INTO auth.agent_profiles (profile__username, auth__email, auth__is_admin)
                VALUES ('test_admin', 'test_admin@test.com', true)
                RETURNING general__agent_profile_id
            `;
            const adminId = adminAccount.general__agent_profile_id;

            const [agentAccount] = await sql`
                INSERT INTO auth.agent_profiles (profile__username, auth__email)
                VALUES ('test_agent', 'test_agent@test.com')
                RETURNING general__agent_profile_id
            `;
            const agentId = agentAccount.general__agent_profile_id;

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

            const [adminSession] =
                await sql`SELECT * FROM auth.create_agent_session(${adminId}, 'test')`;
            const [agentSession] =
                await sql`SELECT * FROM auth.create_agent_session(${agentId}, 'test')`;

            const adminToken = sign(
                {
                    sessionId: adminSession.general__session_id,
                    agentId: adminId,
                },
                authConfig.auth_config__jwt_secret,
                {
                    expiresIn:
                        authConfig.auth_config__default_session_duration_ms,
                },
            );

            const agentToken = sign(
                {
                    sessionId: agentSession.general__session_id,
                    agentId: agentId,
                },
                authConfig.auth_config__jwt_secret,
                {
                    expiresIn:
                        authConfig.auth_config__default_session_duration_ms,
                },
            );

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
        if (!admin || !agent) {
            const accounts = await createTestAccounts();
            admin = accounts.admin;
            agent = accounts.agent;
        }
        await sql`SELECT auth.set_agent_context(${admin.sessionId}, ${admin.token})`;
    });

    describe("Entity -> Entities Operations", () => {
        test("should create and read an entity with metadata", async () => {
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

            const [entity] = await sql<[Entity.I_Entity]>`
                INSERT INTO entity.entities (
                    general__entity_name,
                    meta__data,
                    group__sync
                ) VALUES (
                    ${"Test Entity"},
                    ${sql.json(entityData)},
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

            await sql`DELETE FROM entity.entities WHERE general__entity_id = ${entity.general__entity_id}`;
        });

        test("should update an entity", async () => {
            const [entity] = await sql<[Entity.I_Entity]>`
                INSERT INTO entity.entities (
                    general__entity_name,
                    meta__data,
                    group__sync
                ) VALUES (
                    ${"Test Entity"},
                    ${sql.json({
                        script1: { status: "init" },
                        script2: { counter: 0 },
                    })},
                    ${"public.NORMAL"}
                ) RETURNING *
            `;

            await sql`
                UPDATE entity.entities
                SET 
                    general__entity_name = ${"Updated Entity"},
                    meta__data = ${sql.json({
                        script1: { status: "ready" },
                        script2: { counter: 1 },
                    })}
                WHERE general__entity_id = ${entity.general__entity_id}
            `;

            const [updated] = await sql<[Entity.I_Entity]>`
                SELECT * FROM entity.entities
                WHERE general__entity_id = ${entity.general__entity_id}
            `;
            expect(updated.general__entity_name).toBe("Updated Entity");
            expect(updated.meta__data).toMatchObject({
                script1: { status: "ready" },
                script2: { counter: 1 },
            });

            await sql`DELETE FROM entity.entities WHERE general__entity_id = ${entity.general__entity_id}`;
        });
    });

    describe("Entity -> Entity Scripts Operations", () => {
        test("should create a script and associate it with an entity", async () => {
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

            const scriptNamespace = `script_${script.general__script_id}`;
            const [entity] = await sql<[Entity.I_Entity]>`
                INSERT INTO entity.entities (
                    general__entity_name,
                    scripts__ids,
                    meta__data,
                    group__sync
                ) VALUES (
                    ${"Scripted Entity"},
                    ARRAY[${script.general__script_id}]::UUID[],
                    ${sql.json({
                        [scriptNamespace]: {
                            initialized: true,
                            lastRun: new Date().toISOString(),
                        },
                    })},
                    ${"public.NORMAL"}
                ) RETURNING *
            `;

            expect(entity.scripts__ids).toContain(script.general__script_id);
            expect(entity.meta__data[scriptNamespace]).toMatchObject({
                initialized: true,
            });

            await sql`DELETE FROM entity.entities WHERE general__entity_id = ${entity.general__entity_id}`;
            await sql`DELETE FROM entity.entity_scripts WHERE general__script_id = ${script.general__script_id}`;
        });
    });

    describe("Entity -> Entity Assets Operations", () => {
        test("should create an asset and verify its metadata", async () => {
            // Creating an asset that mirrors the world_1_ENTITY_ASSET.sql structure.
            const assetData = {
                extra: "data",
                info: { version: 1 },
            };

            const [asset] = await sql<[Entity.Asset.I_Asset]>`
                INSERT INTO entity.entity_assets (
                    general__asset_name,
                    asset__data,
                    meta__data,
                    group__sync
                ) VALUES (
                    ${"Test Asset"},
                    ${Buffer.from("sample asset binary data")},
                    ${sql.json(assetData)},
                    ${"public.NORMAL"}
                ) RETURNING *
            `;

            expect(asset.general__asset_name).toBe("Test Asset");
            expect(asset.meta__data).toMatchObject(assetData);

            await sql`DELETE FROM entity.entity_assets WHERE general__asset_id = ${asset.general__asset_id}`;
        });
    });

    describe("Entity -> Relations Operations", () => {
        test("should create an entity with related asset and script, then delete the entity", async () => {
            // Insert an asset record.
            const [asset] = await sql`
                INSERT INTO entity.entity_assets (
                    general__asset_name,
                    group__sync,
                    meta__data,
                    asset__data
                ) VALUES (
                    ${"Test Asset"},
                    ${"public.NORMAL"},
                    ${sql.json({ type: "texture", description: "Test asset" })},
                    decode('deadbeef', 'hex')
                ) RETURNING *
            `;

            // Insert a script record.
            const [script] = await sql`
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
            const [entity] = await sql`
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
            expect(entity.assets__ids).toContain(asset.general__asset_id);
            expect(entity.scripts__ids).toContain(script.general__script_id);

            // Delete the entity record after all checks.
            await sql`DELETE FROM entity.entities WHERE general__entity_id = ${entity.general__entity_id}`;

            // Optionally clean up asset and script records.
            await sql`DELETE FROM entity.entity_assets WHERE general__asset_id = ${asset.general__asset_id}`;
            await sql`DELETE FROM entity.entity_scripts WHERE general__script_id = ${script.general__script_id}`;
        });

        test("should remove asset id from entity when corresponding asset is deleted", async () => {
            // Insert an asset record.
            const [asset] = await sql`
                INSERT INTO entity.entity_assets (
                    general__asset_name,
                    group__sync,
                    meta__data,
                    asset__data
                ) VALUES (
                    ${"Asset to delete"},
                    ${"public.NORMAL"},
                    ${sql.json({ type: "texture", description: "Asset for deletion" })},
                    decode('deadbeef', 'hex')
                ) RETURNING *
            `;

            // Insert an entity referencing the asset.
            const [entity] = await sql`
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
            await sql`DELETE FROM entity.entity_assets WHERE general__asset_id = ${asset.general__asset_id}`;

            // Re-read the entity to ensure the asset id is removed.
            const [updatedEntity] = await sql`
                SELECT * FROM entity.entities WHERE general__entity_id = ${entity.general__entity_id}
            `;
            expect(updatedEntity.assets__ids).not.toContain(
                asset.general__asset_id,
            );

            // Clean up
            await sql`DELETE FROM entity.entities WHERE general__entity_id = ${entity.general__entity_id}`;
        });

        test("should remove script id from entity when corresponding script is deleted", async () => {
            // Insert a script record.
            const [script] = await sql`
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
            const [entity] = await sql`
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
            await sql`DELETE FROM entity.entity_scripts WHERE general__script_id = ${script.general__script_id}`;

            // Re-read the entity to ensure the script id is removed.
            const [updatedEntity] = await sql`
                SELECT * FROM entity.entities WHERE general__entity_id = ${entity.general__entity_id}
            `;
            expect(updatedEntity.scripts__ids).not.toContain(
                script.general__script_id,
            );

            // Clean up
            await sql`DELETE FROM entity.entities WHERE general__entity_id = ${entity.general__entity_id}`;
        });

        test("should propagate script status changes to update entity scripts__status", async () => {
            // Insert a script record with compiled statuses
            const [script] = await sql`
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
            const [entity] = await sql`
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
            await sql`
                UPDATE entity.entity_scripts
                SET compiled__node__status = ${"PENDING"}
                WHERE general__script_id = ${script.general__script_id}
            `;

            // The trigger on entity.entity_scripts should update affected entities.
            // Re-read the entity to check the updated status.
            const [updatedEntity] = await sql`
                SELECT * FROM entity.entities WHERE general__entity_id = ${entity.general__entity_id}
            `;

            // Expect the entity's scripts__status to be updated to 'AWAITING_SCRIPTS'
            expect(updatedEntity.scripts__status).toBe("AWAITING_SCRIPTS");

            // Clean up
            await sql`DELETE FROM entity.entities WHERE general__entity_id = ${entity.general__entity_id}`;
            await sql`DELETE FROM entity.entity_scripts WHERE general__script_id = ${script.general__script_id}`;
        });
    });

    afterAll(async () => {
        await sql`DELETE FROM auth.agent_profiles WHERE profile__username IN ('test_admin', 'test_agent')`;
        await PostgresClient.getInstance().disconnect();
    });
});
