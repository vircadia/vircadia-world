import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import type postgres from "postgres";
import { createSqlClient } from "../container/docker/docker_cli";
import type {
    Tick,
    Entity,
} from "../../sdk/vircadia-world-sdk-ts/schema/schema.general";

describe("World Tick Tests", () => {
    let sql: postgres.Sql;

    // Setup before all tests
    beforeAll(async () => {
        sql = createSqlClient(true);
    });

    describe("Tick Operations", () => {
        test("should create and manage world ticks", async () => {
            const syncGroup = "public.NORMAL";

            // Create first tick and get full tick record
            const [{ capture_tick_state: tick1Id }] = await sql<
                [{ capture_tick_state: string }]
            >`
                SELECT * FROM tick.capture_tick_state(${syncGroup})
            `;
            expect(tick1Id).toBeTruthy();

            // Verify tick record exists and check its properties
            const [tickRecord1] = await sql<[Tick.I_WorldTick]>`
                SELECT * FROM tick.world_ticks 
                WHERE general__tick_id = ${tick1Id}
            `;
            expect(tickRecord1).toBeTruthy();
            expect(tickRecord1.group__sync).toBe(syncGroup);
            expect(tickRecord1.tick__states_processed).toBeGreaterThanOrEqual(
                0,
            );
            expect(tickRecord1.tick__duration_ms).toBeGreaterThan(0);
            expect(tickRecord1.tick__start_time).toBeTruthy();
            expect(tickRecord1.tick__end_time).toBeTruthy();

            // Create second tick and verify it has different properties
            const [{ capture_tick_state: tick2Id }] = await sql<
                [{ capture_tick_state: string }]
            >`
                SELECT * FROM tick.capture_tick_state(${syncGroup})
            `;
            const [tickRecord2] = await sql<[Tick.I_WorldTick]>`
                SELECT * FROM tick.world_ticks 
                WHERE general__tick_id = ${tick2Id}
            `;

            expect(tickRecord2).toBeTruthy();
            expect(tickRecord2.general__tick_id).not.toBe(
                tickRecord1.general__tick_id,
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

            // Create an entity
            const [entity] = await sql<[Entity.I_Entity]>`
                INSERT INTO entity.entities (
                    general__name,
                    meta__data,
                    group__sync
                ) VALUES (
                    ${"Test Entity"},
                    ${{ position: { x: 0, y: 0, z: 0 } }}::jsonb,
                    ${syncGroup}
                ) RETURNING *
            `;

            // Capture tick state
            const [{ capture_tick_state: tickId }] = await sql<
                [{ capture_tick_state: string }]
            >`
                SELECT * FROM tick.capture_tick_state(${syncGroup})
            `;

            // Verify entity state was captured
            const [entityState] = await sql<[Tick.I_EntityState]>`
                SELECT * FROM tick.entity_states 
                WHERE general__entity_id = ${entity.general__entity_id}
                AND general__tick_id = ${tickId}
            `;

            expect(entityState).toBeTruthy();
            expect(entityState.general__name).toBe("Test Entity");
            expect(entityState.group__sync).toBe(syncGroup);

            // Clean up
            await sql`DELETE FROM entity.entities WHERE general__entity_id = ${entity.general__entity_id}`;
        });

        test("should detect entity changes between ticks", async () => {
            const syncGroup = "public.NORMAL";

            // Create initial entity
            const [entity] = await sql<[Entity.I_Entity]>`
                INSERT INTO entity.entities (
                    general__name,
                    meta__data,
                    group__sync
                ) VALUES (
                    ${"Original Name"},
                    ${{ position: { x: 0, y: 0, z: 0 } }}::jsonb,
                    ${syncGroup}
                ) RETURNING *
            `;

            // Capture first tick
            const [{ capture_tick_state: tick1 }] = await sql<
                [{ capture_tick_state: string }]
            >`
                SELECT * FROM tick.capture_tick_state(${syncGroup})
            `;

            // Update entity
            await sql`
                UPDATE entity.entities 
                SET general__name = ${"Updated Name"},
                    meta__data = ${{ position: { x: 1, y: 1, z: 1 } }}::jsonb
                WHERE general__entity_id = ${entity.general__entity_id}
            `;

            // Capture second tick
            const [{ capture_tick_state: tick2 }] = await sql<
                [{ capture_tick_state: string }]
            >`
                SELECT * FROM tick.capture_tick_state(${syncGroup})
            `;

            // Get changes between ticks
            const changes = await sql<
                Array<{ operation: Tick.E_OperationType; entity_id: string }>
            >`
                SELECT * FROM tick.get_entity_changes(
                    ${syncGroup},
                    (SELECT tick__start_time FROM tick.world_ticks WHERE general__tick_id = ${tick1}),
                    (SELECT tick__start_time FROM tick.world_ticks WHERE general__tick_id = ${tick2})
                )
            `;

            expect(changes).toHaveLength(1);
            expect(changes[0].operation).toBe("UPDATE");
            expect(changes[0].entity_id).toBe(entity.general__entity_id);

            // Clean up
            await sql`DELETE FROM entity.entities WHERE general__entity_id = ${entity.general__entity_id}`;
        });
    });

    afterAll(async () => {
        await sql.end();
    });
});
