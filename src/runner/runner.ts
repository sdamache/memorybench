/**
 * Unified Runner Core Execution Engine
 *
 * Implements the core execution logic for running benchmarks against providers,
 * capturing timing data, handling errors, and aggregating results.
 *
 * @module src/runner/runner
 */

import type { ScopeContext } from "../../types/core";
import type { CaseResult } from "../../types/benchmark";
import { BenchmarkRegistry } from "../loaders/benchmarks";
import { ProviderRegistry } from "../loaders/providers";
import { buildRunPlan } from "./gating";
import { timed } from "./timing";
import {
	checkpointManager,
	generateRunId,
	buildCaseKey,
	listAvailableRuns,
} from "./checkpoint";
import { retryExecutor } from "./retry";
import type {
	RunSelection,
	RunPlan,
	RunCaseResult,
	RunOutput,
	RunSummary,
	OperationTiming,
	Checkpoint,
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
 * Execute a single benchmark case with timing capture and retry logic.
 * Wraps execution with automatic retry for transient errors.
 *
 * @param providerName - Provider to test
 * @param benchmarkName - Benchmark to run
 * @param caseId - Specific case identifier
 * @param runId - Unique run identifier
 * @returns RunCaseResult with timing data and retry history
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

	const provider = providerEntry.adapter;
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

	// Wrap execution with retry logic
	const caseStart = Date.now();

	const retryResult = await retryExecutor.execute(async () => {
		// Run the benchmark case
		return await benchmark.run_case(provider, scope, benchmarkCase);
	});

	const caseEnd = Date.now();
	const duration_ms = caseEnd - caseStart;

	if (retryResult.success) {
		// Successful execution (possibly after retries)
		const result = retryResult.value;
		return {
			provider_name: providerName,
			benchmark_name: benchmarkName,
			case_id: result.case_id,
			status: result.status,
			scores: result.scores,
			duration_ms,
			error: result.error,
			artifacts: result.artifacts,
			retry_history: retryResult.retry_history.length > 0 ? retryResult.retry_history : undefined,
		};
	} else {
		// Failed after retries
		const classifiedError = retryResult.error;
		const errorMessage = classifiedError.http_status
			? `[${classifiedError.category}] HTTP ${classifiedError.http_status}: ${classifiedError.original.message}`
			: `[${classifiedError.category}] ${classifiedError.original.message}`;

		return {
			provider_name: providerName,
			benchmark_name: benchmarkName,
			case_id: caseId,
			status: "error",
			scores: {},
			duration_ms,
			error: {
				message: errorMessage,
				stack: classifiedError.original.stack,
			},
			retry_history: retryResult.retry_history.length > 0 ? retryResult.retry_history : undefined,
		};
	}
}

/**
 * Create a concurrency pool for batched parallel execution.
 * Processes items in batches respecting the concurrency limit.
 *
 * @param items - Array of items to process
 * @param concurrency - Maximum parallel executions
 * @param fn - Async function to execute for each item
 * @returns Promise resolving to array of all results in original order
 */
async function createConcurrencyPool<T, R>(
	items: T[],
	concurrency: number,
	fn: (item: T) => Promise<R>,
): Promise<R[]> {
	const results: R[] = [];

	// Process items in batches of size `concurrency`
	for (let i = 0; i < items.length; i += concurrency) {
		const batch = items.slice(i, i + concurrency);
		const batchPromises = batch.map(item => fn(item));
		const batchResults = await Promise.allSettled(batchPromises);

		// Extract results or throw on rejection
		for (const result of batchResults) {
			if (result.status === "fulfilled") {
				results.push(result.value);
			} else {
				// For executeCase, errors are caught and returned as error results
				// So rejections here indicate a programming error
				throw result.reason;
			}
		}
	}

	return results;
}

/**
 * Execute all cases for a provider/benchmark combination.
 * Supports both sequential and concurrent execution with checkpoint recording.
 *
 * @param providerName - Provider to test
 * @param benchmarkName - Benchmark to run
 * @param runId - Unique run identifier
 * @param concurrency - Max parallel case executions (default: 1 = sequential)
 * @param checkpoint - Optional checkpoint for recording progress
 * @returns Array of case results
 */
export async function executeCases(
	providerName: string,
	benchmarkName: string,
	runId: string,
	concurrency: number = 1,
	checkpoint?: Checkpoint | null,
): Promise<RunCaseResult[]> {
	const benchmarkRegistry = BenchmarkRegistry.getInstance();
	const benchmarkEntry = benchmarkRegistry.get(benchmarkName);

	if (!benchmarkEntry) {
		throw new Error(`Benchmark '${benchmarkName}' not found`);
	}

	const benchmark = benchmarkEntry.benchmark;
	const allCases = Array.from(benchmark.cases());

	if (concurrency === 1) {
		// Sequential execution for concurrency=1
		const results: RunCaseResult[] = [];
		let currentCheckpoint = checkpoint;

		for (const benchmarkCase of allCases) {
			const result = await executeCase(
				providerName,
				benchmarkName,
				benchmarkCase.id,
				runId,
			);
			results.push(result);

			// Record checkpoint after each case
			if (currentCheckpoint) {
				const caseKey = buildCaseKey(providerName, benchmarkName, benchmarkCase.id);
				currentCheckpoint = await checkpointManager.recordCompletion(
					currentCheckpoint,
					caseKey,
					result.status,
				);
			}
		}
		return results;
	} else {
		// Concurrent execution using concurrency pool
		// Note: Checkpoint recording for concurrent execution happens at batch boundaries
		const results = await createConcurrencyPool(
			allCases,
			concurrency,
			async (benchmarkCase) => {
				return executeCase(
					providerName,
					benchmarkName,
					benchmarkCase.id,
					runId,
				);
			},
		);

		// Record all checkpoints after batch completes
		if (checkpoint) {
			let currentCheckpoint = checkpoint;
			for (let i = 0; i < results.length; i++) {
				const result = results[i];
				const benchmarkCase = allCases[i];
				if (result && benchmarkCase) {
					const caseKey = buildCaseKey(providerName, benchmarkName, benchmarkCase.id);
					currentCheckpoint = await checkpointManager.recordCompletion(
						currentCheckpoint,
						caseKey,
						result.status,
					);
				}
			}
		}

		return results;
	}
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
 * Creates checkpoint for progress tracking.
 *
 * @param plan - Previously built run plan
 * @param selection - Original selection (needed for concurrency setting)
 * @param existingCheckpoint - Optional existing checkpoint for resume
 * @returns Complete run output with results and summary
 */
export async function executeRunPlan(
	plan: RunPlan,
	selection: RunSelection,
	existingCheckpoint?: Checkpoint | null,
): Promise<RunOutput> {
	const runStart = Date.now();
	const allResults: RunCaseResult[] = [];

	// Calculate total cases for checkpoint
	const benchmarkRegistry = BenchmarkRegistry.getInstance();
	let totalCases = 0;
	const eligibleEntries = plan.entries.filter((e) => e.eligible);

	for (const entry of eligibleEntries) {
		const benchmarkEntry = benchmarkRegistry.get(entry.benchmark_name);
		if (benchmarkEntry) {
			const caseCount = Array.from(benchmarkEntry.benchmark.cases()).length;
			totalCases += caseCount;
		}
	}

	// Create or use existing checkpoint
	let checkpoint = existingCheckpoint;
	if (!checkpoint) {
		checkpoint = await checkpointManager.create(
			plan.run_id,
			selection,
			totalCases,
		);
	}

	// Execute only eligible entries
	for (const entry of eligibleEntries) {
		try {
			const caseResults = await executeCases(
				entry.provider_name,
				entry.benchmark_name,
				plan.run_id,
				selection.concurrency,
				checkpoint,
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
		concurrency: selection.concurrency, // Preserve original concurrency setting
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
 * Resume an interrupted run from checkpoint.
 *
 * @param runId - Run ID to resume
 * @param selection - CLI selections (must match checkpoint)
 * @returns Complete run output
 * @throws Error if run not found or selections mismatch
 */
export async function resumeRun(
	runId: string,
	selection: RunSelection,
): Promise<RunOutput> {
	// Load checkpoint
	const loadResult = await checkpointManager.load(runId);

	if (loadResult.status === "not_found") {
		const availableRuns = await listAvailableRuns();
		const availableList = availableRuns.length > 0
			? `\nAvailable runs: ${availableRuns.slice(0, 5).join(", ")}`
			: "\nNo available runs found in runs/ directory.";
		throw new Error(`Run '${runId}' not found.${availableList}`);
	}

	if (loadResult.status === "invalid") {
		throw new Error(
			`Checkpoint corrupted: ${loadResult.error}\n\nOptions:\n` +
			`  1. Delete runs/${runId}/ and start fresh\n` +
			`  2. Manually fix checkpoint.json`,
		);
	}

	const checkpoint = loadResult.checkpoint;

	// Check if run is already complete
	if (checkpoint.completed_count === checkpoint.total_cases) {
		throw new Error(
			`Run already complete. ${checkpoint.completed_count}/${checkpoint.total_cases} cases finished.`,
		);
	}

	// Validate selections match
	const validation = checkpointManager.validateSelections(checkpoint, selection);
	if (!validation.valid) {
		const messages: string[] = ["Selection mismatch with checkpoint:"];

		if (validation.missing_providers.length > 0) {
			messages.push(`  Missing providers: ${validation.missing_providers.join(", ")}`);
		}
		if (validation.extra_providers.length > 0) {
			messages.push(`  Extra providers: ${validation.extra_providers.join(", ")}`);
		}
		if (validation.missing_benchmarks.length > 0) {
			messages.push(`  Missing benchmarks: ${validation.missing_benchmarks.join(", ")}`);
		}
		if (validation.extra_benchmarks.length > 0) {
			messages.push(`  Extra benchmarks: ${validation.extra_benchmarks.join(", ")}`);
		}

		messages.push(`\nOriginal run used:`);
		messages.push(`  Providers: ${checkpoint.selections.providers.join(", ")}`);
		messages.push(`  Benchmarks: ${checkpoint.selections.benchmarks.join(", ")}`);

		throw new Error(messages.join("\n"));
	}

	console.log(
		`Resuming run ${runId}: ${checkpoint.completed_count}/${checkpoint.total_cases} cases already completed`,
	);

	// Build run plan
	const plan = await buildRunPlan(selection);

	// Create new plan with existing run_id and timestamp
	const resumePlan: RunPlan = {
		...plan,
		run_id: runId,
		timestamp: checkpoint.created_at,
	};

	// Execute remaining cases
	const output = await executeRunPlan(resumePlan, selection, checkpoint);

	return output;
}

/**
 * Convenience method: build plan and execute in one call.
 * This is the primary entry point for the runner.
 *
 * @param selection - Parsed CLI arguments
 * @param resumeRunId - Optional run ID to resume
 * @returns Complete run output
 */
export async function run(
	selection: RunSelection,
	resumeRunId?: string,
): Promise<RunOutput> {
	// Resume existing run if requested
	if (resumeRunId) {
		return resumeRun(resumeRunId, selection);
	}

	// 1. Build run plan (validates selections, expands matrix, applies capability gating)
	const plan = await buildRunPlan(selection);

	// 2. Execute the plan
	const output = await executeRunPlan(plan, selection);

	return output;
}
