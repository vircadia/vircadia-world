import { Logger, runShellCommand } from "./utils";
import type { ServiceDefinition } from "./service.registry";
import { Server_CLI } from "./common.modules";

export class DbActionHandler {
    static async handle(action: string, services: ServiceDefinition[], options: any) {
        // DB actions usually target the 'postgres' service specifically. All db:* commands relate to it.
        // We check if postgres is defined in options or just implied by command.
        
        const isDbAction = ["migrate", "seed", "wipe", "backup", "restore", "token"].includes(action);
        if (!isDbAction) return;

        // Ensure postgres is available or we are operating on it
        // Generally these commands run tools that connect to the DB.
        
        // We reuse the existing CLI logic where possible by invoking the functions exposed there,
        // or by rewriting them here. Since we want to refactor, we should move logic here.
        
        // For now, let's wrap the docker commands or script executions.
        
        switch (action) {
            case "migrate":
                await this.migrate();
                break;
            case "seed":
                await this.seed(options);
                break;
            case "wipe":
                await this.wipe();
                break;
            case "backup":
                await this.backup();
                break;
            case "restore":
                await this.restore();
                break;
            case "token":
                await this.token(options);
                break;
        }
    }

    private static async migrate() {
        Logger.info("Running database migrations...");
        await Server_CLI.migrate();
    }

    private static async seed(options: any) {
        Logger.info("Seeding database (SQL)...");
        await Server_CLI.seedSql();
        Logger.info("Seeding database (Assets)...");
        await Server_CLI.seedAssets({
            options: {
                syncGroup: options.syncGroup,
            }
        });
    }

    private static async wipe() {
        Logger.warn("Wiping database...");
        await Server_CLI.wipeDatabase();
    }

    private static async backup() {
        Logger.info("Backing up database...");
        await Server_CLI.backupDatabase();
    }

    private static async restore() {
        Logger.info("Restoring database...");
        await Server_CLI.restoreDatabase();
    }
    
    private static async token(options: any) {
        Logger.info("Generating token...");
        const result = await Server_CLI.generateDbSystemToken();
        if (options.raw) {
            console.log(result.token);
        } else {
            Logger.success(`Token generated successfully!`);
            Logger.info(`Token: ${result.token}`);
            Logger.info(`Session ID: ${result.sessionId}`);
            Logger.info(`Agent ID: ${result.agentId}`);
        }
    }
}
