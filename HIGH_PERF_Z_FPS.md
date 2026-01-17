# Tribes: Ascend 2.0 Implementation Plan in Babylon.js

This document outlines a comprehensive plan for developing a spiritual successor to *Tribes: Ascend* (referred to as "Tribes 2.0") using Babylon.js with the Havok physics engine. The plan is based on replicating the core physics system, movement mechanics, collision handling, hit detection, and other key features discussed. It assumes a multiplayer CTF (Capture the Flag) game with high-speed skiing, jetting, and projectile-based combat.

The plan is divided into phases: **Preparation**, **Core Implementation**, **Advanced Features**, **Optimization & Testing**, and **Deployment**. Each phase includes tasks, dependencies, estimated effort (in developer-weeks for a small team), and potential risks.

## 1. Preparation Phase
### 1.1 Project Setup
- **Tools & Environment**:
  - Babylon.js v6+ with Havok plugin (via npm: `@babylonjs/core`, `@babylonjs/havok`).
  - Node.js for server-side (headless with NullEngine).
  - Asset pipeline: Blender for models/maps, export to glTF.
  - Version control: Git with branches for features (e.g., `feat/physics-skiing`).
  - Build tools: Webpack/Vite for bundling; TypeScript for code.
- **Team & Resources**:
  - Roles: 1-2 devs (JS/Physics), 1 artist (models/maps), 1 network specialist.
  - External: Babylon.js forums, GitHub examples (e.g., FPS sandboxes).
- **Dependencies**:
  - Install Havok WASM; enable WebGPU for performance.
  - Multiplayer backend: Colyseus or Nakama for rooms/state sync.
- **Estimated Effort**: 1 week.
- **Risks**: Browser compatibility (test Chrome/Edge/Firefox); Havok licensing (free for non-commercial).

### 1.2 Asset Preparation
- **Maps**:
  - Design wavy, sloped terrains (20°-80° angles) for skiing chains.
  - Export as glTF; optimize to 20k-50k tris.
  - Physics: Use `PhysicsShapeType.MESH` for precise slopes; hybrid with heightfields for flats.
- **Character Models**:
  - Per-class (e.g., Pathfinder: slim; Doombringer: bulky).
  - Animations: Skiing (frictionless slide), jetting (thrust), ragdoll on death.
  - Hitboxes: Compound shapes (capsule body + sphere head).
- **Weapons & Projectiles**:
  - Models: Spinfusor discs, chainguns.
  - Effects: Trails, explosions (GPUParticles).
- **Estimated Effort**: 2-3 weeks.
- **Risks**: High-poly assets impacting load times; ensure bevels on slopes for smooth skiing.

## 2. Core Implementation Phase
### 2.1 Physics & Movement System
- **Character Controller**:
  - Use `PhysicsCharacterController` as base (capsule: height=2m, radius=0.3m).
  - States: Grounded/Walking, Skiing, Airborne, Jetting.
  - Friction: Set `static/dynamicFriction=0` for skiing/air.
  - Gravity: -20 to -30 m/s² (tunable).
  - Per-frame logic: Compute `desiredVelocity` based on input/slope normal from `checkSupport()`.
- **Skiing Mechanics**:
  - Activation: Ski key held + slope 20°-80° (via `Math.acos(dot(normal, up))`).
  - Preserve tangent velocity; project gravity onto plane.
  - No air drag: Momentum conserved indefinitely in air.
- **Jetting & Impulses**:
  - Apply linear impulses (500-1000 units/frame, class-dependent).
  - Energy drain/regeneration system.
  - Disc jumps: Projectile inheritance (50% player velocity).
- **Collisions**:
  - Bounces: Low restitution (0.2); preserve tangent on low-perp hits (<20 m/s).
  - Damage: Quadratic on high-perp impacts (`k * perpVel²`); use `onPhysicsCollideObservable`.
  - Fails: Damp velocity on craters; brief stun.
- **FPS Invariance**: Fixed timestep (1/60s); cap client FPS at 60.
- **Code Snippet Example**:
  ```typescript
  // In scene.onBeforeRenderObservable
  const surface = controller.checkSupport(dt, down);
  if (surface.supportedState === BABYLON.CharacterSupportedState.SUPPORTED && canSki) {
      // Ski logic: tangentVel + gravProj
  } else if (!surface.supportedState) {
      // Airborne: preserve + gravity
  }
  controller.setVelocity(desiredVel);
  ```
- **Estimated Effort**: 4-6 weeks.
- **Risks**: Tunneling at 300 m/s (enable CCD); client-server desync on predictions.

### 2.2 Hit Detection & Combat
- **Hitboxes**:
  - Per-class compounds: Capsule (body, mult=1.0) + Sphere (head, mult=2.0).
  - Sync to skeleton bones for animations.
- **Hitscan (Lasers/Chainguns)**:
  - Server-authoritative `raycast(from, to)` vs. shapes.
  - Client visuals; lag-comp via predicted positions.
- **Physics Projectiles (Spinfusors)**:
  - `PhysicsAggregate` with mass=1, restitution=0.6.
  - Velocity: `playerVel.scale(0.5) + muzzleVel`.
  - Collisions auto-handled by Havok.
- **Overheat/Ammo**: Energy-like regen for chainguns.
- **Estimated Effort**: 3 weeks.
- **Risks**: Raycast perf in 64p (batch queries); headshot accuracy.

### 2.3 Networking & Multiplayer
- **Architecture**:
  - Server: NullEngine + Havok; fixed 60Hz sim.
  - Client: Predict movement; reconcile with server snapshots (lerp 100ms).
  - Sync: Positions, velocities, states (20x/sec); inputs (jet/ski).
- **Features**:
  - Rooms: 32-64 players; CTF logic (flag caps at 300 m/s).
  - Hitreg: Server rays/projectiles.
  - Voice: WebRTC integration.
  - Anti-Cheat: Validate speeds/inputs; anomaly detection.
- **Estimated Effort**: 4-5 weeks.
- **Risks**: Latency rubberbanding at high speeds; bandwidth spikes.

## 3. Advanced Features Phase
### 3.1 UI & UX
- **HUD**: Canvas2D for speedometer, energy bar, minimap (quadtree-based).
- **Controls**: PointerLock + keyboard/gamepad; mobile virtual joysticks.
- **Classes/Loadouts**: JSON configs; UI for selection.
- **Spectate**: Free-cam mode following cappers.
- **Audio**: Spatial sounds (footsteps on slopes, Doppler jets).
- **Estimated Effort**: 2 weeks.

### 3.2 Effects & Polish
- **Particles**: Jet trails inheriting velocity; explosions.
- **Deployables**: Turrets as physics bodies.
- **Ragdoll**: Switch to convex hull on death.
- **Tribes-Specific**: Route chaining tests; spinfusor bounces.
- **Estimated Effort**: 2-3 weeks.

## 4. Optimization & Testing Phase
### 4.1 Performance Tuning
- **Physics**: Multithread Havok; chunk maps; LOD physics (decimate distant tris).
- **Rendering**: ThinInstances for players; occlusion culling; cap particles.
- **High-Speed**: Substeps for projectiles; frustum culling.
- **Browser**: PWA; persistent storage.
- **Metrics**: Target 60 FPS on mid-range hardware; 300 m/s stable.

### 4.2 Testing
- **Unit/Integration**: Physics chains (e.g., 300 m/s no loss); collision thresholds.
- **Multiplayer**: Lag sim (100-200ms); cheat tests.
- **Playtesting**: Balance classes; map routes.
- **Cross-Platform**: Desktop/mobile; WebGPU fallback.
- **Estimated Effort**: 3-4 weeks.
- **Risks**: Browser variances (e.g., Safari Havok issues).

## 5. Deployment Phase
### 5.1 Launch Preparation
- **Monetization**: F2P with cosmetics; itch.io/Steam (Electron wrapper).
- **Servers**: AWS/EC2 for Colyseus; matchmaking via PlayFab.
- **Analytics**: Mixpanel for player routes/classes.
- **Cross-Play**: Web + native ports.

### 5.2 Post-Launch
- **Updates**: Bug fixes; new maps/classes.
- **Community**: Babylon forums; Discord for feedback.
- **Estimated Effort**: 1-2 weeks initial deploy; ongoing.

## Overall Timeline & Budget
- **Total Estimated Effort**: 20-30 developer-weeks (3-6 months for small team).
- **Milestones**: MVP (single map, basic physics) at 8 weeks; Beta (multiplayer) at 16 weeks.
- **Budget Considerations**: Free tools; cloud hosting (~$100/month initial).
- **Success Metrics**: Stable 60 FPS; accurate Tribes feel (e.g., 300 m/s caps); positive playtests.

This plan ensures a faithful recreation while leveraging Babylon.js strengths for web-native play. Iterate based on prototypes.