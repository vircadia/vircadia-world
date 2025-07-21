<template>
    <div class="azure-ad-auth">
        <v-btn
            v-if="!appStore.isAuthenticated"
            color="primary"
            @click="handleLogin"
            :loading="appStore.isAuthenticating"
            :disabled="appStore.isAuthenticating"
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
            v-if="appStore.authError"
            type="error"
            dismissible
            class="mt-2"
            @click:close="appStore.authError = null"
        >
            {{ appStore.authError }}
        </v-alert>
        

    </div>
</template>

<script setup lang="ts">
import { computed, watch, onMounted } from "vue";
import { useAppStore } from "@/stores/appStore";

const appStore = useAppStore();

// Refresh account data on mount and when authentication state changes
onMounted(() => {
    if (appStore.isAuthenticated && !appStore.account) {
        console.log("Authenticated but no account data, refreshing...");
        appStore.refreshAccountData();
    }
});

watch(
    () => appStore.isAuthenticated,
    (newVal) => {
        if (newVal && !appStore.account) {
            console.log(
                "Authentication state changed, refreshing account data...",
            );
            appStore.refreshAccountData();
        }
    },
);

const username = computed(() => {
    if (!appStore.account) return "Not signed in";

    // Debug logging
    console.log("Computing username - account data:", {
        account: appStore.account,
        username: appStore.account.username,
        name: appStore.account.name,
        idTokenClaims: appStore.account.idTokenClaims,
        localAccountId: appStore.account.localAccountId,
        isAuthenticated: appStore.isAuthenticated,
        sessionToken: appStore.sessionToken,
    });

    // Try different properties in order of preference
    return (
        appStore.account.username ||
        appStore.account.name ||
        appStore.account.idTokenClaims?.preferred_username ||
        appStore.account.idTokenClaims?.name ||
        appStore.account.localAccountId
    );
});

const handleLogin = () => {
    appStore.login();
};

const handleLogout = () => {
    appStore.logout();
};
</script>

<style scoped>
.azure-ad-auth {
    display: inline-block;
}
</style> 