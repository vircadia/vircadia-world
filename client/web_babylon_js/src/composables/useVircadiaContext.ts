// src/composables/useVircadiaContext.ts
import { inject, computed } from "vue";
import { useVircadiaInstance } from "@vircadia/world-sdk/browser/vue";

export function useVircadiaContext() {
    // Inject (get) the Vircadia instance
    const vircadiaWorld = inject(useVircadiaInstance());

    if (!vircadiaWorld) {
        throw new Error("Vircadia instance not found");
    }

    // Get the connection status
    const connectionStatus = computed(
        () => vircadiaWorld.connectionInfo.value.status || "disconnected",
    );

    return {
        // Return the Vircadia instance
        vircadiaWorld,
        // Return the connection status
        connectionStatus,
    };
}
