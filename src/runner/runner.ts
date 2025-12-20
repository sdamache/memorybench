/**
 * Unified Runner Core Execution Engine
 *
 * Implements the core execution logic for running benchmarks against providers,
 * capturing timing data, handling errors, and aggregating results.
 *
 * @module src/runner/runner
 */

import type { ScopeContext } from "../types/core";
import type { CaseResult } from "../types/benchmark";
import { BenchmarkRegistry } from "../loaders/benchmarks";
import { ProviderRegistry } from "../loaders/providers";
import { buildRunPlan } from "./gating";
import { timed } from "./timing";
import type {
	RunSelection,
	RunPlan,
	RunCaseResult,
	RunOutput,
	RunSummary,
	OperationTiming,
} from "./types";

// =============================================================================
// Scope Context Creation
// =============================================================================

/**
 * Create an isolated scope context for test execution.
 * Ensures each case runs in an isolated environment to prevent cross-case interference.
 *
 * @param runId - Unique identifier for the entire run
 * @param providerName - Provider being tested
 * @param benchmarkName - Benchmark being executed
 * @param caseId - Specific case within the benchmark
 * @returns Isolated ScopeContext
 */
export function createScopeContext(
	runId: string,
	providerName: string,
	benchmarkName: string,
	caseId: string,
): ScopeContext {
	return {
		user_id: `user_${runId}`,
		run_id: runId,
		session_id: `${providerName}_${benchmarkName}_${caseId}`,
		namespace: `runner_${runId}`,
	};
}

// =============================================================================
// Case Execution
// =============================================================================

/**
 * Execute a single benchmark case with timing capture.
 * Wraps the benchmark's run_case method to capture operation-level timings.
 *
 * @param providerName - Provider to test
 * @param benchmarkName - Benchmark to run
 * @param caseId - Specific case identifier
 * @param runId - Unique run identifier
 * @returns RunCaseResult with timing data
 */
export async function executeCase(
	providerName: string,
	benchmarkName: string,
	caseId: string,
	runId: string,
): Promise<RunCaseResult> {
	const providerRegistry = await ProviderRegistry.getInstance();
	const benchmarkRegistry = BenchmarkRegistry.getInstance();

	const providerEntry = providerRegistry.getProvider(providerName);
	const benchmarkEntry = benchmarkRegistry.get(benchmarkName);

	if (!providerEntry) {
		throw new Error(`Provider '${providerName}' not found`);
	}

	if (!benchmarkEntry) {
		throw new Error(`Benchmark '${benchmarkName}' not found`);
	}

	const provider = providerEntry.providerInstance;
	const benchmark = benchmarkEntry.benchmark;

	// Find the specific case
	const allCases = Array.from(benchmark.cases());
	const benchmarkCase = allCases.find((c) => c.id === caseId);

	if (!benchmarkCase) {
		throw new Error(
			`Case '${caseId}' not found in benchmark '${benchmarkName}'`,
		);
	}

	// Create isolated scope
	const scope = createScopeContext(runId, providerName, benchmarkName, caseId);

	// Execute the case with timing capture
	const caseStart = Date.now();

	try {
		// Run the benchmark case
		const result = await benchmark.run_case(provider, scope, benchmarkCase);

		const caseEnd = Date.now();
		const duration_ms = caseEnd - caseStart;

		// Convert to RunCaseResult with provider/benchmark context
		return {
			provider_name: providerName,
			benchmark_name: benchmarkName,
			case_id: result.case_id,
			status: result.status,
			scores: result.scores,
			duration_ms,
			error: result.error,
			artifacts: result.artifacts,
		};
	} catch (error) {
		const caseEnd = Date.now();
		const duration_ms = caseEnd - caseStart;

		// Handle execution errors
		return {
			provider_name: providerName,
			benchmark_name: benchmarkName,
			case_id: caseId,
			status: "error",
			scores: {},
			duration_ms,
			error: {
				message: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
			},
		};
	}
}

/**
 * Execute all cases for a provider/benchmark combination.
 * Runs cases sequentially (concurrency support added in Phase 5).
 *
 * @param providerName - Provider to test
 * @param benchmarkName - Benchmark to run
 * @param runId - Unique run identifier
 * @param concurrency - Max parallel case executions (default: 1 = sequential)
 * @returns Array of case results
 */
export async function executeCases(
	providerName: string,
	benchmarkName: string,
	runId: string,
	concurrency: number = 1,
): Promise<RunCaseResult[]> {
	const benchmarkRegistry = BenchmarkRegistry.getInstance();
	const benchmarkEntry = benchmarkRegistry.get(benchmarkName);

	if (!benchmarkEntry) {
		throw new Error(`Benchmark '${benchmarkName}' not found`);
	}

	const benchmark = benchmarkEntry.benchmark;
	const allCases = Array.from(benchmark.cases());
	const results: RunCaseResult[] = [];

	// Phase 3: Sequential execution only (concurrency=1)
	// Phase 5 will add concurrent execution support
	if (concurrency === 1) {
		// Sequential execution
		for (const benchmarkCase of allCases) {
			const result = await executeCase(
				providerName,
				benchmarkName,
				benchmarkCase.id,
				runId,
			);
			results.push(result);
		}
	} else {
		// Concurrent execution (Phase 5 implementation placeholder)
		// For now, fall back to sequential
		for (const benchmarkCase of allCases) {
			const result = await executeCase(
				providerName,
				benchmarkName,
				benchmarkCase.id,
				runId,
			);
			results.push(result);
		}
	}

	return results;
}

// =============================================================================
// Result Aggregation
// =============================================================================

/**
 * Build summary statistics from case results.
 *
 * @param results - Array of case results
 * @param skippedCombos - Number of provider/benchmark combos skipped
 * @param totalDurationMs - Total wall-clock run duration
 * @returns Aggregated summary
 */
export function buildSummary(
	results: readonly RunCaseResult[],
	skippedCombos: number,
	totalDurationMs: number,
): RunSummary {
	const total_cases = results.length;
	const passed = results.filter((r) => r.status === "pass").length;
	const failed = results.filter((r) => r.status === "fail").length;
	const skipped = results.filter((r) => r.status === "skip").length;
	const errors = results.filter((r) => r.status === "error").length;

	return {
		total_cases,
		passed,
		failed,
		skipped,
		errors,
		skipped_combos: skippedCombos,
		total_duration_ms: totalDurationMs,
	};
}

// =============================================================================
// Run Plan Execution
// =============================================================================

/**
 * Execute a run plan by iterating through eligible entries and collecting results.
 * Skips ineligible entries and continues execution even if some cases fail.
 *
 * @param plan - Previously built run plan
 * @returns Complete run output with results and summary
 */
export async function executeRunPlan(plan: RunPlan): Promise<RunOutput> {
	const runStart = Date.now();
	const allResults: RunCaseResult[] = [];

	// Execute only eligible entries
	const eligibleEntries = plan.entries.filter((e) => e.eligible);

	for (const entry of eligibleEntries) {
		try {
			const caseResults = await executeCases(
				entry.provider_name,
				entry.benchmark_name,
				plan.run_id,
				1, // Sequential for Phase 3; Phase 5 will pass concurrency from selection
			);
			allResults.push(...caseResults);
		} catch (error) {
			// Log error but continue with other entries
			console.error(
				`Failed to execute ${entry.provider_name} x ${entry.benchmark_name}:`,
				error instanceof Error ? error.message : String(error),
			);
		}
	}

	const runEnd = Date.now();
	const totalDurationMs = runEnd - runStart;

	// Build summary
	const summary = buildSummary(allResults, plan.skipped_count, totalDurationMs);

	// Reconstruct selections from plan
	const providerNames = [
		...new Set(plan.entries.map((e) => e.provider_name)),
	].sort();
	const benchmarkNames = [
		...new Set(plan.entries.map((e) => e.benchmark_name)),
	].sort();

	const selections: RunSelection = {
		providers: providerNames,
		benchmarks: benchmarkNames,
		concurrency: 1, // Phase 3 default; Phase 5 will track this
	};

	return {
		run_id: plan.run_id,
		timestamp: plan.timestamp,
		selections,
		plan,
		results: allResults,
		summary,
	};
}

/**
 * Convenience method: build plan and execute in one call.
 * This is the primary entry point for the runner.
 *
 * @param selection - Parsed CLI arguments
 * @returns Complete run output
 */
export async function run(selection: RunSelection): Promise<RunOutput> {
	// 1. Build run plan (validates selections, expands matrix, applies capability gating)
	const plan = await buildRunPlan(selection);

	// 2. Execute the plan
	const output = await executeRunPlan(plan);

	return output;
}
