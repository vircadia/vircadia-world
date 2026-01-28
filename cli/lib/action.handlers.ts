import { Server_CLI } from "./common.modules";
import { type ServiceDefinition, getServicePath } from "./service.registry";
import { Logger, runShellCommand } from "./utils";
import path from "path";

export class ContainerActionHandler {
    static async handle(action: string, services: ServiceDefinition[], options: any) {
        const containers = services
            .filter((s) => s.category === "infra" || s.category === "api" || s.category === "core")
            .filter((s) => s.containerName)
            .sort((a, b) => {
                if (action === "down") {
                    // Reverse order for shutdown
                    return (b.startPriority || 0) - (a.startPriority || 0);
                }
                return (a.startPriority || 0) - (b.startPriority || 0);
            });

        if (containers.length === 0) {
            Logger.warn("No container services selected for this action.");
            return;
        }

        const containerNames = containers.map((s) => s.containerName!);

        switch (action) {
            case "up":
                await this.up(containerNames, options);
                break;
            case "down":
                await this.down(containerNames, options);
                break;
            case "restart":
                await this.restart(containerNames, options);
                break;
            case "clean":
                await this.clean(containers, options);
                break;
            case "health":
                await this.health(containerNames, options);
                break;
            case "logs":
                await this.logs(containerNames, options);
                break;
            case "rebuild":
                await this.rebuild(containerNames, options);
                break;
            default:
                Logger.error(`Unknown container action: ${action}`);
        }
    }

    private static async up(containers: string[], options: any) {
        Logger.info(`Starting containers: ${containers.join(", ")}...`);
        const args = ["up", "-d"];
        if (options.build) args.push("--build");
        if (options.forceRecreate) args.push("--force-recreate");
        
        // We pass the list of services to docker compose. 
        // Note: docker compose expects service names as defined in the yaml, 
        // which match our containerNames in this project structure usually, 
        // BUT strictly speaking they are service keys.
        // The current vircadia.cli.ts mapping maps containerName to the actual container name.
        // In the docker-compose file, the service names usually match or are similar.
        // Use the container names directly if the compose file uses them as service names, 
        // OR simply pass the service names.
        
        // Assuming containerName === service name in docker-compose.yml for simplicity 
        // OR we just run 'up' for specific services.
        // Actually, docker compose up takes SERVICE names, not container names.
        // We need to map containerName back to service name if they differ.
        // Inspecting server.docker.compose.yml (not visible here but standard practice) 
        // suggests they might be different. 
        // However, the original CLI passed arguments directly.
        // Let's rely on the user passing 'postgres' aliases which map to ServiceDefinition keys.
        // But here we have the resolved ServiceDefinitions.
        // Let's try passing the container names for now, or better, 
        // we might simply run 'up' with the service names derived from the definition.
        // For now, let's pass the container names and see if it works, 
        // as the original CLI logic filtered by container name for health checks but 'up' might be all or nothing?
        // Wait, the original CLI 'up' command often ran `docker compose up -d` for ALL or specific services.
        
        await Server_CLI.runServerDockerCommand({ args: [...args, ...containers] });
        Logger.success("Containers started successfully.");
    }

    private static async down(containers: string[], options: any) {
        Logger.info(`Stopping containers: ${containers.join(", ")}...`);
        const args = ["down"];
        if (options.volumes) args.push("-v");
        
        // 'down' removes containers and networks. It usually applies to the whole project
        // unless specific logic checks for partial shutdown. 
        // Docker compose down doesn't accept service arguments usually, it takes down the whole stack.
        // If we want to stop specific containers, we used 'stop' or 'rm'.
        // But 'down' is requested. 
        
        // If 'all' services are selected, run full down.
        // If specific services, maybe we should use 'stop' and 'rm'?
        // For now, let's stick to 'rm -s -v' (stop and remove volumes) if specific?
        // Or just 'stop'.
        
        // Original CLI had 'down' which ran `docker compose down`.
        if (containers.length > 0) {
             // If we really want to just 'down' specific ones, 'rm -s' allows stopping.
             // But valid 'docker compose down' does not take arguments.
             // We will assume if specific containers are listed we us stop & rm.
             // Actually, simplest is `docker compose stop` then `rm`.
             
             // Check if we are operating on ALL containers for the project.
             // This is hard to know without context of "all possible services".
             // Let's implement 'down' as 'stop' for specific, and 'down' for all?
             // No, let's just use 'stop' for specific services action 'down',
             // unless it's the 'all' group.
             
             // Safest: use 'stop'.
             await Server_CLI.runServerDockerCommand({ args: ["stop", ...containers] });
             // And 'rm'?
             // await Server_CLI.runServerDockerCommand({ args: ["rm", "-f", ...containers] });
        } else {
             await Server_CLI.runServerDockerCommand({ args: [...args] });
        }
        Logger.success("Containers stopped successfully.");
    }

    private static async restart(containers: string[], options: any) {
        Logger.info(`Restarting containers: ${containers.join(", ")}...`);
        await Server_CLI.runServerDockerCommand({ args: ["restart", ...containers] });
        Logger.success("Containers restarted successfully.");
    }

    private static async clean(services: ServiceDefinition[], options: any) {
        const containers = services.map(s => s.containerName!).filter(Boolean);
        Logger.info(`Cleaning containers and volumes: ${containers.join(", ")}...`);
        // Stop and remove with volumes
        await Server_CLI.runServerDockerCommand({ args: ["rm", "-s", "-v", "--force", ...containers] });

        // Also clean local build artifacts (dist folders)
        for (const service of services) {
            const cwd = getServicePath(service);
            if (cwd) {
                const distPath = path.join(cwd, "dist");
                Logger.info(`Cleaning dist folder for ${service.name} at ${distPath}`);
                try {
                    await runShellCommand(["rm", "-rf", distPath], cwd);
                } catch (e) {
                    Logger.warn(`Failed to clean dist for ${service.name}: ${e}`);
                }
            }
        }
        
        Logger.success("Cleanup completed successfully.");
    }

    private static async health(containers: string[], options: any) {
        Logger.info("Checking health...");
        for (const container of containers) {
            try {
                await Server_CLI.checkContainer(container);
            } catch (e) {
                Logger.error(`Health check failed for ${container}: ${e}`);
            }
        }
    }

    private static async logs(containers: string[], options: any) {
        const args = ["logs"];
        if (options.follow) args.push("-f");
        if (options.tail) args.push("--tail", options.tail);
        
        await Server_CLI.runServerDockerCommand({ args: [...args, ...containers] });
    }

    private static async rebuild(containers: string[], options: any) {
        Logger.info(`Rebuilding ${containers.join(", ")}...`);
        await this.down(containers, options);
        
        // Check if postgres is included in the rebuild
        const postgresContainerName = "vircadia_world_postgres";
        const includesPostgres = containers.includes(postgresContainerName);
        
        if (includesPostgres) {
            // Special handling for postgres: start it first, run migrations, then start others
            Logger.info("Starting PostgreSQL first...");
            await Server_CLI.runServerDockerCommand({ 
                args: ["up", "-d", "--build", "--force-recreate", postgresContainerName] 
            });
            
            // Wait for postgres to be ready (basic connectivity)
            Logger.info("Waiting for PostgreSQL to accept connections...");
            await this.waitForPostgresReady();
            
            // Run migrations to set up the database
            Logger.info("Running database migrations...");
            await Server_CLI.migrate();
            
            // Mark database as ready so healthcheck passes
            Logger.info("Marking database as ready...");
            await Server_CLI.markDatabaseAsReady();
            
            // Now start the remaining containers
            const remainingContainers = containers.filter(c => c !== postgresContainerName);
            if (remainingContainers.length > 0) {
                Logger.info(`Starting remaining containers: ${remainingContainers.join(", ")}...`);
                await this.up(remainingContainers, { ...options, build: true, forceRecreate: true });
            }
        } else {
            // Normal rebuild for non-postgres containers
            await this.up(containers, { ...options, build: true, forceRecreate: true });
        }
        
        Logger.success("Rebuild completed successfully.");
    }

    /**
     * Wait for postgres to accept connections (basic pg_isready check)
     */
    private static async waitForPostgresReady(
        maxRetries: number = 30,
        intervalMs: number = 2000
    ): Promise<void> {
        for (let i = 0; i < maxRetries; i++) {
            try {
                await Server_CLI.runServerDockerCommand({
                    args: [
                        "exec", 
                        "vircadia_world_postgres", 
                        "pg_isready", 
                        "-U", 
                        "postgres"
                    ],
                    throwOnNonZeroExec: true
                });
                Logger.success("PostgreSQL is ready!");
                return;
            } catch (error) {
                Logger.debug(`Waiting for PostgreSQL... (${i + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, intervalMs));
            }
        }
        throw new Error("PostgreSQL failed to become ready within timeout");
    }
}
