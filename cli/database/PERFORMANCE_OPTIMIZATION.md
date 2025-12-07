# PostgreSQL Performance Optimization for High-Frequency Metadata Updates

## Problem
The system needs to handle 30+ metadata updates/retrievals per second, but current configuration and schema design creates bottlenecks.

## Bottlenecks Identified

1. **Trigger Overhead**: Multiple triggers fire on every metadata operation
2. **Row Level Security (RLS)**: Complex permission checks on each query
3. **Transaction Overhead**: Each query sets agent context
4. **Suboptimal Indexes**: Not optimized for the specific access patterns
5. **WAL Writing**: Every update writes to WAL (Write-Ahead Log)

## Implemented Solutions

### 1. PostgreSQL Configuration Optimizations
- **`synchronous_commit=off`**: Don't wait for WAL flush (trades durability for speed)
- **`commit_delay=100`**: Batch commits together
- **Increased memory settings**: Better caching and query performance
- **SSD optimizations**: Settings tuned for fast storage
- **More aggressive autovacuum**: Prevent table bloat

### 2. Schema Optimizations
- **Composite indexes**: Better coverage for common query patterns
- **Partial indexes**: Optimize for active (non-expired) records
- **Debounced triggers**: Reduce frequency of agent last-seen updates
- **Batched parent updates**: More efficient entity touch triggers
- **Fillfactor=90**: Leave space for HOT (Heap-Only Tuple) updates

### 3. Application Strategies

#### Option A: Batch Updates
Instead of individual updates, batch them:

```typescript
// Collect updates for 100ms, then execute in one transaction
const batchedUpdates = [];
const BATCH_INTERVAL = 100; // ms

// Accumulate updates
batchedUpdates.push({ entity, key, value });

// Execute batch
setInterval(async () => {
  if (batchedUpdates.length > 0) {
    await db.transaction(async (tx) => {
      for (const update of batchedUpdates) {
        await tx`
          SELECT entity.update_metadata_optimized(
            ${update.entity}, 
            ${update.key}, 
            ${update.value}
          )
        `;
      }
    });
    batchedUpdates.length = 0;
  }
}, BATCH_INTERVAL);
```

#### Option B: Use Temporary Table
For very high-frequency updates, use the unlogged temp table:

```typescript
// Write to temp table (no WAL, very fast)
await db`
  INSERT INTO entity.entity_metadata_temp 
  (general__entity_name, metadata__key, metadata__value, group__sync)
  VALUES (${entity}, ${key}, ${value}, ${syncGroup})
  ON CONFLICT (general__entity_name, metadata__key) 
  DO UPDATE SET 
    metadata__value = EXCLUDED.metadata__value,
    general__updated_at = now()
`;

// Periodically merge to permanent table
setInterval(async () => {
  await db`SELECT entity.merge_temp_metadata()`;
}, 1000); // Every second
```

#### Option C: Connection Pooling
Optimize connection usage:

```typescript
// Use prepared statements
const updateStmt = await db.prepare(`
  SELECT entity.update_metadata_optimized($1, $2, $3, $4)
`);

// Reuse the prepared statement
await updateStmt.execute([entity, key, value, syncGroup]);
```

#### Option D: Read Replicas
For read-heavy workloads, use read replicas:

```typescript
// Writes go to primary
await primaryDb`UPDATE entity_metadata SET ...`;

// Reads go to replica (with slight lag)
const data = await replicaDb`
  SELECT * FROM entity_metadata 
  WHERE general__entity_name = ${entity}
`;
```

## Monitoring

Monitor these metrics to ensure optimizations are working:

1. **Query latency**: Should be <10ms for updates
2. **Transaction rate**: Target 100+ TPS
3. **Cache hit ratio**: Should be >95%
4. **Table bloat**: Monitor with `pg_stat_user_tables`
5. **Lock waits**: Check `pg_locks` for conflicts

## Testing the Optimizations

Run this benchmark to test performance:

```sql
-- Test direct updates
DO $$
DECLARE
    start_time timestamptz;
    end_time timestamptz;
    i integer;
BEGIN
    start_time := clock_timestamp();
    
    FOR i IN 1..1000 LOOP
        PERFORM entity.update_metadata_optimized(
            'test_entity_' || (i % 10), 
            'test_key_' || (i % 50),
            jsonb_build_object('value', i, 'timestamp', now()),
            'public.NORMAL'
        );
    END LOOP;
    
    end_time := clock_timestamp();
    RAISE NOTICE 'Time for 1000 updates: % ms', 
        EXTRACT(MILLISECOND FROM (end_time - start_time));
END $$;
```

## Rollback Plan

If issues occur, revert optimizations:

1. Remove `synchronous_commit=off` from docker-compose
2. Drop the new migration: `DROP SCHEMA entity CASCADE; -- then re-run migrations`
3. Restart PostgreSQL container

## Next Steps

1. Implement connection pooling with pgBouncer if needed
2. Consider partitioning entity_metadata table by entity_name if it grows large
3. Add Redis caching layer for frequently accessed metadata
4. Monitor and tune based on actual workload patterns
