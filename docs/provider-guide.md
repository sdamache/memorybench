# Adding a Provider

This guide walks you through adding a new memory provider to MemoryBench. A provider is an adapter that implements a standard interface to interact with a memory backend (e.g., Supermemory, Mem0, or your own implementation).

**Time estimate:** ~15 minutes for a basic provider

## Prerequisites

- Bun runtime installed
- API credentials for your memory backend (if applicable)
- Understanding of your backend's API for add/retrieve/delete operations

## Directory Structure

Create the following structure:

```
providers/
└── my-provider/
    ├── manifest.json    # Provider configuration and capabilities
    └── index.ts         # Provider implementation
```

## Step 1: Create the Manifest

The manifest declares your provider's identity and capabilities. Create `providers/my-provider/manifest.json`:

```json
{
  "manifest_version": "1",
  "provider": {
    "name": "my-provider",
    "type": "intelligent_memory",
    "version": "1.0.0"
  },
  "capabilities": {
    "core_operations": {
      "add_memory": true,
      "retrieve_memory": true,
      "delete_memory": true
    },
    "optional_operations": {
      "update_memory": false,
      "list_memories": false,
      "reset_scope": false,
      "get_capabilities": true
    },
    "system_flags": {
      "async_indexing": true
    },
    "intelligence_flags": {
      "auto_extraction": true,
      "graph_support": false
    }
  },
  "semantic_properties": {
    "update_strategy": "eventual",
    "delete_strategy": "immediate"
  },
  "conformance_tests": {
    "expected_behavior": {
      "convergence_wait_ms": 5000
    }
  }
}
```

### Manifest Fields

| Field | Description |
|-------|-------------|
| `provider.name` | Unique identifier. Must match `index.ts` export name |
| `provider.type` | `intelligent_memory`, `hybrid`, or `framework` |
| `provider.version` | Semantic version (e.g., "1.0.0") |
| `capabilities.core_operations` | Required operations (all three must be `true`) |
| `capabilities.optional_operations` | Optional operations you implement |
| `capabilities.system_flags.async_indexing` | Set `true` if writes aren't immediately queryable |
| `capabilities.intelligence_flags` | LLM-based features (auto_extraction, graph_support) |
| `conformance_tests.expected_behavior.convergence_wait_ms` | Time to wait after writes before retrieval |

### Provider Types

- **intelligent_memory**: LLM-enhanced (e.g., Mem0, Supermemory) - extracts facts, deduplicates, enriches
- **hybrid**: Mix of lexical and semantic search (e.g., LocalBaseline with BM25 + embeddings)
- **framework**: Infrastructure provider without built-in intelligence

### Convergence Wait

Async memory backends don't immediately surface new memories. Set `convergence_wait_ms` to the typical time needed for:
- Document processing queues to complete
- Embeddings to be generated
- Indexes to be updated

| Provider Type | Typical Wait |
|--------------|--------------|
| Synchronous (in-memory) | 0ms |
| Local database | 100-500ms |
| Cloud with async processing | 5,000-30,000ms |

## Step 2: Implement the Adapter

Create `providers/my-provider/index.ts`:

```typescript
import type {
  MemoryRecord,
  ProviderCapabilities,
  RetrievalItem,
  ScopeContext,
} from "../../types/core";
import type { BaseProvider } from "../../types/provider";

// API configuration
const API_BASE = "https://api.my-memory-service.com/v1";
const API_KEY = process.env.MY_PROVIDER_API_KEY;

/**
 * My Provider Adapter
 *
 * Wraps the My Memory Service API with the MemoryBench BaseProvider interface.
 */
const myProvider: BaseProvider = {
  name: "my-provider", // Must match manifest.provider.name exactly!

  // === Required Operations ===

  async add_memory(
    scope: ScopeContext,
    content: string,
    metadata?: Record<string, unknown>,
  ): Promise<MemoryRecord> {
    // Map ScopeContext to your backend's isolation mechanism
    const response = await fetch(`${API_BASE}/memories`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content,
        user_id: scope.user_id,        // Use for tenant isolation
        namespace: `memorybench_${scope.run_id}`,  // Use for run isolation
        metadata,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to add memory: ${response.status}`);
    }

    const data = await response.json();

    return {
      id: data.id,
      context: content,
      metadata: metadata ?? {},
      timestamp: Date.now(),
    };
  },

  async retrieve_memory(
    scope: ScopeContext,
    query: string,
    limit = 10,
  ): Promise<RetrievalItem[]> {
    const response = await fetch(`${API_BASE}/search`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        user_id: scope.user_id,
        namespace: `memorybench_${scope.run_id}`,
        limit,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to retrieve memories: ${response.status}`);
    }

    const data = await response.json();

    // Map API response to RetrievalItem format
    return data.results.map((result: any) => ({
      record: {
        id: result.id,
        context: result.content,
        metadata: result.metadata ?? {},
        timestamp: result.created_at ?? Date.now(),
      },
      score: result.score ?? 1.0,  // Normalized 0-1 relevance score
    }));
  },

  async delete_memory(
    scope: ScopeContext,
    memory_id: string,
  ): Promise<boolean> {
    const response = await fetch(`${API_BASE}/memories/${memory_id}`, {
      method: "DELETE",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
      },
    });

    return response.ok || response.status === 404;
  },

  // === Optional Operations (only implement if declared in manifest) ===

  async get_capabilities(): Promise<ProviderCapabilities> {
    return {
      core_operations: {
        add_memory: true,
        retrieve_memory: true,
        delete_memory: true,
      },
      optional_operations: {
        update_memory: false,
        list_memories: false,
        reset_scope: false,
        get_capabilities: true,
      },
      system_flags: {
        async_indexing: true,
      },
      intelligence_flags: {
        auto_extraction: true,
        graph_support: false,
      },
    };
  },
};

export default myProvider;
```

## Step 3: Handle Scope Isolation

The `ScopeContext` provides fields for test isolation:

```typescript
interface ScopeContext {
  user_id: string;     // e.g., "user_run_1766457385278_e3exbw2"
  run_id: string;      // e.g., "run_1766457385278_e3exbw2"
  session_id?: string; // e.g., "my-provider_LongMemEval_case123"
  namespace?: string;  // e.g., "runner_run_1766457385278_e3exbw2"
}
```

Map these to your backend's isolation mechanism:

| Backend Mechanism | Recommended Mapping |
|-------------------|---------------------|
| User/tenant ID | `scope.user_id` |
| Namespace/collection | `memorybench_${scope.run_id}` |
| Container/tag | `memorybench_${scope.user_id}_${scope.run_id}` |
| Database column | `scope.run_id` directly |

See [docs/provider-scoping.md](provider-scoping.md) for how existing providers handle scoping.

## Step 4: Verify Your Provider

1. **Check provider loads:**

```bash
bun run index.ts list providers
```

Your provider should appear in the table with its capabilities.

2. **Run a quick test:**

```bash
bun run index.ts eval --providers my-provider --benchmarks RAG-template-benchmark
```

3. **Check for common issues:**

| Error | Cause | Fix |
|-------|-------|-----|
| "Provider 'X' not found" | Name mismatch | Ensure `name` in index.ts matches manifest |
| "Missing required method" | Interface incomplete | Implement all three core operations |
| "Capability mismatch" | manifest/code disagreement | Align manifest with actual implementation |
| Results always empty | Scope isolation wrong | Check your namespace/user_id mapping |
| Flaky test results | Async indexing | Increase `convergence_wait_ms` |

## Optional Operations

### update_memory

If your backend supports updating existing memories:

```typescript
async update_memory(
  scope: ScopeContext,
  memory_id: string,
  content: string,
  metadata?: Record<string, unknown>,
): Promise<MemoryRecord> {
  // Call your update API
  const response = await fetch(`${API_BASE}/memories/${memory_id}`, {
    method: "PATCH",
    headers: { /* ... */ },
    body: JSON.stringify({ content, metadata }),
  });
  // ...
}
```

Don't forget to set `optional_operations.update_memory: true` in manifest.

### list_memories

For debugging and verification:

```typescript
async list_memories(
  scope: ScopeContext,
  limit = 100,
  offset = 0,
): Promise<MemoryRecord[]> {
  // Call your list API with scope filters
}
```

## Real-World Examples

Study these existing providers for reference:

| Provider | Source | Notes |
|----------|--------|-------|
| LocalBaseline | `providers/LocalBaseline/index.ts` | Simplest example, in-memory, synchronous |
| Supermemory | `providers/supermemory/index.ts` | Cloud API, container-tag scoping |
| Mem0 | `providers/mem0/index.ts` | Cloud API, user_id filtering |

## Testing Tips

1. **Start with LocalBaseline** to verify the harness works
2. **Use RAG-template-benchmark** for initial testing (simple, fast)
3. **Increase convergence_wait_ms** if tests are flaky
4. **Check the results explorer** to debug failures: `bun run index.ts explore --run <run_id>`

## Troubleshooting

### "All retrieval results are empty"

1. Verify memories are being stored (check your backend's dashboard)
2. Verify scope isolation matches between add and retrieve
3. Increase `convergence_wait_ms` for async backends

### "Tests pass but scores are low"

1. Check if your backend returns relevance scores
2. Verify content isn't being transformed/truncated on storage
3. Check retrieval limit isn't too low

### "API rate limiting"

1. Use `--concurrency 1` to serialize requests
2. Add retry logic with exponential backoff in your adapter
