CREATE SCHEMA IF NOT EXISTS tick;

REVOKE ALL ON SCHEMA tick FROM vircadia_agent_proxy;
GRANT USAGE ON SCHEMA tick TO vircadia_agent_proxy;

-- 
-- WORLD TICKS
-- 

-- World ticks table (make this the authoritative table)
CREATE TABLE tick.world_ticks (
    general__tick_id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
    tick__number bigint NOT NULL,
    group__sync TEXT NOT NULL REFERENCES auth.sync_groups(general__sync_group),
    tick__start_time timestamptz NOT NULL,
    tick__end_time timestamptz NOT NULL,
    tick__duration_ms double precision NOT NULL,
    tick__entity_states_processed int NOT NULL,
    tick__script_states_processed int NOT NULL,
    tick__asset_states_processed int NOT NULL,
    tick__is_delayed boolean NOT NULL,
    tick__headroom_ms double precision,
    tick__time_since_last_tick_ms double precision,

    -- Add unique constraint for sync_group + tick number combination
    UNIQUE (group__sync, tick__number)
);

CREATE INDEX idx_world_ticks_sync_number ON tick.world_ticks (group__sync, tick__number DESC);
CREATE INDEX idx_world_ticks_sync_time ON tick.world_ticks (group__sync, tick__start_time DESC);

-- Enable RLS on world_ticks table
ALTER TABLE tick.world_ticks ENABLE ROW LEVEL SECURITY;

-- All policies for world_ticks (system users only)
CREATE POLICY "world_ticks_view_policy" ON tick.world_ticks
    FOR SELECT
    USING (auth.is_admin_agent());

CREATE POLICY "world_ticks_update_policy" ON tick.world_ticks
    FOR UPDATE
    USING (auth.is_admin_agent());

CREATE POLICY "world_ticks_insert_policy" ON tick.world_ticks
    FOR INSERT
    WITH CHECK (auth.is_admin_agent());

CREATE POLICY "world_ticks_delete_policy" ON tick.world_ticks
    FOR DELETE
    USING (auth.is_admin_agent());