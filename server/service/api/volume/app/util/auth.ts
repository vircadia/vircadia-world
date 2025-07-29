import type postgres from "postgres";
import { sign } from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { Auth } from "../../../../../../sdk/vircadia-world-sdk-ts/schema/src/vircadia.schema.general";
import { BunLogModule } from "../../../../../../sdk/vircadia-world-sdk-ts/bun/src/module/vircadia.common.bun.log.module";
import { serverConfiguration } from "../../../../../../sdk/vircadia-world-sdk-ts/bun/src/config/vircadia.server.config";

const LOG_PREFIX = "Auth Helpers";

export async function createAnonymousUser(db: postgres.Sql): Promise<{
    agentId: string;
    sessionId: string;
    token: string;
}> {
    try {
        return await db.begin(async (tx) => {
            // Fetch JWT secret for anon provider
            const [providerConfig] = await tx<
                [{ provider__jwt_secret: string }]
            >`
                SELECT provider__jwt_secret
                FROM auth.auth_providers
                WHERE provider__name = 'anon'
                  AND provider__enabled = true
            `;

            if (!providerConfig) {
                throw new Error(
                    "Anonymous provider not configured or disabled",
                );
            }
            const jwtSecret = providerConfig.provider__jwt_secret;

            const agentId = randomUUID();
            const username = `Anonymous-${agentId.substring(0, 8)}`;

            // Create agent profile for anonymous user
            await tx`
                INSERT INTO auth.agent_profiles (
                    general__agent_profile_id,
                    profile__username,
                    auth__email,
                    auth__is_admin,
                    auth__is_anon,
                    profile__last_seen_at
                ) VALUES (
                    ${agentId}::UUID,
                    ${username},
                    NULL,
                    false,
                    true,
                    NOW()
                )
            `;

            // Create a new session
            const sessionId = randomUUID();
            const expiresAt = new Date();
            expiresAt.setHours(expiresAt.getHours() + 1); // 1 hour session for anonymous users

            // Create JWT token
            const jwt = sign(
                {
                    sessionId,
                    agentId,
                    provider: Auth.E_Provider.ANONYMOUS,
                },
                jwtSecret,
                {
                    expiresIn: "1h",
                },
            );

            // Store session in database
            await tx`
                INSERT INTO auth.agent_sessions (
                    general__session_id,
                    auth__agent_id,
                    auth__provider_name,
                    session__expires_at,
                    session__jwt,
                    session__is_active
                ) VALUES (
                    ${sessionId}::UUID,
                    ${agentId}::UUID,
                    'anon',
                    ${expiresAt},
                    ${jwt},
                    true
                )
            `;

            return {
                agentId,
                sessionId,
                token: jwt,
            };
        });
    } catch (error) {
        BunLogModule({
            prefix: LOG_PREFIX,
            message: "Failed to create anonymous user",
            error,
            debug: serverConfiguration.VRCA_SERVER_DEBUG,
            suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
            type: "error",
        });
        throw error;
    }
}

export async function signOut(
    db: postgres.Sql,
    sessionId: string,
): Promise<void> {
    try {
        // Invalidate the session
        await db`
            UPDATE auth.agent_sessions
            SET session__is_active = false,
                general__updated_at = NOW()
            WHERE general__session_id = ${sessionId}::UUID
        `;

        BunLogModule({
            prefix: LOG_PREFIX,
            message: "User signed out successfully",
            debug: serverConfiguration.VRCA_SERVER_DEBUG,
            suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
            type: "debug",
            data: { sessionId },
        });
    } catch (error) {
        BunLogModule({
            prefix: LOG_PREFIX,
            message: "Failed to sign out user",
            error,
            debug: serverConfiguration.VRCA_SERVER_DEBUG,
            suppress: serverConfiguration.VRCA_SERVER_SUPPRESS,
            type: "error",
        });
        throw error;
    }
}
