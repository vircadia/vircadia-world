import { log } from "../../sdk/vircadia-world-sdk-ts/module/general/log";
import type postgres from "postgres";
import type { Hono } from "hono";
import { compare, hash } from "bcrypt";
import { sign, verify } from "jsonwebtoken";
import type { MiddlewareHandler } from "hono";
import { VircadiaConfig_Server } from "../vircadia.server.config";
import { temporaryDirectory } from "tempy";
import { build } from "bun";

export enum AuthProvider {
    PASSWORD = "password",
    GITHUB = "github",
    GOOGLE = "google",
}

interface OAuthProviderConfig {
    enabled: boolean;
    displayName: string;
    clientId: string;
    clientSecret: string;
    callbackUrl: string;
    authorizeUrl: string;
    tokenUrl: string;
    userInfoUrl: string;
    scope: string[];
    userDataMapping: {
        endpoint: string;
        additionalEndpoints?: {
            [key: string]: string;
        };
        fields: {
            providerId: string;
            email: string;
            username: string;
        };
    };
}

interface LoginCredentials {
    email: string;
    password: string;
}

interface RegisterData {
    email: string;
    username: string;
    password: string;
}

interface AuthProviderHandler {
    authenticate: (data: any) => Promise<{
        providerId: string;
        email: string;
        username: string;
    }>;
}

interface SessionData {
    sessionId: string;
    agentId: string;
}

interface AuthConfig {
    providers: {
        [key: string]: OAuthProviderConfig;
    };
    jwt: {
        secret: string;
        sessionDuration: string;
        bcryptRounds: number;
    };
}

class AuthManager {
    private authProviders: Map<AuthProvider, AuthProviderHandler> = new Map();

    constructor(
        private sql: postgres.Sql,
        private debugMode: boolean,
    ) {
        // Register built-in providers
        this.registerAuthProvider(AuthProvider.PASSWORD, {
            authenticate: async (credentials: LoginCredentials) => {
                const [agent] = await this.sql`
                    SELECT general__uuid, auth__password_hash, profile__username
                    FROM agent_profiles
                    WHERE auth__email = ${credentials.email}
                `;

                if (!agent || !agent.auth__password_hash) {
                    throw new Error("Invalid credentials");
                }

                const validPassword = await compare(
                    credentials.password,
                    agent.auth__password_hash,
                );

                if (!validPassword) {
                    throw new Error("Invalid credentials");
                }

                return {
                    providerId: agent.general__uuid,
                    email: credentials.email,
                    username: agent.profile__username,
                };
            },
        });
    }

    async initialize() {
        try {
            log({
                message: "Initializing auth manager",
                debug: this.debugMode,
                type: "debug",
            });

            const [result] = await this.sql`
                SELECT cleanup_old_sessions() as cleaned_count;
            `;

            log({
                message: `Cleaned up ${result.cleaned_count} old sessions`,
                debug: this.debugMode,
                type: "debug",
            });

            log({
                message: "Initialized AuthManager",
                debug: this.debugMode,
                type: "debug",
            });
        } catch (error) {
            log({
                message: `Failed to initialize AuthManager: ${error}`,
                debug: this.debugMode,
                type: "error",
            });
            throw error;
        }
    }

    registerAuthProvider(provider: AuthProvider, handler: AuthProviderHandler) {
        this.authProviders.set(provider, handler);
    }

    async register(data: RegisterData) {
        try {
            const passwordHash = await hash(
                data.password,
                VircadiaConfig_Server.auth.jwt.bcryptRounds,
            );

            const [agent] = await this.sql`
                INSERT INTO agent_profiles (
                    profile__username,
                    auth__email,
                    auth__password_hash
                ) VALUES (
                    ${data.username},
                    ${data.email},
                    ${passwordHash}
                )
                RETURNING general__uuid
            `;

            await this.sql`
                INSERT INTO agent_roles (
                    auth__agent_id,
                    auth__role_name,
                    auth__is_active
                ) VALUES (
                    ${agent.general__uuid},
                    'agent',
                    true
                )
            `;

            return this.createSession(agent.general__uuid);
        } catch (error) {
            log({
                message: `Registration failed: ${error}`,
                debug: this.debugMode,
                type: "error",
            });
            throw error;
        }
    }

    async login(credentials: LoginCredentials) {
        return this.authenticateWithProvider(
            AuthProvider.PASSWORD,
            credentials,
        );
    }

    async logout(sessionId: string) {
        await this.sql`
            SELECT invalidate_session(${sessionId});
        `;
    }

    async authenticateWithProvider(provider: AuthProvider, data: any) {
        if (provider === AuthProvider.PASSWORD) {
            const handler = this.authProviders.get(provider);
            if (!handler) {
                throw new Error(`Auth provider ${provider} not supported`);
            }
            const userData = await handler.authenticate(data);
            return this.storeAgentAndCreateSession(userData, provider);
        }

        const userData = await this.handleOAuthFlow(provider, data);
        return this.storeAgentAndCreateSession(userData, provider);
    }

    sessionMiddleware(): MiddlewareHandler {
        return async (c, next) => {
            const token = c.req.header("Authorization")?.replace("Bearer ", "");

            if (token) {
                try {
                    const decoded = verify(
                        token,
                        VircadiaConfig_Server.auth.jwt.secret,
                    ) as {
                        sessionId: string;
                        agentId: string;
                    };

                    // Set the database session context
                    await this
                        .sql`SELECT set_session_context(${decoded.sessionId}::UUID)`;

                    c.set("session", {
                        agentId: decoded.agentId,
                        isAuthenticated: true,
                    });
                } catch (error) {
                    log({
                        message: `Session validation failed: ${error}`,
                        debug: this.debugMode,
                        type: "debug",
                    });
                }
            }

            if (!c.get("session")) {
                // Set anonymous context
                await this.sql`SELECT set_session_context(NULL)`;

                c.set("session", {
                    agentId: "00000000-0000-0000-0000-000000000001",
                    isAuthenticated: false,
                });
            }

            await next();
        };
    }

    private async handleOAuthFlow(provider: AuthProvider, code: string) {
        const config = VircadiaConfig_Server.auth.providers[provider];
        if (!config?.enabled) {
            throw new Error(`Provider ${provider} not enabled`);
        }

        // Exchange code for token
        const tokenResponse = await fetch(config.tokenUrl, {
            method: "POST",
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                client_id: config.clientId,
                client_secret: config.clientSecret,
                code,
                redirect_uri: config.callbackUrl,
            }),
        });

        const tokenData = await tokenResponse.json();
        if (!tokenData.access_token) {
            throw new Error("Failed to obtain access token");
        }

        // Fetch user data from main endpoint
        const userResponse = await fetch(config.userDataMapping.endpoint, {
            headers: {
                Authorization: `Bearer ${tokenData.access_token}`,
                Accept: "application/json",
            },
        });
        const userData = await userResponse.json();

        // Fetch data from additional endpoints if specified
        const additionalData: Record<string, any> = {};
        if (config.userDataMapping.additionalEndpoints) {
            for (const [key, url] of Object.entries(
                config.userDataMapping.additionalEndpoints,
            )) {
                const response = await fetch(url as string, {
                    headers: {
                        Authorization: `Bearer ${tokenData.access_token}`,
                        Accept: "application/json",
                    },
                });
                additionalData[key] = await response.json();
            }
        }

        // Extract fields using regex patterns
        const extractField = (pattern: string, data: any) => {
            const jsonString = JSON.stringify(data);
            const match = jsonString.match(new RegExp(pattern));
            if (!match || !match[1]) {
                throw new Error(
                    `Could not extract field using pattern: ${pattern}`,
                );
            }
            return match[1];
        };

        const extractedData = {
            providerId: extractField(
                config.userDataMapping.fields.providerId,
                userData,
            ).toString(),
            email: extractField(config.userDataMapping.fields.email, userData),
            username: extractField(
                config.userDataMapping.fields.username,
                userData,
            ),
        };

        // Store or update provider authentication
        await this.sql`
            INSERT INTO auth.agent_auth_providers (
                auth__agent_id,
                auth__provider_name,
                auth__provider_uid
            ) VALUES (
                ${extractedData.providerId},
                ${provider},
                ${extractedData.providerId}
            )
            ON CONFLICT (auth__agent_id, auth__provider_name) 
            DO UPDATE SET auth__provider_uid = EXCLUDED.auth__provider_uid
        `;

        return this.storeAgentAndCreateSession(extractedData, provider);
    }

    private async storeAgentAndCreateSession(
        userData: { providerId: string; email: string; username: string },
        provider: AuthProvider,
    ) {
        const [agent] = await this.sql`
            INSERT INTO auth.agent_profiles (
                profile__username,
                auth__email
            ) VALUES (
                ${userData.username},
                ${userData.email}
            )
            ON CONFLICT (auth__email) DO UPDATE
            SET profile__username = EXCLUDED.profile__username
            RETURNING general__uuid
        `;

        await this.sql`
            INSERT INTO auth.agent_sessions (
                auth__agent_id,
                auth__provider_name,
                session__is_active
            ) VALUES (
                ${agent.general__uuid},
                ${provider},
                true
            )
            ON CONFLICT (auth__agent_id, auth__provider_name) 
            DO UPDATE SET session__is_active = EXCLUDED.session__is_active
        `;

        return this.createSession(agent.general__uuid, provider);
    }

    private async createSession(agentId: string, providerName?: string) {
        const [session] = await this.sql`
            SELECT create_agent_session(${agentId}, ${providerName}) as general__session_id;
        `;

        const token = sign(
            {
                sessionId: session.general__session_id,
                agentId,
            },
            VircadiaConfig_Server.auth.jwt.secret,
            { expiresIn: VircadiaConfig_Server.auth.jwt.sessionDuration },
        );

        return { sessionId: session.general__session_id, token };
    }

    private async validateSession(token: string): Promise<string | null> {
        try {
            const decoded = verify(
                token,
                VircadiaConfig_Server.auth.jwt.secret,
            ) as {
                sessionId: string;
                agentId: string;
            };

            const [session] = await this.sql`
                SELECT set_current_session(${decoded.sessionId});
                
                SELECT * FROM auth.agent_sessions
                WHERE general__session_id = ${decoded.sessionId}
                AND session__is_active = true
                AND session__last_seen_at > NOW() - INTERVAL '24 hours'
            `;

            if (!session) {
                return null;
            }

            return decoded.agentId;
        } catch (error) {
            return null;
        }
    }
}

class ScriptManager {
    private compilationQueue: Set<string> = new Set();

    constructor(
        private sql: postgres.Sql,
        private debugMode: boolean,
        private auth: AuthManager,
    ) {}

    async initialize() {
        try {
            log({
                message: "Initializing script manager",
                debug: this.debugMode,
                type: "debug",
            });

            await this.sql`
                UPDATE entity.entity_scripts 
                SET 
                    compiled__web__node__script_status = 'FAILED',
                    compiled__web__bun__script_status = 'FAILED',
                    compiled__web__browser__script_status = 'FAILED'
                WHERE 
                    compiled__web__node__script_status = 'PENDING' OR
                    compiled__web__bun__script_status = 'PENDING' OR
                    compiled__web__browser__script_status = 'PENDING'
            `;

            log({
                message: "Initialized ScriptManager",
                debug: this.debugMode,
                type: "debug",
            });
        } catch (error) {
            log({
                message: `Failed to initialize ScriptManager: ${error}`,
                debug: this.debugMode,
                type: "error",
            });
            throw error;
        }
    }

    private async updateScriptStatus(
        scriptId: string,
        target: "node" | "bun" | "browser",
        status: "PENDING" | "COMPILED" | "FAILED",
        compiledScript?: string,
        scriptSha256?: string,
    ) {
        const updates = {
            [`compiled__web__${target}__script_status`]: status,
            ...(compiledScript && {
                [`compiled__web__${target}__script`]: compiledScript,
            }),
            ...(scriptSha256 && {
                [`compiled__web__${target}__script_sha256`]: scriptSha256,
            }),
        };

        await this.sql`
            UPDATE entity.entity_scripts 
            SET ${this.sql(updates)}
            WHERE general__script_id = ${scriptId}
        `;
    }

    private async prepareGitRepo(
        repoUrl: string,
        entryPath: string,
    ): Promise<string> {
        const tempDir = temporaryDirectory();

        try {
            const clone = Bun.spawn(["git", "clone", repoUrl, tempDir], {
                stdout: "inherit",
                stderr: "inherit",
            });

            const cloneSuccess = await clone.exited;
            if (cloneSuccess !== 0) {
                throw new Error(`Failed to clone repository: ${repoUrl}`);
            }

            const install = Bun.spawn(["bun", "install"], {
                cwd: tempDir,
                stdout: "inherit",
                stderr: "inherit",
            });

            const installSuccess = await install.exited;
            if (installSuccess !== 0) {
                throw new Error(
                    `Failed to install dependencies for repository: ${repoUrl}`,
                );
            }

            return `${tempDir}/${entryPath}`;
        } catch (error) {
            log({
                message: `Error cloning repository ${repoUrl}: ${error}`,
                type: "error",
                debug: this.debugMode,
            });
            throw error;
        }
    }

    private async compileScriptCode(path: string): Promise<{
        success: boolean;
        compiledCode?: { node: string; browser: string; bun: string };
        hashes?: { node: string; browser: string; bun: string };
        error?: string;
    }> {
        try {
            const results = await Promise.all([
                build({ entrypoints: [path], target: "node" }),
                build({ entrypoints: [path], target: "browser" }),
                build({ entrypoints: [path], target: "bun" }),
            ]);

            if (results.every((r) => r.success)) {
                const [nodeCode, browserCode, bunCode] = await Promise.all([
                    results[0].outputs[0].text(),
                    results[1].outputs[0].text(),
                    results[2].outputs[0].text(),
                ]);

                return {
                    success: true,
                    compiledCode: {
                        node: nodeCode,
                        browser: browserCode,
                        bun: bunCode,
                    },
                    hashes: {
                        node: Bun.hash(nodeCode).toString(),
                        browser: Bun.hash(browserCode).toString(),
                        bun: Bun.hash(bunCode).toString(),
                    },
                };
            }

            return {
                success: false,
                error: `One or more builds failed: ${results.map((r) => r.logs).join("\n")}`,
            };
        } catch (error) {
            return {
                success: false,
                error: `Compilation error: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
    }

    async compileScript(scriptId: string, gitRef?: string) {
        const queueKey = `${scriptId}:${gitRef || "latest"}`;

        if (this.compilationQueue.has(queueKey)) {
            log({
                message: `Script ${scriptId} is already being compiled`,
                debug: this.debugMode,
                type: "warn",
            });
            return;
        }

        try {
            this.compilationQueue.add(queueKey);

            const [script] = await this.sql`
                SELECT * FROM entity.entity_scripts 
                WHERE general__script_id = ${scriptId}
            `;

            if (!script) {
                throw new Error(`Script ${scriptId} not found`);
            }

            // Set all compilation statuses to PENDING
            await this.sql`
                UPDATE entity.entity_scripts 
                SET 
                    compiled__web__node__script_status = 'PENDING',
                    compiled__web__browser__script_status = 'PENDING',
                    compiled__web__bun__script_status = 'PENDING'
                WHERE general__script_id = ${scriptId}
            `;

            const scriptPath = await this.prepareGitRepo(
                script.source__git__repo_url,
                script.source__git__repo_entry_path,
            );

            const compilationResult = await this.compileScriptCode(scriptPath);

            if (
                compilationResult.success &&
                compilationResult.compiledCode &&
                compilationResult.hashes
            ) {
                await this.sql`
                    UPDATE entity.entity_scripts 
                    SET 
                        compiled__web__node__script = ${compilationResult.compiledCode.node},
                        compiled__web__node__script_sha256 = ${compilationResult.hashes.node},
                        compiled__web__node__script_status = 'COMPILED',
                        compiled__web__browser__script = ${compilationResult.compiledCode.browser},
                        compiled__web__browser__script_sha256 = ${compilationResult.hashes.browser},
                        compiled__web__browser__script_status = 'COMPILED',
                        compiled__web__bun__script = ${compilationResult.compiledCode.bun},
                        compiled__web__bun__script_sha256 = ${compilationResult.hashes.bun},
                        compiled__web__bun__script_status = 'COMPILED',
                        general__updated_at = NOW()
                    WHERE general__script_id = ${scriptId}
                `;
            } else {
                await this.sql`
                    UPDATE entity.entity_scripts 
                    SET 
                        compiled__web__node__script_status = 'FAILED',
                        compiled__web__browser__script_status = 'FAILED',
                        compiled__web__bun__script_status = 'FAILED',
                        general__updated_at = NOW()
                    WHERE general__script_id = ${scriptId}
                `;

                log({
                    message: `Compilation failed for script ${scriptId}: ${compilationResult.error}`,
                    type: "error",
                    debug: this.debugMode,
                });
            }
        } catch (error) {
            log({
                message: `Error during script compilation: ${error}`,
                debug: this.debugMode,
                type: "error",
            });
        } finally {
            this.compilationQueue.delete(queueKey);
        }
    }

    async compileScriptsByRepo(
        repoUrl: string,
        entryPath: string,
        gitRef?: string,
    ) {
        try {
            const scripts = await this.sql`
                SELECT general__script_id 
                FROM entity.entity_scripts 
                WHERE 
                    source__git__repo_url = ${repoUrl} 
                    AND source__git__repo_entry_path = ${entryPath}
            `;

            for (const script of scripts) {
                await this.compileScript(script.general__script_id, gitRef);
            }
        } catch (error) {
            log({
                message: `Error during repo scripts compilation: ${error}`,
                debug: this.debugMode,
                type: "error",
            });
        }
    }
}

class ApiRouteManager {
    constructor(
        private auth: AuthManager,
        private scripts: ScriptManager,
        private sql: postgres.Sql,
        private debugMode: boolean,
    ) {}

    addRoutes(app: Hono) {
        this.addAuthRoutes(app);
        this.addScriptRoutes(app);
    }

    private addAuthRoutes(app: Hono) {
        const routes = app.basePath("/services/world-auth");

        routes.use("/*", this.auth.sessionMiddleware());

        routes.post("/register", async (c) => {
            try {
                const data = (await c.req.json()) as RegisterData;
                const session = await this.auth.register(data);
                return c.json(session);
            } catch (error) {
                return c.json({ error: "Registration failed" }, 400);
            }
        });

        routes.post("/login", async (c) => {
            try {
                const credentials = (await c.req.json()) as LoginCredentials;
                const session = await this.auth.login(credentials);
                return c.json(session);
            } catch (error) {
                return c.json({ error: "Login failed" }, 401);
            }
        });

        // ... (rest of auth routes)
    }

    private addScriptRoutes(app: Hono) {
        const routes = app.basePath("/services/world-script");

        // Add auth middleware to all script routes
        routes.use("/*", this.auth.sessionMiddleware());

        // Webhook endpoint for triggering compilation
        routes.post("/compile", async (c) => {
            const session = c.get("session");
            if (!session?.isAuthenticated) {
                return c.json({ error: "Authentication required" }, 401);
            }

            const body = await c.req.json();
            const { scriptId, repoUrl, entryPath, gitRef } = body;

            if (scriptId) {
                await this.scripts.compileScript(scriptId, gitRef);
                return c.json({ status: "compilation queued", scriptId });
            }

            if (repoUrl && entryPath) {
                await this.scripts.compileScriptsByRepo(
                    repoUrl,
                    entryPath,
                    gitRef,
                );
                return c.json({
                    status: "compilation queued",
                    repoUrl,
                    entryPath,
                });
            }

            return c.json({ error: "Invalid request parameters" }, 400);
        });

        routes.get("/status/:scriptId", async (c) => {
            const session = c.get("session");
            if (!session?.isAuthenticated) {
                return c.json({ error: "Authentication required" }, 401);
            }

            const scriptId = c.req.param("scriptId");
            const script = await this.sql`
                SELECT 
                    compiled__web__node__script_status as node_status,
                    compiled__web__bun__script_status as bun_status,
                    compiled__web__browser__script_status as browser_status
                FROM entity.entity_scripts 
                WHERE general__script_id = ${scriptId}
            `;

            if (!script.length) {
                return c.json({ error: "Script not found" }, 404);
            }

            return c.json(script[0]);
        });

        if (this.debugMode) {
            routes.get("/queue", (c) => {
                return c.json({
                    activeCompilations: Array.from(
                        this.scripts.compilationQueue,
                    ),
                });
            });
        }
    }
}

export class WorldApiManager {
    private auth: AuthManager;
    private scripts: ScriptManager;
    private routes: ApiRouteManager;

    constructor(
        private sql: postgres.Sql,
        private readonly debugMode: boolean,
    ) {
        this.auth = new AuthManager(sql, debugMode);
        this.scripts = new ScriptManager(sql, debugMode, this.auth);
        this.routes = new ApiRouteManager(
            this.auth,
            this.scripts,
            sql,
            debugMode,
        );
    }

    async initialize() {
        await this.auth.initialize();
        await this.scripts.initialize();
    }

    addRoutes(app: Hono) {
        this.routes.addRoutes(app);
    }
}
