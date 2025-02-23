-- ============================================================================
-- 1. SCHEMA CREATION AND INITIAL PERMISSIONS
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS auth;

REVOKE ALL ON SCHEMA auth FROM vircadia_agent_proxy;
GRANT USAGE ON SCHEMA auth TO vircadia_agent_proxy;


-- ============================================================================
-- 2. CORE AUTHENTICATION FUNCTIONS
-- ============================================================================

-- Revoke Critical System Access
REVOKE ALL ON FUNCTION pg_catalog.set_config(text, text, boolean) FROM PUBLIC;

-- System Agent ID Function
CREATE OR REPLACE FUNCTION auth.get_system_agent_id() 
RETURNS UUID AS $$
BEGIN
    RETURN '00000000-0000-0000-0000-000000000000'::UUID;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Super Admin Check Function
CREATE OR REPLACE FUNCTION auth.is_system_agent()
RETURNS boolean AS $$ 
BEGIN
    RETURN session_user IN (
        SELECT rolname 
        FROM pg_roles 
        WHERE rolsuper
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Proxy Agent Check Function
CREATE OR REPLACE FUNCTION auth.is_proxy_agent()
RETURNS boolean AS $$
BEGIN
    RETURN session_user = 'vircadia_agent_proxy';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Current Agent ID Function
CREATE OR REPLACE FUNCTION auth.current_agent_id() 
RETURNS UUID AS $$
BEGIN
    -- First check if user is super admin
    IF auth.is_system_agent() THEN
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
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================================
-- 3. BASE TEMPLATES
-- ============================================================================
-- Audit Template Table
CREATE TABLE auth._template (
    general__created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    general__created_by UUID DEFAULT auth.current_agent_id(),
    general__updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    general__updated_by UUID DEFAULT auth.current_agent_id()
);


-- ============================================================================
-- 4. TRIGGERS AND TRIGGER FUNCTIONS
-- ============================================================================
-- Audit Column Update Function
CREATE OR REPLACE FUNCTION auth.update_audit_columns()
RETURNS TRIGGER AS $$
BEGIN
    NEW.general__updated_at = CURRENT_TIMESTAMP;
    NEW.general__updated_by = auth.current_agent_id();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
