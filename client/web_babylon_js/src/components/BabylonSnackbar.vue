<template>
    <v-snackbar :model-value="visible" :timeout="-1" location="bottom" class="app-snackbar">
        <div class="d-flex align-center">
            <v-progress-circular v-if="showSpinner" indeterminate color="white" size="24" class="mr-2" />
            {{ text }}
        </div>
    </v-snackbar>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
    sceneReady: boolean;
    connectionStatus: string;
    isConnecting: boolean;
    avatarLoading: boolean;
    otherAvatarsLoading: boolean;
    isAuthenticating: boolean;
    isAuthenticated: boolean;
    avatarModelStep?: string;
    avatarModelError?: string | null;
    modelFileName?: string | null;
}>();

const isLoading = computed(
    () =>
        props.avatarLoading ||
        props.otherAvatarsLoading
);

const visible = computed(
    () =>
        !props.sceneReady ||
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

    if (!props.sceneReady) states.push("• Scene: Not ready");
    else states.push("• Scene: Ready");

    if (props.isConnecting) states.push("• Connection: Connecting");
    else states.push(`• Connection: ${props.connectionStatus}`);

    states.push(`• Avatar: ${props.avatarLoading ? "Loading" : "Ready"}`);
    if (props.avatarModelStep) {
        const step = props.avatarModelStep;
        const name = props.modelFileName ? ` (${props.modelFileName})` : "";
        states.push(`• Avatar Model${name}: ${step}`);
    }
    if (props.avatarModelError) {
        states.push(`• Avatar Model Error: ${props.avatarModelError}`);
    }
    states.push(
        `• Other Avatars: ${props.otherAvatarsLoading ? "Loading" : "Ready"}`,
    );
    states.push(
        `• Authentication: ${props.isAuthenticating ? "Authenticating" : "Authenticated"}`,
    );

    return states.join("\n");
});

// Mark used in template to satisfy linter
void visible;
void showSpinner;
void text;
</script>

<style>
.app-snackbar {
    z-index: 3000;
    white-space: pre-line;
}
</style>
