/**
 * Results Summary Generation
 *
 * Functions for aggregating run results into metrics summaries.
 * Computes counts, averages, and breakdowns per provider×benchmark combination.
 *
 * @module src/results/summarize
 */

import type {
	ResultRecord,
	MetricsSummary,
	StatusCounts,
	CombinationSummary,
} from "./schema";

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Group results by provider×benchmark combination.
 *
 * @param results - Array of result records to group
 * @returns Map from "provider:benchmark" key to array of results
 */
export function groupResultsByCombination(
	results: readonly ResultRecord[],
): Map<string, ResultRecord[]> {
	const grouped = new Map<string, ResultRecord[]>();

	for (const result of results) {
		const key = `${result.provider_name}:${result.benchmark_name}`;
		const existing = grouped.get(key) ?? [];
		existing.push(result);
		grouped.set(key, existing);
	}

	return grouped;
}

/**
 * Calculate average scores across multiple results.
 * Handles cases where not all results have the same score keys.
 *
 * @param results - Array of results to average
 * @returns Map of score name to average value
 */
export function calculateScoreAverages(
	results: readonly ResultRecord[],
): Record<string, number> {
	// Collect all score values by key
	const scoresByKey = new Map<string, number[]>();

	for (const result of results) {
		for (const [key, value] of Object.entries(result.scores)) {
			const existing = scoresByKey.get(key) ?? [];
			existing.push(value);
			scoresByKey.set(key, existing);
		}
	}

	// Compute averages
	const averages: Record<string, number> = {};
	for (const [key, values] of scoresByKey.entries()) {
		const sum = values.reduce((acc, val) => acc + val, 0);
		averages[key] = sum / values.length;
	}

	return averages;
}

/**
 * Compute status counts from results.
 *
 * @param results - Array of results to count
 * @returns Status breakdown counts
 */
function computeStatusCounts(results: readonly ResultRecord[]): StatusCounts {
	let passed = 0;
	let failed = 0;
	let skipped = 0;
	let errors = 0;

	for (const result of results) {
		switch (result.status) {
			case "pass":
				passed++;
				break;
			case "fail":
				failed++;
				break;
			case "skip":
				skipped++;
				break;
			case "error":
				errors++;
				break;
		}
	}

	return {
		cases: results.length,
		passed,
		failed,
		skipped,
		errors,
	};
}

// =============================================================================
// Main Summary Builder
// =============================================================================

/**
 * Build complete metrics summary from result records.
 * Aggregates statistics per provider×benchmark combination and overall.
 *
 * @param runId - Unique run identifier
 * @param results - All result records from the run
 * @returns Complete metrics summary ready for persistence
 */
export function buildMetricsSummary(
	runId: string,
	results: readonly ResultRecord[],
): MetricsSummary {
	const generatedAt = new Date().toISOString();

	// Group by combination
	const grouped = groupResultsByCombination(results);

	// Build per-combination summaries
	const byCombination: CombinationSummary[] = [];

	for (const [key, comboResults] of grouped.entries()) {
		const parts = key.split(":");
		const providerName = parts[0] ?? "";
		const benchmarkName = parts[1] ?? "";

		// Calculate counts
		const counts = computeStatusCounts(comboResults);

		// Calculate score averages
		const scoreAverages = calculateScoreAverages(comboResults);

		// Sum duration
		const durationMs = comboResults.reduce(
			(sum, r) => sum + r.duration_ms,
			0,
		);

		byCombination.push({
			provider_name: providerName,
			benchmark_name: benchmarkName,
			counts,
			duration_ms: durationMs,
			score_averages: scoreAverages,
		});
	}

	// Sort combinations by provider then benchmark for consistent output
	byCombination.sort((a, b) => {
		const providerCmp = a.provider_name.localeCompare(b.provider_name);
		if (providerCmp !== 0) return providerCmp;
		return a.benchmark_name.localeCompare(b.benchmark_name);
	});

	// Compute overall totals
	const totalCounts = computeStatusCounts(results);
	const totalDuration = results.reduce((sum, r) => sum + r.duration_ms, 0);

	return {
		version: 1,
		run_id: runId,
		generated_at: generatedAt,
		totals: {
			...totalCounts,
			duration_ms: totalDuration,
		},
		by_combination: byCombination,
	};
}
