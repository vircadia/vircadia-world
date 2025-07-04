<template>
    <div v-if="visible" class="debug-overlay">
        <div class="debug-header">
            <h3>Avatar Joint Debug</h3>
            <button @click="$emit('close')" class="close-btn">×</button>
        </div>
        
        <div class="debug-content">
            <!-- My Avatar Panel -->
            <div class="avatar-panel my-avatar">
                <h4>My Avatar</h4>
                <div class="session-id">Session: {{ myAvatarData.sessionId }}</div>
                <div class="bone-count">Bones: {{ myAvatarData.boneCount }}</div>
                
                <!-- Position and Rotation Controls -->
                <div class="transform-controls">
                    <h5>Transform</h5>
                    
                    <!-- Position Inputs -->
                    <div class="control-group">
                        <label>Position:</label>
                        <div class="input-row">
                            <v-text-field
                                v-model.number="editPosition.x"
                                label="X"
                                type="number"
                                step="0.1"
                                hide-details
                                density="compact"
                                variant="outlined"
                                @keyup.enter="applyTransform"
                            />
                            <v-text-field
                                v-model.number="editPosition.y"
                                label="Y"
                                type="number"
                                step="0.1"
                                hide-details
                                density="compact"
                                variant="outlined"
                                @keyup.enter="applyTransform"
                            />
                            <v-text-field
                                v-model.number="editPosition.z"
                                label="Z"
                                type="number"
                                step="0.1"
                                hide-details
                                density="compact"
                                variant="outlined"
                                @keyup.enter="applyTransform"
                            />
                        </div>
                        <div class="current-value">Current: {{ formatVector(myAvatarData.position || { x: 0, y: 0, z: 0 }) }}</div>
                    </div>
                    
                    <!-- Rotation Inputs (Quaternion) -->
                    <div class="control-group">
                        <label>Rotation (Quaternion):</label>
                        <div class="input-row quaternion">
                            <v-text-field
                                v-model.number="editRotation.x"
                                label="X"
                                type="number"
                                step="0.01"
                                hide-details
                                density="compact"
                                variant="outlined"
                                @keyup.enter="applyTransform"
                            />
                            <v-text-field
                                v-model.number="editRotation.y"
                                label="Y"
                                type="number"
                                step="0.01"
                                hide-details
                                density="compact"
                                variant="outlined"
                                @keyup.enter="applyTransform"
                            />
                            <v-text-field
                                v-model.number="editRotation.z"
                                label="Z"
                                type="number"
                                step="0.01"
                                hide-details
                                density="compact"
                                variant="outlined"
                                @keyup.enter="applyTransform"
                            />
                            <v-text-field
                                v-model.number="editRotation.w"
                                label="W"
                                type="number"
                                step="0.01"
                                hide-details
                                density="compact"
                                variant="outlined"
                                @keyup.enter="applyTransform"
                            />
                        </div>
                        <div class="current-value">Current: {{ formatRotation(myAvatarData.rotation || { x: 0, y: 0, z: 0, w: 1 }) }}</div>
                    </div>
                    
                    <div class="transform-buttons">
                        <v-btn
                            size="small"
                            color="primary"
                            @click="applyTransform"
                            :disabled="!canApplyTransform"
                        >
                            Apply
                        </v-btn>
                        <v-btn
                            size="small"
                            variant="outlined"
                            @click="resetTransform"
                        >
                            Reset
                        </v-btn>
                    </div>
                </div>
                
                <div class="joint-list">
                    <div v-for="[name, joint] in sortedJoints(myAvatarData.joints || {})" :key="name" 
                         :class="['joint-item', { 'primary-joint': isPrimaryJoint(name) }]">
                        <div class="joint-name">
                            {{ name }}
                            <span v-if="isPrimaryJoint(name)" class="primary-badge">SENT</span>
                        </div>
                        <div class="joint-data">
                            <span class="pos">P: {{ formatVector(joint.position) }}</span>
                            <span class="rot">R: {{ formatRotation(joint.rotation) }}</span>
                        </div>
                    </div>
                </div>
                
                <button @click="copyToClipboard('my')" class="copy-btn">Copy My Avatar Data</button>
            </div>
            
            <!-- Other Avatar Panel -->
            <div class="avatar-panel other-avatar">
                <h4>Other Avatar</h4>
                <div class="session-id">Session: {{ otherAvatarData.sessionId }}</div>
                <div class="bone-count">Bones: {{ otherAvatarData.boneCount }}</div>
                <div v-if="otherAvatarData.lastReceivedTimestamp" class="last-received">
                    Last Received: {{ formatTimestamp(otherAvatarData.lastReceivedTimestamp) }}
                </div>
                
                <!-- Current Engine State -->
                <div class="data-section">
                    <h5>Current Engine State</h5>
                    <div class="joint-list">
                        <div v-for="[name, joint] in sortedJoints(otherAvatarData.currentEngineState || otherAvatarData.joints || {})" :key="`current-${name}`" 
                             :class="['joint-item', { 'primary-joint': isPrimaryJoint(name) }]">
                            <div class="joint-name">
                                {{ name }}
                                <span v-if="isPrimaryJoint(name)" class="primary-badge">SENT</span>
                            </div>
                            <div class="joint-data">
                                <span class="pos">P: {{ formatVector(joint.position) }}</span>
                                <span class="rot">R: {{ formatRotation(joint.rotation) }}</span>
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- Last Received Values (only show if different from current engine state) -->
                <div v-if="otherAvatarData.lastReceivedValues && Object.keys(otherAvatarData.lastReceivedValues).length > 0" class="data-section">
                    <h5>Last Received Values</h5>
                    <div class="joint-list">
                        <div v-for="[name, joint] in sortedJoints(otherAvatarData.lastReceivedValues)" :key="`received-${name}`" 
                             :class="['joint-item', 'received-data', { 'primary-joint': isPrimaryJoint(name) }]">
                            <div class="joint-name">
                                {{ name }}
                                <span v-if="isPrimaryJoint(name)" class="primary-badge">SENT</span>
                                <span class="data-badge">RAW</span>
                            </div>
                            <div class="joint-data">
                                <span class="pos">P: {{ formatVector(joint.position) }}</span>
                                <span class="rot">R: {{ formatRotation(joint.rotation) }}</span>
                            </div>
                        </div>
                    </div>
                </div>
                
                <button @click="copyToClipboard('other')" class="copy-btn">Copy Other Avatar Data</button>
            </div>
        </div>
        
        <div class="debug-footer">
            <label>
                <input type="checkbox" v-model="autoRefresh" />
                Auto-refresh ({{ appStore.pollingIntervals.debugOverlayRefresh }}ms)
            </label>
            <button @click="refreshData" class="refresh-btn">Refresh Now</button>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed } from "vue";
import { useAppStore } from "@/stores/appStore";

interface JointTransform {
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number; w: number };
    scale?: { x: number; y: number; z: number };
}

interface AvatarDebugData {
    sessionId: string;
    boneCount: number;
    position?: { x: number; y: number; z: number };
    rotation?: { x: number; y: number; z: number; w: number };
    joints?: Record<string, JointTransform>; // For backward compatibility with MyAvatar
    currentEngineState?: Record<string, JointTransform>; // For OtherAvatar current state
    lastReceivedValues?: Record<string, JointTransform>; // For OtherAvatar received values
    lastReceivedTimestamp?: string | null;
}

const props = defineProps({
    visible: {
        type: Boolean,
        default: true,
    },
});

const emit = defineEmits(["close"]);

const appStore = useAppStore();

// Data refs
const myAvatarData = ref<AvatarDebugData>({
    sessionId: "",
    boneCount: 0,
    joints: {},
});

const otherAvatarData = ref<AvatarDebugData>({
    sessionId: "",
    boneCount: 0,
    joints: {},
});

const autoRefresh = ref(true);
let refreshInterval: number | null = null;

// Key bones to focus on - these are the only ones being sent over network
const primaryKeyBones = ["Hips", "Spine", "LeftUpLeg", "RightUpLeg"];

// Additional bones for extended view (not currently sent)
const secondaryKeyBones = [
    "Spine1",
    "Spine2",
    "Neck",
    "Head",
    "LeftShoulder",
    "LeftArm",
    "LeftForeArm",
    "LeftHand",
    "RightShoulder",
    "RightArm",
    "RightForeArm",
    "RightHand",
    "LeftLeg",
    "LeftFoot",
    "RightLeg",
    "RightFoot",
];

const keyBones = [...primaryKeyBones, ...secondaryKeyBones];

// Editable position and rotation
const editPosition = ref({ x: 0, y: 0, z: 0 });
const editRotation = ref({ x: 0, y: 0, z: 0, w: 1 });

// Check if we can apply transform (i.e., values have changed)
const canApplyTransform = computed(() => {
    const pos = myAvatarData.value.position || { x: 0, y: 0, z: 0 };
    const rot = myAvatarData.value.rotation || { x: 0, y: 0, z: 0, w: 1 };

    return (
        editPosition.value.x !== pos.x ||
        editPosition.value.y !== pos.y ||
        editPosition.value.z !== pos.z ||
        editRotation.value.x !== rot.x ||
        editRotation.value.y !== rot.y ||
        editRotation.value.z !== rot.z ||
        editRotation.value.w !== rot.w
    );
});

// Format helpers
function formatVector(v: { x: number; y: number; z: number }): string {
    return `${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)}`;
}

function formatRotation(r: {
    x: number;
    y: number;
    z: number;
    w: number;
}): string {
    // Show quaternion components for debugging
    return `${r.x.toFixed(2)}, ${r.y.toFixed(2)}, ${r.z.toFixed(2)}, ${r.w.toFixed(2)}`;
}

function formatTimestamp(timestamp: string | null): string {
    if (!timestamp) return "N/A";
    const date = new Date(timestamp);
    return date.toLocaleString();
}

// Type for window with debug functions
interface DebugWindow extends Window {
    __debugMyAvatarData?: () => AvatarDebugData | null;
    __debugOtherAvatarData?: () => AvatarDebugData | null;
    __debugSetMyAvatarTransform?: (
        position: { x: number; y: number; z: number },
        rotation: { x: number; y: number; z: number; w: number },
    ) => void;
}

// Data collection from window globals
function refreshData() {
    // Collect My Avatar data
    const debugWindow = window as DebugWindow;
    if (debugWindow.__debugMyAvatarData) {
        const data = debugWindow.__debugMyAvatarData();
        if (data) {
            myAvatarData.value = {
                sessionId: data.sessionId,
                boneCount: data.boneCount,
                position: data.position,
                rotation: data.rotation,
                joints: data.joints ? filterKeyBones(data.joints) : {},
            };

            // Update edit fields with current values
            if (data.position) {
                editPosition.value = { ...data.position };
            }
            if (data.rotation) {
                editRotation.value = { ...data.rotation };
            }
        }
    }

    // Collect Other Avatar data
    if (debugWindow.__debugOtherAvatarData) {
        const data = debugWindow.__debugOtherAvatarData();
        if (data) {
            otherAvatarData.value = {
                sessionId: data.sessionId,
                boneCount: data.boneCount,
                joints: data.joints ? filterKeyBones(data.joints) : undefined,
                currentEngineState: data.currentEngineState
                    ? filterKeyBones(data.currentEngineState)
                    : undefined,
                lastReceivedValues: data.lastReceivedValues
                    ? filterKeyBones(data.lastReceivedValues)
                    : undefined,
                lastReceivedTimestamp: data.lastReceivedTimestamp,
            };
        }
    }
}

// Filter to show only key bones
function filterKeyBones(
    joints: Record<string, JointTransform>,
): Record<string, JointTransform> {
    const filtered: Record<string, JointTransform> = {};

    for (const [name, transform] of Object.entries(joints)) {
        // Check if this bone name contains any of our key bone names
        if (keyBones.some((keyBone) => name.includes(keyBone))) {
            filtered[name] = transform;
        }
    }

    return filtered;
}

// Check if a joint is a primary joint (being sent over network)
function isPrimaryJoint(jointName: string): boolean {
    return primaryKeyBones.some((keyBone) =>
        jointName.toLowerCase().includes(keyBone.toLowerCase()),
    );
}

// Sort joints to show primary ones first
function sortedJoints(
    joints: Record<string, JointTransform>,
): Array<[string, JointTransform]> {
    const entries = Object.entries(joints);

    // Sort so primary joints appear first
    return entries.sort(([nameA], [nameB]) => {
        const aPrimary = isPrimaryJoint(nameA);
        const bPrimary = isPrimaryJoint(nameB);

        if (aPrimary && !bPrimary) return -1;
        if (!aPrimary && bPrimary) return 1;

        // Within the same category, sort alphabetically
        return nameA.localeCompare(nameB);
    });
}

// Copy data to clipboard
function copyToClipboard(avatar: "my" | "other") {
    const data = avatar === "my" ? myAvatarData.value : otherAvatarData.value;
    const text = JSON.stringify(data, null, 2);

    navigator.clipboard
        .writeText(text)
        .then(() => {
            console.log(`Copied ${avatar} avatar data to clipboard`);
        })
        .catch((err) => {
            console.error("Failed to copy to clipboard:", err);
        });
}

// Auto-refresh management
watch(autoRefresh, (enabled) => {
    if (enabled) {
        startAutoRefresh();
    } else {
        stopAutoRefresh();
    }
});

function startAutoRefresh() {
    if (refreshInterval) return;
    refreshInterval = window.setInterval(
        refreshData,
        appStore.pollingIntervals.debugOverlayRefresh,
    );
    refreshData(); // Initial refresh
}

function stopAutoRefresh() {
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
    }
}

onMounted(() => {
    if (autoRefresh.value) {
        startAutoRefresh();
    }
});

onUnmounted(() => {
    stopAutoRefresh();
});

// Apply transform changes
function applyTransform() {
    const debugWindow = window as DebugWindow;
    if (debugWindow.__debugSetMyAvatarTransform) {
        debugWindow.__debugSetMyAvatarTransform(
            { ...editPosition.value },
            { ...editRotation.value },
        );

        // Refresh data to show the applied changes
        setTimeout(refreshData, 100);
    } else {
        console.error(
            "__debugSetMyAvatarTransform function not found on window",
        );
    }
}

// Reset transform to current values
function resetTransform() {
    const pos = myAvatarData.value.position || { x: 0, y: 0, z: 0 };
    const rot = myAvatarData.value.rotation || { x: 0, y: 0, z: 0, w: 1 };

    editPosition.value = { ...pos };
    editRotation.value = { ...rot };
}
</script>

<style scoped>
.debug-overlay {
    position: fixed;
    top: 10px;
    left: 10px;
    right: 10px;
    bottom: 10px;
    background: rgba(0, 0, 0, 0.9);
    border: 2px solid #0ff;
    border-radius: 8px;
    color: #fff;
    font-family: 'Courier New', monospace;
    font-size: 12px;
    z-index: 10000;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

.debug-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 15px;
    border-bottom: 1px solid #333;
    background: rgba(0, 255, 255, 0.1);
}

.debug-header h3 {
    margin: 0;
    color: #0ff;
}

.close-btn {
    background: none;
    border: 1px solid #f00;
    color: #f00;
    font-size: 20px;
    width: 30px;
    height: 30px;
    cursor: pointer;
    border-radius: 4px;
}

.close-btn:hover {
    background: rgba(255, 0, 0, 0.2);
}

.debug-content {
    flex: 1;
    display: flex;
    gap: 20px;
    padding: 20px;
    overflow: hidden;
}

.avatar-panel {
    flex: 1;
    border: 1px solid #444;
    border-radius: 4px;
    padding: 15px;
    overflow-y: auto;
    background: rgba(255, 255, 255, 0.05);
}

.my-avatar {
    border-color: #0f0;
}

.other-avatar {
    border-color: #f0f;
}

.avatar-panel h4 {
    margin: 0 0 10px 0;
    color: #0ff;
}

.session-id, .bone-count, .last-received {
    margin-bottom: 5px;
    color: #888;
    font-size: 11px;
}

.transform-controls {
    margin: 15px 0;
    padding: 15px;
    border: 1px solid #444;
    border-radius: 4px;
    background: rgba(0, 255, 0, 0.05);
}

.transform-controls h5 {
    margin: 0 0 15px 0;
    color: #0f0;
    font-size: 14px;
}

.control-group {
    margin-bottom: 20px;
}

.control-group label {
    display: block;
    margin-bottom: 8px;
    color: #0ff;
    font-size: 12px;
    font-weight: bold;
}

.input-row {
    display: flex;
    gap: 10px;
    margin-bottom: 5px;
}

.input-row.quaternion {
    /* Quaternion has 4 inputs, so make them slightly smaller */
}

.input-row :deep(.v-input) {
    flex: 1;
}

.input-row :deep(.v-field__input) {
    font-family: 'Courier New', monospace;
    font-size: 12px;
    color: #0f0;
}

.input-row :deep(.v-field--variant-outlined) {
    --v-field-border-color: #444;
}

.input-row :deep(.v-field--focused) {
    --v-field-border-color: #0ff;
}

.current-value {
    font-size: 11px;
    color: #888;
    margin-top: 2px;
    font-style: italic;
}

.transform-buttons {
    display: flex;
    gap: 10px;
    margin-top: 15px;
}

.transform-buttons :deep(.v-btn) {
    font-size: 12px;
}

.data-section {
    margin-top: 15px;
    border: 1px solid #333;
    border-radius: 4px;
    padding: 10px;
    background: rgba(255, 255, 255, 0.02);
}

.data-section h5 {
    margin: 0 0 10px 0;
    color: #ff0;
    font-size: 12px;
}

.joint-list {
    margin-top: 15px;
}

.joint-item {
    margin-bottom: 8px;
    padding: 5px;
    border: 1px solid #222;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.02);
}

.joint-item:hover {
    background: rgba(255, 255, 255, 0.05);
    border-color: #444;
}

.joint-item.primary-joint {
    border-color: #0ff;
    background: rgba(0, 255, 255, 0.05);
}

.joint-item.primary-joint:hover {
    background: rgba(0, 255, 255, 0.1);
    border-color: #0ff;
}

.joint-item.received-data {
    border-color: #f80;
    background: rgba(255, 136, 0, 0.05);
}

.joint-item.received-data:hover {
    background: rgba(255, 136, 0, 0.1);
    border-color: #f80;
}

.joint-name {
    font-weight: bold;
    color: #ff0;
    margin-bottom: 3px;
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.primary-badge {
    font-size: 10px;
    color: #0ff;
    background: rgba(0, 255, 255, 0.2);
    padding: 2px 6px;
    border-radius: 3px;
    border: 1px solid #0ff;
}

.data-badge {
    font-size: 10px;
    color: #f80;
    background: rgba(255, 136, 0, 0.2);
    padding: 2px 6px;
    border-radius: 3px;
    border: 1px solid #f80;
}

.joint-data {
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.pos {
    color: #0f0;
}

.rot {
    color: #f0f;
}

.copy-btn {
    margin-top: 10px;
    padding: 5px 10px;
    background: rgba(0, 255, 255, 0.1);
    border: 1px solid #0ff;
    color: #0ff;
    cursor: pointer;
    border-radius: 4px;
    font-size: 11px;
}

.copy-btn:hover {
    background: rgba(0, 255, 255, 0.2);
}

.debug-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 15px;
    border-top: 1px solid #333;
    background: rgba(0, 255, 255, 0.05);
}

.debug-footer label {
    color: #888;
    font-size: 11px;
}

.refresh-btn {
    padding: 5px 10px;
    background: rgba(0, 255, 0, 0.1);
    border: 1px solid #0f0;
    color: #0f0;
    cursor: pointer;
    border-radius: 4px;
    font-size: 11px;
}

.refresh-btn:hover {
    background: rgba(0, 255, 0, 0.2);
}
</style> 