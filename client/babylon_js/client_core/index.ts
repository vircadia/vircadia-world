import { makeAutoObservable } from "mobx";
import {
    createClient,
    type SupabaseClient,
    type Provider,
    type RealtimeChannel,
} from "@supabase/supabase-js";
import type { AnimationGroup, GroundMesh, InstancedMesh, LensFlare, Material, ParticleSystem, PhysicsBody, PostProcess, ReflectionProbe, Scene, Sound, Sprite, TransformNode } from "@babylonjs/core";
import {
    Mesh,
    type Light,
    PointLight,
    DirectionalLight,
    SpotLight,
    HemisphericLight,
    type Camera,
    FreeCamera,
    Vector3,
    Quaternion,
    Space,
} from "@babylonjs/core";
import type { World } from "../../../sdk/vircadia-world-sdk-ts/schema/schema";

type EntityRow = World.Tables<"entities">;

type EntityUpdate = {
    entity: EntityRow;
    action: "insert" | "update" | "delete";
    timestamp: number;
};

class EntityTransactionQueue {
    private insertQueue: Map<string, EntityUpdate> = new Map();
    private updateQueue: Map<string, EntityUpdate> = new Map();
    private deleteQueue: Set<string> = new Set();
    private isProcessing = false;

    queueUpdate(entity: EntityRow, action: "insert" | "update" | "delete") {
        const uuid = entity.general__uuid;

        // If entity is being deleted, remove from other queues
        if (action === "delete") {
            this.insertQueue.delete(uuid);
            this.updateQueue.delete(uuid);
            this.deleteQueue.add(uuid);
            return;
        }

        // Don't queue updates for entities pending deletion
        if (this.deleteQueue.has(uuid)) {
            return;
        }

        const update: EntityUpdate = {
            entity,
            action,
            timestamp: Date.now(),
        };

        if (action === "insert") {
            this.insertQueue.set(uuid, update);
        } else {
            this.updateQueue.set(uuid, update);
        }
    }

    processQueues(scene: Scene) {
        if (this.isProcessing) return;
        this.isProcessing = true;

        // Process deletes first
        for (const uuid of this.deleteQueue) {
            // Handle deletion
        });
        this.deleteQueue.clear();

        // Process inserts
        for (const update of this.insertQueue.values()) {
            // Handle insertion
        });
        this.insertQueue.clear();

        // Process updates
        for (const update of this.updateQueue.values()) {
            // Process by property groups
            this.processTransformProperties(update.entity);
            this.processPhysicsProperties(update.entity);
            this.processVisualProperties(update.entity);
            // etc...
        });
        this.updateQueue.clear();

        this.isProcessing = false;
    }

    private processTransformProperties(entity: EntityRow) {
        // Handle transform updates
    }

    private processPhysicsProperties(entity: EntityRow) {
        // Handle physics updates
    }

    // etc...
}

export class ClientCore {
    private supabase: SupabaseClient | null = null;
    private _scene: Scene | null = null;
    private _isConnected = false;
    private _isAuthenticated = false;
    private entityChannel: RealtimeChannel | null = null;
    private sceneEntities: Map<
        string,
        Mesh | Light | Camera | AnimationGroup | Material | InstancedMesh | GroundMesh | Box | SphereMesh | CylinderMesh | PlaneMesh | DiscMesh | TorusMesh | CapsuleMesh | Sprite | ParticleSystem | GltfMesh | Volume | SkeletalMesh | MorphMesh | InstancedMesh | TransformNode | BoneNode | PhysicsBody | CollisionMesh | Skybox | Environment | PostProcess | LensFlare | ReflectionProbe | GUIElement | Control | Sound | Animation | AnimationGroup
    > = new Map();
    private entityTransactionQueue: EntityTransactionQueue =
        new EntityTransactionQueue();

    constructor(config: {
        url: string;
        key: string;
        scene: Scene;
        email?: string;
        password?: string;
    }) {
        makeAutoObservable(this, {}, { autoBind: true });

        this.connect(config);
    }

    // Observable properties
    get scene() {
        return this._scene;
    }

    get isConnected() {
        return this._isConnected;
    }

    get isAuthenticated() {
        return this._isAuthenticated;
    }

    get client() {
        return this.supabase;
    }

    private async connect({
        url,
        key,
        scene,
        email,
        password,
    }: {
        url: string;
        key: string;
        scene: Scene;
        email?: string;
        password?: string;
    }): Promise<SupabaseClient> {
        try {
            this._scene = scene;
            this.supabase = createClient(url, key);
            this.supabase.realtime.connect();
            this._isConnected = true;

            if (email && password) {
                await this.loginWithEmail(email, password);
            }

            console.log({
                message: "World connected successfully",
                type: "info",
                url,
            });

            // Subscribe to entity changes after successful connection
            this.subscribeToEntities();
            // Add a render loop to process the queue
            this._scene?.registerBeforeRender(() => {
                if (this._scene) {
                    this.entityTransactionQueue.processQueues(this._scene);
                }
            });

            return this.supabase;
        } catch (error) {
            console.error("Failed to connect to world:", error);
            await this.destroy();
            throw error;
        }
    }

    private subscribeToEntities() {
        if (!this.supabase) return;

        this.entityChannel = this.supabase
            .channel("entity_changes")
            .on(
                "postgres_changes",
                {
                    event: "INSERT",
                    schema: "public",
                    table: "entities",
                },
                (payload) =>
                    this.entityTransactionQueue.queueUpdate(
                        payload.new as EntityRow,
                        "insert",
                    ),
            )
            .on(
                "postgres_changes",
                {
                    event: "UPDATE",
                    schema: "public",
                    table: "entities",
                },
                (payload) =>
                    this.entityTransactionQueue.queueUpdate(
                        payload.new as EntityRow,
                        "update",
                    ),
            )
            .on(
                "postgres_changes",
                {
                    event: "DELETE",
                    schema: "public",
                    table: "entities",
                },
                (payload) =>
                    this.entityTransactionQueue.queueUpdate(
                        payload.old as EntityRow,
                        "delete",
                    ),
            );

        this.entityChannel.subscribe();
    }

    async destroy() {
        try {
            // Clean up entity subscription
            if (this.entityChannel) {
                await this.entityChannel.unsubscribe();
            }
            

            if (this.supabase) {
                await this.logout();
                await this.supabase.removeAllChannels();
                this.supabase.realtime.disconnect();
                this.supabase = null;
            }

            // Dispose all scene entities
            for (const entity of this.sceneEntities.values()) {
                entity.dispose();
            }
            this.sceneEntities.clear();

            this._scene = null;
            this._isConnected = false;

            console.log({
                message: "World destroyed successfully",
                type: "info",
            });
        } catch (error) {
            console.error("Error destroying world:", error);
            throw error;
        }
    }

    async loginWithEmail(email: string, password: string) {
        if (!this.supabase) {
            throw new Error("World not connected");
        }

        const { data, error } = await this.supabase.auth.signInWithPassword({
            email,
            password,
        });

        if (error) {
            throw error;
        }

        this._isAuthenticated = true;
        return data;
    }

    async loginWithOAuth(provider: Provider) {
        if (!this.supabase) {
            throw new Error("World not connected");
        }

        const { data, error } = await this.supabase.auth.signInWithOAuth({
            provider,
            options: {
                redirectTo: window.location.origin,
            },
        });

        if (error) {
            throw error;
        }

        this._isAuthenticated = true;
        return data;
    }

    async logout() {
        if (!this.supabase) {
            throw new Error("World not connected");
        }

        const { error } = await this.supabase.auth.signOut();

        if (error) {
            throw error;
        }

        this._isAuthenticated = false;
    }
}
