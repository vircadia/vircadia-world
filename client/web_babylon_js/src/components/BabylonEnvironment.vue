<template>
    <slot :isLoading="isLoading"></slot>
    
    
</template>
<script setup lang="ts">
import { ref, watch, toRef } from "vue";
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
    HavokPlugin,
} from "@babylonjs/core";
import { useAsset } from "@vircadia/world-sdk/browser/vue";
import type { useVircadia } from "@vircadia/world-sdk/browser/vue";

type LightVector = [number, number, number];

interface HemisphericLightOptions {
    enabled?: boolean;
    direction?: LightVector;
    intensity?: number;
}

interface DirectionalLightOptions {
    enabled?: boolean;
    direction?: LightVector;
    position?: LightVector;
    intensity?: number;
}

interface GroundOptions {
    enabled?: boolean;
    width?: number;
    height?: number;
    position?: LightVector;
    diffuseColor?: [number, number, number];
    specularColor?: [number, number, number];
    mass?: number;
    friction?: number;
    restitution?: number;
}

const props = withDefaults(
    defineProps<{
        scene: Scene;
        vircadiaWorld: ReturnType<typeof useVircadia>;
        environmentEntityName: string;
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
const envEntityNameRef = toRef(props, "environmentEntityName");

const isLoading = ref(false);
const hasLoaded = ref(false);
const defaultsInitialized = ref(false);

let havokInstance: unknown | null = null;
let physicsPlugin: HavokPlugin | null = null;

function toVec3(v: LightVector | undefined, fallback: Vector3): Vector3 {
    if (!v || v.length !== 3) return fallback;
    return new Vector3(v[0], v[1], v[2]);
}

async function initializePhysicsIfNeeded(targetScene: Scene) {
    if (props.enablePhysics === false) return;
    try {
        if (!havokInstance) {
            const HavokPhysics = (await import("@babylonjs/havok")).default;
            havokInstance = await HavokPhysics();
        }
        if (!physicsPlugin) {
            physicsPlugin = new HavokPlugin(true, havokInstance);
        }
        const gravityVector = toVec3(props.gravity, new Vector3(0, -9.81, 0));
        targetScene.enablePhysics(gravityVector, physicsPlugin);
    } catch (error) {
        console.error(
            "[BabylonEnvironment] Error initializing physics:",
            error,
        );
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

    new PhysicsAggregate(
        ground,
        PhysicsShapeType.BOX,
        {
            mass: g.mass ?? 0,
            friction: g.friction ?? 0.5,
            restitution: g.restitution ?? 0.3,
        },
        targetScene,
    );
}

async function initializeDefaults(targetScene: Scene) {
    if (defaultsInitialized.value) return;
    if (!props.enableDefaults && !props.enablePhysics) return;
    await initializePhysicsIfNeeded(targetScene);
    addDefaultLightsIfNeeded(targetScene);
    addGroundIfNeeded(targetScene);
    defaultsInitialized.value = true;
}

async function loadHdrFiles(
    scene: Scene,
    instance: ReturnType<typeof useVircadia>,
    hdrFiles: string[],
) {
    for (const fileName of hdrFiles) {
        const asset = useAsset({
            fileName: ref(fileName),
            instance,
            useCache: true,
        });
        await asset.executeLoad();
        const url = asset.assetData.value?.blobUrl;
        if (!url)
            throw new Error(`[BabylonEnvironment] Failed to load ${fileName}`);

        const hdr = new HDRCubeTexture(
            url,
            scene,
            512,
            false,
            true,
            false,
            true,
        );
        await new Promise<void>((resolve) =>
            hdr.onLoadObservable.addOnce(() => resolve()),
        );

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
    if (!envEntityNameRef.value) {
        console.error(
            "[BabylonEnvironment] environmentEntityName not provided",
        );
        return;
    }
    if (isLoading.value) {
        return;
    }

    isLoading.value = true;
    try {
        await initializeDefaults(scene);
        // Fetch all metadata for this environment entity
        const instance = vircadiaRef.value;
        if (!instance) {
            console.error("[BabylonEnvironment] Vircadia instance missing");
            return;
        }
        const metadataResult = await instance.client.Utilities.Connection.query(
            {
                query: "SELECT metadata__key, metadata__value FROM entity.entity_metadata WHERE general__entity_name = $1",
                parameters: [envEntityNameRef.value],
            },
        );

        const metadataMap = new Map<string, unknown>();
        if (Array.isArray(metadataResult.result)) {
            for (const row of metadataResult.result) {
                metadataMap.set(
                    row.metadata__key as string,
                    row.metadata__value as unknown,
                );
            }
        }

        const entityType = metadataMap.get("type");
        if (entityType !== "Environment") {
            console.warn(
                `[BabylonEnvironment] Entity '${envEntityNameRef.value}' is not of type 'Environment' (type=${String(entityType)})`,
            );
        }

        const hdrFilesMeta = metadataMap.get("hdrFiles");
        const hdrFiles = Array.isArray(hdrFilesMeta)
            ? (hdrFilesMeta as unknown[]).filter(
                  (v): v is string => typeof v === "string",
              )
            : [];
        if (hdrFiles.length === 0) {
            console.warn(
                `[BabylonEnvironment] No hdrFiles defined for '${envEntityNameRef.value}'`,
            );
        }

        await loadHdrFiles(scene, instance, hdrFiles);
        hasLoaded.value = true;
    } catch (e) {
        console.error(e);
    } finally {
        isLoading.value = false;
    }
}

// Automatically load once when scene, vircadia, and entity are available
watch(
    () => ({
        scene: sceneRef.value,
        v: vircadiaRef.value,
        name: envEntityNameRef.value,
    }),
    ({ scene }) => {
        if (
            scene &&
            vircadiaRef.value &&
            envEntityNameRef.value &&
            !hasLoaded.value
        ) {
            void loadAll(scene);
        }
    },
    { immediate: true, deep: true },
);

defineExpose({ isLoading, loadAll, initializeDefaults });
</script>
