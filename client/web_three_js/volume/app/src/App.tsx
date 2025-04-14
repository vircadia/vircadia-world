import { useState, useEffect, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Stats } from "@react-three/drei";
import { VircadiaThreeCore } from "../../../../../sdk/vircadia-world-sdk-ts/module/client/vircadia.three.core";
import { VircadiaConfig_BROWSER_CLIENT } from "../../../../../sdk/vircadia-world-sdk-ts/config/vircadia.browser.client.config";
import { Communication } from "../../../../../sdk/vircadia-world-sdk-ts/schema/schema.general";
import * as THREE from "three";
import "./App.css";

// Server connection constants
const SERVER_URL =
    VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_DEFAULT_WORLD_API_URI_USING_SSL
        ? `https://${VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_DEFAULT_WORLD_API_URI}${Communication.WS_UPGRADE_PATH}`
        : `http://${VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_DEFAULT_WORLD_API_URI}${Communication.WS_UPGRADE_PATH}`;

const SERVER_CONFIG = {
    serverUrl: SERVER_URL,
    authToken:
        VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_DEBUG_SESSION_TOKEN,
    authProvider:
        VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_DEBUG_SESSION_TOKEN_PROVIDER,
    scene: new THREE.Scene(),
    debug: VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_DEBUG,
    suppress: VircadiaConfig_BROWSER_CLIENT.VRCA_CLIENT_WEB_THREE_JS_SUPPRESS,
    reconnectAttempts: 5,
    reconnectDelay: 5000,
};

// Connection status component
function ConnectionStatus({
    vircadiaCore,
}: { vircadiaCore: VircadiaThreeCore | null }) {
    const [status, setStatus] = useState("Disconnected");
    const statusCheckRef = useRef<number | null>(null);

    useEffect(() => {
        if (!vircadiaCore) {
            setStatus("Disconnected");
            return;
        }

        // Check connection status every second
        statusCheckRef.current = window.setInterval(() => {
            if (vircadiaCore.Utilities.Connection.isConnected()) {
                setStatus("Connected");
            } else if (vircadiaCore.Utilities.Connection.isConnecting()) {
                setStatus("Connecting...");
            } else if (vircadiaCore.Utilities.Connection.isReconnecting()) {
                setStatus("Reconnecting...");
            } else {
                setStatus("Disconnected");
            }
        }, 1000);

        return () => {
            if (statusCheckRef.current) {
                window.clearInterval(statusCheckRef.current);
            }
        };
    }, [vircadiaCore]);

    // Style based on connection status
    const getStatusColor = () => {
        switch (status) {
            case "Connected":
                return "green";
            case "Connecting...":
            case "Reconnecting...":
                return "orange";
            default:
                return "red";
        }
    };

    return (
        <div
            style={{
                position: "absolute",
                top: "10px",
                right: "10px",
                padding: "5px 10px",
                borderRadius: "5px",
                backgroundColor: "rgba(0, 0, 0, 0.7)",
                color: "white",
                fontWeight: "bold",
                display: "flex",
                alignItems: "center",
                gap: "5px",
                zIndex: 1000,
            }}
        >
            <span
                style={{
                    display: "inline-block",
                    width: "10px",
                    height: "10px",
                    borderRadius: "50%",
                    backgroundColor: getStatusColor(),
                }}
            />
            <span>{status}</span>
        </div>
    );
}

// Attractor class for particle simulation
class Attractor {
    position: THREE.Vector3;
    orientation: THREE.Vector3;
    strength: number;
    type: string;
    oscillationParams: {
        frequency: number;
        amplitude: number;
        phase: number;
        axis: THREE.Vector3;
    };
    originalPosition: THREE.Vector3;
    time: number;

    constructor(
        position: THREE.Vector3,
        orientation: THREE.Vector3,
        strength = 1,
        type = "attract",
    ) {
        this.position = position.clone();
        this.originalPosition = position.clone();
        this.orientation = orientation.normalize();
        this.strength = strength;
        this.type = type; // "attract", "repel", "orbit", "chaos"
        this.time = Math.random() * 1000;

        // Random oscillation parameters
        this.oscillationParams = {
            frequency: 0.2 + Math.random() * 0.8, // Hz
            amplitude: 0.5 + Math.random() * 1.5,
            phase: Math.random() * Math.PI * 2,
            axis: new THREE.Vector3(
                Math.random() - 0.5,
                Math.random() - 0.5,
                Math.random() - 0.5,
            ).normalize(),
        };
    }

    update(delta: number) {
        // Update time
        this.time += delta;

        // Make attractors move in oscillating patterns
        const oscillation =
            Math.sin(
                this.time * this.oscillationParams.frequency +
                    this.oscillationParams.phase,
            ) * this.oscillationParams.amplitude;

        // Apply oscillation along the chosen axis
        this.position
            .copy(this.originalPosition)
            .addScaledVector(this.oscillationParams.axis, oscillation);

        // Slowly rotate orientation
        const rotAxis = new THREE.Vector3(0, 1, 0);
        const rotAngle = delta * 0.2;
        this.orientation.applyAxisAngle(rotAxis, rotAngle);
    }

    applyForce(
        particlePosition: THREE.Vector3,
        particleVelocity: THREE.Vector3,
        particleMass = 1,
    ) {
        const toAttractor = new THREE.Vector3().subVectors(
            this.position,
            particlePosition,
        );
        const distance = toAttractor.length();

        if (distance < 0.1) return; // Prevent extreme forces at close distances

        // Base force strength calculation
        const direction = toAttractor.clone().normalize();
        let forceStrength =
            (this.strength / (distance * distance)) * particleMass;

        // Adjust force based on attractor type
        switch (this.type) {
            case "repel": {
                forceStrength = -forceStrength;
                break;
            }
            case "orbit": {
                // Apply sideways force for orbiting
                particleVelocity.add(
                    new THREE.Vector3()
                        .crossVectors(direction, this.orientation)
                        .multiplyScalar(forceStrength * 2),
                );
                forceStrength *= 0.2; // Reduce direct attraction
                break;
            }
            case "chaos": {
                // Random directional force that changes over time
                const chaosVec = new THREE.Vector3(
                    Math.sin(this.time * 2 + particlePosition.x),
                    Math.cos(this.time * 3 + particlePosition.y),
                    Math.sin(this.time * 2.5 + particlePosition.z),
                ).normalize();

                particleVelocity.add(
                    chaosVec.multiplyScalar(forceStrength * 2),
                );
                return; // Skip standard force application
            }
        }

        // Apply main force
        const forceVector = direction.multiplyScalar(forceStrength);
        particleVelocity.add(forceVector);

        // Spinning force - stronger now
        const spinFactor = this.type === "orbit" ? 10 : 5;
        const spinningForce = this.orientation
            .clone()
            .multiplyScalar(forceStrength * spinFactor);
        const spinningVelocity = new THREE.Vector3().crossVectors(
            spinningForce,
            toAttractor,
        );
        particleVelocity.add(spinningVelocity);
    }
}

// Particle System Component
function ParticleSystem() {
    const { scene } = useThree();
    const pointsRef = useRef<THREE.Points | null>(null);
    const vircadiaCoreRef = useRef<VircadiaThreeCore | null>(null);
    const syncEnabled = useRef(false);
    const lastSyncTime = useRef(0);
    const clock = useRef(new THREE.Clock());

    // Increased particle count
    const count = 20000;

    // More diverse attractors with different types
    const attractors = [
        new Attractor(
            new THREE.Vector3(-2, 0, 0),
            new THREE.Vector3(0, 1, 0),
            1.5,
            "attract",
        ),
        new Attractor(
            new THREE.Vector3(2, 0, -1),
            new THREE.Vector3(0, 1, 0),
            1.2,
            "orbit",
        ),
        new Attractor(
            new THREE.Vector3(0, 1, 2),
            new THREE.Vector3(1, 0, -0.5),
            0.8,
            "repel",
        ),
        new Attractor(
            new THREE.Vector3(0, -1.5, 0),
            new THREE.Vector3(0, 0, 1),
            1.0,
            "chaos",
        ),
        new Attractor(
            new THREE.Vector3(1.5, 1.5, -1.5),
            new THREE.Vector3(1, 1, 0),
            0.7,
            "attract",
        ),
    ];

    useEffect(() => {
        // Create geometry
        const geometry = new THREE.BufferGeometry();

        // Create position attributes - adding size for visuals
        const positions = new Float32Array(count * 3);
        const velocities = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const masses = new Float32Array(count);

        // Initialize particles with more variety and wider distribution
        for (let i = 0; i < count; i++) {
            // Random positions in sphere distribution
            const radius = 5 + Math.random() * 5;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);

            const x = radius * Math.sin(phi) * Math.cos(theta);
            const y = radius * Math.sin(phi) * Math.sin(theta);
            const z = radius * Math.cos(phi);

            positions[i * 3] = x;
            positions[i * 3 + 1] = y;
            positions[i * 3 + 2] = z;

            // Random initial velocities - faster now
            velocities[i * 3] = (Math.random() - 0.5) * 0.1;
            velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.1;
            velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.1;

            // Color palette: cosmic blues and purples with some variation
            colors[i * 3] = 0.3 + Math.random() * 0.4; // R: purple-blue range
            colors[i * 3 + 1] = 0.1 + Math.random() * 0.3; // G: low
            colors[i * 3 + 2] = 0.6 + Math.random() * 0.4; // B: high

            // Random size - more variation
            sizes[i] = 0.5 + Math.random() * 2.5;

            // Random mass affects how particles respond to forces
            masses[i] = 0.5 + Math.random() * 1.5;
        }

        // Set attributes
        geometry.setAttribute(
            "position",
            new THREE.BufferAttribute(positions, 3),
        );
        geometry.setAttribute(
            "velocity",
            new THREE.BufferAttribute(velocities, 3),
        );
        geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute("mass", new THREE.BufferAttribute(masses, 1));

        // Improved material for better visuals
        const material = new THREE.PointsMaterial({
            size: 0.08,
            vertexColors: true,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            sizeAttenuation: true,
            depthWrite: false,
        });

        // Create points
        const points = new THREE.Points(geometry, material);
        scene.add(points);
        pointsRef.current = points;

        // Start the clock for consistent animations
        clock.current.start();

        // Sync particles to server every 5 seconds
        const syncInterval = setInterval(() => {
            if (
                syncEnabled.current &&
                vircadiaCoreRef.current?.Utilities.Connection.isConnected()
            ) {
                syncParticlesToServer();
            }
        }, 5000);

        return () => {
            clearInterval(syncInterval);
            if (points && scene) {
                scene.remove(points);
                geometry.dispose();
                material.dispose();
            }
        };
    }, [scene]);

    // Update function for each frame
    useFrame((_, delta) => {
        if (!pointsRef.current) return;

        // Make sure delta is reasonable
        const clampedDelta = Math.min(delta, 0.1);

        // Update attractor positions
        for (const attractor of attractors) {
            attractor.update(clampedDelta);
        }

        const points = pointsRef.current;
        const positionAttr = points.geometry.getAttribute(
            "position",
        ) as THREE.BufferAttribute;
        const velocityAttr = points.geometry.getAttribute(
            "velocity",
        ) as THREE.BufferAttribute;
        const colorAttr = points.geometry.getAttribute(
            "color",
        ) as THREE.BufferAttribute;
        const sizeAttr = points.geometry.getAttribute(
            "size",
        ) as THREE.BufferAttribute;
        const massAttr = points.geometry.getAttribute(
            "mass",
        ) as THREE.BufferAttribute;

        // Update each particle
        for (let i = 0; i < count; i++) {
            // Get current position and velocity
            const pos = new THREE.Vector3(
                positionAttr.array[i * 3],
                positionAttr.array[i * 3 + 1],
                positionAttr.array[i * 3 + 2],
            );

            const vel = new THREE.Vector3(
                velocityAttr.array[i * 3],
                velocityAttr.array[i * 3 + 1],
                velocityAttr.array[i * 3 + 2],
            );

            const mass = massAttr.array[i];

            // Apply attractor forces with particle mass
            for (const attractor of attractors) {
                attractor.applyForce(pos, vel, mass);
            }

            // Reduced damping for more persistent motion
            vel.multiplyScalar(0.99);

            // Higher max speed
            const speed = vel.length();
            const maxSpeed = 0.5; // 5x faster than before
            if (speed > maxSpeed) {
                vel.multiplyScalar(maxSpeed / speed);
            }

            // Update position with frame-rate independent speed
            pos.add(vel.clone().multiplyScalar(clampedDelta * 5)); // Faster movement

            // Box bounds - now wrapping around instead of bouncing
            const bound = 12; // Larger bounds
            // Wrap around edges (teleport to opposite side when hitting boundary)
            if (Math.abs(pos.x) > bound)
                pos.x = -Math.sign(pos.x) * (bound - 0.1);
            if (Math.abs(pos.y) > bound)
                pos.y = -Math.sign(pos.y) * (bound - 0.1);
            if (Math.abs(pos.z) > bound)
                pos.z = -Math.sign(pos.z) * (bound - 0.1);

            // Update color based on velocity - more dramatic color shifts
            const speedColor = Math.min(1, speed / maxSpeed);

            // Color based on speed and position for more visual variety
            // Higher speed = more blue/purple, slower = more red/orange
            colorAttr.array[i * 3] = 0.5 + (1 - speedColor) * 0.5; // R: high when slow
            colorAttr.array[i * 3 + 1] = speedColor * 0.3; // G: low-mid always
            colorAttr.array[i * 3 + 2] = 0.5 + speedColor * 0.5; // B: high when fast

            // Update size based on speed - faster particles appear larger
            sizeAttr.array[i] =
                (0.5 + Math.min(2.5, speedColor * 3)) * (mass * 0.8);

            // Update position and velocity in the buffer
            positionAttr.array[i * 3] = pos.x;
            positionAttr.array[i * 3 + 1] = pos.y;
            positionAttr.array[i * 3 + 2] = pos.z;

            velocityAttr.array[i * 3] = vel.x;
            velocityAttr.array[i * 3 + 1] = vel.y;
            velocityAttr.array[i * 3 + 2] = vel.z;
        }

        // Tell Three.js that these attributes need to be updated
        positionAttr.needsUpdate = true;
        velocityAttr.needsUpdate = true;
        colorAttr.needsUpdate = true;
        sizeAttr.needsUpdate = true;
    });

    // Read particle data for sync
    const readParticleData = (particleCount = 100) => {
        if (!pointsRef.current) return null;

        const points = pointsRef.current;
        const positionAttr = points.geometry.getAttribute(
            "position",
        ) as THREE.BufferAttribute;
        const velocityAttr = points.geometry.getAttribute(
            "velocity",
        ) as THREE.BufferAttribute;
        const colorAttr = points.geometry.getAttribute(
            "color",
        ) as THREE.BufferAttribute;

        const particleData = [];
        const sampleCount = Math.min(particleCount, count);

        // Sample every Nth particle to get a diverse set
        const step = Math.floor(count / sampleCount);

        for (let i = 0; i < count; i += step) {
            if (particleData.length >= sampleCount) break;

            const pos = {
                x: positionAttr.array[i * 3],
                y: positionAttr.array[i * 3 + 1],
                z: positionAttr.array[i * 3 + 2],
            };

            const vel = {
                x: velocityAttr.array[i * 3],
                y: velocityAttr.array[i * 3 + 1],
                z: velocityAttr.array[i * 3 + 2],
            };

            const color = {
                r: colorAttr.array[i * 3],
                g: colorAttr.array[i * 3 + 1],
                b: colorAttr.array[i * 3 + 2],
            };

            const speed = Math.sqrt(
                vel.x * vel.x + vel.y * vel.y + vel.z * vel.z,
            );

            particleData.push({
                position: pos,
                velocity: vel,
                color,
                speed,
            });
        }

        return particleData;
    };

    // Sync particles to server
    const syncParticlesToServer = () => {
        const now = Date.now();

        // Throttle syncs to once per second
        if (now - lastSyncTime.current < 1000) return;
        lastSyncTime.current = now;

        const particleData = readParticleData(100);
        if (
            particleData &&
            vircadiaCoreRef.current?.Utilities.Connection.isConnected()
        ) {
            console.log("Particles ready for sync:", particleData.length);

            // Here you would implement the actual server sync
            // For example with Vircadia, create entities for each particle
            // or update existing particle entities
        }
    };

    // Toggle particle sync
    const toggleSync = (enabled: boolean) => {
        syncEnabled.current = enabled;
        console.log(`Particle syncing ${enabled ? "enabled" : "disabled"}`);
    };

    // Expose the toggle function to window for testing
    useEffect(() => {
        const toggleSyncFn = toggleSync;
        const readParticleDataFn = readParticleData;

        (
            window as Window &
                typeof globalThis & {
                    toggleParticleSync: typeof toggleSyncFn;
                    getParticleData: typeof readParticleDataFn;
                }
        ).toggleParticleSync = toggleSyncFn;

        (
            window as Window &
                typeof globalThis & {
                    toggleParticleSync: typeof toggleSyncFn;
                    getParticleData: typeof readParticleDataFn;
                }
        ).getParticleData = readParticleDataFn;

        return () => {
            const win = window as Window &
                typeof globalThis & {
                    toggleParticleSync?: typeof toggleSyncFn;
                    getParticleData?: typeof readParticleDataFn;
                };

            if (win.toggleParticleSync) win.toggleParticleSync = undefined;
            if (win.getParticleData) win.getParticleData = undefined;
        };
    }, [toggleSync, readParticleData]);

    return null;
}

// Enhanced scene
function Scene({ vircadiaCore }: { vircadiaCore: VircadiaThreeCore | null }) {
    // Set the vircadia core reference for the particle system
    useEffect(() => {
        if (vircadiaCore) {
            (
                window as Window &
                    typeof globalThis & {
                        vircadiaCore: typeof vircadiaCore;
                    }
            ).vircadiaCore = vircadiaCore;
        }
    }, [vircadiaCore]);

    return (
        <>
            {/* Lighting */}
            <ambientLight intensity={0.3} />
            <spotLight position={[5, 10, 5]} intensity={0.8} castShadow />
            <directionalLight
                position={[-10, 10, -5]}
                intensity={0.5}
                color="#8866ff"
                castShadow
            />
            <directionalLight
                position={[10, 10, 10]}
                intensity={0.3}
                color="#ff6677"
            />
            <hemisphereLight
                args={["#7799ff", "#00ff88", 0.5]}
                position={[0, 50, 0]}
            />

            {/* Environment */}
            <fog attach="fog" args={["#000020", 10, 50]} />
            <OrbitControls
                enableDamping
                dampingFactor={0.05}
                rotateSpeed={0.5}
            />
            <axesHelper args={[5]} />
            <gridHelper args={[40, 40]} />
            <mesh
                position={[0, -0.1, 0]}
                rotation={[-Math.PI / 2, 0, 0]}
                receiveShadow
            >
                <planeGeometry args={[40, 40]} />
                <meshStandardMaterial color="#222233" />
            </mesh>

            {/* Particle System */}
            <ParticleSystem />

            {/* Performance Stats */}
            <Stats />
        </>
    );
}

function App() {
    const [vircadiaCore, setVircadiaCore] = useState<VircadiaThreeCore | null>(
        null,
    );
    const connectionCheckIntervalRef = useRef<number | null>(null);

    // Initialize VircadiaThreeCore and connect on load
    useEffect(() => {
        const core = new VircadiaThreeCore(SERVER_CONFIG);
        setVircadiaCore(core);

        // Attempt to connect immediately
        connectToServer(core);

        // Set up connection check interval
        connectionCheckIntervalRef.current = window.setInterval(() => {
            if (
                core &&
                !core.Utilities.Connection.isConnected() &&
                !core.Utilities.Connection.isConnecting() &&
                !core.Utilities.Connection.isReconnecting()
            ) {
                console.log("Connection lost, attempting to reconnect...");
                connectToServer(core);
            }
        }, 5000); // Check every 5 seconds

        // Cleanup on unmount
        return () => {
            if (connectionCheckIntervalRef.current) {
                window.clearInterval(connectionCheckIntervalRef.current);
            }
            if (core) {
                core.dispose();
            }
        };
    }, []);

    // Handle connection to server
    const connectToServer = async (core: VircadiaThreeCore) => {
        if (!core) return;

        try {
            const success = await core.Utilities.Connection.connect();
            if (success) {
                console.log("Connected to Vircadia server");
            } else {
                console.error("Failed to connect to Vircadia server");
            }
        } catch (error) {
            console.error("Failed to connect to Vircadia server:", error);
        }
    };

    return (
        <div className="app">
            <Canvas shadows camera={{ position: [0, 5, 10], fov: 50 }}>
                <Scene vircadiaCore={vircadiaCore} />
            </Canvas>
            {vircadiaCore && <ConnectionStatus vircadiaCore={vircadiaCore} />}
        </div>
    );
}

export default App;
