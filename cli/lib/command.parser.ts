import { resolveServices } from "./service.registry";
import { ContainerActionHandler } from "./action.handlers";
import { DependencyActionHandler } from "./dep.handlers";
import { DbActionHandler } from "./db.handlers";
import { ConfigActionHandler } from "./config.handlers";
import { Logger } from "./utils";
import { InitActionHandler } from "./init.handlers";

import { DevActionHandler } from "./dev.handlers";

export class CommandParser {
    static async parse(args: string[]) {
        // Basic pattern: bun cli <service-or-group> <action> [options]
        
        // Use commander to handle option parsing, but custom logic for service/action dispatch mechanism 
        // because it's dynamic.
        // Actually, we can just parse the args manually for the first two significant tokens.
        
        // args[0] and args[1] might be bun and cli path.
        // We want the rest.
        
        const meaningfulArgs = args.slice(2);
        
        if (meaningfulArgs.length < 2 && !meaningfulArgs.includes("config") && !meaningfulArgs.includes("init") && !meaningfulArgs.includes("dev")) {
            // Check if it's a help command or no args
             if (meaningfulArgs.includes("--help") || meaningfulArgs.includes("-h") || meaningfulArgs.length === 0) {
                 this.showHelp();
                 return;
             }
        }

        const [target, action, ...rest] = meaningfulArgs;

        // Handle global independent commands
        if (target === "config") {
             // Dispatch to config handler
             await ConfigActionHandler.handle(action, rest, this.parseOptions(rest));
             return;
        }
        
        if (target === "init") {
             // Redirect to init handler
             await InitActionHandler.handle(this.parseOptions(rest));
             return;
        }

        if (target === "dev") {
             // Redirect to dev handler
             // 'dev' might be the target, and action might be options or subcommand? 
             // Pattern: bun cli dev [options]
             // meaningfulArgs would be ["dev", "--local", ...]
             // So rest would be ["--local", ...]
             // But parseOptions expects array.
             
             // Wait, if target is "dev", "action" variable currently holds the second arg which might be "--local" or just empty if none?
             // meaningfulArgs = ["dev"] -> target="dev", action=undefined
             // meaningfulArgs = ["dev", "--local"] -> target="dev", action="--local"
             
             // We need to parse options from everything after "dev".
             const devOptionsArgs = meaningfulArgs.slice(1);
             await DevActionHandler.handle(this.parseOptions(devOptionsArgs));
             return;
        }

        const options = this.parseOptions(rest);
        const services = resolveServices([target]);

        if (services.length === 0) {
            Logger.error(`Unknown service or group: ${target}`);
            return;
        }

        Logger.debug(`Targeting services: ${services.map(s => s.name).join(", ")}`);

        // Dispatch based on action type
        // 1. Container actions
        if (["up", "down", "restart", "clean", "health", "logs", "rebuild"].includes(action)) {
            await ContainerActionHandler.handle(action, services, options);
        }
        // 2. Dependency actions
        else if (["install", "uninstall", "build", "dev"].includes(action)) {
             await DependencyActionHandler.handle(action, services, options);
        }
        // 3. Database actions
        else if (["migrate", "seed", "wipe", "backup", "restore", "token"].includes(action)) {
             await DbActionHandler.handle(action, services, options);
        }
        else {
            Logger.error(`Unknown action: ${action}`);
        }
    }

    private static parseOptions(args: string[]): any {
        const options: any = {};
        for (let i = 0; i < args.length; i++) {
            const arg = args[i];
            if (arg.startsWith("--")) {
                const key = arg.slice(2);
                // Check if next arg is value
                if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
                    options[key] = args[i + 1];
                    i++;
                } else {
                    options[key] = true;
                }
            } else if (arg.startsWith("-")) {
                const key = arg.slice(1);
                 // Check if next arg is value
                if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
                    options[key] = args[i + 1];
                    i++;
                } else {
                    options[key] = true;
                }
            }
        }
        return options;
    }

    private static showHelp() {
        console.log(`
Vircadia CLI

Usage: bun cli <service-or-group> <action> [options]

Service Groups:
  all, core, api, infra

Services:
  postgres, pgweb, caddy
  ws, auth, asset, inference
  state
  client, sdk, cli, repo

Actions:
  Container: up, down, restart, clean, health, logs, rebuild
  Deps:      install, uninstall, build, dev
  Data:      migrate, seed, wipe, backup, restore, token

Examples:
  bun cli core up -d
  bun cli sdk build
  bun cli db seed
  bun cli config tls http
        `);
    }
}
