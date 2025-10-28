import type { ComputedRef, InjectionKey, Ref } from "vue";

export type Directive = {
    id?: string;
    token?: string;
    regex?: RegExp;
    stripFromOutput?: boolean;
    once?: boolean;
    onMatch: (ctx: {
        text: string;
        thinking?: string;
        peerId?: string;
        webrtc?: unknown;
        vircadiaWorld?: unknown;
    }) => void | Promise<void>;
};

export type KnowledgeEntries =
    | Record<string, string>
    | Map<string, string>
    | (() => Record<string, string> | Map<string, string>);

export type ConversationItem = {
    role: "user" | "assistant";
    text: string;
    thinking?: string;
    at: number;
    key: string;
};

export interface CloudInferenceAPI {
    capabilitiesEnabled: Readonly<
        Ref<{ stt: boolean; tts: boolean; llm: boolean }>
    >;
    ttsTalking: Readonly<Ref<boolean>>;
    ttsLevel: Readonly<Ref<number>>;
    conversationItems: Readonly<ComputedRef<ConversationItem[]>>;
    registerKnowledge: (
        sourceId: string,
        entries: KnowledgeEntries,
    ) => () => void;
    setCompanyName: (name: string) => void;
    registerDirective: (d: Directive) => () => void;
    onTranscript?: (
        f: (
            t: string,
            peerId?: string,
        ) => string | undefined | Promise<string | undefined>,
    ) => () => void;
    onAssistantText?: (
        f: (t: string) => string | undefined | Promise<string | undefined>,
    ) => () => void;
    speak: (text: string, opts?: { localEcho?: boolean }) => Promise<void>;
    cancelTts: () => void;
    submitToLlm: (peerId: string, text: string) => Promise<void>;
}

export const cloudInferenceKey: InjectionKey<CloudInferenceAPI> =
    Symbol("cloudInference");
