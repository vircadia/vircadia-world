<template>
    <slot :vircadiaWorld="vircadiaWorldNonNull" :connectionInfo="connectionInfo" :connectionStatus="connectionStatus"
        :isConnecting="isConnecting" :isAuthenticated="isAuthenticatedComputed"
        :isAuthenticating="isAuthenticatingComputed" :authError="authErrorComputed" :account="account"
        :accountDisplayName="accountDisplayName" :sessionToken="sessionToken" :connect="connect"
        :disconnect="disconnect" :logout="logout" />

</template>

<script setup lang="ts">
import {
    clientBrowserConfiguration,
    VircadiaBrowserClient,
    type VircadiaBrowserClientConfig,
    type WsConnectionCoreInfo,
} from "@vircadia/world-sdk/browser/vue";
import { computed, onUnmounted, type Ref, ref, shallowRef } from "vue";

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
    connect: (options?: { timeoutMs?: number }) => Promise<void>;
    disconnect: () => void;
    logout: () => Promise<void>;
};

defineSlots<{
    default(props: VircadiaWorldSlotProps): void;
}>();

const props = defineProps<{
    storageKey?: string;
}>();

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
    storageKey: props.storageKey ?? "client-web-babylon",
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

const authState = shallowRef(browserClient.getAuthState());
const sessionToken = ref<string | null>(browserClient.getStoredToken());
const account = ref<Record<string, unknown> | null>(
    browserClient.getStoredAccount<Record<string, unknown>>()
);

const handleAuthStateChange = () => {
    authState.value = browserClient.getAuthState();
    sessionToken.value = browserClient.getStoredToken();
    account.value = browserClient.getStoredAccount<Record<string, unknown>>();
};
const removeAuthListener = browserClient.addAuthChangeListener(handleAuthStateChange);

const updateConnectionStatus = () => {
    // Create a new object to ensure Vue detects the change with shallowRef
    connectionInfo.value = { ...browserClient.connection.getConnectionInfo() };
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
    removeAuthListener();

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

const isAuthenticatedComputed = computed(() => !!authState.value.hasToken);
const isAuthenticatingComputed = computed(
    () =>
        connectionInfo.value.sessionValidation?.status ===
        "validating" || false,
);

type ConnectionInfoMaybeLastClose = WsConnectionCoreInfo & {
    lastClose?: { code: number; reason: string };
};

const authErrorComputed = computed(
    () =>
        connectionInfo.value.sessionValidation?.error ??
        (connectionInfo.value as ConnectionInfoMaybeLastClose).lastClose?.reason ?? null,
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
    const value = account.value as MinimalAccount;
    if (!value) {
        const agentIdFromConnection = connectionInfo.value.agentId || authState.value.agentId || null;
        if (isAuthenticatedComputed.value && agentIdFromConnection) {
            return agentIdFromConnection;
        }
        if (isAuthenticatedComputed.value) {
            return "Authenticated";
        }
        return "Not signed in";
    }
    return (
        value.username ||
        value.name ||
        value?.idTokenClaims?.preferred_username ||
        value?.idTokenClaims?.name ||
        value.localAccountId ||
        "User"
    );
});

async function connect(options?: { timeoutMs?: number }) {
    await browserClient.connection.connect(options);
}

function disconnect() {
    browserClient.connection.disconnect();
}

async function logout() {
    try {
        await browserClient.logout();
    } catch {
        // ignore
    } finally {
        disconnect();
    }
}

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
</script>