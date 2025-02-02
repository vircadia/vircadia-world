CREATE SCHEMA IF NOT EXISTS config;

-- Configuration table
CREATE TABLE config.config (
    general__key text PRIMARY KEY,
    general__value jsonb NOT NULL,
    general__description text,
    general__created_at timestamptz DEFAULT now(),
    general__updated_at timestamptz DEFAULT now()
);

-- Seeds tracking table
CREATE TABLE config.seeds (
    general__seed_id SERIAL PRIMARY KEY,
    general__name VARCHAR(255) NOT NULL,
    general__executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default configuration
INSERT INTO config.config (general__key, general__value, general__description) VALUES
('tick_buffer_duration_ms', '2000'::jsonb, 'How long to keep tick history in milliseconds'),
('tick_metrics_history_ms', '3600000'::jsonb, 'How long to keep tick metrics history in milliseconds (1 hour default)');

-- Add separate network quality requirements
INSERT INTO config.config (general__key, general__value, general__description) VALUES
('client_network_requirements', jsonb_build_object(
    'max_latency_ms', 500,                    -- Maximum allowed latency before disconnect
    'warning_latency_ms', 200,                -- When to start warning the client
    'consecutive_warnings_before_kick', 50,    -- How many high-latency ticks before disconnect
    'measurement_window_ticks', 100,          -- Window for calculating average latency
    'packet_loss_threshold_percent', 5        -- Maximum acceptable packet loss percentage
), 'Network quality requirements for all clients regardless of sync group');

-- Remove duplicate/separate entries and create a unified client configuration
INSERT INTO config.config (general__key, general__value, general__description) VALUES
('client_settings', jsonb_build_object(
    -- Session management
    'session', jsonb_build_object(
        'max_age_ms', 86400000,           -- 24 hours in milliseconds
        'cleanup_interval_ms', 3600000,    -- 1 hour in milliseconds
        'inactive_timeout_ms', 3600000,    -- 1 hour in milliseconds
        'max_sessions_per_agent', 1        -- Maximum number of active sessions per agent
    ),
    -- Authentication
    'auth', jsonb_build_object(
        'jwt_session_duration', '24h',
        'jwt_secret', 'CHANGE_ME!',
        'admin_token_session_duration', '24h',
        'ws_check_interval', 10000
    ),
    -- Heartbeat settings
    'heartbeat', jsonb_build_object(
        'interval_ms', 3000,              -- How often to send heartbeat
        'timeout_ms', 12000               -- How long to wait for response
    )
), 'Unified client configuration including session management, authentication, and heartbeat settings');

-- Add database version configuration
INSERT INTO config.config (general__key, general__value, general__description) VALUES
('database_version', jsonb_build_object(
    'major', 1,
    'minor', 0,
    'patch', 0,
    'migration_timestamp', '20240829231100'
), 'Database schema version information');
