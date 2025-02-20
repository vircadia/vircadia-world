-- TODO: Add a max session count (default: 1) per auth provider, thus limiting sign-ins for an agent for a single provider.
CREATE SCHEMA IF NOT EXISTS auth;

REVOKE ALL ON SCHEMA auth FROM vircadia_agent_proxy;
GRANT USAGE ON SCHEMA auth TO vircadia_agent_proxy;

-- Function to get system agent id (needed for current_agent_id)
CREATE OR REPLACE FUNCTION auth.get_system_agent_id() 
RETURNS UUID AS $$
BEGIN
    RETURN '00000000-0000-0000-0000-000000000000'::UUID;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION auth.is_super_admin()
RETURNS boolean AS $$ 
BEGIN
    RETURN (SELECT usesuper FROM pg_user WHERE usename = CURRENT_USER);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION auth.current_agent_id() 
RETURNS UUID AS $$
BEGIN
    -- First check if user is super admin
    IF auth.is_super_admin() THEN
        RETURN auth.get_system_agent_id();
    END IF;

    -- Check if setting exists and is not empty/null
    IF current_setting('app.current_agent_id', true) IS NULL OR 
       TRIM(current_setting('app.current_agent_id', true)) = '' OR
       TRIM(current_setting('app.current_agent_id', true)) = 'NULL' THEN
        RAISE EXCEPTION 'No agent ID set in context';
    END IF;

    -- Validate UUID length
    IF LENGTH(TRIM(current_setting('app.current_agent_id', true))) != 36 THEN
        RAISE EXCEPTION 'Invalid UUID format: incorrect length';
    END IF;

    -- Try to cast to UUID, raise exception if invalid
    BEGIN
        RETURN TRIM(current_setting('app.current_agent_id', true))::UUID;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Invalid UUID format: %', current_setting('app.current_agent_id', true);
    END;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION auth.current_agent_id() TO vircadia_agent_proxy;

CREATE TABLE auth._template (
    general__created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    general__created_by UUID DEFAULT auth.current_agent_id(),
    general__updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    general__updated_by UUID DEFAULT auth.current_agent_id()
);

-- Update function to modify both updated_at and updated_by timestamps
CREATE OR REPLACE FUNCTION auth.update_audit_columns()
RETURNS TRIGGER AS $$
BEGIN
    NEW.general__updated_at = CURRENT_TIMESTAMP;
    NEW.general__updated_by = auth.current_agent_id();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;