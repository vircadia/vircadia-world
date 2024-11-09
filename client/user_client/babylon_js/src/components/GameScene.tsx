import { type Component, onCleanup, onMount } from 'solid-js';
import { Engine, Scene, FreeCamera, Vector3, HemisphericLight, MeshBuilder, SceneLoader, PhysicsShapeType, Material } from '@babylonjs/core';
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

    // Setup camera
    const camera = new FreeCamera('camera', new Vector3(0, 5, -10), scene);
    camera.setTarget(Vector3.Zero());
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

    // Create a box
    const box = MeshBuilder.CreateBox('box', { size: 2 }, scene);
    box.position.y = 1;
    
    // Create physics aggregate for the box instead of impostor
    const boxAggregate = new PhysicsAggregate(
      box,
      PhysicsShapeType.BOX,
      { mass: 1, restitution: 0.9 },
      scene
    );

    // Handle input with delayed response
    scene.onKeyboardObservable.add((kbInfo) => {
      if (kbInfo.type === KeyboardEventTypes.KEYDOWN) {
        setTimeout(() => {
          const impulse = new Vector3(0, 0, 0);
          switch (kbInfo.event.key) {
            case 'w':
              impulse.z = 1;
              break;
            case 's':
              impulse.z = -1;
              break;
            case 'a':
              impulse.x = -1;
              break;
            case 'd':
              impulse.x = 1;
              break;
          }
          // Apply impulse using the physics body
          boxAggregate.body?.applyImpulse(impulse.scale(5), box.getAbsolutePosition());
        }, NETWORK_DELAY);
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