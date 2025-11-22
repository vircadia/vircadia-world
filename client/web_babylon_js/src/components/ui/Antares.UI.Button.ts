import {
    type AbstractMesh,
    ActionManager,
    Animation,
    Color3,
    DynamicTexture,
    EasingFunction,
    ExecuteCodeAction,
    Mesh,
    MeshBuilder,
    Quaternion,
    Scalar,
    type Scene,
    SineEase,
    StandardMaterial,
    Texture,
    Vector3,
} from "@babylonjs/core";
import {
    type Color3Like,
    createHolographicMaterial,
    type HolographicMaterialVariant,
    resolveColor,
} from "./Antares.Texture.Base";

export type ButtonStyle =
    | "borderedProminent"
    | "bordered"
    | "borderless"
    | "plain";

export type ButtonShape = "capsule" | "circle" | "roundedRect";

export interface HolographicButtonOptions {
    label?: string;
    // iconTexture?: Texture; // Future support
    style?: ButtonStyle;
    shape?: ButtonShape;
    width?: number;
    height?: number;
    depth?: number;
    contentScale?: number;
    baseColor?: Color3Like;
    accentColor?: Color3Like;
    textColor?: string;
    onClick?: () => void;
}

export class HolographicButton {
    public readonly mesh: Mesh;
    public readonly contentMesh: Mesh;
    private visualRoot: Mesh;
    private backplateMesh?: Mesh;
    private borderMesh?: Mesh;
    private labelTexture?: DynamicTexture;

    private scene: Scene;
    private options: Required<
        Omit<
            HolographicButtonOptions,
            "label" | "onClick" | "baseColor" | "accentColor" | "textColor"
        >
    > & {
        label?: string;
        onClick?: () => void;
        baseColor?: Color3;
        accentColor?: Color3;
        textColor: string;
    };

    private materialValues: {
        alpha: number;
        emissive: Color3;
        scale: Vector3;
    };

    private state: {
        hovered: boolean;
        pressed: boolean;
    };

    // Animation constants
    private readonly HOVER_SCALE = 1.15;
    private readonly PRESS_SCALE = 0.95;
    private readonly ANIMATION_SPEED = 60;

    constructor(scene: Scene, options: HolographicButtonOptions = {}) {
        this.scene = scene;
        this.options = {
            style: options.style ?? "borderedProminent",
            shape: options.shape ?? "capsule",
            width: options.width ?? (options.shape === "circle" ? 0.6 : 1.2),
            height: options.height ?? 0.6,
            depth: options.depth ?? 0.08,
            contentScale: options.contentScale ?? 1.0,
            label: options.label,
            onClick: options.onClick,
            textColor: options.textColor ?? "white",
            baseColor: resolveColor(options.baseColor) ?? undefined,
            accentColor: resolveColor(options.accentColor) ?? undefined,
        };

        this.state = {
            hovered: false,
            pressed: false,
        };

        // Container mesh (invisible parent)
        this.mesh = new Mesh(`holographic_btn_root_${Date.now()}`, scene);
        this.mesh.rotationQuaternion = Quaternion.Identity();
        this.mesh.metadata = {
            ...(this.mesh.metadata ?? {}),
            surfaceType: "holographicButton",
        };

        // Create Visual Root for animations
        this.visualRoot = new Mesh("visual_root", scene);
        this.visualRoot.parent = this.mesh;
        this.visualRoot.rotationQuaternion = Quaternion.Identity();

        // Create Content (Text)
        this.contentMesh = this.createContent();
        this.contentMesh.parent = this.visualRoot;

        // Create Backplate (if needed)
        if (
            this.options.style !== "borderless" &&
            this.options.style !== "plain"
        ) {
            this.backplateMesh = this.createBackplate();
            this.backplateMesh.parent = this.visualRoot;
        }

        // Create Border (if needed)
        if (this.options.style === "bordered") {
            // For now, using renderOutline on backplate or a separate mesh if complex
            if (this.backplateMesh) {
                this.backplateMesh.renderOutline = true;
                this.backplateMesh.outlineColor = Color3.White().scale(0.4);
                this.backplateMesh.outlineWidth = 0.01;
            }
        }

        // Store initial values for animation
        this.materialValues = {
            alpha: 0.8, // Placeholder, will update after material creation
            emissive: Color3.Black(),
            scale: Vector3.One(),
        };

        this.setupInteractions();
        this.updateVisualState(true);
    }

    public dispose(): void {
        this.mesh.dispose(false, true);
    }

    private createContent(): Mesh {
        // Plane for text
        const width = this.options.width * 0.9;
        const height = this.options.height * 0.9;
        const plane = MeshBuilder.CreatePlane(
            "btn_content",
            { width, height },
            this.scene,
        );

        // Offset slightly to prevent z-fighting with backplate
        plane.position.z = -this.options.depth / 2 - 0.005;
        plane.isPickable = false; // Ensure clicks pass through to the backplate/hit target

        if (this.options.label) {
            const textureWidth = 512;
            const textureHeight = 256; // Aspect ratio depends on button
            const dt = new DynamicTexture(
                "btn_text",
                { width: textureWidth, height: textureHeight },
                this.scene,
                true,
            );
            this.labelTexture = dt;
            const ctx = dt.getContext() as CanvasRenderingContext2D;

            const fontSize = 110; // Adjust based on texture size
            ctx.font = `bold ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;
            ctx.fillStyle = this.options.textColor;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.clearRect(0, 0, textureWidth, textureHeight);
            ctx.fillText(
                this.options.label,
                textureWidth / 2,
                textureHeight / 2,
            );
            dt.update();
            dt.hasAlpha = true;

            const mat = new StandardMaterial("btn_text_mat", this.scene);
            mat.diffuseTexture = dt;
            mat.opacityTexture = dt;
            mat.emissiveColor = Color3.White();
            mat.disableLighting = true;
            mat.backFaceCulling = false;

            plane.material = mat;
        }

        return plane;
    }

    private createBackplate(): Mesh {
        let mesh: Mesh;
        const { width, height, depth, shape } = this.options;

        if (shape === "capsule") {
            // CreateCapsule creates a capsule standing up (Y axis). We usually want it lying flat or matching UI.
            // But here we likely want it "pill" shaped.
            // Babylon's CreateCapsule radius is for the cap.
            // We want a flattened capsule usually for UI? VisionOS buttons are 3D volumes.

            // Using Cylinder for basic capsule approx if CreateCapsule doesn't give good control over "flattening".
            // Actually VisionOS buttons are often just lozenges (extruded rounded rects) or true capsules.
            // Let's use CreateCapsule and rotate it.
            const radius = height / 2;
            const capHeight = width; // Total height (length) of capsule

            // If width > height, it's a pill.
            mesh = MeshBuilder.CreateCapsule(
                "btn_backplate",
                {
                    radius: radius,
                    height: capHeight,
                    subdivisions: 16,
                    capSubdivisions: 8,
                },
                this.scene,
            );

            // Rotate to align with X/Y plane logic if needed.
            // By default capsule is along Y.
            mesh.rotation.z = Math.PI / 2;

            // Flatten it slightly? VisionOS buttons are somewhat flat (pill shaped) in depth.
            // But we set depth in options.
            // The capsule radius defines depth too.
            // If we want depth < height, we need to scale Z.
            const currentDepth = radius * 2;
            if (depth < currentDepth) {
                mesh.scaling.z = depth / currentDepth;
                mesh.scaling.y = 1; // Along width (local Y after rotation)
                mesh.scaling.x = 1; // Along height (local X after rotation)
            }
        } else if (shape === "circle") {
            mesh = MeshBuilder.CreateSphere(
                "btn_backplate",
                {
                    diameterX: width,
                    diameterY: height,
                    diameterZ: depth,
                },
                this.scene,
            );
            // Or a very short cylinder/disc if depth is small
        } else {
            // Rounded Rect
            mesh = MeshBuilder.CreateBox(
                "btn_backplate",
                {
                    width,
                    height,
                    depth,
                },
                this.scene,
            );
            // TODO: Apply rounded corners via mesh processing or texture opacity mask if desired
            // For now, just box.
        }

        // Material
        const isProminent = this.options.style === "borderedProminent";

        const variant: HolographicMaterialVariant = isProminent
            ? "fill"
            : "glass";

        // Colors
        // Prominent: uses accent color or default blue.
        // Bordered: uses very subtle/transparent.

        let color = this.options.baseColor;
        const accent = this.options.accentColor;

        if (!color) {
            if (isProminent) {
                color = new Color3(0.1, 0.5, 0.9); // Default blue-ish
            } else {
                color = new Color3(0.9, 0.9, 0.9); // White-ish for glass
            }
        }

        const { material } = createHolographicMaterial(this.scene, {
            variant,
            color,
            accentColor: accent,
            alpha: isProminent ? 0.95 : 0.2,
            hoverEffect: true, // Note: createHolographicMaterial doesn't support this flag yet, handled manually
            reflectionLevel: isProminent ? 1.2 : 0.8,
        } as any); // Cast to any if I added props not in type yet

        mesh.material = material;

        return mesh;
    }

    private setupInteractions(): Mesh {
        this.mesh.isPickable = true;

        const hitTarget = this.backplateMesh ?? this.createHitTarget();
        hitTarget.isPickable = true;

        hitTarget.actionManager = new ActionManager(this.scene);

        // Hover Enter
        hitTarget.actionManager.registerAction(
            new ExecuteCodeAction(ActionManager.OnPointerOverTrigger, () => {
                this.state.hovered = true;
                this.updateVisualState();
            }),
        );

        // Hover Exit
        hitTarget.actionManager.registerAction(
            new ExecuteCodeAction(ActionManager.OnPointerOutTrigger, () => {
                this.state.hovered = false;
                // If we were pressed and dragged out, cancel the press
                if (this.state.pressed) {
                    this.state.pressed = false;
                }
                this.updateVisualState();
            }),
        );

        // Pointer Down (Press)
        hitTarget.actionManager.registerAction(
            new ExecuteCodeAction(ActionManager.OnPickDownTrigger, () => {
                this.state.pressed = true;
                this.updateVisualState();
            }),
        );

        // Pointer Up (Release)
        hitTarget.actionManager.registerAction(
            new ExecuteCodeAction(ActionManager.OnPickUpTrigger, () => {
                if (this.state.pressed) {
                    this.state.pressed = false;
                    this.updateVisualState();
                }
            }),
        );

        // Click
        hitTarget.actionManager.registerAction(
            new ExecuteCodeAction(ActionManager.OnPickTrigger, () => {
                this.options.onClick?.();
            }),
        );

        return hitTarget;
    }

    private createHitTarget(): Mesh {
        // Invisible plane for hit testing on borderless buttons
        const plane = MeshBuilder.CreatePlane(
            "btn_hittarget",
            {
                width: this.options.width,
                height: this.options.height,
            },
            this.scene,
        );
        plane.visibility = 0;
        plane.visibility = 0;
        plane.parent = this.visualRoot;
        return plane;
    }

    private updateVisualState(immediate = false): void {
        // Target values
        let targetScale = 1.0;
        let targetZ = 0;
        let targetEmissiveStrength = 0;

        if (this.state.pressed) {
            targetScale = this.PRESS_SCALE;
            targetZ = 0.02; // Slightly pushed back? Or stay fwd? VisionOS pushes IN.
            // Wait, "moves forward in Z-space" on hover.
            // "Depresses (scales down briefly)" on pinch.
        } else if (this.state.hovered) {
            targetScale = this.HOVER_SCALE;
            targetZ = -0.05; // Move forward (negative Z is forward in standard cam often, but depends on parenting. Assuming -Z is towards user)
            targetEmissiveStrength = 0.4;
        }

        // Animate Mesh Scale
        this.animateTo(
            this.visualRoot,
            "scaling",
            new Vector3(targetScale, targetScale, targetScale),
            immediate,
        );

        // Animate Position Z
        // this.animateTo(this.mesh, "position.z", targetZ, immediate); // Needs vector or direct prop
        // Using simple position update for Z for now or separate anim
        if (immediate) {
            this.visualRoot.position.z = targetZ;
        } else {
            Animation.CreateAndStartAnimation(
                "anim_pos_z",
                this.visualRoot,
                "position.z",
                this.ANIMATION_SPEED,
                10,
                this.visualRoot.position.z,
                targetZ,
                Animation.ANIMATIONLOOPMODE_CONSTANT,
                new SineEase(),
            );
        }

        // Update Material Emissive/Alpha if backplate exists
        if (
            this.backplateMesh &&
            this.backplateMesh.material instanceof StandardMaterial
        ) {
            const mat = this.backplateMesh.material;

            // Base emissive logic
            const baseEmissive =
                this.options.accentColor?.clone() ?? new Color3(0.2, 0.2, 0.2);
            const targetEmissive = baseEmissive.scale(
                targetEmissiveStrength + (this.state.pressed ? 0.5 : 0),
            );

            if (immediate) {
                mat.emissiveColor = targetEmissive;
            } else {
                Animation.CreateAndStartAnimation(
                    "anim_emissive",
                    mat,
                    "emissiveColor",
                    this.ANIMATION_SPEED,
                    10,
                    mat.emissiveColor,
                    targetEmissive,
                    Animation.ANIMATIONLOOPMODE_CONSTANT,
                    new SineEase(),
                );
            }
        }
    }

    private animateTo(
        target: any,
        property: string,
        value: any,
        immediate: boolean,
    ): void {
        if (immediate) {
            // Handle deep property? Babylon anim handles it, but direct set needs path parsing
            // Simplified:
            if (property === "scaling") target.scaling = value;
            return;
        }

        const ease = new SineEase();
        ease.setEasingMode(EasingFunction.EASINGMODE_EASEINOUT);

        Animation.CreateAndStartAnimation(
            "anim_" + property,
            target,
            property,
            this.ANIMATION_SPEED,
            10, // frames
            target[property],
            value,
            Animation.ANIMATIONLOOPMODE_CONSTANT,
            ease,
        );
    }

    public setText(text: string): void {
        this.options.label = text;
        if (this.labelTexture) {
            const ctx = this.labelTexture.getContext() as CanvasRenderingContext2D;
            const width = this.labelTexture.getSize().width;
            const height = this.labelTexture.getSize().height;

            ctx.clearRect(0, 0, width, height);
            ctx.fillStyle = this.options.textColor;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(text, width / 2, height / 2);
            this.labelTexture.update();
        }
    }
}
