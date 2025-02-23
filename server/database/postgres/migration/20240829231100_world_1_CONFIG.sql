-- ============================================================================
-- 1. CORE SECURITY AND ROLE MANAGEMENT
-- ============================================================================
-- Revoke all public access first
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;

-- Create Agent Proxy Role with hard-coded password
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'vircadia_agent_proxy') THEN
        EXECUTE 'CREATE ROLE vircadia_agent_proxy LOGIN PASSWORD ''CHANGE_ME!'' NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION';
    END IF;
END
$$;

-- Grant minimal permissions to start
-- TODO: I do not think this is necessary since we whitelist vircadia_agent_proxy specifically only.
GRANT USAGE ON SCHEMA public TO vircadia_agent_proxy;


-- ============================================================================
-- 2. SCHEMA CREATION AND INITIAL PERMISSIONS
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS config;

REVOKE ALL ON SCHEMA config FROM PUBLIC, vircadia_agent_proxy;
GRANT USAGE ON SCHEMA config TO vircadia_agent_proxy;


-- ============================================================================
-- 3. TYPES
-- ============================================================================
CREATE TYPE config.operation_enum AS ENUM ('INSERT', 'UPDATE', 'DELETE');


-- ============================================================================
-- 4. CONFIGURATION TABLES
-- ============================================================================
-- Entity Configuration
CREATE TABLE config.entity_config (
    entity_config__script_compilation_timeout_ms INTEGER NOT NULL
);

-- Network Configuration
CREATE TABLE config.network_config (
    network_config__max_latency_ms INTEGER NOT NULL,
    network_config__warning_latency_ms INTEGER NOT NULL,
    network_config__consecutive_warnings_before_kick INTEGER NOT NULL,
    network_config__measurement_window_ticks INTEGER NOT NULL,
    network_config__packet_loss_threshold_percent INTEGER NOT NULL
);

-- Authentication Configuration
CREATE TABLE config.auth_config (
    auth_config__session_cleanup_interval BIGINT NOT NULL,
    auth_config__heartbeat_interval_ms INTEGER NOT NULL,
    auth_config__heartbeat_inactive_expiry_ms INTEGER NOT NULL
);

-- Database Version Configuration
CREATE TABLE config.database_config (
    database_config__major_version INTEGER NOT NULL,
    database_config__minor_version INTEGER NOT NULL,
    database_config__patch_version INTEGER NOT NULL,
    database_config__migration_timestamp TEXT NOT NULL
);


-- ============================================================================
-- 5. SEED TRACKING
-- ============================================================================
CREATE TABLE config.seeds (
    general__seed_id SERIAL PRIMARY KEY,
    general__name TEXT NOT NULL,
    general__executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- ============================================================================
-- 6. PERMISSIONS
-- ============================================================================
-- Revoke All Permissions
REVOKE ALL ON ALL TABLES IN SCHEMA config FROM PUBLIC, vircadia_agent_proxy;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA config FROM PUBLIC, vircadia_agent_proxy;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA config FROM PUBLIC, vircadia_agent_proxy;

-- Grant Specific Permissions
GRANT SELECT ON config.entity_config TO vircadia_agent_proxy;
GRANT SELECT ON config.network_config TO vircadia_agent_proxy;
GRANT SELECT ON config.auth_config TO vircadia_agent_proxy;
GRANT SELECT ON config.database_config TO vircadia_agent_proxy;


-- ============================================================================
-- 7. INITIAL DATA
-- ============================================================================
-- Entity Configuration
INSERT INTO config.entity_config (
    entity_config__script_compilation_timeout_ms
) VALUES (60000);

-- Network Configuration
INSERT INTO config.network_config (
    network_config__max_latency_ms,
    network_config__warning_latency_ms,
    network_config__consecutive_warnings_before_kick,
    network_config__measurement_window_ticks,
    network_config__packet_loss_threshold_percent
) VALUES (500, 200, 50, 100, 5);

-- Authentication Configuration
INSERT INTO config.auth_config (
    auth_config__session_cleanup_interval,
    auth_config__heartbeat_interval_ms,
    auth_config__heartbeat_inactive_expiry_ms
) VALUES (
    3600000,
    3000,
    12000
);

-- Database Version Configuration
INSERT INTO config.database_config (
    database_config__major_version,
    database_config__minor_version,
    database_config__patch_version,
    database_config__migration_timestamp
) VALUES (1, 0, 0, '20240829231100');