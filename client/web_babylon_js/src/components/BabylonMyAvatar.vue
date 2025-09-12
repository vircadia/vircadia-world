<template>
    <BabylonMyAvatarEntity
        v-if="vircadiaWorld.connectionInfo.value.status === 'connected'"
        :scene="scene"
        :vircadia-world="vircadiaWorld"
        :avatar-node="avatarNode"
        :target-skeleton="avatarSkeleton"
        :camera="camera"
        :model-file-name="modelFileName"
        :instance-id="instanceId"
        :avatar-definition-name="avatarDefinitionName"
        @avatar-definition-loaded="onAvatarDefinitionLoaded"
        @entity-data-loaded="onEntityDataLoaded"
    />
    <slot
        :avatar-skeleton="avatarSkeleton"
        :animations="animations"
        :vircadia-world="vircadiaWorld"
        :on-animation-state="onAnimationState"
        :avatar-node="avatarNode"
        :model-file-name="modelFileName"
        :mesh-pivot-point="meshPivotPoint"
        :capsule-height="capsuleHeight"
        :on-set-avatar-model="onSetAvatarModel"
        :key-state="keyState"
    />
</template>

<script setup lang="ts">
import {
    ref,
    reactive,
    onMounted,
    onUnmounted,
    watch,
    type Ref,
    computed,
} from "vue";

import {
    Vector3,
    Quaternion,
    Matrix,
    CharacterSupportedState,
    Space,
    TransformNode,
    MeshBuilder,
    PhysicsCharacterController,
    StandardMaterial,
    Color3,
    PhysicsShapeCapsule,
    type AnimationGroup,
    type Scene,
    type Observer,
    type Skeleton,
    type Bone,
    type AbstractMesh,
    type Camera,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";

import type { VircadiaWorldInstance } from "@/components/VircadiaWorldProvider.vue";
import BabylonMyAvatarEntity from "./BabylonMyAvatarEntity.vue";

// Debug viewers import
import { SkeletonViewer, AxesViewer } from "@babylonjs/core/Debug";

type PositionObj = { x: number; y: number; z: number };
type RotationObj = { x: number; y: number; z: number; w: number };

type KeyState = {
    forward: boolean;
    backward: boolean;
    strafeLeft: boolean;
    strafeRight: boolean;
    jump: boolean;
    sprint: boolean;
    dash: boolean;
    turnLeft: boolean;
    turnRight: boolean;
    // toggles
    flyMode: boolean;
    crouch: boolean;
    prone: boolean;
    slowRun: boolean;
};

const props = defineProps({
    scene: { type: Object as () => Scene, required: true },
    vircadiaWorld: {
        type: Object as () => VircadiaWorldInstance,
        required: true,
    },
    instanceId: { type: String, required: false, default: null },
    avatarDefinitionName: {
        type: String,
        required: true,
    },
    keyState: { type: Object as () => KeyState, required: false },
    isTalking: { type: Boolean, required: false, default: false },
    camera: {
        type: Object as () => Camera | null,
        required: false,
        default: null,
    },
});

const emit = defineEmits<{ ready: []; dispose: [] }>();

// AvatarDefinition type
type Direction = "forward" | "back" | "left" | "right";
type AnimationDef = {
    fileName: string;
    slMotion?: string;
    direction?: Direction;
    variant?: string;
    ignoreHipTranslation?: boolean;
};
type AvatarDefinition = {
    initialAvatarPosition: { x: number; y: number; z: number };
    initialAvatarRotation: { x: number; y: number; z: number; w: number };
    modelFileName: string;
    meshPivotPoint: "bottom" | "center";
    throttleInterval: number;
    capsuleHeight: number;
    capsuleRadius: number;
    slopeLimit: number;
    jumpSpeed: number;
    debugBoundingBox: boolean;
    debugSkeleton: boolean;
    debugAxes: boolean;
    walkSpeed: number;
    turnSpeed: number;
    blendDuration: number;
    gravity: number;
    animations: AnimationDef[];
    disableRootMotion?: boolean; // Optional: Allow enabling root motion for specific avatars
};

const defaultAvatarDef: AvatarDefinition = {
    initialAvatarPosition: { x: 0, y: 0, z: -5 },
    initialAvatarRotation: { x: 0, y: 0, z: 0, w: 1 },
    modelFileName: "",
    meshPivotPoint: "bottom",
    throttleInterval: 500,
    capsuleHeight: 1.8,
    capsuleRadius: 0.3,
    slopeLimit: 45,
    jumpSpeed: 5,
    debugBoundingBox: false,
    debugSkeleton: false,
    debugAxes: false,
    walkSpeed: 1.5,
    turnSpeed: 1.5,
    blendDuration: 0.15,
    gravity: 9.8,
    animations: [],
};

const dbAvatarDef = ref<AvatarDefinition | null>(null);

const effectiveAvatarDef = computed<AvatarDefinition>(() => {
    return dbAvatarDef.value ?? defaultAvatarDef;
});

const capsuleHeight = computed(() => effectiveAvatarDef.value.capsuleHeight);
const capsuleRadius = computed(() => effectiveAvatarDef.value.capsuleRadius);
const slopeLimit = computed(() => effectiveAvatarDef.value.slopeLimit);
const jumpSpeed = computed(() => effectiveAvatarDef.value.jumpSpeed);
const debugBoundingBox = computed(
    () => effectiveAvatarDef.value.debugBoundingBox,
);
const debugSkeleton = computed(() => effectiveAvatarDef.value.debugSkeleton);
const debugAxes = computed(() => effectiveAvatarDef.value.debugAxes);
const walkSpeed = computed(() => effectiveAvatarDef.value.walkSpeed);
const turnSpeed = computed(() => effectiveAvatarDef.value.turnSpeed);
const blendDuration = computed(() => effectiveAvatarDef.value.blendDuration);
const gravity = computed(() => effectiveAvatarDef.value.gravity);
const meshPivotPoint = computed(() => effectiveAvatarDef.value.meshPivotPoint);
const modelFileName = computed(() => effectiveAvatarDef.value.modelFileName);
const animations = computed(
    () => effectiveAvatarDef.value.animations as AnimationDef[],
);

const sessionId = computed(
    () => props.vircadiaWorld.connectionInfo.value.sessionId ?? null,
);
const instanceId = computed(() => props.instanceId ?? null);
const fullSessionId = computed(() => {
    if (!sessionId.value || !instanceId.value) return null;
    return `${sessionId.value}-${instanceId.value}`;
});

function onAvatarDefinitionLoaded(def: AvatarDefinition) {
    dbAvatarDef.value = def;
}

type EntityData = {
    general__entity_name: string;
    metadata: Map<string, unknown>;
};

function onEntityDataLoaded(data: EntityData) {
    const meta = data?.metadata;
    if (meta && !characterController.value) {
        const entitySessionId = meta.get("sessionId") as string | undefined;
        if (entitySessionId !== fullSessionId.value) {
            console.error(
                "[AVATAR] ENTITY MISMATCH - Retrieved entity does not belong to this session!",
            );
            return;
        }

        const pos =
            (meta.get("position") as PositionObj) ??
            effectiveAvatarDef.value.initialAvatarPosition;
        const rot =
            (meta.get("rotation") as RotationObj) ??
            effectiveAvatarDef.value.initialAvatarRotation;

        createController(
            new Vector3(pos.x, pos.y, pos.z),
            new Quaternion(rot.x, rot.y, rot.z, rot.w),
        );
    }
}

const avatarNode = ref<TransformNode | null>(null);
const characterController = ref<PhysicsCharacterController | null>(null);

function createController(position: Vector3, rotation: Quaternion): void {
    const scene = props.scene;
    if (!scene) return;

    // Create node first so debug overlay can see it even if physics isn't ready yet
    const node = new TransformNode("avatarNode", scene);
    avatarNode.value = node;
    node.position = position;
    node.rotationQuaternion = rotation;

    // Create a visual/hidden capsule and parent it to the node
    const capsule = MeshBuilder.CreateCapsule(
        "avatarCapsule",
        { height: capsuleHeight.value, radius: capsuleRadius.value },
        scene,
    );
    const material = new StandardMaterial("capsuleMaterial", scene);
    material.diffuseColor = new Color3(0.2, 0.4, 0.8);
    capsule.material = material;
    capsule.isVisible = false;
    capsule.setParent(node);

    // Attempt to create physics shape and controller if physics is available
    try {
        const physicsReady = (
            scene as unknown as { isPhysicsEnabled?: () => boolean }
        ).isPhysicsEnabled?.();
        if (!physicsReady) {
            console.debug(
                "[Avatar] Physics not enabled yet; controller will be created later",
            );
            return;
        }
        const physicsShape = PhysicsShapeCapsule.FromMesh(capsule);
        characterController.value = new PhysicsCharacterController(
            node.position.clone(),
            {
                shape: physicsShape,
                capsuleHeight: capsuleHeight.value,
                capsuleRadius: capsuleRadius.value,
            },
            scene,
        );
        if (characterController.value) {
            characterController.value.maxSlopeCosine = Math.cos(
                (slopeLimit.value * Math.PI) / 180,
            );
            characterController.value.maxCastIterations = 20;
            characterController.value.keepContactTolerance = 0.001;
            characterController.value.keepDistance = 0.01;
        }
    } catch (e) {
        console.warn(
            "[Avatar] Failed to create character controller; will retry when physics is ready",
            e,
        );
    }
}

function tryCreateControllerIfNeeded(): void {
    if (characterController.value || !avatarNode.value) return;
    const scene = props.scene;
    if (!scene) return;
    const physicsReady = (
        scene as unknown as { isPhysicsEnabled?: () => boolean }
    ).isPhysicsEnabled?.();
    if (!physicsReady) return;
    const currentPos = avatarNode.value.position.clone();
    const currentRot =
        avatarNode.value.rotationQuaternion?.clone() ?? Quaternion.Identity();
    createController(currentPos, currentRot);
}

function updateTransforms(): void {
    if (!avatarNode.value || !characterController.value) return;
    const pos = characterController.value.getPosition();
    if (pos) {
        avatarNode.value.position = pos.clone();
        avatarNode.value.computeWorldMatrix(true);
    }
}

function getPosition(): Vector3 | undefined {
    return characterController.value?.getPosition();
}

function getOrientation(): Quaternion | undefined {
    return avatarNode.value?.rotationQuaternion?.clone();
}
function setOrientation(q: Quaternion): void {
    if (avatarNode.value) {
        avatarNode.value.rotationQuaternion = q.clone();
        avatarNode.value.computeWorldMatrix(true);
    }
}
function getVelocity(): Vector3 | undefined {
    return characterController.value?.getVelocity();
}
function setVelocity(v: Vector3): void {
    characterController.value?.setVelocity(v);
}
type SupportType = ReturnType<PhysicsCharacterController["checkSupport"]>;
function checkSupport(deltaTime: number): SupportType | undefined {
    return characterController.value?.checkSupport(
        deltaTime,
        new Vector3(0, -1, 0),
    );
}
function integrate(deltaTime: number, support?: SupportType): void {
    const controller = characterController.value;
    if (!controller || !support) return;
    controller.integrate(deltaTime, support, new Vector3(0, -gravity.value, 0));
}

const defaultKeyState = ref<KeyState>({
    forward: false,
    backward: false,
    strafeLeft: false,
    strafeRight: false,
    jump: false,
    sprint: false,
    dash: false,
    turnLeft: false,
    turnRight: false,
    flyMode: false,
    crouch: false,
    prone: false,
    slowRun: false,
});
const keyState = computed(() => props.keyState ?? defaultKeyState.value);

const vircadiaWorld = props.vircadiaWorld;

const avatarMeshes: Ref<AbstractMesh[]> = ref([]);
const isModelLoaded = ref(false);

const blendWeight = ref(0);

let idleAnimation: AnimationGroup | null = null;
let walkAnimation: AnimationGroup | null = null;
let previousMoveAnimation: AnimationGroup | null = null;
let currentMoveFileName: string | null = null;
let moveCrossfadeT = 1;
let talkOverlayAnimation: AnimationGroup | null = null;
const talkOverlayBlendWeight = ref(0);

function findAnimationDef(
    motion: string,
    direction?: Direction,
    variant?: string,
): AnimationDef | undefined {
    const list = animations.value as AnimationDef[];
    if (direction) {
        if (variant) {
            const withDirVariant = list.find(
                (a) =>
                    a.slMotion === motion &&
                    a.direction === direction &&
                    a.variant === variant,
            );
            if (withDirVariant) return withDirVariant;
        }
        const withDir = list.find(
            (a) => a.slMotion === motion && a.direction === direction,
        );
        if (withDir) return withDir;
    }
    if (variant) {
        const withoutDirVariant = list.find(
            (a) =>
                a.slMotion === motion && !a.direction && a.variant === variant,
        );
        if (withoutDirVariant) return withoutDirVariant;
    }
    const withoutDir = list.find((a) => a.slMotion === motion && !a.direction);
    if (withoutDir) return withoutDir;
    return undefined;
}

function getIdleDef(): AnimationDef | undefined {
    const list = animations.value as AnimationDef[];
    for (const a of list) {
        if (a.slMotion === "stand") return a;
    }
    for (const a of list) {
        const name = a.fileName.toLowerCase();
        if (name.includes("idle.1.glb")) return a;
    }
    return undefined;
}

function getTalkingDefs(): AnimationDef[] {
    const list = animations.value as AnimationDef[];
    const lower = (s: string) => s.toLowerCase();
    return list.filter(
        (a) => a.slMotion === "talk" || lower(a.fileName).includes("talking"),
    );
}

function getDesiredMoveDefFromKeys(): AnimationDef | undefined {
    const ks = keyState.value;
    const dx = (ks.strafeRight ? 1 : 0) - (ks.strafeLeft ? 1 : 0);
    const dz = (ks.forward ? 1 : 0) - (ks.backward ? 1 : 0);
    if (dx === 0 && dz === 0) return undefined;
    let dir: Direction;
    if (Math.abs(dz) >= Math.abs(dx)) dir = dz >= 0 ? "forward" : "back";
    else dir = dx >= 0 ? "right" : "left";
    const speedMode: "walk" | "jog" | "sprint" = ks.sprint
        ? "sprint"
        : ks.slowRun
          ? "jog"
          : "walk";
    const primaryMotion = speedMode === "walk" ? "walk" : "run";
    const preferredVariant = speedMode === "jog" ? "jog" : undefined;
    const mapped =
        findAnimationDef(primaryMotion, dir, preferredVariant) ||
        findAnimationDef(primaryMotion, undefined, preferredVariant) ||
        findAnimationDef("walk", dir) ||
        findAnimationDef("walk");
    if (mapped) return mapped;

    const list = animations.value as AnimationDef[];
    const name = (s: string) => s.toLowerCase();
    if (primaryMotion === "walk") {
        if (dir === "forward")
            return (
                list.find((a) => name(a.fileName).includes("walk.1.glb")) ||
                list.find((a) => name(a.fileName).includes("walk.2.glb")) ||
                list.find((a) => name(a.fileName).includes("walk.")) ||
                list.find((a) => name(a.fileName).includes("walk"))
            );
        if (dir === "back")
            return list.find((a) => name(a.fileName).includes("walk_back"));
        if (dir === "left")
            return (
                list.find((a) =>
                    name(a.fileName).includes("walk_strafe_left"),
                ) || list.find((a) => name(a.fileName).includes("strafe_left"))
            );
        if (dir === "right")
            return (
                list.find((a) =>
                    name(a.fileName).includes("walk_strafe_right"),
                ) || list.find((a) => name(a.fileName).includes("strafe_right"))
            );
    } else {
        if (dir === "forward")
            return (
                (preferredVariant === "jog"
                    ? list.find((a) => name(a.fileName).includes("jog.glb")) ||
                      list.find((a) => name(a.fileName).includes("jog."))
                    : list.find((a) => name(a.fileName).includes("run.glb")) ||
                      list.find((a) => name(a.fileName).includes("run."))) ||
                list.find((a) => name(a.fileName).includes("run.glb")) ||
                list.find((a) => name(a.fileName).includes("jog.glb")) ||
                list.find((a) => name(a.fileName).includes("run.")) ||
                list.find((a) => name(a.fileName).includes("jog."))
            );
        if (dir === "back")
            return list.find((a) => name(a.fileName).includes("run_back"));
        if (dir === "left")
            return (
                list.find((a) =>
                    name(a.fileName).includes("run_strafe_left"),
                ) || list.find((a) => name(a.fileName).includes("strafe_left"))
            );
        if (dir === "right")
            return (
                list.find((a) =>
                    name(a.fileName).includes("run_strafe_right"),
                ) || list.find((a) => name(a.fileName).includes("strafe_right"))
            );
    }
    return undefined;
}

function ensureIdleGroupReady(): void {
    if (idleAnimation) return;
    const idleDef = getIdleDef();
    if (!idleDef) return;
    const info = animationsMap.value.get(idleDef.fileName);
    if (info?.state === "ready" && info.group) {
        idleAnimation = info.group as AnimationGroup;
        idleAnimation.stop();
        idleAnimation.loopAnimation = true;
        idleAnimation.setWeightForAllAnimatables(1.0);
        idleAnimation.play(true);
    }
}

function ensureTalkingGroupReady(): void {
    if (talkOverlayAnimation) return;
    const talkDefs = getTalkingDefs();
    if (talkDefs.length === 0) return;
    const readyGroups = talkDefs
        .map((def) => ({ def, info: animationsMap.value.get(def.fileName) }))
        .filter((x) => x.info?.state === "ready" && x.info.group);
    if (readyGroups.length === 0) return;
    const pick = readyGroups[Math.floor(Math.random() * readyGroups.length)];
    const info = pick.info;
    if (!info || !info.group) return;
    const group = info.group as AnimationGroup;
    talkOverlayAnimation = group;
    try {
        talkOverlayAnimation.stop();
    } catch {}
    talkOverlayAnimation.loopAnimation = true;
    talkOverlayAnimation.setWeightForAllAnimatables(0);
}

function setMoveAnimationFromDef(def: AnimationDef | undefined): void {
    if (!def) return;
    if (currentMoveFileName === def.fileName && walkAnimation) return;
    const info = animationsMap.value.get(def.fileName);
    if (info?.state !== "ready" || !info.group) return;
    const newGroup = info.group as AnimationGroup;

    if (walkAnimation && walkAnimation !== newGroup) {
        previousMoveAnimation = walkAnimation;
        try {
            previousMoveAnimation.play(true);
        } catch {}
        moveCrossfadeT = 0;
    }

    walkAnimation = newGroup;
    currentMoveFileName = def.fileName;
    walkAnimation.stop();
    walkAnimation.loopAnimation = true;
    walkAnimation.setWeightForAllAnimatables(0);
    walkAnimation.play(true);
}

function refreshDesiredAnimations(): void {
    ensureIdleGroupReady();
    const desired = getDesiredMoveDefFromKeys();
    setMoveAnimationFromDef(desired);
}

const avatarSkeleton: Ref<Skeleton | null> = ref(null);

function onSetAvatarModel(payload: {
    skeleton: Skeleton | null;
    meshes: AbstractMesh[];
}): void {
    avatarSkeleton.value = payload.skeleton;
    avatarMeshes.value = payload.meshes;
    trySetupBlendedAnimations();

    if (characterController.value && avatarNode.value) {
        const currentPos = getPosition();
        const currentRot = getOrientation();
        if (currentPos) {
            avatarNode.value.position = currentPos.clone();
        }
        if (currentRot) {
            avatarNode.value.rotationQuaternion = currentRot.clone();
        }

        avatarNode.value.computeWorldMatrix(true);
        for (const mesh of avatarMeshes.value) {
            mesh.computeWorldMatrix(true);
        }
    }

    isModelLoaded.value = true;

    if (debugBoundingBox.value) {
        for (const mesh of avatarMeshes.value) {
            if ("showBoundingBox" in mesh) {
                (mesh as { showBoundingBox?: boolean }).showBoundingBox = true;
            }
        }
    }
    if (debugAxes.value && avatarNode.value) {
        axesViewer = new AxesViewer(props.scene, capsuleHeight.value);
    }
    if (debugSkeleton.value && avatarSkeleton.value) {
        const skinnedMeshes = avatarMeshes.value.filter(
            (m) => m.skeleton === avatarSkeleton.value,
        );
        for (const m of skinnedMeshes) {
            if (avatarSkeleton.value) {
                skeletonViewer = new SkeletonViewer(
                    avatarSkeleton.value,
                    m,
                    props.scene,
                );
                skeletonViewer.isEnabled = true;
            }
        }
    }

    emit("ready");
}

type AnimationState = "idle" | "loading" | "ready" | "error";
type AnimationInfo = {
    state: AnimationState;
    error?: string;
    group?: AnimationGroup | null;
};
const animationsMap = ref<Map<string, AnimationInfo>>(new Map());

function onAnimationState(payload: {
    fileName: string;
    state: AnimationState;
    error?: string;
    group?: AnimationGroup | null;
}): void {
    animationsMap.value.set(payload.fileName, {
        state: payload.state,
        error: payload.error,
        group: payload.group,
    });
    refreshDesiredAnimations();
}

function trySetupBlendedAnimations(): void {
    ensureIdleGroupReady();
}

function updateAnimationBlending(
    isMoving: boolean,
    dt: number,
    isTalkingNow: boolean,
): void {
    if (!idleAnimation) return;

    const targetWeight = isMoving && walkAnimation ? 1 : 0;
    const change = dt / Math.max(0.0001, blendDuration.value);

    if (targetWeight > blendWeight.value) {
        blendWeight.value = Math.min(1, blendWeight.value + change);
    } else if (targetWeight < blendWeight.value) {
        blendWeight.value = Math.max(0, blendWeight.value - change);
    }

    if (previousMoveAnimation && walkAnimation) {
        moveCrossfadeT = Math.min(1, moveCrossfadeT + change);
        if (moveCrossfadeT >= 1) {
            try {
                previousMoveAnimation.stop();
            } catch {}
            previousMoveAnimation = null;
        }
    }

    const moveMasterWeight = blendWeight.value;
    idleAnimation.setWeightForAllAnimatables(1 - moveMasterWeight);
    if (walkAnimation) {
        const activeWeight = moveMasterWeight * moveCrossfadeT;
        walkAnimation.setWeightForAllAnimatables(activeWeight);
        if (!walkAnimation.isPlaying) walkAnimation.play(true);
    }
    if (previousMoveAnimation) {
        const prevWeight = moveMasterWeight * (1 - moveCrossfadeT);
        previousMoveAnimation.setWeightForAllAnimatables(prevWeight);
        if (!previousMoveAnimation.isPlaying) previousMoveAnimation.play(true);
    }

    const canTalk = !isMoving && !!isTalkingNow;
    if (canTalk && !talkOverlayAnimation) ensureTalkingGroupReady();
    const talkTarget = canTalk && talkOverlayAnimation ? 1 : 0;
    if (talkTarget > talkOverlayBlendWeight.value) {
        talkOverlayBlendWeight.value = Math.min(
            1,
            talkOverlayBlendWeight.value + change,
        );
    } else if (talkTarget < talkOverlayBlendWeight.value) {
        talkOverlayBlendWeight.value = Math.max(
            0,
            talkOverlayBlendWeight.value - change,
        );
    }
    if (talkOverlayAnimation) {
        talkOverlayAnimation.setWeightForAllAnimatables(
            talkOverlayBlendWeight.value,
        );
        if (talkOverlayBlendWeight.value > 0) {
            if (!talkOverlayAnimation.isPlaying)
                talkOverlayAnimation.play(true);
        } else {
            try {
                talkOverlayAnimation.pause();
            } catch {}
        }
    }
}

let skeletonViewer: SkeletonViewer | null = null;
let axesViewer: AxesViewer | null = null;
let beforePhysicsObserver: Observer<Scene> | null = null;
let afterPhysicsObserver: Observer<Scene> | null = null;
let rootMotionObserver: Observer<Scene> | null = null;

onMounted(async () => {
    // Ensure controller/node exist immediately, independent of DB metadata
    if (!characterController.value) {
        const p = effectiveAvatarDef.value.initialAvatarPosition;
        const r = effectiveAvatarDef.value.initialAvatarRotation;
        createController(
            new Vector3(p.x, p.y, p.z),
            new Quaternion(r.x, r.y, r.z, r.w),
        );
    }

    let lastTime = performance.now();
    if (
        !props.scene?.onBeforeRenderObservable?.add ||
        !props.scene?.onAfterRenderObservable?.add
    ) {
        console.warn(
            "[BabylonMyAvatar] Scene render observables are not available yet; skipping frame hooks this mount",
        );
        return;
    }
    beforePhysicsObserver = props.scene.onBeforeRenderObservable.add(() => {
        // Late-init controller once physics is enabled
        tryCreateControllerIfNeeded();
        const now = performance.now();
        const deltaTime = (now - lastTime) / 1000.0;
        lastTime = now;

        if (!avatarNode.value || !characterController.value) return;

        const ks = keyState.value;
        const isMoving =
            ks.forward ||
            ks.backward ||
            ks.strafeLeft ||
            ks.strafeRight ||
            ks.turnLeft ||
            ks.turnRight;

        refreshDesiredAnimations();
        updateAnimationBlending(isMoving, deltaTime, props.isTalking);

        const moveDirection = new Vector3(0, 0, 0);
        if (ks.forward) moveDirection.z += 1;
        if (ks.backward) moveDirection.z -= 1;
        if (ks.strafeRight) moveDirection.x += 1;
        if (ks.strafeLeft) moveDirection.x -= 1;

        if (moveDirection.lengthSquared() > 0) {
            moveDirection.normalize();
        }

        const currentSpeed = walkSpeed.value * (ks.sprint ? 2 : 1);
        moveDirection.scaleInPlace(currentSpeed);

        const m = new Matrix();
        avatarNode.value.rotationQuaternion?.toRotationMatrix(m);
        const worldMove = Vector3.TransformCoordinates(moveDirection, m);

        const currentVelocity = getVelocity() ?? Vector3.Zero();
        const newVelocity = new Vector3(
            worldMove.x,
            currentVelocity.y,
            worldMove.z,
        );
        setVelocity(newVelocity);

        const turn = (ks.turnRight ? 1 : 0) - (ks.turnLeft ? 1 : 0);
        if (turn !== 0) {
            const turnAngle = turn * turnSpeed.value * deltaTime;
            const turnQuat = Quaternion.RotationAxis(Vector3.Up(), turnAngle);
            const currentOrientation =
                getOrientation() ?? Quaternion.Identity();
            setOrientation(currentOrientation.multiply(turnQuat));
        }

        // Recompute support after velocity/turn updates
        const support = checkSupport(deltaTime);
        if (
            ks.jump &&
            support?.supportedState === CharacterSupportedState.SUPPORTED
        ) {
            const jumpVelocity = getVelocity() ?? Vector3.Zero();
            jumpVelocity.y = jumpSpeed.value;
            setVelocity(jumpVelocity);
        }

        integrate(deltaTime, support);
    });

    afterPhysicsObserver = props.scene.onAfterRenderObservable.add(() => {
        updateTransforms();
    });

    const disableRootMotion = effectiveAvatarDef.value.disableRootMotion;
    if (!disableRootMotion) {
        rootMotionObserver = props.scene.onAfterAnimationsObservable.add(() => {
            if (avatarSkeleton.value) {
                // Placeholder for root motion extraction
            }
        });
    }
});

onUnmounted(() => {
    emit("dispose");
    if (
        beforePhysicsObserver &&
        props.scene?.onBeforeRenderObservable?.remove
    ) {
        props.scene.onBeforeRenderObservable.remove(beforePhysicsObserver);
    }
    if (afterPhysicsObserver && props.scene?.onAfterRenderObservable?.remove) {
        props.scene.onAfterRenderObservable.remove(afterPhysicsObserver);
    }
    if (rootMotionObserver) {
        props.scene.onAfterAnimationsObservable.remove(rootMotionObserver);
    }
    if (skeletonViewer) {
        skeletonViewer.dispose();
    }
    if (axesViewer) {
        axesViewer.dispose();
    }
    // Controller does not expose dispose in types; clear references and dispose nodes
    avatarNode.value?.dispose(false, true);
});
</script>