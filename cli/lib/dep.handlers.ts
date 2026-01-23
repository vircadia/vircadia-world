import { type ServiceDefinition, getServicePath, resolveServices } from "./service.registry";
import { EnvManager } from "./common.modules";
import { ContainerActionHandler } from "./action.handlers";
import { Logger, runShellCommand } from "./utils";
import path from "path";

export class DependencyActionHandler {
    static async handle(action: string, services: ServiceDefinition[], options: any) {
        // Filter for services that have dependency management needs (client, sdk, cli, repo? api?)
        // Most "api" services in this repo are docker-based but might have local code?
        // Assuming client and sdk are the main ones with package.json that we want to manage.
        
        const targetServices = services.filter(s => ["client", "sdk", "dev", "api", "core"].includes(s.category));
        
        for (const service of targetServices) {
            Logger.info(`Performing ${action} for ${service.name}...`);
            try {
                switch (action) {
                    case "install":
                        await this.install(service);
                        break;
                    case "uninstall":
                        await this.uninstall(service);
                        break;
                    case "build":
                        await this.build(service);
                        break;
                    case "dev":
                        await this.dev(service, options);
                        break;
                    default:
                        // Ignore unknown actions for dependencies
                        break;
                }
            } catch (error) {
                Logger.error(`Failed to ${action} ${service.name}: ${error}`);
            }
        }
    }

    private static async install(service: ServiceDefinition) {
        const cwd = getServicePath(service);
        if (cwd) {
            await runShellCommand(["bun", "install"], cwd);
        } else {
            Logger.info(`Skipping install for ${service.name} (no local path)`);
        }
    }

    private static async uninstall(service: ServiceDefinition) {
         const cwd = getServicePath(service);
         if (cwd) {
             const nodeModules = path.join(cwd, "node_modules");
             await runShellCommand(["rm", "-rf", nodeModules], cwd);
             Logger.success(`Removed node_modules for ${service.name}`);
         }
    }

    private static async build(service: ServiceDefinition) {
        if (service.name === "repo") return;

        const cwd = getServicePath(service);
        if (cwd) {
             // Check if build script exists?
             // Just try running bun run build
             try {
                 await runShellCommand(["bun", "run", "build"], cwd);
             } catch (e) {
                 Logger.warn(`Build failed or no build script for ${service.name}`);
             }
        }
    }

    private static async dev(service: ServiceDefinition, options: any) {
        const cwd = getServicePath(service);
        if (cwd) {
            const args = ["bun", "run", "dev"];
            const env: Record<string, string> = {};

            if (options.local && service.name === "client") {
                // Set local dev environment variables for the client
                env["VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_HOST"] = "localhost";
                env["VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_WS_URI_USING_SSL"] = "false";
                env["VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_REST_AUTH_URI_USING_SSL"] = "false";
                env["VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_REST_ASSET_URI_USING_SSL"] = "false";
                env["VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_REST_INFERENCE_URI_USING_SSL"] = "false";
            }

            if (options.local && service.name !== "client") {
                // Generic local mode for other services if needed
                args.push("--", "--mode", "local");
            }
            
            await runShellCommand(args, cwd, env);
        }
    }
}

