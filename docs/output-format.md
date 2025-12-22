# Results Output Format

The benchmark runner produces three output files in the `runs/{run_id}/` directory for each execution:

1. **run_manifest.json** - Run metadata and configuration (written once at start)
2. **results.jsonl** - Per-case results (appended incrementally)
3. **metrics_summary.json** - Aggregated metrics (written at completion)

All files use `version: 1` schema versioning for forward compatibility.

---

## 1. Run Manifest (`run_manifest.json`)

Written once at the beginning of a run, before any test cases execute. Contains complete metadata for reproducibility.

### Schema

```typescript
interface RunManifest {
  readonly version: 1;
  readonly run_id: string;
  readonly timestamp: string;
  readonly git_commit?: string;
  readonly git_branch?: string;
  readonly selections: RunSelection;
  readonly providers: readonly ProviderInfo[];
  readonly benchmarks: readonly BenchmarkInfo[];
  readonly environment: EnvironmentInfo;
  readonly cli_args: readonly string[];
}

interface RunSelection {
  readonly providers: readonly string[];
  readonly benchmarks: readonly string[];
  readonly concurrency: number;
}

interface ProviderInfo {
  readonly name: string;
  readonly version: string;
  readonly manifest_hash: string;
}

interface BenchmarkInfo {
  readonly name: string;
  readonly version: string;
  readonly case_count: number;
}

interface EnvironmentInfo {
  readonly runtime: string;
  readonly runtime_version: string;
  readonly os: string;
  readonly os_version: string;
  readonly platform: string;
}
```

### Field Descriptions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `1` | Yes | Schema version (always 1) |
| `run_id` | `string` | Yes | Unique run identifier (format: `run_{timestamp}_{random}`) |
| `timestamp` | `string` | Yes | ISO 8601 timestamp when run started |
| `git_commit` | `string` | No | Git commit SHA (40 chars) if available |
| `git_branch` | `string` | No | Git branch name if available |
| `selections.providers` | `string[]` | Yes | Selected provider names |
| `selections.benchmarks` | `string[]` | Yes | Selected benchmark names |
| `selections.concurrency` | `number` | Yes | Concurrency level (1 = sequential) |
| `providers[].name` | `string` | Yes | Provider name |
| `providers[].version` | `string` | Yes | Provider version from manifest |
| `providers[].manifest_hash` | `string` | Yes | SHA-256 hash of canonical provider manifest |
| `benchmarks[].name` | `string` | Yes | Benchmark name |
| `benchmarks[].version` | `string` | Yes | Benchmark version |
| `benchmarks[].case_count` | `number` | Yes | Total number of test cases in benchmark |
| `environment.runtime` | `string` | Yes | Runtime name (e.g., "bun", "node") |
| `environment.runtime_version` | `string` | Yes | Runtime version (e.g., "1.3.5") |
| `environment.os` | `string` | Yes | Operating system (e.g., "darwin", "linux") |
| `environment.os_version` | `string` | Yes | OS version string |
| `environment.platform` | `string` | Yes | CPU architecture (e.g., "arm64", "x64") |
| `cli_args` | `string[]` | Yes | Complete CLI arguments used to invoke the run |

### Example

```json
{
  "version": 1,
  "run_id": "run_1766388833350_hpq76ud",
  "timestamp": "2025-12-22T07:33:53.350Z",
  "git_commit": "ff05810537391f301d492a5c4761605428b6e581",
  "git_branch": "009-results-writer",
  "selections": {
    "providers": ["quickstart-test"],
    "benchmarks": ["RAG-template-benchmark"],
    "concurrency": 1
  },
  "providers": [
    {
      "name": "quickstart-test",
      "version": "1.0.0",
      "manifest_hash": "0e7a8d7add45784cd8ce0e373a9e4ace32371a81668b9142857dfbce1ebc55f8"
    }
  ],
  "benchmarks": [
    {
      "name": "RAG-template-benchmark",
      "version": "1.0.0",
      "case_count": 3
    }
  ],
  "environment": {
    "runtime": "bun",
    "runtime_version": "1.3.5",
    "os": "darwin",
    "os_version": "24.6.0",
    "platform": "arm64"
  },
  "cli_args": [
    "eval",
    "--providers",
    "quickstart-test",
    "--benchmarks",
    "RAG-template-benchmark",
    "--concurrency",
    "1"
  ]
}
```

---

## 2. Results JSONL (`results.jsonl`)

Newline-delimited JSON file with one result record per line. Records are appended **immediately** after each test case completes, providing durability even if the run is interrupted.

### Schema

```typescript
interface ResultRecord {
  readonly run_id: string;
  readonly provider_name: string;
  readonly benchmark_name: string;
  readonly case_id: string;
  readonly status: "pass" | "fail" | "skip" | "error";
  readonly scores: Record<string, number>;
  readonly duration_ms: number;
  readonly artifacts?: Record<string, unknown>;
  readonly error?: {
    readonly message: string;
    readonly type?: string;
    readonly stack?: string;
  };
}
```

### Field Descriptions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `run_id` | `string` | Yes | Links to run_manifest.json run_id |
| `provider_name` | `string` | Yes | Provider that executed this case |
| `benchmark_name` | `string` | Yes | Benchmark this case belongs to |
| `case_id` | `string` | Yes | Unique test case identifier within benchmark |
| `status` | `enum` | Yes | One of: `"pass"`, `"fail"`, `"skip"`, `"error"` |
| `scores` | `object` | Yes | Benchmark-specific metrics (may be empty `{}`) |
| `duration_ms` | `number` | Yes | Execution time in milliseconds |
| `artifacts` | `object` | No | Optional execution artifacts (generated text, counts, etc.) |
| `error.message` | `string` | No | Error message if status is `"error"` |
| `error.type` | `string` | No | Error type/class name |
| `error.stack` | `string` | No | Stack trace |

### Example Records

**Passing case:**
```json
{"run_id":"run_1766388833350_hpq76ud","provider_name":"quickstart-test","benchmark_name":"LongMemEval","case_id":"e47becba","status":"pass","scores":{"correctness":0.95,"faithfulness":0.92,"retrieval_precision":0.88,"retrieval_recall":0.91,"retrieval_f1":0.89},"duration_ms":1740,"artifacts":{"generatedAnswer":"The answer is 42","ingestedCount":53,"retrievedCount":5}}
```

**Failing case:**
```json
{"run_id":"run_1766388833350_hpq76ud","provider_name":"quickstart-test","benchmark_name":"RAG-template-benchmark","case_id":"rag_001","status":"fail","scores":{"precision":0,"retrieval_count":0,"top_score":0},"duration_ms":103}
```

**Failing case with error details in artifacts:**
```json
{"run_id":"run_1766388833350_hpq76ud","provider_name":"quickstart-test","benchmark_name":"LongMemEval","case_id":"118b2229","status":"fail","scores":{"correctness":0,"faithfulness":0,"retrieval_precision":0,"retrieval_recall":0,"retrieval_f1":0},"duration_ms":200,"artifacts":{"generatedAnswer":"I don't have enough information to answer this question.","reasoning":"Judge error: 404 {\"error\":{\"code\":404,\"message\":\"Publisher Model not found.\",\"status\":\"NOT_FOUND\"}}","ingestedCount":45,"retrievedCount":0}}
```

**Error case (execution failed):**
```json
{"run_id":"run_1766388833350_hpq76ud","provider_name":"quickstart-test","benchmark_name":"LongMemEval","case_id":"118b2229","status":"error","scores":{},"duration_ms":50,"error":{"message":"Provider initialization failed: Database connection timeout","type":"ConnectionError"}}
```

### Processing JSONL Files

**Reading all results:**
```typescript
import { readFile } from "node:fs/promises";

const lines = (await readFile("runs/run_xxx/results.jsonl", "utf-8"))
  .trim()
  .split("\n");

const results = lines.map(line => JSON.parse(line) as ResultRecord);
```

**Streaming results (for large files):**
```typescript
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

const fileStream = createReadStream("runs/run_xxx/results.jsonl");
const rl = createInterface({ input: fileStream });

for await (const line of rl) {
  const result = JSON.parse(line) as ResultRecord;
  // Process result...
}
```

---

## 3. Metrics Summary (`metrics_summary.json`)

Generated at the end of a successful run. Aggregates results by provider×benchmark combination.

### Schema

```typescript
interface MetricsSummary {
  readonly version: 1;
  readonly run_id: string;
  readonly generated_at: string;
  readonly totals: StatusCounts & { readonly duration_ms: number };
  readonly by_combination: readonly CombinationSummary[];
}

interface StatusCounts {
  readonly cases: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly errors: number;
}

interface CombinationSummary {
  readonly provider_name: string;
  readonly benchmark_name: string;
  readonly counts: StatusCounts;
  readonly duration_ms: number;
  readonly score_averages: Record<string, number>;
}
```

### Field Descriptions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `1` | Yes | Schema version (always 1) |
| `run_id` | `string` | Yes | Links to run_manifest.json run_id |
| `generated_at` | `string` | Yes | ISO 8601 timestamp when summary was generated |
| `totals.cases` | `number` | Yes | Total number of test cases executed |
| `totals.passed` | `number` | Yes | Number of passing cases |
| `totals.failed` | `number` | Yes | Number of failing cases |
| `totals.skipped` | `number` | Yes | Number of skipped cases |
| `totals.errors` | `number` | Yes | Number of error cases |
| `totals.duration_ms` | `number` | Yes | Total execution time in milliseconds |
| `by_combination[].provider_name` | `string` | Yes | Provider name for this combination |
| `by_combination[].benchmark_name` | `string` | Yes | Benchmark name for this combination |
| `by_combination[].counts` | `StatusCounts` | Yes | Case counts for this combination |
| `by_combination[].duration_ms` | `number` | Yes | Total duration for this combination |
| `by_combination[].score_averages` | `object` | Yes | Average scores across all cases in this combination |

### Example

```json
{
  "version": 1,
  "run_id": "run_1766388833350_hpq76ud",
  "generated_at": "2025-12-22T07:33:53.685Z",
  "totals": {
    "cases": 3,
    "passed": 0,
    "failed": 3,
    "skipped": 0,
    "errors": 0,
    "duration_ms": 306
  },
  "by_combination": [
    {
      "provider_name": "quickstart-test",
      "benchmark_name": "RAG-template-benchmark",
      "counts": {
        "cases": 3,
        "passed": 0,
        "failed": 3,
        "skipped": 0,
        "errors": 0
      },
      "duration_ms": 306,
      "score_averages": {
        "precision": 0,
        "retrieval_count": 0,
        "top_score": 0
      }
    }
  ]
}
```

---

## File Locations

All output files are written to `runs/{run_id}/`:

```
runs/
└── run_1766388833350_hpq76ud/
    ├── run_manifest.json       # Run metadata (written once at start)
    ├── results.jsonl           # Per-case results (appended incrementally)
    ├── metrics_summary.json    # Aggregated metrics (written at completion)
    └── checkpoint.json         # Checkpoint state (if checkpointing enabled)
```

## Durability Guarantees

1. **run_manifest.json**: Written atomically before any test cases execute
2. **results.jsonl**: Each line appended immediately after case completion (survives interruption)
3. **metrics_summary.json**: Only written if run completes successfully

If a run is interrupted (e.g., via Ctrl+C or crash):
- ✅ run_manifest.json will be present
- ✅ results.jsonl will contain all completed cases
- ❌ metrics_summary.json will NOT be present (can be regenerated from results.jsonl)

## Schema Versioning

All output files include a `version` field set to `1`. Future schema changes will increment this version number. Consumers should check the version field and handle unknown versions gracefully.

**Version 1 Guarantees:**
- All fields documented above are stable
- New optional fields may be added without version bump
- Removal or type changes of existing fields will require version 2
