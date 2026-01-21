/**
 * Doctor Command Utility Functions
 *
 * Helper functions for the doctor command conformance testing system.
 * Includes unique token generation and detection utilities.
 *
 * @module src/doctor/utils
 * @see specs/017-doctor-command/research.md (R2: Unique Token Strategy)
 */

import type { RetrievalItem } from "../../types/core";
import { retryExecutor } from "../runner/retry";
import type { RetryPolicy } from "../runner/types";

// =============================================================================
// Token Generation (research R2)
// =============================================================================

/**
 * Generate a unique test token for conformance testing.
 * Uses DOCTOR_TOKEN_ prefix with random UUID suffix for reliable detection.
 *
 * This strategy survives provider paraphrasing/extraction because:
 * - Synthetic tokens are not natural language
 * - Providers typically preserve unique identifiers
 *
 * @returns Unique token string (e.g., "DOCTOR_TOKEN_a1b2c3d4")
 *
 * @example
 * ```typescript
 * const token = generateTestToken();
 * // Returns: "DOCTOR_TOKEN_a1b2c3d4"
 * ```
 */
export function generateTestToken(): string {
	return `DOCTOR_TOKEN_${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Detect if a token exists in retrieval results.
 * Uses case-insensitive substring matching for reliability.
 *
 * @param results - Array of retrieval items to search
 * @param token - Token to search for
 * @returns true if token found in any result's context
 *
 * @example
 * ```typescript
 * const found = detectToken(results, "DOCTOR_TOKEN_abc123");
 * if (found) {
 *   console.log("Token detected in results");
 * }
 * ```
 */
export function detectToken(results: RetrievalItem[], token: string): boolean {
	const normalizedToken = token.toLowerCase();
	return results.some((result) =>
		result.record.context.toLowerCase().includes(normalizedToken),
	);
}

/**
 * Create test content containing a unique token.
 * Wraps the token in natural language for realistic testing.
 *
 * @param token - The unique token to embed
 * @param context - Optional context description (default: "test memory")
 * @returns Content string with embedded token
 *
 * @example
 * ```typescript
 * const content = createTestContent("DOCTOR_TOKEN_abc123", "visibility test");
 * // Returns: "This is a test memory for visibility test. Token: DOCTOR_TOKEN_abc123"
 * ```
 */
export function createTestContent(
	token: string,
	context = "test memory",
): string {
	return `This is a ${context} for doctor conformance testing. Token: ${token}`;
}

// =============================================================================
// Timing Utilities
// =============================================================================

/**
 * Calculate p95 (95th percentile) from an array of numbers.
 * Returns null if array is empty.
 *
 * @param values - Array of numeric values
 * @returns p95 value or null if empty
 *
 * @example
 * ```typescript
 * const p95 = calculateP95([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
 * // Returns: 95
 * ```
 */
export function calculateP95(values: number[]): number | null {
	if (values.length === 0) return null;

	const sorted = [...values].sort((a, b) => a - b);
	const index = Math.ceil(sorted.length * 0.95) - 1;
	return sorted[Math.max(0, index)] ?? null;
}

/**
 * Calculate maximum value from an array of numbers.
 * Returns null if array is empty.
 *
 * @param values - Array of numeric values
 * @returns Maximum value or null if empty
 */
export function calculateMax(values: number[]): number | null {
	if (values.length === 0) return null;
	return Math.max(...values);
}

/**
 * Sleep for a specified duration.
 * Useful for exponential backoff in polling loops.
 *
 * @param ms - Duration in milliseconds
 * @returns Promise that resolves after the duration
 */
export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay with jitter.
 * Used for polling loops to avoid thundering herd.
 *
 * @param attempt - Current attempt number (0-indexed)
 * @param baseMs - Base delay in milliseconds (default: 100)
 * @param maxMs - Maximum delay in milliseconds (default: 5000)
 * @returns Delay in milliseconds with jitter
 *
 * @example
 * ```typescript
 * const delay = calculateBackoffDelay(2); // ~400ms with jitter
 * await sleep(delay);
 * ```
 */
export function calculateBackoffDelay(
	attempt: number,
	baseMs = 100,
	maxMs = 5000,
): number {
	// Exponential: base * 2^attempt
	const exponentialDelay = baseMs * 2 ** attempt;

	// Cap at max
	const cappedDelay = Math.min(exponentialDelay, maxMs);

	// Add jitter (0-25% of delay)
	const jitter = cappedDelay * Math.random() * 0.25;

	return Math.floor(cappedDelay + jitter);
}

/**
 * Heuristic auth-error detection.
 *
 * Providers currently throw plain Error messages (not structured error types).
 * This function lets doctor stop quickly when credentials are missing/invalid.
 */
export function isAuthErrorMessage(message: string): boolean {
	const lower = message.toLowerCase();

	// Missing env-var style errors
	if (lower.includes("environment variable") && lower.includes("required")) {
		return true;
	}

	// Numeric status codes commonly used for auth
	if (/\b401\b/.test(lower) || /\b403\b/.test(lower)) {
		return true;
	}

	// Common auth keywords
	return (
		lower.includes("unauthorized") ||
		lower.includes("forbidden") ||
		lower.includes("invalid api key") ||
		lower.includes("api key") ||
		lower.includes("authentication") ||
		lower.includes("permission") ||
		lower.includes("credentials")
	);
}

/**
 * Check if an error message indicates a permanent (non-retryable) error.
 *
 * Permanent errors include:
 * - Authentication errors (401, 403, invalid API key, etc.)
 * - Not found errors (404)
 * - Configuration errors
 * - Invalid provider/resource errors
 *
 * These errors won't resolve by waiting, so we should fail fast.
 *
 * @param message - Error message to check
 * @returns true if error is permanent and should not be retried
 */
export function isPermanentErrorMessage(message: string): boolean {
	// Auth errors are always permanent
	if (isAuthErrorMessage(message)) {
		return true;
	}

	const lower = message.toLowerCase();

	// Not found errors (resource doesn't exist)
	if (/\b404\b/.test(lower) || lower.includes("not found")) {
		return true;
	}

	// Configuration/setup errors
	if (
		lower.includes("invalid configuration") ||
		lower.includes("misconfigured") ||
		lower.includes("not configured")
	) {
		return true;
	}

	// Provider-specific permanent errors
	if (
		lower.includes("provider not") ||
		lower.includes("unsupported") ||
		lower.includes("not implemented")
	) {
		return true;
	}

	return false;
}

const DEFAULT_DOCTOR_RETRY_POLICY: Partial<RetryPolicy> = {
	base_delay_ms: 250,
	max_delay_ms: 5000,
	max_retries: 3,
	jitter_factor: 0.25,
};

export async function executeWithRetry<T>(
	fn: () => Promise<T>,
	policy: Partial<RetryPolicy> = DEFAULT_DOCTOR_RETRY_POLICY,
): Promise<T> {
	const retryResult = await retryExecutor.execute(fn, policy);
	if (retryResult.success) {
		return retryResult.value;
	}

	throw retryResult.error.original;
}

// =============================================================================
// Polling Utilities
// =============================================================================

/**
 * Options for the waitForVisibility function.
 */
export interface WaitForVisibilityOptions {
	/** Maximum time to wait in milliseconds */
	timeoutMs: number;
	/** Base delay for exponential backoff (default: 50ms) */
	baseDelayMs?: number;
	/** Maximum delay between polls (default: 2000ms) */
	maxDelayMs?: number;
	/** Retry policy for transient polling errors */
	retryPolicy?: Partial<RetryPolicy>;
}

/**
 * Result of waiting for visibility.
 */
export interface WaitForVisibilityResult {
	/** Whether the token became visible */
	found: boolean;
	/** Time until visible in milliseconds (null if not found) */
	visibilityTimeMs: number | null;
	/** Number of poll attempts made */
	attempts: number;
}

/**
 * Poll for token visibility with exponential backoff.
 * Used by visibility delay test to measure read-after-write latency.
 *
 * @param pollFn - Function that retrieves results for the token
 * @param token - Token to search for in results
 * @param options - Polling configuration
 * @returns Result indicating if found and timing
 *
 * @example
 * ```typescript
 * const result = await waitForVisibility(
 *   () => provider.retrieve_memory(scope, token, 10),
 *   token,
 *   { timeoutMs: 30000 }
 * );
 * if (result.found) {
 *   console.log(`Token visible after ${result.visibilityTimeMs}ms`);
 * }
 * ```
 */
export async function waitForVisibility(
	pollFn: () => Promise<RetrievalItem[]>,
	token: string,
	options: WaitForVisibilityOptions,
): Promise<WaitForVisibilityResult> {
	const {
		timeoutMs,
		baseDelayMs = 50,
		maxDelayMs = 2000,
		retryPolicy,
	} = options;

	const startTime = Date.now();
	let attempt = 0;

	while (Date.now() - startTime < timeoutMs) {
		attempt++;

		try {
			const retryResult = await retryExecutor.execute(pollFn, retryPolicy);
			if (!retryResult.success) {
				const message = retryResult.error.original.message;
				// Fail fast on permanent errors (auth, 404, config issues)
				if (isPermanentErrorMessage(message)) {
					throw retryResult.error.original;
				}
				// Treat other failures as "not found yet" and keep polling.
				throw retryResult.error.original;
			}

			const results = retryResult.value;
			if (detectToken(results, token)) {
				return {
					found: true,
					visibilityTimeMs: Date.now() - startTime,
					attempts: attempt,
				};
			}
		} catch (error) {
			// Stop early on permanent errors (auth, 404, config issues).
			// These won't resolve by waiting, so fail fast to keep doctor output actionable.
			const message = error instanceof Error ? error.message : String(error);
			if (isPermanentErrorMessage(message)) {
				throw error;
			}
			// Transient errors (network timeouts, rate limits) are swallowed and polling continues.
		}

		// Calculate delay with exponential backoff
		const delay = calculateBackoffDelay(attempt - 1, baseDelayMs, maxDelayMs);

		// Check if we have time for another attempt
		if (Date.now() - startTime + delay >= timeoutMs) {
			break;
		}

		await sleep(delay);
	}

	return {
		found: false,
		visibilityTimeMs: null,
		attempts: attempt,
	};
}
