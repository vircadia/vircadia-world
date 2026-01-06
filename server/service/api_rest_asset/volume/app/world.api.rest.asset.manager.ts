// =============================================================================
// ============================== WORLD API ASSET MANAGER =======================
// =============================================================================

import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { Server, SQL } from "bun";
import type { Sql } from "postgres";
import { serverConfiguration } from "../../../../../sdk/vircadia-world-sdk-ts/bun/src/config/vircadia.server.config";
import { BunLogModule } from "../../../../../sdk/vircadia-world-sdk-ts/bun/src/module/vircadia.common.bun.log.module";
import { BunPostgresClientModule } from "../../../../../sdk/vircadia-world-sdk-ts/bun/src/module/vircadia.common.bun.postgres.module";
import {
    AclService,
    validateJWT,
} from "../../../../../sdk/vircadia-world-sdk-ts/bun/src/module/vircadia.server.auth.module";
import type { Service } from "../../../../../sdk/vircadia-world-sdk-ts/schema/src/vircadia.schema.general";
import { Communication } from "../../../../../sdk/vircadia-world-sdk-ts/schema/src/vircadia.schema.general";
import { MetricsCollector } from "./service/metrics";

let legacySuperUserSql: Sql | null = null;
let superUserSql: SQL | null = null;

const LOG_PREFIX = "World API Asset Manager";

class WorldApiAssetManager {
    private server: Server<unknown> | undefined;
    private metricsCollector = new MetricsCollector();
    private aclService: AclService | null = null;
    private maintenanceInterval: Timer | null = null;

    private readonly assetCacheDir: string =
        serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_ASSET_MANAGER_ASSET_CACHE_DIR;
    private readonly assetCacheMaxBytes: number =
        serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_ASSET_MANAGER_ASSET_CACHE_MAX_BYTES;
    private readonly assetCacheMaintenanceIntervalMs: number =
        serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_ASSET_MANAGER_ASSET_CACHE_MAINTENANCE_INTERVAL_MS;
    private assetInFlight: Map<string, Promise<string>> = new Map();
    private lastAssetMaintenanceAt: number | null = null;
    private lastAssetMaintenanceDurationMs: number | null = null;
    private lastAssetFilesWarmed: number | null = null;

    // Zero buffer for speed tests (10MB)
    private static readonly ZERO_BUFFER = new Uint8Array(10 * 1024 * 1024);
    // Cache stats cache
    private lastCacheStats: Service.API.Asset.I_AssetCacheStats | null = null;
    private lastCacheStatsTime = 0;

    // Concurrency limiter for downloads to prevent system overload
    private readonly maxConcurrentDownloads = 50;
    private readonly maxDownloadQueueSize = 100; // Return 503 if queue exceeds this
    private currentDownloads = 0;
    private downloadQueue: Array<() => void> = [];

    // File stat cache to avoid repeated stat() calls (TTL: 30 seconds)
    private fileStatCache: Map<string, { size: number; mtimeMs: number; cachedAt: number }> = new Map();
    private readonly fileStatCacheTtlMs = 30000;


    private addCorsHeaders(response: Response, req: Request): Response {
        const origin = req.headers.get("origin");

        // Auto-allow localhost and 127.0.0.1 on any port for development
        const isLocalhost =
            origin &&
            (origin.startsWith("http://localhost:") ||
                origin.startsWith("https://localhost:") ||
                origin.startsWith("http://127.0.0.1:") ||
                origin.startsWith("https://127.0.0.1:"));

        // Build allowed origins for production
        const allowedOrigins = [
            // Caddy domain
            `https://${serverConfiguration.VRCA_SERVER_SERVICE_CADDY_DOMAIN}`,
            `http://${serverConfiguration.VRCA_SERVER_SERVICE_CADDY_DOMAIN}`,
            // Asset Manager's own public endpoint
            serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_ASSET_MANAGER_SSL_ENABLED_PUBLIC_AVAILABLE_AT
                ? `https://${serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_ASSET_MANAGER_HOST_PUBLIC_AVAILABLE_AT}${serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_ASSET_MANAGER_PORT_PUBLIC_AVAILABLE_AT !== 443 ? `:${serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_ASSET_MANAGER_PORT_PUBLIC_AVAILABLE_AT}` : ""}`
                : `http://${serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_ASSET_MANAGER_HOST_PUBLIC_AVAILABLE_AT}${serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_ASSET_MANAGER_PORT_PUBLIC_AVAILABLE_AT !== 80 ? `:${serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_ASSET_MANAGER_PORT_PUBLIC_AVAILABLE_AT}` : ""}`,
        ];
        // Add allowed origins from config
        allowedOrigins.push(...serverConfiguration.VRCA_SERVER_ALLOWED_ORIGINS);

        // Check if origin is allowed (localhost on any port OR in allowed list)
        if (origin && (isLocalhost || allowedOrigins.includes(origin))) {
            response.headers.set("Access-Control-Allow-Origin", origin);
            response.headers.set("Access-Control-Allow-Credentials", "true");
        } else {
            // For non-matching origins, don't set credentials
            response.headers.set("Access-Control-Allow-Origin", "*");
            // Note: We don't set Access-Control-Allow-Credentials for wildcard origins
        }

        response.headers.set(
            "Access-Control-Allow-Methods",
            "GET, POST, PUT, DELETE, OPTIONS",
        );
        response.headers.set(
            "Access-Control-Allow-Headers",
            "Content-Type, Authorization, X-Requested-With",
        );
        return response;
    }

    private createJsonResponse(
        data: unknown,
        req: Request,
        status?: number,
    ): Response {
        const response = status
            ? Response.json(data, { status })
            : Response.json(data);
        return this.addCorsHeaders(response, req);
    }

    private sanitizeKey(key: string): string {
        return key.replace(/[^a-zA-Z0-9._-]/g, "_");
    }
    private getCachedPathForKey(key: string): string {
        const safe = this.sanitizeKey(key);
        return path.join(this.assetCacheDir, safe);
    }
    private async getCacheCurrentTotalBytes(): Promise<number> {
        try {
            const entries = await readdir(this.assetCacheDir, {
                withFileTypes: true,
            });
            let total = 0;
            for (const entry of entries) {
                if (!entry.isFile()) continue;
                try {
                    const s = await stat(
                        path.join(this.assetCacheDir, entry.name),
                    );
                    if (s.isFile()) total += s.size;
                } catch {}
            }
            return total;
        } catch {
            return 0;
        }
    }

    private async getCachedFileStat(
        filePath: string,
    ): Promise<{ size: number; mtimeMs: number } | null> {
        // Check in-memory cache first
        const cached = this.fileStatCache.get(filePath);
        if (cached && Date.now() - cached.cachedAt < this.fileStatCacheTtlMs) {
            return { size: cached.size, mtimeMs: cached.mtimeMs };
        }
        
        try {
            const s = await stat(filePath);
            if (!s.isFile()) return null;
            const result = { size: s.size, mtimeMs: s.mtimeMs };
            // Cache the result
            this.fileStatCache.set(filePath, { ...result, cachedAt: Date.now() });
            return result;
        } catch {
            // Remove from cache if file doesn't exist
            this.fileStatCache.delete(filePath);
            return null;
        }
    }

    private invalidateFileStatCache(filePath: string): void {
        this.fileStatCache.delete(filePath);
    }

    // Concurrency limiter methods
    private isDownloadOverloaded(): boolean {
        return this.downloadQueue.length >= this.maxDownloadQueueSize;
    }

    private async acquireDownloadSlot(): Promise<void> {
        if (this.currentDownloads < this.maxConcurrentDownloads) {
            this.currentDownloads++;
            return;
        }
        return new Promise(resolve => this.downloadQueue.push(() => {
            this.currentDownloads++;
            resolve();
        }));
    }

    private releaseDownloadSlot(): void {
        const next = this.downloadQueue.shift();
        if (next) {
            next();
        } else {
            this.currentDownloads--;
        }
    }

    private async ensureAssetCacheDir(): Promise<void> {
        await mkdir(this.assetCacheDir, { recursive: true });
    }
    private async clearAssetCache(): Promise<void> {
        await rm(this.assetCacheDir, { recursive: true, force: true }).catch(
            () => {},
        );
        await this.ensureAssetCacheDir();
    }

    private async fatalShutdown(
        message: string,
        error?: unknown,
    ): Promise<never> {
        BunLogModule({
            prefix: LOG_PREFIX,
            message,
            error,
            debug: serverConfiguration.VRCA_SERVER_DEBUG,
            suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
            type: "error",
        });
        try {
            await this.shutdown();
        } catch {}
        process.exit(1);
        throw new Error("Process exiting due to fatal error");
    }
    private async cacheWriteFile(filePath: string, bytes: Uint8Array) {
        const file = Bun.file(filePath);
        await Bun.write(file, bytes);
        // Invalidate stat cache after write
        this.invalidateFileStatCache(filePath);
    }
    private async isCached(filePath: string): Promise<boolean> {
        const cached = await this.getCachedFileStat(filePath);
        return cached !== null && cached.size > 0;
    }

    private async getDbAssetSize(key: string): Promise<number | null> {
        if (!superUserSql) return null;
        try {
            const [r] = await superUserSql<[{ size: number | null }]>`
				SELECT COALESCE(octet_length(asset__data__bytea), 0) AS size
				FROM entity.entity_assets
				WHERE general__asset_file_name = ${key}
			`;
            return typeof r?.size === "number" ? r.size : 0;
        } catch {
            return null;
        }
    }

    private startPeriodicMaintenance(): void {
        if (this.assetCacheMaintenanceIntervalMs <= 0) {
            BunLogModule({
                prefix: LOG_PREFIX,
                message:
                    "Periodic asset cache maintenance disabled (interval <= 0)",
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                type: "info",
            });
            return;
        }

        // Clear any existing interval
        if (this.maintenanceInterval) {
            clearInterval(this.maintenanceInterval);
        }

        this.maintenanceInterval = setInterval(async () => {
            try {
                try {
                    await this.maintainAssetCache(false);
                } catch (error) {
                    // If a capacity error happens during periodic maintenance, shut down
                    await this.fatalShutdown(
                        "Periodic cache maintenance failed",
                        error,
                    );
                }
            } catch (error) {
                BunLogModule({
                    prefix: LOG_PREFIX,
                    message: "Error during periodic asset cache maintenance",
                    error,
                    debug: serverConfiguration.VRCA_SERVER_DEBUG,
                    suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                    type: "error",
                });
            }
        }, this.assetCacheMaintenanceIntervalMs);

        // Periodic maintenance startup logged in combined server startup message
    }

    private stopPeriodicMaintenance(): void {
        if (this.maintenanceInterval) {
            clearInterval(this.maintenanceInterval);
            this.maintenanceInterval = null;
            BunLogModule({
                prefix: LOG_PREFIX,
                message: "Stopped periodic asset cache maintenance",
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                type: "info",
            });
        }
    }

    private async maintainAssetCache(fullRefresh = false): Promise<void> {
        if (!superUserSql) return;
        const t0 = performance.now();
        await this.ensureAssetCacheDir();
        if (fullRefresh) {
            await this.clearAssetCache();
        }
        const rows = await superUserSql<
            [
                {
                    general__asset_file_name: string;
                    asset__data__bytea_updated_at: string | null;
                    approx_size: number | null;
                },
            ]
        >`
			SELECT general__asset_file_name,
			       asset__data__bytea_updated_at,
			       COALESCE(octet_length(asset__data__bytea), 0) as approx_size
			FROM entity.entity_assets
			ORDER BY asset__data__bytea_updated_at DESC NULLS LAST
		`;

        // Track asset size statistics for warning on init
        let normalAssets = 0;
        let smallAssets = 0;
        const smallSizeThreshold = 500; // bytes - assets smaller than this are considered "small"

        // Remove cached files that no longer exist in DB
        const dbKeys = new Set<string>();
        for (const r of rows) {
            const key = r?.general__asset_file_name;
            if (key) dbKeys.add(this.sanitizeKey(key));
        }
        try {
            const entries = await readdir(this.assetCacheDir, {
                withFileTypes: true,
            });
            for (const entry of entries) {
                if (!entry.isFile()) continue;
                if (!dbKeys.has(entry.name)) {
                    await rm(path.join(this.assetCacheDir, entry.name), {
                        force: true,
                    }).catch(() => {});
                }
            }
        } catch {}

        let totalBytes = await this.getCacheCurrentTotalBytes();
        const byteBudget = this.assetCacheMaxBytes || Number.MAX_SAFE_INTEGER;
        const totalDbBytes = rows.reduce(
            (sum, r) => sum + Number(r.approx_size || 0),
            0,
        );
        if (
            byteBudget !== Number.MAX_SAFE_INTEGER &&
            totalDbBytes > byteBudget
        ) {
            await this.fatalShutdown(
                "Asset cache budget is smaller than total asset size; cannot warm cache without eviction.",
            );
        }

        let filesWarmed = 0;
        for (const r of rows) {
            const key = r?.general__asset_file_name;
            if (!key) continue;
            const filePath = this.getCachedPathForKey(key);
            const fileStat = await this.getCachedFileStat(filePath);
            const dbUpdatedAt = new Date(
                r.asset__data__bytea_updated_at || 0,
            ).getTime();
            const isUpToDate = fileStat && fileStat.mtimeMs >= dbUpdatedAt;
            const approxSize = Number(r.approx_size || 0);

            // Track asset size statistics
            if (approxSize <= smallSizeThreshold) {
                smallAssets++;
            } else {
                normalAssets++;
            }

            if (isUpToDate) continue;

            // Capacity check before fetching
            const projected =
                totalBytes - Number(fileStat?.size || 0) + approxSize;
            if (projected > byteBudget) {
                await this.fatalShutdown(
                    "Asset cache budget exceeded while warming cache; refusing to proceed.",
                );
            }

            try {
                const [dataRow] = await superUserSql<
                    [
                        {
                            asset__data__bytea:
                                | Uint8Array
                                | ArrayBuffer
                                | Buffer
                                | null;
                        },
                    ]
                >`
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
                totalBytes =
                    totalBytes - Number(fileStat?.size || 0) + bytes.byteLength;
                filesWarmed += 1;
            } catch {}
        }

        const durationMs = Math.round(performance.now() - t0);
        this.lastAssetMaintenanceAt = Date.now();
        this.lastAssetMaintenanceDurationMs = durationMs;
        this.lastAssetFilesWarmed = filesWarmed;

        // Log asset cache maintenance results
        if (fullRefresh && (smallAssets > 0 || normalAssets > 0)) {
            const totalAssets = smallAssets + normalAssets;
            const smallPercent =
                totalAssets > 0
                    ? Math.round((smallAssets / totalAssets) * 100)
                    : 0;

            let message = `Asset cache initialization complete - found ${totalAssets} assets (${filesWarmed} warmed in ${durationMs}ms)`;
            if (smallAssets > 0) {
                message += ` with ${smallAssets} small assets (${smallPercent}%) ≤${smallSizeThreshold} bytes`;
            }

            BunLogModule({
                prefix: LOG_PREFIX,
                message,
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                type: smallAssets > 0 ? "warning" : "info",
                data: {
                    smallAssets,
                    normalAssets,
                    totalAssets,
                    smallPercent,
                    smallSizeThreshold,
                    filesWarmed,
                    totalBytes,
                    durationMs,
                },
            });
        } else {
            BunLogModule({
                prefix: LOG_PREFIX,
                message: `Asset cache maintenance complete - ${filesWarmed} files warmed in ${durationMs}ms`,
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                type: "debug",
                data: {
                    filesWarmed,
                    totalBytes,
                    byteBudget: this.assetCacheMaxBytes,
                    durationMs,
                },
            });
        }
    }

    private async getAssetCacheStats(
        forceRefresh = false,
    ): Promise<Service.API.Asset.I_AssetCacheStats> {
        // Return cached stats if fresh enough (within 5 seconds) and not forced
        if (
            !forceRefresh &&
            this.lastCacheStats &&
            Date.now() - this.lastCacheStatsTime < 5000
        ) {
            return this.lastCacheStats;
        }

        // If maintenance is running, we might want to just return what we have or wait?
        // For now, let's do a quick scan if we must, or just return the last known good state if we have it?
        // Actually, readdir is fast, but doing it on every request is bad.
        // Let's implement a lighter check.

        let totalBytes = 0;
        let fileCount = 0;
        try {
            // If the cache is huge, this is still slow.
            // But doing it here allows us to update the cached stats.
            const entries = await readdir(this.assetCacheDir, {
                withFileTypes: true,
            });
            for (const entry of entries) {
                if (!entry.isFile()) continue;
                fileCount += 1;
                try {
                    const s = await stat(
                        path.join(this.assetCacheDir, entry.name),
                    );
                    if (s.isFile()) totalBytes += s.size;
                } catch {}
            }
        } catch {}

        this.lastCacheStats = {
            dir: this.assetCacheDir,
            maxMegabytes: this.assetCacheMaxBytes / 1024 / 1024,
            totalMegabytes: totalBytes / 1024 / 1024,
            fileCount,
            inFlight: this.assetInFlight.size,
            lastMaintenanceAt: this.lastAssetMaintenanceAt ?? null,
            lastMaintenanceDurationMs:
                this.lastAssetMaintenanceDurationMs ?? null,
            filesWarmedLastRun: this.lastAssetFilesWarmed ?? null,
        };
        this.lastCacheStatsTime = Date.now();
        return this.lastCacheStats;
    }

    async initialize() {
        BunLogModule({
            prefix: LOG_PREFIX,
            message: "Initializing World API Asset Manager - Speed Test Optimized",
            debug: serverConfiguration.VRCA_SERVER_DEBUG,
            suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
            type: "info",
            data: {
                assetCacheDir: this.assetCacheDir,
                assetCacheMaxBytes: this.assetCacheMaxBytes,
                assetCacheMaintenanceIntervalMs:
                    this.assetCacheMaintenanceIntervalMs,
            },
        });

        legacySuperUserSql = await BunPostgresClientModule.getInstance({
            debug: serverConfiguration.VRCA_SERVER_DEBUG,
            suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
        }).getLegacySuperClient({
            postgres: {
                host: serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_CONTAINER_NAME,
                port: serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_PORT_CONTAINER_BIND_EXTERNAL,
                database:
                    serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_DATABASE,
                username:
                    serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_SUPER_USER_USERNAME,
                password:
                    serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
            },
        });

        superUserSql = await BunPostgresClientModule.getInstance({
            debug: serverConfiguration.VRCA_SERVER_DEBUG,
            suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
        }).getSuperClient({
            postgres: {
                host: serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_CONTAINER_NAME,
                port: serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_PORT_CONTAINER_BIND_EXTERNAL,
                database:
                    serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_DATABASE,
                username:
                    serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_SUPER_USER_USERNAME,
                password:
                    serverConfiguration.VRCA_SERVER_SERVICE_POSTGRES_SUPER_USER_PASSWORD,
            },
        });

        if (superUserSql) {
            this.aclService = new AclService({
                db: superUserSql,
                legacyDb: legacySuperUserSql,
            });
            await this.aclService.startRoleChangeListener();
        }

        // Initial cache warm (fatal if capacity cannot be satisfied)
        try {
            await this.maintainAssetCache(true);
        } catch (error) {
            await this.fatalShutdown("Initial cache warm failed", error);
        }

        // Start periodic maintenance
        this.startPeriodicMaintenance();

        // HTTP Server
        this.server = Bun.serve({
            hostname: "0.0.0.0",
            port: 3023,
            development: serverConfiguration.VRCA_SERVER_DEBUG,
            fetch: async (req: Request, server: Server<unknown>) => {
                try {
                    const url = new URL(req.url);

                    // Request trace (with sensitive data redacted)
                    try {
                        const redactedSearch = (() => {
                            try {
                                const sp = new URLSearchParams(url.search);
                                if (sp.has("token"))
                                    sp.set("token", "[REDACTED]");
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
                            type: "info",
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

                    // Speed Test Download
                    if (
                        url.pathname ===
                        "/world/rest/asset/speedtest/download" &&
                        (req.method === "GET" || req.method === "HEAD")
                    ) {
                        const sizeStr = url.searchParams.get("size");
                        let size = sizeStr
                            ? parseInt(sizeStr)
                            : 10 * 1024 * 1024; // Default 10MB
                        // Cap at 100MB to prevent abuse
                        if (size > 100 * 1024 * 1024)
                            size = 100 * 1024 * 1024;
                        if (size < 0) size = 1024;

                        const headers = new Headers({
                            "Content-Type": "application/octet-stream",
                            "Cache-Control":
                                "no-store, no-cache, must-revalidate, proxy-revalidate",
                            Pragma: "no-cache",
                            Expires: "0",
                            "Content-Length": size.toString(),
                        });

                        if (req.method === "HEAD") {
                            const response = new Response(null, {
                                status: 200,
                                headers,
                            });
                            return this.addCorsHeaders(response, req);
                        }

                        // Use sliced view of zero buffer to avoid allocation
                        // If requested size > ZERO_BUFFER size, we might need multiple chunks or just limit it?
                        // For simplicity and performance, if size > ZERO_BUFFER, we just reuse it circularly or just alloc if really needed.
                        // But 100MB allocation is bad.
                        // Let's just limit the speed test to max 10MB per request in the client, but here we support up to 100MB?
                        // If we serve a stream, we can repeat the zero buffer.
                        // But Response(Uint8Array) matches content-length automatically?
                        // Let's stick to returning a view if size <= 10MB.
                        // If size > 10MB, we'll alloc for now (rare case) or just cap client tests to 10MB.
                        // Client asks for 5MB so we are good.

                        let body: Uint8Array;
                        if (size <= WorldApiAssetManager.ZERO_BUFFER.length) {
                            body = WorldApiAssetManager.ZERO_BUFFER.subarray(
                                0,
                                size,
                            );
                        } else {
                            // Fallback for large requests (should be rare)
                            body = new Uint8Array(size);
                        }

                        const response = new Response(body as any, {
                            status: 200,
                            headers,
                        });
                        return this.addCorsHeaders(response, req);
                    }

                    // Speed Test Ping
                    if (
                        url.pathname === "/world/rest/asset/speedtest/ping" &&
                        req.method === "GET"
                    ) {
                        const response = new Response("pong", {
                            status: 200,
                            headers: {
                                "Content-Type": "text/plain",
                                "Cache-Control": "no-cache",
                            },
                        });
                        return this.addCorsHeaders(response, req);
                    }

                    // Speed Test Upload
                    if (
                        url.pathname === "/world/rest/asset/speedtest/upload" &&
                        req.method === "POST"
                    ) {
                        // Consume the body stream to ensure we measure the full upload time
                        // without buffering the entire file in memory
                        if (req.body) {
                            const reader = req.body.getReader();
                            while (true) {
                                const { done } = await reader.read();
                                if (done) break;
                            }
                        }
                        
                        const response = new Response(JSON.stringify({ status: "ok" }), {
                            status: 200,
                            headers: {
                                "Content-Type": "application/json",
                            }
                        });
                        return this.addCorsHeaders(response, req);
                    }

                    // Stats (moved to official REST endpoint)
                    if (
                        url.pathname.startsWith(
                            Communication.REST.Endpoint.ASSET_STATS.path,
                        ) &&
                        req.method ===
                            Communication.REST.Endpoint.ASSET_STATS.method
                    ) {
                        BunLogModule({
                            prefix: LOG_PREFIX,
                            message: "Stats endpoint accessed",
                            debug: serverConfiguration.VRCA_SERVER_DEBUG,
                            suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                            type: "debug",
                            data: {
                                method: req.method,
                                pathname: url.pathname,
                            },
                        });
                        const requestIP =
                            req.headers.get("x-forwarded-for")?.split(",")[0] ||
                            server.requestIP(req)?.address ||
                            "";
                        const isLocalhost =
                            requestIP === "127.0.0.1" ||
                            requestIP === "::1" ||
                            requestIP === "localhost";
                        const isDockerInternal =
                            requestIP.startsWith("172.") ||
                            requestIP.startsWith("192.168.") ||
                            requestIP.startsWith("10.") ||
                            requestIP === "::ffff:127.0.0.1";
                        if (!isLocalhost && !isDockerInternal) {
                            return this.createJsonResponse(
                                Communication.REST.Endpoint.ASSET_STATS.createError(
                                    "Forbidden.",
                                ),
                                req,
                                403,
                            );
                        }
                        const response = this.createJsonResponse(
                            Communication.REST.Z.AssetStatsSuccess.parse({
                                success: true,
                                timestamp: Date.now(),
                                uptime: process.uptime(),
                                connections:
                                    this.metricsCollector.getSystemMetrics(true)
                                        .connections,
                                database: {
                                    connected: !!superUserSql,
                                    connections:
                                        this.metricsCollector.getSystemMetrics(
                                            true,
                                        ).database.connections,
                                },
                                memory: this.metricsCollector.getSystemMetrics(
                                    true,
                                ).memory,
                                cpu: this.metricsCollector.getSystemMetrics(
                                    true,
                                ).cpu,
                                assets: {
                                    cache: await this.getAssetCacheStats(),
                                },
                            }),
                            req,
                        );
                        return response;
                    }

                    if (!superUserSql) {
                        return this.createJsonResponse(
                            { error: "Internal server error" },
                            req,
                            500,
                        );
                    }

                    if (
                        url.pathname.startsWith(
                            Communication.REST_BASE_ASSET_PATH,
                        )
                    ) {
                        BunLogModule({
                            prefix: LOG_PREFIX,
                            message: "Asset base path matched",
                            debug: serverConfiguration.VRCA_SERVER_DEBUG,
                            suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                            type: "debug",
                            data: { pathname: url.pathname },
                        });
                        switch (true) {
                            // Asset fetch by key (authenticated)
                            case url.pathname ===
                                Communication.REST.Endpoint.ASSET_GET_BY_KEY
                                    .path && req.method === "GET": {
                                const startTime = performance.now();
                                const requestSize = new TextEncoder().encode(
                                    url.toString(),
                                ).length;
                                const qp = Object.fromEntries(
                                    url.searchParams.entries(),
                                );
                                const parsed =
                                    Communication.REST.Z.AssetGetByKeyQuery.safeParse(
                                        qp,
                                    );
                                if (!parsed.success) {
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.ASSET_GET_BY_KEY.createError(
                                            "Invalid query parameters",
                                        ),
                                        req,
                                        400,
                                    );
                                }
                                const queryData = parsed.data;
                                const key = queryData.key;
                                const token = queryData.token;
                                const provider = queryData.provider;
                                const sessionIdFromQuery = queryData.sessionId;

                                // Check if system is overloaded - return 503 early
                                if (this.isDownloadOverloaded()) {
                                    BunLogModule({
                                        prefix: LOG_PREFIX,
                                        message: "System overloaded, rejecting asset request",
                                        debug: serverConfiguration.VRCA_SERVER_DEBUG,
                                        suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                                        type: "warning",
                                        data: { 
                                            key, 
                                            queueSize: this.downloadQueue.length,
                                            currentDownloads: this.currentDownloads 
                                        },
                                    });
                                    const response = new Response(
                                        JSON.stringify({ error: "Server overloaded, please retry" }),
                                        { 
                                            status: 503, 
                                            headers: { 
                                                "Content-Type": "application/json",
                                                "Retry-After": "2" 
                                            } 
                                        }
                                    );
                                    return this.addCorsHeaders(response, req);
                                }

                                BunLogModule({
                                    prefix: LOG_PREFIX,
                                    message:
                                        "ASSET_GET_BY_KEY request received",
                                    debug: serverConfiguration.VRCA_SERVER_DEBUG,
                                    suppress:
                                        serverConfiguration.VRCA_SERVER_SUPPRESS,
                                    type: "info",
                                    data: {
                                        key,
                                        provider,
                                        sessionIdProvided: !!sessionIdFromQuery,
                                        tokenProvided: !!token,
                                    },
                                });
                                if (!key)
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.ASSET_GET_BY_KEY.createError(
                                            "Missing key",
                                        ),
                                        req,
                                        400,
                                    );

                                let agentIdForAcl: string | null = null;
                                if (sessionIdFromQuery) {
                                    BunLogModule({
                                        prefix: LOG_PREFIX,
                                        message:
                                            "Validating session from query for ACL",
                                        debug: serverConfiguration.VRCA_SERVER_DEBUG,
                                        suppress:
                                            serverConfiguration.VRCA_SERVER_SUPPRESS,
                                        type: "debug",
                                        data: { sessionIdProvided: true },
                                    });
                                    const [sessionResult] = await superUserSql<
                                        [{ agent_id: string }]
                                    >`
                                        SELECT * FROM auth.validate_session_id(${sessionIdFromQuery}::UUID) as agent_id
                                    `;
                                    agentIdForAcl =
                                        sessionResult?.agent_id || null;
                                } else {
                                    BunLogModule({
                                        prefix: LOG_PREFIX,
                                        message: "Validating JWT for ACL",
                                        debug: serverConfiguration.VRCA_SERVER_DEBUG,
                                        suppress:
                                            serverConfiguration.VRCA_SERVER_SUPPRESS,
                                        type: "debug",
                                        data: {
                                            provider,
                                            tokenProvided: !!token,
                                        },
                                    });
                                    if (!token || !provider)
                                        return this.createJsonResponse(
                                            Communication.REST.Endpoint.ASSET_GET_BY_KEY.createError(
                                                "Missing auth",
                                            ),
                                            req,
                                            401,
                                        );
                                    const jwtValidationResult =
                                        await validateJWT({
                                            superUserSql,
                                            provider,
                                            token,
                                        });
                                    if (!jwtValidationResult.isValid)
                                        return this.createJsonResponse(
                                            Communication.REST.Endpoint.ASSET_GET_BY_KEY.createError(
                                                "Invalid token",
                                            ),
                                            req,
                                            401,
                                        );
                                    agentIdForAcl = jwtValidationResult.agentId;
                                }

                                // Determine asset's group and check ACL
                                const [assetRow] = await superUserSql<
                                    [
                                        {
                                            group__sync: string | null;
                                            general__asset_file_name:
                                                | string
                                                | null;
                                            asset__mime_type: string | null;
                                        },
                                    ]
                                >`
                                    SELECT group__sync, general__asset_file_name, asset__mime_type
                                    FROM entity.entity_assets
                                    WHERE general__asset_file_name = ${key}
                                `;
                                const syncGroup =
                                    assetRow?.group__sync || "public.STATIC";
                                const agentId = agentIdForAcl || "";
                                if (agentId)
                                    await this.aclService?.warmAgentAcl(
                                        agentId,
                                    );
                                const canRead = agentId
                                    ? this.aclService?.canRead(
                                          agentId,
                                          syncGroup,
                                      )
                                    : false;
                                BunLogModule({
                                    prefix: LOG_PREFIX,
                                    message: "ACL evaluated for asset",
                                    debug: serverConfiguration.VRCA_SERVER_DEBUG,
                                    suppress:
                                        serverConfiguration.VRCA_SERVER_SUPPRESS,
                                    type: "debug",
                                    data: {
                                        key,
                                        agentIdProvided: !!agentId,
                                        syncGroup,
                                        canRead,
                                    },
                                });
                                if (!canRead)
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.ASSET_GET_BY_KEY.createError(
                                            "Forbidden",
                                        ),
                                        req,
                                        403,
                                    );

                                // Try local cache
                                const filePath = this.getCachedPathForKey(key);
                                const cached = await this.isCached(filePath);
                                BunLogModule({
                                    prefix: LOG_PREFIX,
                                    message: "Asset cache lookup",
                                    debug: serverConfiguration.VRCA_SERVER_DEBUG,
                                    suppress:
                                        serverConfiguration.VRCA_SERVER_SUPPRESS,
                                    type: "debug",
                                    data: { key, filePath, cached },
                                });
                                if (cached) {
                                    const file = Bun.file(filePath);
                                    const headers = new Headers();
                                    if (assetRow?.asset__mime_type)
                                        headers.set(
                                            "Content-Type",
                                            assetRow.asset__mime_type,
                                        );
                                    // Use cached stat to avoid disk I/O
                                    const fileStat = await this.getCachedFileStat(filePath);
                                    const diskSize = fileStat?.size || 0;
                                    if (diskSize > 0)
                                        headers.set(
                                            "Content-Length",
                                            String(diskSize),
                                        );
                                    // Prevent reverse proxy buffering for large files
                                    headers.set("X-Accel-Buffering", "no");
                                    const response = new Response(file, {
                                        headers,
                                    });
                                    const dbSize =
                                        await this.getDbAssetSize(key);
                                    const responseSize =
                                        diskSize || file.size || 0;
                                    this.metricsCollector.recordEndpoint(
                                        "ASSET_GET_BY_KEY",
                                        performance.now() - startTime,
                                        requestSize,
                                        responseSize,
                                        true,
                                    );
                                    const durationMs = performance.now() - startTime;
                                    BunLogModule({
                                        prefix: LOG_PREFIX,
                                        message: "Asset served from cache",
                                        debug: serverConfiguration.VRCA_SERVER_DEBUG,
                                        suppress:
                                            serverConfiguration.VRCA_SERVER_SUPPRESS,
                                        type: "info",
                                        data: {
                                            key,
                                            filePath,
                                            dbSize,
                                            diskSize,
                                            responseSize,
                                            contentType:
                                                assetRow?.asset__mime_type ||
                                                null,
                                            durationMs,
                                        },
                                    });
                                    return this.addCorsHeaders(response, req);
                                }

                                // Fallback to DB
                                BunLogModule({
                                    prefix: LOG_PREFIX,
                                    message: "Fetching asset from database",
                                    debug: serverConfiguration.VRCA_SERVER_DEBUG,
                                    suppress:
                                        serverConfiguration.VRCA_SERVER_SUPPRESS,
                                    type: "debug",
                                    data: { key },
                                });
                                const [row] = await superUserSql<
                                    [
                                        {
                                            asset__data__bytea:
                                                | Uint8Array
                                                | ArrayBuffer
                                                | Buffer
                                                | null;
                                            asset__mime_type: string | null;
                                        },
                                    ]
                                >`
                                    SELECT asset__data__bytea, asset__mime_type
                                    FROM entity.entity_assets
                                    WHERE general__asset_file_name = ${key}
                                `;
                                const payload = row?.asset__data__bytea;
                                if (!payload) {
                                    BunLogModule({
                                        prefix: LOG_PREFIX,
                                        message: "Asset not found in database",
                                        debug: serverConfiguration.VRCA_SERVER_DEBUG,
                                        suppress:
                                            serverConfiguration.VRCA_SERVER_SUPPRESS,
                                        type: "info",
                                        data: { key },
                                    });
                                    return this.createJsonResponse(
                                        Communication.REST.Endpoint.ASSET_GET_BY_KEY.createError(
                                            "Not found",
                                        ),
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
                                        Communication.REST.Endpoint.ASSET_GET_BY_KEY.createError(
                                            "Bad asset",
                                        ),
                                        req,
                                        500,
                                    );
                                await this.ensureAssetCacheDir();
                                // Enforce capacity strictly: must write to cache or shutdown
                                const currentTotal =
                                    await this.getCacheCurrentTotalBytes();
                                const byteBudget =
                                    this.assetCacheMaxBytes ||
                                    Number.MAX_SAFE_INTEGER;
                                if (
                                    currentTotal + bytes.byteLength >
                                    byteBudget
                                ) {
                                    await this.fatalShutdown(
                                        "Asset cache budget exceeded during request-time population",
                                    );
                                }
                                await this.cacheWriteFile(filePath, bytes);
                                const headers = new Headers();
                                if (row?.asset__mime_type)
                                    headers.set(
                                        "Content-Type",
                                        row.asset__mime_type,
                                    );
                                // Use cached stat (was just written, so will be invalidated and re-fetched)
                                const fileStat = await this.getCachedFileStat(filePath);
                                const diskSize = fileStat?.size || 0;
                                if (diskSize > 0)
                                    headers.set(
                                        "Content-Length",
                                        String(diskSize),
                                    );
                                // Prevent reverse proxy buffering for large files
                                headers.set("X-Accel-Buffering", "no");
                                const response = new Response(
                                    Bun.file(filePath),
                                    { headers },
                                );
                                const dbSize = bytes.byteLength;
                                const responseSize = diskSize || dbSize;
                                this.metricsCollector.recordEndpoint(
                                    "ASSET_GET_BY_KEY",
                                    performance.now() - startTime,
                                    requestSize,
                                    responseSize,
                                    true,
                                );
                                const durationMs = performance.now() - startTime;
                                BunLogModule({
                                    prefix: LOG_PREFIX,
                                    message:
                                        "Asset served from cache after DB fetch",
                                    debug: serverConfiguration.VRCA_SERVER_DEBUG,
                                    suppress:
                                        serverConfiguration.VRCA_SERVER_SUPPRESS,
                                    type: "info",
                                    data: {
                                        key,
                                        filePath,
                                        dbSize,
                                        diskSize,
                                        responseSize,
                                        contentType:
                                            row?.asset__mime_type || null,
                                        durationMs,
                                    },
                                });
                                return this.addCorsHeaders(response, req);
                            }

                            default:
                                BunLogModule({
                                    prefix: LOG_PREFIX,
                                    message:
                                        "Asset manager route 404 under asset base path",
                                    debug: serverConfiguration.VRCA_SERVER_DEBUG,
                                    suppress:
                                        serverConfiguration.VRCA_SERVER_SUPPRESS,
                                    type: "info",
                                    data: {
                                        pathname: url.pathname,
                                        method: req.method,
                                    },
                                });
                                return this.createJsonResponse(
                                    { error: "Not found" },
                                    req,
                                    404,
                                );
                        }
                    }

                    BunLogModule({
                        prefix: LOG_PREFIX,
                        message:
                            "Asset manager route 404 (outside asset base path)",
                        debug: serverConfiguration.VRCA_SERVER_DEBUG,
                        suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                        type: "info",
                        data: { pathname: url.pathname, method: req.method },
                    });
                    return this.createJsonResponse(
                        { error: "Not found" },
                        req,
                        404,
                    );
                } catch (error) {
                    BunLogModule({
                        prefix: LOG_PREFIX,
                        message: "Unexpected error in asset manager",
                        error,
                        debug: true,
                        suppress: false,
                        type: "error",
                    });
                    return this.createJsonResponse(
                        { error: "Internal server error" },
                        req,
                        500,
                    );
                }
            },
        });

        BunLogModule({
            prefix: LOG_PREFIX,
            message: `Asset Manager startup complete - listening on 3023 with periodic maintenance every ${this.assetCacheMaintenanceIntervalMs}ms`,
            debug: serverConfiguration.VRCA_SERVER_DEBUG,
            suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
            type: "info",
        });
    }

    async shutdown(): Promise<void> {
        BunLogModule({
            prefix: LOG_PREFIX,
            message: "Shutting down World API Asset Manager",
            debug: serverConfiguration.VRCA_SERVER_DEBUG,
            suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
            type: "info",
        });

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
        BunLogModule({
            prefix: LOG_PREFIX,
            message: `Received ${signal}, initiating graceful shutdown`,
            debug: serverConfiguration.VRCA_SERVER_DEBUG,
            suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
            type: "info",
        });
        try {
            await manager.shutdown();
        } catch (error) {
            BunLogModule({
                prefix: LOG_PREFIX,
                message: "Error during shutdown",
                error,
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                type: "error",
            });
        } finally {
            process.exit(0);
        }
    };

    process.on("SIGINT", () => gracefulShutdown("SIGINT"));
    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

    await manager.initialize();
})();
