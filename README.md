# Memorybench

A unified benchmarking platform for memory providers. Add **providers** or **benchmarks** and run them using a unified CLI.

## Quick Start

```bash
bun install

# List available benchmarks and providers
bun run index.ts list benchmarks
bun run index.ts list providers

# Run a single benchmark against a single provider
bun run index.ts eval --providers quickstart-test --benchmarks RAG-template-benchmark

# Run with concurrent execution for faster results
bun run index.ts eval --providers quickstart-test --benchmarks RAG-template-benchmark --concurrency 4
```

## Running Benchmarks

### Basic Evaluation

Run a provider against a benchmark and get structured JSON results:

```bash
bun run index.ts eval --providers quickstart-test --benchmarks RAG-template-benchmark
```

Output includes:
- **Run metadata**: `run_id`, `timestamp`, `selections`
- **Execution plan**: Provider × benchmark combinations with capability gating
- **Results**: Per-case results with status, scores, and timing data
- **Summary**: Aggregated pass/fail/skip/error counts and total duration

### Multiple Providers and Benchmarks

Run multiple combinations in a single evaluation:

```bash
bun run index.ts eval \
  --providers quickstart-test AQRAG \
  --benchmarks RAG-template-benchmark LongMemEval
```

The runner creates a matrix of all combinations, automatically skipping incompatible pairs based on capability requirements.

### Concurrent Execution

Speed up evaluations by running cases in parallel:

```bash
bun run index.ts eval \
  --providers quickstart-test \
  --benchmarks RAG-template-benchmark \
  --concurrency 4
```

This executes up to 4 benchmark cases simultaneously per provider/benchmark combination.

### Understanding Output

The `eval` command outputs structured JSON to stdout. Save it for later analysis:

```bash
bun run index.ts eval \
  --providers quickstart-test \
  --benchmarks RAG-template-benchmark \
  > results.json
```

**Skip reasons** are included when providers lack required capabilities:

```json
{
  "plan": {
    "entries": [{
      "provider_name": "quickstart-test",
      "benchmark_name": "some-benchmark",
      "eligible": false,
      "skip_reason": {
        "message": "Provider 'quickstart-test' lacks required capability: update_memory"
      }
    }]
  }
}
```

## Available Benchmarks

| Benchmark | Description |
|-----------|-------------|
| RAG-template-benchmark | Basic RAG retrieval accuracy |
| LongMemEval | Long-term memory evaluation with 6 question types |

## Available Providers

| Provider | Description |
|----------|-------------|
| ContextualRetrieval | Contextual chunking with embeddings |
| AQRAG | Adaptive query RAG |
| quickstart-test | Simple in-memory provider for testing |

## Adding a Benchmark

Create `benchmarks/<name>/manifest.json`:

```json
{
  "manifest_version": "1",
  "name": "my-benchmark",
  "version": "1.0.0",
  "data_file": "data.jsonl",
  "ingestion": { "strategy": "simple", "content_field": "content" },
  "query": { "question_field": "question", "expected_answer_field": "answer" },
  "evaluation": { "protocol": "exact-match" },
  "metrics": ["correctness"],
  "required_capabilities": ["add_memory", "retrieve_memory"]
}
```

## Adding a Provider

Create `providers/<name>/index.ts` implementing `BaseProvider`:

```typescript
import type { BaseProvider } from "../../types/provider";

export default {
  name: "my-provider",
  async add_memory(scope, content) { /* ... */ },
  async retrieve_memory(scope, query, limit) { /* ... */ },
  async delete_memory(scope, id) { /* ... */ }
} satisfies BaseProvider;
```

## v0.1 Scope

See [docs/v0.1_scope.md](docs/v0.1_scope.md) for the v0.1 Definition of Done.
