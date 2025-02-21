-- ============================================================================
-- 1. SCHEMA CREATION AND INITIAL PERMISSIONS
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS entity;

REVOKE ALL ON SCHEMA entity FROM vircadia_agent_proxy;
GRANT USAGE ON SCHEMA entity TO vircadia_agent_proxy;


-- ============================================================================
-- 2. CORE ENTITY ENUMS
-- ============================================================================
CREATE TYPE entity.script_status_enum AS ENUM ('ACTIVE', 'AWAITING_SCRIPTS', 'INACTIVE');
CREATE TYPE entity.script_compilation_status_enum AS ENUM ('PENDING', 'COMPILING', 'COMPILED', 'FAILED');


-- ============================================================================
-- 3. BASE TEMPLATES
-- ============================================================================
-- Audit Template Table
CREATE TABLE entity._template (
    general__created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    general__created_by UUID DEFAULT auth.current_agent_id(),
    general__updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    general__updated_by UUID DEFAULT auth.current_agent_id()
);


-- ============================================================================
-- 4. TRIGGERS AND TRIGGER FUNCTIONS
-- ============================================================================
-- Audit Column Update Function
CREATE OR REPLACE FUNCTION entity.update_audit_columns()
RETURNS TRIGGER AS $$
BEGIN
    NEW.general__updated_at = CURRENT_TIMESTAMP;
    NEW.general__updated_by = auth.current_agent_id();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;