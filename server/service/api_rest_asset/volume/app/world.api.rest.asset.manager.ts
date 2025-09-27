// =============================================================================
// ============================== WORLD API ASSET MANAGER =======================
// =============================================================================

import type { Server } from "bun";
import type { SQL } from "bun";
import type { Sql } from "postgres";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { serverConfiguration } from "../../../../../sdk/vircadia-world-sdk-ts/bun/src/config/vircadia.server.config";
import { BunLogModule } from "../../../../../sdk/vircadia-world-sdk-ts/bun/src/module/vircadia.common.bun.log.module";
import { BunPostgresClientModule } from "../../../../../sdk/vircadia-world-sdk-ts/bun/src/module/vircadia.common.bun.postgres.module";
import type { Service } from "../../../../../sdk/vircadia-world-sdk-ts/schema/src/vircadia.schema.general";
import { Communication } from "../../../../../sdk/vircadia-world-sdk-ts/schema/src/vircadia.schema.general";
import { z } from "zod";
import { AclService, validateJWT } from "../../../../../sdk/vircadia-world-sdk-ts/bun/src/module/vircadia.server.auth.module";
import { MetricsCollector } from "./service/metrics";

let legacySuperUserSql: Sql | null = null;
let superUserSql: SQL | null = null;

const LOG_PREFIX = "World API Asset Manager";

class WorldApiAssetManager {
    private server: Server | undefined;
    private metricsCollector = new MetricsCollector();
    private aclService: AclService | null = null;
    private maintenanceInterval: Timer | null = null;

    private readonly assetCacheDir: string = serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_ASSET_MANAGER_ASSET_CACHE_DIR;
    private readonly assetCacheMaxBytes: number = serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_ASSET_MANAGER_ASSET_CACHE_MAX_BYTES;
    private readonly assetCacheMaintenanceIntervalMs: number = serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_ASSET_MANAGER_ASSET_CACHE_MAINTENANCE_INTERVAL_MS;
    private assetInFlight: Map<string, Promise<string>> = new Map();
    private lastAssetMaintenanceAt: number | null = null;
    private lastAssetMaintenanceDurationMs: number | null = null;
    private lastAssetFilesWarmed: number | null = null;

    private addCorsHeaders(response: Response, req: Request): Response {
        const origin = req.headers.get("origin");

        // Auto-allow localhost and 127.0.0.1 on any port for development
        const isLocalhost = origin && (
            origin.startsWith("http://localhost:") ||
            origin.startsWith("https://localhost:") ||
            origin.startsWith("http://127.0.0.1:") ||
            origin.startsWith("https://127.0.0.1:")
        );

        // Build allowed origins for production
        const allowedOrigins = [
            // Frontend domain
            `https://${serverConfiguration.VRCA_SERVER_SERVICE_CADDY_DOMAIN_APP}`,
            // Asset Manager's own public endpoint
            serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_ASSET_MANAGER_SSL_ENABLED_PUBLIC_AVAILABLE_AT
                ? `https://${serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_ASSET_MANAGER_HOST_PUBLIC_AVAILABLE_AT}${serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_ASSET_MANAGER_PORT_PUBLIC_AVAILABLE_AT !== 443 ? `:${serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_ASSET_MANAGER_PORT_PUBLIC_AVAILABLE_AT}` : ""}`
                : `http://${serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_ASSET_MANAGER_HOST_PUBLIC_AVAILABLE_AT}${serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_ASSET_MANAGER_PORT_PUBLIC_AVAILABLE_AT !== 80 ? `:${serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_ASSET_MANAGER_PORT_PUBLIC_AVAILABLE_AT}` : ""}`,
        ];

        // Check if origin is allowed (localhost on any port OR in allowed list)
        if (origin && (isLocalhost || allowedOrigins.includes(origin))) {
            response.headers.set("Access-Control-Allow-Origin", origin);
            response.headers.set("Access-Control-Allow-Credentials", "true");
        } else {
            // For non-matching origins, don't set credentials
            response.headers.set("Access-Control-Allow-Origin", "*");
            // Note: We don't set Access-Control-Allow-Credentials for wildcard origins
        }

        response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
        response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
        return response;
    }

    private createJsonResponse(data: unknown, req: Request, status?: number): Response {
        const response = status ? Response.json(data, { status }) : Response.json(data);
        return this.addCorsHeaders(response, req);
    }

    private sanitizeKey(key: string): string {
        return key.replace(/[^a-zA-Z0-9._-]/g, "_");
    }
    private getCachedPathForKey(key: string): string {
        const safe = this.sanitizeKey(key);
        return path.join(this.assetCacheDir, safe);
    }
    private getManifestPath(): string {
        return path.join(this.assetCacheDir, "cache.manifest.json");
    }
    private async loadManifest(): Promise<Record<string, { updatedAt: string; size: number }>> {
        try {
            const file = Bun.file(this.getManifestPath());
            if (!(await file.exists())) return {};
            const text = await file.text();
            const data = JSON.parse(text) as Record<string, { updatedAt: string; size: number }>;
            return data || {};
        } catch {
            return {};
        }
    }
    private async saveManifest(manifest: Record<string, { updatedAt: string; size: number }>): Promise<void> {
        const json = JSON.stringify(manifest);
        await Bun.write(this.getManifestPath(), json);
    }
    private async ensureAssetCacheDir(): Promise<void> {
        await mkdir(this.assetCacheDir, { recursive: true });
    }
    private async clearAssetCache(): Promise<void> {
        await rm(this.assetCacheDir, { recursive: true, force: true }).catch(() => {});
        await this.ensureAssetCacheDir();
    }
    private async cacheWriteFile(filePath: string, bytes: Uint8Array) {
        const file = Bun.file(filePath);
        await Bun.write(file, bytes);
    }
    private async isCached(filePath: string): Promise<boolean> {
        try {
            const s = await stat(filePath);
            return s.isFile() && s.size > 0;
        } catch {
            return false;
        }
    }

    private startPeriodicMaintenance(): void {
        if (this.assetCacheMaintenanceIntervalMs <= 0) {
            BunLogModule({ prefix: LOG_PREFIX, message: "Periodic asset cache maintenance disabled (interval <= 0)", debug: serverConfiguration.VRCA_SERVER_DEBUG, suppress: serverConfiguration.VRCA_SERVER_SUPPRESS, type: "info" });
            return;
        }

        // Clear any existing interval
        if (this.maintenanceInterval) {
            clearInterval(this.maintenanceInterval);
        }

        this.maintenanceInterval = setInterval(async () => {
            try {
                await this.maintainAssetCache(false);
            } catch (error) {
                BunLogModule({ prefix: LOG_PREFIX, message: "Error during periodic asset cache maintenance", error, debug: serverConfiguration.VRCA_SERVER_DEBUG, suppress: serverConfiguration.VRCA_SERVER_SUPPRESS, type: "error" });
            }
        }, this.assetCacheMaintenanceIntervalMs);

        BunLogModule({ prefix: LOG_PREFIX, message: `Started periodic asset cache maintenance every ${this.assetCacheMaintenanceIntervalMs}ms`, debug: serverConfiguration.VRCA_SERVER_DEBUG, suppress: serverConfiguration.VRCA_SERVER_SUPPRESS, type: "info" });
    }

    private stopPeriodicMaintenance(): void {
        if (this.maintenanceInterval) {
            clearInterval(this.maintenanceInterval);
            this.maintenanceInterval = null;
            BunLogModule({ prefix: LOG_PREFIX, message: "Stopped periodic asset cache maintenance", debug: serverConfiguration.VRCA_SERVER_DEBUG, suppress: serverConfiguration.VRCA_SERVER_SUPPRESS, type: "info" });
        }
    }

    private async maintainAssetCache(fullRefresh = false): Promise<void> {
        if (!superUserSql) return;
        const t0 = performance.now();
        await this.ensureAssetCacheDir();
        let manifest = await this.loadManifest();
        if (fullRefresh) {
            await this.clearAssetCache();
            manifest = {};
        }
        const rows = await superUserSql<[
            { general__asset_file_name: string; asset__data__bytea_updated_at: string | null; approx_size: number | null },
        ]>`
            SELECT general__asset_file_name,
                   asset__data__bytea_updated_at,
                   COALESCE(octet_length(asset__data__bytea), 0) as approx_size
            FROM entity.entity_assets
            ORDER BY asset__data__bytea_updated_at DESC NULLS LAST
        `;

        const dbKeys = new Set<string>();
        for (const r of rows) {
            const key = r?.general__asset_file_name;
            if (key) dbKeys.add(key);
        }
        for (const key of Object.keys(manifest)) {
            if (!dbKeys.has(key)) {
                const filePath = this.getCachedPathForKey(key);
                await rm(filePath, { force: true }).catch(() => {});
                delete manifest[key];
            }
        }

        let totalBytes = 0;
        for (const key of Object.keys(manifest)) totalBytes += Number(manifest[key]?.size || 0);
        const byteBudget = this.assetCacheMaxBytes || Number.MAX_SAFE_INTEGER;

        const evictUntilFits = async (requiredBytes: number) => {
            if (totalBytes + requiredBytes <= byteBudget) return;
            const entries = Object.entries(manifest).sort((a, b) => new Date(a[1].updatedAt).getTime() - new Date(b[1].updatedAt).getTime());
            for (const [oldKey, meta] of entries) {
                if (totalBytes + requiredBytes <= byteBudget) break;
                const filePath = this.getCachedPathForKey(oldKey);
                await rm(filePath, { force: true }).catch(() => {});
                totalBytes -= Number(meta.size || 0);
                delete manifest[oldKey];
            }
        };

        let filesWarmed = 0;
        for (const r of rows) {
            const key = r?.general__asset_file_name;
            if (!key) continue;
            const updatedAt = r.asset__data__bytea_updated_at || new Date(0).toISOString();
            const approxSize = Number(r.approx_size || 0);
            const cachedMeta = manifest[key];
            const isUpToDate = cachedMeta && new Date(cachedMeta.updatedAt).getTime() >= new Date(updatedAt).getTime();
            const filePath = this.getCachedPathForKey(key);
            if (isUpToDate) continue;
            await evictUntilFits(approxSize);
            try {
                const [dataRow] = await superUserSql<[{ asset__data__bytea: Uint8Array | ArrayBuffer | Buffer | null }]>`
                    SELECT asset__data__bytea
                    FROM entity.entity_assets
                    WHERE general__asset_file_name = ${key}
                `;
                const payload = dataRow?.asset__data__bytea;
                if (!payload) continue;
                const bytes =
                    payload instanceof Uint8Array
                        ? payload
                        : payload instanceof ArrayBuffer
                          ? new Uint8Array(payload)
                          : Buffer.isBuffer(payload)
                            ? new Uint8Array(payload)
                            : undefined;
                if (!bytes) continue;
                await this.cacheWriteFile(filePath, bytes);
                const size = bytes.byteLength;
                totalBytes += size - Number(cachedMeta?.size || 0);
                manifest[key] = { updatedAt, size };
                filesWarmed += 1;
            } catch {}
        }

        await this.saveManifest(manifest);
        const durationMs = Math.round(performance.now() - t0);
        this.lastAssetMaintenanceAt = Date.now();
        this.lastAssetMaintenanceDurationMs = durationMs;
        this.lastAssetFilesWarmed = filesWarmed;
        BunLogModule({ prefix: LOG_PREFIX, message: "Asset cache maintenance complete", debug: serverConfiguration.VRCA_SERVER_DEBUG, suppress: serverConfiguration.VRCA_SERVER_SUPPRESS, type: "info", data: { filesWarmed, totalBytes, byteBudget: this.assetCacheMaxBytes, durationMs } });
    }

    private async getAssetCacheStats(): Promise<Service.API.Asset.I_AssetCacheStats> {
        let totalBytes = 0;
        let fileCount = 0;
        try {
            const manifest = await this.loadManifest();
            const keys = Object.keys(manifest);
            fileCount = keys.length;
            for (const key of keys) totalBytes += Number(manifest[key]?.size || 0);
        } catch {}
        return {
            dir: this.assetCacheDir,
            maxMegabytes: this.assetCacheMaxBytes / 1024 / 1024,
            totalMegabytes: totalBytes / 1024 / 1024,
            fileCount,
            inFlight: this.assetInFlight.size,
            lastMaintenanceAt: this.lastAssetMaintenanceAt ?? null,
            lastMaintenanceDurationMs: this.lastAssetMaintenanceDurationMs ?? null,
            filesWarmedLastRun: this.lastAssetFilesWarmed ?? null,
        };
    }

    async initialize() {
        BunLogModule({ prefix: LOG_PREFIX, message: "Initializing World API Asset Manager", debug: serverConfiguration.VRCA_SERVER_DEBUG, suppress: serverConfiguration.VRCA_SERVER_SUPPRESS, type: "debug" });

        legacySuperUserSql = await BunPostgresClientModule.getInstance({
            debug: serverConfiguration.VRCA_SERVER_DEBUG,
            suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
        }).getLegacySuperClient({
            postgres: {
                host: serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_CONTAINER_NAME,
                port: serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_PORT_CONTAINER_BIND_EXTERNAL,
                database: serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_DATABASE,
                username: serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_SUPER_USER_USERNAME,
                password: serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
            },
        });

        superUserSql = await BunPostgresClientModule.getInstance({
            debug: serverConfiguration.VRCA_SERVER_DEBUG,
            suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
        }).getSuperClient({
            postgres: {
                host: serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_CONTAINER_NAME,
                port: serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_PORT_CONTAINER_BIND_EXTERNAL,
                database: serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_DATABASE,
                username: serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_SUPER_USER_USERNAME,
                password: serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
            },
        });

        if (superUserSql) {
            this.aclService = new AclService({ db: superUserSql, legacyDb: legacySuperUserSql });
            await this.aclService.startRoleChangeListener();
        }

        // Initial cache warm
        try {
            await this.maintainAssetCache(true);
        } catch {}

        // Start periodic maintenance
        this.startPeriodicMaintenance();

        // HTTP Server
        this.server = Bun.serve({
            hostname: "0.0.0.0",
            port: 3023,
            development: serverConfiguration.VRCA_SERVER_DEBUG,
            fetch: async (req: Request, server: Server) => {
                try {
                    const url = new URL(req.url);

                            // Request trace (with sensitive data redacted)
                            try {
                                const redactedSearch = (() => {
                                    try {
                                        const sp = new URLSearchParams(url.search);
                                        if (sp.has("token")) sp.set("token", "[REDACTED]");
                                        return sp.toString();
                                    } catch {
                                        return "";
                                    }
                                })();
                                BunLogModule({
                                    prefix: LOG_PREFIX,
                                    message: "Incoming HTTP request",
                                    debug: serverConfiguration.VRCA_SERVER_DEBUG,
                                    suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                                    type: "debug",
                                    data: {
                                        method: req.method,
                                        pathname: url.pathname,
                                        search: redactedSearch,
                                    },
                                });
                            } catch {}

                    if (req.method === "OPTIONS") {
                        const response = new Response(null, { status: 204 });
                        return this.addCorsHeaders(response, req);
                    }

                    

                    // Stats (moved to official REST endpoint)
                    if (
                        url.pathname.startsWith(Communication.REST.Endpoint.ASSET_STATS.path) &&
                        req.method === Communication.REST.Endpoint.ASSET_STATS.method
                    ) {
                        const requestIP =
                            req.headers.get("x-forwarded-for")?.split(",")[0] ||
                            server.requestIP(req)?.address ||
                            "";
                        const isLocalhost = requestIP === "127.0.0.1" || requestIP === "::1" || requestIP === "localhost";
                        const isDockerInternal = requestIP.startsWith("172.") || requestIP.startsWith("192.168.") || requestIP.startsWith("10.") || requestIP === "::ffff:127.0.0.1";
                        if (!isLocalhost && !isDockerInternal) {
                            return this.createJsonResponse(Communication.REST.Endpoint.ASSET_STATS.createError("Forbidden."), req, 403);
                        }
                        const response = this.createJsonResponse(
                            Communication.REST.Z.AssetStatsSuccess.parse({
                                success: true,
                                timestamp: Date.now(),
                                uptime: process.uptime(),
                                connections: this.metricsCollector.getSystemMetrics(true).connections,
                                database: {
                                    connected: !!superUserSql,
                                    connections: this.metricsCollector.getSystemMetrics(true).database.connections,
                                },
                                memory: this.metricsCollector.getSystemMetrics(true).memory,
                                cpu: this.metricsCollector.getSystemMetrics(true).cpu,
                                assets: { cache: await this.getAssetCacheStats() },
                            }),
                            req,
                        );
                        return response;
                    }

                    if (!superUserSql) {
                        return this.createJsonResponse({ error: "Internal server error" }, req, 500);
                    }

                    if (url.pathname.startsWith(Communication.REST_BASE_ASSET_PATH)) {
                        BunLogModule({ prefix: LOG_PREFIX, message: "Asset base path matched", debug: serverConfiguration.VRCA_SERVER_DEBUG, suppress: serverConfiguration.VRCA_SERVER_SUPPRESS, type: "debug", data: { pathname: url.pathname } });
                        switch (true) {
                            // Asset fetch by key (authenticated)
                            case url.pathname === Communication.REST.Endpoint.ASSET_GET_BY_KEY.path && req.method === "GET": {
                                const startTime = performance.now();
                                const requestSize = new TextEncoder().encode(url.toString()).length;
                                const qp = Object.fromEntries(url.searchParams.entries());
                                const parsed = Communication.REST.Z.AssetGetByKeyQuery.safeParse(qp);
                                if (!parsed.success) {
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.ASSET_GET_BY_KEY.createError("Invalid query parameters"),
                                        req,
                                        400,
                                    );
                                }
                                const queryData = parsed.data;
                                const key = queryData.key;
                                const token = queryData.token;
                                const provider = queryData.provider;
                                const sessionIdFromQuery = queryData.sessionId;

                                BunLogModule({
                                    prefix: LOG_PREFIX,
                                    message: "ASSET_GET_BY_KEY request received",
                                    debug: serverConfiguration.VRCA_SERVER_DEBUG,
                                    suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                                    type: "debug",
                                    data: {
                                        key,
                                        provider,
                                        sessionIdProvided: !!sessionIdFromQuery,
                                        tokenProvided: !!token,
                                    },
                                });
                                if (!key)
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.ASSET_GET_BY_KEY.createError("Missing key"),
                                        req,
                                        400,
                                    );

                                let agentIdForAcl: string | null = null;
                                if (sessionIdFromQuery) {
                                    BunLogModule({ prefix: LOG_PREFIX, message: "Validating session from query for ACL", debug: serverConfiguration.VRCA_SERVER_DEBUG, suppress: serverConfiguration.VRCA_SERVER_SUPPRESS, type: "debug", data: { sessionIdProvided: true } });
                                    const [sessionResult] = await superUserSql<[{ agent_id: string }]>`
                                        SELECT * FROM auth.validate_session_id(${sessionIdFromQuery}::UUID) as agent_id
                                    `;
                                    agentIdForAcl = sessionResult?.agent_id || null;
                                } else {
                                    BunLogModule({ prefix: LOG_PREFIX, message: "Validating JWT for ACL", debug: serverConfiguration.VRCA_SERVER_DEBUG, suppress: serverConfiguration.VRCA_SERVER_SUPPRESS, type: "debug", data: { provider, tokenProvided: !!token } });
                                    if (!token || !provider)
                                        return this.createJsonResponse(
                                            Communication.REST.Endpoint.ASSET_GET_BY_KEY.createError("Missing auth"),
                                            req,
                                            401,
                                        );
                                    const jwtValidationResult = await validateJWT({ superUserSql, provider, token });
                                    if (!jwtValidationResult.isValid)
                                        return this.createJsonResponse(
                                            Communication.REST.Endpoint.ASSET_GET_BY_KEY.createError("Invalid token"),
                                            req,
                                            401,
                                        );
                                    agentIdForAcl = jwtValidationResult.agentId;
                                }

                                // Determine asset's group and check ACL
                                const [assetRow] = await superUserSql<[
                                    { group__sync: string | null; general__asset_file_name: string | null },
                                ]>`
                                    SELECT group__sync, general__asset_file_name
                                    FROM entity.entity_assets
                                    WHERE general__asset_file_name = ${key}
                                `;
                                const syncGroup = assetRow?.group__sync || "public.STATIC";
                                const agentId = agentIdForAcl || "";
                                if (agentId) await this.aclService?.warmAgentAcl(agentId);
                                const canRead = agentId ? this.aclService?.canRead(agentId, syncGroup) : false;
                                BunLogModule({ prefix: LOG_PREFIX, message: "ACL evaluated for asset", debug: serverConfiguration.VRCA_SERVER_DEBUG, suppress: serverConfiguration.VRCA_SERVER_SUPPRESS, type: "debug", data: { key, agentIdProvided: !!agentId, syncGroup, canRead } });
                                if (!canRead)
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.ASSET_GET_BY_KEY.createError("Forbidden"),
                                        req,
                                        403,
                                    );

                                // Try local cache
                                const filePath = this.getCachedPathForKey(key);
                                const cached = await this.isCached(filePath);
                                BunLogModule({ prefix: LOG_PREFIX, message: "Asset cache lookup", debug: serverConfiguration.VRCA_SERVER_DEBUG, suppress: serverConfiguration.VRCA_SERVER_SUPPRESS, type: "debug", data: { key, filePath, cached } });
                                if (cached) {
                                    const file = Bun.file(filePath);
                                    const response = new Response(file);
                                    return this.addCorsHeaders(response, req);
                                }

                                // Fallback to DB
                                BunLogModule({ prefix: LOG_PREFIX, message: "Fetching asset from database", debug: serverConfiguration.VRCA_SERVER_DEBUG, suppress: serverConfiguration.VRCA_SERVER_SUPPRESS, type: "debug", data: { key } });
                                const [row] = await superUserSql<[
                                    { asset__data__bytea: Uint8Array | ArrayBuffer | Buffer | null; asset__mime_type: string | null },
                                ]>`
                                    SELECT asset__data__bytea, asset__mime_type
                                    FROM entity.entity_assets
                                    WHERE general__asset_file_name = ${key}
                                `;
                                const payload = row?.asset__data__bytea;
                                if (!payload)
                                    {
                                        BunLogModule({ prefix: LOG_PREFIX, message: "Asset not found in database", debug: serverConfiguration.VRCA_SERVER_DEBUG, suppress: serverConfiguration.VRCA_SERVER_SUPPRESS, type: "debug", data: { key } });
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.ASSET_GET_BY_KEY.createError("Not found"),
                                        req,
                                        404,
                                    );
                                    }
                                let bytes: Uint8Array | null = null;
                                if (payload instanceof Uint8Array) {
                                    bytes = payload;
                                } else if (payload instanceof ArrayBuffer) {
                                    bytes = new Uint8Array(payload);
                                } else if (Buffer.isBuffer(payload)) {
                                    bytes = new Uint8Array(payload);
                                }
                                if (!bytes)
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.ASSET_GET_BY_KEY.createError("Bad asset"),
                                        req,
                                        500,
                                    );
                                await this.cacheWriteFile(filePath, bytes);
                                const headers = new Headers();
                                if (row?.asset__mime_type) headers.set("Content-Type", row.asset__mime_type);
                                const file = Bun.file(filePath);
                                const response = new Response(file, { headers });
                                const responseSize = bytes.byteLength;
                                this.metricsCollector.recordEndpoint("ASSET_GET_BY_KEY", performance.now() - startTime, requestSize, responseSize, true);
                                BunLogModule({ prefix: LOG_PREFIX, message: "Asset served from database and cached", debug: serverConfiguration.VRCA_SERVER_DEBUG, suppress: serverConfiguration.VRCA_SERVER_SUPPRESS, type: "debug", data: { key, filePath, responseSize, contentType: row?.asset__mime_type || null } });
                                return this.addCorsHeaders(response, req);
                            }

                            default:
                                BunLogModule({ prefix: LOG_PREFIX, message: "Asset manager route 404 under asset base path", debug: serverConfiguration.VRCA_SERVER_DEBUG, suppress: serverConfiguration.VRCA_SERVER_SUPPRESS, type: "debug", data: { pathname: url.pathname, method: req.method } });
                                return this.createJsonResponse({ error: "Not found" }, req, 404);
                        }
                    }

                    BunLogModule({ prefix: LOG_PREFIX, message: "Asset manager route 404 (outside asset base path)", debug: serverConfiguration.VRCA_SERVER_DEBUG, suppress: serverConfiguration.VRCA_SERVER_SUPPRESS, type: "debug", data: { pathname: url.pathname, method: req.method } });
                    return this.createJsonResponse({ error: "Not found" }, req, 404);
                } catch (error) {
                    BunLogModule({ prefix: LOG_PREFIX, message: "Unexpected error in asset manager", error, debug: true, suppress: false, type: "error" });
                    return this.createJsonResponse({ error: "Internal server error" }, req, 500);
                }
            },
        });

        BunLogModule({ prefix: LOG_PREFIX, message: `Asset Manager listening on 3023`, debug: serverConfiguration.VRCA_SERVER_DEBUG, suppress: serverConfiguration.VRCA_SERVER_SUPPRESS, type: "info" });
    }

    async shutdown(): Promise<void> {
        BunLogModule({ prefix: LOG_PREFIX, message: "Shutting down World API Asset Manager", debug: serverConfiguration.VRCA_SERVER_DEBUG, suppress: serverConfiguration.VRCA_SERVER_SUPPRESS, type: "info" });

        // Stop periodic maintenance
        this.stopPeriodicMaintenance();

        // Close HTTP server
        if (this.server) {
            this.server.stop();
        }

        // Close database connections
        if (legacySuperUserSql) {
            try {
                await legacySuperUserSql.end();
            } catch {}
        }
        if (superUserSql) {
            try {
                await superUserSql.end();
            } catch {}
        }
    }
}

void (async () => {
    const manager = new WorldApiAssetManager();

    // Handle graceful shutdown
    const gracefulShutdown = async (signal: string) => {
        BunLogModule({ prefix: LOG_PREFIX, message: `Received ${signal}, initiating graceful shutdown`, debug: serverConfiguration.VRCA_SERVER_DEBUG, suppress: serverConfiguration.VRCA_SERVER_SUPPRESS, type: "info" });
        try {
            await manager.shutdown();
        } catch (error) {
            BunLogModule({ prefix: LOG_PREFIX, message: "Error during shutdown", error, debug: serverConfiguration.VRCA_SERVER_DEBUG, suppress: serverConfiguration.VRCA_SERVER_SUPPRESS, type: "error" });
        } finally {
            process.exit(0);
        }
    };

    process.on("SIGINT", () => gracefulShutdown("SIGINT"));
    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

    await manager.initialize();
})();


