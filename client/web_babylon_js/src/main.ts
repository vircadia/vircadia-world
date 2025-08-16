import { createApp } from "vue";
import App from "./App.vue";
// Vuetify styles should load before custom styles
import "@mdi/font/css/materialdesignicons.css";
import "vuetify/styles";
import "./assets/main.css";
import { createPinia } from "pinia";

// Vuetify setup
import { createVuetify } from "vuetify";

// App setup
const app = createApp(App);

// Configure error handler to suppress harmless warnings and handle known issues
app.config.errorHandler = (err, _instance, info) => {
    // Check if err is an Error object
    if (err instanceof Error) {
        // Suppress Vuetify slot warnings which are harmless but noisy
        if (
            err.message.includes(
                'Slot "default" invoked outside of the render function',
            ) ||
            err.message.includes(
                'Slot "prepend" invoked outside of the render function',
            ) ||
            err.message.includes(
                'Slot "append" invoked outside of the render function',
            )
        ) {
            // Silently ignore these warnings
            return;
        }

        // Handle component lifecycle errors during conditional rendering
        if (
            err instanceof TypeError &&
            err.message.includes(
                "Cannot read properties of null (reading 'emitsOptions')",
            )
        ) {
            // This happens when components are destroyed while being updated
            // Log a more helpful message
            console.warn(
                "Component was destroyed during update cycle. This is usually harmless.",
            );
            return;
        }
    }

    // Log other errors normally
    console.error("Vue error:", err, info);
};

// Configure warning handler to suppress harmless Vuetify slot warnings
app.config.warnHandler = (msg, _instance, trace) => {
    // Suppress Vuetify slot warnings
    if (
        msg.includes("Slot") &&
        msg.includes("invoked outside of the render function")
    ) {
        // Silently ignore these warnings
        return;
    }

    // Log other warnings normally
    console.warn("Vue warning:", msg, trace);
};

// Pinia setup
const pinia = createPinia();
app.use(pinia);

// Auto-import and register all components from the @/user folder
const components = import.meta.glob("./user/*.vue", { eager: true });

Object.entries(components).forEach(([path, definition]) => {
    const componentName = path
        .split("/")
        .pop()
        ?.replace(/\.\w+$/, "");
    if (
        componentName &&
        definition &&
        typeof definition === "object" &&
        "default" in definition
    ) {
        app.component(componentName, (definition as { default: any }).default);
    }
});

// create and register Vuetify instance
const vuetify = createVuetify({
    icons: {
        defaultSet: "mdi", // This is already the default value - only for display purposes
    },
});
app.use(vuetify);

// Mount the app
app.mount("#app");
