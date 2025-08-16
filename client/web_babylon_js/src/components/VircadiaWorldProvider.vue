<template>
    <slot 
        :vircadiaWorld="vircadiaWorldNonNull"
        :connectionInfo="connectionInfo"
        :connectionStatus="connectionStatus"
        :isConnecting="isConnecting"
        :isAuthenticated="isAuthenticatedComputed"
        :isAuthenticating="isAuthenticatingComputed"
        :authError="authErrorComputed"
        :account="accountComputed"
        :accountDisplayName="accountDisplayName"
        :sessionToken="sessionTokenComputed"
        :sessionId="sessionIdComputed"
        :agentId="agentIdComputed"
        :authProvider="authProviderComputed"
        :connect="connect"
        :disconnect="disconnect"
    />
    
</template>

<script setup lang="ts">
import { computed, watch, ref } from "vue";
import { useAppStore } from "@/stores/appStore";
import { useVircadia, Communication } from "@vircadia/world-sdk/browser/vue";
import { clientBrowserConfiguration } from "@/vircadia.browser.config";

const props = defineProps<{
    autoConnect?: boolean;
    reconnectDelayMs?: number;
    // Optional external auth state. If provided, these take precedence over store values
    sessionToken?: string | null;
    agentId?: string | null;
    authProvider?: string | null;
    isAuthenticated?: boolean;
    account?: unknown | null;
    isAuthenticating?: boolean;
    authError?: string | null;
}>();

const autoConnect = computed(() => props.autoConnect !== false);
const reconnectDelayMs = computed(() => props.reconnectDelayMs ?? 2000);

// Initialize Vircadia instance directly in the provider
console.log(
    "[VircadiaWorldProvider] Initializing Vircadia client with config",
    {
        ssl: clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_URI_USING_SSL,
        apiUri: clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_URI,
        wsPath: Communication.WS_UPGRADE_PATH,
        hasDebugToken:
            !!clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN,
        debugProvider:
            clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN_PROVIDER,
        debug: clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG,
    },
);

const vircadiaWorldNonNull = useVircadia({
    config: {
        serverUrl:
            clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_URI_USING_SSL
                ? `https://${clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_URI}${Communication.WS_UPGRADE_PATH}`
                : `http://${clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_URI}${Communication.WS_UPGRADE_PATH}`,
        authToken:
            clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN,
        authProvider:
            clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN_PROVIDER,
        debug: clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG,
        suppress:
            clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_SUPPRESS,
    },
});

// App store for auth/session
const appStore = useAppStore();

// Connection state
const isConnecting = ref(false);
const lastConnectedToken = ref<string | null>(null);
const lastConnectedAgentId = ref<string | null>(null);

// Derived state
const connectionInfo = computed(
    () => vircadiaWorldNonNull.connectionInfo.value,
);
const connectionStatus = computed(() => connectionInfo.value.status);

// Auth state (can be provided via props, otherwise falls back to store)
const isAuthenticatedComputed = computed(
    () => props.isAuthenticated ?? appStore.isAuthenticated,
);
const isAuthenticatingComputed = computed(
    () => props.isAuthenticating ?? appStore.isAuthenticating,
);
const authErrorComputed = computed(() => props.authError ?? appStore.authError);
const accountComputed = computed(() => props.account ?? appStore.account);
const sessionTokenComputed = computed(
    () => props.sessionToken ?? appStore.sessionToken,
);
const sessionIdComputed = computed(() => appStore.sessionId);
const agentIdComputed = computed(() => props.agentId ?? appStore.agentId);
const authProviderComputed = computed(
    () => props.authProvider ?? appStore.getCurrentAuthProvider,
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

// Keep session and agent IDs synced back to the store
watch(
    () => connectionInfo.value.sessionId,
    (newSessionId) => appStore.setSessionId(newSessionId ?? null),
);
watch(
    () => connectionInfo.value.agentId,
    (newAgentId) => appStore.setAgentId(newAgentId ?? null),
);

function ensureDisconnected() {
    const info = connectionInfo.value;
    if (info.isConnected || info.isConnecting) {
        vircadiaWorldNonNull.client.Utilities.Connection.disconnect();
    }
    lastConnectedToken.value = null;
    lastConnectedAgentId.value = null;
}

async function connect() {
    console.log("[VircadiaWorldProvider] connect() called", {
        isConnecting: isConnecting.value,
        currentToken: sessionTokenComputed.value,
        currentAgentId: agentIdComputed.value,
        connectionInfo: connectionInfo.value,
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

    // No-op if already connected with same credentials
    if (
        connectionInfo.value.isConnected &&
        lastConnectedToken.value === currentToken &&
        lastConnectedAgentId.value === currentAgentId
    ) {
        console.log(
            "[VircadiaWorldProvider] Already connected with same credentials",
        );
        return;
    }

    console.log("[VircadiaWorldProvider] Starting connection attempt");
    isConnecting.value = true;
    try {
        // Always disconnect first for a clean state
        if (
            connectionInfo.value.isConnected ||
            connectionInfo.value.isConnecting
        ) {
            vircadiaWorldNonNull.client.Utilities.Connection.disconnect();
            await new Promise((resolve) => setTimeout(resolve, 100));
        }

        // Update client configuration using current auth
        const authProvider = authProviderComputed.value;
        console.log("[VircadiaWorldProvider] Setting auth configuration", {
            token: currentToken,
            authProvider: authProvider,
        });
        vircadiaWorldNonNull.client.setAuthToken(currentToken);
        vircadiaWorldNonNull.client.setAuthProvider(authProvider);

        console.log("[VircadiaWorldProvider] Attempting WebSocket connection");
        // Attempt connection with timeout
        await vircadiaWorldNonNull.client.Utilities.Connection.connect({
            timeoutMs: 15000,
        });

        lastConnectedToken.value = currentToken;
        lastConnectedAgentId.value = currentAgentId;
    } catch (error) {
        // Reset last connected state on failure
        lastConnectedToken.value = null;
        lastConnectedAgentId.value = null;

        if (error instanceof Error) {
            if (
                error.message.includes("Authentication") ||
                error.message.includes("401") ||
                error.message.includes("Invalid token")
            ) {
                appStore.setError(
                    "Authentication failed. Please try logging in again.",
                );
                // Clear authentication state to trigger IntroScreen
                appStore.account = null;
                appStore.sessionToken = null;
                appStore.sessionId = null;
                appStore.agentId = null;
                appStore.authProvider = "anon";
                appStore.authError = null;
            }
        }
    } finally {
        isConnecting.value = false;
    }
}

function disconnect() {
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
    handleAuthChange,
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
    vircadiaWorld: vircadiaWorldNonNull,
    connectionInfo,
    connectionStatus,
    isConnecting,
    isAuthenticated: isAuthenticatedComputed,
    isAuthenticating: isAuthenticatingComputed,
    authError: authErrorComputed,
    account: accountComputed,
    accountDisplayName,
    sessionToken: sessionTokenComputed,
    sessionId: sessionIdComputed,
    agentId: agentIdComputed,
    authProvider: authProviderComputed,
});
</script>


