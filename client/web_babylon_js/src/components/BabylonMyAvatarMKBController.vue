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
    // Press-and-hold states
    forwardCodes: { type: Array as () => string[], required: true },
    backwardCodes: { type: Array as () => string[], required: true },
    strafeLeftCodes: { type: Array as () => string[], required: true },
    strafeRightCodes: { type: Array as () => string[], required: true },
    jumpCodes: { type: Array as () => string[], required: true },
    sprintCodes: { type: Array as () => string[], required: true },
    dashCodes: { type: Array as () => string[], required: true },
    turnLeftCodes: { type: Array as () => string[], required: true },
    turnRightCodes: { type: Array as () => string[], required: true },
    // Toggle states (flip only on key down)
    flyModeToggleCodes: { type: Array as () => string[], required: true },
    crouchToggleCodes: { type: Array as () => string[], required: true },
    proneToggleCodes: { type: Array as () => string[], required: true },
    slowRunToggleCodes: { type: Array as () => string[], required: true },
});

const focused = useWindowFocus();

const keyState = ref({
    forward: false,
    backward: false,
    strafeLeft: false,
    strafeRight: false,
    jump: false,
    sprint: false,
    dash: false,
    turnLeft: false,
    turnRight: false,
    // toggles
    flyMode: false,
    crouch: false,
    prone: false,
    slowRun: false,
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
        if (props.forwardCodes.includes(code)) {
            keyState.value.forward = isDown;
        }
        if (props.backwardCodes.includes(code)) {
            keyState.value.backward = isDown;
        }
        if (props.strafeLeftCodes.includes(code)) {
            keyState.value.strafeLeft = isDown;
        }
        if (props.strafeRightCodes.includes(code)) {
            keyState.value.strafeRight = isDown;
        }
        if (props.jumpCodes.includes(code)) {
            keyState.value.jump = isDown;
        }
        if (props.sprintCodes.includes(code)) {
            keyState.value.sprint = isDown;
        }
        if (props.dashCodes.includes(code)) {
            keyState.value.dash = isDown;
        }
        if (props.turnLeftCodes.includes(code)) {
            keyState.value.turnLeft = isDown;
        }
        if (props.turnRightCodes.includes(code)) {
            keyState.value.turnRight = isDown;
        }
        // toggles (flip only on key down)
        if (isDown && props.flyModeToggleCodes.includes(code)) {
            keyState.value.flyMode = !keyState.value.flyMode;
        }
        if (isDown && props.crouchToggleCodes.includes(code)) {
            keyState.value.crouch = !keyState.value.crouch;
        }
        if (isDown && props.proneToggleCodes.includes(code)) {
            keyState.value.prone = !keyState.value.prone;
        }
        if (isDown && props.slowRunToggleCodes.includes(code)) {
            keyState.value.slowRun = !keyState.value.slowRun;
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
        keyState.value.sprint = false;
        keyState.value.dash = false;
        keyState.value.turnLeft = false;
        keyState.value.turnRight = false;
        keyState.value.flyMode = false;
        keyState.value.crouch = false;
        keyState.value.prone = false;
        keyState.value.slowRun = false;
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


