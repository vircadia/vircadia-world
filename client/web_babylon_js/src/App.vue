<template>
    <v-app>
        <MainScene />

        <div class="build-overlay" aria-label="Build info">
            <span class="build-overlay__dot" />
            <span class="build-overlay__text">v{{ appVersion }} • {{ buildDate }}</span>
        </div>
    </v-app>
</template>

<script setup lang="ts">
import MainScene from "./components/MainScene.vue";

const appVersion = __APP_VERSION__;
const buildDate = new Date(__BUILD_DATE__).toLocaleString();
</script>

<style>
/* Small corner build/version overlay */
.build-overlay {
    position: fixed;
    bottom: 8px;
    right: 8px;
    z-index: 2000;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border-radius: 9999px;
    background: rgba(0, 0, 0, 0.35);
    color: #fff;
    font-size: 11px;
    line-height: 1;
    letter-spacing: 0.3px;
    user-select: none;
    pointer-events: none;
    border: 1px solid rgba(255, 255, 255, 0.15);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
}

.build-overlay__dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #4caf50;
    box-shadow: 0 0 6px rgba(76, 175, 80, 0.9);
}

.build-overlay__text {
    opacity: 0.9;
}
</style>
