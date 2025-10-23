<template>
    <v-container fluid fill-height class="intro-screen">
        <v-row align="center" justify="center">
            <v-col cols="12" sm="8" md="6" lg="4">
                <v-card class="elevation-12" :loading="isAuthenticating">
                    <v-toolbar color="primary" dark flat>
                        <v-toolbar-title>Welcome to Vircadia</v-toolbar-title>
                    </v-toolbar>
                    <v-card-text class="pa-6">
                        <p class="text-center text-h6 font-weight-regular">
                            Please choose your login method to continue.
                        </p>
                        <v-alert v-if="authError" type="error" dense class="mt-4">
                            {{ authError }}
                        </v-alert>
                    </v-card-text>
                    <v-card-actions class="d-flex flex-column pa-6 pt-0">
                        <v-btn block x-large color="primary" @click="onAzure" :disabled="isAuthenticating" class="mb-4">
                            <v-icon left>mdi-microsoft-azure</v-icon>
                            Login with Azure AD
                        </v-btn>
                        <v-btn block x-large color="secondary" @click="onAnonymous" :disabled="isAuthenticating"
                            class="mb-4">
                            <v-icon left>mdi-account-circle-outline</v-icon>
                            Continue as Anonymous
                        </v-btn>
                        <v-btn v-if="showDebugLogin" block x-large color="accent" @click="onDebug"
                            :disabled="isAuthenticating">
                            <v-icon left>mdi-bug-check</v-icon>
                            Continue with Debug Token
                        </v-btn>
                    </v-card-actions>
                </v-card>
            </v-col>
        </v-row>
    </v-container>
</template>

<script setup lang="ts">
const props = defineProps<{
    isAuthenticating: boolean;
    authError: string | null;
    showDebugLogin: boolean;
}>();

const emit = defineEmits<{ azure: []; anonymous: []; debug: [] }>();

function onAzure() {
    emit('azure');
}

function onAnonymous() {
    emit('anonymous');
}

function onDebug() {
    emit('debug');
}
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
