-- ============================================================================
-- 1. SCHEMA CREATION AND INITIAL PERMISSIONS
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS config;

-- ============================================================================
-- 2. TYPES
-- ============================================================================
CREATE TYPE config.operation_enum AS ENUM ('INSERT', 'UPDATE', 'DELETE');


-- ============================================================================
-- 3. CONFIGURATION TABLES
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
    auth_config__heartbeat_interval_ms INTEGER NOT NULL
);

-- Database Version Configuration
CREATE TABLE config.database_config (
    database_config__major_version INTEGER NOT NULL,
    database_config__minor_version INTEGER NOT NULL,
    database_config__patch_version INTEGER NOT NULL,
    database_config__setup_timestamp TIMESTAMP NOT NULL
);


-- ============================================================================
-- 4. SEED TRACKING
-- ============================================================================
CREATE TABLE config.seeds (
    general__hash TEXT PRIMARY KEY,  -- MD5 hash of the seed content
    general__name TEXT NOT NULL,     -- Seed filename for reference
    general__executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- ============================================================================
-- 5. INITIAL DATA
-- ============================================================================
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
    auth_config__heartbeat_interval_ms
) VALUES (
    3600000,
    3000
);

-- Database Version Configuration
INSERT INTO config.database_config (
    database_config__major_version,
    database_config__minor_version,
    database_config__patch_version,
    database_config__setup_timestamp
) VALUES (1, 0, 0, CURRENT_TIMESTAMP);


-- ============================================================================
-- 6. CONFIG SCHEMA PERMISSIONS
-- ============================================================================
-- Revoke All Permissions
REVOKE ALL ON ALL TABLES IN SCHEMA config FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA config FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA config FROM PUBLIC;
REVOKE ALL ON SCHEMA config FROM PUBLIC;

-- Grant Usage on Schema
GRANT USAGE ON SCHEMA config TO vircadia_agent_proxy;

-- Grant Specific Permissions
GRANT SELECT ON config.entity_config TO vircadia_agent_proxy;
GRANT SELECT ON config.network_config TO vircadia_agent_proxy;
GRANT SELECT ON config.auth_config TO vircadia_agent_proxy;
GRANT SELECT ON config.database_config TO vircadia_agent_proxy;
