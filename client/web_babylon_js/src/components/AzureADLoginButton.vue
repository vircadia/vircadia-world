<template>
    <div class="azure-ad-auth">
        <v-btn
            v-if="!authStore.isAuthenticated"
            color="primary"
            @click="handleLogin"
            :loading="authStore.isAuthenticating"
            :disabled="authStore.isAuthenticating"
            prepend-icon="mdi-microsoft"
        >
            Sign in with Microsoft
        </v-btn>
        
        <div v-else class="d-flex align-center">
            <v-chip class="mr-2">
                <v-icon start>mdi-account-circle</v-icon>
                {{ username }}
            </v-chip>
            <v-btn
                color="error"
                variant="outlined"
                @click="handleLogout"
                size="small"
            >
                Sign Out
            </v-btn>
        </div>
        
        <v-alert
            v-if="authStore.authError"
            type="error"
            dismissible
            class="mt-2"
            @click:close="authStore.authError = null"
        >
            {{ authStore.authError }}
        </v-alert>
        

    </div>
</template>

<script setup lang="ts">
import { computed, watch, onMounted } from "vue";
import { useAuthStore } from "@/stores/authStore";

const authStore = useAuthStore();

// Refresh account data on mount and when authentication state changes
onMounted(() => {
    if (authStore.isAuthenticated && !authStore.account) {
        console.log("Authenticated but no account data, refreshing...");
        authStore.refreshAccountData();
    }
});

watch(
    () => authStore.isAuthenticated,
    (newVal) => {
        if (newVal && !authStore.account) {
            console.log(
                "Authentication state changed, refreshing account data...",
            );
            authStore.refreshAccountData();
        }
    },
);

const username = computed(() => {
    if (!authStore.account) return "Not signed in";

    // Debug logging
    console.log("Computing username - account data:", {
        account: authStore.account,
        username: authStore.account.username,
        name: authStore.account.name,
        idTokenClaims: authStore.account.idTokenClaims,
        localAccountId: authStore.account.localAccountId,
        isAuthenticated: authStore.isAuthenticated,
        sessionToken: authStore.sessionToken,
    });

    // Try different properties in order of preference
    return (
        authStore.account.username ||
        authStore.account.name ||
        authStore.account.idTokenClaims?.preferred_username ||
        authStore.account.idTokenClaims?.name ||
        authStore.account.localAccountId
    );
});

const handleLogin = () => {
    authStore.login();
};

const handleLogout = () => {
    authStore.logout();
};
</script>

<style scoped>
.azure-ad-auth {
    display: inline-block;
}
</style> 