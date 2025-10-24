// =============================================================================
// ============================== GROQ STT/TTS SERVICE ==============================
// =============================================================================

import { serverConfiguration } from "../../../../../../sdk/vircadia-world-sdk-ts/bun/src/config/vircadia.server.config";
import { BunLogModule } from "../../../../../../sdk/vircadia-world-sdk-ts/bun/src/module/vircadia.common.bun.log.module";

export interface GroqSTTOptions {
    language?: string;
    prompt?: string;
    responseFormat?: "json" | "text" | "verbose_json";
    temperature?: number;
}

export interface GroqSTTResponse {
    text: string;
    language?: string;
    processingTimeMs: number;
    audioDurationMs?: number;
}

export interface GroqTTSOptions {
    speed?: number;
    voice?: string;
    responseFormat?: "wav" | "mp3" | "opus" | "flac";
}

export interface GroqTTSResponse {
    audio: ArrayBuffer;
    processingTimeMs: number;
    textLength: number;
}

export class GroqService {
    private apiKey: string;
    private baseUrl: string;
    private sttModel: string;
    private ttsModel: string;

    constructor() {
        this.apiKey =
            serverConfiguration.VRCA_SERVER_SERVICE_INFERENCE_GROQ_API_KEY;
        this.baseUrl =
            serverConfiguration.VRCA_SERVER_SERVICE_INFERENCE_GROQ_BASE_URL;
        this.sttModel =
            serverConfiguration.VRCA_SERVER_SERVICE_INFERENCE_GROQ_STT_MODEL;
        this.ttsModel =
            serverConfiguration.VRCA_SERVER_SERVICE_INFERENCE_GROQ_TTS_MODEL;

        if (!this.apiKey) {
            BunLogModule({
                prefix: "Groq Service",
                message: "Groq API key not configured",
                type: "warn",
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
            });
        } else {
            BunLogModule({
                prefix: "Groq Service",
                message: "Groq Service configured",
                data: {
                    apiKey: this.apiKey,
                    baseUrl: this.baseUrl,
                    sttModel: this.sttModel,
                    ttsModel: this.ttsModel,
                },
                type: "info",
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
            });
        }
    }

    async speechToText(
        audioData: ArrayBuffer,
        options: GroqSTTOptions = {},
    ): Promise<GroqSTTResponse> {
        const startTime = Date.now();

        if (!this.apiKey) {
            throw new Error("Groq API key not configured");
        }

        try {
            // Create form data
            const formData = new FormData();
            const audioBlob = new Blob([audioData], { type: "audio/wav" });
            formData.append("file", audioBlob, "audio.wav");
            formData.append("model", this.sttModel);

            if (options.language) {
                formData.append("language", options.language);
            }
            if (options.prompt) {
                formData.append("prompt", options.prompt);
            }
            if (options.responseFormat) {
                formData.append("response_format", options.responseFormat);
            }
            if (options.temperature !== undefined) {
                formData.append("temperature", options.temperature.toString());
            }

            const response = await fetch(
                `${this.baseUrl}/openai/v1/audio/transcriptions`,
                {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${this.apiKey}`,
                    },
                    body: formData,
                },
            );

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(
                    `Groq STT API error: ${response.status} - ${errorText}`,
                );
            }

            const data = await response.json();
            const processingTimeMs = Date.now() - startTime;

            return {
                text: data.text || "",
                language: data.language,
                processingTimeMs,
                audioDurationMs: data.duration,
            };
        } catch (error) {
            BunLogModule({
                prefix: "Groq Service",
                message: "Error in speech-to-text",
                error,
                type: "error",
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
            });
            throw error;
        }
    }

    async textToSpeech(
        text: string,
        options: GroqTTSOptions = {},
    ): Promise<GroqTTSResponse> {
        const startTime = Date.now();

        if (!this.apiKey) {
            throw new Error("Groq API key not configured");
        }

        try {
            const requestBody = {
                model: this.ttsModel,
                input: text,
                voice: options.voice || "Aaliyah-PlayAI",
                speed: options.speed || 1.0,
                response_format: options.responseFormat || "wav",
            };

            const response = await fetch(
                `${this.baseUrl}/openai/v1/audio/speech`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${this.apiKey}`,
                    },
                    body: JSON.stringify(requestBody),
                },
            );

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(
                    `Groq TTS API error: ${response.status} - ${errorText}`,
                );
            }

            const audioData = await response.arrayBuffer();
            const processingTimeMs = Date.now() - startTime;

            return {
                audio: audioData,
                processingTimeMs,
                textLength: text.length,
            };
        } catch (error) {
            BunLogModule({
                prefix: "Groq Service",
                message: "Error in text-to-speech",
                error,
                type: "error",
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
            });
            throw error;
        }
    }
}
