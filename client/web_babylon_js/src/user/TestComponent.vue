<template>
    <div class="test-component">
        <v-btn color="primary" @click="dialog = true">Open Test Dialog</v-btn>

        <v-dialog v-model="dialog" max-width="500">
            <v-card>
                <v-card-title class="headline">Test Component Dialog</v-card-title>
                <v-card-text>
                    This is a dialog from the dynamically loaded TestComponent.
                </v-card-text>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn color="green darken-1" text @click="dialog = false">Close</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>
    </div>
</template>

<script setup lang="ts">
import { ref } from "vue";

const dialog = ref(false);
</script>

<style scoped>
.test-component {
    position: absolute;
    top: 0;
    left: 0;
    width: 200px;
    height: 70px;
    padding: 16px;
    background-color: #333;
    border: 1px solid #555;
    border-radius: 8px;
    color: white;
}
</style>