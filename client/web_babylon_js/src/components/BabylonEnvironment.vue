<template>
    <slot :environmentInitialized="environmentInitialized"></slot>

</template>
<script setup lang="ts">
import {
    Color3,
    DirectionalLight,
    HDRCubeTexture,
    HemisphericLight,
    MeshBuilder,
    PhysicsAggregate,
    PhysicsShapeType,
    type Scene,
    StandardMaterial,
    Vector3,
} from "@babylonjs/core";
import type {
    DirectionalLightOptions,
    GroundOptions,
    HemisphericLightOptions,
} from "@schemas";
import { computed, type Ref, ref, toRef, watch } from "vue";
import type { VircadiaWorldInstance } from "@/components/VircadiaWorldProvider.vue";

type LightVector = [number, number, number];

// Environment interfaces now imported from @schemas

const props = withDefaults(
    defineProps<{
        scene: Scene;
        vircadiaWorld: VircadiaWorldInstance;
        hdrFile: string;
        // defaults configuration
        enableDefaults?: boolean;
        gravity?: LightVector;
        hemisphericLight?: HemisphericLightOptions;
        directionalLight?: DirectionalLightOptions;
        ground?: GroundOptions;
    }>(),
    {
        enableDefaults: true,
        gravity: () => [0, -9.81, 0],
        hemisphericLight: () => ({
            enabled: true,
            direction: [1, 1, 0],
            intensity: 1.0,
        }),
        directionalLight: () => ({
            enabled: true,
            direction: [-1, -2, -1],
            position: [10, 10, 10],
            intensity: 1.0,
        }),
        ground: () => ({
            enabled: true,
            width: 1000,
            height: 1000,
            position: [0, -1, 0],
            diffuseColor: [0.2, 0.2, 0.2],
            specularColor: [0.1, 0.1, 0.1],
            mass: 0,
            friction: 0.5,
            restitution: 0.3,
        }),
    },
);

const sceneRef = toRef(props, "scene");
const vircadiaRef = toRef(props, "vircadiaWorld");
const hdrFileRef = toRef(props, "hdrFile");

// Flag that marks when default lights and ground have been created (if enabled)
const defaultsReady = ref(false);
// Environment is considered initialized after defaults (lights/ground) are created
// If defaults are disabled, consider environment initialized once defaults phase has been processed
const environmentInitialized = computed<boolean>(() => {
    return defaultsReady.value || props.enableDefaults === false;
});

function toVec3(v: LightVector | undefined, fallback: Vector3): Vector3 {
    if (!v || v.length !== 3) return fallback;
    return new Vector3(v[0], v[1], v[2]);
}

function addDefaultLightsIfNeeded(targetScene: Scene) {
    if (props.enableDefaults === false) return;
    const hemiOpts = props.hemisphericLight ?? {};
    const dirOpts = props.directionalLight ?? {};

    if (hemiOpts.enabled !== false) {
        const hemi = new HemisphericLight(
            "env-hemispheric",
            toVec3(hemiOpts.direction, new Vector3(1, 1, 0)),
            targetScene,
        );
        hemi.intensity = hemiOpts.intensity ?? 1.0;
    }

    if (dirOpts.enabled !== false) {
        const dir = new DirectionalLight(
            "env-directional",
            toVec3(dirOpts.direction, new Vector3(-1, -2, -1)),
            targetScene,
        );
        dir.position = toVec3(dirOpts.position, new Vector3(10, 10, 10));
        dir.intensity = dirOpts.intensity ?? 1.0;
    }
}

function addGroundIfNeeded(targetScene: Scene) {
    if (props.enableDefaults === false) return;
    const g = props.ground ?? {};
    if (g.enabled === false) return;

    const ground = MeshBuilder.CreateGround(
        "env-ground",
        { width: g.width ?? 1000, height: g.height ?? 1000 },
        targetScene,
    );
    ground.position = toVec3(g.position, new Vector3(0, -1, 0));

    const mat = new StandardMaterial("env-ground-material", targetScene);
    const diff = g.diffuseColor ?? [0.2, 0.2, 0.2];
    const spec = g.specularColor ?? [0.1, 0.1, 0.1];
    mat.diffuseColor = new Color3(diff[0], diff[1], diff[2]);
    mat.specularColor = new Color3(spec[0], spec[1], spec[2]);
    ground.material = mat;

    // Attach physics aggregate based on the scene engine directly to avoid races
    const engine = targetScene.getPhysicsEngine?.();
    if (engine) {
        try {
            const aggregate = new PhysicsAggregate(
                ground,
                PhysicsShapeType.BOX,
                {
                    mass: g.mass ?? 0,
                    friction: g.friction ?? 0.5,
                    restitution: g.restitution ?? 0.3,
                },
                targetScene,
            );
            void aggregate; // prevent unused warning in some toolchains
            console.log(
                "[BabylonEnvironment] Default ground physics attached",
                {
                    mass: g.mass ?? 0,
                    friction: g.friction ?? 0.5,
                    restitution: g.restitution ?? 0.3,
                    plugin: engine.getPhysicsPluginName?.(),
                },
            );
        } catch (e) {
            console.error(
                "[BabylonEnvironment] Failed to attach physics to default ground",
                e,
            );
        }
    } else {
        console.warn(
            "[BabylonEnvironment] Physics engine not present when creating ground; no physics body attached",
        );
    }
}

async function loadHdrFile(scene: Scene) {
    const fileName = hdrFileRef.value;
    if (!fileName) {
        console.error("[BabylonEnvironment] hdrFile not provided");
        return;
    }
    const { url } = await vircadiaRef.value.client.restAsset.assetGetByKey({
        key: fileName,
    });
    const hdr = new HDRCubeTexture(url, scene, 512, false, true, false, true);
    await new Promise<void>((resolve) =>
        hdr.onLoadObservable.addOnce(() => resolve()),
    );
    scene.environmentTexture = hdr;
    scene.environmentIntensity = 1.2;
    scene.createDefaultSkybox(hdr, true, 1000);
}

async function loadAll(scene: Scene) {
    if (!scene) {
        console.error("[BabylonEnvironment] Scene not found");
        return;
    }
    if (!vircadiaRef.value) {
        console.error("[BabylonEnvironment] Vircadia instance not provided");
        return;
    }
    if (!hdrFileRef.value) {
        console.error("[BabylonEnvironment] hdrFile not provided");
        return;
    }
    // Prevent concurrent loads
    if (environmentInitialized.value) {
        console.log("[BabylonEnvironment] Already loading or loaded, skipping");
        return;
    }

    try {
        // Wait up to ~1s for the physics engine (if any) to be fully ready before creating ground
        let tries = 0;
        while (!scene.getPhysicsEngine?.() && tries < 20) {
            await new Promise((r) => setTimeout(r, 50));
            tries++;
        }
        const enginePresent = !!scene.getPhysicsEngine?.();
        console.log(
            "[BabylonEnvironment] loadAll: engine present before defaults:",
            enginePresent,
        );
        // Create lights and ground now that physics engine is available
        addDefaultLightsIfNeeded(scene);
        addGroundIfNeeded(scene);
        // Mark defaults phase complete irrespective of physics
        defaultsReady.value = true;
        await loadHdrFile(scene);
    } catch (e) {
        console.error(e);
    } finally {
        defaultsReady.value = true;
    }
}

// Automatically load once when scene, vircadia, and entity are available
watch(
    () => ({
        scene: sceneRef.value,
        hdrFile: hdrFileRef.value,
    }),
    ({ scene }) => {
        if (scene && hdrFileRef.value) {
            void loadAll(scene);
        }
    },
    { immediate: true },
);

// Physics functionality moved to BabylonPhysics.vue
defineExpose({});
</script>
