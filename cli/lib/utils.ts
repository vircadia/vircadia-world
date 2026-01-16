import { BunLogModule } from "../../sdk/vircadia-world-sdk-ts/bun/src/module/vircadia.common.bun.log.module";
import { cliConfiguration } from "../vircadia.cli.config";
import { $ } from "bun";

export const CLI_LOG_TAG = "CLI";

export namespace Logger {
    export function info(message: string) {
        BunLogModule({
            message,
            type: "info",
            prefix: CLI_LOG_TAG,
            suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
            debug: cliConfiguration.VRCA_CLI_DEBUG,
        });
    }

    export function warn(message: string) {
        BunLogModule({
            message,
            type: "warn",
            prefix: CLI_LOG_TAG,
            suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
            debug: cliConfiguration.VRCA_CLI_DEBUG,
        });
    }

    export function error(message: string) {
        BunLogModule({
            message,
            type: "error",
            prefix: CLI_LOG_TAG,
            suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
            debug: cliConfiguration.VRCA_CLI_DEBUG,
        });
    }

    export function success(message: string) {
        BunLogModule({
            message,
            type: "success",
            prefix: CLI_LOG_TAG,
            suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
            debug: cliConfiguration.VRCA_CLI_DEBUG,
        });
    }

    export function debug(message: string) {
        if (cliConfiguration.VRCA_CLI_DEBUG) {
            BunLogModule({
                message,
                type: "debug",
                prefix: CLI_LOG_TAG,
                suppress: cliConfiguration.VRCA_CLI_SUPPRESS,
                debug: cliConfiguration.VRCA_CLI_DEBUG,
            });
        }
    }
}

export async function runShellCommand(command: string[], cwd: string = process.cwd(), env: Record<string, string | undefined> = {}): Promise<void> {
    Logger.debug(`Executing: ${command.join(" ")} in ${cwd}`);
    
    // Using Bun.spawn for better control and streaming
    const proc = Bun.spawn(command, {
        cwd,
        stdout: "inherit",
        stderr: "inherit",
        env: {
            ...process.env,
            ...env
        }
    });

    const exitCode = await proc.exited;

    if (exitCode !== 0) {
        throw new Error(`Command failed with exit code ${exitCode}`);
    }
}
