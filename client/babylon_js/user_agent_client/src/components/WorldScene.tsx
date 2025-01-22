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
import { VircadiaConfig_Client } from "../../../../../sdk/vircadia-world-sdk-ts/config/vircadia.config";
import * as GUI from "@babylonjs/gui";

const WorldScene: Component = () => {
    let canvas: HTMLCanvasElement | undefined;
    let engine: Engine | undefined;
    let scene: Scene | undefined;
    let havokPlugin: HavokPlugin | undefined;

    return <canvas ref={canvas} style={{ width: "100%", height: "100%" }} />;
};

export default WorldScene;
