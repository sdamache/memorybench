/**
 * CRUD Semantics Benchmark - Utility Functions
 *
 * Provides token detection and convergence wait helpers for the benchmark.
 *
 * @module benchmarks/CRUD-semantics/utils
 * @see specs/014-crud-semantics-benchmark/research.md
 */

import type { RetrievalItem } from "../../types/core";
import type { BaseProvider } from "../../types/provider";
import type { TokenDetectionResult } from "./types";

// =============================================================================
// Token Detection
// =============================================================================

/**
 * Detect if a unique token is present in retrieval results.
 *
 * Uses case-insensitive matching to handle providers that may normalize text.
 * This is the primary verification strategy for CRUD semantics - synthetic
 * tokens like "ULTRAVIOLET_123" cannot be paraphrased by auto-extraction.
 *
 * @param results - Array of retrieval items from provider.retrieve_memory
 * @param token - The unique token to search for (e.g., "ULTRAVIOLET_123")
 * @returns Detection result with found status and indices
 *
 * @example
 * ```typescript
 * const results = await provider.retrieve_memory(scope, "What is the favorite color?", 5);
 * const detection = detectToken(results, "ULTRAVIOLET_123");
 * if (detection.found) {
 *   console.log(`Token found in ${detection.found_in_indices.length} results`);
 * }
 * ```
 */
export function detectToken(
	results: RetrievalItem[],
	token: string,
): TokenDetectionResult {
	const normalizedToken = token.toLowerCase();
	const foundIndices: number[] = [];

	for (let i = 0; i < results.length; i++) {
		const result = results[i];
		if (result?.record.context.toLowerCase().includes(normalizedToken)) {
			foundIndices.push(i);
		}
	}

	return {
		found: foundIndices.length > 0,
		found_in_indices: foundIndices,
		total_results: results.length,
	};
}

/**
 * Expand a content template with a value.
 *
 * Replaces {value} placeholder with the actual token value.
 *
 * @param template - Template string with {value} placeholder
 * @param value - The value to insert
 * @returns Expanded content string
 *
 * @example
 * ```typescript
 * const content = expandTemplate("My favorite color is {value}", "ULTRAVIOLET_123");
 * // Returns: "My favorite color is ULTRAVIOLET_123"
 * ```
 */
export function expandTemplate(template: string, value: string): string {
	return template.replace("{value}", value);
}

// =============================================================================
// Convergence Wait Helper
// =============================================================================

/**
 * Get the convergence wait time from a provider's capabilities.
 *
 * For async providers (like Supermemory), this returns the time to wait
 * after write operations before reads are guaranteed to reflect changes.
 *
 * Pattern from benchmarks/RAG-template-benchmark/benchmark.ts:19-31
 *
 * @param provider - The memory provider
 * @returns Wait time in milliseconds (0 if not async or unknown)
 */
export async function getConvergenceWaitMs(
	provider: BaseProvider,
): Promise<number> {
	if (!provider.get_capabilities) {
		return 0;
	}

	try {
		const capabilities = await provider.get_capabilities();
		const waitMs = capabilities?.system_flags?.convergence_wait_ms ?? 0;
		return typeof waitMs === "number" && waitMs > 0 ? waitMs : 0;
	} catch {
		return 0;
	}
}

/**
 * Wait for provider convergence after a write operation.
 *
 * Uses provider.await_convergence if available, otherwise falls back to
 * a simple setTimeout with the convergence_wait_ms from capabilities.
 *
 * @param provider - The memory provider
 * @param scope - Execution context for the operation
 * @param ingestedIds - IDs of recently written records
 * @param waitMs - Override wait time in ms (omit to use provider capabilities; pass 0 to skip waiting)
 */
export async function waitForConvergence(
	provider: BaseProvider,
	scope: { user_id: string; run_id: string; session_id?: string },
	ingestedIds: string[],
	waitMs?: number,
): Promise<void> {
	const convergenceWaitMs = waitMs ?? (await getConvergenceWaitMs(provider));

	if (convergenceWaitMs <= 0) {
		return;
	}

	// If we don't have IDs to poll for, we still need to respect the provider's
	// convergence window (e.g., for delete propagation). In that case, fall back
	// to a simple sleep.
	if (ingestedIds.length === 0) {
		await new Promise((resolve) => setTimeout(resolve, convergenceWaitMs));
		return;
	}

	if (typeof provider.await_convergence === "function") {
		try {
			await provider.await_convergence(scope, ingestedIds, convergenceWaitMs);
			return;
		} catch {
			// Fall through to sleep
		}
	}

	await new Promise((resolve) => setTimeout(resolve, convergenceWaitMs));
}
