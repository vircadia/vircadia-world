<template>
    <v-navigation-drawer v-model="openModel" location="left" elevation="8" :temporary="$vuetify.display.smAndDown"
        :width="drawerWidth">
        <template #append>
            <v-divider />
            <v-list density="compact" class="px-2 py-2">
                <v-list-item v-if="isAuthenticated" :title="agentDisplayName || displayName || '-'"
                    prepend-icon="mdi-account-circle">
                    <v-list-item-subtitle>
                        <span class="text-caption">{{ providerLabel }}</span>
                    </v-list-item-subtitle>
                </v-list-item>
                <div class="px-2 pb-2">
                    <LogoutButton :isAuthenticated="isAuthenticated" :onLogout="onLogout" />
                </div>
            </v-list>
        </template>
    </v-navigation-drawer>
</template>

<script setup lang="ts">
import { computed, type PropType, ref, watch } from "vue";
import type {
    VircadiaConnectionInfo,
    VircadiaWorldInstance,
} from "@/components/VircadiaWorldProvider.vue";
import LogoutButton from "./LogoutButton.vue";

// Agent profile (from DB) to display in LeftDrawer
const agentDisplayName = ref<string | null>(null);
const agentProfileLoaded = ref<boolean>(false);

const props = defineProps({
    open: { type: Boolean, required: true },
    width: { type: Number, required: false, default: 320 },
    isAuthenticated: { type: Boolean, required: true },
    displayName: { type: String, required: false, default: undefined },
    provider: { type: String, required: false, default: "anon" },
    onLogout: {
        type: Function as PropType<() => void | Promise<void>>,
        required: true,
    },
    vircadiaWorld: {
        type: Object as () => VircadiaWorldInstance,
        required: true,
    },
    connectionInfo: {
        type: Object as () => VircadiaConnectionInfo,
        required: true,
    },
});

async function fetchAgentProfile() {
    try {
        if (agentProfileLoaded.value) return "";
        if (!props.isAuthenticated) return "";
        if (props.connectionInfo?.status !== "connected") return "";

        // Query DB for current agent's profile (RLS allows own profile via auth.current_agent_id())
        const sql = `SELECT profile__username AS username FROM auth.agent_profiles WHERE general__agent_profile_id = auth.current_agent_id() LIMIT 1`;
        // Use for-of style to comply with project rules when inspecting rows
        const resp = await props.vircadiaWorld.client.connection.query({
            query: sql,
        });
        type Row = { username?: string; profile__username?: string };
        type QueryResp = { type: string; result?: { rows?: Row[] } };
        const response = resp as unknown as QueryResp;
        const rows: Row[] = Array.isArray(response?.result?.rows)
            ? (response.result?.rows as Row[])
            : [];
        if (Array.isArray(rows)) {
            for (const row of rows) {
                agentDisplayName.value =
                    (row && (row.username || row.profile__username)) || null;
                break;
            }
        }
        agentProfileLoaded.value = true;
    } catch (e) {
        // Fallback: do not block UI if query fails
        agentProfileLoaded.value = true;
    }
    return "";
}

// Watch for drawer opening to fetch profile data
watch(
    () => props.open,
    (newOpen) => {
        if (newOpen) {
            // Reset loaded state to allow refetching every time drawer opens
            agentProfileLoaded.value = false;
            fetchAgentProfile();
        }
    },
);

const emit = defineEmits(["update:open"]);

const openModel = computed({
    get: () => props.open,
    set: (v) => emit("update:open", v),
});

const drawerWidth = computed(() => props.width ?? 320);
const providerLabel = computed(() => props.provider || "anon");
</script>

<style scoped></style>