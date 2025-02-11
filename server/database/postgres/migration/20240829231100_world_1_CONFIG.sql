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

-- Insert default configuration
INSERT INTO config.config (general__key, general__value, general__description) VALUES
('tick__buffer_duration_ms', '2000'::jsonb, 'How long to keep tick history in milliseconds');

-- Add network quality requirements
INSERT INTO config.config (general__key, general__value, general__description) VALUES
('network__max_latency_ms', '500'::jsonb, 'Maximum allowed latency before disconnect'),
('network__warning_latency_ms', '200'::jsonb, 'When to start warning the client'),
('network__consecutive_warnings_before_kick', '50'::jsonb, 'How many high-latency ticks before disconnect'),
('network__measurement_window_ticks', '100'::jsonb, 'Window for calculating average latency'),
('network__packet_loss_threshold_percent', '5'::jsonb, 'Maximum acceptable packet loss percentage');

-- Add client configuration settings
INSERT INTO config.config (general__key, general__value, general__description) VALUES
-- Session management
('session__max_age_ms', '86400000'::jsonb, 'Maximum session age (24 hours in milliseconds)'),
('session__cleanup_interval_ms', '3600000'::jsonb, 'Session cleanup interval (1 hour in milliseconds)'),
('session__inactive_timeout_ms', '3600000'::jsonb, 'Session inactivity timeout (1 hour in milliseconds)'),
('session__max_sessions_per_agent', '1'::jsonb, 'Maximum number of active sessions per agent'),

-- Authentication
('auth__session_duration_jwt', '"24h"'::jsonb, 'JWT session duration string'),
('auth__session_duration_ms', '86400000'::jsonb, 'JWT session duration in milliseconds'),
('auth__secret_jwt', '"CHANGE_ME!"'::jsonb, 'JWT secret key'),
('auth__session_duration_admin_jwt', '"24h"'::jsonb, 'Admin JWT session duration string'),
('auth__session_duration_admin_ms', '86400000'::jsonb, 'Admin JWT session duration in milliseconds'),
('auth__ws_check_interval', '10000'::jsonb, 'WebSocket check interval in milliseconds'),

-- Heartbeat settings
('heartbeat__interval_ms', '3000'::jsonb, 'How often to send heartbeat'),
('heartbeat__timeout_ms', '12000'::jsonb, 'How long to wait for heartbeat response');

-- Add database version configuration
INSERT INTO config.config (general__key, general__value, general__description) VALUES
('database__major_version', '1'::jsonb, 'Database major version number'),
('database__minor_version', '0'::jsonb, 'Database minor version number'),
('database__patch_version', '0'::jsonb, 'Database patch version number'),
('database__migration_timestamp', '"20240829231100"'::jsonb, 'Database migration timestamp');
