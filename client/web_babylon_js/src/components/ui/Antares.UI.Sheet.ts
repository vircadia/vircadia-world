import {
    AbstractMesh,
    Color3,
    Mesh,
    MeshBuilder,
    Plane,
    Scene,
    Vector3,
    Observer,
    Matrix
} from "@babylonjs/core";
import type { Nullable } from "@babylonjs/core";
import { createHolographicMaterial } from "./Antares.UI.Texture";

export interface HolographicSheetOptions {
    width?: number;
    height?: number;
    depth?: number;
    color?: Color3;
    opacity?: number;
}

export class HolographicSheet {
    public readonly mesh: Mesh;
    private scene: Scene;
    private clipPlane: Plane;
    private depth: number;
    private contentObservers: Map<AbstractMesh, { before: Nullable<Observer<any>>, after: Nullable<Observer<any>> }> = new Map();

    constructor(scene: Scene, options: HolographicSheetOptions = {}) {
        this.scene = scene;
        const width = options.width ?? 2;
        const height = options.height ?? 2;
        this.depth = options.depth ?? 0.05;
        const color = options.color ?? new Color3(0.05, 0.05, 0.1); // Darkened holographic
        const opacity = options.opacity ?? 0.7;

        // Create the sheet mesh (Backplate)
        this.mesh = MeshBuilder.CreateBox("holographic_sheet", { width, height, depth: this.depth }, scene);
        
        // Material
        const { material } = createHolographicMaterial(scene, {
            variant: "glass",
            color: color,
            alpha: opacity,
            reflectionLevel: 0.5,
            hoverEffect: false
        });
        this.mesh.material = material;

        // Initialize Clipping Plane
        // We want to clip anything behind the front face.
        // Front face is at -depth/2 in local Z.
        // Normal is (0, 0, -1) in local space (pointing towards camera/front).
        this.clipPlane = new Plane(0, 0, -1, -this.depth / 2);
        
        // Update clip plane when the sheet moves
        this.mesh.onAfterWorldMatrixUpdateObservable.add(() => {
            this.updateClipPlane();
        });
        
        // Initial update
        this.updateClipPlane();
    }

    private updateClipPlane() {
        if (!this.mesh) return;

        const matrix = this.mesh.getWorldMatrix();
        
        // Transform normal to world space
        // We use TransformNormal to rotate the normal but not translate it
        const normal = Vector3.TransformNormal(new Vector3(0, 0, -1), matrix);
        normal.normalize();

        // Transform point to world space
        // Local point is center of front face: (0, 0, -depth/2)
        const point = Vector3.TransformCoordinates(new Vector3(0, 0, -this.depth / 2), matrix);

        // Update the plane
        // Plane equation: ax + by + cz + d = 0
        // d = -dot(normal, point)
        const d = -Vector3.Dot(normal, point);
        
        this.clipPlane.normal.copyFrom(normal);
        this.clipPlane.d = d;
    }

    /**
     * Registers content (meshes or components) to be clipped by this sheet.
     * Any part of the content that goes "into" the sheet (behind the front face) will be clipped.
     * @param content An AbstractMesh, or an object with a 'mesh' property (like HolographicButton).
     */
    public registerContent(content: AbstractMesh | { mesh: AbstractMesh } | any) {
        let rootMesh: AbstractMesh | null = null;

        if (content instanceof AbstractMesh) {
            rootMesh = content;
        } else if (content && content.mesh instanceof AbstractMesh) {
            rootMesh = content.mesh;
        }

        if (!rootMesh) {
            console.warn("HolographicSheet: Could not find root mesh for content", content);
            return;
        }

        // Find all meshes in the hierarchy (including root)
        const meshes = rootMesh.getChildMeshes(false);
        meshes.push(rootMesh);

        for (const abstractMesh of meshes) {
            // Only Mesh has onBeforeRenderObservable (not InstancedMesh)
            if (!(abstractMesh instanceof Mesh)) continue;
            const mesh = abstractMesh as Mesh;

            // Avoid double registration
            if (this.contentObservers.has(mesh)) continue;

            const before = mesh.onBeforeRenderObservable.add(() => {
                this.scene.clipPlane2 = this.clipPlane;
            });
            
            const after = mesh.onAfterRenderObservable.add(() => {
                this.scene.clipPlane2 = null;
            });

            this.contentObservers.set(mesh, { before, after });
        }
    }

    public dispose() {
        // Clean up observers
        this.contentObservers.forEach((obs, abstractMesh) => {
            if (abstractMesh instanceof Mesh) {
                const mesh = abstractMesh as Mesh;
                mesh.onBeforeRenderObservable.remove(obs.before);
                mesh.onAfterRenderObservable.remove(obs.after);
            }
        });
        this.contentObservers.clear();
        this.mesh.dispose();
    }
}
