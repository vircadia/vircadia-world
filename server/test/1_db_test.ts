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
import { VircadiaConfig_Server } from "../../sdk/vircadia-world-sdk-ts/config/vircadia.config";

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
            log({
                message: "Session check:",
                type: "debug",
                data: session,
                debug: VircadiaConfig_Server.debug,
            });

            // Add debug logging for the token
            log({
                message: "Token being sent:",
                type: "debug",
                data: { token: admin.token },
                debug: VircadiaConfig_Server.debug,
            });

            // Try getting the raw result of set_agent_context
            const [contextResult] = await sql`
                SELECT auth.set_agent_context(${admin.sessionId}, ${admin.token}) as success
            `;
            log({
                message: "Context set result:",
                type: "debug",
                data: contextResult,
                debug: VircadiaConfig_Server.debug,
            });

            // Get current agent id - should return admin's ID
            const [result] = await sql`SELECT auth.current_agent_id()`;
            log({
                message: "Current agent ID:",
                type: "debug",
                data: result.current_agent_id,
                debug: VircadiaConfig_Server.debug,
            });
            log({
                message: "Expected admin ID:",
                type: "debug",
                data: { adminId: admin.id },
                debug: VircadiaConfig_Server.debug,
            });
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
                    group__sync
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
                    group__sync
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
                ) RETURNING *
            `;

            // Get the tick state
            const [tickResult] = await sql<[{ tick_state: Tick.I_TickState }]>`
                SELECT tick.capture_tick_state('NORMAL') as tick_state
            `;

            const { tick_data, entity_updates, script_updates } =
                tickResult.tick_state;

            // Verify tick metadata structure matches schema
            expect(tick_data).toMatchObject({
                tick_number: expect.any(Number),
                tick_start_time: expect.any(String),
                tick_end_time: expect.any(String),
                tick_duration_ms: expect.any(Number),
                is_delayed: expect.any(Boolean),
                headroom_ms: expect.any(Number),
                delta_time_ms: expect.any(Number),
                time_until_next_tick_ms: expect.any(Number),
                tick_lag: expect.any(Number),
                entity_states_processed: expect.any(Number),
                script_states_processed: expect.any(Number),
                rate_limited: expect.any(Boolean),
            });

            // Verify entity updates
            expect(Array.isArray(entity_updates)).toBe(true);
            const entityUpdate = entity_updates.find(
                (update) => update.entityId === entityResult.general__entity_id,
            );
            expect(entityUpdate).toBeDefined();
            expect(entityUpdate).toMatchObject({
                entityId: entityResult.general__entity_id,
                operation: "INSERT",
                entityChanges: expect.any(Object),
                sessionIds: expect.any(Array),
            });

            // Clean up
            await sql`
                DELETE FROM entity.entities
                WHERE general__entity_id = ${entityResult.general__entity_id}
            `;
        });

        test("should track entity changes between ticks", async () => {
            // Create initial entity
            const [entityResult] = await sql<[Entity.I_Entity]>`
                INSERT INTO entity.entities (
                    general__name,
                    meta__data,
                    group__sync
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
                ) RETURNING *
            `;

            // Capture first tick
            await sql`SELECT tick.capture_tick_state('NORMAL')`;

            // Update entity
            await sql`
                UPDATE entity.entities
                SET general__name = ${"Updated Name"}
                WHERE general__entity_id = ${entityResult.general__entity_id}
            `;

            // Capture second tick
            const [secondTickResult] = await sql<
                [{ tick_state: Tick.I_TickState }]
            >`
                SELECT tick.capture_tick_state('NORMAL') as tick_state
            `;

            const entityUpdate =
                secondTickResult.tick_state.entity_updates.find(
                    (update) =>
                        update.entityId === entityResult.general__entity_id,
                );

            expect(entityUpdate).toBeDefined();
            expect(entityUpdate).toMatchObject({
                entityId: entityResult.general__entity_id,
                operation: "UPDATE",
                entityChanges: {
                    general__name: "Updated Name",
                },
                sessionIds: expect.any(Array),
            });

            // Clean up
            await sql`
                DELETE FROM entity.entities
                WHERE general__entity_id = ${entityResult.general__entity_id}
            `;
        });

        test("should track script changes between ticks", async () => {
            // Create initial script
            const [scriptResult] = await sql<[Entity.Script.I_Script]>`
                INSERT INTO entity.entity_scripts (
                    script__compiled__node__script,
                    script__compiled__node__script_status,
                    group__sync
                ) VALUES (
                    ${'console.log("initial script")'},
                    ${Entity.Script.E_CompilationStatus.COMPILED},
                    ${"NORMAL"}
                ) RETURNING *
            `;

            // Capture first tick
            await sql`SELECT tick.capture_tick_state('NORMAL')`;

            // Update script
            await sql`
                UPDATE entity.entity_scripts
                SET script__compiled__node__script = ${'console.log("updated script")'}
                WHERE general__script_id = ${scriptResult.general__script_id}
            `;

            // Capture second tick
            const [secondTickResult] = await sql<
                [{ tick_state: Tick.I_TickState }]
            >`
                SELECT tick.capture_tick_state('NORMAL') as tick_state
            `;

            const scriptUpdate =
                secondTickResult.tick_state.script_updates.find(
                    (update) =>
                        update.scriptId === scriptResult.general__script_id,
                );

            expect(scriptUpdate).toBeDefined();
            expect(scriptUpdate).toMatchObject({
                scriptId: scriptResult.general__script_id,
                operation: "UPDATE",
                scriptChanges: {
                    script__compiled__node__script:
                        'console.log("updated script")',
                },
                sessionIds: expect.any(Array),
            });

            // Clean up
            await sql`
                DELETE FROM entity.entity_scripts
                WHERE general__script_id = ${scriptResult.general__script_id}
            `;
        });

        test("should respect sync group settings", async () => {
            // Create entities in different sync groups
            const [realtimeEntity] = await sql<[Entity.I_Entity]>`
                INSERT INTO entity.entities (
                    general__name,
                    meta__data,
                    group__sync
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
                ) RETURNING *
            `;

            const [backgroundEntity] = await sql<[Entity.I_Entity]>`
                INSERT INTO entity.entities (
                    general__name,
                    meta__data,
                    group__sync
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
                ) RETURNING *
            `;

            // Capture REALTIME tick
            const [realtimeTick] = await sql<
                [{ tick_state: Tick.I_TickState }]
            >`
                SELECT tick.capture_tick_state('REALTIME') as tick_state
            `;

            // Verify only REALTIME entity is included
            expect(
                realtimeTick.tick_state.entity_updates.some(
                    (update) =>
                        update.entityId === realtimeEntity.general__entity_id,
                ),
            ).toBe(true);
            expect(
                realtimeTick.tick_state.entity_updates.some(
                    (update) =>
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

    describe("Session Management", () => {
        test("should handle expired sessions correctly", async () => {
            // Create a test session with immediate expiration
            const [expiredSession] = await sql<
                [{ general__session_id: string; session__expires_at: string }]
            >`
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
                ) RETURNING general__session_id, session__expires_at
            `;

            // First cleanup old/expired sessions
            await sql`SELECT auth.cleanup_old_sessions()`;

            // Then try to set context with expired session
            await sql`SELECT auth.set_agent_context(${expiredSession.general__session_id}, 'test_token')`;

            // Check current agent - should be anon since session is expired
            const [currentAgent] = await sql`SELECT auth.current_agent_id()`;
            const [anonId] = await sql`SELECT auth.get_anon_agent_id()`;
            expect(currentAgent.current_agent_id).toBe(
                anonId.get_anon_agent_id,
            );

            // Verify session is marked as inactive
            const [sessionStatus] = await sql`
                SELECT session__is_active 
                FROM auth.agent_sessions 
                WHERE general__session_id = ${expiredSession.general__session_id}
            `;
            expect(sessionStatus.session__is_active).toBe(false);
        });

        test("should cleanup old sessions", async () => {
            // Create multiple old sessions
            await sql`
                INSERT INTO auth.agent_sessions (
                    auth__agent_id,
                    auth__provider_name,
                    session__last_seen_at,
                    session__expires_at,
                    session__is_active
                ) VALUES 
                (
                    ${admin.id},
                    'test',
                    NOW() - INTERVAL '2 days',
                    NOW() + INTERVAL '1 day',
                    true
                ),
                (
                    ${agent.id},
                    'test',
                    NOW() - INTERVAL '3 days',
                    NOW() + INTERVAL '1 day',
                    true
                )
            `;

            // Run cleanup function
            const [cleanupResult] = await sql<
                [{ cleanup_old_sessions: number }]
            >`
                SELECT auth.cleanup_old_sessions() as cleanup_old_sessions
            `;

            // Verify old sessions were cleaned up
            expect(cleanupResult.cleanup_old_sessions).toBeGreaterThanOrEqual(
                2,
            );

            // Verify sessions are marked as inactive
            const activeSessions = await sql`
                SELECT COUNT(*)::INTEGER as count 
                FROM auth.agent_sessions 
                WHERE session__last_seen_at < NOW() - INTERVAL '1 day'
                AND session__is_active = true
            `;
            expect(activeSessions[0].count).toBe(0);
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
