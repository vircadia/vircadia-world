import { makeAutoObservable } from "mobx";
import {
    createClient,
    type SupabaseClient,
    type Provider,
} from "@supabase/supabase-js";
import type { Scene } from "@babylonjs/core";

export class ClientCore {
    private supabase: SupabaseClient | null = null;
    private _scene: Scene | null = null;
    private _isConnected = false;
    private _isAuthenticated = false;

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

            return this.supabase;
        } catch (error) {
            console.error("Failed to connect to world:", error);
            await this.destroy();
            throw error;
        }
    }

    async destroy() {
        try {
            if (this.supabase) {
                await this.logout();
                await this.supabase.removeAllChannels();
                this.supabase.realtime.disconnect();
                this.supabase = null;
            }

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
