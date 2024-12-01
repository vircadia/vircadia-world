import { z } from "zod";
import { parseArgs } from "node:util";

const envSchema = z.object({
    VRCA_SERVER_SUPABASE_URL: z
        .string()
        .url()
        .default("https://api-antares.vircadia.com"),
    VRCA_SERVER_SUPABASE_SERVICE_ROLE_KEY: z
        .string()
        .default(
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0",
        ),
    VRCA_SERVER_DEBUG: z.boolean().default(false),
    VRCA_SERVER_INTERNAL_SERVER_PORT: z.string().default("3020"),
    VRCA_SERVER_INTERNAL_SERVER_HOST: z.string().default("0.0.0.0"),
    VRCA_SERVER_FORCE_RESTART_SUPABASE: z.boolean().default(false),
});

const env = envSchema.parse(import.meta.env);

export const VircadiaConfig_Server = {
    supabaseUrl: env.VRCA_SERVER_SUPABASE_URL,
    supabaseServiceRoleKey: env.VRCA_SERVER_SUPABASE_SERVICE_ROLE_KEY,
    debug: env.VRCA_SERVER_DEBUG,
    serverPort: Number.parseInt(env.VRCA_SERVER_INTERNAL_SERVER_PORT),
    serverHost: env.VRCA_SERVER_INTERNAL_SERVER_HOST,
    forceRestartSupabase: env.VRCA_SERVER_FORCE_RESTART_SUPABASE,
};
