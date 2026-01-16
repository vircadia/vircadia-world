export interface ServiceDefinition {
    name: string;
    aliases: string[];
    description: string;
    category: "infra" | "api" | "core" | "client" | "dev";
    containerName?: string;
    dependencies?: string[];
    buildPriority?: number; // Lower is earlier
    startPriority?: number; // Lower is earlier
}

export const SERVICES: ServiceDefinition[] = [
    {
        name: "postgres",
        aliases: ["pg", "db"],
        description: "PostgreSQL Database",
        category: "infra",
        containerName: "vircadia_world_postgres",
        startPriority: 0,
    },
    {
        name: "pgweb",
        aliases: [],
        description: "PGWeb Database UI",
        category: "infra",
        containerName: "vircadia_world_pgweb",
        dependencies: ["postgres"],
        startPriority: 10,
    },
    {
        name: "caddy",
        aliases: [],
        description: "Caddy Reverse Proxy",
        category: "infra",
        containerName: "vircadia_world_caddy",
        dependencies: ["postgres", "api-ws", "api-auth", "api-asset", "api-inference"], // Depends on upstreams
        startPriority: 20, // Start last
    },
    {
        name: "ws",
        aliases: ["api-ws"],
        description: "World API WS Manager",
        category: "api",
        containerName: "vircadia_world_api_ws_manager",
        dependencies: ["postgres"],
        startPriority: 10,
    },
    {
        name: "auth",
        aliases: ["api-auth"],
        description: "World API Auth Manager",
        category: "api",
        containerName: "vircadia_world_api_rest_auth_manager",
        dependencies: ["postgres"],
        startPriority: 10,
    },
    {
        name: "asset",
        aliases: ["api-asset"],
        description: "World API Asset Manager",
        category: "api",
        containerName: "vircadia_world_api_rest_asset_manager",
        dependencies: ["postgres"],
        startPriority: 10,
    },
    {
        name: "inference",
        aliases: ["api-inference"],
        description: "World API Inference Manager",
        category: "api",
        containerName: "vircadia_world_api_rest_inference_manager",
        dependencies: ["postgres"],
        startPriority: 10,
    },
    {
        name: "state",
        aliases: ["state-manager"],
        description: "World State Manager",
        category: "core",
        containerName: "vircadia_world_state_manager",
        dependencies: ["postgres", "api-ws"],
        startPriority: 10,
    },
    {
        name: "client",
        aliases: ["web"],
        description: "Web Babylon.js Client",
        category: "client",
    },
    {
        name: "sdk",
        aliases: [],
        description: "TypeScript SDK",
        category: "dev",
        buildPriority: 0,
    },
    {
        name: "cli",
        aliases: [],
        description: "CLI Tools",
        category: "dev",
    },
    {
        name: "repo",
        aliases: [],
        description: "Root Repository",
        category: "dev",
    },
];

export const GROUPS: Record<string, string[]> = {
    all: SERVICES.map((s) => s.name),
    core: ["postgres", "pgweb", "ws", "auth", "asset", "inference", "state"],
    api: ["ws", "auth", "asset", "inference"],
    infra: ["postgres", "pgweb", "caddy"],
    server: ["postgres", "pgweb", "ws", "auth", "asset", "inference", "state"],
};

export function resolveServices(input: string[]): ServiceDefinition[] {
    const resolved = new Set<ServiceDefinition>();

    for (const item of input) {
        if (GROUPS[item]) {
            GROUPS[item].forEach((serviceName) => {
                const service = SERVICES.find((s) => s.name === serviceName);
                if (service) resolved.add(service);
            });
        } else {
            const service = SERVICES.find((s) => s.name === item || s.aliases.includes(item));
            if (service) {
                resolved.add(service);
            } else {
                // If not found, maybe log warning?
            }
        }
    }

    return Array.from(resolved);
}
