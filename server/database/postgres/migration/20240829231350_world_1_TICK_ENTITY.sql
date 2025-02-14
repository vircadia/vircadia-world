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

-- 
-- ENTITY STATE TICK FUNCTIONS
-- 

-- Function to get ALL entity states from the latest tick in a sync group
CREATE OR REPLACE FUNCTION tick.get_all_entity_states_at_latest_tick(
    p_sync_group text
) RETURNS TABLE (
    general__entity_id uuid,
    general__entity_name text,
    general__semantic_version text,
    general__load_priority integer,
    general__initialized_at timestamptz,
    general__initialized_by uuid,
    meta__data jsonb,
    scripts__ids uuid[],
    scripts__status entity_status_enum,
    assets__ids uuid[],
    validation__log jsonb,
    group__sync text,
    general__created_at timestamptz,
    general__created_by uuid,
    general__updated_at timestamptz,
    general__updated_by uuid,
    sync_group_session_ids uuid[]
) AS $$
BEGIN
    RETURN QUERY
    WITH latest_tick AS (
        SELECT general__tick_id
        FROM tick.world_ticks wt
        WHERE wt.group__sync = p_sync_group
        ORDER BY tick__number DESC
        LIMIT 1
    )
    SELECT 
        es.general__entity_id,
        es.general__entity_name,
        es.general__semantic_version,
        es.general__load_priority,
        es.general__initialized_at,
        es.general__initialized_by,
        es.meta__data,
        es.scripts__ids,
        es.scripts__status,
        es.assets__ids,
        es.validation__log,
        es.group__sync,
        es.general__created_at,
        es.general__created_by,
        es.general__updated_at,
        es.general__updated_by,
        coalesce(auth.get_sync_group_session_ids(es.group__sync), '{}')
    FROM tick.entity_states es
    JOIN latest_tick lt ON es.general__tick_id = lt.general__tick_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get CHANGED entity states between latest ticks
CREATE OR REPLACE FUNCTION tick.get_changed_entity_states_between_latest_ticks(
    p_sync_group text
) RETURNS TABLE (
    general__entity_id uuid,
    operation operation_enum,
    changes jsonb,
    sync_group_session_ids uuid[]
) AS $$
DECLARE
    v_current_tick_id uuid;
    v_previous_tick_id uuid;
BEGIN
    -- Get the latest two tick IDs
    WITH ordered_ticks AS (
        SELECT general__tick_id
        FROM tick.world_ticks wt
        WHERE wt.group__sync = p_sync_group
        ORDER BY tick__number DESC
        LIMIT 2
    )
    SELECT
        (SELECT general__tick_id FROM ordered_ticks LIMIT 1),
        (SELECT general__tick_id FROM ordered_ticks OFFSET 1 LIMIT 1)
    INTO v_current_tick_id, v_previous_tick_id;

    -- Return changes between these ticks
    RETURN QUERY
    WITH current_states AS (
        SELECT es.*
        FROM tick.entity_states es
        WHERE es.general__tick_id = v_current_tick_id
    ),
    previous_states AS (
        SELECT es.*
        FROM tick.entity_states es
        WHERE es.general__tick_id = v_previous_tick_id
    )
    SELECT 
        COALESCE(cs.general__entity_id, ps.general__entity_id),
        CASE 
            WHEN ps.general__entity_id IS NULL THEN 'INSERT'::operation_enum
            WHEN cs.general__entity_id IS NULL THEN 'DELETE'::operation_enum
            ELSE 'UPDATE'::operation_enum
        END,
        CASE 
            WHEN ps.general__entity_id IS NULL THEN 
                jsonb_build_object(
                    'general__entity_id', cs.general__entity_id,
                    'general__entity_name', cs.general__entity_name,
                    'general__semantic_version', cs.general__semantic_version,
                    'general__load_priority', cs.general__load_priority,
                    'general__initialized_at', cs.general__initialized_at,
                    'general__initialized_by', cs.general__initialized_by,
                    'meta__data', cs.meta__data,
                    'scripts__ids', cs.scripts__ids,
                    'scripts__status', cs.scripts__status,
                    'assets__ids', cs.assets__ids,
                    'validation__log', cs.validation__log,
                    'group__sync', cs.group__sync,
                    'general__created_at', cs.general__created_at,
                    'general__created_by', cs.general__created_by,
                    'general__updated_at', cs.general__updated_at,
                    'general__updated_by', cs.general__updated_by
                )
            WHEN cs.general__entity_id IS NULL THEN NULL::jsonb
            ELSE jsonb_strip_nulls(jsonb_build_object(
                'general__entity_name', 
                    CASE WHEN cs.general__entity_name IS DISTINCT FROM ps.general__entity_name 
                    THEN cs.general__entity_name END,
                'general__semantic_version', 
                    CASE WHEN cs.general__semantic_version IS DISTINCT FROM ps.general__semantic_version 
                    THEN cs.general__semantic_version END,
                'general__load_priority', 
                    CASE WHEN cs.general__load_priority IS DISTINCT FROM ps.general__load_priority 
                    THEN cs.general__load_priority END,
                'general__initialized_at', 
                    CASE WHEN cs.general__initialized_at IS DISTINCT FROM ps.general__initialized_at 
                    THEN cs.general__initialized_at END,
                'general__initialized_by', 
                    CASE WHEN cs.general__initialized_by IS DISTINCT FROM ps.general__initialized_by 
                    THEN cs.general__initialized_by END,
                'meta__data', 
                    CASE WHEN cs.meta__data IS DISTINCT FROM ps.meta__data 
                    THEN cs.meta__data END,
                'scripts__ids', 
                    CASE WHEN cs.scripts__ids IS DISTINCT FROM ps.scripts__ids 
                    THEN cs.scripts__ids END,
                'scripts__status', 
                    CASE WHEN cs.scripts__status IS DISTINCT FROM ps.scripts__status 
                    THEN cs.scripts__status END,
                'assets__ids',
                    CASE WHEN cs.assets__ids IS DISTINCT FROM ps.assets__ids 
                    THEN cs.assets__ids END,
                'validation__log', 
                    CASE WHEN cs.validation__log IS DISTINCT FROM ps.validation__log 
                    THEN cs.validation__log END,
                'group__sync', 
                    CASE WHEN cs.group__sync IS DISTINCT FROM ps.group__sync 
                    THEN cs.group__sync END,
                'general__created_at', 
                    CASE WHEN cs.general__created_at IS DISTINCT FROM ps.general__created_at 
                    THEN cs.general__created_at END,
                'general__created_by', 
                    CASE WHEN cs.general__created_by IS DISTINCT FROM ps.general__created_by 
                    THEN cs.general__created_by END,
                'general__updated_at', 
                    CASE WHEN cs.general__updated_at IS DISTINCT FROM ps.general__updated_at 
                    THEN cs.general__updated_at END,
                'general__updated_by', 
                    CASE WHEN cs.general__updated_by IS DISTINCT FROM ps.general__updated_by 
                    THEN cs.general__updated_by END
            ))
        END,
        coalesce(auth.get_sync_group_session_ids(coalesce(cs.group__sync, ps.group__sync)), '{}')
    FROM current_states cs
    FULL OUTER JOIN previous_states ps ON cs.general__entity_id = ps.general__entity_id
    WHERE cs IS DISTINCT FROM ps;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
