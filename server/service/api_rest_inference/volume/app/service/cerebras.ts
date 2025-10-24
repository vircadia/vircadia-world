// =============================================================================
// ============================ CEREBRAS LLM SERVICE ============================
// =============================================================================

import Cerebras from "@cerebras/cerebras_cloud_sdk";
import { serverConfiguration } from "../../../../../../sdk/vircadia-world-sdk-ts/bun/src/config/vircadia.server.config";
import { BunLogModule } from "../../../../../../sdk/vircadia-world-sdk-ts/bun/src/module/vircadia.common.bun.log.module";

export interface CerebrasOptions {
    temperature?: number;
    maxTokens?: number;
    stopSequences?: string[];
}

export interface CerebrasResponse {
    text: string;
    finishReason: string;
    tokens?: {
        prompt: number;
        completion: number;
        total: number;
    };
    processingTimeMs: number;
    tokensPerSecond?: number;
}

export class CerebrasService {
    private client: Cerebras;
    private model: string;

    constructor() {
        const apiKey =
            serverConfiguration.VRCA_SERVER_SERVICE_INFERENCE_CEREBRAS_API_KEY;
        this.model =
            serverConfiguration.VRCA_SERVER_SERVICE_INFERENCE_CEREBRAS_MODEL;

        if (!apiKey) {
            BunLogModule({
                prefix: "Cerebras Service",
                message: "Cerebras API key not configured",
                type: "warn",
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
            });
        }

        this.client = new Cerebras({
            apiKey,
        });

        BunLogModule({
            prefix: "Cerebras Service",
            message: "Cerebras Service configured",
            data: {
                apiKey,
                model: this.model,
            },
            type: "info",
        });
    }

    async generateText(
        prompt: string,
        options: CerebrasOptions = {},
    ): Promise<CerebrasResponse> {
        const startTime = Date.now();

        try {
            // TypeScript inference fails here due to SDK type complexity, but runtime behavior is correct
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const chatCompletion: any =
                await this.client.chat.completions.create({
                    messages: [{ role: "user", content: prompt }],
                    model: this.model,
                    temperature: options.temperature ?? 0.7,
                    max_tokens: options.maxTokens ?? 256,
                    ...(options.stopSequences &&
                    options.stopSequences.length > 0
                        ? { stop: options.stopSequences }
                        : {}),
                });

            const processingTimeMs = Date.now() - startTime;

            const text = chatCompletion.choices?.[0]?.message?.content || "";
            const finishReason =
                chatCompletion.choices?.[0]?.finish_reason || "unknown";

            // Extract token counts if available
            const promptTokens = chatCompletion.usage?.prompt_tokens || 0;
            const completionTokens =
                chatCompletion.usage?.completion_tokens || 0;
            const totalTokens = chatCompletion.usage?.total_tokens || 0;

            // Calculate tokens per second
            const tokensPerSecond =
                processingTimeMs > 0
                    ? (completionTokens / processingTimeMs) * 1000
                    : undefined;

            return {
                text,
                finishReason,
                tokens: {
                    prompt: promptTokens,
                    completion: completionTokens,
                    total: totalTokens,
                },
                processingTimeMs,
                tokensPerSecond,
            };
        } catch (error) {
            BunLogModule({
                prefix: "Cerebras Service",
                message: "Error generating text",
                error,
                type: "error",
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
            });
            throw error;
        }
    }

    async *generateTextStream(
        prompt: string,
        options: CerebrasOptions = {},
    ): AsyncGenerator<string, void, unknown> {
        try {
            // TypeScript inference fails here due to SDK type complexity, but runtime behavior is correct
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const stream: any = await this.client.chat.completions.create({
                messages: [{ role: "user", content: prompt }],
                model: this.model,
                temperature: options.temperature ?? 0.7,
                max_tokens: options.maxTokens ?? 256,
                ...(options.stopSequences && options.stopSequences.length > 0
                    ? { stop: options.stopSequences }
                    : {}),
                stream: true,
            });

            for await (const chunk of stream) {
                const content = chunk.choices?.[0]?.delta?.content;
                if (content) {
                    yield content;
                }
            }
        } catch (error) {
            BunLogModule({
                prefix: "Cerebras Service",
                message: "Error streaming text",
                error,
                type: "error",
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
            });
            throw error;
        }
    }
}
