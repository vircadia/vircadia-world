<template>
    <slot :environmentInitialized="environmentInitialized" :physicsEnabled="physicsEnabled"
        :physicsPluginName="physicsPluginName" :physicsError="physicsError" :gravity="gravity"
        :physicsEngineType="physicsEngineType" :physicsInitialized="physicsInitialized"
        :havokInstanceLoaded="!!havokInstance" :physicsPluginCreated="!!physicsPlugin"></slot>
</template>
<script setup lang="ts">
import { ref, watch, toRef, computed, type Ref } from "vue";
import {
    HDRCubeTexture,
    type Scene,
    Vector3,
    HemisphericLight,
    DirectionalLight,
    MeshBuilder,
    StandardMaterial,
    Color3,
    PhysicsAggregate,
    PhysicsShapeType,
    type PhysicsEngine,
} from "@babylonjs/core";
import { HavokPlugin } from "@babylonjs/core/Physics/v2/Plugins/havokPlugin";
import HavokPhysics from "@babylonjs/havok";
import type { VircadiaWorldInstance } from "@/components/VircadiaWorldProvider.vue";
import type {
    HemisphericLightOptions,
    DirectionalLightOptions,
    GroundOptions,
} from "@schemas";

type LightVector = [number, number, number];

// Environment interfaces now imported from @schemas

const props = withDefaults(
    defineProps<{
        scene: Scene;
        vircadiaWorld: VircadiaWorldInstance;
        hdrFiles: string[];
        // defaults configuration
        enableDefaults?: boolean;
        enablePhysics?: boolean;
        gravity?: LightVector;
        hemisphericLight?: HemisphericLightOptions;
        directionalLight?: DirectionalLightOptions;
        ground?: GroundOptions;
    }>(),
    {
        enableDefaults: true,
        enablePhysics: true,
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
const hdrFilesRef = toRef(props, "hdrFiles");

// Flag that marks when default lights and ground have been created (if enabled)
const defaultsReady = ref(false);
const physicsError = ref<string | null>(null);
// Reactive trigger to force re-evaluation of computed properties after physics init
const physicsInitialized = ref(false);
// Environment is considered initialized after defaults (lights/ground) are created, regardless of physics
// If defaults are disabled, consider environment initialized once defaults phase has been processed
const environmentInitialized = computed<boolean>(() => {
    return defaultsReady.value || props.enableDefaults === false;
});
const physicsEnabled = computed<boolean>(() => {
    // Force re-evaluation when physicsInitialized changes
    const initialized = physicsInitialized.value;

    const s = sceneRef.value;
    if (!s) {
        console.log("[BabylonEnvironment] Physics status check: scene is null");
        return false;
    }

    // Cast to Scene with physics methods
    const sceneWithPhysics = s as Scene & {
        getPhysicsEngine?: () => PhysicsEngine | null;
        isPhysicsEnabled?: () => boolean;
    };

    // Debug logging to help diagnose physics status
    const hasGetPhysicsEngine =
        typeof sceneWithPhysics.getPhysicsEngine === "function";
    const hasIsPhysicsEnabled =
        typeof sceneWithPhysics.isPhysicsEnabled === "function";
    const physicsEngine = hasGetPhysicsEngine
        ? sceneWithPhysics.getPhysicsEngine()
        : null;
    const isPhysicsEnabledResult = hasIsPhysicsEnabled
        ? sceneWithPhysics.isPhysicsEnabled()
        : false;

    console.log("[BabylonEnvironment] Physics status check:", {
        sceneExists: true,
        hasGetPhysicsEngine,
        hasIsPhysicsEnabled,
        physicsEngine: !!physicsEngine,
        isPhysicsEnabledResult,
        physicsEngineType: physicsEngine
            ? physicsEngine.constructor.name
            : "none",
        physicsPluginName: physicsEngine?.getPhysicsPluginName?.() || "none",
        physicsInitializedFlag: initialized,
    });

    return !!physicsEngine || isPhysicsEnabledResult;
});
const physicsPluginName = computed<string>(() => {
    const s = sceneRef.value as unknown as {
        getPhysicsEngine?: () => unknown;
    } | null;
    const engineAny = (s?.getPhysicsEngine?.() ?? null) as unknown as {
        getPhysicsPluginName?: () => string | undefined;
    } | null;
    return engineAny?.getPhysicsPluginName?.() || (engineAny ? "Havok" : "");
});

const physicsEngineType = computed<string>(() => {
    const s = sceneRef.value as unknown as { getPhysicsEngine?: () => unknown } | null;
    const engine = s?.getPhysicsEngine?.();
    // Best-effort: constructor name is informative across plugins
    return engine && (engine as { constructor?: { name?: string } }).constructor?.name
        ? (engine as { constructor: { name: string } }).constructor.name
        : "";
});

let havokInstance: unknown | null = null;
let physicsPlugin: HavokPlugin | null = null;

function toVec3(v: LightVector | undefined, fallback: Vector3): Vector3 {
    if (!v || v.length !== 3) return fallback;
    return new Vector3(v[0], v[1], v[2]);
}

async function initializePhysicsIfNeeded(targetScene: Scene) {
    console.log("[BabylonEnvironment] initializePhysicsIfNeeded called", {
        enablePhysics: props.enablePhysics,
        sceneExists: !!targetScene,
        currentPhysicsEngine: !!targetScene.getPhysicsEngine?.(),
    });

    if (props.enablePhysics === false) {
        console.log("[BabylonEnvironment] Physics is disabled by prop");
        return;
    }

    // Check if physics is already initialized
    if (targetScene.getPhysicsEngine?.()) {
        console.log(
            "[BabylonEnvironment] Physics already initialized, skipping",
        );
        physicsInitialized.value = true;
        return;
    }

    try {
        physicsError.value = null;

        if (!havokInstance) {
            console.log(
                "[BabylonEnvironment] Initializing Havok physics module",
            );
            havokInstance = await HavokPhysics();
            console.log(
                "[BabylonEnvironment] Havok module loaded",
                !!havokInstance,
            );
        }

        if (!physicsPlugin) {
            console.log("[BabylonEnvironment] Creating Havok physics plugin");
            physicsPlugin = new HavokPlugin(true, havokInstance);
            console.log(
                "[BabylonEnvironment] Havok plugin created",
                !!physicsPlugin,
            );
        }

        const gravityVector = toVec3(props.gravity, new Vector3(0, -9.81, 0));
        console.log(
            "[BabylonEnvironment] Calling scene.enablePhysics with gravity:",
            gravityVector.toString(),
        );

        targetScene.enablePhysics(gravityVector, physicsPlugin);

        // Check immediately after enabling
        const engineAfter = targetScene.getPhysicsEngine?.();
        console.info("[BabylonEnvironment] Physics enabled (Havok)", {
            engineExists: !!engineAfter,
            engineType: engineAfter ? engineAfter.constructor.name : "none",
            pluginName: engineAfter?.getPhysicsPluginName?.(),
        });

        // Set the flag to trigger computed property re-evaluation
        physicsInitialized.value = true;
    } catch (error: unknown) {
        console.error(
            "[BabylonEnvironment] Error initializing physics:",
            error,
        );
        try {
            const err = error as { message?: string } | string;
            physicsError.value =
                (typeof err === "string" ? err : err?.message) || "";
        } catch {
            physicsError.value = "Unknown physics init error";
        }
        // Derived flags will reflect actual engine state
    }
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

// TODO: Make it a SINGLE HDR.
async function loadHdrFiles(scene: Scene) {
    const hdrFiles = hdrFilesRef.value;
    if (!hdrFiles) {
        console.error("[BabylonEnvironment] hdrFiles not provided");
        return;
    }
    for (const fileName of hdrFiles) {
        const { url, revoke } = await vircadiaRef.value.client.fetchAssetAsBabylonUrl(fileName);
        const hdr = new HDRCubeTexture(
            url,
            scene,
            512,
            false,
            true,
            false,
            true,
        );
        await new Promise<void>((resolve) => hdr.onLoadObservable.addOnce(() => resolve()));
        // After the HDR texture has loaded, revoke the object URL if provided
        try { revoke?.(); } catch { }
        scene.environmentTexture = hdr;
        scene.environmentIntensity = 1.2;
        scene.createDefaultSkybox(hdr, true, 1000);
    }
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
    if (!hdrFilesRef.value || hdrFilesRef.value.length === 0) {
        console.error(
            "[BabylonEnvironment] hdrFiles not provided",
        );
        return;
    }
    // Prevent concurrent loads
    if (environmentInitialized.value) {
        console.log("[BabylonEnvironment] Already loading or loaded, skipping");
        return;
    }

    try {
        await initializePhysicsIfNeeded(scene);
        // Wait up to ~1s for the physics engine to be fully ready before creating ground
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
        await loadHdrFiles(scene);
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
        hdrFiles: hdrFilesRef.value?.length ?? 0,
    }),
    ({ scene }) => {
        if (scene && hdrFilesRef.value) {
            void loadAll(scene);
        }
    },
    { immediate: true },
);

// TODO: Move physics into its own component.
// Manual physics check function for debugging
function checkPhysicsStatus() {
    const s = sceneRef.value;
    const engine = s?.getPhysicsEngine?.();
    const status = {
        sceneExists: !!s,
        hasGetPhysicsEngine: typeof s?.getPhysicsEngine === "function",
        engineExists: !!engine,
        engineType: engine ? engine.constructor.name : "none",
        pluginName: engine?.getPhysicsPluginName?.() || "none",
        havokInstanceLoaded: !!havokInstance,
        physicsPluginCreated: !!physicsPlugin,
        enablePhysicsProp: props.enablePhysics,
        physicsError: physicsError.value,
        physicsInitializedFlag: physicsInitialized.value,
        physicsEnabledComputed: physicsEnabled.value,
    };
    console.log("[BabylonEnvironment] Manual physics status check:", status);
    return status;
}

defineExpose({
    physicsError,
    physicsEnabled,
    physicsPluginName,
    physicsEngineType,
    checkPhysicsStatus,
    initializePhysicsIfNeeded,
});
</script>
