import { ref, watch } from "vue";
import { KeyboardEventTypes } from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";
import { useWindowFocus } from "@vueuse/core";

export function useAvatarKeyboardControls(scene: Scene | undefined) {
    const focused = useWindowFocus();

    const keyState = ref({
        forward: false,
        backward: false,
        left: false,
        right: false,
        jump: false,
        run: false,
    });

    if (scene) {
        scene.onKeyboardObservable.add((kbInfo) => {
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
                    keyState.value.left = isDown;
                    break;
                case "KeyD":
                case "ArrowRight":
                    keyState.value.right = isDown;
                    break;
                case "Space":
                    keyState.value.jump = isDown;
                    break;
                case "ShiftLeft":
                case "ShiftRight":
                    keyState.value.run = isDown;
                    break;
            }
        });
    }

    // Reset keys on window blur to prevent stuck states
    if (typeof window !== "undefined") {
        const resetKeys = () => {
            keyState.value.forward = false;
            keyState.value.backward = false;
            keyState.value.left = false;
            keyState.value.right = false;
            keyState.value.jump = false;
            keyState.value.run = false;
        };

        watch(focused, (isFocused) => {
            if (!isFocused) resetKeys();
        });
    }

    return { keyState };
}
