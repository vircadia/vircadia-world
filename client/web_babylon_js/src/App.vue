<template>
    <v-app>
        <MainScene />

        <div class="build-overlay" aria-label="Build info">
            <span class="build-overlay__dot" />
            <span class="build-overlay__text">v{{ appVersion }} • {{ buildDate }} • {{ commitHash }}</span>
        </div>
    </v-app>
</template>

<script setup lang="ts">
import MainScene from "./components/MainScene.vue";

const appVersion = __APP_VERSION__;
const buildDate = new Date(__BUILD_DATE__).toLocaleString();
const commitHash = __COMMIT_HASH__;
</script>
