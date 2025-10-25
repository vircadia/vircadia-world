<template>
    <slot :key-state="keyState" :pointer-state="pointerState" :is-pointer-locked="isPointerLocked"
        :enable-pointer-lock="enablePointerLock" :exit-pointer-lock="exitPointerLock"
        :left-mouse-down="pointerState.leftMouseDown" :right-mouse-down="pointerState.rightMouseDown"
        :mouse-lock-camera-rotate-toggle="keyState.mouseLockCameraRotate"
        :mouse-lock-camera-avatar-rotate-toggle="keyState.mouseLockCameraAvatarRotate" />
</template>

<script setup lang="ts">
import {
    KeyboardEventTypes,
    type KeyboardInfo,
    type Observer,
    PointerEventTypes,
    type PointerInfo,
    type Scene,
} from "@babylonjs/core";
import { useWindowFocus } from "@vueuse/core";
import { onUnmounted, ref, watch } from "vue";

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
    mouseLockCameraRotateToggleCodes: { type: Array as () => string[], required: true },
    mouseLockCameraAvatarRotateToggleCodes: { type: Array as () => string[], required: true },
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
    mouseLockCameraRotate: false,
    mouseLockCameraAvatarRotate: false,
});

const pointerState = ref({
    deltaX: 0,
    deltaY: 0,
    wheelDelta: 0,
    buttonDown: false,
    leftMouseDown: false,
    rightMouseDown: false,
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
let contextMenuHandler: ((e: MouseEvent) => void) | null = null;

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
        if (isDown && props.mouseLockCameraRotateToggleCodes.includes(code)) {
            const newValue = !keyState.value.mouseLockCameraRotate;
            keyState.value.mouseLockCameraRotate = newValue;
            // Disable the other camera mode when enabling this one
            if (newValue) {
                keyState.value.mouseLockCameraAvatarRotate = false;
            }
        }
        if (isDown && props.mouseLockCameraAvatarRotateToggleCodes.includes(code)) {
            const newValue = !keyState.value.mouseLockCameraAvatarRotate;
            keyState.value.mouseLockCameraAvatarRotate = newValue;
            // Disable the other camera mode when enabling this one
            if (newValue) {
                keyState.value.mouseLockCameraRotate = false;
            }
        }
    });

    pointerObserver = props.scene.onPointerObservable.add((info) => {
        const e = info.event as MouseEvent | WheelEvent;
        switch (info.type) {
            case PointerEventTypes.POINTERDOWN: {
                pointerState.value.buttonDown = true;
                const mouseEvt = e as MouseEvent;
                if (mouseEvt.button === 0) {
                    pointerState.value.leftMouseDown = true;
                } else if (mouseEvt.button === 2) {
                    pointerState.value.rightMouseDown = true;
                    mouseEvt.preventDefault();
                }
                if (
                    mouseEvt.button === 0 ||
                    mouseEvt.button === 2
                ) {
                    enablePointerLock();
                }
                break;
            }
            case PointerEventTypes.POINTERUP: {
                pointerState.value.buttonDown = false;
                const mouseEvtUp = e as MouseEvent;
                if (mouseEvtUp.button === 0) {
                    pointerState.value.leftMouseDown = false;
                } else if (mouseEvtUp.button === 2) {
                    pointerState.value.rightMouseDown = false;
                }
                // Only exit pointer lock if both mouse lock toggles are off
                if (!keyState.value.mouseLockCameraRotate && !keyState.value.mouseLockCameraAvatarRotate) {
                    exitPointerLock();
                }
                break;
            }
            case PointerEventTypes.POINTERMOVE:
                pointerState.value.deltaX = (e as MouseEvent).movementX;
                pointerState.value.deltaY = (e as MouseEvent).movementY;
                break;
            case PointerEventTypes.POINTERWHEEL:
                pointerState.value.wheelDelta = (e as WheelEvent).deltaY;
                break;
        }
    });

    // Suppress browser context menu on RMB
    const canvas = props.scene.getEngine().getRenderingCanvas();
    if (canvas) {
        contextMenuHandler = (e: MouseEvent) => {
            e.preventDefault();
        };
        canvas.addEventListener("contextmenu", contextMenuHandler);
    }
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
        keyState.value.mouseLockCameraRotate = false;
        keyState.value.mouseLockCameraAvatarRotate = false;
        pointerState.value.leftMouseDown = false;
        pointerState.value.rightMouseDown = false;
    };

    watch(focused, (isFocused) => {
        if (!isFocused) resetKeys();
    });
}

// Watch mouse lock toggles and enable/disable pointer lock accordingly
watch(
    () => [keyState.value.mouseLockCameraRotate, keyState.value.mouseLockCameraAvatarRotate],
    ([cameraRotate, avatarRotate]) => {
        const shouldLock = cameraRotate || avatarRotate;
        if (shouldLock && !isPointerLocked.value) {
            enablePointerLock();
        } else if (!shouldLock && isPointerLocked.value) {
            exitPointerLock();
        }
    }
);

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
    const canvas = props.scene?.getEngine().getRenderingCanvas();
    if (canvas && contextMenuHandler) {
        try {
            canvas.removeEventListener("contextmenu", contextMenuHandler);
        } catch { }
    }
});
</script>

<style scoped>
/* renderless controller */
</style>
