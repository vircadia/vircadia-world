CREATE SCHEMA IF NOT EXISTS config;

REVOKE ALL ON FUNCTION pg_catalog.set_config(text, text, boolean) FROM PUBLIC;

-- Check if role exists and drop if needed
DO $$ 
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'vircadia_agent_proxy') THEN
        DROP ROLE vircadia_agent_proxy;
    END IF;
END
$$;

SET my.agent_proxy_password = '$POSTGRES_AGENT_PROXY_PASSWORD';
-- User proxy role with limited permissions
DO $$
DECLARE
    pwd text := current_setting('my.agent_proxy_password');
BEGIN
    EXECUTE format('CREATE ROLE vircadia_agent_proxy LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION', pwd);
END
$$;

-- Grant usage on schema config to vircadia_agent_proxy
GRANT USAGE ON SCHEMA config TO vircadia_agent_proxy;

-- Configuration table
CREATE TABLE config.config (
    general__key text PRIMARY KEY,
    general__value jsonb NOT NULL,
    general__description text
);

-- Seeds tracking table
CREATE TABLE config.seeds (
    general__seed_id SERIAL PRIMARY KEY,
    general__name VARCHAR(255) NOT NULL,
    general__executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert grouped configuration settings
INSERT INTO config.config (general__key, general__value, general__description) VALUES
-- Entity settings
('entity', jsonb_build_object(
    'script_compilation_timeout_ms', 60000
), 'Entity-related configuration settings'),

-- Network settings
('network', jsonb_build_object(
    'max_latency_ms', 500,
    'warning_latency_ms', 200,
    'consecutive_warnings_before_kick', 50,
    'measurement_window_ticks', 100,
    'packet_loss_threshold_percent', 5
), 'Network-related configuration settings'),

-- Authentication settings (merged with session settings)
('auth', jsonb_build_object(
    'default_session_duration_jwt_string', '24h',
    'default_session_duration_ms', 86400000,
    'default_session_max_age_ms', 86400000,
    'jwt_secret', 'CHANGE_ME!',
    'session_cleanup_interval', 3600000,
    'session_inactive_expiry_ms', 3600000,
    'session_max_per_agent', 1,
    'heartbeat_interval_ms', 3000,
    'heartbeat_inactive_expiry_ms', 12000
), 'Authentication and session management configuration settings'),

-- Database settings
('database', jsonb_build_object(
    'major_version', 1,
    'minor_version', 0,
    'patch_version', 0,
    'migration_timestamp', '20240829231100'
), 'Database version configuration settings');

-- Create ENUMS

CREATE TYPE operation_enum AS ENUM ('INSERT', 'UPDATE', 'DELETE');
