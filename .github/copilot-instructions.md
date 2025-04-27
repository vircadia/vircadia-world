# General

Use for of instead of foreach. 

# Babylon.js

For Babylon.js: use ImportMeshAsync, SceneLoader is deprecated:
ImportMeshAsync(
    source: SceneSource,
    scene: Scene,
    options?: ImportMeshOptions,
): Promise<ISceneLoaderAsyncResult>