<template>
    <div>
        <slot v-if="appStore.isAuthenticated" />
        <v-container v-else fluid fill-height class="intro-screen">
            <v-row align="center" justify="center">
                <v-col cols="12" sm="8" md="6" lg="4">
                    <v-card class="elevation-12" :loading="appStore.isAuthenticating">
                        <v-toolbar color="primary" dark flat>
                            <v-toolbar-title>Welcome to Vircadia</v-toolbar-title>
                        </v-toolbar>
                        <v-card-text class="pa-6">
                            <p class="text-center text-h6 font-weight-regular">
                                Please choose your login method to continue.
                            </p>
                            <v-alert v-if="appStore.authError" type="error" dense class="mt-4">
                                {{ appStore.authError }}
                            </v-alert>
                        </v-card-text>
                        <v-card-actions class="d-flex flex-column pa-6 pt-0">
                            <v-btn
                                block
                                x-large
                                color="primary"
                                @click="loginWithAzure"
                                :disabled="appStore.isAuthenticating"
                                class="mb-4"
                            >
                                <v-icon left>mdi-microsoft-azure</v-icon>
                                Login with Azure AD
                            </v-btn>
                            <v-btn
                                block
                                x-large
                                color="secondary"
                                @click="loginAnonymously"
                                :disabled="appStore.isAuthenticating"
                                class="mb-4"
                            >
                                <v-icon left>mdi-account-circle-outline</v-icon>
                                Continue as Anonymous
                            </v-btn>
                            <v-btn
                                v-if="showDebugLogin"
                                block
                                x-large
                                color="accent"
                                @click="loginWithDebugToken"
                                :disabled="appStore.isAuthenticating"
                            >
                                <v-icon left>mdi-bug-check</v-icon>
                                Continue with Debug Token
                            </v-btn>
                        </v-card-actions>
                    </v-card>
                </v-col>
            </v-row>
        </v-container>
    </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useAppStore } from "@/stores/appStore";
import { clientBrowserConfiguration } from "@/vircadia.browser.config";
import type { AccountInfo } from "@azure/msal-browser";

const appStore = useAppStore();

const showDebugLogin = computed(() => {
    return !!clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN;
});

const getApiUrl = () => {
    const protocol =
        clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_URI_USING_SSL
            ? "https"
            : "http";
    return `${protocol}://${clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEFAULT_WORLD_API_URI}`;
};

const loginWithAzure = async () => {
    appStore.isAuthenticating = true;
    appStore.authError = null;

    try {
        const response = await fetch(
            `${getApiUrl()}/world/rest/auth/oauth/authorize?provider=azure`,
        );

        // Debug logs
        console.log("Auth URL Response:", {
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            url: response.url,
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("Auth URL Error Response:", errorText);
            throw new Error(
                `Failed to get authorization URL: ${response.status} ${response.statusText}`,
            );
        }

        const data = await response.json();
        console.log("Auth URL Response Data:", data);

        if (data.success && data.redirectUrl) {
            sessionStorage.setItem(
                "vircadia-auth-return-url",
                window.location.href,
            );
            window.location.href = data.redirectUrl;
        } else {
            throw new Error("No authorization URL received");
        }
    } catch (err) {
        console.error("Login failed:", err);
        appStore.authError =
            err instanceof Error ? err.message : "Login failed";
        appStore.isAuthenticating = false;
    }
};

const loginAnonymously = async () => {
    appStore.isAuthenticating = true;
    appStore.authError = null;
    try {
        const response = await fetch(
            `${getApiUrl()}/world/rest/auth/anonymous`,
            {
                method: "POST",
            },
        );
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(
                `Failed to login anonymously: ${response.status} ${response.statusText} - ${errorText}`,
            );
        }
        const data = await response.json();
        if (data.success && data.data) {
            const {
                token,
                agentId: newAgentId,
                sessionId: newSessionId,
            } = data.data;
            appStore.sessionToken = token;
            appStore.sessionId = newSessionId;
            appStore.agentId = newAgentId;
            appStore.authProvider = "anon";
            appStore.account = {
                homeAccountId: newAgentId,
                environment: "anonymous",
                tenantId: "",
                username: `Anonymous ${newAgentId.substring(0, 8)}`,
                localAccountId: newAgentId,
                name: `Anonymous ${newAgentId.substring(0, 8)}`,
            } as AccountInfo;
        } else {
            throw new Error("Invalid response from server");
        }
    } catch (err) {
        console.error("Anonymous login failed:", err);
        appStore.authError =
            err instanceof Error ? err.message : "Anonymous login failed";
    } finally {
        appStore.isAuthenticating = false;
    }
};

const loginWithDebugToken = async () => {
    appStore.isAuthenticating = true;
    appStore.authError = null;
    try {
        const token =
            clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN;
        const configuredProvider =
            clientBrowserConfiguration.VRCA_CLIENT_WEB_BABYLON_JS_DEBUG_SESSION_TOKEN_PROVIDER;

        if (!token) {
            throw new Error("No debug token found in configuration.");
        }

        appStore.sessionToken = token;
        appStore.authProvider = configuredProvider;
        appStore.account = {
            homeAccountId: "debug-user",
            environment: "debug",
            tenantId: "",
            username: "Debug User",
            localAccountId: "debug-user",
            name: "Debug User",
        } as AccountInfo;
    } catch (err) {
        console.error("Debug token login failed:", err);
        appStore.authError =
            err instanceof Error ? err.message : "Debug token login failed";
    } finally {
        appStore.isAuthenticating = false;
    }
};

defineExpose({
    loginWithAzure,
    loginAnonymously,
    loginWithDebugToken,
    showDebugLogin,
});
</script>

<style scoped>
.intro-screen {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    z-index: 2000;
    background: #202020;
}
</style> 