<template>
    <slot :vircadiaWorld="vircadiaWorldNonNull" :connectionInfo="connectionInfo" :connectionStatus="connectionStatus"
        :isConnecting="isConnecting" />

</template>

<script setup lang="ts">
import {
    clientBrowserConfiguration,
    VircadiaBrowserClient,
    type VircadiaBrowserClientConfig,
    type WsConnectionCoreInfo,
} from "@vircadia/world-sdk/browser/vue";
import { computed, onUnmounted, type Ref, shallowRef } from "vue";

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
    apiRestInferenceUri:
        clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_REST_INFERENCE_URI_USING_SSL
            ? `https://${clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_REST_INFERENCE_URI}`
            : `http://${clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_REST_INFERENCE_URI}`,
    authToken: "",
    authProvider: "anon",
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

defineExpose({
    vircadiaWorld: vircadiaWorldNonNull,
    connectionInfo,
    connectionStatus,
    isConnecting,
});
</script>