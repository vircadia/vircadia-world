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
-- Set Agent Proxy Password
DO $$
BEGIN
    EXECUTE 'SET "vircadia.agent_proxy_password" = ''CHANGE_ME!''';
END
$$;


-- ============================================================================
-- 4. ROLE CREATION
-- ============================================================================
-- Create Agent Proxy Role
DO $$
DECLARE
    pwd text;
BEGIN
    pwd := current_setting('vircadia.agent_proxy_password');
    EXECUTE format('CREATE ROLE vircadia_agent_proxy LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION', pwd);
END
$$;


-- ============================================================================
-- 5. INITIAL PERMISSIONS
-- ============================================================================
-- Grant minimal permissions to start
-- TODO: I do not think this is necessary since we whitelist vircadia_agent_proxy specifically only.
GRANT USAGE ON SCHEMA public TO vircadia_agent_proxy;


-- ============================================================================
-- 6. TYPE DEFINITIONS
-- ============================================================================
-- Create ENUMS
CREATE TYPE operation_enum AS ENUM ('INSERT', 'UPDATE', 'DELETE');
