DO $$ 
DECLARE
    pubname RECORD;
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'vircadia_agent_proxy') THEN
        REVOKE ALL ON SCHEMA config FROM vircadia_agent_proxy;
        REVOKE ALL ON SCHEMA auth FROM vircadia_agent_proxy;
        REVOKE ALL ON SCHEMA entity FROM vircadia_agent_proxy;
        REVOKE ALL ON SCHEMA tick FROM vircadia_agent_proxy;
        REVOKE ALL ON SCHEMA public FROM vircadia_agent_proxy;

        DROP ROLE vircadia_agent_proxy;
    END IF;

    -- Drop publications if they exist
    FOR pubname IN (SELECT p.pubname AS publication_name FROM pg_publication p)
    LOOP
        EXECUTE 'DROP PUBLICATION ' || quote_ident(pubname.publication_name);
    END LOOP;

    -- Drop specific schemas and all their contents
    DROP SCHEMA IF EXISTS public CASCADE;
    DROP SCHEMA IF EXISTS auth CASCADE;
    DROP SCHEMA IF EXISTS entity CASCADE;
    DROP SCHEMA IF EXISTS tick CASCADE;
    DROP SCHEMA IF EXISTS config CASCADE;
    -- Recreate the public schema (this is required for PostgreSQL)
    CREATE SCHEMA public;
    GRANT ALL ON SCHEMA public TO PUBLIC;
END $$;