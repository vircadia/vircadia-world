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
import { inject, computed, watch, ref } from "vue";
import { useAppStore } from "@/stores/appStore";
import { useVircadiaInstance } from "@vircadia/world-sdk/browser/vue";

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

// Access Vircadia instance from global provider
const vircadiaWorldInjected = inject(useVircadiaInstance());
if (!vircadiaWorldInjected) {
    throw new Error("Vircadia instance not found in VircadiaWorldProvider");
}
const vircadiaWorldNonNull = vircadiaWorldInjected;

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
    if (isConnecting.value) return;

    const currentToken = sessionTokenComputed.value;
    const currentAgentId = agentIdComputed.value;

    if (!currentToken) {
        ensureDisconnected();
        return;
    }

    // No-op if already connected with same credentials
    if (
        connectionInfo.value.isConnected &&
        lastConnectedToken.value === currentToken &&
        lastConnectedAgentId.value === currentAgentId
    ) {
        return;
    }

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
        vircadiaWorldNonNull.client.setAuthToken(currentToken);
        vircadiaWorldNonNull.client.setAuthProvider(authProvider);

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
    if (!autoConnect.value) return;
    if (isAuthenticatedComputed.value) {
        connect();
    } else {
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


