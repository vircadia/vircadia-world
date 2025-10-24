// =============================================================================
// ============================== GROQ STT/TTS SERVICE ==============================
// =============================================================================

import Groq from "groq-sdk";
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
    responseFormat?: "wav" | "mp3" | "flac" | "mulaw" | "ogg";
}

export interface GroqTTSResponse {
    audio: ArrayBuffer;
    processingTimeMs: number;
    textLength: number;
}

export class GroqService {
    private client: Groq | undefined;
    private sttModel: string;
    private ttsModel: string;
    private ttsVoice: string;
    constructor() {
        const apiKey =
            serverConfiguration.VRCA_SERVER_SERVICE_INFERENCE_GROQ_API_KEY;
        this.sttModel =
            serverConfiguration.VRCA_SERVER_SERVICE_INFERENCE_GROQ_STT_MODEL;
        this.ttsModel =
            serverConfiguration.VRCA_SERVER_SERVICE_INFERENCE_GROQ_TTS_MODEL;
        this.ttsVoice =
            serverConfiguration.VRCA_SERVER_SERVICE_INFERENCE_GROQ_TTS_VOICE;

        if (!apiKey) {
            BunLogModule({
                prefix: "Groq Service",
                message: "Groq API key not configured",
                type: "warn",
                debug: serverConfiguration.VRCA_SERVER_DEBUG,
                suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
            });
        } else {
            this.client = new Groq({
                apiKey,
            });
            BunLogModule({
                prefix: "Groq Service",
                message: "Groq Service configured",
                data: {
                    sttModel: this.sttModel,
                    ttsModel: this.ttsModel,
                    ttsVoice: this.ttsVoice,
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

        if (!this.client) {
            throw new Error("Groq API key not configured");
        }

        try {
            // Create File object from ArrayBuffer
            const audioFile = new File([audioData], "audio.wav", {
                type: "audio/wav",
            });

            // Use SDK method directly
            const result = await this.client.audio.transcriptions.create({
                file: audioFile,
                model: this.sttModel,
                language: options.language,
                prompt: options.prompt,
                response_format: options.responseFormat,
                temperature: options.temperature,
            });

            const processingTimeMs = Date.now() - startTime;

            const text = result.text;

            return {
                text,
                language: options.language,
                processingTimeMs,
                audioDurationMs: audioData.byteLength,
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

        if (!this.client) {
            throw new Error("Groq API key not configured");
        }

        try {
            // Use SDK method directly
            const result = await this.client.audio.speech.create({
                model: this.ttsModel,
                input: text,
                voice: options.voice || this.ttsVoice,
                speed: options.speed || 1.0,
                response_format: options.responseFormat || "wav",
            });

            // Extract audio data (result is a Response-like object)
            const audioData = await result.arrayBuffer();
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
