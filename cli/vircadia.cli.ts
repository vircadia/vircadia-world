#!/usr/bin/env bun
import { CommandParser } from "./lib/command.parser";
import { Logger } from "./lib/utils";

/**
 * Vircadia World CLI
 * 
 * A composable, service-oriented CLI for managing the Vircadia World stack.
 * Usage: bun cli <service> <action> [options]
 */

async function main() {
    try {
        await CommandParser.parse(process.argv);
    } catch (error: any) {
        if (error.exitCode === 130) {
            // User cancelled
            process.exit(0);
        }
        Logger.error(`CLI Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
}

if (import.meta.main) {
    main();
}
