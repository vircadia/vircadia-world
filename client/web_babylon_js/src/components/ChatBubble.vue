<template>
    <!-- Renderless, manages Babylon resources -->
    <slot></slot>
</template>

<script setup lang="ts">
import {
    watch,
    onMounted,
    onUnmounted,
    ref,
    type PropType,
} from "vue";
import {
    Scene,
    Mesh,
    Vector3,
    TransformNode,
    MeshBuilder,
    StandardMaterial,
    Color3,
} from "@babylonjs/core";
import {
    AdvancedDynamicTexture,
    TextBlock,
    Rectangle,
    Control,
} from "@babylonjs/gui";
import type { ChatMessage } from "@/schemas";

const props = defineProps({
    scene: {
        type: Object as PropType<Scene>,
        required: true,
    },
    avatarNode: {
        type: Object as PropType<TransformNode | null>,
        default: null,
    },
    messages: {
        type: Array as PropType<ChatMessage[]>,
        default: () => [],
    },
    heightOffset: {
        type: Number,
        default: 1.4,
    },
});

const bubbleMesh = ref<Mesh | null>(null);
const texture = ref<AdvancedDynamicTexture | null>(null);
const messageText = ref<TextBlock | null>(null);
const timeoutHandle = ref<any>(null);

function createBubble() {
    if (!props.scene || bubbleMesh.value) return;

    // Create a plane for the bubble
    const plane = MeshBuilder.CreatePlane("chatBubblePlane", { width: 1.5, height: 0.3 }, props.scene);
    plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    plane.position = new Vector3(0, props.heightOffset, 0);
    plane.isVisible = false;

    // Create ADT
    const adt = AdvancedDynamicTexture.CreateForMesh(plane, 1024, 205);

    // Background
    const rect = new Rectangle();
    rect.width = 1;
    rect.height = 1;
    rect.cornerRadius = 15;
    rect.color = "white";
    rect.thickness = 2;
    rect.background = "rgba(0, 0, 0, 0.6)";
    adt.addControl(rect);

    // Text
    const text = new TextBlock();
    text.text = "";
    text.color = "white";
    text.fontSize = 60;
    text.textWrapping = true;
    text.resizeToFit = true;
    rect.addControl(text);

    bubbleMesh.value = plane;
    texture.value = adt;
    messageText.value = text;

    updatePosition();
}

function updatePosition() {
    if (!bubbleMesh.value || !props.avatarNode) return;

    // Parent to avatar node?
    // If we parent, billboard mode works relative to parent rotation if not careful.
    // But BILLBOARDMODE_ALL should work.
    bubbleMesh.value.parent = props.avatarNode;
    bubbleMesh.value.position = new Vector3(0, props.heightOffset, 0);
}

function showMessage(msg: ChatMessage) {
    if (!bubbleMesh.value) createBubble();
    if (!bubbleMesh.value || !messageText.value) return;

    messageText.value.text = msg.text;
    bubbleMesh.value.isVisible = true;

    if (timeoutHandle.value) clearTimeout(timeoutHandle.value);
    timeoutHandle.value = setTimeout(() => {
        if (bubbleMesh.value) bubbleMesh.value.isVisible = false;
    }, 10000);
}

watch(
    () => props.messages,
    (newMessages) => {
        if (newMessages.length > 0) {
            const latest = newMessages[newMessages.length - 1];
            showMessage(latest);
        }
    },
    { deep: true }
);

watch(
    () => props.avatarNode,
    () => {
        updatePosition();
    }
);

onMounted(() => {
    createBubble();
});

onUnmounted(() => {
    if (timeoutHandle.value) clearTimeout(timeoutHandle.value);
    if (bubbleMesh.value) {
        bubbleMesh.value.dispose();
    }
    if (texture.value) {
        texture.value.dispose();
    }
});
</script>
