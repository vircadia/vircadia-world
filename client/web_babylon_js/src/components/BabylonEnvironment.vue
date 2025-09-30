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

type GravityVector = [number, number, number];

// Environment interfaces now imported from @schemas

const props = defineProps<{
    scene: Scene;
    vircadiaWorld: VircadiaWorldInstance;
    hdrFile: string;
    // configuration (required; pass from MainScene)
    enableDefaults: boolean;
    gravity: GravityVector;
    hemisphericLight: HemisphericLightOptions;
    directionalLight: DirectionalLightOptions;
    ground: GroundOptions;
}>();

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

function toVec3OrWarn(v: GravityVector | undefined, label: string): Vector3 {
    if (!v || v.length !== 3) {
        console.warn(
            `[BabylonEnvironment] Missing or invalid vector for ${label}; using Vector3.Zero()`,
        );
        return Vector3.Zero();
    }
    return new Vector3(v[0], v[1], v[2]);
}

function addDefaultLightsIfNeeded(targetScene: Scene) {
    if (props.enableDefaults === false) return;
    const hemiOpts = props.hemisphericLight;
    const dirOpts = props.directionalLight;

    if (hemiOpts.enabled !== false) {
        const hemi = new HemisphericLight(
            "env-hemispheric",
            toVec3OrWarn(
                hemiOpts.direction,
                "hemisphericLight.direction",
            ),
            targetScene,
        );
        if (typeof hemiOpts.intensity === "number") {
            hemi.intensity = hemiOpts.intensity;
        }
    }

    if (dirOpts.enabled !== false) {
        const dir = new DirectionalLight(
            "env-directional",
            toVec3OrWarn(dirOpts.direction, "directionalLight.direction"),
            targetScene,
        );
        dir.position = toVec3OrWarn(
            dirOpts.position,
            "directionalLight.position",
        );
        if (typeof dirOpts.intensity === "number") {
            dir.intensity = dirOpts.intensity;
        }
    }
}

function addGroundIfNeeded(targetScene: Scene) {
    if (props.enableDefaults === false) return;
    const g = props.ground;
    if (g.enabled === false) return;

    if (typeof g.width !== "number" || typeof g.height !== "number") {
        console.error(
            "[BabylonEnvironment] ground.width and ground.height are required",
        );
        return;
    }

    const ground = MeshBuilder.CreateGround(
        "env-ground",
        { width: g.width, height: g.height },
        targetScene,
    );
    if (g.position) {
        ground.position = toVec3OrWarn(g.position, "ground.position");
    }

    const mat = new StandardMaterial("env-ground-material", targetScene);
    if (g.diffuseColor) {
        mat.diffuseColor = new Color3(
            g.diffuseColor[0],
            g.diffuseColor[1],
            g.diffuseColor[2],
        );
    }
    if (g.specularColor) {
        mat.specularColor = new Color3(
            g.specularColor[0],
            g.specularColor[1],
            g.specularColor[2],
        );
    }
    ground.material = mat;

    // Attach physics aggregate based on the scene engine directly to avoid races
    const engine = targetScene.getPhysicsEngine?.();
    if (engine) {
        try {
            const physOptions: Record<string, number> = {};
            if (typeof g.mass === "number") physOptions.mass = g.mass;
            if (typeof g.friction === "number") physOptions.friction = g.friction;
            if (typeof g.restitution === "number")
                physOptions.restitution = g.restitution;
            const aggregate = new PhysicsAggregate(
                ground,
                PhysicsShapeType.BOX,
                physOptions as unknown as {
                    mass: number;
                    friction: number;
                    restitution: number;
                },
                targetScene,
            );
            void aggregate; // prevent unused warning in some toolchains
            console.log(
                "[BabylonEnvironment] Default ground physics attached",
                {
                    mass: g.mass,
                    friction: g.friction,
                    restitution: g.restitution,
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
defineExpose({ environmentInitialized });
</script>
