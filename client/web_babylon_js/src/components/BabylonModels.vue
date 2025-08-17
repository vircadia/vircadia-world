<template>
    <slot :models="models" :isLoading="isLoading" :error="error" />
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from "vue";
import type { BabylonModelDefinition } from "../composables/schemas";

const props = defineProps<{
    vircadiaWorld: any;
    pollIntervalMs?: number;
}>();

const models = ref<BabylonModelDefinition[]>([]);
const isLoading = ref(false);
const error = ref<string | null>(null);
let intervalId: number | null = null;

function toBabylonModelDefinition(
    entityName: string,
    meta: Map<string, unknown>,
): BabylonModelDefinition | null {
    const modelFileName = meta.get("modelFileName");
    if (typeof modelFileName !== "string") return null;

    const position = meta.get("position") as
        | { x?: number; y?: number; z?: number }
        | undefined;
    const rotation = meta.get("rotation") as
        | { x?: number; y?: number; z?: number; w?: number }
        | undefined;
    const ownerSessionId = meta.get("ownerSessionId");

    return {
        entityName,
        entityType: "Model",
        fileName: modelFileName,
        position:
            position && typeof position === "object"
                ? {
                      x: Number(position.x ?? 0),
                      y: Number(position.y ?? 0),
                      z: Number(position.z ?? 0),
                  }
                : { x: 0, y: 0, z: 0 },
        rotation:
            rotation && typeof rotation === "object"
                ? {
                      x: Number(rotation.x ?? 0),
                      y: Number(rotation.y ?? 0),
                      z: Number(rotation.z ?? 0),
                      w: Number(rotation.w ?? 1),
                  }
                : { x: 0, y: 0, z: 0, w: 1 },
        ownerSessionId:
            typeof ownerSessionId === "string" ? ownerSessionId : null,
    } as BabylonModelDefinition;
}

async function fetchModelEntityNames(): Promise<string[]> {
    try {
        const res = await props.vircadiaWorld.client.Utilities.Connection.query(
            {
                query: "SELECT DISTINCT general__entity_name FROM entity.entity_metadata WHERE metadata__key = $1 AND metadata__value = $2::jsonb",
                parameters: ["type", "Model"],
            },
        );

        if (Array.isArray(res.result)) {
            const names: string[] = [];
            for (const row of res.result) {
                if (row.general__entity_name)
                    names.push(row.general__entity_name as string);
            }
            return names;
        }
    } catch (e) {
        console.error("Failed to fetch model entity names", e);
        error.value = "Failed to fetch model entity names";
    }
    return [];
}

async function fetchMetadataForEntities(
    entityNames: string[],
): Promise<Map<string, Map<string, unknown>>> {
    const result = new Map<string, Map<string, unknown>>();
    if (entityNames.length === 0) return result;

    const placeholders: string[] = [];
    const parameters: string[] = [];
    for (let i = 0; i < entityNames.length; i++) {
        placeholders.push(`$${i + 1}`);
        parameters.push(entityNames[i]);
    }

    const query = `SELECT general__entity_name, metadata__key, metadata__value FROM entity.entity_metadata WHERE general__entity_name IN (${placeholders.join(", ")})`;

    try {
        const res = await props.vircadiaWorld.client.Utilities.Connection.query(
            {
                query,
                parameters,
            },
        );
        if (Array.isArray(res.result)) {
            for (const row of res.result) {
                const name = row.general__entity_name as string;
                const key = row.metadata__key as string;
                const value = row.metadata__value as unknown;
                if (!result.has(name))
                    result.set(name, new Map<string, unknown>());
                result.get(name)!.set(key, value);
            }
        }
    } catch (e) {
        console.error("Failed to fetch metadata for entities", e);
        error.value = "Failed to fetch metadata for entities";
    }
    return result;
}

async function loadOnce() {
    if (!props.vircadiaWorld) return;
    if (props.vircadiaWorld.connectionInfo?.value?.status !== "connected")
        return;
    isLoading.value = true;
    error.value = null;
    try {
        const entityNames = await fetchModelEntityNames();
        const metaByEntity = await fetchMetadataForEntities(entityNames);
        const next: BabylonModelDefinition[] = [];
        for (const name of metaByEntity.keys()) {
            const def = toBabylonModelDefinition(name, metaByEntity.get(name)!);
            if (def) next.push(def);
        }
        models.value = next;
    } finally {
        isLoading.value = false;
    }
}

function startPolling() {
    stopPolling();
    const intervalMs = props.pollIntervalMs ?? 5000;
    intervalId = window.setInterval(() => {
        void loadOnce();
    }, intervalMs);
}

function stopPolling() {
    if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
    }
}

onMounted(async () => {
    await loadOnce();
    startPolling();
});

onUnmounted(() => {
    stopPolling();
});

watch(
    () => props.vircadiaWorld?.connectionInfo?.value?.status,
    (status) => {
        if (status === "connected") {
            void loadOnce();
        }
    },
);
</script>

<style scoped>
</style>


