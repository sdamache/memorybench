/**
 * Results Schema Types
 *
 * Type definitions for the results writer module.
 * Defines the contract for run manifests, result records, and metrics summaries.
 *
 * @module src/results/schema
 */

import type { RunCaseResult, RunSelection } from "../runner/types";
import type { RunPerformanceMetrics, TimingStats, TokenStats } from "../metrics/performance";

// =============================================================================
// Run Manifest Types
// =============================================================================

/**
 * Provider metadata for run manifest.
 */
export interface ProviderInfo {
	readonly name: string;
	readonly version: string;
	readonly manifest_hash: string;
}

/**
 * Benchmark metadata for run manifest.
 */
export interface BenchmarkInfo {
	readonly name: string;
	readonly version: string;
	readonly case_count: number;
}

/**
 * Environment information for reproducibility.
 */
export interface EnvironmentInfo {
	readonly runtime: string;
	readonly runtime_version: string;
	readonly os: string;
	readonly os_version: string;
	readonly platform: string;
}

/**
 * Complete run configuration snapshot.
 * Written once at run start for reproducibility.
 */
export interface RunManifest {
	/** Schema version for future migrations */
	readonly version: 1;

	/** Unique run identifier */
	readonly run_id: string;

	/** ISO 8601 timestamp when run started */
	readonly timestamp: string;

	/** Git commit hash if available */
	readonly git_commit?: string;

	/** Git branch name if available */
	readonly git_branch?: string;

	/** CLI selections */
	readonly selections: RunSelection;

	/** Provider metadata */
	readonly providers: readonly ProviderInfo[];

	/** Benchmark metadata */
	readonly benchmarks: readonly BenchmarkInfo[];

	/** Environment information */
	readonly environment: EnvironmentInfo;

	/** Original CLI arguments */
	readonly cli_args: readonly string[];
}

// =============================================================================
// Result Record Types
// =============================================================================

/**
 * Single case result for JSONL output.
 * Extends RunCaseResult with run_id for standalone parsing.
 */
export interface ResultRecord extends RunCaseResult {
	/** Run this result belongs to */
	readonly run_id: string;
}

// =============================================================================
// Metrics Summary Types
// =============================================================================

/**
 * Counts breakdown by status.
 */
export interface StatusCounts {
	readonly cases: number;
	readonly passed: number;
	readonly failed: number;
	readonly skipped: number;
	readonly errors: number;
}

/**
 * Aggregated stats for a provider×benchmark combination.
 */
export interface CombinationSummary {
	readonly provider_name: string;
	readonly benchmark_name: string;
	readonly counts: StatusCounts;
	readonly duration_ms: number;
	/** Average of each score across all cases */
	readonly score_averages: Record<string, number>;
	/** Latency statistics for this combination (optional, added in v1.1) */
	readonly latency_stats?: TimingStats;
	/** Token usage for this combination (optional, added in v1.1) */
	readonly token_stats?: TokenStats;
}

/**
 * Complete run summary with aggregated statistics.
 */
export interface MetricsSummary {
	/** Schema version */
	readonly version: 1;

	/** Run this summary belongs to */
	readonly run_id: string;

	/** When summary was generated */
	readonly generated_at: string;

	/** Overall counts */
	readonly totals: StatusCounts & { readonly duration_ms: number };

	/** Per provider×benchmark breakdown */
	readonly by_combination: readonly CombinationSummary[];

	/** Run-level performance metrics (optional, added in v1.1) */
	readonly performance?: RunPerformanceMetrics;
}

// =============================================================================
// Writer Interface
// =============================================================================

/**
 * Results writer for persisting run outputs.
 */
export interface ResultsWriter {
	/**
	 * Write run manifest at start of run.
	 * Must be called before any results are appended.
	 *
	 * @param manifest - Complete run configuration
	 */
	writeManifest(manifest: RunManifest): Promise<void>;

	/**
	 * Append a single result to JSONL file.
	 * Called after each case completes.
	 *
	 * @param result - Case result with run context
	 */
	appendResult(result: ResultRecord): Promise<void>;

	/**
	 * Write metrics summary at end of run.
	 * Called after all cases complete.
	 *
	 * @param summary - Aggregated statistics
	 */
	writeSummary(summary: MetricsSummary): Promise<void>;

	/**
	 * Close writer and release resources.
	 * Must be called at end of run.
	 */
	close(): Promise<void>;

	/**
	 * Get the run directory path.
	 */
	readonly runDir: string;
}

/**
 * Factory function to create a results writer.
 *
 * @param runId - Unique run identifier
 * @param baseDir - Base directory for runs (default: "runs")
 * @returns Configured results writer
 */
export type CreateResultsWriter = (
	runId: string,
	baseDir?: string,
) => Promise<ResultsWriter>;
