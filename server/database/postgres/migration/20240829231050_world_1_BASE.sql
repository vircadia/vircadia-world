REVOKE ALL ON FUNCTION pg_catalog.set_config(text, text, boolean) FROM PUBLIC;

-- Revoke all public access first
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;

DO $$
BEGIN
    EXECUTE 'SET "vircadia.agent_proxy_password" = ''CHANGE_ME!''';
END
$$;

-- Create our proxy role
DO $$
DECLARE
    pwd text;
BEGIN
    pwd := current_setting('vircadia.agent_proxy_password');
    EXECUTE format('CREATE ROLE vircadia_agent_proxy LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION', pwd);
END
$$;

-- Grant minimal permissions to start
GRANT USAGE ON SCHEMA public TO vircadia_agent_proxy;

-- Create ENUMS
CREATE TYPE operation_enum AS ENUM ('INSERT', 'UPDATE', 'DELETE');