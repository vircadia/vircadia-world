import { ref, watch, onUnmounted } from "vue";
import { KeyboardEventTypes } from "@babylonjs/core";
import type { Scene, Observer } from "@babylonjs/core";
import type { KeyboardInfo } from "@babylonjs/core";
import { useWindowFocus } from "@vueuse/core";

export function useBabylonAvatarKeyboardControls(scene: Scene | undefined) {
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

    // Observer handle for keyboard events
    let keyboardObserver: Observer<KeyboardInfo> | null = null;

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

    // Cleanup keyboard observer on unmount
    onUnmounted(() => {
        if (scene && keyboardObserver) {
            scene.onKeyboardObservable.remove(keyboardObserver);
        }
    });

    return { keyState };
}
