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
import { computed } from "vue";
import { useAuthStore } from "@/stores/authStore";

const authStore = useAuthStore();

const username = computed(() => {
    if (!authStore.account) return "Unknown User";

    // Try different properties in order of preference
    return (
        authStore.account.username ||
        authStore.account.name ||
        authStore.account.idTokenClaims?.preferred_username ||
        authStore.account.idTokenClaims?.name ||
        authStore.account.localAccountId ||
        "Unknown User"
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