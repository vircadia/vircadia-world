CREATE SCHEMA IF NOT EXISTS config;

-- Configuration table
CREATE TABLE config.config (
    key text PRIMARY KEY,
    value jsonb NOT NULL,
    description text,
    general__created_at timestamptz DEFAULT now(),
    general__updated_at timestamptz DEFAULT now()
);

-- Insert default configuration
INSERT INTO config.config (key, value, description) VALUES
('client_poll_new_entities_ms', '500'::jsonb, 'How often a client should poll for all entities to find any potential new ones.'),
('tick_buffer_duration_ms', '2000'::jsonb, 'How long to keep tick history in milliseconds'),
('tick_metrics_history_ms', '3600000'::jsonb, 'How long to keep tick metrics history in milliseconds (1 hour default)');

-- Add sync group configurations
INSERT INTO config.config (key, value, description) VALUES
('sync_groups', jsonb_build_object(
    'REALTIME', jsonb_build_object(
        'server_tick_rate_ms', 16,
        'client_keyframe_check_rate_ms', 100
    ),
    'NORMAL', jsonb_build_object(
        'server_tick_rate_ms', 50,
        'client_keyframe_check_rate_ms', 1000
    ),
    'BACKGROUND', jsonb_build_object(
        'server_tick_rate_ms', 200,
        'client_keyframe_check_rate_ms', 2000
    )
), 'Defines sync groups with their server tick rates and client check frequencies');

-- Add session configurations
INSERT INTO config.config (key, value, description) VALUES
('session_settings', jsonb_build_object(
    'max_session_age_ms', 86400000,  -- 24 hours in milliseconds
    'cleanup_interval_ms', 3600000,  -- 1 hour in milliseconds
    'inactive_timeout_ms', 3600000   -- 1 hour in milliseconds
), 'Session management configuration including timeouts and cleanup intervals');

-- Add authentication configurations
INSERT INTO config.config (key, value, description) VALUES
('auth_settings', jsonb_build_object(
    'jwt_session_duration', '24h',
    'jwt_secret', 'CHANGE_ME!',
    'admin_token_session_duration', '24h',
    'ws_check_interval', 10000
), 'Authentication configuration including JWT settings and websocket check intervals');