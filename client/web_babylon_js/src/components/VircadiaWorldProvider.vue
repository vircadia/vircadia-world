<template>
    <slot :vircadiaWorld="vircadiaWorldNonNull" :connectionInfo="connectionInfo" :connectionStatus="connectionStatus"
        :isConnecting="isConnecting" :isAuthenticated="isAuthenticatedComputed"
        :isAuthenticating="isAuthenticatingComputed" :authError="authErrorComputed" :account="account"
        :accountDisplayName="accountDisplayName" :sessionToken="sessionToken" :connect="connect"
        :disconnect="disconnect" :logout="logout" />

</template>

<script setup lang="ts">
import {
    Communication,
    clientBrowserConfiguration,
    VircadiaBrowserClient,
    type VircadiaBrowserClientConfig,
    type WsConnectionCoreInfo,
} from "@vircadia/world-sdk/browser/vue";
import { StorageSerializers, useStorage } from "@vueuse/core";
import { computed, onUnmounted, type Ref, ref, shallowRef, watch } from "vue";

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

const vircadiaClientConfig: VircadiaBrowserClientConfig = {
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
    debug: false,
    suppress: clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_SUPPRESS,
};

// Initialize Vircadia client directly in the provider (replaces useVircadia)
console.log(
    "[VircadiaWorldProvider] Initializing Vircadia client with config",
    vircadiaClientConfig,
);

// New unified browser client for REST/Auth orchestration
const browserClient = new VircadiaBrowserClient(vircadiaClientConfig);

const connectionInfo = shallowRef<WsConnectionCoreInfo>(
    browserClient.connection.getConnectionInfo(),
);

const updateConnectionStatus = () => {
    // Create a new object to ensure Vue detects the change with shallowRef
    connectionInfo.value = { ...browserClient.connection.getConnectionInfo() };
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

// Connection state derives from core connection info
const isConnecting = computed(() => connectionInfo.value.isConnecting);
const connectionStatus = computed(() => connectionInfo.value.status);
const lastConnectedToken = ref<string | null>(null);
const lastConnectedAgentId = ref<string | null>(null);

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
// Deprecated: local provider storage is no longer the source of truth.

const isAuthenticatedComputed = computed(() => !!sessionToken.value);
const isAuthenticatingComputed = computed(
    () =>
        connectionInfo.value.sessionValidation?.status ===
        "validating" || false,
);
const authErrorComputed = computed(
    () =>
        connectionInfo.value.sessionValidation?.error ??
        (connectionInfo.value as ConnectionInfoMaybeLastClose).lastClose?.reason ?? null,
);

type ConnectionInfoMaybeLastClose = WsConnectionCoreInfo & {
    lastClose?: { code: number; reason: string };
};

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
    const value = account.value as MinimalAccount;
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
    const info = connectionInfo.value;
    if (info.isConnected || info.isConnecting) {
        browserClient.connection.disconnect();
    }
    lastConnectedToken.value = null;
    lastConnectedAgentId.value = null;
}

async function connect() {
    console.log("[VircadiaWorldProvider] connect() called", {
        isConnecting: isConnecting.value,
        currentToken: sessionToken.value,
        currentAgentId: connectionInfo.value.agentId,
        connectionInfo: connectionInfo.value,
        lastConnectedToken: lastConnectedToken.value,
        lastConnectedAgentId: lastConnectedAgentId.value,
    });

    if (isConnecting.value) {
        console.log("[VircadiaWorldProvider] Already connecting, skipping");
        return;
    }

    const currentToken = sessionToken.value;
    const currentAgentId = connectionInfo.value.agentId;

    if (!currentToken) {
        console.log("[VircadiaWorldProvider] No token, ensuring disconnected");
        ensureDisconnected();
        return;
    }

    // No-op if already connected with same token (agentId changes don't require reconnect)
    if (
        connectionInfo.value.isConnected &&
        lastConnectedToken.value === currentToken
    ) {
        console.log(
            "[VircadiaWorldProvider] Already connected with same token",
        );
        return;
    }

    console.log("[VircadiaWorldProvider] Starting connection attempt");
    try {
        // Disconnect only if connected with a different token
        if (connectionInfo.value.isConnected) {
            if (lastConnectedToken.value !== currentToken) {
                browserClient.connection.disconnect();
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
        } else if (connectionInfo.value.isConnecting) {
            console.log("[VircadiaWorldProvider] Already connecting, skipping");
            return;
        }

        // Update client configuration using current auth
        const authProvider = connectionInfo.value.authProvider ?? "anon";
        console.log("[VircadiaWorldProvider] Setting auth configuration", {
            token: currentToken,
            authProvider: authProvider,
        });
        // Keep browser client in sync for REST & WS flows
        browserClient.setAuthToken(currentToken);
        browserClient.setAuthProvider(authProvider);

        console.log("[VircadiaWorldProvider] Attempting WebSocket connection");

        // Attempt connection with timeout
        console.log(
            "[VircadiaWorldProvider] About to call browserClient.connection.connect()",
        );
        await browserClient.connection.connect({
            timeoutMs: 15000,
        });
        console.log("[VircadiaWorldProvider] WebSocket connection succeeded");

        lastConnectedToken.value = currentToken;
        lastConnectedAgentId.value = currentAgentId;
    } catch (error) {
        console.log(
            "[VircadiaWorldProvider] Connection failed with error:",
            error,
        );
        // Reset last connected state on failure
        lastConnectedToken.value = null;
        lastConnectedAgentId.value = null;

        if (error instanceof Error) {
            console.log(
                "[VircadiaWorldProvider] Error is instance of Error, message:",
                error.message,
            );
            if (
                error.message.includes("Authentication") ||
                error.message.includes("401") ||
                error.message.includes("Invalid token")
            ) {
                console.error(
                    "[VircadiaWorldProvider] Authentication failed:",
                    error,
                );
                // Determine a structured reason for cleanup
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

                // Handle auth cleanup and emit event for UI feedback
                handleAuthDenied(reason, msg);
            }
        }
    } finally {
        // no-op; isConnecting derives from core
    }
}

function disconnect() {
    ensureDisconnected();
}

async function logout() {
    try {
        await browserClient.logout();
    } catch { }
    // Clear mirrored local auth state so UI switches to auth screen
    account.value = null;
    sessionToken.value = null;
    // Also clear in-memory SDK auth so connectionInfo.hasAuthToken reflects reality
    browserClient.setAuthToken("");
    browserClient.setAuthProvider("anon");
    try {
        localStorage.setItem("vircadia-auth-suppressed", "1");
        localStorage.removeItem("vircadia-session-id");
        localStorage.removeItem("vircadia-agent-id");
        localStorage.setItem("vircadia-auth-provider", "anon");
    } catch { }
    ensureDisconnected();
}

async function handleAuthDenied(
    reason: "expired" | "invalid" | "unauthorized" | "authentication_failed",
    message: string,
) {
    console.warn(
        "[VircadiaWorldProvider] Auth denied, clearing local auth state",
        { reason, message },
    );

    // Clear local auth state - this will automatically trigger UI to show auth provider
    account.value = null;
    sessionToken.value = null;
    // Clear in-memory SDK auth so connectionInfo no longer reports hasAuthToken
    browserClient.setAuthToken("");
    browserClient.setAuthProvider("anon");

    // Clear localStorage to ensure clean state
    try {
        localStorage.setItem("vircadia-auth-suppressed", "1");
        localStorage.removeItem("vircadia-session-id");
        localStorage.removeItem("vircadia-agent-id");
        localStorage.setItem("vircadia-auth-provider", "anon");
    } catch (error) {
        console.warn(
            "[VircadiaWorldProvider] Failed to clear localStorage:",
            error,
        );
    }

    // Disconnect if connected
    ensureDisconnected();

    // Emit event for UI feedback (notifications, etc.)
    emit("auth-denied", { reason, message });
}

function handleAuthChange() {
    console.log("[VircadiaWorldProvider] handleAuthChange called", {
        autoConnect: autoConnect.value,
        isAuthenticated: isAuthenticatedComputed.value,
        sessionToken: sessionToken.value,
        agentId: connectionInfo.value.agentId,
        connectionStatus: connectionStatus.value,
    });

    if (!autoConnect.value) {
        console.log("[VircadiaWorldProvider] Auto-connect disabled, skipping");
        return;
    }

    if (isAuthenticatedComputed.value) {
        const currentToken = sessionToken.value;
        // Skip if we are already connected with the same token
        if (
            connectionInfo.value.isConnected &&
            lastConnectedToken.value === currentToken
        ) {
            console.log(
                "[VircadiaWorldProvider] Already connected with current token, skipping connect",
            );
            return;
        }
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

// React only to session token changes (simpler and avoids duplicate triggers)
watch(
    () => sessionToken.value,
    (newToken, oldToken) => {
        // Skip if auto-connect disabled
        if (!autoConnect.value) return;
        // If token didn't change and we're already connected, do nothing
        if (newToken === oldToken && connectionInfo.value.isConnected) {
            return;
        }
        handleAuthChange();
    },
    { immediate: true },
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
            !connectionInfo.value.isConnecting
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
    connectionInfo,
    connectionStatus,
    isConnecting,
    isAuthenticated: isAuthenticatedComputed,
    isAuthenticating: isAuthenticatingComputed,
    authError: authErrorComputed,
    account,
    accountDisplayName,
    sessionToken,
});

//
</script>