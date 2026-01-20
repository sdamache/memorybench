/**
 * Doctor Command Type Definitions
 *
 * Type definitions for the doctor command conformance testing system.
 * These types define the contracts for test results, reports, and options.
 *
 * @module src/doctor/types
 * @see specs/017-doctor-command/spec.md
 */

import type { ProviderManifest } from "../../types/manifest";
import type { BaseProvider } from "../../types/provider";

// =============================================================================
// Test Result Types
// =============================================================================

/**
 * Status of a single conformance test.
 */
export type ConformanceTestStatus = "pass" | "fail" | "skip" | "error";

/**
 * Names of available conformance tests.
 */
export type ConformanceTestName =
	| "scope_isolation"
	| "visibility_delay"
	| "delete_leakage"
	| "update_staleness";

/**
 * Result of a single conformance test execution.
 *
 * @example
 * ```typescript
 * const result: ConformanceTestResult = {
 *   test_name: "scope_isolation",
 *   status: "pass",
 *   message: "Data written to scope A is not retrievable from scope B",
 *   duration_ms: 1234,
 *   details: { scope_a_user_id: "user_123", scope_b_user_id: "user_456" }
 * };
 * ```
 */
export interface ConformanceTestResult {
	/** Unique identifier for the test */
	test_name: ConformanceTestName;

	/** Test outcome */
	status: ConformanceTestStatus;

	/** Human-readable result description */
	message: string;

	/** Test execution time in milliseconds */
	duration_ms: number;

	/** Optional test-specific data (varies by test type) */
	details?: Record<string, unknown>;
}

// =============================================================================
// Visibility Delay Types
// =============================================================================

/**
 * Individual measurement from visibility delay test.
 * Multiple samples are collected to calculate p95/max for suggested wait time.
 */
export interface VisibilityDelaySample {
	/** Sample number (1-indexed) */
	sample_index: number;

	/** Unique token used for this sample */
	token: string;

	/** Time to write memory in milliseconds */
	write_time_ms: number;

	/** Time until token became visible (null if timed out) */
	visibility_time_ms: number | null;

	/** Total sample duration in milliseconds */
	total_time_ms: number;
}

/**
 * Extended details for the visibility_delay test result.
 */
export interface VisibilityDelayDetails extends Record<string, unknown> {
	/** Array of individual samples */
	samples: VisibilityDelaySample[];

	/** Number of successful samples (token became visible) */
	successful_samples: number;

	/** Number of timed out samples */
	timed_out_samples: number;

	/** Calculated p95 of visibility times (null if all timed out) */
	p95_visibility_ms: number | null;

	/** Maximum observed visibility time (null if all timed out) */
	max_visibility_ms: number | null;

	/** Timeout used for polling in milliseconds */
	timeout_ms: number;
}

// =============================================================================
// Skip Reason Types
// =============================================================================

/**
 * Extended details for a skipped test.
 */
export interface SkipDetails extends Record<string, unknown> {
	/** Reason the test was skipped */
	skip_reason: string;

	/** Capability that was missing (if applicable) */
	missing_capability?: string;
}

// =============================================================================
// Report Types
// =============================================================================

/**
 * Overall status of the conformance report.
 */
export type ConformanceReportStatus = "pass" | "fail" | "partial";

/**
 * Complete conformance report aggregating all test results.
 *
 * @example
 * ```typescript
 * const report: ConformanceReport = {
 *   provider_name: "supermemory",
 *   provider_version: "1.0.0",
 *   timestamp: "2026-01-18T10:30:00.000Z",
 *   duration_ms: 5432,
 *   tests: [...],
 *   suggested_convergence_wait_ms: 2500,
 *   overall_status: "pass"
 * };
 * ```
 */
export interface ConformanceReport {
	/** Name of the tested provider (from manifest) */
	provider_name: string;

	/** Version of the tested provider (from manifest) */
	provider_version: string;

	/** ISO 8601 timestamp of run start */
	timestamp: string;

	/** Total run duration in milliseconds */
	duration_ms: number;

	/** Array of individual test results */
	tests: ConformanceTestResult[];

	/** Recommended convergence_wait_ms (null if visibility test skipped/errored) */
	suggested_convergence_wait_ms: number | null;

	/** Summary status of all tests */
	overall_status: ConformanceReportStatus;
}

// =============================================================================
// CLI Options Types
// =============================================================================

/**
 * Options for the doctor command.
 */
export interface DoctorOptions {
	/** Provider name to test (required) */
	provider: string;

	/** Whether to output JSON instead of console (default: false) */
	json_output: boolean;

	/** Custom path for JSON output (default: doctor_report.json) */
	output_path?: string;
}

// =============================================================================
// Test Context Types
// =============================================================================

/**
 * Context passed to individual conformance tests.
 */
export interface TestContext {
	/** The provider being tested */
	provider: BaseProvider;

	/** Provider manifest for capability checking */
	manifest: ProviderManifest;

	/** Unique run identifier for scope isolation */
	run_id: string;

	/** Maximum timeout for visibility delay polling (ms) */
	visibility_timeout_ms: number;

	/** Number of samples for visibility delay measurement */
	visibility_samples: number;
}

// =============================================================================
// Helper Types
// =============================================================================

/**
 * Result of checking whether a test should run.
 */
export type ShouldRunResult =
	| { run: true }
	| { run: false; reason: string; missing_capability?: string };

/**
 * Function signature for a conformance test implementation.
 */
export type ConformanceTestFn = (
	ctx: TestContext,
) => Promise<ConformanceTestResult>;
