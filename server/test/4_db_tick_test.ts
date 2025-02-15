import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import type postgres from "postgres";
import { PostgresClient } from "../database/postgres/postgres_client";
import type {
    Tick,
    Entity,
} from "../../sdk/vircadia-world-sdk-ts/schema/schema.general";
import { isHealthy, up } from "../container/docker/docker_cli";

describe("DB -> Tick Tests", () => {
    let sql: postgres.Sql;
    const syncGroup = "public.NORMAL";
    const scriptNamespace = "script_namespace_1";

    // Global arrays for tracking created records
    const createdEntityIds: string[] = [];
    const createdScriptIds: string[] = [];
    const createdAssetIds: string[] = [];

    // Setup before all tests
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

    describe("Tick Operations", () => {
        test("should create and manage world ticks", async () => {
            // Capture first tick and verify properties
            const [tickRecord1] = await sql<[Tick.I_Tick]>`
                SELECT * FROM tick.capture_tick_state(${syncGroup})
            `;
            expect(tickRecord1).toBeTruthy();
            expect(tickRecord1.group__sync).toBe(syncGroup);
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
            expect(tickRecord1.tick__headroom_ms).toBeGreaterThanOrEqual(0);

            // Capture second tick and verify difference
            const [tickRecord2] = await sql<[Tick.I_Tick]>`
                SELECT * FROM tick.capture_tick_state(${syncGroup})
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
            ).toBeGreaterThan(new Date(tickRecord1.tick__start_time).getTime());
            expect(
                new Date(tickRecord2.tick__end_time).getTime(),
            ).toBeGreaterThan(new Date(tickRecord1.tick__end_time).getTime());
            expect(
                Number(tickRecord2.tick__time_since_last_tick_ms),
            ).toBeGreaterThan(0);
        });
    });

    describe("Script Operations", () => {
        test("should create multiple test scripts and capture their tick states", async () => {
            // Create two test script records
            const [script1] = await sql<[{ general__script_id: string }]>` 
                INSERT INTO entity.entity_scripts (
                    general__script_name,
                    group__sync
                ) VALUES (
                    ${"Test Script 1"},
                    ${syncGroup}
                ) RETURNING general__script_id
            `;
            const [script2] = await sql<[{ general__script_id: string }]>` 
                INSERT INTO entity.entity_scripts (
                    general__script_name,
                    group__sync
                ) VALUES (
                    ${"Test Script 2"},
                    ${syncGroup}
                ) RETURNING general__script_id
            `;

            // Track created scripts for cleanup
            createdScriptIds.push(
                script1.general__script_id,
                script2.general__script_id,
            );

            // Capture a tick so that the scripts are processed
            await sql`SELECT * FROM tick.capture_tick_state(${syncGroup})`;

            // Retrieve all script states at latest tick and verify the scripts are present
            const scripts = await sql<
                Array<{
                    general__script_id: string;
                    general__script_name: string;
                    group__sync: string;
                }>
            >`
                SELECT * FROM entity.entity_scripts WHERE group__sync = ${syncGroup}
            `;

            const retrievedIds = scripts.map((s) => s.general__script_id);
            expect(retrievedIds).toContain(script1.general__script_id);
            expect(retrievedIds).toContain(script2.general__script_id);
        });
    });

    describe("Asset Operations", () => {
        test("should create multiple test assets and capture their tick states", async () => {
            // Create two test asset records
            const [asset1] = await sql<[{ general__asset_id: string }]>` 
                INSERT INTO entity.entity_assets (
                    general__asset_name,
                    group__sync,
                    asset__data,
                    meta__data
                ) VALUES (
                    ${"Test Asset 1"},
                    ${syncGroup},
                    ${Buffer.from("asset data 1")},
                    ${sql.json({ info: "asset 1 meta" })}
                ) RETURNING general__asset_id
            `;
            const [asset2] = await sql<[{ general__asset_id: string }]>` 
                INSERT INTO entity.entity_assets (
                    general__asset_name,
                    group__sync,
                    asset__data,
                    meta__data
                ) VALUES (
                    ${"Test Asset 2"},
                    ${syncGroup},
                    ${Buffer.from("asset data 2")},
                    ${sql.json({ info: "asset 2 meta" })}
                ) RETURNING general__asset_id
            `;

            // Track created assets for cleanup
            createdAssetIds.push(
                asset1.general__asset_id,
                asset2.general__asset_id,
            );

            // Capture a tick so that the asset changes are processed
            await sql`SELECT * FROM tick.capture_tick_state(${syncGroup})`;

            // Retrieve all assets and verify they are present
            const assets = await sql<
                Array<{
                    general__asset_id: string;
                    group__sync: string;
                    general__asset_name: string;
                }>
            >`
                SELECT * FROM entity.entity_assets WHERE group__sync = ${syncGroup}
            `;

            const retrievedAssetIds = assets.map((a) => a.general__asset_id);
            expect(retrievedAssetIds).toContain(asset1.general__asset_id);
            expect(retrievedAssetIds).toContain(asset2.general__asset_id);
        });
    });

    describe("Entity Operations", () => {
        test("should create multiple test entities and capture their tick states", async () => {
            const entityNames = ["Entity One", "Entity Two", "Entity Three"];
            const createdEntities = [];

            for (const name of entityNames) {
                const [entity] = await sql<[Entity.I_Entity]>` 
                    INSERT INTO entity.entities (
                        general__entity_name,
                        meta__data,
                        group__sync,
                        scripts__ids,
                        scripts__status,
                        assets__ids
                    ) VALUES (
                        ${name},
                        ${sql.json({
                            [scriptNamespace]: {
                                position: {
                                    x: 0,
                                    y: 0,
                                    z: 0,
                                },
                            },
                        })},
                        ${syncGroup},
                        ${sql.array([])},
                        ${"ACTIVE"},
                        ${sql.array([])}
                    ) RETURNING *
                `;
                createdEntities.push(entity);
                createdEntityIds.push(entity.general__entity_id);
            }

            // Capture tick state
            const [tickRecord] = await sql<[Tick.I_Tick]>`
                SELECT * FROM tick.capture_tick_state(${syncGroup})
            `;

            // Verify entities exist
            const states = await sql<Array<{ general__entity_id: string }>>`
                SELECT general__entity_id 
                FROM entity.entities 
                WHERE group__sync = ${syncGroup}
            `;

            const stateIds = states.map((s) => s.general__entity_id);
            for (const entity of createdEntities) {
                expect(stateIds).toContain(entity.general__entity_id);
            }
        });

        test("should detect entity changes between ticks for multiple entities", async () => {
            const [entity1] = await sql<[Entity.I_Entity]>` 
                INSERT INTO entity.entities (
                    general__entity_name,
                    meta__data,
                    group__sync,
                    scripts__ids,
                    scripts__status,
                    assets__ids
                ) VALUES (
                    ${"Original Entity 1"},
                    ${sql.json({
                        [scriptNamespace]: {
                            position: {
                                x: 0,
                                y: 0,
                                z: 0,
                            },
                        },
                    })},
                    ${syncGroup},
                    ${sql.array([])},
                    ${"ACTIVE"},
                    ${sql.array([])}
                ) RETURNING *
            `;
            const [entity2] = await sql<[Entity.I_Entity]>` 
                INSERT INTO entity.entities (
                    general__entity_name,
                    meta__data,
                    group__sync,
                    scripts__ids,
                    scripts__status,
                    assets__ids
                ) VALUES (
                    ${"Original Entity 2"},
                    ${sql.json({ [scriptNamespace]: { position: { x: 10, y: 10, z: 10 } } })},
                    ${syncGroup},
                    ${sql.array([])},
                    ${"ACTIVE"},
                    ${sql.array([])}
                ) RETURNING *
            `;
            // Track created entities for cleanup
            createdEntityIds.push(
                entity1.general__entity_id,
                entity2.general__entity_id,
            );

            // Capture first tick
            await sql`SELECT * FROM tick.capture_tick_state(${syncGroup})`;

            // Update both entities
            await sql`
                UPDATE entity.entities 
                SET general__entity_name = ${"Updated Entity 1"},
                    meta__data = ${sql.json({ [scriptNamespace]: { position: { x: 5, y: 5, z: 5 } } })}
                WHERE general__entity_id = ${entity1.general__entity_id}
            `;
            await sql`
                UPDATE entity.entities 
                SET general__entity_name = ${"Updated Entity 2"},
                    meta__data = ${sql.json({ [scriptNamespace]: { position: { x: 15, y: 15, z: 15 } } })}
                WHERE general__entity_id = ${entity2.general__entity_id}
            `;

            // Capture second tick
            await sql`SELECT * FROM tick.capture_tick_state(${syncGroup})`;

            // Retrieve changed entity states between latest ticks and verify
            const changes = await sql<Array<Tick.I_EntityUpdate>>`
                SELECT * FROM tick.get_changed_entity_states_between_latest_ticks(${syncGroup})
            `;
            const changeIds = changes.map((c) => c.general__entity_id);
            expect(changeIds).toEqual(
                expect.arrayContaining([
                    entity1.general__entity_id,
                    entity2.general__entity_id,
                ]),
            );

            // Verify updated details for one of the entities
            const updatedChange = changes.find(
                (c) => c.general__entity_id === entity1.general__entity_id,
            );
            expect(updatedChange).toBeTruthy();
            expect(updatedChange?.operation).toBe("UPDATE");
            expect(updatedChange?.changes.general__entity_name).toBe(
                "Updated Entity 1",
            );
        });
    });

    // Global cleanup, deleting all created test items
    afterAll(async () => {
        try {
            // Delete entities one by one
            for (const entityId of createdEntityIds) {
                const result = await sql`
                    DELETE FROM entity.entities 
                    WHERE general__entity_id = ${entityId}`;
            }

            // Delete scripts one by one
            for (const scriptId of createdScriptIds) {
                const result = await sql`
                    DELETE FROM entity.entity_scripts 
                    WHERE general__script_id = ${scriptId}`;
            }

            // Delete assets one by one
            for (const assetId of createdAssetIds) {
                const result = await sql`
                    DELETE FROM entity.entity_assets 
                    WHERE general__asset_id = ${assetId}`;
            }

            await PostgresClient.getInstance().disconnect();
        } catch (error) {
            console.error("Error during cleanup:", error);
            throw error;
        }
    });
});
