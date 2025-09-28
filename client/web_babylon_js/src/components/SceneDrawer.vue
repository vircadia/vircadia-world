<template>
    <v-navigation-drawer
        v-model="openModel"
        location="right"
        :width="width"
        :temporary="$vuetify.display.smAndDown"
        elevation="8"
    >
        <v-tabs v-model="tabModel" density="compact" grow>
            <v-tab value="connection" prepend-icon="mdi-wifi">Connection</v-tab>
            <v-tab value="environment" prepend-icon="mdi-earth">Environment</v-tab>
            <v-tab value="physics" prepend-icon="mdi-atom-variant">Physics</v-tab>
        </v-tabs>
        <v-divider />
        <v-window v-model="tabModel">
            <v-window-item value="connection">
                <v-list density="compact" class="px-2">
                    <v-list-item>
                        <v-list-item-title>Status</v-list-item-title>
                        <template #append>
                            <v-chip :color="connectionStatusColor" size="small" variant="flat">
                                {{ connectionStatus }}
                            </v-chip>
                        </template>
                    </v-list-item>
                    <v-list-item>
                        <v-list-item-title>Connecting</v-list-item-title>
                        <template #append>
                            <v-chip :color="isConnecting ? 'warning' : 'default'" size="small" variant="flat">
                                {{ String(isConnecting) }}
                            </v-chip>
                        </template>
                    </v-list-item>
                    <v-list-subheader>Auth</v-list-subheader>
                    <v-list-item>
                        <v-list-item-title>Authenticated</v-list-item-title>
                        <template #append>
                            <v-chip :color="isAuthenticated ? 'success' : 'error'" size="small" variant="flat">
                                {{ String(isAuthenticated) }}
                            </v-chip>
                        </template>
                    </v-list-item>
                    <v-list-item>
                        <v-list-item-title>Authenticating</v-list-item-title>
                        <template #append>
                            <v-chip :color="isAuthenticating ? 'warning' : 'default'" size="small" variant="flat">
                                {{ String(isAuthenticating) }}
                            </v-chip>
                        </template>
                    </v-list-item>
                    <v-list-item>
                        <v-list-item-title>Account</v-list-item-title>
                        <v-list-item-subtitle>{{ accountDisplayName || '-' }}</v-list-item-subtitle>
                    </v-list-item>
                    <v-list-item>
                        <v-list-item-title>Auth Provider</v-list-item-title>
                        <v-list-item-subtitle>{{ authProvider || '-' }}</v-list-item-subtitle>
                    </v-list-item>

                    <v-list-subheader>Identifiers</v-list-subheader>
                    <v-list-item>
                        <v-list-item-title>Session ID</v-list-item-title>
                        <v-list-item-subtitle>{{ sessionId || '-' }}</v-list-item-subtitle>
                    </v-list-item>
                    <v-list-item>
                        <v-list-item-title>Full Session ID</v-list-item-title>
                        <v-list-item-subtitle style="word-break: break-all;">{{ fullSessionId || '-' }}</v-list-item-subtitle>
                    </v-list-item>
                    <v-list-item>
                        <v-list-item-title>Agent ID</v-list-item-title>
                        <v-list-item-subtitle style="word-break: break-all;">{{ agentId || '-' }}</v-list-item-subtitle>
                    </v-list-item>
                    <v-list-item>
                        <v-list-item-title>Instance ID</v-list-item-title>
                        <v-list-item-subtitle>{{ instanceId || '-' }}</v-list-item-subtitle>
                    </v-list-item>

                    <v-list-subheader>Connection Details</v-list-subheader>
                    <v-list-item>
                        <v-list-item-title>Connected URL</v-list-item-title>
                        <v-list-item-subtitle style="word-break: break-all;">{{ connectedUrl || '-' }}</v-list-item-subtitle>
                    </v-list-item>
                    <v-list-item>
                        <v-list-item-title>Last Close Code</v-list-item-title>
                        <v-list-item-subtitle>{{ lastCloseCode ?? '-' }}</v-list-item-subtitle>
                    </v-list-item>
                    <v-list-item>
                        <v-list-item-title>Last Close Reason</v-list-item-title>
                        <v-list-item-subtitle>{{ lastCloseReason || '-' }}</v-list-item-subtitle>
                    </v-list-item>
                </v-list>
            </v-window-item>
            <v-window-item value="environment">
                <v-list density="compact" class="px-2">
                    <v-list-item>
                        <v-list-item-title>Loading</v-list-item-title>
                        <template #append>
                            <v-chip :color="environmentIsLoading ? 'warning' : 'success'" size="small" variant="flat">
                                {{ environmentIsLoading ? 'Loading' : 'Ready' }}
                            </v-chip>
                        </template>
                    </v-list-item>
                </v-list>
            </v-window-item>
            <v-window-item value="physics">
                <v-list density="compact" class="px-2">
                    <v-list-subheader>Runtime</v-list-subheader>
                    <v-list-item>
                        <v-list-item-title>Enabled</v-list-item-title>
                        <template #append>
                            <v-chip :color="physicsEnabled ? 'success' : 'error'" size="small" variant="flat">
                                {{ String(physicsEnabled) }}
                            </v-chip>
                        </template>
                    </v-list-item>
                    <v-list-item>
                        <v-list-item-title>Plugin</v-list-item-title>
                        <v-list-item-subtitle>{{ physicsPluginName || '-' }}</v-list-item-subtitle>
                    </v-list-item>
                    <v-list-item>
                        <v-list-item-title>Engine Type</v-list-item-title>
                        <v-list-item-subtitle>{{ physicsEngineType || '-' }}</v-list-item-subtitle>
                    </v-list-item>
                    <v-list-item>
                        <v-list-item-title>Initialized</v-list-item-title>
                        <template #append>
                            <v-chip :color="physicsInitialized ? 'success' : 'warning'" size="small" variant="flat">
                                {{ String(physicsInitialized) }}
                            </v-chip>
                        </template>
                    </v-list-item>

                    <v-list-subheader>Havok Module</v-list-subheader>
                    <v-list-item>
                        <v-list-item-title>Module Loaded</v-list-item-title>
                        <template #append>
                            <v-chip :color="havokInstanceLoaded ? 'success' : 'error'" size="small" variant="flat">
                                {{ String(havokInstanceLoaded) }}
                            </v-chip>
                        </template>
                    </v-list-item>
                    <v-list-item>
                        <v-list-item-title>Plugin Created</v-list-item-title>
                        <template #append>
                            <v-chip :color="physicsPluginCreated ? 'success' : 'error'" size="small" variant="flat">
                                {{ String(physicsPluginCreated) }}
                            </v-chip>
                        </template>
                    </v-list-item>

                    <v-list-subheader>World</v-list-subheader>
                    <v-list-item>
                        <v-list-item-title>Gravity</v-list-item-title>
                        <v-list-item-subtitle>
                            [{{ gravity[0] }}, {{ gravity[1] }}, {{ gravity[2] }}]
                        </v-list-item-subtitle>
                    </v-list-item>
                    <v-list-item v-if="physicsError">
                        <v-alert
                            type="error"
                            density="compact"
                            variant="tonal"
                            title="Physics Error"
                            :text="physicsError || ''"
                        />
                    </v-list-item>
                </v-list>
            </v-window-item>
        </v-window>
    </v-navigation-drawer>
</template>

<script setup lang="ts">
import { computed } from "vue";

type GravityTuple = [number, number, number];

const props = withDefaults(
    defineProps<{
        open?: boolean; // v-model:open
        tab?: string;   // v-model:tab
        width?: number;
        environmentIsLoading: boolean;
        physicsEnabled: boolean;
        physicsPluginName: string | null;
        physicsEngineType: string;
        physicsInitialized: boolean;
        havokInstanceLoaded: boolean;
        physicsPluginCreated: boolean;
        physicsError: string | null;
        gravity: GravityTuple;
        // Connection / Auth
        connectionStatus: string;
        isConnecting: boolean;
        isAuthenticated: boolean;
        isAuthenticating: boolean;
        accountDisplayName: string;
        sessionId: string | null;
        fullSessionId: string | null;
        agentId: string | null;
        instanceId: string | null;
        authProvider: string | null;
        lastCloseCode: number | null;
        lastCloseReason: string | null;
        connectedUrl: string | null;
    }>(),
    {
        open: false,
        tab: "environment",
        width: 360,
    },
);

const emit = defineEmits<{
    (e: "update:open", value: boolean): void;
    (e: "update:tab", value: string): void;
}>();

const openModel = computed({
    get: () => props.open,
    set: (v: boolean) => emit("update:open", v),
});
const tabModel = computed({
    get: () => props.tab,
    set: (v: string) => emit("update:tab", v),
});

// Mark as used in template
void openModel;
void tabModel;

const connectionStatusColor = computed(() => {
    switch (props.connectionStatus) {
        case "connected":
            return "success";
        case "connecting":
            return "warning";
        case "disconnected":
            return "error";
        default:
            return "info";
    }
});
void connectionStatusColor;
</script>


