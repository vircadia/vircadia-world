-- Create tick schema
CREATE SCHEMA IF NOT EXISTS tick;

-- Performance metrics table (make this the authoritative table)
CREATE TABLE tick.world_ticks (
    general__tick_id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
    tick__number bigint NOT NULL,
    performance__sync_group TEXT NOT NULL REFERENCES entity.entity_sync_groups(sync_group),
    tick__start_time timestamptz NOT NULL,
    tick__end_time timestamptz NOT NULL,
    tick__duration_ms double precision NOT NULL,
    tick__states_processed int NOT NULL,
    tick__is_delayed boolean NOT NULL,
    tick__headroom_ms double precision,
    tick__rate_limited boolean DEFAULT false,
    tick__time_since_last_tick_ms double precision,

    general__created_at timestamptz DEFAULT now(),
    general__updated_at timestamptz DEFAULT now(),
    general__created_by UUID DEFAULT auth.current_agent_id(),
    general__updated_by UUID DEFAULT auth.current_agent_id(),

    -- Add unique constraint for sync_group + tick number combination
    UNIQUE (performance__sync_group, tick__number)

);

-- Lag compensation state history table (now references world_ticks)
CREATE TABLE tick.entity_states (
    LIKE entity.entities INCLUDING DEFAULTS INCLUDING CONSTRAINTS,
    
    -- Additional metadata for state tracking
    general__entity_state_id uuid DEFAULT uuid_generate_v4(),
    general__tick_id uuid NOT NULL,
    
    -- Override the primary key to allow multiple states per entity
    CONSTRAINT entity_states_pkey PRIMARY KEY (general__entity_state_id),
    
    -- Add foreign key constraint for sync_group
    CONSTRAINT entity_states_sync_group_fkey FOREIGN KEY (performance__sync_group) 
        REFERENCES entity.entity_sync_groups(sync_group),
        
    -- Add foreign key constraint to world_ticks with cascade delete
    CONSTRAINT entity_states_tick_fkey FOREIGN KEY (general__tick_id)
        REFERENCES tick.world_ticks(general__tick_id) ON DELETE CASCADE
);

-- View policy for entity_states (matching the entity read permissions)
CREATE POLICY "entity_states_view_policy" ON tick.entity_states
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 
            FROM entity.entities e
            JOIN auth.agent_roles ar ON ar.auth__role_name = ANY(e.permissions__roles__view)
            WHERE e.general__entity_id = tick.entity_states.general__entity_id
            AND ar.auth__agent_id = auth.current_agent_id()
            AND ar.auth__is_active = true
        )
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

-- Updated indexes for fast state lookups
CREATE INDEX entity_states_lookup_idx ON tick.entity_states (general__entity_id, general__tick_id);
CREATE INDEX entity_states_tick_idx ON tick.entity_states (general__tick_id);

-- Enable RLS on entity_states table
ALTER TABLE tick.entity_states ENABLE ROW LEVEL SECURITY;

CREATE TYPE operation_enum AS ENUM ('INSERT', 'UPDATE', 'DELETE');

-- Update the get_entity_changes function to fix change detection
CREATE OR REPLACE FUNCTION tick.get_entity_changes(
    p_sync_group text,
    p_last_tick bigint,
    p_current_tick bigint
) 
RETURNS TABLE (
    entity_id uuid,
    operation operation_enum,
    entity_changes jsonb,
    session_ids uuid[]
)
AS $$
DECLARE
    v_active_session_ids uuid[];
BEGIN
    -- Gather active sessions just once for performance
    SELECT array_agg(general__session_id)
    INTO v_active_session_ids
    FROM auth.agent_sessions
    WHERE session__is_active = true 
      AND session__expires_at > NOW();

    RETURN QUERY
    WITH current_entities AS (
        -- Get the current entity state from the main table, only in the relevant sync group
        SELECT *
        FROM entity.entities
        WHERE performance__sync_group = p_sync_group
    ),
    previous_entities AS (
        -- Get the previous entity state (from the entity_states table) for that same sync group/tick
        SELECT es.*
        FROM tick.entity_states es
        JOIN tick.world_ticks wt ON es.general__tick_id = wt.general__tick_id
        WHERE es.performance__sync_group = p_sync_group
          AND wt.tick__number = p_last_tick
    ),
    changed_entities AS (
        SELECT 
            /* If ce is NULL => DELETE; if pe is NULL => INSERT; otherwise check changes => UPDATE */
            COALESCE(ce.general__entity_id, pe.general__entity_id) AS entity_id,
            CASE 
                WHEN pe.general__entity_id IS NULL THEN 'INSERT'::operation_enum
                WHEN ce.general__entity_id IS NULL THEN 'DELETE'::operation_enum
                WHEN (
                    ce.general__name IS DISTINCT FROM pe.general__name OR
                    ce.general__semantic_version IS DISTINCT FROM pe.general__semantic_version OR
                    ce.general__created_at IS DISTINCT FROM pe.general__created_at OR
                    ce.general__created_by IS DISTINCT FROM pe.general__created_by OR
                    ce.general__updated_at IS DISTINCT FROM pe.general__updated_at OR
                    ce.general__updated_by IS DISTINCT FROM pe.general__updated_by OR
                    ce.general__load_priority IS DISTINCT FROM pe.general__load_priority OR
                    ce.general__initialized_at IS DISTINCT FROM pe.general__initialized_at OR
                    ce.general__initialized_by IS DISTINCT FROM pe.general__initialized_by OR
                    ce.meta__data IS DISTINCT FROM pe.meta__data OR
                    ce.scripts__ids IS DISTINCT FROM pe.scripts__ids OR
                    ce.scripts__status IS DISTINCT FROM pe.scripts__status OR
                    ce.validation__log IS DISTINCT FROM pe.validation__log OR
                    ce.performance__sync_group IS DISTINCT FROM pe.performance__sync_group OR
                    ce.permissions__roles__view IS DISTINCT FROM pe.permissions__roles__view OR
                    ce.permissions__roles__full IS DISTINCT FROM pe.permissions__roles__full
                ) THEN 'UPDATE'::operation_enum
            END AS operation,

            /*
              Instead of ce.* and pe.* (which would cause duplicate column names),
              give each column a unique alias.
            */

            -- "ce" columns (the current state)
            ce.general__entity_id         AS ce_general__entity_id,
            ce.general__name              AS ce_general__name,
            ce.general__semantic_version  AS ce_general__semantic_version,
            ce.general__created_at        AS ce_general__created_at,
            ce.general__created_by        AS ce_general__created_by,
            ce.general__updated_at        AS ce_general__updated_at,
            ce.general__updated_by        AS ce_general__updated_by,
            ce.general__load_priority     AS ce_general__load_priority,
            ce.general__initialized_at    AS ce_general__initialized_at,
            ce.general__initialized_by    AS ce_general__initialized_by,
            ce.meta__data                 AS ce_meta__data,
            ce.scripts__ids               AS ce_scripts__ids,
            ce.scripts__status            AS ce_scripts__status,
            ce.validation__log            AS ce_validation__log,
            ce.performance__sync_group    AS ce_performance__sync_group,
            ce.permissions__roles__view   AS ce_permissions__roles__view,
            ce.permissions__roles__full   AS ce_permissions__roles__full,

            -- "pe" columns (the previous state)
            pe.general__entity_id         AS pe_general__entity_id,
            pe.general__name              AS pe_general__name,
            pe.general__semantic_version  AS pe_general__semantic_version,
            pe.general__created_at        AS pe_general__created_at,
            pe.general__created_by        AS pe_general__created_by,
            pe.general__updated_at        AS pe_general__updated_at,
            pe.general__updated_by        AS pe_general__updated_by,
            pe.general__load_priority     AS pe_general__load_priority,
            pe.general__initialized_at    AS pe_general__initialized_at,
            pe.general__initialized_by    AS pe_general__initialized_by,
            pe.meta__data                 AS pe_meta__data,
            pe.scripts__ids               AS pe_scripts__ids,
            pe.scripts__status            AS pe_scripts__status,
            pe.validation__log            AS pe_validation__log,
            pe.performance__sync_group    AS pe_performance__sync_group,
            pe.permissions__roles__view   AS pe_permissions__roles__view,
            pe.permissions__roles__full   AS pe_permissions__roles__full

        FROM current_entities ce
        FULL OUTER JOIN previous_entities pe 
            ON ce.general__entity_id = pe.general__entity_id
        WHERE
            /* We want rows for inserts (pe == NULL), deletes (ce == NULL), or anything changed */
            pe.general__entity_id IS NULL
            OR ce.general__entity_id IS NULL
            OR ce.general__name IS DISTINCT FROM pe.general__name
            OR ce.general__semantic_version IS DISTINCT FROM pe.general__semantic_version
            OR ce.general__created_at IS DISTINCT FROM pe.general__created_at
            OR ce.general__created_by IS DISTINCT FROM pe.general__created_by
            OR ce.general__updated_at IS DISTINCT FROM pe.general__updated_at
            OR ce.general__updated_by IS DISTINCT FROM pe.general__updated_by
            OR ce.general__load_priority IS DISTINCT FROM pe.general__load_priority
            OR ce.general__initialized_at IS DISTINCT FROM pe.general__initialized_at
            OR ce.general__initialized_by IS DISTINCT FROM pe.general__initialized_by
            OR ce.meta__data IS DISTINCT FROM pe.meta__data
            OR ce.scripts__ids IS DISTINCT FROM pe.scripts__ids
            OR ce.scripts__status IS DISTINCT FROM pe.scripts__status
            OR ce.validation__log IS DISTINCT FROM pe.validation__log
            OR ce.performance__sync_group IS DISTINCT FROM pe.performance__sync_group
            OR ce.permissions__roles__view IS DISTINCT FROM pe.permissions__roles__view
            OR ce.permissions__roles__full IS DISTINCT FROM pe.permissions__roles__full
    )
    SELECT
        changed_entities.entity_id,
        changed_entities.operation,
        CASE changed_entities.operation
            WHEN 'INSERT' THEN jsonb_build_object(
                'general__name',              changed_entities.ce_general__name,
                'general__semantic_version',   changed_entities.ce_general__semantic_version,
                'general__created_at',         changed_entities.ce_general__created_at,
                'general__created_by',         changed_entities.ce_general__created_by,
                'general__updated_at',         changed_entities.ce_general__updated_at,
                'general__updated_by',         changed_entities.ce_general__updated_by,
                'general__load_priority',      changed_entities.ce_general__load_priority,
                'general__initialized_at',     changed_entities.ce_general__initialized_at,
                'general__initialized_by',     changed_entities.ce_general__initialized_by,
                'meta__data',                  changed_entities.ce_meta__data,
                'scripts__ids',                changed_entities.ce_scripts__ids,
                'scripts__status',             changed_entities.ce_scripts__status,
                'validation__log',             changed_entities.ce_validation__log,
                'performance__sync_group',     changed_entities.ce_performance__sync_group,
                'permissions__roles__view',    changed_entities.ce_permissions__roles__view,
                'permissions__roles__full',    changed_entities.ce_permissions__roles__full
            )
            WHEN 'DELETE' THEN NULL
            ELSE jsonb_strip_nulls(jsonb_build_object(
                'general__name',              NULLIF(changed_entities.ce_general__name, changed_entities.pe_general__name),
                'general__semantic_version',   NULLIF(changed_entities.ce_general__semantic_version, changed_entities.pe_general__semantic_version),
                'general__created_at',         NULLIF(changed_entities.ce_general__created_at, changed_entities.pe_general__created_at),
                'general__created_by',         NULLIF(changed_entities.ce_general__created_by, changed_entities.pe_general__created_by),
                'general__updated_at',         NULLIF(changed_entities.ce_general__updated_at, changed_entities.pe_general__updated_at),
                'general__updated_by',         NULLIF(changed_entities.ce_general__updated_by, changed_entities.pe_general__updated_by),
                'general__load_priority',      NULLIF(changed_entities.ce_general__load_priority, changed_entities.pe_general__load_priority),
                'general__initialized_at',     NULLIF(changed_entities.ce_general__initialized_at, changed_entities.pe_general__initialized_at),
                'general__initialized_by',     NULLIF(changed_entities.ce_general__initialized_by, changed_entities.pe_general__initialized_by),
                'meta__data',                  NULLIF(changed_entities.ce_meta__data, changed_entities.pe_meta__data),
                'scripts__ids',                NULLIF(changed_entities.ce_scripts__ids, changed_entities.pe_scripts__ids),
                'scripts__status',             NULLIF(changed_entities.ce_scripts__status, changed_entities.pe_scripts__status),
                'validation__log',             NULLIF(changed_entities.ce_validation__log, changed_entities.pe_validation__log),
                'performance__sync_group',     NULLIF(changed_entities.ce_performance__sync_group, changed_entities.pe_performance__sync_group),
                'permissions__roles__view',    NULLIF(changed_entities.ce_permissions__roles__view, changed_entities.pe_permissions__roles__view),
                'permissions__roles__full',    NULLIF(changed_entities.ce_permissions__roles__full, changed_entities.pe_permissions__roles__full)
            ))
        END AS entity_changes,
        v_active_session_ids
    FROM changed_entities;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create script states table (similar to entity_states)
CREATE TABLE tick.entity_script_states (
    LIKE entity.entity_scripts INCLUDING DEFAULTS INCLUDING CONSTRAINTS,
    
    -- Additional metadata for state tracking
    general__script_state_id uuid DEFAULT uuid_generate_v4(),
    general__tick_id uuid NOT NULL,
    
    -- Override the primary key to allow multiple states per script
    CONSTRAINT entity_script_states_pkey PRIMARY KEY (general__script_state_id),
    
    -- Add foreign key constraint for sync_group
    CONSTRAINT entity_script_states_sync_group_fkey FOREIGN KEY (performance__sync_group) 
        REFERENCES entity.entity_sync_groups(sync_group),
        
    -- Add foreign key constraint to world_ticks with cascade delete
    CONSTRAINT entity_script_states_tick_fkey FOREIGN KEY (general__tick_id)
        REFERENCES tick.world_ticks(general__tick_id) ON DELETE CASCADE
);

-- Create indexes for script states
CREATE INDEX entity_script_states_lookup_idx ON tick.entity_script_states (general__script_id, general__tick_id);
CREATE INDEX entity_script_states_tick_idx ON tick.entity_script_states (general__tick_id);
CREATE INDEX entity_script_states_sync_group_tick_idx 
    ON tick.entity_script_states (performance__sync_group, general__tick_id DESC);

-- Enable RLS on script states
ALTER TABLE tick.entity_script_states ENABLE ROW LEVEL SECURITY;

-- Add policies for script states (matching entity_scripts policies)
CREATE POLICY "script_states_view_policy" ON tick.entity_script_states
    FOR SELECT
    USING (true);

CREATE POLICY "script_states_update_policy" ON tick.entity_script_states
    FOR UPDATE
    USING (auth.is_admin_agent());

CREATE POLICY "script_states_insert_policy" ON tick.entity_script_states
    FOR INSERT
    WITH CHECK (auth.is_admin_agent());

CREATE POLICY "script_states_delete_policy" ON tick.entity_script_states
    FOR DELETE
    USING (auth.is_admin_agent());

-- Update the get_script_changes function to use script states
CREATE OR REPLACE FUNCTION tick.get_script_changes(
    p_sync_group text,
    p_last_tick bigint,
    p_current_tick bigint
) 
RETURNS TABLE (
    script_id uuid,
    operation operation_enum,
    script_changes jsonb,
    session_ids uuid[]
) AS $$
DECLARE
    v_active_session_ids uuid[];
BEGIN
    -- Get active sessions once for performance
    SELECT array_agg(general__session_id)
      INTO v_active_session_ids
      FROM auth.agent_sessions
     WHERE session__is_active = true 
       AND session__expires_at > NOW();

    RETURN QUERY
    WITH current_scripts AS (
        -- Get current state, only for the relevant sync group
        SELECT *
          FROM entity.entity_scripts
         WHERE performance__sync_group = p_sync_group
    ),
    previous_scripts AS (
        -- Get previous state using the tick index
        SELECT ess.*
          FROM tick.entity_script_states ess
          JOIN tick.world_ticks wt 
            ON ess.general__tick_id = wt.general__tick_id
         WHERE ess.performance__sync_group = p_sync_group
           AND wt.tick__number = p_last_tick
    ),
    changed_scripts AS (
        SELECT 
            -- Determine the common script_id and operation type
            COALESCE(cs.general__script_id, ps.general__script_id) AS script_id,
            CASE 
                WHEN ps.general__script_id IS NULL THEN 'INSERT'::operation_enum
                WHEN cs.general__script_id IS NULL THEN 'DELETE'::operation_enum
                WHEN (
                    cs.general__created_at           IS DISTINCT FROM ps.general__created_at OR
                    cs.general__created_by           IS DISTINCT FROM ps.general__created_by OR
                    cs.general__updated_at           IS DISTINCT FROM ps.general__updated_at OR
                    cs.general__updated_by           IS DISTINCT FROM ps.general__updated_by OR
                    cs.performance__sync_group       IS DISTINCT FROM ps.performance__sync_group OR
                    -- Node script fields
                    cs.script__source__node__repo__entry_path IS DISTINCT FROM ps.script__source__node__repo__entry_path OR
                    cs.script__source__node__repo__url        IS DISTINCT FROM ps.script__source__node__repo__url OR
                    cs.script__compiled__node__script         IS DISTINCT FROM ps.script__compiled__node__script OR
                    cs.script__compiled__node__script_sha256    IS DISTINCT FROM ps.script__compiled__node__script_sha256 OR
                    cs.script__compiled__node__script_status    IS DISTINCT FROM ps.script__compiled__node__script_status OR
                    cs.script__compiled__node__updated_at       IS DISTINCT FROM ps.script__compiled__node__updated_at OR
                    -- Bun script fields
                    cs.script__source__bun__repo__entry_path     IS DISTINCT FROM ps.script__source__bun__repo__entry_path OR
                    cs.script__source__bun__repo__url            IS DISTINCT FROM ps.script__source__bun__repo__url OR
                    cs.script__compiled__bun__script             IS DISTINCT FROM ps.script__compiled__bun__script OR
                    cs.script__compiled__bun__script_sha256        IS DISTINCT FROM ps.script__compiled__bun__script_sha256 OR
                    cs.script__compiled__bun__script_status        IS DISTINCT FROM ps.script__compiled__bun__script_status OR
                    cs.script__compiled__bun__updated_at           IS DISTINCT FROM ps.script__compiled__bun__updated_at OR
                    -- Browser script fields
                    cs.script__source__browser__repo__entry_path   IS DISTINCT FROM ps.script__source__browser__repo__entry_path OR
                    cs.script__source__browser__repo__url          IS DISTINCT FROM ps.script__source__browser__repo__url OR
                    cs.script__compiled__browser__script           IS DISTINCT FROM ps.script__compiled__browser__script OR
                    cs.script__compiled__browser__script_sha256      IS DISTINCT FROM ps.script__compiled__browser__script_sha256 OR
                    cs.script__compiled__browser__script_status      IS DISTINCT FROM ps.script__compiled__browser__script_status OR
                    cs.script__compiled__browser__updated_at         IS DISTINCT FROM ps.script__compiled__browser__updated_at
                ) THEN 'UPDATE'::operation_enum
            END AS operation,

            -- "Current scripts" columns with a cs_ prefix
            cs.general__script_id            AS cs_general__script_id,
            cs.general__created_at           AS cs_general__created_at,
            cs.general__created_by           AS cs_general__created_by,
            cs.general__updated_at           AS cs_general__updated_at,
            cs.general__updated_by           AS cs_general__updated_by,
            cs.performance__sync_group       AS cs_performance__sync_group,
            cs.script__source__node__repo__entry_path AS cs_script__source__node__repo__entry_path,
            cs.script__source__node__repo__url        AS cs_script__source__node__repo__url,
            cs.script__compiled__node__script         AS cs_script__compiled__node__script,
            cs.script__compiled__node__script_sha256    AS cs_script__compiled__node__script_sha256,
            cs.script__compiled__node__script_status    AS cs_script__compiled__node__script_status,
            cs.script__compiled__node__updated_at       AS cs_script__compiled__node__updated_at,
            cs.script__source__bun__repo__entry_path     AS cs_script__source__bun__repo__entry_path,
            cs.script__source__bun__repo__url            AS cs_script__source__bun__repo__url,
            cs.script__compiled__bun__script             AS cs_script__compiled__bun__script,
            cs.script__compiled__bun__script_sha256        AS cs_script__compiled__bun__script_sha256,
            cs.script__compiled__bun__script_status        AS cs_script__compiled__bun__script_status,
            cs.script__compiled__bun__updated_at           AS cs_script__compiled__bun__updated_at,
            cs.script__source__browser__repo__entry_path   AS cs_script__source__browser__repo__entry_path,
            cs.script__source__browser__repo__url          AS cs_script__source__browser__repo__url,
            cs.script__compiled__browser__script           AS cs_script__compiled__browser__script,
            cs.script__compiled__browser__script_sha256      AS cs_script__compiled__browser__script_sha256,
            cs.script__compiled__browser__script_status      AS cs_script__compiled__browser__script_status,
            cs.script__compiled__browser__updated_at         AS cs_script__compiled__browser__updated_at,

            -- "Previous scripts" columns with a ps_ prefix
            ps.general__script_id            AS ps_general__script_id,
            ps.general__created_at           AS ps_general__created_at,
            ps.general__created_by           AS ps_general__created_by,
            ps.general__updated_at           AS ps_general__updated_at,
            ps.general__updated_by           AS ps_general__updated_by,
            ps.performance__sync_group       AS ps_performance__sync_group,
            ps.script__source__node__repo__entry_path AS ps_script__source__node__repo__entry_path,
            ps.script__source__node__repo__url        AS ps_script__source__node__repo__url,
            ps.script__compiled__node__script         AS ps_script__compiled__node__script,
            ps.script__compiled__node__script_sha256    AS ps_script__compiled__node__script_sha256,
            ps.script__compiled__node__script_status    AS ps_script__compiled__node__script_status,
            ps.script__compiled__node__updated_at       AS ps_script__compiled__node__updated_at,
            ps.script__source__bun__repo__entry_path     AS ps_script__source__bun__repo__entry_path,
            ps.script__source__bun__repo__url            AS ps_script__source__bun__repo__url,
            ps.script__compiled__bun__script             AS ps_script__compiled__bun__script,
            ps.script__compiled__bun__script_sha256        AS ps_script__compiled__bun__script_sha256,
            ps.script__compiled__bun__script_status        AS ps_script__compiled__bun__script_status,
            ps.script__compiled__bun__updated_at           AS ps_script__compiled__bun__updated_at,
            ps.script__source__browser__repo__entry_path   AS ps_script__source__browser__repo__entry_path,
            ps.script__source__browser__repo__url          AS ps_script__source__browser__repo__url,
            ps.script__compiled__browser__script           AS ps_script__compiled__browser__script,
            ps.script__compiled__browser__script_sha256      AS ps_script__compiled__browser__script_sha256,
            ps.script__compiled__browser__script_status      AS ps_script__compiled__browser__script_status,
            ps.script__compiled__browser__updated_at         AS ps_script__compiled__browser__updated_at

        FROM current_scripts cs
        FULL OUTER JOIN previous_scripts ps 
          ON cs.general__script_id = ps.general__script_id
        WHERE 
              ps.general__script_id IS NULL 
           OR cs.general__script_id IS NULL 
           OR cs.general__created_at           IS DISTINCT FROM ps.general__created_at
           OR cs.general__created_by           IS DISTINCT FROM ps.general__created_by
           OR cs.general__updated_at           IS DISTINCT FROM ps.general__updated_at
           OR cs.general__updated_by           IS DISTINCT FROM ps.general__updated_by
           OR cs.performance__sync_group       IS DISTINCT FROM ps.performance__sync_group
           OR cs.script__source__node__repo__entry_path IS DISTINCT FROM ps.script__source__node__repo__entry_path
           OR cs.script__source__node__repo__url        IS DISTINCT FROM ps.script__source__node__repo__url
           OR cs.script__compiled__node__script         IS DISTINCT FROM ps.script__compiled__node__script
           OR cs.script__compiled__node__script_sha256    IS DISTINCT FROM ps.script__compiled__node__script_sha256
           OR cs.script__compiled__node__script_status    IS DISTINCT FROM ps.script__compiled__node__script_status
           OR cs.script__compiled__node__updated_at       IS DISTINCT FROM ps.script__compiled__node__updated_at
           OR cs.script__source__bun__repo__entry_path     IS DISTINCT FROM ps.script__source__bun__repo__entry_path
           OR cs.script__source__bun__repo__url            IS DISTINCT FROM ps.script__source__bun__repo__url
           OR cs.script__compiled__bun__script             IS DISTINCT FROM ps.script__compiled__bun__script
           OR cs.script__compiled__bun__script_sha256        IS DISTINCT FROM ps.script__compiled__bun__script_sha256
           OR cs.script__compiled__bun__script_status        IS DISTINCT FROM ps.script__compiled__bun__script_status
           OR cs.script__compiled__bun__updated_at           IS DISTINCT FROM ps.script__compiled__bun__updated_at
           OR cs.script__source__browser__repo__entry_path   IS DISTINCT FROM ps.script__source__browser__repo__entry_path
           OR cs.script__source__browser__repo__url          IS DISTINCT FROM ps.script__source__browser__repo__url
           OR cs.script__compiled__browser__script           IS DISTINCT FROM ps.script__compiled__browser__script
           OR cs.script__compiled__browser__script_sha256      IS DISTINCT FROM ps.script__compiled__browser__script_sha256
           OR cs.script__compiled__browser__script_status      IS DISTINCT FROM ps.script__compiled__browser__script_status
           OR cs.script__compiled__browser__updated_at         IS DISTINCT FROM ps.script__compiled__browser__updated_at
    )
    SELECT 
        changed_scripts.script_id,
        changed_scripts.operation,
        CASE changed_scripts.operation
            WHEN 'INSERT' THEN jsonb_build_object(
                'general__created_at',              changed_scripts.cs_general__created_at,
                'general__created_by',              changed_scripts.cs_general__created_by,
                'general__updated_at',              changed_scripts.cs_general__updated_at,
                'general__updated_by',              changed_scripts.cs_general__updated_by,
                'performance__sync_group',          changed_scripts.cs_performance__sync_group,
                -- Node script
                'script__source__node__repo__entry_path', changed_scripts.cs_script__source__node__repo__entry_path,
                'script__source__node__repo__url',          changed_scripts.cs_script__source__node__repo__url,
                'script__compiled__node__script',           changed_scripts.cs_script__compiled__node__script,
                'script__compiled__node__script_sha256',      changed_scripts.cs_script__compiled__node__script_sha256,
                'script__compiled__node__script_status',      changed_scripts.cs_script__compiled__node__script_status,
                'script__compiled__node__updated_at',         changed_scripts.cs_script__compiled__node__updated_at,
                -- Bun script
                'script__source__bun__repo__entry_path',      changed_scripts.cs_script__source__bun__repo__entry_path,
                'script__source__bun__repo__url',             changed_scripts.cs_script__source__bun__repo__url,
                'script__compiled__bun__script',              changed_scripts.cs_script__compiled__bun__script,
                'script__compiled__bun__script_sha256',         changed_scripts.cs_script__compiled__bun__script_sha256,
                'script__compiled__bun__script_status',         changed_scripts.cs_script__compiled__bun__script_status,
                'script__compiled__bun__updated_at',          changed_scripts.cs_script__compiled__bun__updated_at,
                -- Browser script
                'script__source__browser__repo__entry_path',  changed_scripts.cs_script__source__browser__repo__entry_path,
                'script__source__browser__repo__url',         changed_scripts.cs_script__source__browser__repo__url,
                'script__compiled__browser__script',          changed_scripts.cs_script__compiled__browser__script,
                'script__compiled__browser__script_sha256',     changed_scripts.cs_script__compiled__browser__script_sha256,
                'script__compiled__browser__script_status',     changed_scripts.cs_script__compiled__browser__script_status,
                'script__compiled__browser__updated_at',        changed_scripts.cs_script__compiled__browser__updated_at
            )
            WHEN 'DELETE' THEN NULL
            ELSE jsonb_strip_nulls(jsonb_build_object(
                'general__created_at',       NULLIF(changed_scripts.cs_general__created_at, changed_scripts.ps_general__created_at),
                'general__created_by',       NULLIF(changed_scripts.cs_general__created_by, changed_scripts.ps_general__created_by),
                'general__updated_at',       NULLIF(changed_scripts.cs_general__updated_at, changed_scripts.ps_general__updated_at),
                'general__updated_by',       NULLIF(changed_scripts.cs_general__updated_by, changed_scripts.ps_general__updated_by),
                'performance__sync_group',   NULLIF(changed_scripts.cs_performance__sync_group, changed_scripts.ps_performance__sync_group),
                -- Node script
                'script__source__node__repo__entry_path', NULLIF(changed_scripts.cs_script__source__node__repo__entry_path, changed_scripts.ps_script__source__node__repo__entry_path),
                'script__source__node__repo__url',          NULLIF(changed_scripts.cs_script__source__node__repo__url, changed_scripts.ps_script__source__node__repo__url),
                'script__compiled__node__script',           NULLIF(changed_scripts.cs_script__compiled__node__script, changed_scripts.ps_script__compiled__node__script),
                'script__compiled__node__script_sha256',      NULLIF(changed_scripts.cs_script__compiled__node__script_sha256, changed_scripts.ps_script__compiled__node__script_sha256),
                'script__compiled__node__script_status',      NULLIF(changed_scripts.cs_script__compiled__node__script_status, changed_scripts.ps_script__compiled__node__script_status),
                'script__compiled__node__updated_at',         NULLIF(changed_scripts.cs_script__compiled__node__updated_at, changed_scripts.ps_script__compiled__node__updated_at),
                -- Bun script
                'script__source__bun__repo__entry_path',      NULLIF(changed_scripts.cs_script__source__bun__repo__entry_path, changed_scripts.ps_script__source__bun__repo__entry_path),
                'script__source__bun__repo__url',             NULLIF(changed_scripts.cs_script__source__bun__repo__url, changed_scripts.ps_script__source__bun__repo__url),
                'script__compiled__bun__script',              NULLIF(changed_scripts.cs_script__compiled__bun__script, changed_scripts.ps_script__compiled__bun__script),
                'script__compiled__bun__script_sha256',         NULLIF(changed_scripts.cs_script__compiled__bun__script_sha256, changed_scripts.ps_script__compiled__bun__script_sha256),
                'script__compiled__bun__script_status',         NULLIF(changed_scripts.cs_script__compiled__bun__script_status, changed_scripts.ps_script__compiled__bun__script_status),
                'script__compiled__bun__updated_at',          NULLIF(changed_scripts.cs_script__compiled__bun__updated_at, changed_scripts.ps_script__compiled__bun__updated_at),
                -- Browser script
                'script__source__browser__repo__entry_path',  NULLIF(changed_scripts.cs_script__source__browser__repo__entry_path, changed_scripts.ps_script__source__browser__repo__entry_path),
                'script__source__browser__repo__url',         NULLIF(changed_scripts.cs_script__source__browser__repo__url, changed_scripts.ps_script__source__browser__repo__url),
                'script__compiled__browser__script',          NULLIF(changed_scripts.cs_script__compiled__browser__script, changed_scripts.ps_script__compiled__browser__script),
                'script__compiled__browser__script_sha256',     NULLIF(changed_scripts.cs_script__compiled__browser__script_sha256, changed_scripts.ps_script__compiled__browser__script_sha256),
                'script__compiled__browser__script_status',     NULLIF(changed_scripts.cs_script__compiled__browser__script_status, changed_scripts.ps_script__compiled__browser__script_status),
                'script__compiled__browser__updated_at',        NULLIF(changed_scripts.cs_script__compiled__browser__updated_at, changed_scripts.ps_script__compiled__browser__updated_at)
            ))
        END AS script_changes,
        v_active_session_ids
    FROM changed_scripts;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add a type to differentiate between entity and tick-only updates
CREATE TYPE tick_update_type AS ENUM ('ENTITY', 'TICK_ONLY');

-- Update the capture_tick_state function to handle script states and return changes
CREATE OR REPLACE FUNCTION tick.capture_tick_state(p_sync_group text)
RETURNS jsonb AS $$
DECLARE
    current_tick bigint;
    tick_start timestamptz;
    tick_end timestamptz;
    tick_duration double precision;
    entity_states_inserted int;
    script_states_inserted int;
    is_delayed boolean;
    headroom double precision;
    tick_rate_ms int;
    last_tick bigint;
    last_tick_time timestamptz;
    time_since_last_tick double precision;
    v_entity_updates jsonb;
    v_script_updates jsonb;
    v_tick_id uuid;
BEGIN
    -- Add sync group validation at the start
    IF NOT EXISTS (
        SELECT 1 FROM entity.entity_sync_groups 
        WHERE sync_group = p_sync_group
    ) THEN
        RAISE EXCEPTION 'Invalid sync group: %', p_sync_group;
    END IF;

    -- Initialize tick data
    tick_start := clock_timestamp();
    
    -- Get sync groups configuration
    SELECT server__tick__rate_ms INTO tick_rate_ms 
    FROM entity.entity_sync_groups 
    WHERE sync_group = p_sync_group;
    
    -- Calculate current tick number
    SELECT COALESCE(MAX(tick__number), 0) + 1 INTO current_tick
    FROM tick.world_ticks
    WHERE performance__sync_group = p_sync_group;
    
    -- Get the last tick number for this sync group
    SELECT COALESCE(MAX(wt.tick__number), current_tick - 1) INTO last_tick
    FROM tick.entity_states es
    JOIN tick.world_ticks wt ON es.general__tick_id = wt.general__tick_id
    WHERE es.performance__sync_group = p_sync_group;

    -- Get the last tick's timestamp
    SELECT tick__end_time INTO last_tick_time
    FROM tick.world_ticks
    WHERE performance__sync_group = p_sync_group
    AND tick__number = last_tick;

    -- Calculate time since last tick
    time_since_last_tick := CASE 
        WHEN last_tick_time IS NOT NULL 
        THEN EXTRACT(EPOCH FROM (tick_start - last_tick_time)) * 1000 
        ELSE tick_rate_ms 
    END;

    -- Create new tick record with all required fields
    INSERT INTO tick.world_ticks (
        tick__number,
        performance__sync_group,
        tick__start_time,
        tick__end_time,
        tick__duration_ms,
        tick__states_processed,
        tick__is_delayed
    ) VALUES (
        current_tick,
        p_sync_group,
        tick_start,
        tick_start, -- Temporary value, will be updated
        0,         -- Temporary value, will be updated
        0,         -- Temporary value, will be updated
        false      -- Temporary value, will be updated
    ) RETURNING general__tick_id INTO v_tick_id;

    -- Insert new entity states
    WITH inserted_entities AS (
        INSERT INTO tick.entity_states (
            general__entity_id,
            general__name,
            general__semantic_version,
            general__created_at,
            general__created_by,
            general__updated_at,
            general__updated_by,
            general__load_priority,
            general__initialized_at,
            general__initialized_by,
            meta__data,
            scripts__ids,
            scripts__status,
            validation__log,
            performance__sync_group,
            permissions__roles__view,
            permissions__roles__full,
            general__entity_state_id,
            general__tick_id
        )
        SELECT 
            e.general__entity_id,
            e.general__name,
            e.general__semantic_version,
            e.general__created_at,
            e.general__created_by,
            e.general__updated_at,
            e.general__updated_by,
            e.general__load_priority,
            e.general__initialized_at,
            e.general__initialized_by,
            e.meta__data,
            e.scripts__ids,
            e.scripts__status,
            e.validation__log,
            e.performance__sync_group,
            e.permissions__roles__view,
            e.permissions__roles__full,
            uuid_generate_v4(),
            (SELECT general__tick_id FROM tick.world_ticks WHERE tick__number = current_tick AND performance__sync_group = p_sync_group)
        FROM entity.entities e
        WHERE e.performance__sync_group = p_sync_group
        RETURNING 1
    )
    SELECT COUNT(*) INTO entity_states_inserted FROM inserted_entities;

    -- Insert new script states
    WITH inserted_scripts AS (
        INSERT INTO tick.entity_script_states (
            general__script_id,
            general__created_at,
            general__created_by,
            general__updated_at,
            general__updated_by,
            performance__sync_group,
            script__source__node__repo__entry_path,
            script__source__node__repo__url,
            script__compiled__node__script,
            script__compiled__node__script_sha256,
            script__compiled__node__script_status,
            script__compiled__node__updated_at,
            script__source__bun__repo__entry_path,
            script__source__bun__repo__url,
            script__compiled__bun__script,
            script__compiled__bun__script_sha256,
            script__compiled__bun__script_status,
            script__compiled__bun__updated_at,
            script__source__browser__repo__entry_path,
            script__source__browser__repo__url,
            script__compiled__browser__script,
            script__compiled__browser__script_sha256,
            script__compiled__browser__script_status,
            script__compiled__browser__updated_at,
            general__script_state_id,
            general__tick_id
        )
        SELECT 
            js.general__script_id,
            js.general__created_at,
            js.general__created_by,
            js.general__updated_at,
            js.general__updated_by,
            js.performance__sync_group,
            js.script__source__node__repo__entry_path,
            js.script__source__node__repo__url,
            js.script__compiled__node__script,
            js.script__compiled__node__script_sha256,
            js.script__compiled__node__script_status,
            js.script__compiled__node__updated_at,
            js.script__source__bun__repo__entry_path,
            js.script__source__bun__repo__url,
            js.script__compiled__bun__script,
            js.script__compiled__bun__script_sha256,
            js.script__compiled__bun__script_status,
            js.script__compiled__bun__updated_at,
            js.script__source__browser__repo__entry_path,
            js.script__source__browser__repo__url,
            js.script__compiled__browser__script,
            js.script__compiled__browser__script_sha256,
            js.script__compiled__browser__script_status,
            js.script__compiled__browser__updated_at,
            uuid_generate_v4(),
            (SELECT general__tick_id FROM tick.world_ticks WHERE tick__number = current_tick AND performance__sync_group = p_sync_group)
        FROM entity.entity_scripts js
        WHERE js.performance__sync_group = p_sync_group
        RETURNING 1
    )
    SELECT COUNT(*) INTO script_states_inserted FROM inserted_scripts;

    -- Calculate tick metrics
    tick_end := clock_timestamp();
    tick_duration := EXTRACT(EPOCH FROM (tick_end - tick_start)) * 1000.0;
    is_delayed := tick_duration > tick_rate_ms;
    headroom := GREATEST(tick_rate_ms - tick_duration, 0.0);

    -- Update tick record with final metrics
    UPDATE tick.world_ticks SET
        tick__end_time = tick_end,
        tick__duration_ms = tick_duration,
        tick__states_processed = entity_states_inserted + script_states_inserted,
        tick__is_delayed = is_delayed,
        tick__headroom_ms = headroom,
        tick__time_since_last_tick_ms = time_since_last_tick,
        tick__rate_limited = (tick_duration > tick_rate_ms)
    WHERE general__tick_id = v_tick_id;

    -- Get entity updates as JSONB
    SELECT jsonb_agg(
        jsonb_build_object(
            'entityId', entity_id,
            'operation', operation,
            'entityChanges', entity_changes,
            'sessionIds', to_jsonb(session_ids)
        )
    )
    FROM tick.get_entity_changes(p_sync_group, last_tick, current_tick)
    INTO v_entity_updates;

    -- Get script updates as JSONB
    SELECT jsonb_agg(
        jsonb_build_object(
            'scriptId', script_id,
            'operation', operation,
            'scriptChanges', script_changes,
            'sessionIds', to_jsonb(session_ids)
        )
    )
    FROM tick.get_script_changes(p_sync_group, last_tick, current_tick)
    INTO v_script_updates;

    -- Return the complete tick state as JSONB
    RETURN jsonb_build_object(
        'tick_data', jsonb_build_object(
            'tick_number', current_tick,
            'tick_start_time', tick_start,
            'tick_end_time', tick_end,
            'tick_duration_ms', tick_duration,
            'is_delayed', is_delayed,
            'headroom_ms', headroom,
            'delta_time_ms', time_since_last_tick,
            'time_until_next_tick_ms', GREATEST(tick_rate_ms - tick_duration, 0.0),
            'tick_lag', (current_tick - last_tick)::int,
            'entity_states_processed', entity_states_inserted,
            'script_states_processed', script_states_inserted,
            'rate_limited', (tick_duration > tick_rate_ms)
        ),
        'entity_updates', COALESCE(v_entity_updates, '[]'::jsonb),
        'script_updates', COALESCE(v_script_updates, '[]'::jsonb)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Replace both cleanup functions with a single, simpler function
CREATE OR REPLACE FUNCTION tick.cleanup_old_ticks()
RETURNS void AS $$
DECLARE
    ticks_cleaned integer;
BEGIN
    -- Replace system role check with is_admin_agent()
    IF NOT auth.is_admin_agent() THEN
        RAISE EXCEPTION 'Permission denied: Admin permission required';
    END IF;

    -- Clean old ticks (entity states will be cleaned via CASCADE)
    WITH deleted_ticks AS (
        DELETE FROM tick.world_ticks 
        WHERE general__created_at < (now() - (
            SELECT (value#>>'{}'::text[])::int * interval '1 millisecond' 
            FROM config.config 
            WHERE key = 'world_ticks_history_ms'
        ))
        RETURNING *
    )
    SELECT COUNT(*) INTO ticks_cleaned FROM deleted_ticks;
    
    -- Log cleanup results if anything was cleaned
    IF ticks_cleaned > 0 THEN
        RAISE NOTICE 'Tick cleanup completed: % ticks removed (entity states cascade deleted)', ticks_cleaned;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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

-- Add index for sync group queries
CREATE INDEX entity_states_sync_group_tick_idx 
ON tick.entity_states (performance__sync_group, general__tick_id DESC);

-- Create function to update timestamp
CREATE OR REPLACE FUNCTION tick.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.general__updated_at = CURRENT_TIMESTAMP;
    NEW.general__updated_by = auth.current_agent_id();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for entity_sync_groups
CREATE TRIGGER update_entity_states_updated_at
    BEFORE UPDATE ON tick.entity_states
    FOR EACH ROW
    EXECUTE FUNCTION tick.update_updated_at();

CREATE TRIGGER update_world_ticks_updated_at
    BEFORE UPDATE ON tick.world_ticks
    FOR EACH ROW
    EXECUTE FUNCTION tick.update_updated_at();

-- Add optimized indexes for the tick system
CREATE INDEX idx_entity_states_sync_tick_lookup 
ON tick.entity_states (performance__sync_group, general__tick_id, general__entity_id);

CREATE INDEX idx_entity_states_roles 
ON tick.entity_states USING GIN (permissions__roles__view);
