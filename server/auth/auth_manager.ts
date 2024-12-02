import { VircadiaConfig_Server } from "../vircadia.server.config";
import type { Request } from "@types/node";
import passport from "@passport/passport";

export class AuthManager {
    private static instance: AuthManager | null = null;
    private static debugMode = false;
    private passport: passport.Passport;

    private constructor() {
        this.passport = new passport.Passport();
        this.initializeStrategies();
    }

    public static getInstance(debug = false): AuthManager {
        if (!AuthManager.instance) {
            AuthManager.instance = new AuthManager();
        }
        AuthManager.debugMode = debug;
        return AuthManager.instance;
    }

    public static isDebug(): boolean {
        return AuthManager.debugMode;
    }

    private initializeStrategies(): void {
        // Initialize your Passport strategies here
        // Example:
        // this.passport.use(new LocalStrategy(...));
        // this.passport.use(new JWTStrategy(...));
    }

    public isAdminRequest(req: Request): boolean {
        // Only check admin bypass in dev mode
        if (!VircadiaConfig_Server.devMode) {
            return false;
        }

        // Check if request IP is in allowed admin IPs
        const clientIp = req.ip;
        if (VircadiaConfig_Server.adminIps.includes(clientIp)) {
            // If API key is configured, verify it
            if (VircadiaConfig_Server.adminApiKey) {
                const authHeader = req.headers.authorization;
                return (
                    authHeader === `Bearer ${VircadiaConfig_Server.adminApiKey}`
                );
            }
            return true;
        }

        return false;
    }

    public getPassport(): passport.Passport {
        return this.passport;
    }
}

export default AuthManager.getInstance();
