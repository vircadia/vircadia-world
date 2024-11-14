import { type Component, onCleanup, onMount } from 'solid-js';
import { Engine, Scene, ArcRotateCamera, Vector3, HemisphericLight, MeshBuilder, SceneLoader, PhysicsShapeType, Material, Mesh, Quaternion, StandardMaterial } from '@babylonjs/core';
import '@babylonjs/loaders';
import HavokPhysics from '@babylonjs/havok';
import { HavokPlugin } from '@babylonjs/core/Physics/v2/Plugins/havokPlugin';
import { PhysicsAggregate } from '@babylonjs/core';
import { KeyboardEventTypes } from '@babylonjs/core/Events';
import { Color3 } from '@babylonjs/core';
import { GridMaterial } from '@babylonjs/materials/grid';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../../vircadia.config';

const GameScene: Component = () => {
  let canvas: HTMLCanvasElement | undefined;
  let engine: Engine | undefined;
  let scene: Scene | undefined;
  let havokPlugin: HavokPlugin | undefined;
  let supabase: SupabaseClient;
  
  // Track projectile-related objects
  let cannon: Mesh;
  let target: Mesh;
  let projectiles: Mesh[] = [];
  const artificialLatency = 150; // ms

  const initScene = async () => {
    if (!canvas) return;

    // Initialize engine and scene
    engine = new Engine(canvas, true);
    scene = new Scene(engine);
    
    // Initialize Supabase
    supabase = createClient(config.defaultWorldSupabaseUrl, config.defaultWorldSupabaseAnonKey);

    try {
      // Initialize Havok physics with proper error handling
      const havok = await HavokPhysics();
      havokPlugin = new HavokPlugin(true, havok);
      scene.enablePhysics(new Vector3(0, -9.81, 0), havokPlugin);
    } catch (error) {
      console.error('Failed to initialize Havok physics:', error);
      return;
    }

    // Camera setup remains the same
    const camera = new ArcRotateCamera(
      'camera',
      Math.PI,
      Math.PI / 3,
      15,
      Vector3.Zero(),
      scene
    );
    camera.lowerRadiusLimit = 10;
    camera.upperRadiusLimit = 20;
    camera.attachControl(canvas, true);

    // Light setup remains the same
    const light = new HemisphericLight('light', new Vector3(0, 1, 0), scene);
    light.intensity = 0.7;

    // Ground setup remains the same
    setupGround(scene);

    // Setup projectile test elements
    setupProjectileTest(scene);

    // Start render loop
    engine.runRenderLoop(() => {
      scene?.render();
    });

    // Handle window resize
    window.addEventListener('resize', () => {
      engine?.resize();
    });
  };

  const setupGround = (scene: Scene) => {
    const ground = MeshBuilder.CreateGround('ground', { width: 100, height: 100 }, scene);
    
    const gridMaterial = new GridMaterial('gridMaterial', scene);
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
    cannon = MeshBuilder.CreateBox("cannon", {
      width: 1,
      height: 1,
      depth: 2
    }, scene);
    cannon.position = new Vector3(-10, 2, 0);

    // Create target
    target = MeshBuilder.CreateBox("target", {
      width: 2,
      height: 2,
      depth: 2
    }, scene);
    target.position = new Vector3(10, 2, 0);
    
    const targetMaterial = new StandardMaterial("targetMat", scene);
    targetMaterial.diffuseColor = new Color3(1, 0, 0);
    target.material = targetMaterial;

    new PhysicsAggregate(target, PhysicsShapeType.BOX, { mass: 0 }, scene);

    // Setup firing controls
    scene.onPointerDown = () => fireProjectile(scene);
  };

  const fireProjectile = async (scene: Scene) => {
    const projectile = MeshBuilder.CreateSphere("projectile", {
      diameter: 0.5
    }, scene);
    
    projectile.position = cannon.position.clone();
    
    const projectileAggregate = new PhysicsAggregate(
      projectile,
      PhysicsShapeType.SPHERE,
      { mass: 1, restitution: 0.9 },
      scene
    );

    const direction = target.position.subtract(cannon.position).normalize();
    const power = 20;

    setTimeout(async () => {
      projectileAggregate.body?.applyImpulse(
        direction.scale(power),
        projectile.getAbsolutePosition()
      );

      await recordProjectileState(projectile);
    }, artificialLatency);

    projectiles.push(projectile);

    // Cleanup after 5 seconds
    setTimeout(() => {
      cleanupProjectile(projectile);
    }, 5000);
  };

  const recordProjectileState = async (projectile: Mesh) => {
    const position = projectile.position;
    const rotation = projectile.rotationQuaternion || new Quaternion();

    try {
      await supabase
        .from('entities')
        .insert({
          type: 'projectile',
          position_x: position.x,
          position_y: position.y,
          position_z: position.z,
          rotation_x: rotation.x,
          rotation_y: rotation.y,
          rotation_z: rotation.z,
          rotation_w: rotation.w,
          mass: 1,
          is_static: false
        });
    } catch (error) {
      console.error('Failed to record projectile state:', error);
    }
  };

  const cleanupProjectile = (projectile: Mesh) => {
    const index = projectiles.indexOf(projectile);
    if (index > -1) {
      projectiles.splice(index, 1);
    }
    projectile.dispose();
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