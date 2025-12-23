# Adding a Benchmark

This guide walks you through adding a new benchmark to MemoryBench. Benchmarks are **data-driven**, meaning they're defined entirely via configuration files (manifest.json + data files) without custom code.

**Time estimate:** ~10 minutes for a simple benchmark

## Prerequisites

- Bun runtime installed
- A dataset in JSON or JSONL format
- Understanding of your dataset's structure (fields for questions, answers, context)

## Directory Structure

Create the following structure:

```
benchmarks/
└── my-benchmark/
    ├── manifest.json           # Benchmark configuration
    ├── data.jsonl              # Your dataset
    └── type_instructions.json  # (Optional) LLM judge instructions
```

## Step 1: Prepare Your Data

Your data file should contain cases with:
- **Content to ingest** (context/memories)
- **Questions to ask**
- **Expected answers**

### Simple Format (data.jsonl)

```json
{"id": "case_001", "content": "The sky is blue because of Rayleigh scattering.", "question": "Why is the sky blue?", "answer": "Rayleigh scattering"}
{"id": "case_002", "content": "Water freezes at 0°C or 32°F.", "question": "At what temperature does water freeze?", "answer": "0°C or 32°F"}
```

### Session-Based Format (for conversation data)

```json
{
  "id": "conv_001",
  "sessions": [
    [{"role": "user", "content": "Hi, I'm Alex"}, {"role": "assistant", "content": "Hello Alex!"}],
    [{"role": "user", "content": "I love hiking"}, {"role": "assistant", "content": "That's great!"}]
  ],
  "question": "What is the user's name?",
  "answer": "Alex"
}
```

## Step 2: Create the Manifest

The manifest configures how to ingest data, run queries, and evaluate results.

### Simple Benchmark

For straightforward content + question + answer datasets:

```json
{
  "manifest_version": "1",
  "name": "my-benchmark",
  "version": "1.0.0",
  "description": "My custom memory benchmark",
  "data_file": "data.jsonl",
  "ingestion": {
    "strategy": "simple",
    "content_field": "content"
  },
  "query": {
    "question_field": "question",
    "expected_answer_field": "answer",
    "retrieval_limit": 10
  },
  "evaluation": {
    "protocol": "exact-match"
  },
  "metrics": ["correctness"],
  "required_capabilities": ["add_memory", "retrieve_memory"]
}
```

### Session-Based Benchmark

For conversation-style data with multiple sessions:

```json
{
  "manifest_version": "1",
  "name": "my-conversation-benchmark",
  "version": "1.0.0",
  "description": "Conversation memory benchmark",
  "data_file": "conversations.json",
  "ingestion": {
    "strategy": "session-based",
    "sessions_field": "sessions",
    "mode": "full",
    "content_formatter": "conversation"
  },
  "query": {
    "question_field": "question",
    "expected_answer_field": "answer",
    "retrieval_limit": 10
  },
  "evaluation": {
    "protocol": "llm-as-judge",
    "type_field": "question_type",
    "type_instructions_file": "type_instructions.json"
  },
  "metrics": ["correctness", "faithfulness", "retrieval_precision", "retrieval_recall", "retrieval_f1"],
  "required_capabilities": ["add_memory", "retrieve_memory"]
}
```

## Manifest Reference

### Core Fields

| Field | Required | Description |
|-------|----------|-------------|
| `manifest_version` | Yes | Always `"1"` |
| `name` | Yes | Unique benchmark identifier |
| `version` | Yes | Semantic version (e.g., "1.0.0") |
| `description` | No | Human-readable description |
| `source` | No | Reference URL (paper, repo) |
| `data_file` | Yes | Path to data file (relative to manifest) |
| `ingestion` | Yes | How to load content into memory |
| `query` | Yes | How to form queries |
| `evaluation` | Yes | How to score results |
| `metrics` | Yes | List of metrics to calculate |
| `required_capabilities` | Yes | Provider capabilities needed |

### Ingestion Strategies

#### Simple Ingestion

Direct content ingestion from a field:

```json
{
  "strategy": "simple",
  "content_field": "content",
  "is_array": false,
  "metadata_fields": ["source", "timestamp"]
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `content_field` | Required | Field containing content to ingest |
| `is_array` | `false` | Set `true` if content_field is an array |
| `metadata_fields` | `[]` | Additional fields to include as metadata |

#### Session-Based Ingestion

For conversation data with sessions:

```json
{
  "strategy": "session-based",
  "sessions_field": "sessions",
  "session_ids_field": "session_ids",
  "dates_field": "dates",
  "mode": "full",
  "content_formatter": "conversation"
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `sessions_field` | Required | Field containing session array/object |
| `sessions_format` | `"array"` | `"array"` or `"dynamic_keys"` (for session_1, session_2...) |
| `mode` | `"full"` | `"lazy"` (dev), `"shared"` (demo), `"full"` (production) |
| `content_formatter` | `"conversation"` | How to format session content |

#### Add-Delete-Verify Ingestion

For testing deletion semantics:

```json
{
  "strategy": "add-delete-verify",
  "add_content_field": "content",
  "delete_target_field": "delete_id",
  "verify_query_field": "verify_query",
  "phase_delay_ms": 100
}
```

### Evaluation Protocols

#### Exact Match

Simple string comparison:

```json
{
  "protocol": "exact-match",
  "case_sensitive": false,
  "normalize_whitespace": true
}
```

#### LLM-as-Judge

Semantic evaluation using an LLM:

```json
{
  "protocol": "llm-as-judge",
  "type_field": "question_type",
  "type_instructions_file": "type_instructions.json"
}
```

The `type_instructions.json` provides specific grading criteria by question type:

```json
{
  "factual": "Grade correctness of factual recall. Score 1.0 if the answer contains the key fact, 0.0 otherwise.",
  "temporal": "Grade temporal reasoning. Score 1.0 if dates/order are correct, 0.5 for partial, 0.0 for wrong.",
  "inference": "Grade logical inference. Score based on reasoning quality from 0.0 to 1.0."
}
```

#### Deletion Check

Verify deleted content doesn't leak:

```json
{
  "protocol": "deletion-check",
  "verification_query_field": "verify_query",
  "deleted_content_field": "deleted_content",
  "fuzzy_match": false
}
```

### Available Metrics

| Metric | Description | Evaluation Protocol |
|--------|-------------|---------------------|
| `correctness` | Answer accuracy | Any |
| `faithfulness` | Answer grounded in retrieved content | llm-as-judge |
| `retrieval_precision` | Relevant items / retrieved items | Any |
| `retrieval_recall` | Retrieved relevant / total relevant | Any |
| `retrieval_f1` | Harmonic mean of precision/recall | Any |
| `retrieval_coverage` | % of gold items retrieved | Any |
| `retrieval_ndcg` | Normalized DCG (ranking quality) | Any |
| `retrieval_map` | Mean average precision | Any |

### Required Capabilities

Declare what provider operations your benchmark needs:

| Capability | Use Case |
|------------|----------|
| `add_memory` | Ingesting content (required for all) |
| `retrieve_memory` | Querying memories (required for all) |
| `delete_memory` | Testing deletion semantics |
| `update_memory` | Testing update behavior |

## Step 3: Test Your Benchmark

1. **Verify benchmark loads:**

```bash
bun run index.ts list benchmarks
```

Your benchmark should appear in the list.

2. **Run against LocalBaseline:**

```bash
bun run index.ts eval --providers LocalBaseline --benchmarks my-benchmark
```

3. **Check results:**

```bash
bun run index.ts explore --run <run_id> --port 3000
```

## Data Transformation: Flatten

Some datasets have nested arrays (e.g., multiple QA pairs per item). Use `flatten` to expand these:

```json
{
  "flatten": {
    "field": "qa_pairs",
    "max_items": 5,
    "promote_fields": ["question", "answer", "difficulty"]
  },
  ...
}
```

**Before flatten:**
```json
{"id": "1", "context": "...", "qa_pairs": [{"question": "Q1", "answer": "A1"}, {"question": "Q2", "answer": "A2"}]}
```

**After flatten (2 cases):**
```json
{"id": "1_0", "context": "...", "question": "Q1", "answer": "A1"}
{"id": "1_1", "context": "...", "question": "Q2", "answer": "A2"}
```

## Real-World Examples

Study these benchmarks for reference:

| Benchmark | Source | Ingestion | Evaluation |
|-----------|--------|-----------|------------|
| RAG-template-benchmark | Template | simple | exact-match |
| LongMemEval | [Paper](https://arxiv.org/abs/2410.10813) | session-based (array) | llm-as-judge |
| LoCoMo | [Paper](https://arxiv.org/abs/2402.17753) | session-based (dynamic_keys) + flatten | llm-as-judge |

## Troubleshooting

### "Benchmark not found"

1. Check manifest.json is valid JSON (no trailing commas)
2. Check `name` field matches your expectation
3. Run `bun run index.ts list benchmarks` to see loaded benchmarks

### "Data file not found"

1. Verify `data_file` path is relative to manifest.json location
2. Check file extension matches actual format (.json vs .jsonl)

### "All cases fail evaluation"

1. Check field names match your data (question_field, answer_field, etc.)
2. For session-based, verify sessions_field contains actual session data
3. Use LocalBaseline first to rule out provider issues

### "Low retrieval scores"

1. Check content is being ingested (logs show add_memory calls)
2. Increase `retrieval_limit` in query config
3. Verify content is searchable (not empty/minimal)

### "LLM judge errors"

1. Verify LLM backend is configured (see [llm-judge-configuration.md](llm-judge-configuration.md))
2. Check type_instructions_file exists if specified
3. Review error messages in artifacts field of results
