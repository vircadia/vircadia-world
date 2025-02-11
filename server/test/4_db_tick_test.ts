import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import type postgres from "postgres";
import { PostgresClient } from "../database/postgres/postgres_client";
import type {
    Tick,
    Entity,
} from "../../sdk/vircadia-world-sdk-ts/schema/schema.general";

describe("World Tick Tests", () => {
    let sql: postgres.Sql;

    // Setup before all tests
    beforeAll(async () => {
        // Initialize database connection using PostgresClient
        await PostgresClient.getInstance().connect(false);
        sql = PostgresClient.getInstance().getClient();
    });

    describe("Tick Operations", () => {
        test("should create and manage world ticks", async () => {
            const syncGroup = "public.NORMAL";

            // Create first tick and get full tick record
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
            expect(tickRecord1.tick__rate_limited).toBeDefined();

            // Create second tick and verify it has different properties
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
            expect(tickRecord2.tick__time_since_last_tick_ms).toBeGreaterThan(
                0,
            );
        });

        test("should track entity states across ticks", async () => {
            const syncGroup = "public.NORMAL";
            const scriptNamespace = "script_namespace_1";

            // Create an entity with namespaced metadata
            const [entity] = await sql<[Entity.I_Entity]>`
                INSERT INTO entity.entities (
                    general__name,
                    meta__data,
                    group__sync,
                    scripts__ids,
                    scripts__status
                ) VALUES (
                    ${"Test Entity"},
                    ${{
                        [scriptNamespace]: {
                            position: { x: 0, y: 0, z: 0 },
                        },
                    }},
                    ${syncGroup},
                    ARRAY[]::uuid[],
                    ${"ACTIVE"}::entity_status_enum
                ) RETURNING *
            `;

            // Capture tick state
            const [tickRecord] = await sql<[Tick.I_Tick]>`
                SELECT * FROM tick.capture_tick_state(${syncGroup})
            `;

            // Verify entity state was captured
            const [entityState] = await sql<[Tick.I_EntityState]>`
                SELECT * FROM tick.entity_states 
                WHERE general__entity_id = ${entity.general__entity_id}
                AND general__tick_id = ${tickRecord.general__tick_id}
            `;

            expect(entityState).toBeTruthy();
            expect(entityState.general__name).toBe("Test Entity");
            expect(entityState.group__sync).toBe(syncGroup);
            expect(entityState.general__tick_id).toBe(
                tickRecord.general__tick_id,
            );

            // Clean up
            await sql`DELETE FROM entity.entities WHERE general__entity_id = ${entity.general__entity_id}`;
        });

        test("should detect entity changes between ticks", async () => {
            const syncGroup = "public.NORMAL";
            const scriptNamespace = "script_namespace_1";

            // Create initial entity
            const [entity] = await sql<[Entity.I_Entity]>`
                INSERT INTO entity.entities (
                    general__name,
                    meta__data,
                    group__sync,
                    scripts__ids,
                    scripts__status
                ) VALUES (
                    ${"Original Name"},
                    ${{
                        [scriptNamespace]: {
                            position: { x: 0, y: 0, z: 0 },
                        },
                    }},
                    ${syncGroup},
                    ARRAY[]::uuid[],
                    ${"ACTIVE"}::entity_status_enum
                ) RETURNING *
            `;

            // Capture first tick
            const [tick1] = await sql<[Tick.I_Tick]>`
                SELECT * FROM tick.capture_tick_state(${syncGroup})
            `;

            // Update entity
            await sql`
                UPDATE entity.entities 
                SET general__name = ${"Updated Name"},
                    meta__data = ${{
                        [scriptNamespace]: {
                            position: { x: 1, y: 1, z: 1 },
                        },
                    }}
                WHERE general__entity_id = ${entity.general__entity_id}
            `;

            // Capture second tick
            const [tick2] = await sql<[Tick.I_Tick]>`
                SELECT * FROM tick.capture_tick_state(${syncGroup})
            `;

            // Get changes between ticks
            const changes = await sql<Tick.I_EntityUpdate[]>`
                SELECT * FROM tick.get_changed_entity_states_between_latest_ticks(${syncGroup})
            `;

            expect(changes.length).toBeGreaterThanOrEqual(1);
            const entityChange = changes.find(
                (c) => c.general__entity_id === entity.general__entity_id,
            );
            expect(entityChange).toBeTruthy();
            expect(entityChange?.operation).toBe("UPDATE");

            // Parse the changes if they're returned as a string
            const changesData =
                typeof entityChange?.changes === "string"
                    ? JSON.parse(entityChange.changes)
                    : entityChange?.changes;

            expect(changesData.general__name).toBe("Updated Name");
            expect(changesData.meta__data).toEqual({
                [scriptNamespace]: {
                    position: { x: 1, y: 1, z: 1 },
                },
            });

            // Clean up
            await sql`DELETE FROM entity.entities WHERE general__entity_id = ${entity.general__entity_id}`;
        });

        test("should get all entity states at latest tick", async () => {
            const syncGroup = "public.NORMAL";
            const scriptNamespace = "script_namespace_1";

            // Create test entity
            const [entity] = await sql<[Entity.I_Entity]>`
                INSERT INTO entity.entities (
                    general__name,
                    meta__data,
                    group__sync,
                    scripts__ids,
                    scripts__status
                ) VALUES (
                    ${"Latest State Test"},
                    ${{
                        [scriptNamespace]: {
                            position: { x: 0, y: 0, z: 0 },
                        },
                    }},
                    ${syncGroup},
                    ARRAY[]::uuid[],
                    ${"ACTIVE"}::entity_status_enum
                ) RETURNING *
            `;

            // Capture tick
            await sql<[Tick.I_Tick]>`
                SELECT * FROM tick.capture_tick_state(${syncGroup})
            `;

            // Get all states at latest tick
            const states = await sql<Entity.I_Entity[]>`
                SELECT * FROM tick.get_all_entity_states_at_latest_tick(${syncGroup})
            `;

            expect(states.length).toBeGreaterThanOrEqual(1);
            const entityState = states.find(
                (s) => s.general__entity_id === entity.general__entity_id,
            );
            expect(entityState).toBeTruthy();
            expect(entityState?.general__name).toBe("Latest State Test");

            // Clean up
            await sql`DELETE FROM entity.entities WHERE general__entity_id = ${entity.general__entity_id}`;
        });

        test("should get changed entity states between latest ticks", async () => {
            const syncGroup = "public.NORMAL";
            const scriptNamespace = "script_namespace_1";

            // Create initial entity
            const [entity] = await sql<[Entity.I_Entity]>`
                INSERT INTO entity.entities (
                    general__name,
                    meta__data,
                    group__sync,
                    scripts__ids,
                    scripts__status
                ) VALUES (
                    ${"Change Test"},
                    ${{
                        [scriptNamespace]: {
                            position: { x: 0, y: 0, z: 0 },
                        },
                    }},
                    ${syncGroup},
                    ARRAY[]::uuid[],
                    ${"ACTIVE"}::entity_status_enum
                ) RETURNING *
            `;

            // Capture first tick
            const [tick1] = await sql<[Tick.I_Tick]>`
                SELECT * FROM tick.capture_tick_state(${syncGroup})
            `;

            // Update entity
            await sql`
                UPDATE entity.entities 
                SET meta__data = ${{
                    [scriptNamespace]: {
                        position: { x: 2, y: 2, z: 2 },
                    },
                }}
                WHERE general__entity_id = ${entity.general__entity_id}
            `;

            // Capture second tick
            const [tick2] = await sql<[Tick.I_Tick]>`
                SELECT * FROM tick.capture_tick_state(${syncGroup})
            `;

            // Get changed states
            const changes = await sql<Tick.I_EntityUpdate[]>`
                SELECT * FROM tick.get_changed_entity_states_between_latest_ticks(${syncGroup})
            `;

            expect(changes.length).toBeGreaterThanOrEqual(1);
            const entityChange = changes.find(
                (c) => c.general__entity_id === entity.general__entity_id,
            );
            expect(entityChange).toBeTruthy();
            expect(entityChange?.operation).toBe("UPDATE");
            expect(entityChange?.changes.meta__data).toEqual({
                [scriptNamespace]: {
                    position: { x: 2, y: 2, z: 2 },
                },
            });

            // Clean up
            await sql`DELETE FROM entity.entities WHERE general__entity_id = ${entity.general__entity_id}`;
        });
    });

    afterAll(async () => {
        // Disconnect using PostgresClient
        await PostgresClient.getInstance().disconnect();
    });
});
