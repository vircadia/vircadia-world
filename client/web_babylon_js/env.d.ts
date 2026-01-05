/// <reference types="vite/client" />

declare module "*.vue" {
    // import type { DefineComponent } from "vue";
    // const component: DefineComponent<{}, {}, any>;
    // export default component;
}

declare const __APP_VERSION__: string;
declare const __BUILD_DATE__: string;
declare const __COMMIT_HASH__: string;
declare const __APP_TITLE__: string;
declare const __USER_COMPONENTS_ROOT__: string;
declare const __USER_COMPONENTS_RELATIVE_PATH__: string;
