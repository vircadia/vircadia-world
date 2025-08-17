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
        :agentId="agentIdComputed"
        :authProvider="authProviderComputed"
        :instanceId="instanceId"
        :connect="connect"
        :disconnect="disconnect"
    />
    
</template>

<script setup lang="ts">
import { computed, watch, ref, onUnmounted, onMounted, type Ref } from "vue";
import {
    Communication,
    ClientCore,
    type ClientCoreConnectionInfo,
} from "@vircadia/world-sdk/browser/vue";
import { clientBrowserConfiguration } from "@/vircadia.browser.config";

// Strongly type the slot props so consumers don't get `any`
type VircadiaWorldInstance = {
    client: ClientCore;
    connectionInfo: Ref<ClientCoreConnectionInfo>;
    dispose: () => void;
};
type VircadiaConnectionInfo = VircadiaWorldInstance["connectionInfo"]["value"];
type VircadiaConnectionStatus = VircadiaConnectionInfo["status"];

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
    agentId: string | null;
    authProvider: string | null;
    instanceId: string | null;
    connect: () => Promise<void>;
    disconnect: () => void;
};

defineSlots<{
    default(props: VircadiaWorldSlotProps): void;
}>();

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

// Initialize Vircadia client directly in the provider (replaces useVircadia)
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

const client = new ClientCore({
    serverUrl:
        clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_URI_USING_SSL
            ? `https://${clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_URI}${Communication.WS_UPGRADE_PATH}`
            : `http://${clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_URI}${Communication.WS_UPGRADE_PATH}`,
    authToken:
        clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN,
    authProvider:
        clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN_PROVIDER,
    debug: clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG,
    suppress: clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_SUPPRESS,
});

const connectionInfo = ref<ClientCoreConnectionInfo>(
    client.Utilities.Connection.getConnectionInfo(),
);

const updateConnectionStatus = () => {
    connectionInfo.value = client.Utilities.Connection.getConnectionInfo();
};

client.Utilities.Connection.addEventListener(
    "statusChange",
    updateConnectionStatus,
);

const dispose = () => {
    client.Utilities.Connection.removeEventListener(
        "statusChange",
        updateConnectionStatus,
    );

    if (connectionInfo.value.isConnected) {
        client.Utilities.Connection.disconnect();
    }

    client.dispose();
};

onUnmounted(dispose);

const vircadiaWorldNonNull: VircadiaWorldInstance = {
    client,
    connectionInfo,
    dispose,
};

// Connection state
const isConnecting = ref(false);
const lastConnectedToken = ref<string | null>(null);
const lastConnectedAgentId = ref<string | null>(null);

const instanceId = ref<string | null>(null);

function generateInstanceId(): string {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

onMounted(() => {
    if (!instanceId.value) {
        instanceId.value = generateInstanceId();
        console.log(
            "[VircadiaWorldProvider] Generated instance ID:",
            instanceId.value,
        );
    }
});

// Derived state
const connectionInfoComputed = computed(
    () => vircadiaWorldNonNull.connectionInfo.value,
);
const connectionStatus = computed(() => connectionInfoComputed.value.status);

// Auth state is provided via props
const isAuthenticatedComputed = computed(() => !!props.isAuthenticated);
const isAuthenticatingComputed = computed(() => !!props.isAuthenticating);
const authErrorComputed = computed(() => props.authError ?? null);
const accountComputed = computed(() => props.account ?? null);
const sessionTokenComputed = computed(() => props.sessionToken ?? null);
// session and agent IDs from connection info
const sessionIdComputed = computed(
    () => connectionInfoComputed.value.sessionId ?? null,
);
const agentIdComputed = computed(
    () => connectionInfoComputed.value.agentId ?? null,
);
const authProviderComputed = computed(() => props.authProvider ?? "anon");

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

// No app store syncing

function ensureDisconnected() {
    const info = connectionInfoComputed.value;
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

    // No-op if already connected with same credentials
    if (
        connectionInfoComputed.value.isConnected &&
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
            connectionInfoComputed.value.isConnected ||
            connectionInfoComputed.value.isConnecting
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
                console.error(
                    "[VircadiaWorldProvider] Authentication failed:",
                    error,
                );
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
    agentId: agentIdComputed,
    authProvider: authProviderComputed,
    instanceId,
});
</script>


