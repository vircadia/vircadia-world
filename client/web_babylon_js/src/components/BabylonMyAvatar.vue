<template>
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
        :onAvatarDefinitionLoaded="onAvatarDefinitionLoaded"
        :onEntityDataLoaded="onEntityDataLoaded"
        :key-state="keyState"
        :airborne="lastAirborne"
        :verticalVelocity="lastVerticalVelocity"
        :supportState="lastSupportState"
        :physicsEnabled="props.physicsEnabled"
        :hasTouchedGround="hasTouchedGround"
        :spawnSettling="spawnSettleActive"
        :groundProbeHit="groundProbeHit"
        :groundProbeDistance="groundProbeDistance"
        :groundProbeMeshName="groundProbeMeshName"
    />
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, type Ref, computed } from "vue";

import {
    Vector3,
    Quaternion,
    Matrix,
    CharacterSupportedState,
    TransformNode,
    type Node as BabylonNode,
    MeshBuilder,
    PhysicsCharacterController,
    StandardMaterial,
    Color3,
    PhysicsShapeCapsule,
    Ray,
    type AnimationGroup,
    type Scene,
    type Observer,
    type Skeleton,
    type AbstractMesh,
    type Camera,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";

import type { VircadiaWorldInstance } from "@/components/VircadiaWorldProvider.vue";

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
    keyState: { type: Object as () => KeyState, required: false },
    isTalking: { type: Boolean, required: false, default: false },
    // Optional talk amplitude (0..1) from BabylonMyAvatarTalking
    talkLevel: { type: Number, required: false, default: 0 },
    camera: {
        type: Object as () => Camera | null,
        required: false,
        default: null,
    },
    // Physics state from environment
    physicsEnabled: { type: Boolean, required: false, default: false },
    physicsPluginName: { type: String, required: false, default: "" },
    gravity: {
        type: Array as unknown as () => [number, number, number],
        required: false,
        default: () => [0, -9.81, 0],
    },
});

const emit = defineEmits<{ ready: []; dispose: [] }>();

// AvatarDefinition type
export type Direction = "forward" | "back" | "left" | "right";
export type AnimationDef = {
    fileName: string;
    slMotion?: string;
    direction?: Direction;
    variant?: string;
    ignoreHipTranslation?: boolean;
};
export type AvatarDefinition = {
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
    animations: AnimationDef[];
    disableRootMotion?: boolean; // Optional: Allow enabling root motion for specific avatars
    startFlying?: boolean;
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
    startFlying: false,
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
const meshPivotPoint = computed(() => effectiveAvatarDef.value.meshPivotPoint);
const modelFileName = computed(() => effectiveAvatarDef.value.modelFileName);
void meshPivotPoint;
void modelFileName;
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
    isFlying.value = !!def.startFlying;
}
void onAvatarDefinitionLoaded;

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
void onEntityDataLoaded;

const avatarNode = ref<TransformNode | null>(null);
const characterController = ref<PhysicsCharacterController | null>(null);

function createController(position: Vector3, rotation: Quaternion): void {
    const scene = props.scene;
    if (!scene) return;

    // Reuse existing node if present; otherwise create
    let node = avatarNode.value;
    if (!node) {
        node = new TransformNode("avatarNode", scene);
        avatarNode.value = node;
    }
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
    capsule.setParent(node as unknown as BabylonNode);

    // Create physics shape and controller only if physics is enabled
    if (props.physicsEnabled) {
        try {
            console.log("[BabylonMyAvatar] Creating character controller", {
                position: node.position.toString(),
                capsuleHeight: capsuleHeight.value,
                capsuleRadius: capsuleRadius.value,
                physicsPluginName: props.physicsPluginName,
                physicsEnabled: props.physicsEnabled,
            });

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
                characterController.value.keepDistance = 0.02;
                console.log(
                    "[BabylonMyAvatar] Character controller created successfully",
                );
            }
        } catch (e) {
            console.error(
                "[BabylonMyAvatar] Failed to create character controller",
                e,
            );
        }
    } else {
        console.log(
            "[BabylonMyAvatar] Physics disabled, skipping character controller creation",
        );
    }
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
    if (!controller) return;
    // Zero gravity while flying; otherwise use gravity from props
    const gravityVector = isFlying.value
        ? Vector3.Zero()
        : new Vector3(props.gravity[0], props.gravity[1], props.gravity[2]);
    // If support is missing on early frames, synthesize an unsupported surface info (typed as any to avoid enum coupling)
    const effectiveSupport = (support ??
        ({
            supportedState:
                (CharacterSupportedState as unknown as { UNSUPPORTED?: number })
                    .UNSUPPORTED ?? 0,
            hitPoint: Vector3.Zero(),
            hitNormal: new Vector3(0, 1, 0),
        } as unknown)) as SupportType;
    controller.integrate(deltaTime, effectiveSupport, gravityVector);
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
void vircadiaWorld;

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
const lastAirborne = ref(false);
const lastVerticalVelocity = ref(0);
const spawnSettleActive = ref(false);
// Flight state and input edge tracking
const isFlying = ref(false);
let prevJumpPressed = false;
let prevFlyTogglePressed = false;
type CharacterState = "IN_AIR" | "ON_GROUND" | "START_JUMP";
const characterState = ref<CharacterState>("IN_AIR");
// Physics state now comes from props
const lastSupportState = ref<CharacterSupportedState | null>(null);
const hasTouchedGround = ref(false);
// mark used in template slot
void lastSupportState;
void hasTouchedGround;

// Ground probe debug info
const groundProbeHit = ref(false);
const groundProbeDistance = ref<number | null>(null);
const groundProbeMeshName = ref<string | null>(null);
let groundProbeTimer = 0;
const groundProbeIntervalSec = 0.25;

function isMeshUnderAvatar(mesh: AbstractMesh): boolean {
    const root = avatarNode.value;
    if (!root) return false;
    const rootId = (root as unknown as { uniqueId?: number }).uniqueId;
    let p: BabylonNode | null = mesh.parent;
    while (p) {
        const pid = (p as unknown as { uniqueId?: number }).uniqueId;
        if (rootId !== undefined && pid !== undefined && pid === rootId)
            return true;
        p = p.parent;
    }
    // Also exclude meshes that are skinned to this avatar's skeleton
    if (
        avatarSkeleton.value &&
        (mesh as AbstractMesh).skeleton === avatarSkeleton.value
    ) {
        return true;
    }
    return false;
}

// Morph target (blendshape) handling
type BabylonMorphTarget = { name: string; influence: number };
type BabylonMorphTargetManager = {
    numTargets: number;
    getTarget: (index: number) => BabylonMorphTarget | null;
};

const morphTargetsByName = ref<Map<string, BabylonMorphTarget[]>>(new Map());
const morphTargetsByNameLower = ref<Map<string, BabylonMorphTarget[]>>(
    new Map(),
);
const supportedVisemes = [
    "viseme_sil",
    "viseme_PP",
    "viseme_FF",
    "viseme_TH",
    "viseme_DD",
    "viseme_kk",
    "viseme_CH",
    "viseme_SS",
    "viseme_nn",
    "viseme_RR",
    "viseme_aa",
    "viseme_E",
    "viseme_I",
    "viseme_O",
    "viseme_U",
];

function collectMorphTargets(): void {
    const map = new Map<string, BabylonMorphTarget[]>();
    const mapLower = new Map<string, BabylonMorphTarget[]>();
    for (const mesh of avatarMeshes.value) {
        const manager = (
            mesh as unknown as {
                morphTargetManager?: BabylonMorphTargetManager;
            }
        ).morphTargetManager;
        if (!manager || !manager.numTargets || !manager.getTarget) continue;
        for (let i = 0; i < manager.numTargets; i++) {
            const t = manager.getTarget(i);
            if (!t || !t.name) continue;
            const key = t.name;
            let list = map.get(key);
            if (!list) {
                list = [];
                map.set(key, list);
            }
            list.push(t);

            const lkey = key.toLowerCase();
            let llist = mapLower.get(lkey);
            if (!llist) {
                llist = [];
                mapLower.set(lkey, llist);
            }
            llist.push(t);
        }
    }
    morphTargetsByName.value = map;
    morphTargetsByNameLower.value = mapLower;
}

const morphNameSynonyms: Record<string, string[]> = {
    mouthOpen: ["mouth_open", "jawOpen", "jaw_open", "open_mouth"],
};

function getTargetsByName(name: string): BabylonMorphTarget[] | undefined {
    const direct = morphTargetsByName.value.get(name);
    if (direct?.length) return direct;
    const lower = morphTargetsByNameLower.value.get(name.toLowerCase());
    if (lower?.length) return lower;
    const syn = morphNameSynonyms[name] || [];
    for (const alt of syn) {
        const viaAlt =
            morphTargetsByName.value.get(alt) ||
            morphTargetsByNameLower.value.get(alt.toLowerCase());
        if (viaAlt?.length) return viaAlt;
    }
    return undefined;
}

function setMorphInfluence(name: string, value: number): void {
    const list = getTargetsByName(name);
    if (!list) return;
    const v = Math.max(0, Math.min(1, value));
    for (const t of list) {
        t.influence = v;
    }
}

const mouthOpenSmoothed = ref(0);
let talkPhase = 0;
function updateMouthFromTalking(
    level01: number,
    dt: number,
    talking: boolean,
): void {
    const hasAnyViseme = supportedVisemes.some(
        (n) =>
            morphTargetsByName.value?.has(n) ||
            morphTargetsByNameLower.value?.has(n.toLowerCase()),
    );
    const hasMouthOpen =
        morphTargetsByName.value?.has("mouthOpen") ||
        morphTargetsByNameLower.value?.has("mouth_open") ||
        morphTargetsByName.value?.has("jawOpen") ||
        morphTargetsByNameLower.value?.has("jaw_open");

    // Boost and curve amplitude for visibility
    const boosted = talking ? Math.min(1, level01 * 3) : 0;
    const target = talking ? Math.sqrt(boosted) : 0; // gamma 0.5
    const minFloor = talking ? 0.25 : 0; // ensure visible motion when talking
    const lerpRate = 10; // per-second smoothing
    const a = Math.min(1, dt * lerpRate);
    mouthOpenSmoothed.value =
        mouthOpenSmoothed.value + (target - mouthOpenSmoothed.value) * a;
    if (talking && mouthOpenSmoothed.value < minFloor)
        mouthOpenSmoothed.value = minFloor;

    // Advance talk phase for simple vowel cycling
    talkPhase += dt * 6;

    if (hasAnyViseme) {
        // Drive multiple vowels to create visible motion without phoneme detection
        const amp = mouthOpenSmoothed.value;
        const s1 = 0.5 * (1 + Math.sin(talkPhase));
        const s2 = 0.5 * (1 + Math.sin(talkPhase + 2));
        const s3 = 0.5 * (1 + Math.sin(talkPhase + 4));
        const wAA = Math.min(1, amp * (0.6 + 0.4 * s1));
        const wO = Math.min(1, amp * 0.5 * s2);
        const wE = Math.min(1, amp * 0.4 * s3);

        // Set primary visemes
        setMorphInfluence("viseme_aa", wAA);
        setMorphInfluence("viseme_O", wO);
        setMorphInfluence("viseme_E", wE);
        // Balance silence
        const combined = Math.max(0, Math.min(1, wAA + 0.5 * wO + 0.5 * wE));
        setMorphInfluence("viseme_sil", 1 - combined);
    } else if (hasMouthOpen) {
        setMorphInfluence("mouthOpen", mouthOpenSmoothed.value);
    }
}

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

function getJumpDef(): AnimationDef | undefined {
    return findAnimationDef("jump");
}

function getFallingDef(): AnimationDef | undefined {
    return findAnimationDef("falling");
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
    // Jump should be a one-shot; others loop
    walkAnimation.loopAnimation = def.slMotion === "jump" ? false : true;
    walkAnimation.setWeightForAllAnimatables(0);
    walkAnimation.play();
}

function refreshDesiredAnimations(): void {
    ensureIdleGroupReady();
    let desired: AnimationDef | undefined;
    if (isFlying.value) {
        desired = getDesiredMoveDefFromKeys();
    } else if (lastAirborne.value && !spawnSettleActive.value) {
        // Rising: jump; Falling or apex: falling
        desired =
            lastVerticalVelocity.value > 0 ? getJumpDef() : getFallingDef();
        // Fallbacks if specific air animations are missing
        if (!desired) desired = getFallingDef();
        if (!desired) desired = getJumpDef();
        if (!desired) desired = getDesiredMoveDefFromKeys();
    } else {
        desired = getDesiredMoveDefFromKeys();
    }
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
    collectMorphTargets();

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
void onSetAvatarModel;

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
void onAnimationState;

function trySetupBlendedAnimations(): void {
    ensureIdleGroupReady();
}

function updateAnimationBlending(
    isMoving: boolean,
    dt: number,
    isTalkingNow: boolean,
): void {
    if (!idleAnimation) return;

    const isActiveMotion =
        (isMoving || (lastAirborne.value && !isFlying.value)) &&
        !!walkAnimation;
    const targetWeight = isActiveMotion ? 1 : 0;
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
        if (!walkAnimation.isPlaying) walkAnimation.play();
    }
    if (previousMoveAnimation) {
        const prevWeight = moveMasterWeight * (1 - moveCrossfadeT);
        previousMoveAnimation.setWeightForAllAnimatables(prevWeight);
        if (!previousMoveAnimation.isPlaying) previousMoveAnimation.play();
    }

    const canTalk = !isMoving && !lastAirborne.value && !!isTalkingNow;
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

    // Drive mouth/viseme blendshapes using talking state and provided level
    updateMouthFromTalking(props.talkLevel ?? 0, dt, !!isTalkingNow);
}

let skeletonViewer: SkeletonViewer | null = null;
let axesViewer: AxesViewer | null = null;
let beforePhysicsObserver: Observer<Scene> | null = null;
let afterPhysicsObserver: Observer<Scene> | null = null;
let rootMotionObserver: Observer<Scene> | null = null;

onMounted(async () => {
    // Ensure controller/node exist immediately, independent of DB metadata
    if (!avatarNode.value) {
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
        const now = performance.now();
        const deltaTime = (now - lastTime) / 1000.0;
        lastTime = now;

        if (!avatarNode.value) return;
        // Lazily create character controller once physics is ready
        // Use physics state from props passed from environment
        if (!characterController.value && props.physicsEnabled) {
            const pos =
                avatarNode.value.position?.clone() ?? new Vector3(0, 0, 0);
            const rot =
                avatarNode.value.rotationQuaternion?.clone() ??
                Quaternion.Identity();
            createController(pos, rot);
        }
        if (!characterController.value) return;

        const ks = keyState.value;
        // Only treat translational input as movement; turning alone should remain idle
        const isMoving =
            ks.forward || ks.backward || ks.strafeLeft || ks.strafeRight;

        // Toggle flying mode on any edge of flyMode toggle from controller
        const jumpPressed = ks.jump;
        const flyTogglePressed = ks.flyMode;
        if (flyTogglePressed !== prevFlyTogglePressed) {
            isFlying.value = !isFlying.value;
        }
        prevFlyTogglePressed = flyTogglePressed;

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
        let newVelocity = new Vector3(
            worldMove.x,
            currentVelocity.y,
            worldMove.z,
        );
        if (isFlying.value) {
            const verticalSpeed = jumpSpeed.value;
            if (ks.jump) newVelocity.y = verticalSpeed;
            else if (ks.crouch || ks.prone) newVelocity.y = -verticalSpeed;
            else newVelocity.y = 0;
            setVelocity(newVelocity);
        } else {
            // Character controller grounded/air control via calculateMovement
            const upWorld = new Vector3(0, 1, 0);
            const forwardWorld = new Vector3(0, 0, 1).applyRotationQuaternion(
                avatarNode.value.rotationQuaternion ?? Quaternion.Identity(),
            );
            const support = checkSupport(deltaTime);
            // State transitions
            if (characterState.value === "IN_AIR") {
                if (
                    support?.supportedState ===
                    CharacterSupportedState.SUPPORTED
                ) {
                    characterState.value = "ON_GROUND";
                }
            } else if (characterState.value === "ON_GROUND") {
                if (
                    support?.supportedState !==
                    CharacterSupportedState.SUPPORTED
                ) {
                    characterState.value = "IN_AIR";
                } else if (ks.jump && !prevJumpPressed) {
                    characterState.value = "START_JUMP";
                }
            } else if (characterState.value === "START_JUMP") {
                characterState.value = "IN_AIR";
            }

            // Desired velocity by state
            if (characterState.value === "IN_AIR") {
                const desiredVelocity = moveDirection
                    .scale(currentSpeed)
                    .applyRotationQuaternion(
                        avatarNode.value.rotationQuaternion ??
                            Quaternion.Identity(),
                    );
                // Use controller.calculateMovement to compute horizontal control
                const outputVelocity =
                    characterController.value?.calculateMovement(
                        deltaTime,
                        forwardWorld,
                        (support?.averageSurfaceNormal as Vector3) ?? upWorld,
                        currentVelocity,
                        (support?.averageSurfaceVelocity as Vector3) ??
                            Vector3.Zero(),
                        desiredVelocity,
                        upWorld,
                    );
                // Restore original vertical component and add gravity so we fall
                if (outputVelocity) {
                    // Remove any vertical that calculateMovement introduced and restore current vertical
                    outputVelocity.addInPlace(
                        upWorld.scale(
                            currentVelocity.dot(upWorld) -
                                outputVelocity.dot(upWorld),
                        ),
                    );
                    // Add gravity over dt
                    const gravityVec = isFlying.value
                        ? Vector3.Zero()
                        : new Vector3(
                              props.gravity[0],
                              props.gravity[1],
                              props.gravity[2],
                          );
                    outputVelocity.addInPlace(gravityVec.scale(deltaTime));
                    setVelocity(outputVelocity);
                }
            } else if (
                characterState.value === "ON_GROUND" ||
                characterState.value === "START_JUMP"
            ) {
                const desiredVelocity = moveDirection
                    .scale(currentSpeed)
                    .applyRotationQuaternion(
                        avatarNode.value.rotationQuaternion ??
                            Quaternion.Identity(),
                    );
                const outputVelocity =
                    characterController.value?.calculateMovement(
                        deltaTime,
                        forwardWorld,
                        upWorld,
                        currentVelocity,
                        desiredVelocity,
                        Vector3.Zero(),
                        upWorld,
                    );
                if (outputVelocity) setVelocity(outputVelocity);

                if (characterState.value === "START_JUMP") {
                    const gravityLen = new Vector3(
                        props.gravity[0],
                        props.gravity[1],
                        props.gravity[2],
                    ).length();
                    const jumpHeight = Math.max(0.5, jumpSpeed.value * 0.2);
                    const u = Math.sqrt(2 * gravityLen * jumpHeight);
                    const curRelVel = currentVelocity.dot(upWorld);
                    newVelocity = currentVelocity.add(
                        upWorld.scale(u - curRelVel),
                    );
                    setVelocity(newVelocity);
                }
            }
        }

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
        // Track airborne state and vertical velocity for animation selection
        const velForAnim = getVelocity() ?? Vector3.Zero();
        lastVerticalVelocity.value = velForAnim.y;
        lastAirborne.value =
            support?.supportedState !== CharacterSupportedState.SUPPORTED;

        // Debug logging for physics state
        if (support) {
            lastSupportState.value = support.supportedState;
            if (
                support.supportedState === CharacterSupportedState.SUPPORTED &&
                !hasTouchedGround.value
            ) {
                hasTouchedGround.value = true;
                console.log(
                    "[BabylonMyAvatar] Character has touched ground for the first time",
                );
            }
        }

        // (debug logging moved to top-level overlay)

        // Auto-enable flight when spawn unsupported until first ground touch
        // No auto-flight engagement; flight is manual only

        prevJumpPressed = jumpPressed;

        // Removed spawn settle and landing snap logic to simplify physics

        // Periodic ground probe (raycast straight down), skip own capsule and meshes
        groundProbeTimer += deltaTime;
        if (groundProbeTimer >= groundProbeIntervalSec) {
            groundProbeTimer = 0;
            const pos = getPosition() ?? avatarNode.value.position;
            const origin = pos.add(
                new Vector3(0, 0.25 * capsuleHeight.value, 0),
            );
            const ray = new Ray(origin, new Vector3(0, -1, 0), 100);
            const pick = props.scene.pickWithRay(
                ray,
                (m) =>
                    m.name !== "avatarCapsule" &&
                    !isMeshUnderAvatar(m as AbstractMesh),
            );
            if (pick?.hit && pick.pickedPoint) {
                groundProbeHit.value = true;
                const bottomY = pos.y - capsuleHeight.value * 0.5;
                groundProbeDistance.value = bottomY - pick.pickedPoint.y;
                groundProbeMeshName.value = pick.pickedMesh?.name || null;
            } else {
                groundProbeHit.value = false;
                groundProbeDistance.value = null;
                groundProbeMeshName.value = null;
            }
        }

        // Landing assist removed

        // With updated support/airborne we can now select and blend animations to avoid snapping on landing
        refreshDesiredAnimations();
        updateAnimationBlending(isMoving, deltaTime, props.isTalking);

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