<template>
    <v-navigation-drawer
        v-model="openModel"
        location="right"
        :width="width"
        :temporary="$vuetify.display.smAndDown"
        elevation="8"
    >
        <v-tabs v-model="tabModel" density="compact" grow>
            <v-tab value="environment" prepend-icon="mdi-earth">Environment</v-tab>
        </v-tabs>
        <v-divider />
        <v-window v-model="tabModel">
            <v-window-item value="environment">
                <v-list density="compact" class="px-2">
                    <v-list-item>
                        <v-list-item-title>Loading</v-list-item-title>
                        <template #append>
                            <v-chip :color="environmentIsLoading ? 'warning' : 'success'" size="small" variant="flat">
                                {{ environmentIsLoading ? 'Loading' : 'Ready' }}
                            </v-chip>
                        </template>
                    </v-list-item>
                    <v-list-item>
                        <v-list-item-title>Physics Enabled</v-list-item-title>
                        <template #append>
                            <v-chip :color="physicsEnabled ? 'success' : 'error'" size="small" variant="flat">
                                {{ String(physicsEnabled) }}
                            </v-chip>
                        </template>
                    </v-list-item>
                    <v-list-item>
                        <v-list-item-title>Physics Plugin</v-list-item-title>
                        <v-list-item-subtitle>{{ physicsPluginName || '-' }}</v-list-item-subtitle>
                    </v-list-item>
                    <v-list-item>
                        <v-list-item-title>Gravity</v-list-item-title>
                        <v-list-item-subtitle>
                            [{{ gravity[0] }}, {{ gravity[1] }}, {{ gravity[2] }}]
                        </v-list-item-subtitle>
                    </v-list-item>
                    <v-list-item v-if="physicsError">
                        <v-alert
                            type="error"
                            density="compact"
                            variant="tonal"
                            title="Physics Error"
                            :text="physicsError || ''"
                        />
                    </v-list-item>
                </v-list>
            </v-window-item>
        </v-window>
    </v-navigation-drawer>
</template>

<script setup lang="ts">
import { computed } from "vue";

type GravityTuple = [number, number, number];

const props = withDefaults(
    defineProps<{
        open?: boolean; // v-model:open
        tab?: string;   // v-model:tab
        width?: number;
        environmentIsLoading: boolean;
        physicsEnabled: boolean;
        physicsPluginName: string | null;
        physicsError: string | null;
        gravity: GravityTuple;
    }>(),
    {
        open: false,
        tab: "environment",
        width: 360,
    },
);

const emit = defineEmits<{
    (e: "update:open", value: boolean): void;
    (e: "update:tab", value: string): void;
}>();

const openModel = computed({
    get: () => props.open,
    set: (v: boolean) => emit("update:open", v),
});
const tabModel = computed({
    get: () => props.tab,
    set: (v: string) => emit("update:tab", v),
});

// Mark as used in template
void openModel;
void tabModel;
</script>


