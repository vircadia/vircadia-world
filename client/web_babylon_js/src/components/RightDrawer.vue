<template>
    <v-navigation-drawer v-model="openModel" location="right" :width="width" :temporary="$vuetify.display.smAndDown"
        elevation="8">
        <v-tabs v-model="tabModel" density="compact" grow>
            <v-tab value="environment" prepend-icon="mdi-earth">Environment</v-tab>
            <v-tab value="physics" prepend-icon="mdi-atom-variant">Physics</v-tab>
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
                </v-list>
            </v-window-item>
            <v-window-item value="physics">
                <v-list density="compact" class="px-2">
                    <v-list-subheader>Runtime</v-list-subheader>
                    <v-list-item>
                        <v-list-item-title>Enabled</v-list-item-title>
                        <template #append>
                            <v-chip :color="physicsEnabled ? 'success' : 'error'" size="small" variant="flat">
                                {{ String(physicsEnabled) }}
                            </v-chip>
                        </template>
                    </v-list-item>
                    <v-list-item>
                        <v-list-item-title>Plugin</v-list-item-title>
                        <v-list-item-subtitle>{{ physicsPluginName || '-' }}</v-list-item-subtitle>
                    </v-list-item>
                    <v-list-item>
                        <v-list-item-title>Engine Type</v-list-item-title>
                        <v-list-item-subtitle>{{ physicsEngineType || '-' }}</v-list-item-subtitle>
                    </v-list-item>
                    <v-list-item>
                        <v-list-item-title>Initialized</v-list-item-title>
                        <template #append>
                            <v-chip :color="physicsInitialized ? 'success' : 'warning'" size="small" variant="flat">
                                {{ String(physicsInitialized) }}
                            </v-chip>
                        </template>
                    </v-list-item>

                    <v-list-subheader>Havok Module</v-list-subheader>
                    <v-list-item>
                        <v-list-item-title>Module Loaded</v-list-item-title>
                        <template #append>
                            <v-chip :color="havokInstanceLoaded ? 'success' : 'error'" size="small" variant="flat">
                                {{ String(havokInstanceLoaded) }}
                            </v-chip>
                        </template>
                    </v-list-item>
                    <v-list-item>
                        <v-list-item-title>Plugin Created</v-list-item-title>
                        <template #append>
                            <v-chip :color="physicsPluginCreated ? 'success' : 'error'" size="small" variant="flat">
                                {{ String(physicsPluginCreated) }}
                            </v-chip>
                        </template>
                    </v-list-item>

                    <v-list-subheader>World</v-list-subheader>
                    <v-list-item>
                        <v-list-item-title>Gravity</v-list-item-title>
                        <v-list-item-subtitle>
                            [{{ gravity && gravity[0] }}, {{ gravity && gravity[1] }}, {{ gravity && gravity[2] }}]
                        </v-list-item-subtitle>
                    </v-list-item>
                    <v-list-item v-if="physicsError">
                        <v-alert type="error" density="compact" variant="tonal" title="Physics Error"
                            :text="physicsError || ''" />
                    </v-list-item>
                </v-list>
            </v-window-item>
        </v-window>
    </v-navigation-drawer>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({
    open: { type: Boolean, default: false },
    tab: { type: String, default: "environment" },
    width: { type: Number, default: 360 },
    environmentIsLoading: { type: Boolean, required: true },
    physicsEnabled: { type: Boolean, default: undefined },
    physicsPluginName: { type: String, default: null },
    physicsEngineType: { type: String, default: undefined },
    physicsInitialized: { type: Boolean, default: undefined },
    havokInstanceLoaded: { type: Boolean, default: undefined },
    physicsPluginCreated: { type: Boolean, default: undefined },
    physicsError: { type: String, default: null },
    gravity: { type: Array, default: undefined },
});

const emit = defineEmits(["update:open", "update:tab"]);

const openModel = computed({
    get: () => props.open,
    set: (v) => emit("update:open", v),
});
const tabModel = computed({
    get: () => props.tab,
    set: (v) => emit("update:tab", v),
});
</script>
