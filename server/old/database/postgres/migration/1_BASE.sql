-- ============================================================================
-- 1. CORE SECURITY AND ROLE MANAGEMENT
-- ============================================================================

-- Create Agent Proxy Role with hard-coded password
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'vircadia_agent_proxy') THEN
        EXECUTE 'CREATE ROLE vircadia_agent_proxy LOGIN PASSWORD ''CHANGE_ME!'' NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION';
    END IF;
END
$$;

-- Then revoke everything
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;

-- Grant usage on schema
GRANT USAGE ON SCHEMA public TO vircadia_agent_proxy;

-- Only grant specific permissions needed
GRANT EXECUTE ON FUNCTION uuid_generate_v4() TO vircadia_agent_proxy;
