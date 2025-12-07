<template>
    <v-dialog v-model="modelValueProxy" max-width="1100" scrollable eager>
        <v-card>
            <v-toolbar color="primary" density="comfortable" flat>
                <v-toolbar-title>Models Debug</v-toolbar-title>
                <v-spacer />
                <v-btn icon="mdi-close" @click="modelValueProxy = false" variant="text" />
            </v-toolbar>
            <v-card-text>
                <v-table density="compact">
                    <thead>
                        <tr>
                            <th class="text-left">Entity</th>
                            <th class="text-left">File</th>
                            <th class="text-left">Owner</th>
                            <th class="text-left">Position</th>
                            <th class="text-left">Rotation</th>
                            <th class="text-left">Physics</th>
                            <th class="text-left">Shape</th>
                            <th class="text-left">Mass</th>
                            <th class="text-left">Friction</th>
                            <th class="text-left">Restitution</th>
                            <th class="text-left">Meshes</th>
                            <th class="text-left">Aggs</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="m in models" :key="m.entityName || m.fileName">
                            <td>{{ m.entityName || '-' }}</td>
                            <td>{{ m.fileName }}</td>
                            <td>{{ m.ownerSessionId || '-' }}</td>
                            <td>{{ formatPosition(m.position) }}</td>
                            <td>{{ formatRotation(m.rotation) }}</td>
                            <td>
                                <v-chip :color="m.enablePhysics ? 'success' : 'grey'" size="x-small" variant="flat">
                                    {{ m.enablePhysics ? 'on' : 'off' }}
                                </v-chip>
                            </td>
                            <td>{{ getPhysicsShape(m.physicsType) }}</td>
                            <td>{{ Number(m.physicsOptions?.mass ?? 0) }}</td>
                            <td>{{ Number(m.physicsOptions?.friction ?? 0.2) }}</td>
                            <td>{{ Number(m.physicsOptions?.restitution ?? 0.2) }}</td>
                            <td>{{ getMeshCount(m) }}</td>
                            <td>{{ getAggregatesCount(m) }}</td>
                        </tr>
                    </tbody>
                </v-table>

                <div class="mt-4" v-if="Object.keys(physicsSummaries).length">
                    <h4 class="text-subtitle-2 mb-2">Physics Details</h4>
                    <v-expansion-panels variant="accordion" multiple>
                        <v-expansion-panel v-for="(summary, key) in physicsSummaries" :key="key">
                            <v-expansion-panel-title>
                                {{ key }} - aggs: {{ summary.aggregatesCount }}, shape: {{ summary.shapeType }}, mass: {{ summary.mass }}
                            </v-expansion-panel-title>
                            <v-expansion-panel-text>
                                <div class="text-caption">Included meshes ({{ summary.includedMeshNames.length }}):</div>
                                <div class="mono small">{{ summary.includedMeshNames.join(', ') || '-' }}</div>
                                <div class="text-caption mt-2">Skipped meshes ({{ summary.skippedMeshNames.length }}):</div>
                                <div class="mono small">{{ summary.skippedMeshNames.join(', ') || '-' }}</div>
                            </v-expansion-panel-text>
                        </v-expansion-panel>
                    </v-expansion-panels>
                </div>
            </v-card-text>
        </v-card>
    </v-dialog>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
    models: { type: Array, required: true },
    modelRuntime: { type: Object, required: true },
    physicsSummaries: { type: Object, required: true },
    modelValue: { type: Boolean, required: true },
});

const emit = defineEmits(['update:modelValue']);

const modelValueProxy = computed({
    get: () => props.modelValue,
    set: (v) => emit('update:modelValue', v),
});

function getPhysicsShape(type) {
    switch (type) {
        case 'convexHull':
            return 'Convex Hull';
        case 'box':
            return 'Box';
        case 'mesh':
            return 'Mesh';
        default:
            return type ? String(type) : 'Mesh';
    }
}

void modelValueProxy;
void getPhysicsShape;

function formatPosition(pos) {
    const x = Number(pos && pos.x != null ? pos.x : 0).toFixed(2);
    const y = Number(pos && pos.y != null ? pos.y : 0).toFixed(2);
    const z = Number(pos && pos.z != null ? pos.z : 0).toFixed(2);
    return `x:${x} y:${y} z:${z}`;
}

function formatRotation(rot) {
    const x = Number(rot && rot.x != null ? rot.x : 0).toFixed(2);
    const y = Number(rot && rot.y != null ? rot.y : 0).toFixed(2);
    const z = Number(rot && rot.z != null ? rot.z : 0).toFixed(2);
    const w = Number(rot && rot.w != null ? rot.w : 1).toFixed(2);
    return `x:${x} y:${y} z:${z} w:${w}`;
}

function keyOfModel(m) {
    return m.entityName || m.fileName;
}

function getMeshCount(m) {
    const key = keyOfModel(m);
    const entry = props.modelRuntime && props.modelRuntime[key];
    return entry && typeof entry.meshCount === 'number' ? entry.meshCount : 0;
}

function getAggregatesCount(m) {
    const key = keyOfModel(m);
    const entry = props.physicsSummaries && props.physicsSummaries[key];
    return entry && typeof entry.aggregatesCount === 'number'
        ? entry.aggregatesCount
        : 0;
}

void formatPosition;
void formatRotation;
void getMeshCount;
void getAggregatesCount;
</script>

<style scoped>
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
.small { font-size: 12px; line-height: 1.3; }
</style>


