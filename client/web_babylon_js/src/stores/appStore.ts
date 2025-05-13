import { defineStore } from "pinia";

export const useAppStore = defineStore("app", {
    state: () => ({
        // global loading indicator
        loading: false as boolean,
        // global error message
        error: null as string | null,
    }),
    getters: {
        // whether an error is set
        hasError: (state): boolean => state.error !== null,
    },
    actions: {
        // set the loading flag
        setLoading(value: boolean) {
            this.loading = value;
        },
        // set a global error message
        setError(message: string | null) {
            this.error = message;
        },
        // clear the error
        clearError() {
            this.error = null;
        },
    },
});
