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
('tick_rate_ms', '50'::jsonb, 'Server tick rate in milliseconds (20 ticks per second)'),
('tick_buffer_duration_ms', '2000'::jsonb, 'How long to keep tick history in milliseconds'),
('tick_metrics_history_ms', '3600000'::jsonb, 'How long to keep tick metrics history in milliseconds (1 hour default)'),
('action_cleanup_rate_ms', '5000'::jsonb, 'How often to clean up actions in milliseconds (5 seconds default)'),
('action_abandoned_threshold_ms', '5000'::jsonb, 'Time after which an action with an old heartbeat is considered abandoned (5 seconds default)'),
('action_inactive_history_count', '10000'::jsonb, 'Number of inactive actions to retain in history');
