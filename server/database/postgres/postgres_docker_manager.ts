import { VircadiaConfig_Server } from "../../vircadia.server.config.ts";
import { log } from "../../../sdk/vircadia-world-sdk-ts/module/general/log.ts";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { createConnection } from "node:net";

const DOCKER_COMPOSE_PATH = path.join(
    dirname(fileURLToPath(import.meta.url)),
    "docker/docker-compose.yml",
);

function getDockerEnv() {
    const config = VircadiaConfig_Server.postgres;
    return {
        POSTGRES_CONTAINER_NAME: config.containerName,
        POSTGRES_DB: config.database,
        POSTGRES_USER: config.user,
        POSTGRES_PASSWORD: config.password,
        POSTGRES_PORT: config.port.toString(),
        POSTGRES_EXTENSIONS: config.extensions.join(","),
    };
}

async function runDockerCommand(args: string[], env = getDockerEnv()) {
    const process = Bun.spawn(
        ["docker-compose", "-f", DOCKER_COMPOSE_PATH, ...args],
        {
            env,
            stdout: "pipe",
            stderr: "pipe",
        },
    );

    const stdout = await new Response(process.stdout).text();
    const stderr = await new Response(process.stderr).text();

    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);

    const exitCode = await process.exited;
    if (exitCode !== 0) {
        throw new Error(`Docker command failed with exit code ${exitCode}`);
    }
}

export async function isHealthy(): Promise<boolean> {
    const config = VircadiaConfig_Server.postgres;
    return new Promise((resolve) => {
        const socket = createConnection({
            host: config.host,
            port: config.port,
        })
            .on("connect", () => {
                socket.end();
                resolve(true);
            })
            .on("error", () => {
                resolve(false);
            });

        // Set timeout for connection attempt
        socket.setTimeout(1000);
        socket.on("timeout", () => {
            socket.destroy();
            resolve(false);
        });
    });
}

export async function up() {
    log({ message: "Starting PostgreSQL container...", type: "info" });
    await runDockerCommand(["up", "-d", "--build"]);
    log({ message: "PostgreSQL container started", type: "success" });
}

export async function down() {
    log({ message: "Stopping PostgreSQL container...", type: "info" });
    await runDockerCommand(["down"]);
    log({ message: "PostgreSQL container stopped", type: "success" });
}

export async function hardReset() {
    log({
        message: "Performing hard reset of PostgreSQL container...",
        type: "info",
    });
    await runDockerCommand(["down", "-v"]);
    await runDockerCommand(["up", "-d", "--build"]);
    log({ message: "PostgreSQL container reset complete", type: "success" });
}

// If this file is run directly
if (import.meta.main) {
    const command = Bun.argv[2];
    switch (command) {
        case "up":
            await up();
            break;
        case "down":
            await down();
            break;
        case "reset":
            await hardReset();
            break;
        case "health":
            console.log(await isHealthy());
            break;
        default:
            console.error("Valid commands: up, down, reset, health");
            process.exit(1);
    }
}
