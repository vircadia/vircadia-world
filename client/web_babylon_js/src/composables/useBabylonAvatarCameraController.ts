import { ref, onUnmounted, type Ref } from "vue";
import type { Scene } from "@babylonjs/core";
import { ArcRotateCamera, Vector3 } from "@babylonjs/core";

// Camera orientation shape
export interface CameraOrientation {
    alpha: number;
    beta: number;
    radius: number;
}

/**
 * Composable for setting up and controlling an ArcRotateCamera
 */
export function useBabylonAvatarCameraController(
    scene: Scene | undefined,
    avatarNode: Ref<{ position: Vector3 } | null>,
    cameraOrientation: Ref<CameraOrientation>,
    capsuleHeight: Ref<number>,
    throttledUpdate: () => void,
) {
    const camera = ref<ArcRotateCamera | null>(null);

    // Create and attach the camera
    function setupCamera() {
        if (!scene || !avatarNode.value) return;
        const node = avatarNode.value;
        const cam = new ArcRotateCamera(
            "avatar-cam",
            cameraOrientation.value.alpha,
            cameraOrientation.value.beta,
            cameraOrientation.value.radius,
            new Vector3(
                node.position.x,
                node.position.y + capsuleHeight.value / 2,
                node.position.z,
            ),
            scene,
        );
        camera.value = cam;
        cam.attachControl(scene.getEngine().getRenderingCanvas(), true);
        scene.activeCamera = cam;
        cam.onViewMatrixChangedObservable.add(() => {
            cameraOrientation.value = {
                alpha: cam.alpha,
                beta: cam.beta,
                radius: cam.radius,
            };
            throttledUpdate();
        });
    }

    // Apply updates to the camera from a remote orientation
    function updateCameraFromMeta(meta: CameraOrientation) {
        if (camera.value && avatarNode.value) {
            // apply remote orientation
            camera.value.alpha = meta.alpha;
            camera.value.beta = meta.beta;
            camera.value.radius = meta.radius;
            // reposition camera target to follow the avatar
            const node = avatarNode.value;
            camera.value.setTarget(
                new Vector3(
                    node.position.x,
                    node.position.y + capsuleHeight.value / 2,
                    node.position.z,
                ),
            );
        }
    }

    // Clean up on unmount
    onUnmounted(() => {
        camera.value?.dispose();
    });

    return {
        camera,
        setupCamera,
        updateCameraFromMeta,
    };
}
