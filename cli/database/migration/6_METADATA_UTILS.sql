-- ============================================================================
-- 6. METADATA UTILITIES MIGRATION
-- ============================================================================

-- This migration adds utility functions and guidelines for managing large metadata
-- to prevent PostgreSQL index row size limit issues (8191 bytes max)

-- ============================================================================
-- 1. UTILITY FUNCTIONS
-- ============================================================================

-- Function to estimate JSONB size (IMMUTABLE for use in indexes if needed)
CREATE OR REPLACE FUNCTION entity.estimate_jsonb_size(data JSONB)
RETURNS INTEGER AS $$
BEGIN
    -- Simple estimation based on text representation length
    -- This is IMMUTABLE and safe for indexes
    RETURN length(data::text);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to check if metadata is "large" (over 4KB when serialized)
CREATE OR REPLACE FUNCTION entity.is_large_metadata(data JSONB)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN entity.estimate_jsonb_size(data) > 4000;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to compress large metadata using PostgreSQL's built-in compression
CREATE OR REPLACE FUNCTION entity.compress_metadata(data JSONB)
RETURNS JSONB AS $$
BEGIN
    -- For very large metadata, consider splitting into separate storage
    -- This is a placeholder for future compression logic
    IF entity.is_large_metadata(data) THEN
        -- Could implement compression or chunking here
        RAISE NOTICE 'Large metadata detected: % characters', entity.estimate_jsonb_size(data);
    END IF;
    RETURN data;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================================
-- 2. MONITORING VIEWS
-- ============================================================================

-- View to monitor entities with large metadata
CREATE OR REPLACE VIEW entity.large_metadata_entities AS
SELECT 
    general__entity_name,
    group__sync,
    entity.estimate_jsonb_size(meta__data) as estimated_size_bytes,
    general__updated_at,
    meta_data_updated_at
FROM entity.entities 
WHERE entity.is_large_metadata(meta__data)
ORDER BY entity.estimate_jsonb_size(meta__data) DESC;

-- View to monitor tick entity states with large metadata
CREATE OR REPLACE VIEW tick.large_metadata_states AS
SELECT 
    general__entity_name,
    group__sync,
    general__tick_id,
    entity.estimate_jsonb_size(meta__data) as estimated_size_bytes
FROM tick.entity_states 
WHERE entity.is_large_metadata(meta__data)
ORDER BY entity.estimate_jsonb_size(meta__data) DESC;

-- ============================================================================
-- 3. GRANTS
-- ============================================================================

-- Grant permissions for the utility functions
GRANT EXECUTE ON FUNCTION entity.estimate_jsonb_size(JSONB) TO vircadia_agent_proxy;
GRANT EXECUTE ON FUNCTION entity.is_large_metadata(JSONB) TO vircadia_agent_proxy;
GRANT EXECUTE ON FUNCTION entity.compress_metadata(JSONB) TO vircadia_agent_proxy;

-- Grant permissions for the monitoring views
GRANT SELECT ON entity.large_metadata_entities TO vircadia_agent_proxy;
GRANT SELECT ON tick.large_metadata_states TO vircadia_agent_proxy;

-- ============================================================================
-- 4. RECOMMENDATIONS AND GUIDELINES
-- ============================================================================

-- Add comments with recommendations for handling large metadata:

COMMENT ON FUNCTION entity.estimate_jsonb_size(JSONB) IS 
'Estimates the serialized size of JSONB data. Use this to identify potentially problematic large metadata before it causes index row size issues.';

COMMENT ON FUNCTION entity.is_large_metadata(JSONB) IS 
'Returns true if metadata is considered "large" (>4KB). Large metadata should be handled carefully to avoid PostgreSQL index row size limits.';

COMMENT ON VIEW entity.large_metadata_entities IS 
'Monitoring view to identify entities with large metadata that might cause index row size issues. Consider refactoring large metadata into separate tables or compressing it.';

COMMENT ON VIEW tick.large_metadata_states IS 
'Monitoring view to identify tick entity states with large metadata. Large metadata in tick states can cause performance issues and index failures.';

-- ============================================================================
-- 5. ADDITIONAL INDEXES FOR METADATA MANAGEMENT
-- ============================================================================

-- Add index on estimated size for monitoring (using our IMMUTABLE function)
CREATE INDEX idx_entities_metadata_size ON entity.entities 
    (group__sync, entity.estimate_jsonb_size(meta__data))
    WHERE entity.is_large_metadata(meta__data);

-- Add similar index for tick entity states
CREATE INDEX idx_entity_states_metadata_size ON tick.entity_states
    (group__sync, entity.estimate_jsonb_size(meta__data))
    WHERE entity.is_large_metadata(meta__data); 