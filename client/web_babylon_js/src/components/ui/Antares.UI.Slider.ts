import type { AbstractMesh, Scene } from "@babylonjs/core";
import {
    ActionManager,
    Animation,
    type Behavior,
    type Color3,
    EasingFunction,
    ExecuteCodeAction,
    MeshBuilder,
    Observable,
    PBRMaterial,
    PointerDragBehavior,
    Quaternion,
    Scalar,
    SineEase,
    TransformNode,
    Vector3,
} from "@babylonjs/core";
import type { DragEvent as PointerDragEvent } from "@babylonjs/core/Behaviors/Meshes/pointerDragEvents";
import { createBaseMaterial, resolveColor } from "./Antares.Texture.Base";

export type SliderAxis = "horizontal" | "vertical" | "depth";

export type HolographicSliderBehaviorOptions = {
    thumbMesh: AbstractMesh;
    axis?: SliderAxis;
    initialValue?: number;
    min?: number;
    max?: number;
    onDragStart?: () => void;
    onDragEnd?: () => void;
};

type SliderBehaviorValueOptions = Omit<
    HolographicSliderBehaviorOptions,
    "thumbMesh" | "onDragStart" | "onDragEnd"
>;

const AxisVectors: Record<SliderAxis, Vector3> = {
    horizontal: Vector3.Right(),
    vertical: Vector3.Up(),
    depth: Vector3.Forward(),
};

export class HolographicSliderBehavior implements Behavior<AbstractMesh> {
    public readonly name = "holographicSliderBehavior";
    public readonly onValueChangedObservable = new Observable<number>();

    private readonly options: Required<SliderBehaviorValueOptions>;
    private readonly thumb: AbstractMesh;
    private readonly events: {
        onDragStart?: (() => void) | undefined;
        onDragEnd?: (() => void) | undefined;
    };

    private track?: AbstractMesh;
    private thumbTransformNode?: TransformNode;
    private dragBehavior?: PointerDragBehavior;
    private trackDragBehavior?: PointerDragBehavior;
    private value: number;
    private trackHalfLength = 0.5;

    public constructor(options: HolographicSliderBehaviorOptions) {
        if (!options.thumbMesh) {
            throw new Error(
                "[HolographicSliderBehavior] thumbMesh option is required",
            );
        }

        this.thumb = options.thumbMesh;
        this.options = {
            axis: options.axis ?? "horizontal",
            initialValue: options.initialValue ?? 0.5,
            min: options.min ?? 0,
            max: options.max ?? 1,
        };
        this.events = {
            onDragStart: options.onDragStart,
            onDragEnd: options.onDragEnd,
        };
        this.value = Scalar.Clamp(
            this.options.initialValue,
            this.options.min,
            this.options.max,
        );
    }

    public init(): void {
        // Nothing to initialize ahead of time.
    }

    public attach(target: AbstractMesh): void {
        this.track = target;
        this.track.computeWorldMatrix(true);
        this.track.refreshBoundingInfo({});
        this.thumb.computeWorldMatrix(true);
        this.thumb.refreshBoundingInfo({});

        // Apply base material to thumb if it doesn't have one
        if (!this.thumb.material) {
            const scene = this.thumb.getScene();
            const thumbMaterial = createBaseMaterial(scene, {
                color: [1, 1, 1], // White color for thumb
            });
            // Ensure thumb is always opaque (not transparent)
            thumbMaterial.alpha = 1;
            this.thumb.material = thumbMaterial;
        } else {
            // Ensure existing material is opaque
            if (this.thumb.material.alpha !== undefined) {
                this.thumb.material.alpha = 1;
            }
        }

        // Create transform node for thumb if it doesn't exist
        if (!this.thumbTransformNode) {
            const scene = this.thumb.getScene();
            this.thumbTransformNode = new TransformNode(
                `${this.thumb.name || "thumb"}_transform`,
                scene,
            );
            // Parent thumb to transform node and reset local position
            this.thumb.setParent(this.thumbTransformNode);
            this.thumb.position = Vector3.Zero();
        }

        // Ensure thumb is pickable before adding drag behavior
        this.thumb.isPickable = true;
        this.thumb.setEnabled(true);
        this.trackHalfLength = this.computeHalfLength();
        this.ensureThumbBehavior();
        this.ensureTrackBehavior();
        this.setValue(this.value);
    }

    public detach(): void {
        if (this.dragBehavior && this.thumb) {
            this.thumb.removeBehavior(this.dragBehavior);
        }
        if (this.trackDragBehavior && this.track) {
            this.track.removeBehavior(this.trackDragBehavior);
        }
        // Unparent thumb from transform node before disposing
        if (this.thumbTransformNode && this.thumb) {
            this.thumb.setParent(null);
        }
        // Dispose transform node
        if (this.thumbTransformNode) {
            this.thumbTransformNode.dispose();
            this.thumbTransformNode = undefined;
        }
        this.dragBehavior = undefined;
        this.trackDragBehavior = undefined;
        this.track = undefined;
    }

    public getValue(): number {
        return this.value;
    }

    public getThumbTransformNode(): TransformNode | undefined {
        return this.thumbTransformNode;
    }

    public setValue(value: number): void {
        this.value = Scalar.Clamp(value, this.options.min, this.options.max);
        this.updateThumbPositionFromValue();
        this.onValueChangedObservable.notifyObservers(this.value);
    }

    private ensureThumbBehavior(): void {
        if (!this.track) {
            return;
        }
        const dragAxis = this.getWorldAxis();
        if (!this.dragBehavior) {
            this.dragBehavior = new PointerDragBehavior({
                dragAxis: dragAxis,
            });
            this.dragBehavior.moveAttached = false;
            this.dragBehavior.updateDragPlane = false;
            this.dragBehavior.onDragObservable.add(
                (event: PointerDragEvent) => {
                    this.handleDragDistance(event.dragDistance);
                },
            );
            // Add listeners for other drag events
            this.dragBehavior.onDragStartObservable?.add(() => {
                this.events.onDragStart?.();
            });
            this.dragBehavior.onDragEndObservable?.add(() => {
                this.events.onDragEnd?.();
            });
        }
        // Ensure thumb is pickable and enabled before adding behavior
        this.thumb.isPickable = true;
        this.thumb.setEnabled(true);
        const alreadyHasBehavior = this.thumb.behaviors.includes(
            this.dragBehavior,
        );
        if (!alreadyHasBehavior) {
            this.thumb.addBehavior(this.dragBehavior);
        }
    }

    private ensureTrackBehavior(): void {
        if (!this.track) {
            return;
        }
        const dragAxis = this.getWorldAxis();
        if (!this.trackDragBehavior) {
            this.trackDragBehavior = new PointerDragBehavior({
                dragAxis: dragAxis,
            });
            this.trackDragBehavior.moveAttached = false;
            this.trackDragBehavior.updateDragPlane = false;
            this.trackDragBehavior.onDragObservable.add(
                (event: PointerDragEvent) => {
                    this.handleDragDistance(event.dragDistance);
                },
            );
            this.trackDragBehavior.onDragStartObservable?.add(() => {
                this.events.onDragStart?.();
            });
            this.trackDragBehavior.onDragEndObservable?.add(() => {
                this.events.onDragEnd?.();
            });
        }

        const alreadyHasBehavior = this.track.behaviors.includes(
            this.trackDragBehavior,
        );
        if (!alreadyHasBehavior) {
            this.track.addBehavior(this.trackDragBehavior);
        }
    }

    private handleDragDistance(distance: number): void {
        if (!this.track) {
            return;
        }
        const offset = this.valueToOffset(this.value) + distance;
        const clampedOffset = Scalar.Clamp(
            offset,
            -this.trackHalfLength,
            this.trackHalfLength,
        );
        const value = this.offsetToValue(clampedOffset);
        const changed = Math.abs(value - this.value) > 1e-6;
        this.value = value;
        this.updateThumbPositionFromOffset(clampedOffset);
        if (changed) {
            this.onValueChangedObservable.notifyObservers(this.value);
        }
    }

    private computeHalfLength(): number {
        if (!this.track) {
            return 0.5;
        }
        const info = this.track.getBoundingInfo();
        const extents = info.boundingBox.extendSizeWorld;
        const axis = this.options.axis;
        if (axis === "horizontal") {
            return Math.max(extents.x, 0.001);
        }
        if (axis === "vertical") {
            return Math.max(extents.y, 0.001);
        }
        return Math.max(extents.z, 0.001);
    }

    private updateThumbPositionFromValue(): void {
        const offset = this.valueToOffset(this.value);
        this.updateThumbPositionFromOffset(offset);
    }

    private updateThumbPositionFromOffset(offset: number): void {
        if (!this.track || !this.thumbTransformNode) {
            return;
        }
        const axis = this.getWorldAxis();
        const center = this.track
            .getBoundingInfo()
            .boundingBox.centerWorld.clone();
        const targetPosition = center.add(axis.scale(offset));
        this.thumbTransformNode.setAbsolutePosition(targetPosition);
    }

    private valueToOffset(value: number): number {
        const normalized =
            (value - this.options.min) /
            (this.options.max - this.options.min || 1);
        const clamped = Scalar.Clamp(normalized, 0, 1);
        return Scalar.Lerp(
            -this.trackHalfLength,
            this.trackHalfLength,
            clamped,
        );
    }

    private offsetToValue(offset: number): number {
        const normalized =
            (offset + this.trackHalfLength) / (this.trackHalfLength * 2 || 1);
        const unclampedValue =
            this.options.min +
            normalized * (this.options.max - this.options.min);
        return Scalar.Clamp(unclampedValue, this.options.min, this.options.max);
    }

    private getWorldAxis(): Vector3 {
        if (!this.track) {
            return AxisVectors[this.options.axis].clone();
        }
        const axis = AxisVectors[this.options.axis].clone();
        const worldMatrix = this.track.getWorldMatrix();
        const worldAxis = Vector3.TransformNormal(axis, worldMatrix);
        if (worldAxis.lengthSquared() === 0) {
            return axis.normalize();
        }
        return worldAxis.normalize();
    }
}

export interface HolographicSliderVisualOptions {
    trackColor?: string | Color3;
    thumbColor?: string | Color3;
    fillColor?: string | Color3;
    disabledTrackColor?: string | Color3;
    disabledThumbColor?: string | Color3;
    trackScaleHover?: Vector3;
    thumbScaleHover?: Vector3;
}

export interface CreateHolographicSliderOptions {
    scene: Scene;
    name?: string;
    min?: number;
    max?: number;
    initialValue?: number;
    enabled?: boolean;
    dimensions?: {
        width?: number;
        height?: number;
        depth?: number;
        thumbDiameter?: number;
    };
    visuals?: HolographicSliderVisualOptions;
    axis?: SliderAxis;
    onValueChanged?: (value: number) => void;
    onDragStart?: () => void;
    onDragEnd?: () => void;
}

export interface HolographicSlider {
    root: TransformNode;
    behavior: HolographicSliderBehavior;
    dispose: () => void;
    setValue: (value: number) => void;
    getValue: () => number;
    setEnabled: (enabled: boolean) => void;
}

export function createHolographicSlider(
    options: CreateHolographicSliderOptions,
): HolographicSlider {
    const { scene } = options;
    const name = options.name || "holographic_slider";

    // Default dimensions (based on InnovationCenter example, assuming depth axis by default)
    const axis = options.axis ?? "depth";
    const dims = {
        width: options.dimensions?.width ?? 0.08,
        height: options.dimensions?.height ?? 0.04,
        depth: options.dimensions?.depth ?? 2.8,
        thumbDiameter: options.dimensions?.thumbDiameter ?? 0.24,
    };

    const root = new TransformNode(name, scene);

    // -- Materials --
    // -- Materials --
    const activeTrackColor = resolveColor(
        options.visuals?.trackColor,
        resolveColor("#f0f0f0"),
    );
    const activeThumbColor = resolveColor(
        options.visuals?.thumbColor,
        resolveColor("#ffffff"),
    );
    const activeFillColor = resolveColor(
        options.visuals?.fillColor,
        resolveColor("#00baff"),
    );

    const disabledTrackColor = resolveColor(
        options.visuals?.disabledTrackColor,
        resolveColor("#888888"),
    );
    const disabledThumbColor = resolveColor(
        options.visuals?.disabledThumbColor,
        resolveColor("#aaaaaa"),
    );

    const trackMaterial = createBaseMaterial(scene, {
        color: activeTrackColor,
    });
    trackMaterial.needDepthPrePass = true;

    const thumbMaterial = createBaseMaterial(scene, {
        color: activeThumbColor,
    });
    thumbMaterial.alpha = 1;
    thumbMaterial.needDepthPrePass = true;

    const fillMaterial = createBaseMaterial(scene, {
        color: activeFillColor,
    });
    fillMaterial.needDepthPrePass = true;

    // -- Meshes --
    const track = MeshBuilder.CreateBox(
        `${name}_track`,
        {
            width: dims.width,
            height: dims.height,
            depth: dims.depth,
        },
        scene,
    );
    track.parent = root;
    track.material = trackMaterial;
    track.isPickable = true;
    track.checkCollisions = false;
    track.metadata = {
        surfaceType: "holographicSliderTrack",
        skipPhysics: true,
    };

    const thumb = MeshBuilder.CreateSphere(
        `${name}_thumb`,
        { diameter: dims.thumbDiameter },
        scene,
    );
    // Thumb parent will be managed by behavior (reparented to a TransformNode)
    // Initial position: centered on track
    thumb.position = Vector3.Zero();
    thumb.material = thumbMaterial;
    thumb.isPickable = true;
    thumb.checkCollisions = false;
    thumb.metadata = {
        surfaceType: "holographicSliderThumb",
        skipPhysics: true,
    };

    const fill = MeshBuilder.CreateBox(
        `${name}_fill`,
        {
            width: dims.width * 0.65,
            height: dims.height * 0.6,
            depth: dims.depth, // Base length, will scale
        },
        scene,
    );
    fill.parent = track;
    fill.position = Vector3.Zero();
    fill.material = fillMaterial;
    fill.isPickable = false;
    fill.metadata = {
        surfaceType: "holographicSliderFill",
        skipPhysics: true,
    };

    // -- State Management --
    let isHovering = false;
    let isDragging = false;
    let isEnabled = options.enabled ?? true;

    const updateVisualState = () => {
        // Derived scales for hover/active
        const trackRestScale = Vector3.One();
        const thumbRestScale = Vector3.One();

        const trackHoverScale =
            options.visuals?.trackScaleHover ?? new Vector3(1.08, 1.35, 1.02); // Default hover scale from example
        const thumbHoverScale =
            options.visuals?.thumbScaleHover ?? new Vector3(1.25, 1.25, 1.25);

        const trackActiveScale = trackHoverScale.multiplyByFloats(
            1.1,
            1.2,
            1.05,
        ); // Slightly larger
        const thumbActiveScale = thumbHoverScale.multiplyByFloats(
            1.2,
            1.2,
            1.2,
        );

        // Determine target state
        let targetTrackScale = trackRestScale;
        let targetThumbScale = thumbRestScale;

        if (isDragging) {
            targetTrackScale = trackActiveScale;
            targetThumbScale = thumbActiveScale;
        } else if (isHovering) {
            targetTrackScale = trackHoverScale;
            targetThumbScale = thumbHoverScale;
        }

        // Emissive Intensity / Alpha Logic (simplified from original)
        // We'll stick to scaling for now, or add emissive logic if needed.
        // Original code animated emissive color and alpha.
        // For simplicity/robustness, let's animate scaling first.

        Animation.CreateAndStartAnimation(
            `${name}_scale_track`,
            track,
            "scaling",
            60,
            8,
            track.scaling,
            targetTrackScale,
            Animation.ANIMATIONLOOPMODE_CONSTANT,
            new SineEase(),
        );
        Animation.CreateAndStartAnimation(
            `${name}_scale_thumb`,
            thumb,
            "scaling",
            60,
            8,
            thumb.scaling,
            targetThumbScale,
            Animation.ANIMATIONLOOPMODE_CONSTANT,
            new SineEase(),
        );
    };

    const setHover = (hover: boolean) => {
        if (isHovering !== hover) {
            isHovering = hover;
            updateVisualState();
        }
    };

    const setDrag = (drag: boolean) => {
        if (isDragging !== drag) {
            isDragging = drag;
            updateVisualState();
            if (drag) {
                options.onDragStart?.();
            } else {
                options.onDragEnd?.();
            }
        }
    };

    // Register Hover
    [track, thumb].forEach((mesh) => {
        mesh.actionManager = new ActionManager(scene);
        mesh.actionManager.registerAction(
            new ExecuteCodeAction(ActionManager.OnPointerOverTrigger, () => {
                if (isEnabled) setHover(true);
            }),
        );
        mesh.actionManager.registerAction(
            new ExecuteCodeAction(ActionManager.OnPointerOutTrigger, () => {
                if (isEnabled) setHover(false);
            }),
        );
    });

    // -- Behavior --
    const behavior = new HolographicSliderBehavior({
        thumbMesh: thumb,
        axis: axis,
        min: options.min ?? 0,
        max: options.max ?? 1,
        initialValue: options.initialValue ?? 0,
        onDragStart: () => setDrag(true),
        onDragEnd: () => setDrag(false),
    });

    track.addBehavior(behavior);

    // -- Fill Logic --
    const updateFill = (val: number) => {
        const min = options.min ?? 0;
        const max = options.max ?? 1;
        const range = Math.max(1e-5, max - min);
        const normalized = Math.min(1, Math.max(0, (val - min) / range));

        // Fill logic depends on axis. Assuming 'depth' based on default, but should support others.
        // Original used depth.
        // If axis is 'depth': Z scales.
        // If axis is 'horizontal': X scales.
        // If axis is 'vertical': Y scales.

        let scaleAxis: "x" | "y" | "z" = "z";
        if (axis === "horizontal") scaleAxis = "x";
        if (axis === "vertical") scaleAxis = "y";

        const fullLength =
            dims[
                axis === "horizontal"
                    ? "width"
                    : axis === "vertical"
                      ? "height"
                      : "depth"
            ];
        const halfLength = fullLength / 2;

        const scale = Math.max(0.001, normalized);
        fill.scaling[scaleAxis] = scale;

        // Position shift: (normalized - 1) * halfLength
        // Example: val=0 -> norm=0 -> pos = -halfLength (start)
        // Example: val=1 -> norm=1 -> pos = 0 (center? No wait)

        // In original code:
        // sliderFill.position.z = sliderTrackHalfDepth * (normalized - 1);
        // sliderFill has base depth = track depth.
        // if scaling.z = 0.5, it shrinks around center.
        // We need to offset it so it starts from 'min' side.

        // Original logic was correct for center pivot scaling if we shift it.
        fill.position[scaleAxis] = halfLength * (normalized - 1);

        // Hide if 0
        fill.visibility = normalized <= 0 ? 0 : 1;
    };

    // Initial fill
    updateFill(behavior.getValue());

    // Bind updates
    behavior.onValueChangedObservable.add((val) => {
        updateFill(val);
        options.onValueChanged?.(val);
    });

    const setEnabled = (enabled: boolean) => {
        isEnabled = enabled;
        track.isPickable = enabled;
        thumb.isPickable = enabled;

        if (enabled) {
            trackMaterial.albedoColor = activeTrackColor;
            thumbMaterial.albedoColor = activeThumbColor;
            fillMaterial.albedoColor = activeFillColor;
        } else {
            trackMaterial.albedoColor = disabledTrackColor;
            thumbMaterial.albedoColor = disabledThumbColor;
            fillMaterial.albedoColor = disabledTrackColor; // Use track color for fill when disabled
            setHover(false);
            setDrag(false);
        }
    };

    // Initialize state
    setEnabled(isEnabled);

    return {
        root,
        behavior,
        dispose: () => {
            track.removeBehavior(behavior);
            track.dispose(); // this disposes children (fill)
            // thumb is child of root via transform node now? No, behavior reparents thumb.
            // root needs disposal.
            root.dispose();
            // Behavior detach cleans up thumb transform node but thumb itself needs disposal?
            // Track dispose might not dispose thumb if it's parented to thumbTransformNode which is sibling or child?
            // Let's rely on root dispose mostly, but ensure behavior detach is called.
            behavior.detach();
            if (thumb) thumb.dispose();
        },
        setValue: (val) => behavior.setValue(val),
        getValue: () => behavior.getValue(),
        setEnabled,
    };
}
