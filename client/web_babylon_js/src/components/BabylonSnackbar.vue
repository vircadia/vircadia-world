<template>
    <v-snackbar :model-value="visible" :timeout="-1" location="bottom" class="app-snackbar">
        <div class="d-flex align-center">
            <v-progress-circular
                v-if="showSpinner"
                indeterminate
                color="white"
                size="24"
                class="mr-2"
            />
            {{ text }}
        </div>
    </v-snackbar>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
    sceneInitialized: boolean;
    connectionStatus: string;
    isConnecting: boolean;
    environmentLoading: boolean;
    avatarLoading: boolean;
    otherAvatarsLoading: boolean;
    modelsLoading: boolean;
    isAuthenticating: boolean;
    isAuthenticated: boolean;
}>();

const isLoading = computed(
    () =>
        props.environmentLoading ||
        props.avatarLoading ||
        props.otherAvatarsLoading ||
        props.modelsLoading,
);

const visible = computed(
    () =>
        !props.sceneInitialized ||
        props.connectionStatus !== "connected" ||
        isLoading.value ||
        props.isConnecting ||
        !props.isAuthenticated,
);

const showSpinner = computed(
    () => isLoading.value || props.isConnecting || props.isAuthenticating,
);

const text = computed(() => {
    const states: string[] = [];

    if (!props.sceneInitialized) states.push("• Scene: Initializing");
    else states.push("• Scene: Ready");

    if (props.isConnecting) states.push("• Connection: Connecting");
    else states.push(`• Connection: ${props.connectionStatus}`);

    states.push(
        `• Environment: ${props.environmentLoading ? "Loading" : "Ready"}`,
    );
    states.push(`• Avatar: ${props.avatarLoading ? "Loading" : "Ready"}`);
    states.push(
        `• Other Avatars: ${props.otherAvatarsLoading ? "Loading" : "Ready"}`,
    );
    states.push(`• Models: ${props.modelsLoading ? "Loading" : "Ready"}`);
    states.push(
        `• Authentication: ${props.isAuthenticating ? "Authenticating" : "Authenticated"}`,
    );

    return states.join("\n");
});
</script>

<style>
.app-snackbar {
    z-index: 3000;
    white-space: pre-line;
}
</style>


