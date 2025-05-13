import { defineStore } from "pinia";
import type { BabylonModelDefinition } from "../composables/useBabylonModel";

export const useAppStore = defineStore("app", {
    state: () => ({
        // global loading indicator
        loading: false as boolean,
        // global error message
        error: null as string | null,
        // model definitions for environments
        modelDefinitions: [
            {
                fileName: "babylon.level.test.glb",
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
        hdrList: ["babylon.level.test.hdr.1k.hdr"] as string[],
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
