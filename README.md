# Memorybench

A unified benchmarking platform for memory providers. Add **providers** or **benchmarks** and run them using a unified CLI.

## Quick Start

```bash
bun install

# List available benchmarks and providers
bun run index.ts list benchmarks
bun run index.ts list providers

# Run a single benchmark against a single provider
bun run index.ts eval --providers LocalBaseline --benchmarks RAG-template-benchmark

# Run with concurrent execution for faster results
bun run index.ts eval --providers LocalBaseline --benchmarks RAG-template-benchmark --concurrency 4
```

## Running Benchmarks

### Basic Evaluation

Run a provider against a benchmark and get structured JSON results:

```bash
bun run index.ts eval --providers LocalBaseline --benchmarks RAG-template-benchmark
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
  --providers LocalBaseline AQRAG \
  --benchmarks RAG-template-benchmark LongMemEval
```

The runner creates a matrix of all combinations, automatically skipping incompatible pairs based on capability requirements.

### Concurrent Execution

Speed up evaluations by running cases in parallel:

```bash
bun run index.ts eval \
  --providers LocalBaseline \
  --benchmarks RAG-template-benchmark \
  --concurrency 4
```

This executes up to 4 benchmark cases simultaneously per provider/benchmark combination.

### Understanding Output

The `eval` command outputs structured JSON to stdout and writes persistent results to `runs/{run_id}/`. Save stdout for immediate inspection:

```bash
bun run index.ts eval \
  --providers LocalBaseline \
  --benchmarks RAG-template-benchmark \
  > results.json
```

**Skip reasons** are included when providers lack required capabilities:

```json
{
  "plan": {
    "entries": [{
      "provider_name": "LocalBaseline",
      "benchmark_name": "some-benchmark",
      "eligible": false,
      "skip_reason": {
        "message": "Provider 'LocalBaseline' lacks required capability: update_memory"
      }
    }]
  }
}
```

### Results Output Files

Each evaluation run creates a timestamped directory under `runs/` with three machine-parseable files:

```
runs/run_1766388833350_hpq76ud/
├── run_manifest.json       # Run metadata (git commit, CLI args, environment)
├── results.jsonl           # Per-case results (appended incrementally)
└── metrics_summary.json    # Aggregated metrics by provider×benchmark
```

**Key features:**
- **Reproducibility**: `run_manifest.json` captures git commit, environment info, and CLI arguments
- **Durability**: `results.jsonl` is appended after each case completes, surviving interruptions
- **Analysis-ready**: JSONL format for easy streaming and filtering with tools like `jq`

**Example - Extract failed cases:**
```bash
cat runs/run_*/results.jsonl | jq 'select(.status == "fail")'
```

**Example - Calculate average scores:**
```bash
cat runs/run_*/results.jsonl | jq -s 'map(.scores.correctness) | add / length'
```

See [docs/output-format.md](docs/output-format.md) for complete schema documentation and examples.

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
| LocalBaseline | In-memory provider with BM25 lexical retrieval (no API keys required) |

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
