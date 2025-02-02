import {
    describe,
    test,
    expect,
    beforeAll,
    afterAll,
    beforeEach,
    afterEach,
} from "bun:test";
import type postgres from "postgres";
import { log } from "../../sdk/vircadia-world-sdk-ts/module/general/log";
import { createSqlClient } from "../container/docker/docker_cli";
import {
    type Config,
    Entity,
    type Agent,
    type Tick,
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

describe("Database Tests", () => {
    let sql: postgres.Sql;
    let admin: TestAccount;
    let agent: TestAccount;
    let testResources: TestResources;

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
            // Clean up any existing test accounts first
            await sql`
                DELETE FROM auth.agent_profiles 
                WHERE profile__username IN ('test_admin', 'test_agent')
            `;

            // Get client settings from config
            const [clientConfig] = await sql<[Config.I_Config]>`
                SELECT general__value FROM config.config 
                WHERE general__key = 'client_settings'
            `;

            if (!clientConfig?.general__value?.auth) {
                throw new Error("Auth settings not found in database");
            }

            // Create test admin account
            const [adminAccount] = await sql`
                INSERT INTO auth.agent_profiles (profile__username, auth__email)
                VALUES ('test_admin', 'test_admin@test.com')
                RETURNING general__agent_profile_id
            `;
            const adminId = adminAccount.general__agent_profile_id;

            // Assign admin role
            await sql`
                INSERT INTO auth.agent_roles (auth__agent_id, auth__role_name, auth__is_active)
                VALUES (${adminId}, 'admin', true)
            `;

            // Create test regular agent account
            const [agentAccount] = await sql`
                INSERT INTO auth.agent_profiles (profile__username, auth__email)
                VALUES ('test_agent', 'test_agent@test.com')
                RETURNING general__agent_profile_id
            `;
            const agentId = agentAccount.general__agent_profile_id;

            // Assign agent role
            await sql`
                INSERT INTO auth.agent_roles (auth__agent_id, auth__role_name, auth__is_active)
                VALUES (${agentId}, 'agent', true)
            `;

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
                clientConfig.general__value.auth.secret_jwt,
                {
                    expiresIn:
                        clientConfig.general__value.auth.session_duration_jwt,
                },
            );

            const agentToken = sign(
                {
                    sessionId: agentSessionId,
                    agentId: agentId,
                },
                clientConfig.general__value.auth.secret_jwt,
                {
                    expiresIn:
                        clientConfig.general__value.auth.session_duration_jwt,
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

    async function createTestResources(): Promise<TestResources> {
        try {
            // Create test script
            const [scriptResult] = await sql<[Entity.Script.I_Script]>`
                INSERT INTO entity.entity_scripts (
                    script__compiled__browser__script,
                    script__compiled__browser__script_status,
                    script__source__browser__repo__entry_path
                ) VALUES (
                    'console.log("test script")',
                    ${Entity.Script.E_CompilationStatus.COMPILED},
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
                ) RETURNING general__entity_id
            `;
            const entityId = entityResult.general__entity_id;

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

    describe("Test Environment Setup", () => {
        test("should create and verify test accounts", async () => {
            // Create test accounts
            const accounts = await createTestAccounts();
            admin = accounts.admin;
            agent = accounts.agent;

            // Verify admin account
            const [adminProfile] = await sql<[Agent.I_Profile]>`
                SELECT * FROM auth.agent_profiles
                WHERE general__agent_profile_id = ${admin.id}
            `;
            expect(adminProfile.profile__username).toBe("test_admin");

            // Verify admin role
            const [adminRole] = await sql<[Agent.I_AgentRole]>`
                SELECT * FROM auth.agent_roles
                WHERE auth__agent_id = ${admin.id}
            `;
            expect(adminRole.auth__role_name).toBe("admin");

            // Verify agent account
            const [agentProfile] = await sql<[Agent.I_Profile]>`
                SELECT * FROM auth.agent_profiles
                WHERE general__agent_profile_id = ${agent.id}
            `;
            expect(agentProfile.profile__username).toBe("test_agent");

            // Verify agent role
            const [agentRole] = await sql<[Agent.I_AgentRole]>`
                SELECT * FROM auth.agent_roles
                WHERE auth__agent_id = ${agent.id}
            `;
            expect(agentRole.auth__role_name).toBe("agent");

            // Set admin context for subsequent operations
            await sql`SELECT auth.set_agent_context(${admin.sessionId}, ${admin.token})`;
        });

        test("should handle unset agent context gracefully", async () => {
            // Use the new clear_agent_context function instead of set_config
            await sql`SELECT auth.clear_agent_context()`;

            // Get current agent id - should return anon user
            const [result] = await sql`SELECT auth.current_agent_id()`;
            const anonId = await sql`SELECT auth.get_anon_agent_id()`;
            expect(result.current_agent_id).toBe(anonId[0].get_anon_agent_id);
        });

        test("should handle invalid agent context gracefully", async () => {
            // First clear context properly
            await sql`SELECT auth.clear_agent_context()`;

            // Then try setting an invalid value (this should be handled by current_agent_id)
            await sql`SELECT set_config('app.current_agent_id', '', true)`;

            // Get current agent id - should return anon user
            const [result] = await sql`SELECT auth.current_agent_id()`;
            const anonId = await sql`SELECT auth.get_anon_agent_id()`;
            expect(result.current_agent_id).toBe(anonId[0].get_anon_agent_id);
        });

        test("should handle valid agent context", async () => {
            // First verify the session exists and is valid
            const [session] = await sql`
                SELECT * FROM auth.agent_sessions 
                WHERE general__session_id = ${admin.sessionId}
            `;
            console.log("Session check:", session);

            // Add debug logging for the token
            console.log("Token being sent:", admin.token);

            // Try getting the raw result of set_agent_context
            const [contextResult] = await sql`
                SELECT auth.set_agent_context(${admin.sessionId}, ${admin.token}) as success
            `;
            console.log("Context set result:", contextResult);

            // Get current agent id - should return admin's ID
            const [result] = await sql`SELECT auth.current_agent_id()`;
            console.log("Current agent ID:", result.current_agent_id);
            console.log("Expected admin ID:", admin.id);

            expect(result.current_agent_id).toBe(admin.id);
        });

        test("should create and verify test resources", async () => {
            // Create test resources
            testResources = await createTestResources();

            // Verify script creation
            const [script] = await sql<[Entity.Script.I_Script]>`
                SELECT * FROM entity.entity_scripts
                WHERE general__script_id = ${testResources.scriptId}
            `;
            expect(script.script__compiled__browser__script).toBe(
                'console.log("test script")',
            );
            expect(script.script__compiled__browser__script_status).toBe(
                Entity.Script.E_CompilationStatus.COMPILED,
            );

            // Verify entity creation
            const [entity] = await sql<[Entity.I_Entity]>`
                SELECT * FROM entity.entities
                WHERE general__entity_id = ${testResources.entityId}
            `;
            expect(entity.general__name).toBe("Test Entity");
            expect(entity.scripts__ids).toContain(testResources.scriptId);
            expect(entity.permissions__roles__view).toContain("agent");
            expect(entity.permissions__roles__full).toContain("admin");
        });
    });

    describe("Entity CRUD Operations", () => {
        test("should allow admin to create, read, update, and delete entities", async () => {
            // Create entity
            const [entityResult] = await sql<[Entity.I_Entity]>`
                INSERT INTO entity.entities (
                    general__name,
                    meta__data,
                    performance__sync_group
                ) VALUES (
                    ${"Test Entity"},
                    ${JSON.stringify({
                        babylon_js: {
                            model_url: "test.glb",
                            position: { x: 0, y: 0, z: 0 },
                            rotation: { x: 0, y: 0, z: 0, w: 1 },
                            scale: { x: 1, y: 1, z: 1 },
                        },
                    })},
                    ${"NORMAL"}
                ) RETURNING general__entity_id
            `;

            // Read entity
            const [readEntity] = await sql<[Entity.I_Entity]>`
                SELECT * FROM entity.entities
                WHERE general__entity_id = ${entityResult.general__entity_id}
            `;
            expect(readEntity.general__name).toBe("Test Entity");

            // Update entity
            await sql<[Entity.I_Entity]>`
                UPDATE entity.entities
                SET general__name = ${"Updated Entity"}
                WHERE general__entity_id = ${entityResult.general__entity_id}
            `;

            // Verify update
            const [updatedEntity] = await sql<[Entity.I_Entity]>`
                SELECT general__name FROM entity.entities
                WHERE general__entity_id = ${entityResult.general__entity_id}
            `;
            expect(updatedEntity.general__name).toBe("Updated Entity");

            // Delete entity
            await sql<[Entity.I_Entity]>`
                DELETE FROM entity.entities
                WHERE general__entity_id = ${entityResult.general__entity_id}
            `;

            // Verify deletion
            const deletedEntity = await sql<Entity.I_Entity[]>`
                SELECT * FROM entity.entities
                WHERE general__entity_id = ${entityResult.general__entity_id}
            `;
            expect(deletedEntity).toHaveLength(0);
        });

        test("should allow admin to create, read, update, and delete entity scripts", async () => {
            // Create script
            const [scriptResult] = await sql<[Entity.Script.I_Script]>`
                INSERT INTO entity.entity_scripts (
                    script__compiled__node__script,
                    script__compiled__node__script_status
                ) VALUES (
                    ${'console.log("test script")'},
                    ${Entity.Script.E_CompilationStatus.COMPILED}
                ) RETURNING general__script_id
            `;

            // Read script
            const [readScript] = await sql<[Entity.Script.I_Script]>`
                SELECT * FROM entity.entity_scripts
                WHERE general__script_id = ${scriptResult.general__script_id}
            `;
            expect(readScript.script__compiled__node__script).toBe(
                'console.log("test script")',
            );

            // Update script
            await sql<[Entity.Script.I_Script]>`
                UPDATE entity.entity_scripts
                SET script__compiled__node__script = ${'console.log("updated script")'}
                WHERE general__script_id = ${scriptResult.general__script_id}
            `;

            // Verify update
            const [updatedScript] = await sql<[Entity.Script.I_Script]>`
                SELECT script__compiled__node__script FROM entity.entity_scripts
                WHERE general__script_id = ${scriptResult.general__script_id}
            `;
            expect(updatedScript.script__compiled__node__script).toBe(
                'console.log("updated script")',
            );

            // Delete script
            await sql<[Entity.Script.I_Script]>`
                DELETE FROM entity.entity_scripts
                WHERE general__script_id = ${scriptResult.general__script_id}
            `;

            // Verify deletion
            const deletedScript = await sql<Entity.Script.I_Script[]>`
                SELECT * FROM entity.entity_scripts
                WHERE general__script_id = ${scriptResult.general__script_id}
            `;
            expect(deletedScript).toHaveLength(0);
        });
    });

    describe("Tick System", () => {
        beforeEach(async () => {
            // Start a new transaction and set isolation level
            await sql.begin(async (sql) => {
                await sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`;
                // Reset admin context before each test
                await sql`SELECT auth.set_agent_context(${admin.sessionId}, ${admin.token})`;
            });
        });

        test("should capture tick state and return correct metadata", async () => {
            // Create test entity first
            const [entityResult] = await sql<[Entity.I_Entity]>`
                INSERT INTO entity.entities (
                    general__name,
                    meta__data,
                    performance__sync_group
                ) VALUES (
                    ${"Test Entity"},
                    ${JSON.stringify({
                        babylon_js: {
                            model_url: "test.glb",
                            position: { x: 0, y: 0, z: 0 },
                            rotation: { x: 0, y: 0, z: 0, w: 1 },
                            scale: { x: 1, y: 1, z: 1 },
                        },
                    })},
                    ${"NORMAL"}
                ) RETURNING general__entity_id
            `;

            // Capture initial tick state
            const [tickResult] = await sql<
                [
                    {
                        tick_data: Tick.I_TickMetadata;
                        entity_updates: Tick.I_EntityUpdate[];
                        script_updates: Tick.I_ScriptUpdate[];
                    },
                ]
            >`
                SELECT * FROM tick.capture_tick_state('NORMAL')
            `;

            // Verify tick metadata structure
            expect(tickResult.tick_data).toBeDefined();
            expect(typeof tickResult.tick_data.tick_number).toBe("number");
            expect(tickResult.tick_data.tick_start_time).toBeDefined();
            expect(tickResult.tick_data.tick_end_time).toBeDefined();
            expect(typeof tickResult.tick_data.tick_duration_ms).toBe("number");
            expect(typeof tickResult.tick_data.is_delayed).toBe("boolean");
            expect(typeof tickResult.tick_data.headroom_ms).toBe("number");

            // Verify entity updates
            expect(Array.isArray(tickResult.entity_updates)).toBe(true);
            const entityUpdate = tickResult.entity_updates.find(
                (update) => update.entityId === entityResult.general__entity_id,
            );
            expect(entityUpdate).toBeDefined();
            expect(entityUpdate?.operation).toBe("INSERT");
            expect(entityUpdate?.entityChanges).toBeDefined();
            expect(entityUpdate?.sessionIds).toBeDefined();
            expect(entityUpdate?.entityStatus).toBe("ACTIVE");

            // Clean up
            await sql`
                DELETE FROM entity.entities
                WHERE general__entity_id = ${entityResult.general__entity_id}
            `;
        });

        test("should track entity changes between ticks", async () => {
            // Create initial entity
            const entityId = await sql`
                INSERT INTO entity.entities (
                    general__name,
                    meta__data,
                    performance__sync_group
                ) VALUES (
                    ${"Initial Name"},
                    ${JSON.stringify({
                        babylon_js: {
                            model_url: "test.glb",
                            position: { x: 0, y: 0, z: 0 },
                            rotation: { x: 0, y: 0, z: 0, w: 1 },
                            scale: { x: 1, y: 1, z: 1 },
                        },
                    })},
                    ${"NORMAL"}
                ) RETURNING general__entity_id
            `;

            // Capture first tick
            await sql`SELECT * FROM tick.capture_tick_state('NORMAL')`;

            // Update entity
            await sql`
                UPDATE entity.entities
                SET general__name = ${"Updated Name"}
                WHERE general__entity_id = ${entityId[0].general__entity_id}
            `;

            // Capture second tick and check for changes
            const [secondTickResult] = await sql`
                SELECT * FROM tick.capture_tick_state('NORMAL')
            `;

            const entityUpdate = secondTickResult.entity_updates.find(
                (update: Tick.I_EntityUpdate) =>
                    update.entityId === entityId[0].general__entity_id,
            );
            expect(entityUpdate).toBeDefined();
            expect(entityUpdate.operation).toBe("UPDATE");
            expect(entityUpdate.entity_changes.general__name).toBe(
                "Updated Name",
            );

            // Clean up
            await sql`
                DELETE FROM entity.entities
                WHERE general__entity_id = ${entityId[0].general__entity_id}
            `;
        });

        test("should track script changes between ticks", async () => {
            // Create initial script
            const scriptId = await sql`
                INSERT INTO entity.entity_scripts (
                    script__compiled__node__script,
                    script__compiled__node__script_status
                ) VALUES (
                    ${'console.log("initial script")'},
                    ${"COMPILED"}
                ) RETURNING general__script_id
            `;

            // Capture first tick
            await sql`SELECT * FROM tick.capture_tick_state('NORMAL')`;

            // Update script
            await sql`
                UPDATE entity.entity_scripts
                SET script__compiled__node__script = ${'console.log("updated script")'}
                WHERE general__script_id = ${scriptId[0].general__script_id}
            `;

            // Capture second tick and check for changes
            const [secondTickResult] = await sql`
                SELECT * FROM tick.capture_tick_state('NORMAL')
            `;

            const scriptUpdate = secondTickResult.script_updates.find(
                (update: Tick.I_ScriptUpdate) =>
                    update.scriptId === scriptId[0].general__script_id,
            );
            expect(scriptUpdate).toBeDefined();
            expect(scriptUpdate.operation).toBe("UPDATE");
            expect(
                scriptUpdate.script_changes.script__compiled__node__script,
            ).toBe('console.log("updated script")');

            // Clean up
            await sql`
                DELETE FROM entity.entity_scripts
                WHERE general__script_id = ${scriptId[0].general__script_id}
            `;
        });

        test("should handle entity deletion in tick updates", async () => {
            // Create entity
            const entityId = await sql`
                INSERT INTO entity.entities (
                    general__name,
                    meta__data,
                    performance__sync_group
                ) VALUES (
                    ${"To Be Deleted"},
                    ${JSON.stringify({
                        babylon_js: {
                            model_url: "test.glb",
                            position: { x: 0, y: 0, z: 0 },
                            rotation: { x: 0, y: 0, z: 0, w: 1 },
                            scale: { x: 1, y: 1, z: 1 },
                        },
                    })},
                    ${"NORMAL"}
                ) RETURNING general__entity_id
            `;

            // Capture first tick
            await sql`SELECT * FROM tick.capture_tick_state('NORMAL')`;

            // Delete entity
            await sql`
                DELETE FROM entity.entities
                WHERE general__entity_id = ${entityId[0].general__entity_id}
            `;

            // Capture second tick and check for deletion
            const [secondTickResult] = await sql`
                SELECT * FROM tick.capture_tick_state('NORMAL')
            `;

            const entityUpdate = secondTickResult.entity_updates.find(
                (update: Tick.I_EntityUpdate) =>
                    update.entityId === entityId[0].general__entity_id,
            );
            expect(entityUpdate).toBeDefined();
            expect(entityUpdate.operation).toBe("DELETE");
        });

        test("should respect sync group settings", async () => {
            // Create entities in different sync groups
            const [realtimeEntity] = await sql`
                INSERT INTO entity.entities (
                    general__name,
                    meta__data,
                    performance__sync_group
                ) VALUES (
                    ${"Realtime Entity"},
                    ${JSON.stringify({
                        babylon_js: {
                            model_url: "test.glb",
                            position: { x: 0, y: 0, z: 0 },
                            rotation: { x: 0, y: 0, z: 0, w: 1 },
                            scale: { x: 1, y: 1, z: 1 },
                        },
                    })},
                    ${"REALTIME"}
                ) RETURNING general__entity_id
            `;

            const [backgroundEntity] = await sql`
                INSERT INTO entity.entities (
                    general__name,
                    meta__data,
                    performance__sync_group
                ) VALUES (
                    ${"Background Entity"},
                    ${JSON.stringify({
                        babylon_js: {
                            model_url: "test.glb",
                            position: { x: 0, y: 0, z: 0 },
                            rotation: { x: 0, y: 0, z: 0, w: 1 },
                            scale: { x: 1, y: 1, z: 1 },
                        },
                    })},
                    ${"BACKGROUND"}
                ) RETURNING general__entity_id
            `;

            // Capture REALTIME tick
            const [realtimeTick] = await sql`
                SELECT * FROM tick.capture_tick_state('REALTIME')
            `;

            // Verify only REALTIME entity is included
            expect(
                realtimeTick.entity_updates.some(
                    (update: Tick.I_EntityUpdate) =>
                        update.entityId === realtimeEntity.general__entity_id,
                ),
            ).toBe(true);
            expect(
                realtimeTick.entity_updates.some(
                    (update: Tick.I_EntityUpdate) =>
                        update.entityId === backgroundEntity.general__entity_id,
                ),
            ).toBe(false);

            // Clean up
            await sql`
                DELETE FROM entity.entities
                WHERE general__entity_id IN (${realtimeEntity.general__entity_id}, ${backgroundEntity.general__entity_id})
            `;
        });

        afterEach(async () => {
            // Rollback transaction after each test
            await sql`ROLLBACK`;
        });
    });

    describe("Test Environment Cleanup", () => {
        test("should cleanup test resources", async () => {
            try {
                // Clean up entities and scripts
                await sql`DELETE FROM entity.entities WHERE general__entity_id = ${testResources.entityId}`;
                await sql`DELETE FROM entity.entity_scripts WHERE general__script_id = ${testResources.scriptId}`;

                // Verify script deletion
                const scripts = await sql<Entity.Script.I_Script[]>`
                    SELECT * FROM entity.entity_scripts
                    WHERE general__script_id = ${testResources.scriptId}
                `;
                expect(scripts).toHaveLength(0);

                // Verify entity deletion
                const entities = await sql<Entity.I_Entity[]>`
                    SELECT * FROM entity.entities
                    WHERE general__entity_id = ${testResources.entityId}
                `;
                expect(entities).toHaveLength(0);
            } catch (error) {
                log({
                    message: "Failed to cleanup test resources",
                    type: "error",
                    error,
                });
                throw error;
            }
        });

        test("should cleanup test accounts", async () => {
            try {
                // Clean up profiles (roles and sessions will cascade)
                await sql`
                    DELETE FROM auth.agent_profiles 
                    WHERE profile__username IN ('test_admin', 'test_agent')
                `;

                // Verify account deletion
                const profiles = await sql<Agent.I_Profile[]>`
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
