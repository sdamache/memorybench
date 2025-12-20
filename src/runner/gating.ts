/**
 * Runner Gating and Matrix Expansion Logic
 *
 * Handles provider/benchmark selection resolution, matrix expansion,
 * and capability-based compatibility checking.
 *
 * @module src/runner/gating
 */

import { BenchmarkRegistry } from "../loaders/benchmarks";
import { ProviderRegistry } from "../loaders/providers";
import { checkProviderCompatibility } from "../loaders/benchmarks";
import type {
	RunSelection,
	RunPlan,
	RunPlanEntry,
	SkipReason,
} from "./types";

// =============================================================================
// Selection Resolution
// =============================================================================

/**
 * Validate that all requested provider names exist in the registry.
 * Throws an error if any provider is not found.
 *
 * @param providerNames - Array of provider names from CLI
 * @returns Array of validated provider names
 * @throws Error if any provider doesn't exist with list of available providers
 */
export async function resolveProviders(
	providerNames: string[],
): Promise<string[]> {
	const registry = await ProviderRegistry.getInstance();
	const available = registry.listProviders().map((p) => p.manifest.provider.name);
	const missing: string[] = [];

	for (const name of providerNames) {
		const provider = registry.getProvider(name);
		if (!provider) {
			missing.push(name);
		}
	}

	if (missing.length > 0) {
		throw new Error(
			`Provider(s) '${missing.join("', '")}' not found. Available: ${available.join(", ")}`,
		);
	}

	return providerNames;
}

/**
 * Validate that all requested benchmark names exist in the registry.
 * Throws an error if any benchmark is not found.
 *
 * @param benchmarkNames - Array of benchmark names from CLI
 * @returns Array of validated benchmark names
 * @throws Error if any benchmark doesn't exist with list of available benchmarks
 */
export async function resolveBenchmarks(
	benchmarkNames: string[],
): Promise<string[]> {
	const registry = BenchmarkRegistry.getInstance();
	await registry.initialize();

	const available = registry.listBenchmarks().map((b) => b.benchmark.meta.name);
	const missing: string[] = [];

	for (const name of benchmarkNames) {
		const benchmark = registry.get(name);
		if (!benchmark) {
			missing.push(name);
		}
	}

	if (missing.length > 0) {
		throw new Error(
			`Benchmark(s) '${missing.join("', '")}' not found. Available: ${available.join(", ")}`,
		);
	}

	return benchmarkNames;
}

// =============================================================================
// Matrix Expansion
// =============================================================================

/**
 * Expand provider x benchmark combinations into a matrix.
 * Creates all possible combinations without capability gating.
 *
 * @param providers - Validated provider names
 * @param benchmarks - Validated benchmark names
 * @returns Array of provider/benchmark combinations marked as eligible
 */
export function expandMatrix(
	providers: readonly string[],
	benchmarks: readonly string[],
): RunPlanEntry[] {
	const entries: RunPlanEntry[] = [];

	for (const providerName of providers) {
		for (const benchmarkName of benchmarks) {
			entries.push({
				provider_name: providerName,
				benchmark_name: benchmarkName,
				eligible: true, // Initially marked eligible; gating may change this
			});
		}
	}

	return entries;
}

// =============================================================================
// Capability Gating
// =============================================================================

/**
 * Check if a provider has all capabilities required by a benchmark.
 *
 * @param providerName - Provider to check
 * @param benchmarkName - Benchmark requiring capabilities
 * @returns Object with compatibility status and missing capabilities
 */
export async function checkCapabilityCompatibility(
	providerName: string,
	benchmarkName: string,
): Promise<{ compatible: boolean; missing: string[] }> {
	const providerRegistry = await ProviderRegistry.getInstance();
	const benchmarkRegistry = BenchmarkRegistry.getInstance();

	const provider = providerRegistry.getProvider(providerName);
	const benchmark = benchmarkRegistry.get(benchmarkName);

	if (!provider) {
		throw new Error(`Provider '${providerName}' not found in registry`);
	}

	if (!benchmark) {
		throw new Error(`Benchmark '${benchmarkName}' not found in registry`);
	}

	const requiredCapabilities = benchmark.benchmark.meta.required_capabilities;
	const providerCapabilities = provider.providerInstance.get_capabilities();

	// Use existing checkProviderCompatibility from benchmarks loader
	const compatible = checkProviderCompatibility(
		requiredCapabilities,
		providerCapabilities,
	);

	if (compatible) {
		return { compatible: true, missing: [] };
	}

	// Determine which capabilities are missing
	const missing: string[] = [];
	for (const capability of requiredCapabilities) {
		// Check each capability using the same logic as checkProviderCompatibility
		const hasCapability = checkProviderCompatibility(
			[capability],
			providerCapabilities,
		);
		if (!hasCapability) {
			missing.push(capability);
		}
	}

	return { compatible: false, missing };
}

/**
 * Create a structured skip reason for an incompatible provider/benchmark combination.
 *
 * @param providerName - Provider that was skipped
 * @param benchmarkName - Benchmark that couldn't run
 * @param missingCapabilities - Capabilities the provider lacks
 * @returns Structured SkipReason object
 */
export function createSkipReason(
	providerName: string,
	benchmarkName: string,
	missingCapabilities: string[],
): SkipReason {
	const capabilitiesText =
		missingCapabilities.length === 1
			? missingCapabilities[0]
			: missingCapabilities.join(", ");

	return {
		provider_name: providerName,
		benchmark_name: benchmarkName,
		missing_capabilities: missingCapabilities,
		message: `Provider '${providerName}' lacks required capability: ${capabilitiesText}`,
	};
}

// =============================================================================
// Run Plan Building
// =============================================================================

/**
 * Build a complete run plan from selections.
 * Validates selections, expands the matrix, and performs capability gating.
 * Ensures deterministic ordering for reproducibility.
 *
 * @param selection - Parsed CLI arguments
 * @returns Complete run plan with eligible and skipped entries
 */
export async function buildRunPlan(
	selection: RunSelection,
): Promise<RunPlan> {
	// 1. Resolve and validate selections
	const providers = await resolveProviders(selection.providers);
	const benchmarks = await resolveBenchmarks(selection.benchmarks);

	// 2. Sort for deterministic ordering (FR-009)
	const sortedProviders = [...providers].sort();
	const sortedBenchmarks = [...benchmarks].sort();

	// 3. Expand matrix
	const matrixEntries = expandMatrix(sortedProviders, sortedBenchmarks);

	// 4. Apply capability gating
	const gatedEntries: RunPlanEntry[] = [];
	for (const entry of matrixEntries) {
		const { compatible, missing } = await checkCapabilityCompatibility(
			entry.provider_name,
			entry.benchmark_name,
		);

		if (compatible) {
			gatedEntries.push(entry); // Keep as eligible
		} else {
			// Mark as ineligible with skip reason
			const skipReason = createSkipReason(
				entry.provider_name,
				entry.benchmark_name,
				missing,
			);
			gatedEntries.push({
				...entry,
				eligible: false,
				skip_reason: skipReason,
			});
		}
	}

	// 5. Calculate counts
	const eligible_count = gatedEntries.filter((e) => e.eligible).length;
	const skipped_count = gatedEntries.filter((e) => !e.eligible).length;

	// 6. Generate run metadata
	const run_id = `run_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
	const timestamp = new Date().toISOString();

	return {
		run_id,
		timestamp,
		entries: gatedEntries,
		eligible_count,
		skipped_count,
	};
}
