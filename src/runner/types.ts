/**
 * Unified Runner Types
 *
 * These interfaces define the types for the runner implementation.
 * Copied from specs/007-unified-runner/contracts/runner.ts per implementation plan.
 *
 * @module src/runner/types
 * @see specs/007-unified-runner/data-model.md
 */

import type { CaseResult, CaseStatus, ErrorInfo } from "../types/benchmark";
import type { ScopeContext } from "../types/core";

// =============================================================================
// Input Types - CLI Parsing
// =============================================================================

/**
 * Parsed provider and benchmark selections from CLI arguments.
 */
export interface RunSelection {
	/** List of provider names to evaluate */
	readonly providers: string[];

	/** List of benchmark names to run */
	readonly benchmarks: string[];

	/** Max parallel case executions (default: 1 = sequential) */
	readonly concurrency: number;
}

// =============================================================================
// Run Plan Types - Matrix Expansion and Gating
// =============================================================================

/**
 * Why a provider/benchmark combination was skipped.
 */
export interface SkipReason {
	/** Provider that was skipped */
	readonly provider_name: string;

	/** Benchmark that couldn't run */
	readonly benchmark_name: string;

	/** Capabilities the provider lacks */
	readonly missing_capabilities: readonly string[];

	/** Human-readable explanation */
	readonly message: string;
}

/**
 * Single provider/benchmark combination in the run plan.
 */
export interface RunPlanEntry {
	/** Provider identifier */
	readonly provider_name: string;

	/** Benchmark identifier */
	readonly benchmark_name: string;

	/** Whether the combo can run */
	readonly eligible: boolean;

	/** Present if eligible=false */
	readonly skip_reason?: SkipReason;
}

/**
 * The expanded matrix of all provider/benchmark combinations.
 */
export interface RunPlan {
	/** Unique identifier for this run */
	readonly run_id: string;

	/** ISO 8601 timestamp */
	readonly timestamp: string;

	/** All combinations */
	readonly entries: readonly RunPlanEntry[];

	/** Count of runnable combos */
	readonly eligible_count: number;

	/** Count of skipped combos */
	readonly skipped_count: number;
}

// =============================================================================
// Execution Types - Timing and Results
// =============================================================================

/**
 * Timing data for a single provider operation.
 */
export interface OperationTiming {
	/** Operation name (add_memory, retrieve_memory, delete_memory) */
	readonly operation: string;

	/** Execution time in milliseconds */
	readonly duration_ms: number;

	/** When the operation started */
	readonly timestamp: string;
}

/**
 * Result of executing a single benchmark case.
 * Extends the base CaseResult with provider/benchmark context and timing.
 */
export interface RunCaseResult {
	/** Which provider was tested */
	readonly provider_name: string;

	/** Which benchmark was run */
	readonly benchmark_name: string;

	/** The specific case identifier */
	readonly case_id: string;

	/** Execution outcome */
	readonly status: CaseStatus;

	/** Metric name-value pairs */
	readonly scores: Record<string, number>;

	/** Total case execution time in milliseconds */
	readonly duration_ms: number;

	/** Per-operation timing breakdown */
	readonly operation_timings?: readonly OperationTiming[];

	/** Error details if status is 'error' */
	readonly error?: ErrorInfo;

	/** Debug information */
	readonly artifacts?: Record<string, unknown>;
}

// =============================================================================
// Output Types - Run Results
// =============================================================================

/**
 * Summary statistics for a run.
 */
export interface RunSummary {
	/** Total cases attempted */
	readonly total_cases: number;

	/** Cases with status=pass */
	readonly passed: number;

	/** Cases with status=fail */
	readonly failed: number;

	/** Cases with status=skip */
	readonly skipped: number;

	/** Cases with status=error */
	readonly errors: number;

	/** Provider/benchmark combos skipped due to capability mismatch */
	readonly skipped_combos: number;

	/** Wall-clock run duration in milliseconds */
	readonly total_duration_ms: number;
}

/**
 * Aggregated output from a complete run.
 */
export interface RunOutput {
	/** Unique run identifier */
	readonly run_id: string;

	/** Run start time (ISO 8601) */
	readonly timestamp: string;

	/** What was requested */
	readonly selections: RunSelection;

	/** The execution plan */
	readonly plan: RunPlan;

	/** Case-level results */
	readonly results: readonly RunCaseResult[];

	/** Aggregated statistics */
	readonly summary: RunSummary;
}

// =============================================================================
// Runner Interface - Core Contract
// =============================================================================

/**
 * Configuration for the runner.
 */
export interface RunnerConfig {
	/** Base directory for benchmark discovery */
	readonly benchmarksDir?: string;

	/** Base directory for provider discovery */
	readonly providersDir?: string;

	/** Enable verbose logging */
	readonly verbose?: boolean;
}

/**
 * The unified runner interface.
 */
export interface Runner {
	/**
	 * Build a run plan from selections.
	 * Validates selections exist and performs capability gating.
	 *
	 * @param selection - Parsed CLI arguments
	 * @returns Run plan with eligible and skipped entries
	 * @throws Error if providers or benchmarks don't exist
	 */
	buildRunPlan(selection: RunSelection): Promise<RunPlan>;

	/**
	 * Execute a run plan.
	 *
	 * @param plan - Previously built run plan
	 * @returns Complete run output with results and summary
	 */
	executeRunPlan(plan: RunPlan): Promise<RunOutput>;

	/**
	 * Convenience method: build plan and execute in one call.
	 *
	 * @param selection - Parsed CLI arguments
	 * @returns Complete run output
	 */
	run(selection: RunSelection): Promise<RunOutput>;
}

// =============================================================================
// Timing Wrapper - Helper Types
// =============================================================================

/**
 * Result of a timed operation.
 */
export interface TimedResult<T> {
	/** The operation result */
	readonly result: T;

	/** Timing information */
	readonly timing: OperationTiming;
}

/**
 * Function signature for timing wrapper.
 */
export type TimedFn = <T>(
	operation: string,
	fn: () => Promise<T>,
) => Promise<TimedResult<T>>;
