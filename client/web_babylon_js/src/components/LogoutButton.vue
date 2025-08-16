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
import { useAppStore } from "@/stores/appStore";
import { clientBrowserConfiguration } from "@/vircadia.browser.config";

const appStore = useAppStore();
const isLoggingOut = ref(false);
const isAuthenticated = computed(() => appStore.isAuthenticated);
// mark as used at runtime for template
void isAuthenticated;

const getApiUrl = () => {
    const protocol =
        clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_URI_USING_SSL
            ? "https"
            : "http";
    return `${protocol}://${clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_URI}`;
};

async function onLogout() {
    if (isLoggingOut.value) return;
    isLoggingOut.value = true;
    try {
        // Capture whether this session used the configured debug token
        const wasDebugSession =
            appStore.sessionToken ===
                clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN &&
            appStore.authProvider ===
                clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN_PROVIDER;

        if (appStore.sessionId) {
            try {
                await fetch(`${getApiUrl()}/world/rest/auth/logout`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        sessionId: appStore.sessionId,
                    }),
                });

                appStore.account = null;
                appStore.sessionToken = null;
                appStore.sessionId = null;
                appStore.agentId = null;
                appStore.authProvider = "anon";
                appStore.authError = null;

                // If we were using a debug token, clear any runtime overrides so it won't auto-login again
                try {
                    if (typeof window !== "undefined" && window.localStorage) {
                        window.localStorage.setItem(
                            "VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN",
                            "",
                        );
                        window.localStorage.setItem(
                            "VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN_PROVIDER",
                            "anon",
                        );
                        window.localStorage.setItem(
                            "VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN_DISABLED",
                            "1",
                        );
                        if (wasDebugSession) {
                            // Reload so configuration is re-parsed without the debug token
                            window.location.reload();
                        }
                    }
                } catch (e) {
                    console.warn("Failed to clear debug token overrides", e);
                }
            } catch (e) {
                console.error("Logout request failed:", e);
            }
        }
    } finally {
        isLoggingOut.value = false;
    }
}
// mark as used at runtime for template
void onLogout;
</script>
