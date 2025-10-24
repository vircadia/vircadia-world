// =============================================================================
// ========================== WORLD API INFERENCE MANAGER =======================
// =============================================================================

import type { Server, SQL } from "bun";
import type { Sql } from "postgres";
import { serverConfiguration } from "../../../../../sdk/vircadia-world-sdk-ts/bun/src/config/vircadia.server.config";
import { BunLogModule } from "../../../../../sdk/vircadia-world-sdk-ts/bun/src/module/vircadia.common.bun.log.module";
import { BunPostgresClientModule } from "../../../../../sdk/vircadia-world-sdk-ts/bun/src/module/vircadia.common.bun.postgres.module";
import { AclService } from "../../../../../sdk/vircadia-world-sdk-ts/bun/src/module/vircadia.server.auth.module";
import { Communication } from "../../../../../sdk/vircadia-world-sdk-ts/schema/src/vircadia.schema.general";
import {
    isDockerInternalIP,
    isLocalhostIP,
    isLocalhostOrigin,
} from "../../../../module/general.server.util";
import { CerebrasService } from "./service/cerebras";
import { GroqService } from "./service/groq";
import { MetricsCollector } from "./service/metrics";

let legacySuperUserSql: Sql | null = null;
let superUserSql: SQL | null = null;

const LOG_PREFIX = "World API Inference Manager";

class WorldApiInferenceManager {
    private server: Server<unknown> | undefined;
    private metricsCollector = new MetricsCollector();
    private aclService: AclService | null = null;
    private cerebrasService = new CerebrasService();
    private groqService = new GroqService();

    private addCorsHeaders(response: Response, req: Request): Response {
        const origin = req.headers.get("origin");

        // Auto-allow localhost and 127.0.0.1 on any port for development
        const isLocalhost = origin && isLocalhostOrigin(origin);

        // Build allowed origins for production
        const allowedOrigins = [
            // Frontend domain
            `https://${serverConfiguration.VRCA_SERVER_SERVICE_CADDY_DOMAIN_APP}`,
            // Inference Manager's own public endpoint
            serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_INFERENCE_MANAGER_SSL_ENABLED_PUBLIC_AVAILABLE_AT
                ? `https://${serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_INFERENCE_MANAGER_HOST_PUBLIC_AVAILABLE_AT}${serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_INFERENCE_MANAGER_PORT_PUBLIC_AVAILABLE_AT !== 443 ? `:${serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_INFERENCE_MANAGER_PORT_PUBLIC_AVAILABLE_AT}` : ""}`
                : `http://${serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_INFERENCE_MANAGER_HOST_PUBLIC_AVAILABLE_AT}${serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_INFERENCE_MANAGER_PORT_PUBLIC_AVAILABLE_AT !== 80 ? `:${serverConfiguration.VRCA_SERVER_SERVICE_WORLD_API_REST_INFERENCE_MANAGER_PORT_PUBLIC_AVAILABLE_AT}` : ""}`,
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

    // SSE response helper for future inference endpoints
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    private createSseResponse(stream: ReadableStream, req: Request): Response {
        const response = new Response(stream, {
            headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                Connection: "keep-alive",
            },
        });
        return this.addCorsHeaders(response, req);
    }

    async initialize() {
        BunLogModule({
            prefix: LOG_PREFIX,
            message: "Initializing World API Inference Manager",
            debug: serverConfiguration.VRCA_SERVER_DEBUG,
            suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
            type: "info",
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

        // HTTP Server
        this.server = Bun.serve({
            hostname: "0.0.0.0",
            port: 3024,
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

                    // Stats endpoint
                    if (
                        url.pathname.startsWith(
                            Communication.REST.Endpoint.INFERENCE_STATS.path,
                        ) &&
                        req.method ===
                            Communication.REST.Endpoint.INFERENCE_STATS.method
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
                        const isLocalhost = isLocalhostIP(requestIP);
                        const isDockerInternal = isDockerInternalIP(requestIP);
                        if (!isLocalhost && !isDockerInternal) {
                            return this.createJsonResponse(
                                Communication.REST.Endpoint.INFERENCE_STATS.createError(
                                    "Forbidden.",
                                ),
                                req,
                                403,
                            );
                        }
                        const response = this.createJsonResponse(
                            Communication.REST.Z.InferenceStatsSuccess.parse({
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
                            Communication.REST_BASE_INFERENCE_PATH,
                        )
                    ) {
                        BunLogModule({
                            prefix: LOG_PREFIX,
                            message: "Inference base path matched",
                            debug: serverConfiguration.VRCA_SERVER_DEBUG,
                            suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
                            type: "debug",
                            data: { pathname: url.pathname },
                        });

                        // LLM endpoint
                        if (
                            url.pathname ===
                                `${Communication.REST_BASE_INFERENCE_PATH}/llm` &&
                            req.method === "POST"
                        ) {
                            return this.handleLLMRequest(req);
                        }

                        // LLM stream endpoint
                        if (
                            url.pathname ===
                                `${Communication.REST_BASE_INFERENCE_PATH}/llm/stream` &&
                            req.method === "POST"
                        ) {
                            return this.handleLLMStreamRequest(req);
                        }

                        // STT endpoint
                        if (
                            url.pathname ===
                                `${Communication.REST_BASE_INFERENCE_PATH}/stt` &&
                            req.method === "POST"
                        ) {
                            return this.handleSTTRequest(req);
                        }

                        // TTS endpoint
                        if (
                            url.pathname ===
                                `${Communication.REST_BASE_INFERENCE_PATH}/tts` &&
                            req.method === "POST"
                        ) {
                            return this.handleTTSRequest(req);
                        }

                        switch (true) {
                            default:
                                BunLogModule({
                                    prefix: LOG_PREFIX,
                                    message:
                                        "Inference manager route 404 under inference base path",
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
                            "Inference manager route 404 (outside inference base path)",
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
                        message: "Unexpected error in inference manager",
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
            message: `Inference Manager startup complete - listening on 3024`,
            debug: serverConfiguration.VRCA_SERVER_DEBUG,
            suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
            type: "info",
        });
    }

    private async handleLLMRequest(req: Request): Promise<Response> {
        const startTime = Date.now();
        try {
            const body = await req.json();
            const { prompt, temperature, maxTokens, stopSequences } = body;

            if (!prompt) {
                return this.createJsonResponse(
                    { error: "Prompt is required" },
                    req,
                    400,
                );
            }

            const result = await this.cerebrasService.generateText(prompt, {
                temperature,
                maxTokens,
                stopSequences,
            });

            // Record metrics
            this.metricsCollector.recordLLMMetrics(
                result.processingTimeMs,
                result.tokensPerSecond,
            );
            this.metricsCollector.recordEndpoint(
                "/llm",
                Date.now() - startTime,
                0,
                0,
                true,
            );

            return this.createJsonResponse(
                {
                    success: true,
                    text: result.text,
                    finishReason: result.finishReason,
                    tokens: result.tokens,
                    processingTimeMs: result.processingTimeMs,
                    tokensPerSecond: result.tokensPerSecond,
                },
                req,
            );
        } catch (error) {
            this.metricsCollector.recordEndpoint(
                "/llm",
                Date.now() - startTime,
                0,
                0,
                false,
            );
            BunLogModule({
                prefix: LOG_PREFIX,
                message: "Error handling LLM request",
                error,
                type: "error",
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
            });
            return this.createJsonResponse(
                { error: "Failed to generate text" },
                req,
                500,
            );
        }
    }

    private async handleLLMStreamRequest(req: Request): Promise<Response> {
        const startTime = Date.now();
        try {
            const body = await req.json();
            const { prompt, temperature, maxTokens, stopSequences } = body;

            if (!prompt) {
                return this.createJsonResponse(
                    { error: "Prompt is required" },
                    req,
                    400,
                );
            }

            const cerebrasService = this.cerebrasService;
            const stream = new ReadableStream({
                async start(controller) {
                    try {
                        for await (const chunk of cerebrasService.generateTextStream(
                            prompt,
                            {
                                temperature,
                                maxTokens,
                                stopSequences,
                            },
                        )) {
                            controller.enqueue(
                                new TextEncoder().encode(
                                    `data: ${JSON.stringify({ chunk })}\n\n`,
                                ),
                            );
                        }
                        controller.enqueue(
                            new TextEncoder().encode("data: [DONE]\n\n"),
                        );
                        controller.close();
                    } catch (error) {
                        controller.error(error);
                    }
                },
            });

            this.metricsCollector.recordEndpoint(
                "/llm/stream",
                Date.now() - startTime,
                0,
                0,
                true,
            );

            return this.createSseResponse(stream, req);
        } catch (error) {
            this.metricsCollector.recordEndpoint(
                "/llm/stream",
                Date.now() - startTime,
                0,
                0,
                false,
            );
            BunLogModule({
                prefix: LOG_PREFIX,
                message: "Error handling LLM stream request",
                error,
                type: "error",
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
            });
            return this.createJsonResponse(
                { error: "Failed to stream text" },
                req,
                500,
            );
        }
    }

    private async handleSTTRequest(req: Request): Promise<Response> {
        const startTime = Date.now();
        try {
            const formData = await req.formData();
            const audioFile = formData.get("audio");

            if (!audioFile || !(audioFile instanceof File)) {
                return this.createJsonResponse(
                    { error: "Audio file is required" },
                    req,
                    400,
                );
            }

            const audioBuffer = await audioFile.arrayBuffer();
            const language = formData.get("language")?.toString();
            const prompt = formData.get("prompt")?.toString();
            const responseFormat = formData.get("responseFormat")?.toString() as
                | "json"
                | "text"
                | "verbose_json"
                | undefined;
            const temperatureParam = formData.get("temperature");
            const temperature = temperatureParam
                ? Number.parseFloat(temperatureParam.toString())
                : undefined;

            const result = await this.groqService.speechToText(audioBuffer, {
                language,
                prompt,
                responseFormat,
                temperature,
            });

            // Record metrics
            this.metricsCollector.recordSTTMetrics(result.processingTimeMs);
            this.metricsCollector.recordEndpoint(
                "/stt",
                Date.now() - startTime,
                audioBuffer.byteLength,
                0,
                true,
            );

            return this.createJsonResponse(
                {
                    success: true,
                    text: result.text,
                    language: result.language,
                    processingTimeMs: result.processingTimeMs,
                    audioDurationMs: result.audioDurationMs,
                },
                req,
            );
        } catch (error) {
            this.metricsCollector.recordEndpoint(
                "/stt",
                Date.now() - startTime,
                0,
                0,
                false,
            );
            BunLogModule({
                prefix: LOG_PREFIX,
                message: "Error handling STT request",
                error,
                type: "error",
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
            });
            return this.createJsonResponse(
                { error: "Failed to transcribe audio" },
                req,
                500,
            );
        }
    }

    private async handleTTSRequest(req: Request): Promise<Response> {
        const startTime = Date.now();
        try {
            const body = await req.json();
            const { text, speed, voice, responseFormat } = body;

            if (!text) {
                return this.createJsonResponse(
                    { error: "Text is required" },
                    req,
                    400,
                );
            }

            const result = await this.groqService.textToSpeech(text, {
                speed,
                voice,
                responseFormat,
            });

            // Record metrics
            this.metricsCollector.recordTTSMetrics(result.processingTimeMs);
            this.metricsCollector.recordEndpoint(
                "/tts",
                Date.now() - startTime,
                text.length,
                result.audio.byteLength,
                true,
            );

            // Set Content-Type based on response format
            const contentType = (() => {
                switch (responseFormat || "wav") {
                    case "wav":
                        return "audio/wav";
                    case "mp3":
                        return "audio/mpeg";
                    case "opus":
                        return "audio/opus";
                    case "flac":
                        return "audio/flac";
                    default:
                        return "audio/wav";
                }
            })();

            const response = new Response(result.audio, {
                headers: {
                    "Content-Type": contentType,
                    "Content-Length": result.audio.byteLength.toString(),
                },
            });
            return this.addCorsHeaders(response, req);
        } catch (error) {
            this.metricsCollector.recordEndpoint(
                "/tts",
                Date.now() - startTime,
                0,
                0,
                false,
            );
            BunLogModule({
                prefix: LOG_PREFIX,
                message: "Error handling TTS request",
                error,
                type: "error",
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
            });
            return this.createJsonResponse(
                { error: "Failed to synthesize speech" },
                req,
                500,
            );
        }
    }

    async shutdown(): Promise<void> {
        BunLogModule({
            prefix: LOG_PREFIX,
            message: "Shutting down World API Inference Manager",
            debug: serverConfiguration.VRCA_SERVER_DEBUG,
            suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
            type: "info",
        });

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
    const manager = new WorldApiInferenceManager();

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
