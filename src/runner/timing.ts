/**
 * Timing Wrapper for Provider Operations
 *
 * Provides a wrapper function to capture execution timings for provider operations
 * without modifying the BaseProvider interface.
 *
 * @module src/runner/timing
 */

import type { TimedResult, OperationTiming } from "./types";

/**
 * Wraps an async operation to capture its execution timing.
 *
 * @param operation - The operation name (e.g., "add_memory", "retrieve_memory", "delete_memory")
 * @param fn - The async function to time
 * @returns Promise resolving to the result and timing metadata
 *
 * @example
 * ```typescript
 * const { result, timing } = await timed("add_memory", async () => {
 *   await provider.addMemory(context, memories);
 * });
 * console.log(`${timing.operation} took ${timing.duration_ms}ms`);
 * ```
 */
export async function timed<T>(
	operation: string,
	fn: () => Promise<T>,
): Promise<TimedResult<T>> {
	const start = Date.now();
	const timestamp = new Date().toISOString();

	try {
		const result = await fn();
		const end = Date.now();
		const duration_ms = end - start;

		const timing: OperationTiming = {
			operation,
			duration_ms,
			timestamp,
		};

		return { result, timing };
	} catch (error) {
		// Still capture timing even if the operation fails
		const end = Date.now();
		const duration_ms = end - start;

		const timing: OperationTiming = {
			operation,
			duration_ms,
			timestamp,
		};

		// Attach timing to the error object so callers can access it
		if (error instanceof Error) {
			(error as Error & { timing?: OperationTiming }).timing = timing;
		}

		// Re-throw the error with timing information attached
		throw error;
	}
}
