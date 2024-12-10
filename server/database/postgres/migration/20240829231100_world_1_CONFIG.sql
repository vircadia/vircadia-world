-- Configuration table
CREATE TABLE world_config (
    key text PRIMARY KEY,
    value jsonb NOT NULL,
    description text,
    general__created_at timestamptz DEFAULT now(),
    general__updated_at timestamptz DEFAULT now()
);

-- Insert default configuration
INSERT INTO world_config (key, value, description) VALUES
('tick_buffer_duration_ms', '2000'::jsonb, 'How long to keep tick history in milliseconds'),
('tick_metrics_history_ms', '3600000'::jsonb, 'How long to keep tick metrics history in milliseconds (1 hour default)'),
('action_cleanup_rate_ms', '5000'::jsonb, 'How often to clean up actions in milliseconds (5 seconds default)'),
('action_abandoned_threshold_ms', '5000'::jsonb, 'Time after which an action with an old heartbeat is considered abandoned (5 seconds default)'),
('action_inactive_history_count', '10000'::jsonb, 'Number of inactive actions to retain in history'),
('admin_ips', jsonb_build_array('127.0.0.1', '::1'), 'List of IP addresses allowed admin access');

-- Add sync group configurations
INSERT INTO world_config (key, value, description) VALUES
('sync_groups', jsonb_build_object(
    'REALTIME', jsonb_build_object(
        'server_tick_rate_ms', 16,
        'client_needs_update_check_rate_ms', 16,
        'client_keyframe_sync_rate_ms', 100
    ),
    'NORMAL', jsonb_build_object(
        'server_tick_rate_ms', 50,
        'client_needs_update_check_rate_ms', 50,
        'client_keyframe_sync_rate_ms', 1000
    ),
    'BACKGROUND', jsonb_build_object(
        'server_tick_rate_ms', 200,
        'client_needs_update_check_rate_ms', 200,
        'client_keyframe_sync_rate_ms', 2000
    )
), 'Defines sync groups with their server tick rates and client sync frequencies');