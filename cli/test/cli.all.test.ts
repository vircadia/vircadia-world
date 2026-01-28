import { describe, it, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";

// Mocks must be defined before imports if we want to override module behavior easily
// However, with Bun, we often need to be careful with ESM.
// We will use a mock to intercept runShellCommand calls.

const mockRunShellCommand = mock(async (command: string[], cwd?: string, env?: any) => {
    return Promise.resolve();
});

const mockLogger = {
    info: mock((msg: string) => {}),
    warn: mock((msg: string) => {}),
    error: mock((msg: string) => {}),
    success: mock((msg: string) => {}),
    debug: mock((msg: string) => {}),
};

// Mock the utils module
mock.module("../lib/utils", () => {
    return {
        runShellCommand: mockRunShellCommand,
        Logger: mockLogger,
        CLI_LOG_TAG: "CLI_TEST"
    };
});

// We also mock the Server_CLI from common.modules to prevent actual Docker calls
const mockRunServerDockerCommand = mock(async (options: any) => Promise.resolve());
const mockCheckContainer = mock(async (name: string) => Promise.resolve());
const mockMigrate = mock(async () => Promise.resolve(true));
const mockMarkDatabaseAsReady = mock(async () => Promise.resolve());
const mockSeedSql = mock(async () => Promise.resolve());

mock.module("../lib/common.modules", () => {
    return {
        Server_CLI: {
            runServerDockerCommand: mockRunServerDockerCommand,
            checkContainer: mockCheckContainer,
            migrate: mockMigrate,
            markDatabaseAsReady: mockMarkDatabaseAsReady,
            seedSql: mockSeedSql
        }
    };
});

// Now import the modules to test
// Note: In a real environment, if static imports bind before mock.module, we might need dynamic imports.
// But we'll try static first.
import { CommandParser } from "../lib/command.parser";
import { resolveServices, SERVICES } from "../lib/service.registry";
import { ContainerActionHandler } from "../lib/action.handlers";
import { DependencyActionHandler } from "../lib/dep.handlers";
import { DbActionHandler } from "../lib/db.handlers";

describe("CLI Test Suite", () => {
    
    beforeEach(() => {
        mockRunShellCommand.mockClear();
        mockRunServerDockerCommand.mockClear();
        mockCheckContainer.mockClear();
        mockMigrate.mockClear();
        mockMarkDatabaseAsReady.mockClear();
        mockSeedSql.mockClear();
        mockLogger.info.mockClear();
        mockLogger.error.mockClear();
        mockLogger.warn.mockClear();
        mockLogger.success.mockClear();
    });

    describe("Service Registry", () => {
        it("should resolve a single service by name", () => {
            const result = resolveServices(["postgres"]);
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("postgres");
        });

        it("should resolve a single service by alias", () => {
            const result = resolveServices(["pg"]); // 'pg' is alias for postgres
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("postgres");
        });

        it("should resolve a group of services", () => {
            const result = resolveServices(["core"]);
            // core: ["postgres", "pgweb", "ws", "auth", "asset", "inference"]
            const expectedNames = ["postgres", "pgweb", "ws", "auth", "asset", "inference"];
            expect(result).toHaveLength(expectedNames.length);
            expect(result.map(s => s.name)).toEqual(expect.arrayContaining(expectedNames));
        });

        it("should resolve mixed services and groups", () => {
            const result = resolveServices(["postgres", "client"]);
            expect(result).toHaveLength(2);
            const names = result.map(s => s.name);
            expect(names).toContain("postgres");
            expect(names).toContain("client");
        });

        it("should handle unknown services gracefully", () => {
            const result = resolveServices(["unknown_service"]);
            expect(result).toHaveLength(0);
        });

        it("should deduplicate services", () => {
            const result = resolveServices(["postgres", "pg"]); // Same service
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("postgres");
        });
    });

    describe("Command Parser", () => {
        // We can spy on the Handlers to verify dispatch
        // Since handlers are static classes, we can spy on their 'handle' method directly if we imported the class
        // But since we imported them, we can spy on the class methods.
        
        it("should dispatch container actions correctly", async () => {
            const spyContainer = spyOn(ContainerActionHandler, "handle");
            
            // Mock argv: bun cli core up -d
            const args = ["bun", "vircadia.cli.ts", "core", "up", "-d"];
            await CommandParser.parse(args);
            
            expect(spyContainer).toHaveBeenCalled();
            expect(spyContainer.mock.calls[0][0]).toBe("up"); // action
            expect(spyContainer.mock.calls[0][1].length).toBeGreaterThan(1); // services
            expect(spyContainer.mock.calls[0][2]).toEqual({ d: true }); // options
            
            spyContainer.mockRestore();
        });

        it("should dispatch dependency actions correctly", async () => {
            const spyDep = spyOn(DependencyActionHandler, "handle");
            
            // Mock argv: bun cli client build
            const args = ["bun", "cli", "client", "build"];
            await CommandParser.parse(args);
            
            expect(spyDep).toHaveBeenCalled();
            expect(spyDep.mock.calls[0][0]).toBe("build");
            expect(spyDep.mock.calls[0][1][0].name).toBe("client");
            
            spyDep.mockRestore();
        });

        it("should dispatch database actions correctly", async () => {
            const spyDb = spyOn(DbActionHandler, "handle");
            
            // Mock argv: bun cli db migrate
            const args = ["bun", "cli", "db", "migrate"];
            await CommandParser.parse(args);
            
            expect(spyDb).toHaveBeenCalled();
            expect(spyDb.mock.calls[0][0]).toBe("migrate");
            
            spyDb.mockRestore();
        });

        it("should handle unknown services", async () => {
            // Should verify that Logger.error is called
            const args = ["bun", "cli", "unknown-service", "up"];
            await CommandParser.parse(args);
            expect(mockLogger.error).toHaveBeenCalled();
            expect(mockLogger.error.mock.calls[0][0]).toContain("Unknown service");
        });
        
        it("should handle unknown actions", async () => {
             // Mock known service but unknown action
             const args = ["bun", "cli", "core", "unknown-action"];
             await CommandParser.parse(args);
             expect(mockLogger.error).toHaveBeenCalled();
             expect(mockLogger.error.mock.calls[0][0]).toContain("Unknown action");
        });

        it("should parse options with values", async () => {
            const spyContainer = spyOn(ContainerActionHandler, "handle");
            const args = ["bun", "cli", "core", "logs", "--tail", "100", "--follow"];
            await CommandParser.parse(args);
            
            expect(spyContainer).toHaveBeenCalled();
            const opts = spyContainer.mock.calls[0][2];
            expect(opts).toEqual({ tail: "100", follow: true });
            
            spyContainer.mockRestore();
        });
    });

    describe("Container Action Handler", () => {
        const mockServices = resolveServices(["postgres"]);

        it("should handle 'up' action", async () => {
            await ContainerActionHandler.handle("up", mockServices, { d: true });
            expect(mockRunServerDockerCommand).toHaveBeenCalled();
            const callArgs = mockRunServerDockerCommand.mock.calls[0][0].args;
            expect(callArgs).toContain("up");
            expect(callArgs).toContain("-d");
            expect(callArgs).toContain("vircadia_world_postgres"); // Should include container name
        });

        it("should handle 'down' action", async () => {
            await ContainerActionHandler.handle("down", mockServices, {});
            expect(mockRunServerDockerCommand).toHaveBeenCalled();
            // Based on simple implementation inspection:
            // "stop", ...containers
            const callArgs = mockRunServerDockerCommand.mock.calls[0][0].args;
            expect(callArgs[0]).toBe("stop");
            expect(callArgs).toContain("vircadia_world_postgres");
        });
        
        it("should handle 'down' for empty list (all implied by args missing?)", async () => {
            // If the filtered list is empty, it warns
            await ContainerActionHandler.handle("down", [], {});
            expect(mockLogger.warn).toHaveBeenCalledWith("No container services selected for this action.");
        });

        it("should handle 'rebuild' action for postgres (includes migration)", async () => {
            // Rebuild for postgres: down, start postgres, wait for ready, migrate, mark ready
            // Since postgres is included, it does special handling:
            // 1. stop containers
            // 2. start postgres only with build/force-recreate
            // 3. wait for postgres ready (exec pg_isready) - multiple retries possible
            // 4. migrate
            // 5. markDatabaseAsReady
            // No remaining containers in this test since we only have postgres
            
            await ContainerActionHandler.handle("rebuild", mockServices, {});
            
            // Should have at least 2 docker calls: stop and up for postgres
            expect(mockRunServerDockerCommand).toHaveBeenCalled();
            // 1st call: stop
            expect(mockRunServerDockerCommand.mock.calls[0][0].args[0]).toBe("stop");
            // 2nd call: up -d --build --force-recreate vircadia_world_postgres
            const upArgs = mockRunServerDockerCommand.mock.calls[1][0].args;
            expect(upArgs).toContain("up");
            expect(upArgs).toContain("--build");
            expect(upArgs).toContain("--force-recreate");
            expect(upArgs).toContain("vircadia_world_postgres");
            
            // Should have called migrate and markDatabaseAsReady
            expect(mockMigrate).toHaveBeenCalled();
            expect(mockMarkDatabaseAsReady).toHaveBeenCalled();
        });

        it("should handle 'clean' action", async () => {
            await ContainerActionHandler.handle("clean", mockServices, {});
            // Expect rm -s -v --force
            expect(mockRunServerDockerCommand).toHaveBeenCalled();
            const args = mockRunServerDockerCommand.mock.calls[0][0].args;
            expect(args).toContain("rm");
            expect(args).toContain("-v");
        });

        it("should skip non-container services", async () => {
            const noContainerServices = resolveServices(["repo"]); // repo has no container
            await ContainerActionHandler.handle("up", noContainerServices, {});
            expect(mockLogger.warn).toHaveBeenCalledWith("No container services selected for this action.");
            expect(mockRunServerDockerCommand).not.toHaveBeenCalled();
        });
    });

    describe("Dependency Action Handler", () => {
        const clientService = resolveServices(["client"])[0];
        const sdkService = resolveServices(["sdk"])[0];

        it("should install dependencies", async () => {
            await DependencyActionHandler.handle("install", [clientService], {});
            expect(mockRunShellCommand).toHaveBeenCalled();
            const [cmd, cwd] = mockRunShellCommand.mock.calls[0];
            expect(cmd).toEqual(["bun", "install"]);
            // cwd should be path to client
            expect(cwd).toContain("client/web_babylon_js");
        });

        it("should build dependencies", async () => {
            await DependencyActionHandler.handle("build", [sdkService], {});
            expect(mockRunShellCommand).toHaveBeenCalled();
            const [cmd, cwd] = mockRunShellCommand.mock.calls[0];
            expect(cmd).toEqual(["bun", "run", "build"]);
        });

        it("should skip build for 'repo'", async () => {
            const repoService = resolveServices(["repo"])[0];
            await DependencyActionHandler.handle("build", [repoService], {});
            expect(mockRunShellCommand).not.toHaveBeenCalled();
        });

        it("should handle build failure", async () => {
            // Mock failure
            mockRunShellCommand.mockImplementationOnce(() => Promise.reject(new Error("Build error")));
            
            await DependencyActionHandler.handle("build", [sdkService], {});
            
            // It should assume failure logs to error/warn but not throw (as per implementation catch block)
            expect(mockLogger.warn).toHaveBeenCalled();
            expect(mockLogger.warn.mock.calls[0][0]).toContain("Build failed");
        });
        
        it("should run dev with options", async () => {
             await DependencyActionHandler.handle("dev", [clientService], { local: true });
             expect(mockRunShellCommand).toHaveBeenCalled();
             const [cmd, cwd, env] = mockRunShellCommand.mock.calls[0];
             expect(cmd).toEqual(["bun", "run", "dev"]);
             // Verify env vars for local client
             expect(env["VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_HOST"]).toBe("localhost");
        });
    });

    // We can add DB tests similarly, but for brevity/focus on main workflow:
    describe("Database Action Handler", () => {
         // Assuming DbActionHandler calls Server_CLI or DepHandler?
         // Let's assume it calls runServerDockerCommand or similar
         it("should be defined", () => {
             expect(DbActionHandler).toBeDefined();
         });
    });

});
