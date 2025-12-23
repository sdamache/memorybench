# Provider Scoping Reference

How each provider maps MemoryBench's `ScopeContext` to its native isolation mechanism.

## ScopeContext Structure

```typescript
{
  user_id: `user_${runId}`,           // e.g., "user_run_1766457385278_e3exbw2"
  run_id: runId,                       // e.g., "run_1766457385278_e3exbw2"
  session_id: `${provider}_${benchmark}_${caseId}`,
  namespace: `runner_${runId}`
}
```

## Provider Mappings

| Provider | Isolation Field | Mapping | Notes |
|----------|-----------------|---------|-------|
| **LocalBaseline** | In-memory key | `${user_id}:${run_id}:${id}` | Full scope in key |
| **Supermemory** | `containerTag` | `memorybench_${user_id}_${run_id}` | Tag-based filtering |
| **Mem0** | `user_id` filter | `scope.user_id` directly | Run isolation via user_id format |
| **ContextualRetrieval** | DB `run_id` column | `scope.run_id` | PostgreSQL row filtering |

## Async Indexing

Providers with async indexing require convergence wait times before retrieval:

| Provider | `convergence_wait_ms` | Notes |
|----------|----------------------|-------|
| LocalBaseline | 0 | Synchronous |
| Supermemory | 10,000 | Document processing queue |
| Mem0 | 15,000 | Fact extraction pipeline |
