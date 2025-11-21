import type { AbstractMesh } from "@babylonjs/core";
import {
    type Behavior,
    Observable,
    PointerDragBehavior,
    Scalar,
    Vector3,
} from "@babylonjs/core";
import type { DragEvent as PointerDragEvent } from "@babylonjs/core/Behaviors/Meshes/pointerDragEvents";
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
        this.dragBehavior = undefined;
        this.trackDragBehavior = undefined;
        this.track = undefined;
    }

    public getValue(): number {
        return this.value;
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
        if (!this.track) {
            return;
        }
        const axis = this.getWorldAxis();
        const center = this.track
            .getBoundingInfo()
            .boundingBox.centerWorld.clone();
        const targetPosition = center.add(axis.scale(offset));
        this.thumb.setAbsolutePosition(targetPosition);
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

export { createHolographicMaterial } from "./Antares.Texture.Holographic";
