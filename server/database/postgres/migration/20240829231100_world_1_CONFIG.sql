CREATE SCHEMA IF NOT EXISTS config;

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
    'session_duration_jwt', '24h',
    'session_duration_ms', 86400000,
    'secret_jwt', 'CHANGE_ME!',
    'session_duration_admin_jwt', '24h',
    'session_duration_admin_ms', 86400000,
    'ws_check_interval', 10000,
    'max_age_ms', 86400000,
    'cleanup_interval_ms', 3600000,
    'inactive_timeout_ms', 3600000,
    'max_sessions_per_agent', 1
), 'Authentication and session management configuration settings'),

-- Heartbeat settings
('heartbeat', jsonb_build_object(
    'interval_ms', 3000,
    'timeout_ms', 12000
), 'Heartbeat configuration settings'),

-- Database settings
('database', jsonb_build_object(
    'major_version', 1,
    'minor_version', 0,
    'patch_version', 0,
    'migration_timestamp', '20240829231100'
), 'Database version configuration settings');
