/**
 * CRUD Semantics Benchmark - Live Integration Test
 *
 * Tests the benchmark against LocalBaseline provider with real execution.
 * Gated by RUN_LIVE_TESTS=1 environment variable.
 *
 * @see specs/014-crud-semantics-benchmark/tasks.md T022-T023
 */

import { describe, expect, test, beforeAll } from "bun:test";
import crudBenchmark from "../../benchmarks/CRUD-semantics/index";
import type { ScopeContext } from "../../types/core";
import type { BaseProvider } from "../../types/provider";

// Skip all tests if RUN_LIVE_TESTS is not set
const LIVE_TESTS_ENABLED = process.env.RUN_LIVE_TESTS === "1";

describe.skipIf(!LIVE_TESTS_ENABLED)("CRUD Semantics Benchmark - Live Integration", () => {
	let provider: BaseProvider;
	let scope: ScopeContext;

	beforeAll(async () => {
		// Import LocalBaseline provider dynamically
		const providerModule = await import("../../providers/LocalBaseline/index");
		provider = providerModule.default;

		// Create a unique scope for test isolation
		scope = {
			user_id: `test_user_${Date.now()}`,
			run_id: `test_run_crud_${Date.now()}`,
			session_id: `test_session_${Date.now()}`,
		};
	});

	test("benchmark meta has correct properties", () => {
		expect(crudBenchmark.meta.name).toBe("CRUD-semantics");
		expect(crudBenchmark.meta.version).toBe("1.0.0");
		expect(crudBenchmark.meta.required_capabilities).toContain("add_memory");
		expect(crudBenchmark.meta.required_capabilities).toContain("retrieve_memory");
		expect(crudBenchmark.meta.required_capabilities).toContain("delete_memory");
	});

	test("cases() returns all expected case types", () => {
		const cases = Array.from(crudBenchmark.cases());

		// Should have write_retrieve cases
		const writeRetrieveCases = cases.filter((c) => c.id.startsWith("write_retrieve"));
		expect(writeRetrieveCases.length).toBeGreaterThan(0);

		// Should have delete_leakage cases
		const deleteLeakageCases = cases.filter((c) => c.id.startsWith("delete_leakage"));
		expect(deleteLeakageCases.length).toBeGreaterThan(0);

		// Should have update_staleness cases
		const updateStalenessCases = cases.filter((c) => c.id.startsWith("update_staleness"));
		expect(updateStalenessCases.length).toBeGreaterThan(0);
	});

	test("write_retrieve case passes with LocalBaseline", async () => {
		const cases = Array.from(crudBenchmark.cases());
		const writeRetrieveCase = cases.find((c) => c.id === "write_retrieve_01");
		if (!writeRetrieveCase) throw new Error("write_retrieve_01 case not found");

		const result = await crudBenchmark.run_case(provider, scope, writeRetrieveCase);

		expect(result.case_id).toBe("write_retrieve_01");
		expect(result.status).toBe("pass");
		expect(result.scores.write_retrieve_success).toBe(1);
		expect(result.duration_ms).toBeGreaterThanOrEqual(0);
		expect(result.scores.add_latency_ms).toBeGreaterThanOrEqual(0);
		expect(result.scores.retrieve_latency_ms).toBeGreaterThanOrEqual(0);
	});

	test("delete_leakage case passes with LocalBaseline", async () => {
		const cases = Array.from(crudBenchmark.cases());
		const deleteLeakageCase = cases.find((c) => c.id === "delete_leakage_01");
		if (!deleteLeakageCase) throw new Error("delete_leakage_01 case not found");

		const result = await crudBenchmark.run_case(provider, scope, deleteLeakageCase);

		expect(result.case_id).toBe("delete_leakage_01");
		expect(result.status).toBe("pass");
		expect(result.scores.delete_leakage_count).toBe(0);
		expect(result.duration_ms).toBeGreaterThanOrEqual(0);
		expect(result.scores.delete_latency_ms).toBeGreaterThanOrEqual(0);
	});

	test("update_staleness case skips when provider lacks update_memory", async () => {
		const cases = Array.from(crudBenchmark.cases());
		const updateStalenessCase = cases.find((c) => c.id === "update_staleness_01");
		if (!updateStalenessCase) throw new Error("update_staleness_01 case not found");

		const result = await crudBenchmark.run_case(provider, scope, updateStalenessCase);

		expect(result.case_id).toBe("update_staleness_01");
		// LocalBaseline doesn't support update_memory, so it should skip
		expect(result.status).toBe("skip");
	});

	test("all cases execute without errors", async () => {
		const cases = Array.from(crudBenchmark.cases());

		for (const benchmarkCase of cases) {
			const result = await crudBenchmark.run_case(provider, scope, benchmarkCase);

			// No errors should occur
			expect(result.status).not.toBe("error");

			// Duration should be tracked
			expect(result.duration_ms).toBeGreaterThanOrEqual(0);

			// Scores should be an object
			expect(typeof result.scores).toBe("object");
		}
	});

	test("metrics contain expected fields for write_retrieve", async () => {
		const cases = Array.from(crudBenchmark.cases());
		const writeRetrieveCase = cases.find((c) => c.id === "write_retrieve_01");
		if (!writeRetrieveCase) throw new Error("write_retrieve_01 case not found");

		const result = await crudBenchmark.run_case(provider, scope, writeRetrieveCase);

		// Check all expected metric fields exist
		expect(result.scores).toHaveProperty("write_retrieve_success");
		expect(result.scores).toHaveProperty("staleness_violation_count");
		expect(result.scores).toHaveProperty("delete_leakage_count");
		expect(result.scores).toHaveProperty("add_latency_ms");
		expect(result.scores).toHaveProperty("retrieve_latency_ms");
		expect(result.scores).toHaveProperty("update_latency_ms");
		expect(result.scores).toHaveProperty("delete_latency_ms");
	});

	test("metrics contain expected fields for delete_leakage", async () => {
		const cases = Array.from(crudBenchmark.cases());
		const deleteLeakageCase = cases.find((c) => c.id === "delete_leakage_01");
		if (!deleteLeakageCase) throw new Error("delete_leakage_01 case not found");

		const result = await crudBenchmark.run_case(provider, scope, deleteLeakageCase);

		// Check metric values are correct types
		expect(typeof result.scores.delete_leakage_count).toBe("number");
		expect(typeof result.scores.add_latency_ms).toBe("number");
		expect(typeof result.scores.delete_latency_ms).toBe("number");
		expect(typeof result.scores.retrieve_latency_ms).toBe("number");
	});
});

// Non-gated tests that can run without RUN_LIVE_TESTS
describe("CRUD Semantics Benchmark - Unit Tests", () => {
	test("benchmark exports correctly", () => {
		expect(crudBenchmark).toBeDefined();
		expect(crudBenchmark.meta).toBeDefined();
		expect(crudBenchmark.cases).toBeDefined();
		expect(crudBenchmark.run_case).toBeDefined();
	});

	test("cases() is iterable", () => {
		const cases = crudBenchmark.cases();
		expect(typeof cases[Symbol.iterator]).toBe("function");
	});

	test("all cases have required fields", () => {
		const cases = Array.from(crudBenchmark.cases());

		for (const benchmarkCase of cases) {
			expect(benchmarkCase.id).toBeDefined();
			expect(typeof benchmarkCase.id).toBe("string");
			expect(benchmarkCase.input).toBeDefined();
			expect(typeof benchmarkCase.input).toBe("object");
		}
	});
});
