import { defineAsyncComponent, markRaw, type Component } from "vue";

// Lazily glob all .vue files under @user-components alias
const allUserComponents = import.meta.glob("@user-components/**/*.vue");

export type NamedComponent = {
    name: string;
    component: Component;
};

export function useRouteComponents() {
  const getComponentsForRoute = (routePath: string): NamedComponent[] => {
    // Normalize route path: remove leading/trailing slashes
    // e.g., "/antares/" -> "antares"
    // e.g., "/" -> ""
    const normalizedRoute = routePath.replace(/^\/+|\/+$/g, "");

    const components: NamedComponent[] = [];

    for (const [path, loader] of Object.entries(allUserComponents)) {
        // path is the file path (URL in dev)
        // We want to extract the relative path from the user components root.

        let relativePath = path;

        // Try to strip the configured root path (if keys are absolute)
        // Note: __USER_COMPONENTS_ROOT__ is the absolute file system path.
        // In dev, keys might be URLs like /src/user/... or /@fs/...
        // This is a best-effort strip.
        if (relativePath.includes(__USER_COMPONENTS_ROOT__)) {
            relativePath = relativePath.replace(__USER_COMPONENTS_ROOT__, "");
        } else if (__USER_COMPONENTS_RELATIVE_PATH__) {
            // Robustly handle relative path stripping by ignoring leading slashes
            const normKey = relativePath.startsWith("/")
                ? relativePath
                : `/${relativePath}`;
            const normRel = __USER_COMPONENTS_RELATIVE_PATH__.startsWith("/")
                ? __USER_COMPONENTS_RELATIVE_PATH__
                : `/${__USER_COMPONENTS_RELATIVE_PATH__}`;

            if (normKey.includes(normRel)) {
                relativePath = normKey.replace(normRel, "");
            }
        } else {
            // Fallback for dev URLs if we can guess the structure
            // If the path contains /user/<something>/, we might assume <something> is the start?
            // But simpler: just check if it contains the resolved User Component Dir basename?
            // Since we don't have that easily, we rely on the fact that if we are using the alias,
            // we expect the structure to match.

            // Let's try to match based on the route.
            // If our route is "antares", we look for ".../antares/...".
        }

        // Cleanup leading slashes
        relativePath = relativePath.replace(/^\/+/, "");

        // Also potentially strip "src/user/..." if it wasn't stripped by ROOT check (e.g. dev URL vs FS path mismatch)
        // We know the structure is: [ROOT]/[SUBDIR]/[FILE]
        // We want [SUBDIR]/[FILE]

        // If we are looking for normalizedRoute "antares", we want "antares/Widget.vue"

        // ... (existing logic)

        // Let's stick to the prompt's implication: "/antares/" -> uses those components.
        // So we check if the file path starts with the normalized route.

        let match = false;

        if (normalizedRoute === "") {
            // Root path: usually we might not want to load everything.
            // But for backward compatibility or simple usage, maybe we don't load anything unless specific?
            // Or maybe we load everything in the root of user/?
            // Let's adopt a "prefix" strategy.
            // If route is empty, we only load things that are NOT in a subdirectory?
            // Or maybe we treat empty route as "no specific user directory".
            // Let's allow a special case: if route is empty, maybe don't load anything,
            // UNLESS we want a "default" world.
            // For now, let's look for exact folder match.
            // If file is "user/antares/Foo.vue" and route is "antares", it matches.
            match = relativePath.startsWith(`${normalizedRoute}/`);
        } else {
            match = relativePath.startsWith(`${normalizedRoute}/`);
        }
        
        console.log(`Checking: ${path} -> [Rel: ${relativePath}] -> Match: ${match}`);

        if (match) {
        // It's a match.
        // We use the file name as the component name
        const componentName = path.split("/").pop()?.replace(/\.\w+$/, "");
        if (componentName) {
            components.push({
                name: componentName,
                component: markRaw(defineAsyncComponent(loader as any))
            });
        }
      }
    }
    
    return components;
  };

  return {
    getComponentsForRoute,
  };
}

