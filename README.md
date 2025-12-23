# MemoryBench

A unified benchmarking platform for memory providers. Add **providers** or **benchmarks** and run them using a unified CLI.

## Why MemoryBench?

Memory providers for AI applications are fragmented. Developers face:
- **Fragmentation**: Each provider has its own API, setup, and evaluation methodology
- **Slow Setup**: Getting benchmarks running against multiple providers takes significant effort
- **No Standard Comparison**: Hard to objectively compare providers without a unified testing framework

MemoryBench solves this with a unified platform where you can:
1. Add new memory **providers** with a standard interface
2. Add new **benchmarks** with data-driven configuration
3. Run all combinations via a single CLI with capability gating

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

# Resume an interrupted run
bun run index.ts eval --resume <run_id>

# Explore results in an interactive UI
bun run index.ts explore --run <run_id> --port 3000
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

| Benchmark | Description | Evaluation | Source |
|-----------|-------------|------------|--------|
| RAG-template-benchmark | Basic RAG retrieval accuracy | Exact match | Template |
| LongMemEval | Long-term memory evaluation across extended conversation histories (6 question types) | LLM-as-judge | [Paper](https://arxiv.org/abs/2410.10813) |
| LoCoMo | Long Context Memory benchmark with temporal reasoning across multi-session dialogues | LLM-as-judge | [Paper](https://arxiv.org/abs/2402.17753) |

## Available Providers

| Provider | Type | Description | API Key Required |
|----------|------|-------------|-----------------|
| LocalBaseline | hybrid | In-memory provider with BM25 lexical retrieval | ❌ No |
| ContextualRetrieval | intelligent_memory | Contextual chunking with embeddings via Vertex AI | ✅ gcloud |
| AQRAG | intelligent_memory | Adaptive query RAG with auto-extraction | ✅ Yes |
| Supermemory | intelligent_memory | Cloud-hosted memory with document processing | ✅ SUPERMEMORY_API_KEY |
| Mem0 | intelligent_memory | Memory with LLM extraction and graph support | ✅ MEM0_API_KEY |

### Provider Capabilities

Each provider declares its capabilities in a `manifest.json`. The runner automatically skips benchmark/provider combinations that don't meet capability requirements.

| Provider | add | retrieve | delete | update | list | Async Indexing | Convergence Wait |
|----------|-----|----------|--------|--------|------|----------------|------------------|
| LocalBaseline | ✅ | ✅ | ✅ | ❌ | ✅ | No | 0ms |
| ContextualRetrieval | ✅ | ✅ | ✅ | ❌ | ❌ | Yes | 500ms |
| AQRAG | ✅ | ✅ | ✅ | ❌ | ❌ | Yes | 750ms |
| Supermemory | ✅ | ✅ | ✅ | ✅ | ✅ | Yes | 30s |
| Mem0 | ✅ | ✅ | ✅ | ✅ | ✅ | Yes | 30s |

## Adding a Benchmark

Benchmarks are data-driven, defined via `manifest.json` + data files. See [docs/benchmark-guide.md](docs/benchmark-guide.md) for the complete guide.

### Quick Example

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

**Evaluation Protocols:**
- `exact-match` - Direct string comparison
- `llm-as-judge` - LLM-based semantic evaluation with configurable backends

**Ingestion Strategies:**
- `simple` - Direct content ingestion
- `session-based` - Session-aware ingestion for conversation-style data

## Adding a Provider

Providers implement the `BaseProvider` interface. See [docs/provider-guide.md](docs/provider-guide.md) for the complete guide.

### Quick Example

1. Create `providers/<name>/manifest.json`:

```json
{
  "manifest_version": "1",
  "provider": { "name": "my-provider", "type": "hybrid", "version": "1.0.0" },
  "capabilities": {
    "core_operations": { "add_memory": true, "retrieve_memory": true, "delete_memory": true },
    "optional_operations": { "update_memory": false, "list_memories": false },
    "system_flags": { "async_indexing": false }
  },
  "conformance_tests": { "expected_behavior": { "convergence_wait_ms": 0 } }
}
```

2. Create `providers/<name>/index.ts`:

```typescript
import type { BaseProvider } from "../../types/provider";

export default {
  name: "my-provider",
  async add_memory(scope, content) { /* ... */ },
  async retrieve_memory(scope, query, limit) { /* ... */ },
  async delete_memory(scope, id) { /* ... */ }
} satisfies BaseProvider;
```

## LLM Judge Configuration

Benchmarks using `llm-as-judge` evaluation require an LLM backend. Configure via environment variables:

```bash
# Backend selection (default: anthropic-vertex)
export MEMORYBENCH_JUDGE_BACKEND=anthropic-vertex

# Model override (optional)
export MEMORYBENCH_JUDGE_MODEL=claude-sonnet-4-20250514
```

**Supported Backends:**

| Backend | Auth Required | Models |
|---------|--------------|--------|
| `anthropic-vertex` | gcloud auth | Claude via Vertex AI (default) |
| `google-vertex` | gcloud auth | Gemini via Vertex AI |
| `anthropic` | ANTHROPIC_API_KEY | Claude via Anthropic API |
| `openai` | OPENAI_API_KEY | GPT models |
| `google` | GOOGLE_API_KEY | Gemini via Google API |

See [docs/llm-judge-configuration.md](docs/llm-judge-configuration.md) for detailed configuration.

## Checkpoint and Resume

Long-running evaluations automatically checkpoint progress after each case:

```bash
# Start a run (automatically checkpoints to runs/<run_id>/checkpoint.json)
bun run index.ts eval --providers Supermemory --benchmarks LongMemEval

# Resume an interrupted run
bun run index.ts eval --resume run_1766388833350_hpq76ud
```

**Features:**
- Completed cases are skipped on resume
- Transient errors (HTTP 429, 5xx) automatically retry with exponential backoff
- Checkpoint is written atomically after each case

## Results Explorer

Browse results interactively with the built-in explorer:

```bash
# Launch explorer for a specific run
bun run index.ts explore --run run_1766388833350_hpq76ud --port 3000
```

**Features:**
- Dashboard with stats (pass rate, avg duration, provider count)
- Filter by provider, benchmark, status
- Sortable results table with pagination
- Detail panel for individual cases

## Documentation

| Document | Description |
|----------|-------------|
| [docs/v0.1_scope.md](docs/v0.1_scope.md) | v0.1 Definition of Done and scope |
| [docs/output-format.md](docs/output-format.md) | Results file schemas (run_manifest.json, results.jsonl, metrics_summary.json) |
| [docs/provider-scoping.md](docs/provider-scoping.md) | How providers map ScopeContext to isolation |
| [docs/provider-guide.md](docs/provider-guide.md) | Complete guide to adding a provider |
| [docs/benchmark-guide.md](docs/benchmark-guide.md) | Complete guide to adding a benchmark |
| [docs/llm-judge-configuration.md](docs/llm-judge-configuration.md) | LLM judge backend configuration |
