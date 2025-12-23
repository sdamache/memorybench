# LLM Judge Configuration

MemoryBench uses LLM-as-judge evaluation for benchmarks that require semantic understanding (like LongMemEval and LoCoMo). This guide explains how to configure the LLM backend for evaluation.

## Overview

The LLM judge performs two functions:
1. **Answer Generation**: Synthesizes answers from retrieved memory context
2. **Evaluation/Judging**: Scores generated answers against expected answers

Both functions can use the same or different backends.

## Quick Start

### Using Google Cloud (Vertex AI) - Recommended

```bash
# Authenticate with Google Cloud
gcloud auth application-default login

# Set your project
export GOOGLE_CLOUD_PROJECT=your-gcp-project-id

# Run benchmark with Vertex-hosted Claude (default)
bun run index.ts eval --providers LocalBaseline --benchmarks LongMemEval
```

### Using Direct API Keys

```bash
# Anthropic API
export MEMORYBENCH_JUDGE_BACKEND=anthropic
export ANTHROPIC_API_KEY=sk-ant-api03-...

# OpenAI API
export MEMORYBENCH_JUDGE_BACKEND=openai
export OPENAI_API_KEY=sk-proj-...

bun run index.ts eval --providers LocalBaseline --benchmarks LongMemEval
```

## Supported Backends

| Backend | Default Model | Auth Method | Cost Tier |
|---------|---------------|-------------|-----------|
| `anthropic-vertex` | claude-sonnet-4 | gcloud auth | Low (Vertex pricing) |
| `google-vertex` | gemini-2.5-flash | gcloud auth | Low (Vertex pricing) |
| `anthropic` | claude-sonnet-4-20250514 | ANTHROPIC_API_KEY | Medium |
| `openai` | gpt-4o | OPENAI_API_KEY | Medium |
| `azure-openai` | (deployment name) | AZURE_OPENAI_API_KEY | Variable |
| `google` | gemini-1.5-flash | GOOGLE_API_KEY | Low |

## Environment Variables

### Backend Selection

```bash
# Select judge backend
MEMORYBENCH_JUDGE_BACKEND=anthropic-vertex  # default

# Override model
MEMORYBENCH_JUDGE_MODEL=claude-sonnet-4
```

### Separate Answer Generation

You can use a different backend for answer generation vs. evaluation:

```bash
# Use Gemini for answer generation (faster, cheaper)
MEMORYBENCH_ANSWER_BACKEND=google-vertex
MEMORYBENCH_ANSWER_MODEL=gemini-2.5-flash

# Use Claude for evaluation (more accurate)
MEMORYBENCH_JUDGE_BACKEND=anthropic-vertex
MEMORYBENCH_JUDGE_MODEL=claude-sonnet-4
```

### Google Cloud / Vertex AI

```bash
# Required for anthropic-vertex and google-vertex backends
GOOGLE_CLOUD_PROJECT=your-gcp-project-id

# Optional: override region
GOOGLE_VERTEX_LOCATION=us-central1  # for google-vertex
# Note: anthropic-vertex defaults to us-east5 (Claude availability)
```

**Setup:**
```bash
# Install gcloud CLI
brew install google-cloud-sdk  # macOS

# Authenticate
gcloud auth application-default login

# Enable APIs
gcloud services enable aiplatform.googleapis.com
```

### OpenAI

```bash
MEMORYBENCH_JUDGE_BACKEND=openai
OPENAI_API_KEY=sk-proj-...

# Optional: override model
MEMORYBENCH_JUDGE_MODEL=gpt-4o-mini  # cheaper alternative
```

### Azure OpenAI

```bash
MEMORYBENCH_JUDGE_BACKEND=azure-openai

# Required
AZURE_OPENAI_API_KEY=your-azure-key
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com

# Model is your deployment name
MEMORYBENCH_JUDGE_MODEL=gpt-4o-deployment

# Optional: API version
AZURE_OPENAI_API_VERSION=2024-10-21
```

### Anthropic Direct

```bash
MEMORYBENCH_JUDGE_BACKEND=anthropic
ANTHROPIC_API_KEY=sk-ant-api03-...

# Optional: override model
MEMORYBENCH_JUDGE_MODEL=claude-sonnet-4-20250514
```

### Google Generative AI

```bash
MEMORYBENCH_JUDGE_BACKEND=google
GOOGLE_API_KEY=AIza...

# Optional: override model
MEMORYBENCH_JUDGE_MODEL=gemini-1.5-flash
```

## Benchmark Manifest Configuration

You can also configure the judge in your benchmark manifest:

```json
{
  "evaluation": {
    "protocol": "llm-as-judge",
    "judge_backend": "anthropic-vertex",
    "project_id": "your-gcp-project",
    "region": "us-east5",
    "model": "claude-sonnet-4",
    "type_field": "question_type",
    "type_instructions_file": "type_instructions.json"
  }
}
```

Environment variables take precedence over manifest configuration.

## Type-Aware Evaluation

Benchmarks can define type-specific evaluation criteria via `type_instructions.json`:

```json
{
  "temporal-reasoning": "Evaluate temporal accuracy. Check if dates, times, and sequences are correctly identified. Score 1.0 for perfect temporal accuracy, 0.5 for partial, 0.0 for incorrect.",
  "multi-session": "Evaluate cross-session aggregation. Check if information from multiple conversations is correctly synthesized.",
  "single-session": "Evaluate single-session recall. Verify the specific fact is correctly retrieved from the indicated session.",
  "knowledge-update": "Evaluate handling of updated information. The most recent value should be used."
}
```

The judge receives these instructions based on the `type_field` in each test case.

## Cost Optimization

### Budget-Friendly Configuration

```bash
# Use Gemini Flash for both tasks (cheapest)
MEMORYBENCH_JUDGE_BACKEND=google-vertex
MEMORYBENCH_JUDGE_MODEL=gemini-2.5-flash
MEMORYBENCH_ANSWER_BACKEND=google-vertex
MEMORYBENCH_ANSWER_MODEL=gemini-2.5-flash
```

### Quality-Focused Configuration

```bash
# Use Claude for accurate evaluation
MEMORYBENCH_JUDGE_BACKEND=anthropic-vertex
MEMORYBENCH_JUDGE_MODEL=claude-sonnet-4

# Use cheaper model for answer generation
MEMORYBENCH_ANSWER_BACKEND=google-vertex
MEMORYBENCH_ANSWER_MODEL=gemini-2.5-flash
```

## Troubleshooting

### "Missing Google Cloud project for judge"

```bash
# Set the project ID
export GOOGLE_CLOUD_PROJECT=your-project-id

# Or authenticate and let gcloud set it
gcloud config set project your-project-id
```

### "ANTHROPIC_API_KEY is required"

```bash
# Either set the API key
export ANTHROPIC_API_KEY=sk-ant-...

# Or switch to a different backend
export MEMORYBENCH_JUDGE_BACKEND=google-vertex
```

### "Judge error: 404 Publisher Model not found"

The model isn't available in your region. Try:
```bash
# Switch to a different region
export GOOGLE_VERTEX_LOCATION=us-central1

# Or use a different model
export MEMORYBENCH_JUDGE_MODEL=gemini-1.5-flash
```

### "Rate limit exceeded"

1. Reduce concurrency: `--concurrency 1`
2. Switch to a backend with higher limits
3. Use different backends for answer generation and judging to spread load

### "Failed to parse judge response"

The LLM returned invalid JSON. This is logged as `judge_error: 1` in the results. The system assigns 0 scores and continues. To debug:
1. Check the `reasoning` field in results for the raw response
2. Try a different model that's better at following JSON format instructions

## .env.example

Copy `.env.example` to `.env.local` and fill in your credentials:

```bash
cp .env.example .env.local
```

The example file contains all available configuration options with documentation.
