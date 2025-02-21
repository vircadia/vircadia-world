-- ============================================================================
-- 1. SECURITY SETUP
-- ============================================================================
-- Revoke Critical System Access
REVOKE ALL ON FUNCTION pg_catalog.set_config(text, text, boolean) FROM PUBLIC;


-- ============================================================================
-- 2. PUBLIC SCHEMA LOCKDOWN
-- ============================================================================
-- Revoke all public access first
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;


-- ============================================================================
-- 3. SYSTEM CONFIGURATION
-- ============================================================================


-- ============================================================================
-- 4. ROLE CREATION
-- ============================================================================
-- Create Agent Proxy Role with hard-coded password
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'vircadia_agent_proxy') THEN
        EXECUTE 'CREATE ROLE vircadia_agent_proxy LOGIN PASSWORD ''CHANGE_ME!'' NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION';
    END IF;
END
$$;


-- ============================================================================
-- 5. INITIAL PERMISSIONS
-- ============================================================================
-- Grant minimal permissions to start
-- TODO: I do not think this is necessary since we whitelist vircadia_agent_proxy specifically only.
GRANT USAGE ON SCHEMA public TO vircadia_agent_proxy;

