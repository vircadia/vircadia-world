<template>
    <v-btn
        color="error"
        variant="outlined"
        size="small"
        :loading="isLoggingOut"
        :disabled="isLoggingOut || !isAuthenticated"
        @click="onLogout"
    >
        Sign Out
    </v-btn>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";

const props = defineProps<{
    isAuthenticated: boolean;
    onLogout: () => Promise<void> | void;
}>();
const isLoggingOut = ref(false);
const isAuthenticated = computed(() => props.isAuthenticated);
// mark as used at runtime for template
void isAuthenticated;

async function onLogout() {
    if (isLoggingOut.value) return;
    isLoggingOut.value = true;
    try {
        await Promise.resolve(props.onLogout());
    } finally {
        isLoggingOut.value = false;
    }
}
// mark as used at runtime for template
void onLogout;
</script>
