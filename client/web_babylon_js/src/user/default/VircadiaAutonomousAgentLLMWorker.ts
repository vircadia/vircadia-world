/*
  LLM Worker: runs Transformers.js text-generation off main thread (WebGPU)
*/

import { pipeline, TextStreamer } from "@huggingface/transformers";

type LoadMessage = { type: "load"; modelId?: string };
type GenerateMessage = {
    type: "generate";
    prompt: string;
    options?: Record<string, unknown>;
};
type WorkerMessage = LoadMessage | GenerateMessage;

type WorkerEvent =
    | ({
          type: "status";
          status:
              | "downloading"
              | "mounting"
              | "loading"
              | "ready"
              | "generating";
      } & {
          data?: unknown;
      })
    | { type: "token"; text: string }
    | { type: "complete"; text: string }
    | { type: "error"; error: string };

let llm: any | null = null;
let llmModelIdRef: string = "onnx-community/granite-4.0-micro-ONNX-web";

function post(event: WorkerEvent) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (self as any).postMessage(event);
}

async function ensureLoaded() {
    if (llm) return;
    post({ type: "status", status: "downloading" });
    llm = await pipeline(
        "text-generation",
        llmModelIdRef || "onnx-community/granite-4.0-micro-ONNX-web",
        {
            device: "webgpu",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            progress_callback: (x: any) =>
                post({ type: "status", status: "loading", data: x }),
        },
    );
    // Mount kernels by warming up
    post({ type: "status", status: "mounting" });
    try {
        await llm("Hello", { max_new_tokens: 1 });
    } catch {
        /* ignore */
    }
    post({ type: "status", status: "ready" });
}

async function handleGenerate(
    prompt: string,
    options?: Record<string, unknown>,
) {
    await ensureLoaded();
    post({ type: "status", status: "generating" });
    try {
        // Optional token streaming support via TextStreamer when available
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const maybeCall: any = llm;
        let text = "";
        try {
            const streamer = new TextStreamer(undefined as unknown as any, {
                // tokenizer is optional for string accumulation; we only forward raw text
                callback_function: (t: string) => {
                    text += t;
                    post({ type: "token", text: t });
                },
            });
            // Some backends accept streamer; if it throws, fall back to non-streaming
            const out =
                typeof maybeCall === "function"
                    ? await maybeCall(prompt, { streamer, ...(options || {}) })
                    : await (maybeCall?.__call__
                          ? maybeCall.__call__(prompt, {
                                streamer,
                                ...(options || {}),
                            })
                          : maybeCall?.generate?.({
                                inputs: prompt,
                                streamer,
                                ...(options || {}),
                            }));
            if (!text) {
                text =
                    (Array.isArray(out)
                        ? out[0]?.generated_text
                        : out?.generated_text) || "";
            }
        } catch {
            const out =
                typeof maybeCall === "function"
                    ? await maybeCall(prompt, options || {})
                    : await (maybeCall?.__call__
                          ? maybeCall.__call__(prompt, options || {})
                          : maybeCall?.generate?.({
                                inputs: prompt,
                                ...(options || {}),
                            }));
            text =
                (Array.isArray(out)
                    ? out[0]?.generated_text
                    : out?.generated_text) || "";
        }
        post({ type: "complete", text });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        post({ type: "error", error: msg });
    }
}

async function handleMessage(e: MessageEvent<WorkerMessage>) {
    const msg = e.data;
    if (msg.type === "load") {
        if (typeof msg.modelId === "string" && msg.modelId)
            llmModelIdRef = msg.modelId;
        await ensureLoaded();
        return;
    }
    if (msg.type === "generate") {
        await handleGenerate(msg.prompt, msg.options);
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(self as any).addEventListener("message", handleMessage);
