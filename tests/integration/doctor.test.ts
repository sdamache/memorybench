/**
 * Doctor Command Live Integration Tests
 *
 * These tests run against real provider infrastructure (LocalBaseline).
 * No mocks - tests actual behavior.
 *
 * @module tests/integration/doctor.test.ts
 * @see specs/017-doctor-command/tasks.md (Test Mode: Minimal)
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { runDoctor } from "../../src/doctor";
import type { ConformanceReport } from "../../src/doctor/types";
import { ProviderRegistry } from "../../src/loaders/providers";
import { unlink } from "node:fs/promises";

describe("Doctor Command - Live Integration Tests", () => {
	// Reset provider registry before tests to ensure clean state
	beforeAll(() => {
		ProviderRegistry.reset();
	});

	// Clean up any generated files after tests
	afterAll(async () => {
		try {
			await unlink("doctor_report.json");
		} catch {
			// Ignore if file doesn't exist
		}
	});

	// =========================================================================
	// User Story 1: Run Basic Conformance Checks
	// =========================================================================

	test("US1: doctor runs all conformance tests against LocalBaseline", async () => {
		// Run doctor against LocalBaseline provider
		const report = await runDoctor({
			provider: "LocalBaseline",
			json_output: false,
		});

		// Verify report structure
		expect(report.provider_name).toBe("LocalBaseline");
		expect(report.provider_version).toBe("1.0.0");
		expect(report.timestamp).toBeTruthy();
		expect(report.duration_ms).toBeGreaterThan(0);

		// Verify all 4 tests ran
		expect(report.tests).toHaveLength(4);
		const testNames = report.tests.map((t) => t.test_name);
		expect(testNames).toContain("scope_isolation");
		expect(testNames).toContain("visibility_delay");
		expect(testNames).toContain("delete_leakage");
		expect(testNames).toContain("update_staleness");

		// LocalBaseline should pass scope_isolation, visibility_delay, delete_leakage
		// LocalBaseline should skip update_staleness (doesn't support update_memory)
		const scopeTest = report.tests.find((t) => t.test_name === "scope_isolation");
		const visibilityTest = report.tests.find((t) => t.test_name === "visibility_delay");
		const deleteTest = report.tests.find((t) => t.test_name === "delete_leakage");
		const updateTest = report.tests.find((t) => t.test_name === "update_staleness");

		expect(scopeTest?.status).toBe("pass");
		expect(visibilityTest?.status).toBe("pass");
		expect(deleteTest?.status).toBe("pass");
		expect(updateTest?.status).toBe("skip"); // LocalBaseline doesn't support update_memory

		// Overall status should be pass (all required tests pass, update_staleness is skipped)
		expect(report.overall_status).toBe("pass");
	}, 60000); // 60 second timeout for full test suite

	test("US1: doctor outputs JSON report when --json flag is used", async () => {
		// Run doctor with JSON output
		const report = await runDoctor({
			provider: "LocalBaseline",
			json_output: true,
			output_path: "doctor_report.json",
		});

		// Verify report was created
		const file = Bun.file("doctor_report.json");
		expect(await file.exists()).toBe(true);

		// Verify JSON content matches report
		const jsonContent = await file.json();
		expect(jsonContent.provider_name).toBe(report.provider_name);
		expect(jsonContent.tests).toHaveLength(4);
	}, 60000);

	test("US1: doctor throws error for unknown provider", async () => {
		await expect(
			runDoctor({
				provider: "NonExistentProvider",
				json_output: false,
			}),
		).rejects.toThrow(/Provider 'NonExistentProvider' not found/);
	});

	// =========================================================================
	// User Story 2: Measure Visibility Delay
	// =========================================================================

	test("US2: visibility delay test measures timing and provides samples", async () => {
		const report = await runDoctor({
			provider: "LocalBaseline",
			json_output: false,
		});

		const visibilityTest = report.tests.find((t) => t.test_name === "visibility_delay");
		expect(visibilityTest).toBeDefined();
		expect(visibilityTest?.status).toBe("pass");

		// Verify details contain timing information
		const details = visibilityTest?.details as {
			samples: Array<{ visibility_time_ms: number | null }>;
			p95_visibility_ms: number | null;
			max_visibility_ms: number | null;
		};

		expect(details).toBeDefined();
		expect(Array.isArray(details.samples)).toBe(true);
		expect(details.samples.length).toBeGreaterThan(0);

		// LocalBaseline is synchronous, so visibility should be immediate (0ms or very small)
		expect(details.p95_visibility_ms).toBeDefined();
		expect(details.max_visibility_ms).toBeDefined();

		// For LocalBaseline (synchronous), suggested_convergence_wait_ms should be small
		// It could be null if visibility is immediate (0ms * 1.2 = 0, rounded)
		// or a small value based on measurement overhead
		if (report.suggested_convergence_wait_ms !== null) {
			expect(report.suggested_convergence_wait_ms).toBeLessThan(1000);
		}
	}, 60000);

	// =========================================================================
	// User Story 3: Scope Isolation Check
	// =========================================================================

	test("US3: scope isolation test verifies data isolation between scopes", async () => {
		const report = await runDoctor({
			provider: "LocalBaseline",
			json_output: false,
		});

		const scopeTest = report.tests.find((t) => t.test_name === "scope_isolation");
		expect(scopeTest).toBeDefined();
		expect(scopeTest?.status).toBe("pass");
		expect(scopeTest?.message).toContain("not retrievable from scope B");

		// Verify details contain scope information
		const details = scopeTest?.details as {
			scope_a_user_id: string;
			scope_b_user_id: string;
		};

		expect(details).toBeDefined();
		expect(details.scope_a_user_id).toBeTruthy();
		expect(details.scope_b_user_id).toBeTruthy();
		expect(details.scope_a_user_id).not.toBe(details.scope_b_user_id);
	}, 60000);

	// =========================================================================
	// User Story 4: Delete Leakage Check
	// =========================================================================

	test("US4: delete leakage test verifies deleted content is not retrievable", async () => {
		const report = await runDoctor({
			provider: "LocalBaseline",
			json_output: false,
		});

		const deleteTest = report.tests.find((t) => t.test_name === "delete_leakage");
		expect(deleteTest).toBeDefined();
		expect(deleteTest?.status).toBe("pass");
		expect(deleteTest?.message).toContain("not retrievable");

		// Verify details contain test information
		const details = deleteTest?.details as {
			token: string;
			memory_id: string;
		};

		expect(details).toBeDefined();
		expect(details.token).toContain("DOCTOR_TOKEN_");
		expect(details.memory_id).toBeTruthy();
	}, 60000);

	// =========================================================================
	// User Story 5: Update Staleness Check (Capability-Gated)
	// =========================================================================

	test("US5: update staleness test is skipped when provider lacks update_memory", async () => {
		const report = await runDoctor({
			provider: "LocalBaseline",
			json_output: false,
		});

		const updateTest = report.tests.find((t) => t.test_name === "update_staleness");
		expect(updateTest).toBeDefined();
		expect(updateTest?.status).toBe("skip");
		expect(updateTest?.message).toContain("update_memory not supported");

		// Verify details contain skip reason
		const details = updateTest?.details as {
			skip_reason: string;
			missing_capability: string;
		};

		expect(details).toBeDefined();
		expect(details.skip_reason).toBeTruthy();
		expect(details.missing_capability).toBe("update_memory");
	}, 60000);
});
