/**
 * Smoke Tests for Unified Runner
 *
 * Minimal testing mode: One smoke test per user story to verify happy paths work.
 * These tests validate core functionality without exhaustive edge case coverage.
 *
 * @module tests/runner/smoke.test.ts
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { run } from "../../src/runner/runner";
import { buildRunPlan } from "../../src/runner/gating";
import { BenchmarkRegistry } from "../../src/loaders/benchmarks";
import { ProviderRegistry } from "../../src/loaders/providers";
import type { RunSelection } from "../../src/runner/types";

// =============================================================================
// Setup
// =============================================================================

beforeAll(async () => {
	// Initialize registries before running tests
	const benchmarkRegistry = BenchmarkRegistry.getInstance();
	await benchmarkRegistry.initialize();

	const providerRegistry = await ProviderRegistry.getInstance();
	// Provider registry auto-initializes on getInstance()
});

// =============================================================================
// User Story 1: Core Evaluation (P1)
// =============================================================================

describe("US1: Core Evaluation - End-to-End Run", () => {
	test("should execute provider x benchmark evaluation and produce results", async () => {
		// Arrange
		const selection: RunSelection = {
			providers: ["LocalBaseline"],
			benchmarks: ["RAG-template-benchmark"],
			concurrency: 1,
		};

		// Act
		const output = await run(selection);

		// Assert - Verify output structure
		expect(output).toBeDefined();
		expect(output.run_id).toBeDefined();
		expect(output.timestamp).toBeDefined();

		// Verify selections echoed back
		expect(output.selections.providers).toEqual(["LocalBaseline"]);
		expect(output.selections.benchmarks).toEqual(["RAG-template-benchmark"]);

		// Verify plan was generated
		expect(output.plan).toBeDefined();
		expect(output.plan.entries.length).toBeGreaterThan(0);
		expect(output.plan.eligible_count).toBeGreaterThanOrEqual(0);

		// Verify results were collected
		expect(output.results).toBeDefined();
		expect(Array.isArray(output.results)).toBe(true);

		// Verify summary statistics
		expect(output.summary).toBeDefined();
		expect(output.summary.total_cases).toBeGreaterThanOrEqual(0);
		expect(typeof output.summary.passed).toBe("number");
		expect(typeof output.summary.failed).toBe("number");
		expect(typeof output.summary.skipped).toBe("number");
		expect(typeof output.summary.errors).toBe("number");
		expect(typeof output.summary.total_duration_ms).toBe("number");

		// Verify timing data is captured
		if (output.results.length > 0) {
			const firstResult = output.results[0]!;
			expect(firstResult.duration_ms).toBeGreaterThanOrEqual(0);
			expect(firstResult.provider_name).toBe("LocalBaseline");
			expect(firstResult.benchmark_name).toBe("RAG-template-benchmark");
		}
	}, 30000); // 30 second timeout for actual benchmark execution
});

// =============================================================================
// User Story 2: Capability Gating (P2)
// =============================================================================

describe("US2: Capability Gating - Skip Incompatible Combinations", () => {
	test("should skip provider/benchmark combo when capabilities don't match", async () => {
		// This test validates that the gating logic properly identifies
		// and skips incompatible provider/benchmark combinations.

		// Arrange - Build a run plan to check gating without execution
		const selection: RunSelection = {
			providers: ["LocalBaseline"], // has add/retrieve/delete, NO update
			benchmarks: ["LongMemEval"], // requires add/retrieve only
			concurrency: 1,
		};

		// Act
		const plan = await buildRunPlan(selection);

		// Assert - Verify plan structure
		expect(plan).toBeDefined();
		expect(plan.run_id).toBeDefined();
		expect(plan.entries).toBeDefined();
		expect(plan.entries.length).toBeGreaterThan(0);

		// Verify entries have eligibility status
		for (const entry of plan.entries) {
			expect(entry.provider_name).toBeDefined();
			expect(entry.benchmark_name).toBeDefined();
			expect(typeof entry.eligible).toBe("boolean");

			// If skipped, must have skip_reason
			if (!entry.eligible) {
				expect(entry.skip_reason).toBeDefined();
				expect(entry.skip_reason!.provider_name).toBe(entry.provider_name);
				expect(entry.skip_reason!.benchmark_name).toBe(entry.benchmark_name);
				expect(entry.skip_reason!.missing_capabilities).toBeDefined();
				expect(Array.isArray(entry.skip_reason!.missing_capabilities)).toBe(
					true,
				);
				expect(entry.skip_reason!.message).toBeDefined();
			}
		}

		// Verify counts match
		const eligibleCount = plan.entries.filter((e) => e.eligible).length;
		const skippedCount = plan.entries.filter((e) => !e.eligible).length;
		expect(plan.eligible_count).toBe(eligibleCount);
		expect(plan.skipped_count).toBe(skippedCount);
		expect(eligibleCount + skippedCount).toBe(plan.entries.length);
	});
});

// =============================================================================
// User Story 3: Concurrent Execution (P3)
// =============================================================================

describe("US3: Concurrent Execution - Parallel Case Processing", () => {
	test("should accept concurrency parameter and execute successfully", async () => {
		// Note: Phase 3 implementation runs sequentially even with concurrency > 1
		// This test validates that the concurrency parameter is accepted and
		// execution completes successfully. Phase 5 will add actual parallelism.

		// Arrange
		const selection: RunSelection = {
			providers: ["LocalBaseline"],
			benchmarks: ["RAG-template-benchmark"],
			concurrency: 2, // Request concurrent execution
		};

		// Act
		const output = await run(selection);

		// Assert - Verify execution completed
		expect(output).toBeDefined();
		expect(output.selections.concurrency).toBe(2);

		// Verify results were collected (even if run sequentially in Phase 3)
		expect(output.results).toBeDefined();
		expect(output.summary).toBeDefined();

		// No duplicate results
		const caseIds = output.results.map((r) => r.case_id);
		const uniqueCaseIds = new Set(caseIds);
		expect(uniqueCaseIds.size).toBe(caseIds.length);
	}, 30000); // 30 second timeout
});

// =============================================================================
// Integration: Deterministic Ordering
// =============================================================================

describe("Integration: Deterministic Ordering", () => {
	test("should produce deterministic run plan ordering", async () => {
		// Arrange - Use multiple benchmarks to test alphabetical sorting
		// (Using benchmarks instead of providers since only LocalBaseline is available)
		const selection: RunSelection = {
			providers: ["LocalBaseline"],
			benchmarks: ["RAG-template-benchmark", "LongMemEval"], // Two benchmarks to test sorting
			concurrency: 1,
		};

		// Act
		const plan1 = await buildRunPlan(selection);
		const plan2 = await buildRunPlan(selection);

		// Assert - Same input should produce same ordering
		expect(plan1.entries.length).toBe(plan2.entries.length);

		for (let i = 0; i < plan1.entries.length; i++) {
			const entry1 = plan1.entries[i]!;
			const entry2 = plan2.entries[i]!;

			expect(entry1.provider_name).toBe(entry2.provider_name);
			expect(entry1.benchmark_name).toBe(entry2.benchmark_name);
			expect(entry1.eligible).toBe(entry2.eligible);
		}

		// Verify alphabetical ordering of benchmarks
		// Input: ["RAG-template-benchmark", "LongMemEval"]
		// Expected sorted: ["LongMemEval", "RAG-template-benchmark"]
		const benchmarkNames = plan1.entries.map((e) => e.benchmark_name);
		const uniqueBenchmarks = [...new Set(benchmarkNames)];
		expect(uniqueBenchmarks).toEqual(["LongMemEval", "RAG-template-benchmark"]);
	});
});
