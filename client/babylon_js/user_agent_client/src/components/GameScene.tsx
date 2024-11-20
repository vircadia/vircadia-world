import { type Component, onCleanup, onMount } from "solid-js";
import {
    Engine,
    Scene,
    ArcRotateCamera,
    Vector3,
    HemisphericLight,
    MeshBuilder,
    SceneLoader,
    PhysicsShapeType,
    Material,
    type Mesh,
    Quaternion,
    StandardMaterial,
    type PhysicsBody,
} from "@babylonjs/core";
import "@babylonjs/loaders";
import HavokPhysics from "@babylonjs/havok";
import { HavokPlugin } from "@babylonjs/core/Physics/v2/Plugins/havokPlugin";
import { PhysicsAggregate } from "@babylonjs/core";
import { KeyboardEventTypes } from "@babylonjs/core/Events";
import { Color3 } from "@babylonjs/core";
import { GridMaterial } from "@babylonjs/materials/grid";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "../../vircadia.config";
import * as GUI from "@babylonjs/gui";

interface EntityState {
    position_x: number;
    position_y: number;
    position_z: number;
    rotation_x: number;
    rotation_y: number;
    rotation_z: number;
    rotation_w: number;
    velocity_x: number;
    velocity_y: number;
    velocity_z: number;
    angular_velocity_x: number;
    angular_velocity_y: number;
    angular_velocity_z: number;
}

const GameScene: Component = () => {
    let canvas: HTMLCanvasElement | undefined;
    let engine: Engine | undefined;
    let scene: Scene | undefined;
    let havokPlugin: HavokPlugin | undefined;
    let supabase: SupabaseClient;

    // Track projectile-related objects
    let cannon: Mesh;
    let target: Mesh;
    const projectiles: Mesh[] = [];
    let artificialLatency = 150; // ms
    let debugText: GUI.TextBlock;
    const predictedHits: Mesh[] = [];
    const actualHits: Mesh[] = [];
    const upsertRate = 10; // ms

    const initScene = async () => {
        if (!canvas) return;

        // Initialize engine and scene
        engine = new Engine(canvas, true);
        scene = new Scene(engine);

        // Initialize Supabase
        supabase = createClient(
            config.defaultWorldSupabaseUrl,
            config.defaultWorldSupabaseAnonKey,
        );

        try {
            // Initialize Havok physics with proper error handling
            const havok = await HavokPhysics();
            havokPlugin = new HavokPlugin(true, havok);
            scene.enablePhysics(new Vector3(0, -9.81, 0), havokPlugin);
        } catch (error) {
            console.error("Failed to initialize Havok physics:", error);
            return;
        }

        // Camera setup remains the same
        const camera = new ArcRotateCamera(
            "camera",
            Math.PI,
            Math.PI / 3,
            15,
            Vector3.Zero(),
            scene,
        );
        camera.lowerRadiusLimit = 10;
        camera.upperRadiusLimit = 20;
        camera.attachControl(canvas, true);

        // Light setup remains the same
        const light = new HemisphericLight(
            "light",
            new Vector3(0, 1, 0),
            scene,
        );
        light.intensity = 0.7;

        // Ground setup remains the same
        setupGround(scene);

        // Setup projectile test elements
        setupProjectileTest(scene);

        // Add debug UI
        setupDebugUI(scene);

        // Start render loop
        engine.runRenderLoop(() => {
            scene?.render();
        });

        // Handle window resize
        window.addEventListener("resize", () => {
            engine?.resize();
        });
    };

    const setupGround = (scene: Scene) => {
        const ground = MeshBuilder.CreateGround(
            "ground",
            { width: 100, height: 100 },
            scene,
        );

        const gridMaterial = new GridMaterial("gridMaterial", scene);
        gridMaterial.majorUnitFrequency = 5;
        gridMaterial.minorUnitVisibility = 0.45;
        gridMaterial.gridRatio = 1;
        gridMaterial.backFaceCulling = false;
        gridMaterial.mainColor = new Color3(1, 1, 1);
        gridMaterial.lineColor = new Color3(1.0, 1.0, 1.0);
        gridMaterial.opacity = 0.98;

        ground.material = gridMaterial;

        new PhysicsAggregate(ground, PhysicsShapeType.BOX, { mass: 0 }, scene);
    };

    const setupProjectileTest = (scene: Scene) => {
        // Create cannon
        cannon = MeshBuilder.CreateBox(
            "cannon",
            {
                width: 1,
                height: 1,
                depth: 2,
            },
            scene,
        );
        cannon.position = new Vector3(-10, 2, 0);

        // Create target
        target = MeshBuilder.CreateBox(
            "target",
            {
                width: 2,
                height: 2,
                depth: 2,
            },
            scene,
        );
        target.position = new Vector3(10, 2, 0);

        const targetMaterial = new StandardMaterial("targetMat", scene);
        targetMaterial.diffuseColor = new Color3(1, 0, 0);
        target.material = targetMaterial;

        new PhysicsAggregate(target, PhysicsShapeType.BOX, { mass: 0 }, scene);

        // Setup firing controls
        scene.onPointerDown = () => fireProjectile(scene);
    };

    const setupDebugUI = (scene: Scene) => {
        const advancedTexture =
            GUI.AdvancedDynamicTexture.CreateFullscreenUI("UI");

        debugText = new GUI.TextBlock();
        debugText.text = `Latency: ${artificialLatency}ms`;
        debugText.color = "white";
        debugText.fontSize = 24;
        debugText.top = "50px";
        debugText.left = "50px";
        advancedTexture.addControl(debugText);

        // Add latency controls
        scene.onKeyboardObservable.add((kbInfo) => {
            if (kbInfo.type === KeyboardEventTypes.KEYDOWN) {
                if (kbInfo.event.key === "[") {
                    artificialLatency = Math.max(0, artificialLatency - 50);
                    debugText.text = `Latency: ${artificialLatency}ms`;
                } else if (kbInfo.event.key === "]") {
                    artificialLatency += 50;
                    debugText.text = `Latency: ${artificialLatency}ms`;
                }
            }
        });
    };

    const createHitMarker = (position: Vector3, isServerHit: boolean): Mesh => {
        const marker = MeshBuilder.CreateSphere(
            "hitMarker",
            {
                diameter: 0.3,
            },
            scene,
        );

        const markerMaterial = new StandardMaterial("hitMarkerMat", scene);
        markerMaterial.emissiveColor = isServerHit
            ? new Color3(0, 1, 0)
            : // Green for server hits
              new Color3(1, 1, 0); // Yellow for client predictions
        markerMaterial.alpha = 0.6;
        marker.material = markerMaterial;

        marker.position = position;

        // Remove from arrays when disposing
        const arrayToUpdate = isServerHit ? actualHits : predictedHits;
        arrayToUpdate.push(marker);

        setTimeout(() => {
            const index = arrayToUpdate.indexOf(marker);
            if (index > -1) {
                arrayToUpdate.splice(index, 1);
            }
            marker.dispose();
        }, 2000);

        return marker;
    };

    const getPhysicsState = (physicsBody: PhysicsBody): EntityState => {
        const position = physicsBody.getObjectCenterWorld();
        const rotation =
            physicsBody.transformNode.rotationQuaternion || new Quaternion();
        const velocity = physicsBody.getLinearVelocity();
        const angularVelocity = physicsBody.getAngularVelocity();

        return {
            position_x: position.x,
            position_y: position.y,
            position_z: position.z,
            rotation_x: rotation.x,
            rotation_y: rotation.y,
            rotation_z: rotation.z,
            rotation_w: rotation.w,
            velocity_x: velocity.x,
            velocity_y: velocity.y,
            velocity_z: velocity.z,
            angular_velocity_x: angularVelocity.x,
            angular_velocity_y: angularVelocity.y,
            angular_velocity_z: angularVelocity.z,
        };
    };

    const recordProjectileState = async (projectile: Mesh) => {
        const physicsBody = projectile.getPhysicsBody();
        if (!physicsBody) {
            console.error(
                "No physics body found for projectile:",
                projectile.id,
            );
            return;
        }

        try {
            const { error: entityError } = await supabase
                .from("entities")
                .upsert({
                    id: projectile.id,
                    name: projectile.name,
                    type: "projectile",
                    ...getPhysicsState(physicsBody),
                    mass: 1,
                    restitution: 0.9,
                    friction: 0.5,
                    is_static: false,
                });

            if (entityError) {
                console.error("Failed to upsert entity:", entityError);
                throw entityError;
            }
            console.info("Upserted projectile state");
        } catch (error) {
            console.error("Failed to record projectile state:", error);
        }
    };

    const fireProjectile = async (scene: Scene) => {
        // Generate a UUID for the projectile
        const projectileId = crypto.randomUUID();

        const projectile = MeshBuilder.CreateSphere(
            projectileId, // Use UUID as the mesh name instead of "projectile"
            {
                diameter: 0.5,
            },
            scene,
        );

        // Create ghost projectile for prediction
        const ghostProjectile = projectile.clone(`ghost-${projectileId}`);
        const ghostMaterial = new StandardMaterial("ghostMat", scene);
        ghostMaterial.diffuseColor = new Color3(0.5, 0.5, 1);
        ghostMaterial.alpha = 0.3;
        ghostProjectile.material = ghostMaterial;

        projectile.position = cannon.position.clone();
        ghostProjectile.position = cannon.position.clone();

        // Create physics for both projectiles
        const projectileAggregate = new PhysicsAggregate(
            projectile,
            PhysicsShapeType.SPHERE,
            { mass: 1, restitution: 0.9 },
            scene,
        );

        const ghostAggregate = new PhysicsAggregate(
            ghostProjectile,
            PhysicsShapeType.SPHERE,
            { mass: 1, restitution: 0.9 },
            scene,
        );

        const direction = target.position.subtract(cannon.position).normalize();
        const power = 20;

        // Immediately apply physics to ghost projectile
        ghostAggregate.body?.applyImpulse(
            direction.scale(power),
            ghostProjectile.getAbsolutePosition(),
        );

        // Set up collision detection for ghost projectile
        scene.registerBeforeRender(() => {
            if (
                ghostProjectile.intersectsMesh(target, false) &&
                !ghostProjectile.metadata?.hasHit
            ) {
                ghostProjectile.metadata = { hasHit: true };
                const predictedHitMarker = createHitMarker(
                    ghostProjectile.position,
                    false,
                );
                predictedHits.push(predictedHitMarker);
                ghostProjectile.dispose();
                ghostAggregate.dispose();
            }
        });

        // Record initial state immediately
        await recordProjectileState(projectile);

        // Set up periodic state recording for this projectile
        const stateInterval = setInterval(async () => {
            if (projectile.metadata?.hasHit) {
                clearInterval(stateInterval);
                return;
            }
            await recordProjectileState(projectile);
        }, upsertRate);

        // Store references in metadata for cleanup
        projectile.metadata = {
            ...projectile.metadata,
            stateInterval,
            physicsAggregate: projectileAggregate,
        };

        // Verify hits with server-side state
        scene.registerBeforeRender(() => {
            if (
                projectile.intersectsMesh(target, false) &&
                !projectile.metadata?.hasHit
            ) {
                verifyHit(projectile);
            }
        });

        // Actual projectile launch with latency
        setTimeout(async () => {
            projectileAggregate.body?.applyImpulse(
                direction.scale(power),
                projectile.getAbsolutePosition(),
            );

            // Set up collision detection for actual projectile
            scene.registerBeforeRender(() => {
                if (
                    projectile.intersectsMesh(target, false) &&
                    !projectile.metadata?.hasHit
                ) {
                    projectile.metadata = { hasHit: true };
                    const actualHitMarker = createHitMarker(
                        projectile.position,
                        true,
                    );
                    actualHits.push(actualHitMarker);
                    cleanupProjectile(projectile);
                }
            });

            await recordProjectileState(projectile);
        }, artificialLatency);

        projectiles.push(projectile);

        // Cleanup ghost after 5 seconds if no hit occurs
        setTimeout(() => {
            if (ghostProjectile && !ghostProjectile.isDisposed()) {
                ghostProjectile.dispose();
                ghostAggregate.dispose();
            }
        }, 5000);
    };

    const verifyHit = async (projectile: Mesh) => {
        try {
            // Get the server-side state at the time of hit
            const hitTime = Date.now() - artificialLatency;
            const { data: serverState, error } = await supabase.rpc(
                "get_entity_state_at_timestamp",
                {
                    target_timestamp: new Date(hitTime).toISOString(),
                },
            );

            if (error) throw error;

            // Compare client and server positions
            const serverPosition = new Vector3(
                serverState.position_x,
                serverState.position_y,
                serverState.position_z,
            );

            const distanceToServer = Vector3.Distance(
                projectile.position,
                serverPosition,
            );

            // If positions are close enough, consider it a valid hit
            if (distanceToServer < 1.0) {
                // Threshold in world units
                projectile.metadata = { hasHit: true };
                const actualHitMarker = createHitMarker(
                    projectile.position,
                    true,
                );
                actualHits.push(actualHitMarker);
                cleanupProjectile(projectile);
            }
        } catch (error) {
            console.error("Failed to verify hit:", error);
        }
    };

    const cleanupProjectile = (projectile: Mesh) => {
        const index = projectiles.indexOf(projectile);
        if (index > -1) {
            projectiles.splice(index, 1);
        }

        // Clear the interval for state recording
        if (projectile.metadata?.stateInterval) {
            clearInterval(projectile.metadata.stateInterval);
        }

        // Dispose of physics aggregate
        const aggregate = projectile.metadata?.physicsAggregate;
        if (aggregate) {
            aggregate.dispose();
        }

        // Remove from Supabase
        supabase
            .from("entities")
            .delete()
            .eq("id", projectile.id)
            .then(({ error }) => {
                if (error) console.error("Failed to delete entity:", error);
            });

        projectile.dispose();
    };

    onMount(() => {
        initScene();
    });

    onCleanup(() => {
        // Clean up all projectiles
        projectiles.forEach(cleanupProjectile);

        // Clean up hit markers
        [...predictedHits, ...actualHits].forEach((marker) => {
            marker.dispose();
        });
        predictedHits.length = 0;
        actualHits.length = 0;

        scene?.dispose();
        engine?.dispose();
    });

    return <canvas ref={canvas} style={{ width: "100%", height: "100%" }} />;
};

export default GameScene;
