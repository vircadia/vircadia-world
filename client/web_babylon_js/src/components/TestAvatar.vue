<template>
  <!-- TestAvatar: no visual output, model and animation will be loaded on mount -->
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import type { Scene } from "@babylonjs/core";
import { TransformNode, ImportMeshAsync } from "@babylonjs/core";
import { useAsset } from "@vircadia/world-sdk/browser/vue";
import "@babylonjs/loaders/glTF";
import { SkeletonViewer } from "@babylonjs/core/Debug";
import { VertexBuffer } from "@babylonjs/core";

const props = defineProps({
    scene: { type: Object as () => Scene, required: true },
});

const modelFile = ref("babylon.avatar.glb");
const modelAsset = useAsset({
    fileName: modelFile,
    useCache: true,
    debug: true,
    instance: undefined,
});

const animFile = ref("babylon.avatar.animation.idle.1.glb");
const animAsset = useAsset({
    fileName: animFile,
    useCache: true,
    debug: true,
    instance: undefined,
});

onMounted(async () => {
    console.info(
        "[TestAvatar] onMounted start",
        "maxVertexUniformVectors:",
        props.scene.getEngine().getCaps().maxVertexUniformVectors,
    );
    console.log("[TestAvatar] Loading model asset:", modelFile.value);
    // Load model asset
    await modelAsset.executeLoad();
    console.log("[TestAvatar] Model asset loaded");
    const modelUrl = modelAsset.assetData.value?.blobUrl;
    console.log("[TestAvatar] modelUrl:", modelUrl?.slice(0, 100));
    const modelExt = modelAsset.fileExtension.value;
    console.log("[TestAvatar] modelExt:", modelExt);
    if (!modelUrl) {
        console.warn("TestAvatar: Model blob URL not available");
        return;
    }

    // Import model meshes and skeleton
    console.log(
        "[TestAvatar] Importing model meshes and skeleton with URL:",
        modelUrl.slice(0, 100),
    );
    const modelResult = await ImportMeshAsync(modelUrl, props.scene, {
        pluginExtension: modelExt,
    });
    console.log(
        "[TestAvatar] modelResult meshes count:",
        modelResult.meshes.length,
        "skeletons count:",
        modelResult.skeletons.length,
    );
    const root = new TransformNode("testModelRoot", props.scene);
    console.log("[TestAvatar] Created root TransformNode:", root.name);

    // Parent all top-level meshes under our pivot so the entire imported hierarchy stays intact
    const rootMeshes = modelResult.meshes.filter((mesh) => !mesh.parent);
    if (rootMeshes.length > 0) {
        for (const mesh of rootMeshes) {
            mesh.setParent(root, true, true);
            console.log(
                "[TestAvatar] parented mesh to testModelRoot:",
                mesh.name,
            );
        }
    } else {
        console.warn(
            "[TestAvatar] no root meshes found, imported scene may already be correctly positioned",
        );
    }

    // Get list of skinned meshes from the model that have a skeleton
    const modelSkinnedMeshes = modelResult.meshes.filter(
        (mesh) => mesh.skeleton,
    );
    console.log(
        "[TestAvatar] found skinned meshes:",
        modelSkinnedMeshes.map((m) => m.name),
    );

    // Store reference to original model skeleton (we'll dispose it later)
    const originalModelSkeleton = modelResult.skeletons[0];
    console.log(
        "[TestAvatar] original model skeleton:",
        originalModelSkeleton?.name,
        "with id",
        originalModelSkeleton?.id,
        "bones:",
        originalModelSkeleton?.bones.map((b) => b.name),
    );

    // Ensure each skinned mesh has enough bone influencers
    for (const mesh of modelSkinnedMeshes) {
        mesh.numBoneInfluencers = Math.max(mesh.numBoneInfluencers, 4);
    }

    // Load animation asset
    console.log("[TestAvatar] Loading animation asset:", animFile.value);
    await animAsset.executeLoad();
    console.log("[TestAvatar] Animation asset loaded");
    const animUrl = animAsset.assetData.value?.blobUrl;
    console.log("[TestAvatar] animUrl:", animUrl?.slice(0, 100));
    const animExt = animAsset.fileExtension.value;
    console.log("[TestAvatar] animExt:", animExt);
    if (!animUrl) {
        console.warn("TestAvatar: Animation blob URL not available");
        return;
    }

    // Import animation meshes, skeleton, and animation groups
    console.log(
        "[TestAvatar] Importing animation meshes and skeleton with URL:",
        animUrl.slice(0, 100),
    );
    const animResult = await ImportMeshAsync(animUrl, props.scene, {
        pluginExtension: animExt,
    });
    console.log(
        "[TestAvatar] animResult meshes count:",
        animResult.meshes.length,
        "skeletons count:",
        animResult.skeletons.length,
        "animationGroups count:",
        animResult.animationGroups.length,
    );

    // STRATEGY 3: Retarget animation to model skeleton via clone
    console.log(
        "[TestAvatar] Retargeting animation to model skeleton via clone",
    );
    const animGroup = animResult.animationGroups[0];
    animGroup.stop();
    const modelTransforms = root.getChildTransformNodes(false);
    const clonedGroup = animGroup.clone("retargeted", (oldTarget) => {
        const target = modelTransforms.find(
            (node) => node.name === oldTarget.name,
        );
        if (!target) {
            console.warn(
                `[TestAvatar] No retarget target for ${oldTarget.name}`,
            );
        }
        return target;
    });
    clonedGroup.start(true, 1.0);
    clonedGroup.loopAnimation = true;

    // Visualize the skeleton on a skinned mesh
    const skinnedMesh = modelSkinnedMeshes[0];
    if (skinnedMesh && originalModelSkeleton) {
        const viewer = new SkeletonViewer(
            originalModelSkeleton,
            skinnedMesh,
            props.scene,
        );
        viewer.isEnabled = true;
        console.log(
            "[TestAvatar] Enabled skeleton viewer for:",
            originalModelSkeleton.name,
        );
    }
});
</script> 