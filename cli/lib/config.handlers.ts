import { Logger } from "./utils";
import { EnvManager } from "./common.modules";
import { serverConfiguration } from "../../sdk/vircadia-world-sdk-ts/bun/src/config/vircadia.server.config";

export class ConfigActionHandler {
    static async handle(action: string, args: string[], options: any) {
        if (action === "tls") {
            await this.handleTls(args, options);
        } else {
            Logger.error(`Unknown config action: ${action}`);
        }
    }

    private static async handleTls(args: string[], options: any) {
        if (args.length === 0) {
            Logger.error("Missing TLS mode. Usage: bun cli config tls <http|internal|auto>");
            return;
        }

        const mode = args[0];
        const defaultHost = serverConfiguration.VRCA_SERVER_DEFAULT_HOST;

        try {
            if (mode === "http") {
                Logger.info("Switching to HTTP mode...");
                await EnvManager.setVariable(
                    "VRCA_SERVER_SERVICE_CADDY_DOMAIN",
                    `http://${defaultHost}`,
                    "cli"
                );
                await EnvManager.unsetVariable("VRCA_SERVER_SERVICE_CADDY_TLS_MODE", "cli");
                Logger.success("Switched to HTTP mode.");
            } else if (mode === "internal") {
                Logger.info("Switching to Internal HTTPS mode (self-signed)...");
                await EnvManager.setVariable(
                    "VRCA_SERVER_SERVICE_CADDY_DOMAIN",
                    defaultHost,
                    "cli"
                );
                await EnvManager.setVariable(
                    "VRCA_SERVER_SERVICE_CADDY_TLS_MODE",
                    "tls internal",
                    "cli"
                );
                Logger.success("Switched to Internal HTTPS mode.");
            } else if (mode === "auto") {
                Logger.info("Switching to Auto HTTPS mode (Let's Encrypt)...");
                 await EnvManager.setVariable(
                    "VRCA_SERVER_SERVICE_CADDY_DOMAIN",
                    defaultHost,
                    "cli"
                );
                await EnvManager.unsetVariable("VRCA_SERVER_SERVICE_CADDY_TLS_MODE", "cli");
                Logger.success("Switched to Auto HTTPS mode.");
            } else {
                Logger.error(`Unknown TLS mode: ${mode}. Supported modes: http, internal, auto`);
            }
        } catch (error) {
            Logger.error(`Failed to set TLS mode: ${error}`);
        }
    }
}
