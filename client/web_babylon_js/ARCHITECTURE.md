# Vircadia World Architecture: Inversion of Control

## Overview
This document outlines the refactored architecture for Vircadia Web (Vue + Babylon.js). The primary goal was to move from a monolithic `MainScene.vue` to a modular "Inversion of Control" pattern where individual "World" components operate their own scene configuration.

## Key Components

### 1. `VircadiaScene.vue`
*   **Role**: The reusable core component. It wraps the `BabylonCanvas` and handles standard Vircadia logic (Avatar loading, Networking, Physics initialization, Audio).
*   **Usage**: It is NOT used as a standalone page. It is used as a *child* component inside a specific World.
*   **Props**: Accepts `vircadiaWorld` (connection), `engineType` (webgpu/webgl), and `physicsEnabled`.
*   **Exposes**: `canvasComponentRef` (access to `scene`), `avatarRef`, `otherAvatarsRef`.

### 2. `MainScene.vue` (Application Shell)
*   **Role**: The lightweight UI shell. It handles the App Bar, Drawers, and Routing.
*   **Logic**: It does **not** create a scene. Instead, it uses `useRouteComponents` to incorrectly load the specific World component (e.g., `COVE.vue`, `Antares.vue`) based on the URL.
*   **Interaction**: It communicates with the 3D world via `ref` bindings to the loaded child component.

### 3. World Components (`DefaultWorld`, `COVE`, `Antares`)
*   **Role**: The "Owner" of the scene.
*   **Structure**:
    ```vue
    <template>
      <VircadiaScene ref="sceneRef" :vircadia-world="vircadiaWorld">
        <!-- World Specific UI -->
        <template #ui>
            <MyCustomControls />
        </template>
      </VircadiaScene>
    </template>
    ```
*   **Configuration**: The World component passes configuration props down to `VircadiaScene`.
*   **Accessing Babylon**: Instead of `props.scene`, use `sceneRef.value?.canvasComponentRef?.scene`.

## How to Create a New World

1.  **Create a Component**: Create `MyNewWorld.vue`.
2.  **Wrap VircadiaScene**: Import and use `<VircadiaScene>` as the root element.
3.  **Forward Refs**: You MUST expose the necessary refs for `MainScene` to function:
    ```typescript
    const sceneRef = ref(null);
    defineExpose({
        canvasComponentRef: computed(() => sceneRef.value?.canvasComponentRef),
        avatarRef: computed(() => sceneRef.value?.avatarRef),
        otherAvatarsRef: computed(() => sceneRef.value?.otherAvatarsRef),
        toggleInspector: () => sceneRef.value?.toggleInspector(),
    });
    ```
4.  **Register**: Ensure your component is in the path recognized by `useUserComponents.ts` (usually corresponding to the route name).

## Migration Guide (for existing components)

If you have an old component that took `scene` as a prop:
1.  **Remove `scene` prop**: It no longer receives the scene from above.
2.  **Add `VircadiaScene`**: Wrap your template.
3.  **Change Access**: Replace `props.scene` with a computed property:
    ```typescript
    const vircadiaSceneRef = ref(null);
    const scene = computed(() => vircadiaSceneRef.value?.canvasComponentRef?.scene);
    ```
4.  **Wait for Mount**: Remember `scene.value` will be null until `VircadiaScene` mounts. Use `watch` or `computed` to react to it becoming available.
