<template>
    <slot
        v-for="otherFullSessionId in otherAvatarSessionIds"
        :key="otherFullSessionId"
        :session-id="otherFullSessionId"
        :avatar-data="avatarDataMap[otherFullSessionId]"
        :position-data="positionDataMap[otherFullSessionId]"
        :rotation-data="rotationDataMap[otherFullSessionId]"
        :joint-data="jointDataMap[otherFullSessionId]"
        :on-ready="() => markLoaded(otherFullSessionId)"
        :on-dispose="() => markDisposed(otherFullSessionId)"
    />
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, toRefs } from "vue";

import type {
    AvatarJointMetadata,
    AvatarBaseData,
    AvatarPositionData,
    AvatarRotationData,
} from "@schemas";
import {
    parseAvatarPosition,
    parseAvatarRotation,
    parseAvatarJoint,
} from "@schemas";
import type { useVircadia } from "@vircadia/world-sdk/browser/vue";

// No external emits needed

const props = defineProps({
    scene: { type: Object, required: true },
    vircadiaWorld: {
        type: Object as () => ReturnType<typeof useVircadia>,
        required: true,
    },
    currentFullSessionId: {
        type: String,
        required: false,
        default: null,
    },
    discoveryPollingInterval: {
        type: Number,
        required: true,
    },
    positionPollingInterval: {
        type: Number,
        required: true,
    },
    rotationPollingInterval: {
        type: Number,
        required: true,
    },
    jointPollingInterval: {
        type: Number,
        required: true,
    },
    cameraPollingInterval: {
        type: Number,
        required: true,
    },
});
const { scene } = toRefs(props);
// Mark as used in template
void scene;

// Vircadia context

function ensure<T = unknown>(value: unknown, message: string): T {
    if (value == null) throw new Error(message);
    return value as T;
}

const vircadiaWorld = ensure<ReturnType<typeof useVircadia>>(
    props.vircadiaWorld,
    "Vircadia instance not found in BabylonOtherAvatars",
);

// Helper: parse JSON-like values that may arrive as strings
function parseMaybeJson<T = unknown>(value: unknown): T | null {
    if (value == null) return null;
    if (typeof value === "string") {
        try {
            return JSON.parse(value) as T;
        } catch {
            return null;
        }
    }
    return value as T;
}

// Discovered other avatar full session IDs (sessionId-instanceId format)
const otherAvatarSessionIds = ref<string[]>([]);

// Legacy combined metadata removed

// Separated data maps for all discovered avatars
const avatarDataMap = ref<Record<string, AvatarBaseData>>({});
const positionDataMap = ref<Record<string, AvatarPositionData>>({});
const rotationDataMap = ref<Record<string, AvatarRotationData>>({});
const jointDataMap = ref<Record<string, Map<string, AvatarJointMetadata>>>({});

// Track last poll timestamps for incremental updates
const lastPollTimestamps = ref<Record<string, Date | null>>({});

// Polling error/metrics tracking to surface in debug overlay
type PollCounter = {
    lastDurationMs: number;
    rows: number;
    timeouts: number;
    errors: number;
    lastError: string | null;
    lastErrorAt: Date | null;
};
const pollStats = ref({
    discovery: {
        lastDurationMs: 0,
        rows: 0,
        timeouts: 0,
        errors: 0,
        lastError: null as string | null,
        lastErrorAt: null as Date | null,
    } as PollCounter,
    posRot: {} as Record<string, PollCounter>,
    camera: {} as Record<string, PollCounter>,
    joints: {} as Record<string, PollCounter>,
});
function ensureCounter(
    map: Record<string, PollCounter>,
    key: string,
): PollCounter {
    if (!map[key])
        map[key] = {
            lastDurationMs: 0,
            rows: 0,
            timeouts: 0,
            errors: 0,
            lastError: null,
            lastErrorAt: null,
        };
    return map[key];
}

// Polling configuration provided by props (separate intervals per data type)
// Use the faster of position/rotation for the combined poll loop
const positionRotationPollingMs = computed(() =>
    Math.min(props.positionPollingInterval, props.rotationPollingInterval),
);

// Polling intervals and state
let positionRotationPollInterval: number | null = null;
let cameraPollInterval: number | null = null;
let jointPollInterval: number | null = null;
let isPollingPositionRotation = false;
let isPollingCamera = false;
let isPollingJoints = false;

// Removed v-model sync for combined metadata

// Track loading state per discovered session
const loadingBySession = ref<Record<string, boolean>>({});

function markLoaded(sessionId: string): void {
    loadingBySession.value[sessionId] = false;
}

function markDisposed(sessionId: string): void {
    delete loadingBySession.value[sessionId];
}

// Helper: retrieve selected metadata keys for an entity
async function retrieveSelectedMetadata(
    entityName: string,
    keys: string[],
): Promise<Map<string, unknown> | null> {
    try {
        const placeholders = keys.map((_, i) => `$${i + 2}`).join(", ");
        const metadataResult =
            await vircadiaWorld.client.Utilities.Connection.query({
                query: `SELECT metadata__key, metadata__value FROM entity.entity_metadata WHERE general__entity_name = $1 AND metadata__key IN (${placeholders})`,
                parameters: [entityName, ...keys],
            });
        if (Array.isArray(metadataResult.result)) {
            const metadataMap = new Map<string, unknown>();
            for (const row of metadataResult.result) {
                metadataMap.set(row.metadata__key, row.metadata__value);
            }
            return metadataMap;
        }
    } catch (e) {
        console.error("Failed to retrieve selected metadata:", e);
    }
    return null;
}

// Initial base metadata fetch for a newly discovered avatar
async function fetchInitialAvatarMetadata(sessionId: string) {
    const entityName = `avatar:${sessionId}`;
    const baseKeys = [
        "type",
        "sessionId",
        "cameraOrientation",
        "modelFileName",
        "position",
        "rotation",
    ];
    const metadata = await retrieveSelectedMetadata(entityName, baseKeys);
    if (!metadata || metadata.size === 0) return;

    try {
        const metaObj = Object.fromEntries(metadata);
        // Update maps directly without combined schema
        avatarDataMap.value[sessionId] = {
            type: "avatar",
            sessionId: (metaObj["sessionId"] as string) ?? sessionId,
            cameraOrientation: (parseMaybeJson<{
                alpha: number;
                beta: number;
                radius: number;
            }>(metaObj["cameraOrientation"]) as {
                alpha: number;
                beta: number;
                radius: number;
            }) ?? {
                alpha: -Math.PI / 2,
                beta: Math.PI / 3,
                radius: 5,
            },
            modelFileName:
                (metaObj["modelFileName"] as string) ?? "babylon.avatar.glb",
        } as AvatarBaseData;
        const posParsed = parseAvatarPosition(
            metaObj["position"],
        ) as AvatarPositionData | null;
        const pos: AvatarPositionData = posParsed ?? {
            x: 0,
            y: 0,
            z: -5,
        };
        (positionDataMap.value as Record<string, AvatarPositionData>)[
            sessionId
        ] = pos;
        const rotParsed = parseAvatarRotation(
            metaObj["rotation"],
        ) as AvatarRotationData | null;
        const rot: AvatarRotationData = rotParsed ?? {
            x: 0,
            y: 0,
            z: 0,
            w: 1,
        };
        (rotationDataMap.value as Record<string, AvatarRotationData>)[
            sessionId
        ] = rot;
    } catch (err) {
        console.warn(
            `Failed to parse initial avatar metadata for session ${sessionId}:`,
            err,
        );
    }
}

// Incremental timestamp tracking for specific polls
const lastBasePollTimestamps = ref<Record<string, Date | null>>({});
const lastCameraPollTimestamps = ref<Record<string, Date | null>>({});

// Poll only position and rotation for all discovered avatars
async function pollPositionRotation() {
    if (
        vircadiaWorld.connectionInfo.value.status !== "connected" ||
        isPollingPositionRotation
    ) {
        return;
    }
    isPollingPositionRotation = true;
    try {
        for (const sessionId of otherAvatarSessionIds.value) {
            const entityName = `avatar:${sessionId}`;

            const lastTimestamp = lastBasePollTimestamps.value[sessionId];
            const keys = ["position", "rotation"];
            let query: string;
            let params: unknown[];
            if (lastTimestamp) {
                const bufferedTimestamp = new Date(
                    lastTimestamp.getTime() - 50,
                );
                query = `SELECT metadata__key, metadata__value, general__updated_at FROM entity.entity_metadata WHERE general__entity_name = $1 AND metadata__key IN ($2, $3) AND general__updated_at > $4 ORDER BY general__updated_at ASC`;
                params = [
                    entityName,
                    keys[0],
                    keys[1],
                    bufferedTimestamp.toISOString(),
                ];
            } else {
                query = `SELECT metadata__key, metadata__value, general__updated_at FROM entity.entity_metadata WHERE general__entity_name = $1 AND metadata__key IN ($2, $3) ORDER BY general__updated_at ASC`;
                params = [entityName, keys[0], keys[1]];
            }

            try {
                const t0 = performance.now();
                const res =
                    await vircadiaWorld.client.Utilities.Connection.query({
                        query,
                        parameters: params,
                        timeoutMs: 10000,
                    });

                let newest: Date | null = lastTimestamp ?? null;
                let rowsProcessed = 0;
                if (Array.isArray(res.result)) {
                    rowsProcessed = res.result.length;
                    for (const row of res.result) {
                        if (row.metadata__key === "position") {
                            const parsed = parseMaybeJson<AvatarPositionData>(
                                row.metadata__value,
                            );
                            if (parsed) {
                                positionDataMap.value[sessionId] = parsed;
                            }
                        } else if (row.metadata__key === "rotation") {
                            const parsed = parseMaybeJson<AvatarRotationData>(
                                row.metadata__value,
                            );
                            if (parsed) {
                                rotationDataMap.value[sessionId] = parsed;
                            }
                        }
                        if (row.general__updated_at) {
                            const ut = new Date(row.general__updated_at);
                            if (!newest || ut > newest) newest = ut;
                        }
                    }
                }
                if (newest) lastBasePollTimestamps.value[sessionId] = newest;
                const counter = ensureCounter(
                    pollStats.value.posRot,
                    sessionId,
                );
                counter.lastDurationMs = Math.round(performance.now() - t0);
                counter.rows += rowsProcessed;
            } catch (err) {
                const counter = ensureCounter(
                    pollStats.value.posRot,
                    sessionId,
                );
                if (err instanceof Error && err.message.includes("timeout")) {
                    counter.timeouts += 1;
                } else {
                    counter.errors += 1;
                    counter.lastError = String(err);
                    counter.lastErrorAt = new Date();
                    console.error(
                        `Error polling position/rotation for ${sessionId}:`,
                        err,
                    );
                }
            }
        }
    } finally {
        isPollingPositionRotation = false;
    }
}

// Poll only camera orientation for all discovered avatars
async function pollCameraOrientation() {
    if (
        vircadiaWorld.connectionInfo.value.status !== "connected" ||
        isPollingCamera
    ) {
        return;
    }
    isPollingCamera = true;
    try {
        for (const sessionId of otherAvatarSessionIds.value) {
            const entityName = `avatar:${sessionId}`;
            const lastTimestamp = lastCameraPollTimestamps.value[sessionId];

            let query: string;
            let params: unknown[];
            if (lastTimestamp) {
                const bufferedTimestamp = new Date(
                    lastTimestamp.getTime() - 50,
                );
                query = `SELECT metadata__value, general__updated_at FROM entity.entity_metadata WHERE general__entity_name = $1 AND metadata__key = $2 AND general__updated_at > $3 ORDER BY general__updated_at ASC`;
                params = [
                    entityName,
                    "cameraOrientation",
                    bufferedTimestamp.toISOString(),
                ];
            } else {
                query = `SELECT metadata__value, general__updated_at FROM entity.entity_metadata WHERE general__entity_name = $1 AND metadata__key = $2 ORDER BY general__updated_at ASC`;
                params = [entityName, "cameraOrientation"];
            }

            try {
                const t0 = performance.now();
                const res =
                    await vircadiaWorld.client.Utilities.Connection.query({
                        query,
                        parameters: params,
                        timeoutMs: 10000,
                    });

                let newest: Date | null = lastTimestamp ?? null;
                if (Array.isArray(res.result) && res.result.length > 0) {
                    // Use latest
                    const lastRow = res.result[res.result.length - 1];
                    const base = avatarDataMap.value[sessionId] as
                        | AvatarBaseData
                        | undefined;
                    if (base) {
                        // Write back to avatarDataMap without touching position/rotation
                        avatarDataMap.value[sessionId] = {
                            ...(avatarDataMap.value[sessionId] ||
                                ({} as AvatarBaseData)),
                            type: "avatar",
                            sessionId: base.sessionId ?? sessionId,
                            modelFileName:
                                (avatarDataMap.value[sessionId]
                                    ?.modelFileName as string) ||
                                "babylon.avatar.glb",
                            cameraOrientation:
                                (parseMaybeJson<{
                                    alpha: number;
                                    beta: number;
                                    radius: number;
                                }>(lastRow.metadata__value) as {
                                    alpha: number;
                                    beta: number;
                                    radius: number;
                                }) || base.cameraOrientation,
                        } as AvatarBaseData;
                    }
                    if (lastRow.general__updated_at) {
                        const ut = new Date(lastRow.general__updated_at);
                        newest = !newest || ut > newest ? ut : newest;
                    }
                }
                if (newest) lastCameraPollTimestamps.value[sessionId] = newest;
                const counter = ensureCounter(
                    pollStats.value.camera,
                    sessionId,
                );
                counter.lastDurationMs = Math.round(performance.now() - t0);
                counter.rows += Array.isArray(res.result)
                    ? res.result.length
                    : 0;
            } catch (err) {
                const counter = ensureCounter(
                    pollStats.value.camera,
                    sessionId,
                );
                if (err instanceof Error && err.message.includes("timeout")) {
                    counter.timeouts += 1;
                } else {
                    counter.errors += 1;
                    counter.lastError = String(err);
                    counter.lastErrorAt = new Date();
                    console.error(
                        `Error polling camera orientation for ${sessionId}:`,
                        err,
                    );
                }
            }
        }
    } finally {
        isPollingCamera = false;
    }
}

// Poll for joint data from the server (skeleton bones) for all discovered avatars
async function pollJointData() {
    if (
        !vircadiaWorld ||
        vircadiaWorld.connectionInfo.value.status !== "connected" ||
        isPollingJoints
    ) {
        return;
    }

    isPollingJoints = true;

    try {
        // Process each discovered avatar
        for (const sessionId of otherAvatarSessionIds.value) {
            const entityName = `avatar:${sessionId}`;

            try {
                // First check if entity exists
                const t0 = performance.now();
                const entityResult =
                    await vircadiaWorld.client.Utilities.Connection.query({
                        query: "SELECT general__entity_name FROM entity.entities WHERE general__entity_name = $1",
                        parameters: [entityName],
                        timeoutMs: 20000,
                    });

                if (
                    Array.isArray(entityResult.result) &&
                    entityResult.result.length > 0
                ) {
                    // Fetch joint metadata - only fetch updates since last poll
                    let jointQuery: string;
                    let jointParameters: unknown[];

                    const lastTimestamp = lastPollTimestamps.value[sessionId];

                    if (lastTimestamp) {
                        // Incremental update - only fetch joints updated since last poll
                        const bufferedTimestamp = new Date(
                            lastTimestamp.getTime() - 100,
                        );

                        jointQuery = `
                            SELECT metadata__key, metadata__value, general__updated_at
                            FROM entity.entity_metadata
                            WHERE general__entity_name = $1
                            AND metadata__key LIKE 'joint:%'
                            AND general__updated_at > $2
                            ORDER BY general__updated_at DESC
                            LIMIT 100`;
                        jointParameters = [
                            entityName,
                            bufferedTimestamp.toISOString(),
                        ];
                    } else {
                        // Initial fetch - get all joints but limit for performance
                        jointQuery = `
                            SELECT metadata__key, metadata__value, general__updated_at
                            FROM entity.entity_metadata
                            WHERE general__entity_name = $1
                            AND metadata__key LIKE 'joint:%'
                            ORDER BY general__updated_at DESC
                            LIMIT 200`;
                        jointParameters = [entityName];
                    }

                    const jointResult =
                        await vircadiaWorld.client.Utilities.Connection.query({
                            query: jointQuery,
                            parameters: jointParameters,
                            timeoutMs: 15000,
                        });

                    // If this is an incremental update, start with existing joints
                    const joints = lastTimestamp
                        ? new Map(jointDataMap.value[sessionId] || new Map())
                        : new Map<string, AvatarJointMetadata>();

                    let newestUpdateTime: Date | null = lastTimestamp;

                    let rowsProcessed = 0;
                    if (Array.isArray(jointResult.result)) {
                        rowsProcessed = jointResult.result.length;
                        for (const row of jointResult.result) {
                            try {
                                // Joint metadata can arrive as a JSON string from PG; parse safely and enrich
                                const key: string = row.metadata__key as string;
                                const jointNameFromKey = key.startsWith(
                                    "joint:",
                                )
                                    ? key.substring("joint:".length)
                                    : key;

                                // First attempt: direct safe parse
                                let jointData = parseAvatarJoint(
                                    row.metadata__value,
                                );

                                // If missing required fields or failed, try enriching with context
                                if (!jointData) {
                                    let rawObj: unknown = row.metadata__value;
                                    if (typeof rawObj === "string") {
                                        try {
                                            rawObj = JSON.parse(rawObj);
                                        } catch {
                                            rawObj = {};
                                        }
                                    }
                                    jointData = parseAvatarJoint({
                                        type: "avatarJoint",
                                        sessionId,
                                        jointName: jointNameFromKey,
                                        ...(rawObj as Record<string, unknown>),
                                    });
                                }

                                if (jointData) {
                                    joints.set(
                                        jointData.jointName,
                                        jointData as unknown as AvatarJointMetadata,
                                    );
                                } else {
                                    throw new Error(
                                        `Invalid joint payload after enrichment for ${jointNameFromKey}`,
                                    );
                                }

                                // Track the newest update time
                                if (row.general__updated_at) {
                                    const updateTime = new Date(
                                        row.general__updated_at,
                                    );
                                    if (
                                        !newestUpdateTime ||
                                        updateTime > newestUpdateTime
                                    ) {
                                        newestUpdateTime = updateTime;
                                    }
                                }
                            } catch (parseError) {
                                console.warn(
                                    `Failed to parse joint metadata for ${row.metadata__key} (session: ${sessionId}):`,
                                    parseError,
                                );
                            }
                        }

                        // Update the joint data map
                        jointDataMap.value[sessionId] = joints;

                        // Update the last poll timestamp
                        if (newestUpdateTime) {
                            lastPollTimestamps.value[sessionId] =
                                newestUpdateTime;
                        } else if (!lastTimestamp) {
                            // If no joints were found and this is the first poll, set to current time
                            lastPollTimestamps.value[sessionId] = new Date();
                        }
                        const counter = ensureCounter(
                            pollStats.value.joints,
                            sessionId,
                        );
                        counter.lastDurationMs = Math.round(
                            performance.now() - t0,
                        );
                        counter.rows += rowsProcessed;
                    } else {
                        console.warn(
                            `Invalid joint query result for ${sessionId}: expected array, got ${typeof jointResult.result}`,
                        );
                    }
                } else {
                    // Avatar entity not found - remove from our maps
                    delete avatarDataMap.value[sessionId];
                    delete positionDataMap.value[sessionId];
                    delete rotationDataMap.value[sessionId];
                    delete jointDataMap.value[sessionId];
                    delete lastPollTimestamps.value[sessionId];
                }
            } catch (error) {
                // Handle different types of errors appropriately
                if (error instanceof Error) {
                    if (error.message.includes("timeout")) {
                        const counter = ensureCounter(
                            pollStats.value.joints,
                            sessionId,
                        );
                        counter.timeouts += 1;
                        console.debug(
                            `Joint data query timed out for session ${sessionId}, will retry. Last successful poll: ${lastPollTimestamps.value[sessionId]?.toISOString() || "never"}`,
                        );
                    } else if (
                        error.message.includes("connection") ||
                        error.message.includes("network")
                    ) {
                        const counter = ensureCounter(
                            pollStats.value.joints,
                            sessionId,
                        );
                        counter.errors += 1;
                        counter.lastError = error.message;
                        counter.lastErrorAt = new Date();
                        console.warn(
                            `Network error polling joint data for session ${sessionId}: ${error.message}`,
                        );
                    } else {
                        const counter = ensureCounter(
                            pollStats.value.joints,
                            sessionId,
                        );
                        counter.errors += 1;
                        counter.lastError = String(error);
                        counter.lastErrorAt = new Date();
                        console.error(
                            `Error polling joint data for session ${sessionId}:`,
                            error,
                        );
                    }
                } else {
                    const counter = ensureCounter(
                        pollStats.value.joints,
                        sessionId,
                    );
                    counter.errors += 1;
                    counter.lastError = String(error);
                    counter.lastErrorAt = new Date();
                    console.error(
                        `Unknown error polling joint data for session ${sessionId}:`,
                        error,
                    );
                }
            }
        }
    } finally {
        isPollingJoints = false;
    }
}

// Start polling when connected
function startDataPolling() {
    if (
        positionRotationPollInterval ||
        cameraPollInterval ||
        jointPollInterval
    ) {
        return;
    }

    // Initial polls
    pollPositionRotation();
    pollCameraOrientation();
    pollJointData();

    // Poll position/rotation fast
    positionRotationPollInterval = setInterval(
        pollPositionRotation,
        positionRotationPollingMs.value,
    );
    // Poll camera orientation separately
    cameraPollInterval = setInterval(
        pollCameraOrientation,
        props.cameraPollingInterval,
    );
    // Poll joints separately
    jointPollInterval = setInterval(pollJointData, props.jointPollingInterval);

    console.debug(
        `Started avatar polling: pos/rot ${positionRotationPollingMs.value}ms, camera ${props.cameraPollingInterval}ms, joints ${props.jointPollingInterval}ms`,
    );
}

// Stop polling
function stopDataPolling() {
    if (positionRotationPollInterval) {
        clearInterval(positionRotationPollInterval);
        positionRotationPollInterval = null;
    }

    if (cameraPollInterval) {
        clearInterval(cameraPollInterval);
        cameraPollInterval = null;
    }

    if (jointPollInterval) {
        clearInterval(jointPollInterval);
        jointPollInterval = null;
    }
}

// Avoid unused warnings in templates-only usage
void markLoaded;
void markDisposed;

// Polling interval id
let avatarDiscoveryInterval: number | null = null;

// Discover other avatars present in the world
async function pollForOtherAvatars(): Promise<void> {
    if (vircadiaWorld.connectionInfo.value.status !== "connected") {
        return;
    }

    try {
        const t0 = performance.now();
        const query =
            "SELECT general__entity_name FROM entity.entities WHERE general__entity_name LIKE 'avatar:%'";

        const result = await vircadiaWorld.client.Utilities.Connection.query({
            query,
            timeoutMs: 30000,
        });

        if (result.result && Array.isArray(result.result)) {
            const currentFullSessionId = props.currentFullSessionId;
            const foundFullSessionIds: string[] = [];
            const entities = result.result as Array<{
                general__entity_name: string;
            }>;

            console.log(
                "[OtherAvatars] Current full session ID:",
                currentFullSessionId,
                "Found entities:",
                entities.length,
            );
            for (const entity of entities) {
                const match =
                    entity.general__entity_name.match(/^avatar:(.+)$/);
                if (match) {
                    // match[1] contains the full sessionId-instanceId
                    const isOurs = match[1] === currentFullSessionId;
                    console.log(
                        "[OtherAvatars] Found avatar:",
                        entity.general__entity_name,
                        "Session ID:",
                        match[1],
                        "Is ours:",
                        isOurs,
                        "Is other:",
                        !isOurs,
                    );
                }
                if (match && match[1] !== currentFullSessionId) {
                    foundFullSessionIds.push(match[1]);
                    // Initialize loading state for new sessions
                    if (!(match[1] in loadingBySession.value)) {
                        loadingBySession.value[match[1]] = true;
                    }

                    // Initialize data structures for new avatars
                    if (!avatarDataMap.value[match[1]]) {
                        // Fetch initial base metadata once
                        fetchInitialAvatarMetadata(match[1]).catch((e) =>
                            console.warn(
                                `Initial metadata fetch failed for ${match[1]}:`,
                                e,
                            ),
                        );
                    }
                    if (!jointDataMap.value[match[1]]) {
                        jointDataMap.value[match[1]] = new Map<
                            string,
                            AvatarJointMetadata
                        >();
                    }
                    if (!lastPollTimestamps.value[match[1]]) {
                        lastPollTimestamps.value[match[1]] = null;
                    }
                    if (!lastBasePollTimestamps.value[match[1]]) {
                        lastBasePollTimestamps.value[match[1]] = null;
                    }
                    if (!lastCameraPollTimestamps.value[match[1]]) {
                        lastCameraPollTimestamps.value[match[1]] = null;
                    }
                }
            }

            // Update list with found full session IDs
            otherAvatarSessionIds.value = foundFullSessionIds;
            // Update discovery stats
            pollStats.value.discovery.lastDurationMs = Math.round(
                performance.now() - t0,
            );
            pollStats.value.discovery.rows += entities.length;

            // Remove avatars that are no longer present
            for (const fullSessionId of Object.keys(avatarDataMap.value)) {
                if (!foundFullSessionIds.includes(fullSessionId)) {
                    delete loadingBySession.value[fullSessionId];
                    delete avatarDataMap.value[fullSessionId];
                    delete positionDataMap.value[fullSessionId];
                    delete rotationDataMap.value[fullSessionId];
                    delete jointDataMap.value[fullSessionId];
                    delete lastPollTimestamps.value[fullSessionId];
                    delete lastBasePollTimestamps.value[fullSessionId];
                    delete lastCameraPollTimestamps.value[fullSessionId];
                }
            }
        }
    } catch (error) {
        if (error instanceof Error && error.message.includes("timeout")) {
            pollStats.value.discovery.timeouts += 1;
            console.debug(
                "[OtherAvatars] Discovery query timed out, will retry",
            );
        } else {
            pollStats.value.discovery.errors += 1;
            pollStats.value.discovery.lastError = String(error);
            pollStats.value.discovery.lastErrorAt = new Date();
            console.warn(
                "[OtherAvatars] Error polling for other avatars:",
                error,
            );
        }
    }
}

function startAvatarDiscovery(): void {
    if (avatarDiscoveryInterval) return;
    // Poll immediately, then at configured interval
    pollForOtherAvatars();
    avatarDiscoveryInterval = setInterval(
        pollForOtherAvatars,
        props.discoveryPollingInterval,
    );
}

function stopAvatarDiscovery(): void {
    if (avatarDiscoveryInterval) {
        clearInterval(avatarDiscoveryInterval);
        avatarDiscoveryInterval = null;
    }
}

// Manage lifecycle via connection status
watch(
    () => vircadiaWorld.connectionInfo.value.status,
    (status) => {
        if (status === "connected") {
            startAvatarDiscovery();
            startDataPolling();
        } else if (status === "disconnected") {
            stopAvatarDiscovery();
            stopDataPolling();
            otherAvatarSessionIds.value = [];
            avatarDataMap.value = {};
            positionDataMap.value = {};
            rotationDataMap.value = {};
            jointDataMap.value = {};
            lastPollTimestamps.value = {};
            lastBasePollTimestamps.value = {};
            lastCameraPollTimestamps.value = {};
            loadingBySession.value = {};
        }
    },
    { immediate: true },
);

onMounted(() => {
    if (vircadiaWorld.connectionInfo.value.status === "connected") {
        startAvatarDiscovery();
        startDataPolling();
    }
});

onUnmounted(() => {
    stopAvatarDiscovery();
    stopDataPolling();
});

// Expose loading state for parent (true if any discovered session still loading)
const isLoading = computed<boolean>(() => {
    for (const sessionId of otherAvatarSessionIds.value) {
        if (loadingBySession.value[sessionId] !== false) return true;
    }
    return false;
});

defineExpose({
    isLoading,
    otherAvatarSessionIds,
    avatarDataMap,
    positionDataMap,
    rotationDataMap,
    jointDataMap,
    lastPollTimestamps,
    lastBasePollTimestamps,
    lastCameraPollTimestamps,
    pollStats,
    isPollingPositionRotation: computed(() => isPollingPositionRotation),
    isPollingCamera: computed(() => isPollingCamera),
    isPollingJoints: computed(() => isPollingJoints),
});
</script>

