/**
 * Result Types for Benchmark Runs
 *
 * This file defines the data structures for benchmark run manifests
 * and individual test results, enabling the dashboard to display
 * and compare benchmark outcomes.
 *
 * @module types/results
 */

import type { ProviderCapabilities } from "./core";

// =============================================================================
// Run Manifest - Metadata about a benchmark run
// =============================================================================

/**
 * Represents metadata about a benchmark run session.
 * Created at the start of a run and updated with final status.
 */
export interface RunManifest {
	/** Unique identifier for this run */
	run_id: string;

	/** ISO 8601 timestamp when the run started */
	started_at: string;

	/** ISO 8601 timestamp when the run completed (null if still running) */
	completed_at: string | null;

	/** Overall run status */
	status: "running" | "completed" | "failed" | "cancelled";

	/** Runtime environment information */
	environment: {
		/** Platform (e.g., "linux", "darwin", "win32") */
		platform: string;
		/** Runtime version (e.g., "bun 1.3.5") */
		runtime: string;
		/** Node/Bun version */
		version: string;
	};

	/** Providers included in this run */
	providers: RunProviderInfo[];

	/** Benchmarks included in this run */
	benchmarks: RunBenchmarkInfo[];

	/** Summary statistics (updated after completion) */
	summary: RunSummary | null;
}

/**
 * Provider information recorded in run manifest.
 */
export interface RunProviderInfo {
	/** Provider name (matches manifest.provider.name) */
	name: string;
	/** Provider version from manifest */
	version: string;
	/** Provider type from manifest */
	type: string;
	/** Provider capabilities snapshot */
	capabilities: ProviderCapabilities;
}

/**
 * Benchmark information recorded in run manifest.
 */
export interface RunBenchmarkInfo {
	/** Benchmark name (e.g., "RAG-template-benchmark") */
	name: string;
	/** Number of test items in this benchmark */
	item_count: number;
}

/**
 * Summary statistics for a completed run.
 */
export interface RunSummary {
	/** Total number of test items across all benchmarks */
	total_items: number;
	/** Number of passed tests */
	passed: number;
	/** Number of failed tests */
	failed: number;
	/** Number of skipped tests */
	skipped: number;
	/** Number of errored tests (execution failure, not assertion failure) */
	errored: number;
	/** Total execution time in milliseconds */
	duration_ms: number;
}

// =============================================================================
// Benchmark Results - Individual test outcomes
// =============================================================================

/**
 * Status of an individual benchmark test item.
 */
export type TestStatus = "passed" | "failed" | "skipped" | "errored";

/**
 * Result of a single benchmark test item.
 */
export interface BenchmarkResult {
	/** Unique identifier for this result */
	result_id: string;

	/** Reference to the run this result belongs to */
	run_id: string;

	/** Provider that was tested */
	provider: string;

	/** Benchmark this result belongs to */
	benchmark: string;

	/** Test item identifier within the benchmark */
	item_id: string;

	/** Test status */
	status: TestStatus;

	/** ISO 8601 timestamp when this test started */
	started_at: string;

	/** ISO 8601 timestamp when this test completed */
	completed_at: string;

	/** Execution duration in milliseconds */
	duration_ms: number;

	/** Metrics collected during the test */
	metrics: BenchmarkMetrics;

	/** Error information if status is "failed" or "errored" */
	error?: BenchmarkError;

	/** The query/question that was tested */
	query: string;

	/** Expected answer/result */
	expected: string;

	/** Actual result from the provider */
	actual: string | null;

	/** Retrieved context/documents used for the answer */
	retrieved_context?: string[];
}

/**
 * Metrics collected during a benchmark test.
 */
export interface BenchmarkMetrics {
	/** Number of memory items retrieved */
	retrieval_count: number;

	/** Average relevance score of retrieved items (0-1) */
	avg_relevance_score: number;

	/** Time spent on retrieval in milliseconds */
	retrieval_latency_ms: number;

	/** Time spent on answer generation in milliseconds (if applicable) */
	generation_latency_ms?: number;

	/** Token count for the query */
	query_tokens?: number;

	/** Token count for the response */
	response_tokens?: number;

	/** Precision at k (if applicable) */
	precision_at_k?: number;

	/** Recall (if applicable) */
	recall?: number;

	/** F1 score (if applicable) */
	f1_score?: number;

	/** Exact match (1 if exact, 0 otherwise) */
	exact_match?: number;

	/** Semantic similarity score (0-1) */
	semantic_similarity?: number;
}

/**
 * Error information for failed/errored tests.
 */
export interface BenchmarkError {
	/** Error type/code */
	code: string;

	/** Human-readable error message */
	message: string;

	/** Stack trace (if available) */
	stack?: string;

	/** Additional context about the error */
	context?: Record<string, unknown>;
}

// =============================================================================
// Aggregated Results - For dashboard display
// =============================================================================

/**
 * Aggregated results for a provider on a specific benchmark.
 */
export interface ProviderBenchmarkSummary {
	/** Provider name */
	provider: string;

	/** Benchmark name */
	benchmark: string;

	/** Number of tests passed */
	passed: number;

	/** Number of tests failed */
	failed: number;

	/** Number of tests skipped */
	skipped: number;

	/** Number of tests errored */
	errored: number;

	/** Total number of tests */
	total: number;

	/** Pass rate (0-100) */
	pass_rate: number;

	/** Average retrieval latency in ms */
	avg_retrieval_latency_ms: number;

	/** Average relevance score (0-1) */
	avg_relevance_score: number;

	/** Average F1 score (if applicable) */
	avg_f1_score?: number;

	/** Average exact match rate (0-1) */
	avg_exact_match?: number;

	/** Total execution time in ms */
	total_duration_ms: number;
}

/**
 * Complete dashboard data structure.
 */
export interface DashboardData {
	/** Run manifest with metadata */
	manifest: RunManifest;

	/** Individual test results */
	results: BenchmarkResult[];

	/** Aggregated summaries by provider and benchmark */
	summaries: ProviderBenchmarkSummary[];
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Type guard to check if a value is a valid TestStatus.
 */
export function isTestStatus(value: unknown): value is TestStatus {
	return (
		typeof value === "string" &&
		["passed", "failed", "skipped", "errored"].includes(value)
	);
}

/**
 * Type guard to check if an object is a valid BenchmarkResult.
 */
export function isBenchmarkResult(obj: unknown): obj is BenchmarkResult {
	if (typeof obj !== "object" || obj === null) return false;
	const r = obj as Record<string, unknown>;
	return (
		typeof r.result_id === "string" &&
		typeof r.run_id === "string" &&
		typeof r.provider === "string" &&
		typeof r.benchmark === "string" &&
		typeof r.item_id === "string" &&
		isTestStatus(r.status)
	);
}
