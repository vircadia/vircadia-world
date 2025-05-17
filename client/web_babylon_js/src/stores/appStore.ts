import { defineStore } from "pinia";
import type {
    BabylonModelDefinition,
    BabylonAnimationDefinition,
} from "../composables/types";

export const useAppStore = defineStore("app", {
    state: () => ({
        // global loading indicator
        loading: false as boolean,
        // global error message
        error: null as string | null,
        // model definitions for environments
        modelDefinitions: [
            {
                fileName: "babylon.level.glb",
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0, w: 1 },
                throttleInterval: 10,
                enablePhysics: true,
                physicsType: "mesh",
                physicsOptions: {
                    mass: 0,
                    friction: 0.5,
                    restitution: 0.3,
                },
            },
        ] as BabylonModelDefinition[],
        // HDR environment list
        hdrList: ["babylon.level.hdr.1k.hdr"] as string[],
        // avatar configuration
        avatarDefinition: {
            entityName: "physics.avatar.entity",
            modelFileName: "babylon.avatar.glb",
            initialPosition: { x: 0, y: 1, z: -5 },
            initialRotation: { x: 0, y: 0, z: 0, w: 1 },
            initialCameraOrientation: {
                alpha: -Math.PI / 2,
                beta: Math.PI / 3,
                radius: 5,
            },
            throttleInterval: 500,
            capsuleHeight: 1.8,
            capsuleRadius: 0.3,
            slopeLimit: 45,
            jumpSpeed: 5,
            animations: [
                {
                    fileName: "babylon.avatar.animation.idle.1.glb",
                    loop: true,
                    // groupNames: ["idle02_Armature", "idle02_Armature.001"],
                },
            ] as BabylonAnimationDefinition[],
        },
    }),
    getters: {
        // whether an error is set
        hasError: (state): boolean => state.error !== null,
    },
    actions: {
        // set the loading flag
        setLoading(value: boolean) {
            this.loading = value;
        },
        // set a global error message
        setError(message: string | null) {
            this.error = message;
        },
        // clear the error
        clearError() {
            this.error = null;
        },
    },
});
