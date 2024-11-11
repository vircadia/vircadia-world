import { type Component, onCleanup, onMount } from 'solid-js';
import { Engine, Scene, ArcRotateCamera, Vector3, HemisphericLight, MeshBuilder, SceneLoader, PhysicsShapeType, Material } from '@babylonjs/core';
import '@babylonjs/loaders';
import HavokPhysics from '@babylonjs/havok';
import { HavokPlugin } from '@babylonjs/core/Physics/v2/Plugins/havokPlugin';
import { PhysicsAggregate } from '@babylonjs/core';
import { KeyboardEventTypes } from '@babylonjs/core/Events';
import { Color3 } from '@babylonjs/core';
import { GridMaterial } from '@babylonjs/materials/grid';

const GameScene: Component = () => {
  let canvas: HTMLCanvasElement | undefined;
  let engine: Engine | undefined;
  let scene: Scene | undefined;
  let havokPlugin: HavokPlugin | undefined;
  
  // Simulated network delay in milliseconds
  const NETWORK_DELAY = 500;

  // Add new state tracking for keys
  const keysPressed = new Set<string>();
  const MAX_VELOCITY = 5; // Reduced from 10
  const FORCE_MAGNITUDE = 20; // Reduced from 50
  const ROTATION_SPEED = 0.03; // New constant for turning speed

  const initScene = async () => {
    if (!canvas) return;

    // Initialize engine and scene
    engine = new Engine(canvas, true);
    scene = new Scene(engine);

    try {
      // Initialize Havok physics with proper error handling
      const havok = await HavokPhysics();
      havokPlugin = new HavokPlugin(true, havok);
      
      // Create physics aggregate instead of impostor
      scene.enablePhysics(new Vector3(0, -9.81, 0), havokPlugin);
    } catch (error) {
      console.error('Failed to initialize Havok physics:', error);
      return;
    }

    // Replace the FreeCamera with ArcRotateCamera
    const camera = new ArcRotateCamera(
      'camera',
      Math.PI, // alpha (rotation around Y axis)
      Math.PI / 3, // beta (rotation around X axis)
      15, // radius (distance from target)
      Vector3.Zero(), // target
      scene
    );
    camera.lowerRadiusLimit = 10;
    camera.upperRadiusLimit = 20;
    camera.attachControl(canvas, true);

    // Add light
    const light = new HemisphericLight('light', new Vector3(0, 1, 0), scene);
    light.intensity = 0.7;

    // Create a large ground plane
    const ground = MeshBuilder.CreateGround('ground', { width: 100, height: 100 }, scene);
    
    // Create and apply grid material
    const gridMaterial = new GridMaterial('gridMaterial', scene);
    gridMaterial.majorUnitFrequency = 5;
    gridMaterial.minorUnitVisibility = 0.45;
    gridMaterial.gridRatio = 1;
    gridMaterial.backFaceCulling = false;
    gridMaterial.mainColor = new Color3(1, 1, 1);
    gridMaterial.lineColor = new Color3(1.0, 1.0, 1.0);
    gridMaterial.opacity = 0.98;
    
    ground.material = gridMaterial;

    // Add physics to the ground
    const groundAggregate = new PhysicsAggregate(
      ground,
      PhysicsShapeType.BOX,
      { mass: 0 }, // mass of 0 makes it static
      scene
    );

    // Modify the box creation
    const box = MeshBuilder.CreateBox('box', { 
      width: 2,
      height: 1,
      depth: 3 
    }, scene);
    box.position.y = 1;
    
    // Create physics aggregate for the box instead of impostor
    const boxAggregate = new PhysicsAggregate(
      box,
      PhysicsShapeType.BOX,
      { mass: 1, restitution: 0.9 },
      scene
    );

    // Replace the keyboard event handling with this:
    scene.onKeyboardObservable.add((kbInfo) => {
      if (kbInfo.type === KeyboardEventTypes.KEYDOWN) {
        keysPressed.add(kbInfo.event.key.toLowerCase());
      } else if (kbInfo.type === KeyboardEventTypes.KEYUP) {
        keysPressed.delete(kbInfo.event.key.toLowerCase());
      }
    });

    // Add a before render observer for continuous movement
    scene.onBeforeRenderObservable.add(() => {
      if (!boxAggregate.body) return;

      const currentVelocity = boxAggregate.body.getLinearVelocity();
      const currentSpeed = currentVelocity.length();
      
      // Update camera target to follow the box
      const boxPosition = box.getAbsolutePosition();
      camera.target = boxPosition;

      // Handle rotation first
      if (keysPressed.has('a')) box.rotation.y += ROTATION_SPEED;
      if (keysPressed.has('d')) box.rotation.y -= ROTATION_SPEED;

      // Only apply forces if we're below max speed
      if (currentSpeed < MAX_VELOCITY) {
        let force = new Vector3(0, 0, 0);
        
        // Only apply forward/backward forces
        if (keysPressed.has('w') || keysPressed.has('s')) {
          // Calculate force direction based on box orientation
          const direction = keysPressed.has('w') ? 1 : -1;
          force.x = Math.sin(box.rotation.y) * direction;
          force.z = Math.cos(box.rotation.y) * direction;

          // Scale force based on current speed (gradual acceleration)
          const speedFactor = 1 - (currentSpeed / MAX_VELOCITY);
          force.normalize().scaleInPlace(FORCE_MAGNITUDE * speedFactor);
          
          setTimeout(() => {
            boxAggregate.body?.applyForce(
              force,
              box.getAbsolutePosition()
            );
          }, NETWORK_DELAY);
        }
      }

      // Update box rotation to match movement direction
      if (currentSpeed > 0.1) {
        box.rotationQuaternion = null;
      }
    });

    // Start render loop
    engine.runRenderLoop(() => {
      scene?.render();
    });

    // Handle window resize
    window.addEventListener('resize', () => {
      engine?.resize();
    });
  };

  onMount(() => {
    initScene();
  });

  onCleanup(() => {
    scene?.dispose();
    engine?.dispose();
  });

  return <canvas ref={canvas} style={{ width: '100%', height: '100%' }} />;
};

export default GameScene;