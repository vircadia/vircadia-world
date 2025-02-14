-- TODO: Add a max session count (default: 1) per auth provider, thus limiting sign-ins for an agent for a single provider.
CREATE SCHEMA IF NOT EXISTS auth;

-- Function to get system agent id (needed for current_agent_id)
CREATE OR REPLACE FUNCTION auth.get_system_agent_id() 
RETURNS UUID AS $$
BEGIN
    RETURN '00000000-0000-0000-0000-000000000000'::UUID;
END;
$$ LANGUAGE plpgsql;

-- Function to get anon agent id (needed for current_agent_id)
CREATE OR REPLACE FUNCTION auth.get_anon_agent_id() 
RETURNS UUID AS $$
BEGIN
    RETURN '00000000-0000-0000-0000-000000000001'::UUID;
END;
$$ LANGUAGE plpgsql;

-- Create current_agent_id function before it's used in template
CREATE OR REPLACE FUNCTION auth.current_agent_id() 
RETURNS UUID AS $$
BEGIN
    -- First try to get the setting
    IF current_setting('app.current_agent_id', true) IS NULL OR 
       TRIM(current_setting('app.current_agent_id', true)) = '' OR
       TRIM(current_setting('app.current_agent_id', true)) = 'NULL' OR
       LENGTH(TRIM(current_setting('app.current_agent_id', true))) != 36 THEN  -- UUID length check
        -- Return anonymous user if no context is set or invalid format
        RETURN auth.get_anon_agent_id();
    END IF;

    -- Try to cast to UUID, return anon if invalid
    BEGIN
        RETURN TRIM(current_setting('app.current_agent_id', true))::UUID;
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Invalid UUID in app.current_agent_id setting: %', current_setting('app.current_agent_id', true);
        RETURN auth.get_anon_agent_id();
    END;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE auth._template (
    general__created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    general__created_by UUID DEFAULT auth.current_agent_id(),
    general__updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    general__updated_by UUID DEFAULT auth.current_agent_id()
);
