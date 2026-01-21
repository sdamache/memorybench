/**
 * Doctor Command Conformance Tests
 *
 * Implementations of the four conformance tests:
 * 1. Scope Isolation - verify data isolation between scopes
 * 2. Visibility Delay - measure read-after-write latency
 * 3. Delete Leakage - verify deleted content is not retrievable
 * 4. Update Staleness - verify old content is replaced (capability-gated)
 *
 * @module src/doctor/tests
 * @see specs/017-doctor-command/spec.md
 */

import type { ScopeContext } from "../../types/core";
import { getConvergenceWaitMs } from "../loaders/providers";
import type {
	ConformanceTestResult,
	ShouldRunResult,
	SkipDetails,
	TestContext,
	VisibilityDelayDetails,
	VisibilityDelaySample,
} from "./types";
import {
	calculateMax,
	calculateP95,
	createTestContent,
	detectToken,
	executeWithRetry,
	generateTestToken,
	isAuthErrorMessage,
	sleep,
	waitForVisibility,
} from "./utils";

// =============================================================================
// Scope Isolation Test (FR-002)
// =============================================================================

/**
 * Test that data written to one scope is not retrievable from another scope.
 *
 * Algorithm:
 * 1. Create two ScopeContexts with different user_ids
 * 2. Write a memory with unique token to scope A
 * 3. Wait for convergence
 * 4. Query from scope B using the token
 * 5. Pass if token NOT found in scope B results
 *
 * @param ctx - Test context with provider and manifest
 * @returns Test result with pass/fail status
 */
export async function runScopeIsolationTest(
	ctx: TestContext,
): Promise<ConformanceTestResult> {
	const startTime = Date.now();

	// Define scope and track memory ID outside try for cleanup on error
	const scopeA: ScopeContext = {
		user_id: `doctor_user_a_${ctx.run_id}`,
		run_id: ctx.run_id,
		namespace: "doctor_test",
	};
	let memoryId: string | undefined;

	try {
		const token = generateTestToken();
		const content = createTestContent(token, "scope isolation");

		const scopeB: ScopeContext = {
			user_id: `doctor_user_b_${ctx.run_id}`,
			run_id: ctx.run_id,
			namespace: "doctor_test",
		};

		// Write to scope A
		const memory = await executeWithRetry(() =>
			ctx.provider.add_memory(scopeA, content),
		);
		memoryId = memory.id;

		// Wait for convergence
		const convergenceMs = getConvergenceWaitMs(ctx.manifest);
		if (convergenceMs > 0) {
			await waitForConvergence(ctx, scopeA, [memory.id], convergenceMs);
		}

		// Verify token is visible in scope A first (avoid false positive from eventual consistency)
		const resultsA = await executeWithRetry(() =>
			ctx.provider.retrieve_memory(scopeA, token, 10),
		);
		const visibleInScopeA = detectToken(resultsA, token);

		if (!visibleInScopeA) {
			// Cleanup before returning error
			try {
				await executeWithRetry(
					() => ctx.provider.delete_memory(scopeA, memory.id),
					{ base_delay_ms: 250, max_delay_ms: 2000, max_retries: 2, jitter_factor: 0.25 },
				);
			} catch {
				// Ignore cleanup errors
			}

			return {
				test_name: "scope_isolation",
				status: "error",
				message: "Could not verify token visibility in scope A - test inconclusive",
				duration_ms: Date.now() - startTime,
				details: { token, reason: "token_not_visible_in_scope_a" },
			};
		}

		// Query from scope B - should NOT find the token
		const resultsB = await executeWithRetry(() =>
			ctx.provider.retrieve_memory(scopeB, token, 10),
		);
		const leaked = detectToken(resultsB, token);

		// Cleanup - delete the test memory
		try {
			await executeWithRetry(
				() => ctx.provider.delete_memory(scopeA, memory.id),
				{
					base_delay_ms: 250,
					max_delay_ms: 2000,
					max_retries: 2,
					jitter_factor: 0.25,
				},
			);
		} catch {
			// Ignore cleanup errors
		}

		const duration_ms = Date.now() - startTime;

		if (leaked) {
			return {
				test_name: "scope_isolation",
				status: "fail",
				message:
					"Data leaked between scopes: token from scope A found in scope B results",
				duration_ms,
				details: {
					scope_a_user_id: scopeA.user_id,
					scope_b_user_id: scopeB.user_id,
					token,
					leaked_results_count: resultsB.length,
				},
			};
		}

		return {
			test_name: "scope_isolation",
			status: "pass",
			message: "Data written to scope A is not retrievable from scope B",
			duration_ms,
			details: {
				scope_a_user_id: scopeA.user_id,
				scope_b_user_id: scopeB.user_id,
			},
		};
	} catch (error) {
		// Best-effort cleanup if memory was created before error
		if (memoryId) {
			const idToDelete = memoryId;
			try {
				await executeWithRetry(
					() => ctx.provider.delete_memory(scopeA, idToDelete),
					{ base_delay_ms: 250, max_delay_ms: 2000, max_retries: 2, jitter_factor: 0.25 },
				);
			} catch {
				// Ignore cleanup errors
			}
		}

		return {
			test_name: "scope_isolation",
			status: "error",
			message: `Test error: ${error instanceof Error ? error.message : String(error)}`,
			duration_ms: Date.now() - startTime,
		};
	}
}

// =============================================================================
// Visibility Delay Test (FR-003, FR-004)
// =============================================================================

/**
 * Measure read-after-write visibility delay.
 *
 * Algorithm:
 * 1. For N samples:
 *    a. Generate unique token
 *    b. Write memory with token
 *    c. Poll retrieve until token visible (or timeout)
 *    d. Record visibility time
 * 2. Calculate p95 and max from successful samples
 * 3. Suggest convergence_wait_ms based on measurements
 *
 * @param ctx - Test context with provider and manifest
 * @returns Test result with visibility delay details
 */
export async function runVisibilityDelayTest(
	ctx: TestContext,
): Promise<ConformanceTestResult> {
	const startTime = Date.now();

	try {
		const samples: VisibilityDelaySample[] = [];
		const scope: ScopeContext = {
			user_id: `doctor_visibility_${ctx.run_id}`,
			run_id: ctx.run_id,
			namespace: "doctor_test",
		};

		// Collect samples
		for (let i = 0; i < ctx.visibility_samples; i++) {
			const sampleStart = Date.now();
			const token = generateTestToken();
			const content = createTestContent(token, `visibility sample ${i + 1}`);

			// Write memory
			const writeStart = Date.now();
			const memory = await executeWithRetry(() =>
				ctx.provider.add_memory(scope, content),
			);
			const writeTime = Date.now() - writeStart;

			// Poll for visibility
			const pollResult = await waitForVisibility(
				() => ctx.provider.retrieve_memory(scope, token, 10),
				token,
				{ timeoutMs: ctx.visibility_timeout_ms },
			);

			samples.push({
				sample_index: i + 1,
				token,
				write_time_ms: writeTime,
				visibility_time_ms: pollResult.visibilityTimeMs,
				total_time_ms: Date.now() - sampleStart,
			});

			// Cleanup
			try {
				await executeWithRetry(
					() => ctx.provider.delete_memory(scope, memory.id),
					{
						base_delay_ms: 250,
						max_delay_ms: 2000,
						max_retries: 2,
						jitter_factor: 0.25,
					},
				);
			} catch (error) {
				// Cleanup should never fail the test, but surface auth issues clearly.
				const message = error instanceof Error ? error.message : String(error);
				if (isAuthErrorMessage(message)) {
					throw error;
				}
			}
		}

		// Calculate statistics
		const visibilityTimes = samples
			.map((s) => s.visibility_time_ms)
			.filter((t): t is number => t !== null);

		const p95 = calculateP95(visibilityTimes);
		const max = calculateMax(visibilityTimes);
		const successCount = visibilityTimes.length;
		const timeoutCount = ctx.visibility_samples - successCount;

		const details: VisibilityDelayDetails = {
			samples,
			successful_samples: successCount,
			timed_out_samples: timeoutCount,
			p95_visibility_ms: p95,
			max_visibility_ms: max,
			timeout_ms: ctx.visibility_timeout_ms,
		};

		const duration_ms = Date.now() - startTime;

		// Determine status
		if (timeoutCount === ctx.visibility_samples) {
			return {
				test_name: "visibility_delay",
				status: "fail",
				message: `All ${ctx.visibility_samples} samples timed out after ${ctx.visibility_timeout_ms}ms`,
				duration_ms,
				details,
			};
		}

		if (timeoutCount > 0) {
			return {
				test_name: "visibility_delay",
				status: "pass",
				message: `Read-after-write visibility measured: ${successCount}/${ctx.visibility_samples} samples succeeded, ${timeoutCount} timed out`,
				duration_ms,
				details,
			};
		}

		return {
			test_name: "visibility_delay",
			status: "pass",
			message: `Read-after-write visibility: p95=${p95}ms, max=${max}ms`,
			duration_ms,
			details,
		};
	} catch (error) {
		return {
			test_name: "visibility_delay",
			status: "error",
			message: `Test error: ${error instanceof Error ? error.message : String(error)}`,
			duration_ms: Date.now() - startTime,
		};
	}
}

// =============================================================================
// Delete Leakage Test (FR-005)
// =============================================================================

/**
 * Test that deleted content is not retrievable.
 *
 * Algorithm:
 * 1. Write memory with unique token
 * 2. Verify token is visible
 * 3. Delete the memory
 * 4. Wait for convergence
 * 5. Query with adversarial search using the token
 * 6. Pass if token NOT found in results
 *
 * @param ctx - Test context with provider and manifest
 * @returns Test result with pass/fail status
 */
export async function runDeleteLeakageTest(
	ctx: TestContext,
): Promise<ConformanceTestResult> {
	const startTime = Date.now();

	// Define scope and track memory ID outside try for cleanup on error
	const scope: ScopeContext = {
		user_id: `doctor_delete_${ctx.run_id}`,
		run_id: ctx.run_id,
		namespace: "doctor_test",
	};
	let memoryId: string | undefined;

	try {
		const token = generateTestToken();
		const content = createTestContent(token, "delete leakage");

		// Write memory
		const memory = await executeWithRetry(() =>
			ctx.provider.add_memory(scope, content),
		);
		memoryId = memory.id;

		// Wait for convergence before delete
		const convergenceMs = getConvergenceWaitMs(ctx.manifest);
		if (convergenceMs > 0) {
			await waitForConvergence(ctx, scope, [memory.id], convergenceMs);
		}

		// Verify token is visible before delete
		const beforeResults = await executeWithRetry(() =>
			ctx.provider.retrieve_memory(scope, token, 10),
		);
		const visibleBeforeDelete = detectToken(beforeResults, token);

		if (!visibleBeforeDelete) {
			// Cleanup before returning error (avoid leaving stray test records)
			try {
				await executeWithRetry(
					() => ctx.provider.delete_memory(scope, memory.id),
					{ base_delay_ms: 250, max_delay_ms: 2000, max_retries: 2, jitter_factor: 0.25 },
				);
			} catch {
				// Ignore cleanup errors
			}

			// Token never became visible - can't test delete
			return {
				test_name: "delete_leakage",
				status: "error",
				message:
					"Could not verify token visibility before delete - test inconclusive",
				duration_ms: Date.now() - startTime,
				details: { token, memory_id: memory.id, reason: "token_not_visible_before_delete" },
			};
		}

		// Delete the memory
		await executeWithRetry(() => ctx.provider.delete_memory(scope, memory.id));

		// Wait for convergence after delete
		if (convergenceMs > 0) {
			await sleep(convergenceMs);
		}

		// Adversarial query - search for the deleted token
		const afterResults = await executeWithRetry(() =>
			ctx.provider.retrieve_memory(scope, token, 10),
		);
		const leaked = detectToken(afterResults, token);

		const duration_ms = Date.now() - startTime;

		if (leaked) {
			return {
				test_name: "delete_leakage",
				status: "fail",
				message: "Deleted content is still retrievable via adversarial query",
				duration_ms,
				details: {
					token,
					memory_id: memory.id,
					leaked_results_count: afterResults.length,
				},
			};
		}

		return {
			test_name: "delete_leakage",
			status: "pass",
			message: "Deleted content is not retrievable via adversarial queries",
			duration_ms,
			details: { token, memory_id: memory.id },
		};
	} catch (error) {
		// Best-effort cleanup if memory was created before error
		if (memoryId) {
			const idToDelete = memoryId;
			try {
				await executeWithRetry(
					() => ctx.provider.delete_memory(scope, idToDelete),
					{ base_delay_ms: 250, max_delay_ms: 2000, max_retries: 2, jitter_factor: 0.25 },
				);
			} catch {
				// Ignore cleanup errors
			}
		}

		return {
			test_name: "delete_leakage",
			status: "error",
			message: `Test error: ${error instanceof Error ? error.message : String(error)}`,
			duration_ms: Date.now() - startTime,
		};
	}
}

// =============================================================================
// Update Staleness Test (FR-006, FR-007)
// =============================================================================

/**
 * Check if update_staleness test should run.
 *
 * @param ctx - Test context with manifest
 * @returns ShouldRunResult indicating if test should run
 */
function shouldRunUpdateStaleness(ctx: TestContext): ShouldRunResult {
	const supportsUpdate =
		ctx.manifest.capabilities.optional_operations.update_memory;

	if (!supportsUpdate) {
		return {
			run: false,
			reason: "update_memory not supported",
			missing_capability: "update_memory",
		};
	}

	if (!ctx.provider.update_memory) {
		return {
			run: false,
			reason: "update_memory method not implemented",
			missing_capability: "update_memory",
		};
	}

	return { run: true };
}

/**
 * Test that old content is replaced after updates.
 *
 * Algorithm:
 * 1. Check if provider supports update_memory (skip if not)
 * 2. Write memory with unique token A
 * 3. Wait for convergence
 * 4. Update memory with new content containing token B
 * 5. Wait for convergence
 * 6. Query for token A - should NOT be found
 * 7. Query for token B - should be found
 *
 * @param ctx - Test context with provider and manifest
 * @returns Test result with pass/fail/skip status
 */
export async function runUpdateStalenessTest(
	ctx: TestContext,
): Promise<ConformanceTestResult> {
	const startTime = Date.now();

	// Check capability
	const shouldRun = shouldRunUpdateStaleness(ctx);
	if (!shouldRun.run) {
		const skipDetails: SkipDetails = {
			skip_reason: shouldRun.reason,
			missing_capability: shouldRun.missing_capability,
		};

		return {
			test_name: "update_staleness",
			status: "skip",
			message: `Skipped: ${shouldRun.reason}`,
			duration_ms: 0,
			details: skipDetails,
		};
	}

	// Define scope and track memory ID outside try for cleanup on error
	const scope: ScopeContext = {
		user_id: `doctor_update_${ctx.run_id}`,
		run_id: ctx.run_id,
		namespace: "doctor_test",
	};
	let memoryId: string | undefined;

	try {
		const tokenA = generateTestToken();
		const tokenB = generateTestToken();
		const contentA = createTestContent(tokenA, "update staleness original");
		const contentB = createTestContent(tokenB, "update staleness updated");

		// Write original memory
		const memory = await executeWithRetry(() =>
			ctx.provider.add_memory(scope, contentA),
		);
		memoryId = memory.id;

		// Wait for convergence
		const convergenceMs = getConvergenceWaitMs(ctx.manifest);
		if (convergenceMs > 0) {
			await waitForConvergence(ctx, scope, [memory.id], convergenceMs);
		}

		// Update memory with new content
		// shouldRunUpdateStaleness ensures update_memory is implemented when this test runs.
		const updateMemory = ctx.provider.update_memory;
		if (!updateMemory) {
			throw new Error("update_memory method not implemented");
		}

		await executeWithRetry(() => updateMemory(scope, memory.id, contentB));

		// Wait for convergence after update
		if (convergenceMs > 0) {
			await sleep(convergenceMs);
		}

		// Query for old token A - should NOT be found
		const resultsA = await executeWithRetry(() =>
			ctx.provider.retrieve_memory(scope, tokenA, 10),
		);
		const foundOldToken = detectToken(resultsA, tokenA);

		// Query for new token B - should be found
		const resultsB = await executeWithRetry(() =>
			ctx.provider.retrieve_memory(scope, tokenB, 10),
		);
		const foundNewToken = detectToken(resultsB, tokenB);

		// Cleanup
		try {
			await executeWithRetry(
				() => ctx.provider.delete_memory(scope, memory.id),
				{
					base_delay_ms: 250,
					max_delay_ms: 2000,
					max_retries: 2,
					jitter_factor: 0.25,
				},
			);
		} catch (error) {
			// Cleanup should never fail the test, but surface auth issues clearly.
			const message = error instanceof Error ? error.message : String(error);
			if (isAuthErrorMessage(message)) {
				throw error;
			}
		}

		const duration_ms = Date.now() - startTime;

		if (foundOldToken) {
			return {
				test_name: "update_staleness",
				status: "fail",
				message: "Old content is still retrievable after update",
				duration_ms,
				details: {
					old_token: tokenA,
					new_token: tokenB,
					memory_id: memory.id,
					old_token_found: foundOldToken,
					new_token_found: foundNewToken,
				},
			};
		}

		if (!foundNewToken) {
			return {
				test_name: "update_staleness",
				status: "fail",
				message: "Updated content is not retrievable",
				duration_ms,
				details: {
					old_token: tokenA,
					new_token: tokenB,
					memory_id: memory.id,
					old_token_found: foundOldToken,
					new_token_found: foundNewToken,
				},
			};
		}

		return {
			test_name: "update_staleness",
			status: "pass",
			message:
				"Old content replaced after update - stale content not retrievable",
			duration_ms,
			details: {
				old_token: tokenA,
				new_token: tokenB,
				memory_id: memory.id,
			},
		};
	} catch (error) {
		// Best-effort cleanup if memory was created before error
		if (memoryId) {
			const idToDelete = memoryId;
			try {
				await executeWithRetry(
					() => ctx.provider.delete_memory(scope, idToDelete),
					{ base_delay_ms: 250, max_delay_ms: 2000, max_retries: 2, jitter_factor: 0.25 },
				);
			} catch {
				// Ignore cleanup errors
			}
		}

		return {
			test_name: "update_staleness",
			status: "error",
			message: `Test error: ${error instanceof Error ? error.message : String(error)}`,
			duration_ms: Date.now() - startTime,
		};
	}
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Wait for convergence using provider's await_convergence if available,
 * or fall back to simple sleep.
 *
 * @param ctx - Test context
 * @param scope - Scope context
 * @param ingestedIds - IDs of recently ingested memories
 * @param waitMs - Time to wait in milliseconds
 */
async function waitForConvergence(
	ctx: TestContext,
	scope: ScopeContext,
	ingestedIds: string[],
	waitMs: number,
): Promise<void> {
	if (ctx.provider.await_convergence) {
		await ctx.provider.await_convergence(scope, ingestedIds, waitMs);
	} else {
		await sleep(waitMs);
	}
}
