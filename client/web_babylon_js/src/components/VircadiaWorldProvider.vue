<template>
    <slot 
        :vircadiaWorld="vircadiaWorldNonNull"
        :connectionInfo="connectionInfoComputed"
        :connectionStatus="connectionStatus"
        :isConnecting="isConnecting"
        :isAuthenticated="isAuthenticatedComputed"
        :isAuthenticating="isAuthenticatingComputed"
        :authError="authErrorComputed"
        :account="accountComputed"
        :accountDisplayName="accountDisplayName"
        :sessionToken="sessionTokenComputed"
        :sessionId="sessionIdComputed"
        :fullSessionId="fullSessionIdComputed"
        :agentId="agentIdComputed"
        :authProvider="authProviderComputed"
        :instanceId="instanceId"
        :lastCloseCode="lastCloseCode"
        :lastCloseReason="lastCloseReason"
        :connect="connect"
        :disconnect="disconnect"
        :logout="logout"
    />
    
</template>

<script setup lang="ts">
import { computed, watch, ref, onUnmounted, readonly, type Ref, type ComputedRef, type DeepReadonly } from "vue";
import { useStorage, StorageSerializers } from "@vueuse/core";
import {
    Communication,
    VircadiaBrowserClient,
    type WsConnectionCoreInfo,
} from "@vircadia/world-sdk/browser/vue";
import { clientBrowserConfiguration } from "../../../../sdk/vircadia-world-sdk-ts/browser/src/config/vircadia.browser.config";

// Strongly type the slot props so consumers don't get `any`
export type VircadiaWorldInstance = {
    client: VircadiaBrowserClient;
    connectionInfo: Ref<WsConnectionCoreInfo>;
    dispose: () => void;
};
export type VircadiaConnectionInfo =
    VircadiaWorldInstance["connectionInfo"]["value"];
export type VircadiaConnectionStatus = VircadiaConnectionInfo["status"];

export type VircadiaWorldSlotProps = {
    vircadiaWorld: VircadiaWorldInstance;
    connectionInfo: VircadiaConnectionInfo;
    connectionStatus: VircadiaConnectionStatus;
    isConnecting: boolean;
    isAuthenticated: boolean;
    isAuthenticating: boolean;
    authError: string | null;
    account: unknown | null;
    accountDisplayName: string;
    sessionToken: string | null;
    sessionId: string | null;
    fullSessionId: string | null;
    agentId: string | null;
    authProvider: string | null;
    instanceId: string | null;
    lastCloseCode: number | null;
    lastCloseReason: string | null;
    connect: () => Promise<void>;
    disconnect: () => void;
    logout: () => Promise<void>;
};

defineSlots<{
    default(props: VircadiaWorldSlotProps): void;
}>();

const emit = defineEmits<{
    /** Emitted when authentication is denied/expired and local logout should occur */
    "auth-denied": [
        payload: {
            reason:
                | "expired"
                | "invalid"
                | "unauthorized"
                | "authentication_failed";
            message: string;
        },
    ];
}>();

const props = defineProps<{
    autoConnect?: boolean;
    reconnectDelayMs?: number;
}>();

const autoConnect = computed(() => props.autoConnect !== false);
const reconnectDelayMs = computed(() => props.reconnectDelayMs ?? 2000);

// Initialize Vircadia client directly in the provider (replaces useVircadia)
console.log(
    "[VircadiaWorldProvider] Initializing Vircadia client with config",
    {
        apiWsUriUsingSsl: clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_WS_URI_USING_SSL,
        apiWsUri: clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_WS_URI,
        apiRestAuthUriUsingSsl: clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_REST_AUTH_URI_USING_SSL,
        apiRestAuthUri: clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_REST_AUTH_URI,
        apiRestAssetUriUsingSsl: clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_REST_ASSET_URI_USING_SSL,
        apiRestAssetUri: clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_REST_ASSET_URI,
        wsPath: Communication.REST_BASE_WS_PATH,
        hasDebugToken:
            !!clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN,
        debugProvider:
            clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN_PROVIDER,
        debug: false,
    },
);

// New unified browser client for REST/Auth orchestration
const browserClient = new VircadiaBrowserClient({
    apiWsUri:
        clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_WS_URI_USING_SSL
            ? `https://${clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_WS_URI}`
            : `http://${clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_WS_URI}`,
    apiRestAuthUri:
        clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_REST_AUTH_URI_USING_SSL
            ? `https://${clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_REST_AUTH_URI}`
            : `http://${clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_REST_AUTH_URI}`,
    apiRestAssetUri:
        clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_REST_ASSET_URI_USING_SSL
            ? `https://${clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_REST_ASSET_URI}`
            : `http://${clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_REST_ASSET_URI}`,
    authToken:
        clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN,
    authProvider:
        clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN_PROVIDER,
    debug: true,
    suppress: clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_SUPPRESS,
});

const connectionInfo = ref<WsConnectionCoreInfo>(
    browserClient.connection.getConnectionInfo(),
);

const updateConnectionStatus = () => {
    connectionInfo.value = browserClient.connection.getConnectionInfo();
    // Surface specific close reasons (session already connected) without treating as auth failure
    const last = connectionInfo.value;
    if (
        last.status === "disconnected" &&
        last.sessionValidation?.status !== "invalid"
    ) {
        // No-op: validation states are handled via REST; WS close reasons are logged in ClientCore
        // Here we could emit a non-auth notification if needed
    }
};

browserClient.connection.addEventListener(
    "statusChange",
    updateConnectionStatus,
);

const dispose = () => {
    browserClient.connection.removeEventListener(
        "statusChange",
        updateConnectionStatus,
    );

    if (connectionInfo.value.isConnected) {
        browserClient.connection.disconnect();
    }
};

onUnmounted(dispose);

const vircadiaWorldNonNull = {
    client: browserClient,
    connectionInfo,
    dispose,
} as unknown as VircadiaWorldInstance;

// Connection state
const isConnecting = ref(false);
const lastConnectedToken = ref<string | null>(null);
const lastConnectedAgentId = ref<string | null>(null);

// Derived state
const connectionInfoComputed = computed(
    () => vircadiaWorldNonNull.connectionInfo.value,
);
const connectionStatus = computed(() => connectionInfoComputed.value.status);

// Auth state is mirrored from shared storage so AuthProvider and World share state
const account = useStorage<Record<string, unknown> | null>(
    "vircadia-account",
    null,
    localStorage,
    { serializer: StorageSerializers.object },
);
const sessionToken = useStorage<string | null>(
    "vircadia-session-token",
    null,
    localStorage,
);
const storedAuthProvider = useStorage<string>(
    "vircadia-auth-provider",
    "anon",
    localStorage,
);

const isAuthenticatedComputed = computed(
    () => !!sessionToken.value && !!account.value,
);
const isAuthenticatingComputed = computed(() => false);
const authErrorComputed = computed(() => null as string | null);
const accountComputed = computed(() => account.value);
const sessionTokenComputed = computed(() => sessionToken.value);
// session and agent IDs from connection info
const sessionIdComputed = computed(
    () => connectionInfoComputed.value.sessionId ?? null,
);
const agentIdComputed = computed(
    () => connectionInfoComputed.value.agentId ?? null,
);
const authProviderComputed = computed(() => storedAuthProvider.value ?? "anon");

// Pull instanceId and fullSessionId directly from core connection info
const instanceId = computed(
    () => connectionInfoComputed.value.instanceId ?? null,
);
const fullSessionIdComputed = computed(
    () => connectionInfoComputed.value.fullSessionId ?? null,
);

type ConnectionInfoMaybeLastClose = WsConnectionCoreInfo & {
    lastClose?: { code: number; reason: string };
};

const lastCloseCode = computed(
    () =>
        (
            connectionInfoComputed.value as ConnectionInfoMaybeLastClose
        ).lastClose?.code ?? null,
);
const lastCloseReason = computed(
    () =>
        (
            connectionInfoComputed.value as ConnectionInfoMaybeLastClose
        ).lastClose?.reason ?? null,
);

type MinimalAccount =
    | {
          username?: string;
          name?: string;
          localAccountId?: string;
          idTokenClaims?: { preferred_username?: string; name?: string };
      }
    | null
    | undefined;

const accountDisplayName = computed(() => {
    const value = accountComputed.value as MinimalAccount;
    if (!value) return "Not signed in";
    return (
        value.username ||
        value.name ||
        value?.idTokenClaims?.preferred_username ||
        value?.idTokenClaims?.name ||
        value.localAccountId ||
        "User"
    );
});

function ensureDisconnected() {
    const info = connectionInfoComputed.value;
    if (info.isConnected || info.isConnecting) {
        browserClient.connection.disconnect();
    }
    lastConnectedToken.value = null;
    lastConnectedAgentId.value = null;
}

async function connect() {
    console.log("[VircadiaWorldProvider] connect() called", {
        isConnecting: isConnecting.value,
        currentToken: sessionTokenComputed.value,
        currentAgentId: agentIdComputed.value,
        connectionInfo: connectionInfoComputed.value,
        lastConnectedToken: lastConnectedToken.value,
        lastConnectedAgentId: lastConnectedAgentId.value,
    });

    if (isConnecting.value) {
        console.log("[VircadiaWorldProvider] Already connecting, skipping");
        return;
    }

    const currentToken = sessionTokenComputed.value;
    const currentAgentId = agentIdComputed.value;

    if (!currentToken) {
        console.log("[VircadiaWorldProvider] No token, ensuring disconnected");
        ensureDisconnected();
        return;
    }

    // No-op if already connected with same token (agentId changes don't require reconnect)
    if (
        connectionInfoComputed.value.isConnected &&
        lastConnectedToken.value === currentToken
    ) {
        console.log(
            "[VircadiaWorldProvider] Already connected with same token",
        );
        return;
    }

    console.log("[VircadiaWorldProvider] Starting connection attempt");
    isConnecting.value = true;
    try {
        // Disconnect only if connected with a different token
        if (connectionInfoComputed.value.isConnected) {
            if (lastConnectedToken.value !== currentToken) {
                browserClient.connection.disconnect();
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
        } else if (connectionInfoComputed.value.isConnecting) {
            console.log("[VircadiaWorldProvider] Already connecting, skipping");
            return;
        }

        // Update client configuration using current auth
        const authProvider = authProviderComputed.value;
        console.log("[VircadiaWorldProvider] Setting auth configuration", {
            token: currentToken,
            authProvider: authProvider,
        });
        // Keep browser client in sync for REST & WS flows
        browserClient.setAuthToken(currentToken);
        browserClient.setAuthProvider(authProvider);

        console.log("[VircadiaWorldProvider] Attempting WebSocket connection");

        // Attempt connection with timeout
        console.log("[VircadiaWorldProvider] About to call browserClient.connection.connect()");
        await browserClient.connection.connect({
            timeoutMs: 15000,
        });
        console.log("[VircadiaWorldProvider] WebSocket connection succeeded");

        lastConnectedToken.value = currentToken;
        lastConnectedAgentId.value = currentAgentId;
    } catch (error) {
        console.log("[VircadiaWorldProvider] Connection failed with error:", error);
        // Reset last connected state on failure
        lastConnectedToken.value = null;
        lastConnectedAgentId.value = null;

        if (error instanceof Error) {
            console.log("[VircadiaWorldProvider] Error is instance of Error, message:", error.message);
            if (
                error.message.includes("Authentication") ||
                error.message.includes("401") ||
                error.message.includes("Invalid token")
            ) {
                console.error(
                    "[VircadiaWorldProvider] Authentication failed:",
                    error,
                );
                // Ensure any in-flight connection is closed
                ensureDisconnected();
                // Determine a structured reason and notify parent to clear local auth
                let reason:
                    | "expired"
                    | "invalid"
                    | "unauthorized"
                    | "authentication_failed" = "authentication_failed";
                const msg = error.message || "Authentication failed";
                if (msg.includes("expired")) reason = "expired";
                else if (msg.includes("Invalid session")) reason = "invalid";
                else if (msg.includes("401") || msg.includes("Unauthorized"))
                    reason = "unauthorized";
                emit("auth-denied", { reason, message: msg });
            }
        }
    } finally {
        isConnecting.value = false;
    }
}

function disconnect() {
    ensureDisconnected();
}

async function logout() {
    try {
        await browserClient.logout();
    } catch {}
    // Clear mirrored local auth state so UI switches to auth screen
    account.value = null;
    sessionToken.value = null;
    try {
        localStorage.setItem("vircadia-auth-suppressed", "1");
        localStorage.removeItem("vircadia-session-id");
        localStorage.removeItem("vircadia-agent-id");
        localStorage.setItem("vircadia-auth-provider", "anon");
    } catch {}
    ensureDisconnected();
}

function handleAuthChange() {
    console.log("[VircadiaWorldProvider] handleAuthChange called", {
        autoConnect: autoConnect.value,
        isAuthenticated: isAuthenticatedComputed.value,
        sessionToken: sessionTokenComputed.value,
        agentId: agentIdComputed.value,
        connectionStatus: connectionStatus.value,
    });

    if (!autoConnect.value) {
        console.log("[VircadiaWorldProvider] Auto-connect disabled, skipping");
        return;
    }

    if (isAuthenticatedComputed.value) {
        console.log(
            "[VircadiaWorldProvider] User authenticated, initiating connection",
        );
        connect();
    } else {
        console.log(
            "[VircadiaWorldProvider] User not authenticated, ensuring disconnected",
        );
        ensureDisconnected();
    }
}

// React to authentication changes
watch(
    () => ({
        isAuthenticated: isAuthenticatedComputed.value,
        sessionToken: sessionTokenComputed.value,
        agentId: agentIdComputed.value,
        account: accountComputed.value,
    }),
    // Debounce auth change handling to avoid connect/disconnect races
    (() => {
        const authChangeDebounceMs = 150;
        let authChangeTimer: number | null = null;
        return () => {
            if (authChangeTimer) {
                clearTimeout(authChangeTimer);
            }
            authChangeTimer = window.setTimeout(() => {
                handleAuthChange();
                authChangeTimer = null;
            }, authChangeDebounceMs);
        };
    })(),
    { immediate: true, deep: true },
);

// Reconnect on unexpected disconnect when authenticated
watch(
    () => connectionStatus.value,
    (newStatus, oldStatus) => {
        if (
            autoConnect.value &&
            newStatus === "disconnected" &&
            oldStatus === "connected" &&
            isAuthenticatedComputed.value &&
            !isConnecting.value
        ) {
            setTimeout(() => {
                connect();
            }, reconnectDelayMs.value);
        }
    },
);

defineExpose({
    connect,
    disconnect,
    logout,
    vircadiaWorld: vircadiaWorldNonNull,
    connectionInfo: connectionInfoComputed,
    connectionStatus,
    isConnecting,
    isAuthenticated: isAuthenticatedComputed,
    isAuthenticating: isAuthenticatingComputed,
    authError: authErrorComputed,
    account: accountComputed,
    accountDisplayName,
    sessionToken: sessionTokenComputed,
    sessionId: sessionIdComputed,
    fullSessionId: fullSessionIdComputed,
    agentId: agentIdComputed,
    authProvider: authProviderComputed,
    instanceId,
});

//
</script>