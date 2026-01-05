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
| **Supermemory** | `containerTag` | `memorybench_${run12}_${scopeHash12}` | Hash includes session_id for per-case isolation |
| **Mem0** | `user_id` filter | `memorybench_${run12}_${scopeHash12}` | Hash includes session_id for per-case isolation |
| **ContextualRetrieval** | DB `run_id` column | `scope.run_id` | PostgreSQL row filtering |

## Async Indexing

Providers with async indexing require convergence before retrieval. MemoryBench
prefers provider-level polling via `await_convergence` when available; otherwise
it falls back to sleeping `convergence_wait_ms`.

| Provider | `convergence_wait_ms` | Notes |
|----------|----------------------|-------|
| LocalBaseline | 0 | Synchronous |
| Supermemory | 30,000 | Document processing queue |
| Mem0 | 30,000 | Fact extraction pipeline |
