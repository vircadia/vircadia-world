-- Required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "ltree";
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Configuration table
CREATE TABLE world_config (
    key text PRIMARY KEY,
    value jsonb NOT NULL,
    description text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Insert default configuration
INSERT INTO world_config (key, value, description) VALUES
('tick_rate_ms', '50'::jsonb, 'Server tick rate in milliseconds (20 ticks per second)'),
('tick_buffer_duration_ms', '2000'::jsonb, 'How long to keep tick history in milliseconds'),
('tick_metrics_history_ms', '3600000'::jsonb, 'How long to keep tick metrics history in milliseconds (1 hour default)');

ALTER PUBLICATION supabase_realtime ADD TABLE world_config;