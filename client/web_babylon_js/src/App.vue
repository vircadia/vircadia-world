<template>
    <v-app>
        <MainScene />
    </v-app>
</template>

<script setup lang="ts">
import MainScene from "./components/MainScene.vue";
// mark as used at runtime for template
void MainScene;
</script>

<style>
</style>
