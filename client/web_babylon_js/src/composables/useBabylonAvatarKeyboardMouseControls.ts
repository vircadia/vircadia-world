import { ref, watch, onUnmounted } from "vue";
import { KeyboardEventTypes, PointerEventTypes } from "@babylonjs/core";
import type { Scene, Observer, KeyboardInfo, PointerInfo } from "@babylonjs/core";
import { useWindowFocus } from "@vueuse/core";

export function useBabylonAvatarKeyboardMouseControls(scene: Scene | undefined) {
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

    // pointer state and lock
    const pointerState = ref({ deltaX: 0, deltaY: 0, wheelDelta: 0, buttonDown: false });
    const isPointerLocked = ref(false);

    // Functions to control pointer lock
    const enablePointerLock = () => {
        const canvas = scene?.getEngine().getRenderingCanvas();
        canvas?.requestPointerLock();
    };
    const exitPointerLock = () => {
        document.exitPointerLock();
    };

    // Listen for pointer lock changes
    const onPointerLockChange = () => {
        const canvas = scene?.getEngine().getRenderingCanvas();
        isPointerLocked.value = document.pointerLockElement === canvas;
    };
    if (typeof document !== "undefined") {
        document.addEventListener('pointerlockchange', onPointerLockChange);
    }

    // Observer handle for keyboard events
    let keyboardObserver: Observer<KeyboardInfo> | null = null;
    // Observer handle for pointer events
    let pointerObserver: Observer<PointerInfo> | null = null;

    if (scene) {
        keyboardObserver = scene.onKeyboardObservable.add((kbInfo) => {
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

        // Observer for pointer events
        pointerObserver = scene.onPointerObservable.add((info) => {
            const e = info.event as MouseEvent | WheelEvent;
            switch (info.type) {
                case PointerEventTypes.POINTERDOWN:
                    pointerState.value.buttonDown = true;
                    // lock pointer on left or right button down
                    if ((e as MouseEvent).button === 0 || (e as MouseEvent).button === 2) {
                        enablePointerLock();
                    }
                    break;
                case PointerEventTypes.POINTERUP:
                    pointerState.value.buttonDown = false;
                    // release pointer lock on button up
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

    // Reset keys on window blur to prevent stuck states
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

    // Cleanup keyboard and pointer observers on unmount
    onUnmounted(() => {
        if (scene && keyboardObserver) {
            scene.onKeyboardObservable.remove(keyboardObserver);
        }
        if (scene && pointerObserver) {
            scene.onPointerObservable.remove(pointerObserver);
        }
        if (typeof document !== "undefined") {
            document.removeEventListener('pointerlockchange', onPointerLockChange);
        }
    });

    return { keyState, pointerState, isPointerLocked, enablePointerLock, exitPointerLock };
}
