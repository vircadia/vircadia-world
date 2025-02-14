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

-- 
-- ENTITY SCRIPTS
-- 

-- Create script audit log table
CREATE TABLE tick.script_audit_log (
    general__audit_id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
    general__script_id uuid NOT NULL,
    group__sync text NOT NULL
        REFERENCES auth.sync_groups(general__sync_group),
    operation operation_enum NOT NULL,
    operation_timestamp timestamptz DEFAULT clock_timestamp(),
    performed_by uuid DEFAULT auth.current_agent_id()
);

-- Add indexes for efficient querying
CREATE INDEX idx_script_audit_log_timestamp 
    ON tick.script_audit_log (group__sync, operation_timestamp DESC);
CREATE INDEX idx_script_audit_log_script_id
    ON tick.script_audit_log (general__script_id);

-- Enable RLS
ALTER TABLE tick.script_audit_log ENABLE ROW LEVEL SECURITY;

-- Add RLS policies (system only)
CREATE POLICY "script_audit_log_view_policy" ON tick.script_audit_log
    FOR SELECT USING (auth.is_admin_agent());

CREATE POLICY "script_audit_log_insert_policy" ON tick.script_audit_log
    FOR INSERT
    WITH CHECK (auth.is_admin_agent());

CREATE POLICY "script_audit_log_update_policy" ON tick.script_audit_log
    FOR UPDATE
    USING (auth.is_admin_agent());

CREATE POLICY "script_audit_log_delete_policy" ON tick.script_audit_log
    FOR DELETE
    USING (auth.is_admin_agent());
    
-- Trigger function to log script changes
CREATE OR REPLACE FUNCTION tick.log_script_change()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO tick.script_audit_log (
            general__script_id,
            group__sync,
            operation
        ) VALUES (
            NEW.general__script_id,
            NEW.group__sync,
            'INSERT'
        );
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO tick.script_audit_log (
            general__script_id,
            group__sync,
            operation
        ) VALUES (
            NEW.general__script_id,
            NEW.group__sync,
            'UPDATE'
        );
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO tick.script_audit_log (
            general__script_id,
            group__sync,
            operation
        ) VALUES (
            OLD.general__script_id,
            OLD.group__sync,
            'DELETE'
        );
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add triggers to entity.entity_scripts
CREATE TRIGGER log_script_changes
    AFTER INSERT OR UPDATE OR DELETE ON entity.entity_scripts
    FOR EACH ROW
    EXECUTE FUNCTION tick.log_script_change();

-- Cleanup function for audit logs
CREATE OR REPLACE FUNCTION tick.cleanup_old_script_audit_logs() 
RETURNS void AS $$
BEGIN
    DELETE FROM tick.script_audit_log sal
    WHERE EXISTS (
        SELECT 1 
        FROM auth.sync_groups sg
        WHERE sg.general__sync_group = sal.group__sync
        AND sal.operation_timestamp < (
            NOW() - ((sg.server__tick__buffer * sg.server__tick__rate_ms) || ' milliseconds')::interval
        )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 
-- ENTITY STATES
-- 

-- Lag compensation state history table (now references world_ticks)
CREATE TABLE tick.entity_states (
    LIKE entity.entities INCLUDING DEFAULTS EXCLUDING CONSTRAINTS,

    -- Additional metadata for state tracking
    general__tick_id uuid NOT NULL,
    general__entity_state_id uuid DEFAULT uuid_generate_v4(),

    -- Override the primary key to allow multiple states per entity
    CONSTRAINT entity_states_pkey PRIMARY KEY (general__entity_state_id),

    -- Add foreign key constraint for sync_group
    CONSTRAINT entity_states_sync_group_fkey FOREIGN KEY (group__sync) 
        REFERENCES auth.sync_groups(general__sync_group),

    -- Add foreign key constraint to world_ticks with cascade delete
    CONSTRAINT entity_states_tick_fkey FOREIGN KEY (general__tick_id)
        REFERENCES tick.world_ticks(general__tick_id) ON DELETE CASCADE
);

-- View policy for entity_states (using sync groups instead of roles)
CREATE POLICY "entity_states_view_policy" ON tick.entity_states
    FOR SELECT
    USING (
        auth.is_admin_agent()
        OR auth.has_sync_group_read_access(group__sync)
    );

-- Update/Insert/Delete policies for entity_states (system users only)
CREATE POLICY "entity_states_update_policy" ON tick.entity_states
    FOR UPDATE
    USING (auth.is_admin_agent());

CREATE POLICY "entity_states_insert_policy" ON tick.entity_states
    FOR INSERT
    WITH CHECK (auth.is_admin_agent());

CREATE POLICY "entity_states_delete_policy" ON tick.entity_states
    FOR DELETE
    USING (auth.is_admin_agent());

-- Enable RLS on entity_states table
ALTER TABLE tick.entity_states ENABLE ROW LEVEL SECURITY;

-- New or moved indexes
CREATE INDEX entity_states_lookup_idx ON tick.entity_states (general__entity_id, general__tick_id);
CREATE INDEX entity_states_tick_idx ON tick.entity_states (general__tick_id);
CREATE INDEX entity_states_sync_group_tick_idx ON tick.entity_states (group__sync, general__tick_id DESC);
CREATE INDEX idx_entity_states_sync_tick_lookup ON tick.entity_states (group__sync, general__tick_id, general__entity_id);
CREATE INDEX idx_entity_states_sync_tick ON tick.entity_states (group__sync, general__tick_id);
