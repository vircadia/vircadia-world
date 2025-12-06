import { defineAsyncComponent, type Component } from "vue";

// Lazily glob all .vue files under ../user
const allUserComponents = import.meta.glob("../user/**/*.vue");

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
      // path is relative to this file, e.g., "../user/antares/Widget.vue"
      // We want to match it against "user/<normalizedRoute>"
      
      // Normalize file path for comparison
      // Remove "../user/" prefix
      const relativePath = path.replace(/^\.\.\/user\//, "");
      
      // If route is root (""), we might want to load root user components?
      // Or maybe nothing. The original logic loaded based on config.
      // Let's assume:
      // - if route is "/", load components directly in "user/" (non-recursive? or maybe recursive?)
      // - if route is "/antares", load components in "user/antares/" (recursive?)
      
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

      if (match) {
        // It's a match.
        // We use the file name as the component name
        const componentName = path.split("/").pop()?.replace(/\.\w+$/, "");
        if (componentName) {
            components.push({
                name: componentName,
                component: defineAsyncComponent(loader as any)
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
