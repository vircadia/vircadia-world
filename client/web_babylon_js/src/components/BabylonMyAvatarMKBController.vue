<template>
    <slot
        :key-state="keyState"
        :pointer-state="pointerState"
        :is-pointer-locked="isPointerLocked"
        :enable-pointer-lock="enablePointerLock"
        :exit-pointer-lock="exitPointerLock"
    />
</template>

<script setup lang="ts">
import { ref, watch, onUnmounted } from "vue";
import {
    KeyboardEventTypes,
    PointerEventTypes,
    type Scene,
    type Observer,
    type KeyboardInfo,
    type PointerInfo,
} from "@babylonjs/core";
import { useWindowFocus } from "@vueuse/core";

const props = defineProps({
    scene: { type: Object as () => Scene, required: true },
});

const focused = useWindowFocus();

const keyState = ref({
    forward: false,
    backward: false,
    strafeLeft: false,
    strafeRight: false,
    jump: false,
    run: false,
    turnLeft: false,
    turnRight: false,
});

const pointerState = ref({
    deltaX: 0,
    deltaY: 0,
    wheelDelta: 0,
    buttonDown: false,
});

const isPointerLocked = ref(false);

const enablePointerLock = () => {
    const canvas = props.scene?.getEngine().getRenderingCanvas();
    canvas?.requestPointerLock();
};
const exitPointerLock = () => {
    document.exitPointerLock();
};

const onPointerLockChange = () => {
    const canvas = props.scene?.getEngine().getRenderingCanvas();
    isPointerLocked.value = document.pointerLockElement === canvas;
};
if (typeof document !== "undefined") {
    document.addEventListener("pointerlockchange", onPointerLockChange);
}

let keyboardObserver: Observer<KeyboardInfo> | null = null;
let pointerObserver: Observer<PointerInfo> | null = null;

if (props.scene) {
    keyboardObserver = props.scene.onKeyboardObservable.add((kbInfo) => {
        const code = kbInfo.event.code;
        const isDown = kbInfo.type === KeyboardEventTypes.KEYDOWN;
        switch (code) {
            case "KeyW":
            case "ArrowUp":
                keyState.value.forward = isDown;
                break;
            case "KeyS":
            case "ArrowDown":
                keyState.value.backward = isDown;
                break;
            case "KeyA":
            case "ArrowLeft":
                keyState.value.strafeLeft = isDown;
                break;
            case "KeyD":
            case "ArrowRight":
                keyState.value.strafeRight = isDown;
                break;
            case "Space":
                keyState.value.jump = isDown;
                break;
            case "ShiftLeft":
            case "ShiftRight":
                keyState.value.run = isDown;
                break;
            case "KeyQ":
                keyState.value.turnLeft = isDown;
                break;
            case "KeyE":
                keyState.value.turnRight = isDown;
                break;
        }
    });

    pointerObserver = props.scene.onPointerObservable.add((info) => {
        const e = info.event as MouseEvent | WheelEvent;
        switch (info.type) {
            case PointerEventTypes.POINTERDOWN:
                pointerState.value.buttonDown = true;
                if (
                    (e as MouseEvent).button === 0 ||
                    (e as MouseEvent).button === 2
                ) {
                    enablePointerLock();
                }
                break;
            case PointerEventTypes.POINTERUP:
                pointerState.value.buttonDown = false;
                exitPointerLock();
                break;
            case PointerEventTypes.POINTERMOVE:
                pointerState.value.deltaX = (e as MouseEvent).movementX;
                pointerState.value.deltaY = (e as MouseEvent).movementY;
                break;
            case PointerEventTypes.POINTERWHEEL:
                pointerState.value.wheelDelta = (e as WheelEvent).deltaY;
                break;
        }
    });
}

if (typeof window !== "undefined") {
    const resetKeys = () => {
        keyState.value.forward = false;
        keyState.value.backward = false;
        keyState.value.strafeLeft = false;
        keyState.value.strafeRight = false;
        keyState.value.jump = false;
        keyState.value.run = false;
        keyState.value.turnLeft = false;
        keyState.value.turnRight = false;
    };

    watch(focused, (isFocused) => {
        if (!isFocused) resetKeys();
    });
}

onUnmounted(() => {
    if (props.scene && keyboardObserver) {
        props.scene.onKeyboardObservable.remove(keyboardObserver);
    }
    if (props.scene && pointerObserver) {
        props.scene.onPointerObservable.remove(pointerObserver);
    }
    if (typeof document !== "undefined") {
        document.removeEventListener("pointerlockchange", onPointerLockChange);
    }
});
</script>

<style scoped>
/* renderless controller */
</style>


