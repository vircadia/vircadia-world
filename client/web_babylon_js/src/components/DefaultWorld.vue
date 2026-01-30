<template>
    <VircadiaScene ref="sceneRef" :vircadia-world="vircadiaWorld" :engine-type="engineType" :physics-enabled="true" />
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import VircadiaScene from "@/components/VircadiaScene.vue";
import type { VircadiaWorldInstance } from "@/components/VircadiaWorldProvider.vue";

const props = defineProps<{
    vircadiaWorld: VircadiaWorldInstance;
    engineType?: "webgl" | "webgpu" | "nullengine";
}>();

const sceneRef = ref<InstanceType<typeof VircadiaScene> | null>(null);

// Re-expose refs for MainScene to access
defineExpose({
    canvasComponentRef: computed(() => sceneRef.value?.canvasComponentRef),
    avatarRef: computed(() => sceneRef.value?.avatarRef),
    otherAvatarsRef: computed(() => sceneRef.value?.otherAvatarsRef),
    // Proxy methods if needed
    toggleInspector: () => sceneRef.value?.toggleInspector(),
    // Forward showWebRTCControls ref
    showWebRTCControls: computed(() => sceneRef.value?.showWebRTCControls),
});
</script>
