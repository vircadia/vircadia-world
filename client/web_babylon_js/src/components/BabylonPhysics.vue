<template>
    <slot :physicsEnabled="physicsEnabled" :physicsPluginName="physicsPluginName" :physicsError="physicsError"
        :gravity="gravity" :physicsEngineType="physicsEngineType" :physicsInitialized="physicsInitialized"
        :havokInstanceLoaded="!!havokInstance" :physicsPluginCreated="!!physicsPlugin"></slot>
</template>
<script setup lang="ts">
import type { Scene } from "@babylonjs/core";
import { Vector3 } from "@babylonjs/core";
import { HavokPlugin } from "@babylonjs/core/Physics/v2/Plugins/havokPlugin";
import HavokPhysics from "@babylonjs/havok";
import { computed, ref, toRef, watch } from "vue";
import "@babylonjs/core/Physics/v2/physicsEngineComponent";
import type { VircadiaWorldInstance } from "@/components/VircadiaWorldProvider.vue";

type LightVector = [number, number, number];

const props = withDefaults(
    defineProps<{
        scene: Scene;
        vircadiaWorld: VircadiaWorldInstance;
        gravity: LightVector;
        enablePhysics?: boolean;
    }>(),
    {
        enablePhysics: true,
    },
);

const sceneRef = toRef(props, "scene");
const gravityRef = toRef(props, "gravity");

const physicsError = ref<string | null>(null);
const physicsInitialized = ref(false);

let havokInstance: unknown | null = null;
let physicsPlugin: HavokPlugin | null = null;

function toVec3(v: LightVector | undefined, fallback: Vector3): Vector3 {
    if (!v || v.length !== 3) return fallback;
    return new Vector3(v[0], v[1], v[2]);
}

async function initializePhysicsIfNeeded(targetScene: Scene) {
    if (props.enablePhysics === false) return;

    if (targetScene.getPhysicsEngine?.()) {
        physicsInitialized.value = true;
        return;
    }

    try {
        physicsError.value = null;

        if (!havokInstance) {
            havokInstance = await HavokPhysics();
        }

        if (!physicsPlugin) {
            physicsPlugin = new HavokPlugin(true, havokInstance);
        }

        const gravityVector = toVec3(
            gravityRef.value,
            new Vector3(0, -9.81, 0),
        );
        targetScene.enablePhysics(gravityVector, physicsPlugin);

        // Wait briefly for the engine to attach before flagging initialized
        let tries = 0;
        while (!targetScene.getPhysicsEngine?.() && tries < 20) {
            await new Promise((r) => setTimeout(r, 50));
            tries++;
        }
        const engine = targetScene.getPhysicsEngine?.();
        if (engine) {
            physicsInitialized.value = true;
        } else {
            physicsError.value = "Physics engine not available after enable";
            physicsInitialized.value = false;
        }
    } catch (error: unknown) {
        try {
            const err = error as { message?: string } | string;
            physicsError.value =
                (typeof err === "string" ? err : err?.message) || "";
        } catch {
            physicsError.value = "Unknown physics init error";
        }
    }
}

const physicsEnabled = computed<boolean>(() => {
    // Force recomputation when initialization flag changes (engine is non-reactive)
    const initialized = physicsInitialized.value;
    const s = sceneRef.value;
    if (!s) return false;
    const sceneWithPhysics = s as Scene & {
        getPhysicsEngine?: () => unknown | null;
        isPhysicsEnabled?: () => boolean;
    };
    const engine = sceneWithPhysics.getPhysicsEngine?.() ?? null;
    const isEnabled = sceneWithPhysics.isPhysicsEnabled?.() ?? false;
    return !!engine || isEnabled;
});

const physicsPluginName = computed<string>(() => {
    const initialized = physicsInitialized.value;
    const s = sceneRef.value as unknown as {
        getPhysicsEngine?: () => unknown;
    } | null;
    const engineAny = (s?.getPhysicsEngine?.() ?? null) as unknown as {
        getPhysicsPluginName?: () => string | undefined;
    } | null;
    return engineAny?.getPhysicsPluginName?.() || (engineAny ? "Havok" : "");
});

const physicsEngineType = computed<string>(() => {
    const initialized = physicsInitialized.value;
    const s = sceneRef.value as unknown as {
        getPhysicsEngine?: () => unknown;
    } | null;
    const engine = s?.getPhysicsEngine?.();
    return engine &&
        (engine as { constructor?: { name?: string } }).constructor?.name
        ? (engine as { constructor: { name: string } }).constructor.name
        : "";
});

watch(
    () => ({ scene: sceneRef.value, gravity: gravityRef.value }),
    ({ scene }) => {
        if (scene) {
            void initializePhysicsIfNeeded(scene);
        }
    },
    { immediate: true },
);

const havokInstanceLoaded = computed<boolean>(() => !!havokInstance);
const physicsPluginCreated = computed<boolean>(() => !!physicsPlugin);

defineExpose({
    physicsError,
    physicsEnabled,
    physicsPluginName,
    physicsEngineType,
    physicsInitialized,
    havokInstanceLoaded,
    physicsPluginCreated,
    gravity: gravityRef,
});
</script>
