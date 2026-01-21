<template>
    <slot :other-avatar-session-ids="otherAvatarSessionIds" :avatar-data-map="avatarDataMap"
        :position-data-map="positionDataMap" :rotation-data-map="rotationDataMap" :joint-data-map="jointDataMap"
        :chat-data-map="chatDataMap" />

    <!-- Render ChatBubbles for active avatars -->
    <template v-for="sessionId in otherAvatarSessionIds" :key="sessionId">
        <ChatBubble
            v-if="!loadingBySession[sessionId] && controllers.get(sessionId)?.avatarNode && chatDataMap[sessionId]"
            :scene="scene" :avatar-node="controllers.get(sessionId)!.avatarNode!" :messages="chatDataMap[sessionId]" />
    </template>
</template>

<script setup lang="ts">
import type {
    AvatarBaseData,
    AvatarJointMetadata,
    AvatarPositionData,
    AvatarRotationData,
    DebugData,
    DebugWindow,
} from "@schemas";
import {
    parseAvatarFrameMessage,
    parseAvatarJoint,
    parseAvatarPosition,
    parseAvatarRotation,
    type ChatMessage,
} from "@/schemas";
import { useInterval } from "@vueuse/core";
import { computed, onMounted, onUnmounted, ref, toRefs, watch, shallowReactive } from "vue";
import type { VircadiaWorldInstance } from "@/components/VircadiaWorldProvider.vue";
import {
    type AbstractMesh,
    Quaternion,
    type Scene,
    type Skeleton,
    Space,
    TransformNode,
    Vector3,
    ImportMeshAsync,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import ChatBubble from "./ChatBubble.vue";

const props = defineProps({
    scene: { type: Object as () => Scene, required: true },
    vircadiaWorld: {
        type: Object as () => VircadiaWorldInstance,
        required: true,
    },
    reflectSyncGroup: { type: String, required: true },
    reflectChannel: { type: String, required: true },
    entitySyncGroup: { type: String, required: true },
});
const { scene } = toRefs(props);

function ensure<T = unknown>(value: unknown, message: string): T {
    if (value == null) throw new Error(message);
    return value as T;
}

const vircadiaWorld = ensure<VircadiaWorldInstance>(
    props.vircadiaWorld,
    "Vircadia instance not found in BabylonOtherAvatars",
);

// State
const otherAvatarSessionIds = ref<string[]>([]);
const avatarDataMap = ref<Record<string, AvatarBaseData>>({});
const positionDataMap = ref<Record<string, AvatarPositionData>>({});
const rotationDataMap = ref<Record<string, AvatarRotationData>>({});
const jointDataMap = ref<Record<string, Map<string, AvatarJointMetadata>>>({});
const chatDataMap = ref<Record<string, ChatMessage[]>>({});

// Delivery timestamps for debug
const lastPollTimestamps = ref<Record<string, Date | null>>({});
const lastBasePollTimestamps = ref<Record<string, Date | null>>({});
const lastCameraPollTimestamps = ref<Record<string, Date | null>>({});

const discoveryStats = ref({
    lastDurationMs: 0,
    rows: 0,
    timeouts: 0,
    errors: 0,
    lastError: null as string | null,
    lastErrorAt: null as Date | null,
});

// Reflect stats for tracking frame reception
const reflectStats = ref({
    totalFrames: 0,
    badFrames: 0,
    lastFrameAt: null as Date | null,
    lastBadFrameAt: null as Date | null,
    lastBadFrameError: null as string | null,
    recentFrameTimes: [] as number[],
    avgFrameIntervalMs: 0,
});

// LERP Smoothing Configuration
const AVATAR_SMOOTH_FACTOR = 0.2;
const BONE_SMOOTH_FACTOR = 0.25;

// Helper types
type PositionObj = { x: number; y: number; z: number };
type RotationObj = { x: number; y: number; z: number; w: number };

function objToVector(obj: PositionObj): Vector3 {
    return new Vector3(obj.x, obj.y, obj.z);
}

function objToQuat(obj: RotationObj): Quaternion {
    return new Quaternion(obj.x, obj.y, obj.z, obj.w);
}

function adaptiveSmoothFactor(
    current: Vector3,
    target: Vector3,
    baseFactor: number,
): number {
    const distance = Vector3.Distance(current, target);
    if (distance > 2.0) return Math.min(0.5, baseFactor * 3);
    if (distance > 0.5) return Math.min(0.3, baseFactor * 2);
    return baseFactor;
}

// Avatar Controller Class
class AvatarController {
    public sessionId: string;
    public scene: Scene;
    public avatarNode: TransformNode | null = null;
    public meshes: AbstractMesh[] = [];
    public avatarSkeleton: Skeleton | null = null;
    public isModelLoaded = false;
    public modelFileName = "babylon.avatar.glb";
    public meshPivotPoint = "bottom";
    public capsuleHeight = 1.8;

    // Target transforms
    public targetPosition = new Vector3();
    public targetRotation = new Quaternion();
    public targetBoneTransforms = new Map<string, { position: Vector3; rotation: Quaternion; scale: Vector3 }>();

    constructor(sessionId: string, scene: Scene) {
        this.sessionId = sessionId;
        this.scene = scene;
    }

    public async loadModel(modelFileName: string) {
        if (this.isModelLoaded) return;
        this.modelFileName = modelFileName;

        try {
            const directUrl = this.buildDirectUrl(this.modelFileName);
            const result = await ImportMeshAsync(directUrl, this.scene, {
                pluginExtension: (() => {
                    const ext = this.modelFileName.split(".").pop()?.toLowerCase();
                    switch (ext) {
                        case "glb": return ".glb";
                        case "gltf": return ".gltf";
                        case "fbx": return ".fbx";
                        default: return "";
                    }
                })()
            });

            // Stop default animations
            if (result.animationGroups && result.animationGroups.length > 0) {
                for (const animGroup of result.animationGroups) {
                    animGroup.stop();
                    animGroup.dispose();
                }
            }

            this.avatarNode = new TransformNode(`otherAvatar_${this.sessionId}`, this.scene);

            // Initialize
            this.targetPosition = new Vector3(0, 0, 0);
            this.targetRotation = Quaternion.Identity();
            this.avatarNode.position = this.targetPosition.clone();
            this.avatarNode.rotationQuaternion = this.targetRotation.clone();

            this.meshes = result.meshes;

            const rootMeshes = result.meshes.filter((m) => !m.parent);
            for (const mesh of rootMeshes) {
                if (this.meshPivotPoint === "bottom") {
                    mesh.position.y = -this.capsuleHeight / 2;
                }
                mesh.parent = this.avatarNode;
            }

            if (result.skeletons.length > 0) {
                this.avatarSkeleton = result.skeletons[0];
                for (const mesh of result.meshes) {
                    if (mesh.skeleton === this.avatarSkeleton) {
                        mesh.skeleton = this.avatarSkeleton;
                    }
                }
            } else {
                console.warn("No skeletons found in import result");
                return;
            }

            if (this.avatarSkeleton) {
                for (const mesh of result.meshes.filter((m) => m.skeleton)) {
                    if ("numBoneInfluencers" in mesh) {
                        mesh.numBoneInfluencers = Math.max(mesh.numBoneInfluencers || 0, 4);
                    }
                }
                this.avatarSkeleton.prepare();
                this.avatarSkeleton.computeAbsoluteMatrices(true);
                for (const bone of this.avatarSkeleton.bones) {
                    bone.linkTransformNode(null);
                }
            }

            this.isModelLoaded = true;
            loadingBySession.value[this.sessionId] = false;

        } catch (error) {
            console.error(`Error loading other avatar model for session ${this.sessionId}:`, error);
            loadingBySession.value[this.sessionId] = false;
        }
    }

    private buildDirectUrl(fileName: string): string {
        if (fileName && (fileName.startsWith("http://") || fileName.startsWith("https://"))) {
            return fileName;
        }
        return vircadiaWorld.client.buildAssetRequestUrl(fileName);
    }

    public updateTargets(
        position: AvatarPositionData | null,
        rotation: AvatarRotationData | null,
        joints: Map<string, AvatarJointMetadata> | null
    ) {
        if (!this.avatarNode || !this.isModelLoaded) return;

        if (position) this.targetPosition = objToVector(position);
        if (rotation) this.targetRotation = objToQuat(rotation);

        if (joints && joints.size > 0 && this.avatarSkeleton) {
            const bones = this.avatarSkeleton.bones;
            for (const bone of bones) {
                let jointMetadata = joints.get(bone.name);
                if (!jointMetadata) {
                    for (const [jointName, metadata] of joints) {
                        if (bone.name.includes(jointName) || jointName.includes(bone.name)) {
                            jointMetadata = metadata;
                            break;
                        }
                    }
                }

                if (jointMetadata) {
                    this.targetBoneTransforms.set(bone.name, {
                        position: objToVector(jointMetadata.position),
                        rotation: objToQuat(jointMetadata.rotation),
                        scale: jointMetadata.scale ? objToVector(jointMetadata.scale) : Vector3.One(),
                    });
                } else {
                    // Reset to bind pose or identity
                    if (bone.getBindMatrix) {
                        const bindMatrix = bone.getBindMatrix();
                        const bindPos = new Vector3();
                        const bindRot = new Quaternion();
                        const bindScale = new Vector3();
                        bindMatrix.decompose(bindScale, bindRot, bindPos);
                        this.targetBoneTransforms.set(bone.name, {
                            position: bindPos,
                            rotation: bindRot,
                            scale: bindScale,
                        });
                    } else {
                        this.targetBoneTransforms.set(bone.name, {
                            position: Vector3.Zero(),
                            rotation: Quaternion.Identity(),
                            scale: Vector3.One(),
                        });
                    }
                }
            }
        }
    }

    public render() {
        if (!this.avatarNode || !this.isModelLoaded) return;

        const posFactor = adaptiveSmoothFactor(
            this.avatarNode.position,
            this.targetPosition,
            AVATAR_SMOOTH_FACTOR,
        );
        this.avatarNode.position = Vector3.Lerp(
            this.avatarNode.position,
            this.targetPosition,
            posFactor,
        );

        if (this.avatarNode.rotationQuaternion) {
            this.avatarNode.rotationQuaternion = Quaternion.Slerp(
                this.avatarNode.rotationQuaternion,
                this.targetRotation,
                AVATAR_SMOOTH_FACTOR,
            );
        }

        if (this.avatarSkeleton && this.targetBoneTransforms.size > 0) {
            for (const bone of this.avatarSkeleton.bones) {
                const targetTransform = this.targetBoneTransforms.get(bone.name);
                if (targetTransform) {
                    const currentPos = bone.getPosition(Space.LOCAL);
                    const currentRot = bone.getRotationQuaternion(Space.LOCAL) || Quaternion.Identity();
                    const currentScale = bone.getScale();

                    const smoothedPos = Vector3.Lerp(currentPos, targetTransform.position, BONE_SMOOTH_FACTOR);
                    const smoothedRot = Quaternion.Slerp(currentRot, targetTransform.rotation, BONE_SMOOTH_FACTOR);
                    const smoothedScale = Vector3.Lerp(currentScale, targetTransform.scale, BONE_SMOOTH_FACTOR);

                    bone.setPosition(smoothedPos, Space.LOCAL);
                    bone.setRotationQuaternion(smoothedRot, Space.LOCAL);
                    bone.setScale(smoothedScale);
                    bone.markAsDirty();
                }
            }
            this.avatarSkeleton.computeAbsoluteMatrices(true);
            for (const mesh of this.meshes) {
                if (mesh.skeleton === this.avatarSkeleton) {
                    mesh.computeWorldMatrix(true);
                }
            }
        }
    }

    public dispose() {
        if (this.avatarNode) {
            this.avatarNode.dispose();
            this.avatarNode = null;
        }
        this.meshes = [];
        this.avatarSkeleton = null;
        this.isModelLoaded = false;
    }
}

// Controller Management
const controllers = shallowReactive(new Map<string, AvatarController>());
let renderObserver: (() => void) | null = null;
let gameStateUnsubscribe: (() => void) | null = null;

const loadingBySession = ref<Record<string, boolean>>({});
const areOtherAvatarsLoading = computed(() => Object.values(loadingBySession.value).some((v) => v));

function markLoaded(sessionId: string): void {
    loadingBySession.value[sessionId] = false;
}
function markDisposed(sessionId: string): void {
    delete loadingBySession.value[sessionId];
}

function initializeSessionDefaults(sessionId: string): void {
    if (!avatarDataMap.value[sessionId]) {
        avatarDataMap.value[sessionId] = {
            type: "avatar",
            sessionId,
            cameraOrientation: { alpha: 0, beta: 0, radius: 0 },
            modelFileName: "babylon.avatar.glb",
        };
    }
    if (!positionDataMap.value[sessionId]) positionDataMap.value[sessionId] = { x: 0, y: 0, z: 0 };
    if (!rotationDataMap.value[sessionId]) rotationDataMap.value[sessionId] = { x: 0, y: 0, z: 0, w: 1 };
    if (!jointDataMap.value[sessionId]) jointDataMap.value[sessionId] = new Map<string, AvatarJointMetadata>();
    if (!chatDataMap.value[sessionId]) chatDataMap.value[sessionId] = [];
    if (!lastPollTimestamps.value[sessionId]) lastPollTimestamps.value[sessionId] = null;

    // Initialize controller if not exists
    if (!controllers.has(sessionId)) {
        loadingBySession.value[sessionId] = true;
        const controller = new AvatarController(sessionId, props.scene);
        controllers.set(sessionId, controller);
        const modelName = avatarDataMap.value[sessionId]?.modelFileName || "babylon.avatar.glb";
        controller.loadModel(modelName);
    }
}

function subscribeGameState(): void {
    if (gameStateUnsubscribe) gameStateUnsubscribe();
    console.log("[Discovery] Subscribing to Game State Updates");

    gameStateUnsubscribe = (vircadiaWorld.client.connection as any).subscribeGameState(
        (message: any) => {
            // Filter by sync group
            if (message.syncGroup !== props.entitySyncGroup) return;
            if (message.updateType !== "FULL_SNAPSHOT" && message.updateType !== "DELTA") return;

            const entities = message.data as Array<{
                id: string;
                position: { x: number; y: number; z: number };
                rotation: { x: number; y: number; z: number; w: number };
                avatar?: {
                    avatar__url?: string;
                    joints?: Record<string, any>;
                    avatar__data?: any;
                };
            }>;

            const foundFullSessionIds: string[] = [];

            for (const entity of entities) {
                const sessionId = entity.id;
                const info = vircadiaWorld.connectionInfo.value;
                if (sessionId === info.agentId || sessionId === info.sessionId) continue;

                foundFullSessionIds.push(sessionId);
                initializeSessionDefaults(sessionId);

                // Position & Rotation
                if (entity.position) positionDataMap.value[sessionId] = entity.position;
                if (entity.rotation) rotationDataMap.value[sessionId] = entity.rotation;

                // Avatar Data
                if (entity.avatar) {
                    const existingBase = avatarDataMap.value[sessionId];
                    const modelFileName = entity.avatar.avatar__url || existingBase?.modelFileName || "babylon.avatar.glb";

                    let cameraOrientation = existingBase?.cameraOrientation;
                    if (entity.avatar.avatar__data && typeof entity.avatar.avatar__data === 'object') {
                        const ad = entity.avatar.avatar__data as any;
                        if (ad.cameraOrientation) cameraOrientation = ad.cameraOrientation;
                    }

                    avatarDataMap.value[sessionId] = {
                        ...existingBase,
                        modelFileName,
                        sessionId,
                        type: "avatar",
                        cameraOrientation: cameraOrientation || { alpha: 0, beta: 0, radius: 0 }
                    };

                    // Check if model changed for controller
                    const controller = controllers.get(sessionId);
                    if (controller && controller.modelFileName !== modelFileName) {
                        controller.dispose(); // quick re-init
                        controller.loadModel(modelFileName);
                    }

                    // Joints
                    if (entity.avatar.joints) {
                        const targetJoints = jointDataMap.value[sessionId];
                        for (const [jointName, jointData] of Object.entries(entity.avatar.joints)) {
                            const parsed = parseAvatarJoint({ ...jointData as any, jointName, sessionId, type: "avatarJoint" });
                            if (parsed) targetJoints.set(jointName, parsed as AvatarJointMetadata);
                        }
                    }
                }

                lastPollTimestamps.value[sessionId] = new Date();

                // Update Controller Target
                const controller = controllers.get(sessionId);
                if (controller) {
                    controller.updateTargets(
                        positionDataMap.value[sessionId],
                        rotationDataMap.value[sessionId],
                        jointDataMap.value[sessionId]
                    );
                }
            }

            // Cleanup missing sessions
            const newSessionSet = new Set(foundFullSessionIds);
            for (const oldId of otherAvatarSessionIds.value) {
                if (!newSessionSet.has(oldId)) {
                    const c = controllers.get(oldId);
                    if (c) {
                        c.dispose();
                        controllers.delete(oldId);
                    }
                    markDisposed(oldId);
                }
            }
            otherAvatarSessionIds.value = foundFullSessionIds;

            reflectStats.value.totalFrames++;
            reflectStats.value.lastFrameAt = new Date();
        }
    );
}

// Debug loop
let debugInterval: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
    // Setup Render Loop
    renderObserver = () => {
        for (const controller of controllers.values()) {
            controller.render();
        }
    };
    props.scene.registerBeforeRender(renderObserver);

    // Watch for connection
    let unwatch: (() => void) | null = null;
    unwatch = watch(
        () => vircadiaWorld.connectionInfo.value.status,
        (s) => {
            if (s === "connected") {
                subscribeGameState();
                if (unwatch) { unwatch(); unwatch = null; }
            }
        },
        { immediate: true },
    );

    // Debug Exposure
    (window as DebugWindow & { __debugOtherAvatarData?: () => unknown }).__debugOtherAvatarData = () => {
        const debugData = {} as any;
        for (const [sid, c] of controllers) {
            if (c.avatarSkeleton) {
                debugData[sid] = {
                    boneCount: c.avatarSkeleton.bones.length,
                    position: c.avatarNode?.position
                };
            }
        }
        return debugData;
    };
});

onUnmounted(() => {
    if (gameStateUnsubscribe) gameStateUnsubscribe();
    if (renderObserver) props.scene.unregisterBeforeRender(renderObserver);
    if (debugInterval) clearInterval(debugInterval);

    for (const c of controllers.values()) {
        c.dispose();
    }
    controllers.clear();
});

defineExpose({
    otherAvatarSessionIds,
    avatarDataMap,
    positionDataMap,
    rotationDataMap,
    jointDataMap,
    chatDataMap,
    discoveryStats,
    reflectStats,
    lastPollTimestamps,
    lastBasePollTimestamps,
    lastCameraPollTimestamps,
    loadingBySession,
    areOtherAvatarsLoading,
    markLoaded,
    markDisposed,
    reflectSyncGroup: computed(() => props.reflectSyncGroup),
    entitySyncGroup: computed(() => props.entitySyncGroup),
    reflectChannel: computed(() => props.reflectChannel),
});
</script>
