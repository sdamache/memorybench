/**
 * Retry Executor Implementation
 *
 * Provides retry logic with exponential backoff and jitter for transient errors.
 * Classifies errors as transient (retriable) or permanent (fail-fast).
 *
 * @module src/runner/retry
 * @see specs/008-checkpoint-resume/research.md
 */

import type {
	ClassifiedError,
	ErrorCategory,
	RetryAttempt,
	RetryPolicy,
	RetryResult,
} from "./types";

// =============================================================================
// Constants
// =============================================================================

/**
 * Default retry policy values.
 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
	base_delay_ms: 1000, // 1 second
	max_delay_ms: 30000, // 30 seconds
	max_retries: 3,
	jitter_factor: 0.5, // ±50%
};

/**
 * HTTP status codes considered transient (will retry).
 */
const TRANSIENT_HTTP_CODES = new Set([429, 500, 502, 503, 504]);

/**
 * HTTP status codes considered permanent (no retry).
 */
const PERMANENT_HTTP_CODES = new Set([400, 401, 403, 404, 422]);

/**
 * Error message patterns indicating transient errors.
 */
const TRANSIENT_ERROR_PATTERNS = [
	"timeout",
	"econnreset",
	"econnrefused",
	"network",
	"socket hang up",
	"etimedout",
	"enotfound",
];

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Check if an error has an HTTP status code.
 *
 * @param error - Error to check
 * @returns True if error has status property
 */
function hasHttpStatus(error: Error): error is Error & { status: number } {
	return "status" in error && typeof (error as { status: unknown }).status === "number";
}

/**
 * Extract HTTP status code from various error formats.
 *
 * @param error - Error to extract from
 * @returns HTTP status code or undefined
 */
function extractHttpStatus(error: Error): number | undefined {
	if (hasHttpStatus(error)) {
		return error.status;
	}

	// Check for nested status in response property
	if ("response" in error && typeof error.response === "object" && error.response !== null) {
		const response = error.response as Record<string, unknown>;
		if (typeof response.status === "number") {
			return response.status;
		}
	}

	return undefined;
}

/**
 * Check if error message matches transient patterns.
 *
 * @param message - Error message to check
 * @returns True if message indicates transient error
 */
function matchesTransientPattern(message: string): boolean {
	const lowerMessage = message.toLowerCase();
	return TRANSIENT_ERROR_PATTERNS.some((pattern) =>
		lowerMessage.includes(pattern),
	);
}

/**
 * Sleep for specified milliseconds.
 *
 * @param ms - Milliseconds to sleep
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// Error Classification
// =============================================================================

/**
 * Classify an error to determine retry behavior.
 *
 * @param error - Error to classify
 * @returns Classified error with category
 */
export function classifyError(error: Error): ClassifiedError {
	const httpStatus = extractHttpStatus(error);

	// Check HTTP status code first
	if (httpStatus !== undefined) {
		if (TRANSIENT_HTTP_CODES.has(httpStatus)) {
			return {
				category: "transient",
				original: error,
				http_status: httpStatus,
				should_retry: true,
			};
		}

		if (PERMANENT_HTTP_CODES.has(httpStatus)) {
			return {
				category: "permanent",
				original: error,
				http_status: httpStatus,
				should_retry: false,
			};
		}

		// Unknown HTTP status - default to transient for 5xx, permanent for others
		const isServerError = httpStatus >= 500 && httpStatus <= 599;
		return {
			category: isServerError ? "transient" : "permanent",
			original: error,
			http_status: httpStatus,
			should_retry: isServerError,
		};
	}

	// Check error message patterns
	if (matchesTransientPattern(error.message)) {
		return {
			category: "transient",
			original: error,
			should_retry: true,
		};
	}

	// Default to permanent for unknown errors
	return {
		category: "permanent",
		original: error,
		should_retry: false,
	};
}

/**
 * Calculate delay for next retry attempt with exponential backoff and jitter.
 *
 * @param attempt - Current attempt number (0-indexed)
 * @param policy - Retry policy
 * @returns Delay in milliseconds with jitter applied
 */
export function calculateDelay(attempt: number, policy: RetryPolicy): number {
	// Exponential backoff: base_delay * 2^attempt
	const exponentialDelay = policy.base_delay_ms * Math.pow(2, attempt);

	// Cap at max_delay
	const cappedDelay = Math.min(exponentialDelay, policy.max_delay_ms);

	// Apply jitter: random value in range [1 - jitter, 1 + jitter]
	const jitterRange = policy.jitter_factor;
	const jitterMultiplier = 1 + (Math.random() * 2 - 1) * jitterRange;

	return Math.floor(cappedDelay * jitterMultiplier);
}

// =============================================================================
// Retry Executor
// =============================================================================

/**
 * Retry executor implementation.
 */
export class RetryExecutor {
	/**
	 * Execute an async operation with retry on transient errors.
	 *
	 * @param fn - Async function to execute
	 * @param partialPolicy - Partial retry policy (merged with defaults)
	 * @returns Result with value or final error, plus retry history
	 */
	async execute<T>(
		fn: () => Promise<T>,
		partialPolicy?: Partial<RetryPolicy>,
	): Promise<RetryResult<T>> {
		const policy: RetryPolicy = {
			...DEFAULT_RETRY_POLICY,
			...partialPolicy,
		};

		const retryHistory: RetryAttempt[] = [];
		let lastError: ClassifiedError | null = null;

		// Initial attempt + retries
		for (let attempt = 0; attempt <= policy.max_retries; attempt++) {
			try {
				// Execute the function
				const value = await fn();

				// Success! Return with retry history
				return {
					success: true,
					value,
					attempts: attempt + 1,
					retry_history: retryHistory,
				};
			} catch (err) {
				const error = err instanceof Error ? err : new Error(String(err));
				const classified = classifyError(error);
				lastError = classified;

				// Calculate delay once (before recording and sleeping)
				// This ensures the delay recorded in history matches the actual delay slept
				const delay = calculateDelay(attempt, policy);

				// Record attempt (for retries, not the initial attempt)
				if (attempt > 0) {
					retryHistory.push({
						attempt,
						error_type: classified.category,
						error_message: error.message,
						timestamp: new Date().toISOString(),
						delay_ms: delay,
					});
				}

				// Don't retry permanent errors
				if (!classified.should_retry) {
					return {
						success: false,
						error: classified,
						attempts: attempt + 1,
						retry_history: retryHistory,
					};
				}

				// Don't retry if we've exhausted retries
				if (attempt >= policy.max_retries) {
					return {
						success: false,
						error: classified,
						attempts: attempt + 1,
						retry_history: retryHistory,
					};
				}

				// Wait before retry using the delay calculated above
				await sleep(delay);
			}
		}

		// This should never be reached, but TypeScript needs it
		return {
			success: false,
			error: lastError!,
			attempts: policy.max_retries + 1,
			retry_history: retryHistory,
		};
	}
}

/**
 * Default retry executor instance.
 */
export const retryExecutor = new RetryExecutor();
