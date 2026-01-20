/**
 * Doctor Command Report Formatters
 *
 * Console and JSON report formatting for conformance test results.
 *
 * @module src/doctor/report
 * @see specs/017-doctor-command/quickstart.md
 */

import type {
	ConformanceReport,
	ConformanceTestResult,
	SkipDetails,
	VisibilityDelayDetails,
} from "./types";

// =============================================================================
// Console Formatting
// =============================================================================

/**
 * Format a conformance report for human-readable console output.
 *
 * @param report - Conformance report to format
 * @returns Formatted string for console display
 *
 * @example Output:
 * ```
 * Doctor Report: LocalBaseline v1.0.0
 * ============================================
 * Timestamp: 2026-01-18T10:30:00.000Z
 * Duration: 5.43s
 *
 * Tests:
 *   ✓ scope_isolation      PASS  (1.2s)
 *     Data written to scope A is not retrievable from scope B
 *
 *   ✓ visibility_delay     PASS  (2.1s)
 *     Read-after-write visibility: p95=0ms, max=5ms
 *     Suggested convergence_wait_ms: 10
 *
 * ============================================
 * Overall: PASS (3 passed, 1 skipped)
 * ```
 */
export function formatConsoleReport(report: ConformanceReport): string {
	const lines: string[] = [];

	// Header
	lines.push(
		`\nDoctor Report: ${report.provider_name} v${report.provider_version}`,
	);
	lines.push("=".repeat(60));
	lines.push(`Timestamp: ${report.timestamp}`);
	lines.push(`Duration: ${(report.duration_ms / 1000).toFixed(2)}s`);
	lines.push("");

	// Tests
	lines.push("Tests:");
	for (const test of report.tests) {
		lines.push(formatTestResult(test));
	}

	// Footer
	lines.push("=".repeat(60));
	const counts = countResults(report.tests);
	lines.push(
		`Overall: ${report.overall_status.toUpperCase()} (${counts.passed} passed, ${counts.skipped} skipped, ${counts.failed} failed, ${counts.errored} errored)`,
	);

	if (report.suggested_convergence_wait_ms !== null) {
		lines.push(
			`Suggested convergence_wait_ms: ${report.suggested_convergence_wait_ms}`,
		);
	}

	lines.push("");

	return lines.join("\n");
}

/**
 * Format a single test result for console output.
 */
function formatTestResult(test: ConformanceTestResult): string {
	const lines: string[] = [];

	// Status icon and test name
	const icon = getStatusIcon(test.status);
	const status = test.status.toUpperCase().padEnd(5);
	const duration = `(${(test.duration_ms / 1000).toFixed(1)}s)`;
	const testName = test.test_name.padEnd(20);

	lines.push(`  ${icon} ${testName} ${status} ${duration}`);
	lines.push(`    ${test.message}`);

	// Add details for specific tests
	if (test.test_name === "visibility_delay" && test.status === "pass") {
		const detailsCandidate = test.details;
		if (isVisibilityDelayDetails(detailsCandidate)) {
			const details = detailsCandidate;

			// Avoid duplicating p95/max if the message already includes them.
			const msg = test.message.toLowerCase();
			const mentionsP95 = msg.includes("p95=");
			const mentionsMax = msg.includes("max=");

			if (
				(!mentionsP95 || !mentionsMax) &&
				(details.p95_visibility_ms !== null ||
					details.max_visibility_ms !== null)
			) {
				lines.push(
					`    p95=${details.p95_visibility_ms ?? "n/a"}ms, max=${details.max_visibility_ms ?? "n/a"}ms`,
				);
			}
		}
	}

	if (test.status === "skip") {
		const detailsCandidate = test.details;
		if (isSkipDetails(detailsCandidate)) {
			const details = detailsCandidate;
			if (details.missing_capability) {
				lines.push(`    Missing capability: ${details.missing_capability}`);
			}
		}
	}

	lines.push("");

	return lines.join("\n");
}

function isVisibilityDelayDetails(
	value: unknown,
): value is VisibilityDelayDetails {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	const record = value as Record<string, unknown>;

	if (!Array.isArray(record.samples)) {
		return false;
	}
	if (typeof record.successful_samples !== "number") {
		return false;
	}
	if (typeof record.timed_out_samples !== "number") {
		return false;
	}
	if (!("p95_visibility_ms" in record)) {
		return false;
	}
	if (!("max_visibility_ms" in record)) {
		return false;
	}
	if (!("timeout_ms" in record) || typeof record.timeout_ms !== "number") {
		return false;
	}

	const p95 = record.p95_visibility_ms;
	if (p95 !== null && typeof p95 !== "number") {
		return false;
	}

	const max = record.max_visibility_ms;
	if (max !== null && typeof max !== "number") {
		return false;
	}

	return true;
}

function isSkipDetails(value: unknown): value is SkipDetails {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	const record = value as Record<string, unknown>;
	if (typeof record.skip_reason !== "string") {
		return false;
	}

	if (
		"missing_capability" in record &&
		record.missing_capability !== undefined &&
		typeof record.missing_capability !== "string"
	) {
		return false;
	}

	return true;
}

/**
 * Get status icon for display.
 */
function getStatusIcon(status: ConformanceTestResult["status"]): string {
	switch (status) {
		case "pass":
			return "✓";
		case "fail":
			return "✗";
		case "skip":
			return "⊘";
		case "error":
			return "⚠";
	}
}

/**
 * Count test results by status.
 */
function countResults(tests: ConformanceTestResult[]): {
	passed: number;
	failed: number;
	skipped: number;
	errored: number;
} {
	return {
		passed: tests.filter((t) => t.status === "pass").length,
		failed: tests.filter((t) => t.status === "fail").length,
		skipped: tests.filter((t) => t.status === "skip").length,
		errored: tests.filter((t) => t.status === "error").length,
	};
}

// =============================================================================
// JSON Formatting
// =============================================================================

/**
 * Format a conformance report as machine-parseable JSON.
 *
 * @param report - Conformance report to format
 * @returns JSON string
 */
export function formatJsonReport(report: ConformanceReport): string {
	return JSON.stringify(report, null, 2);
}

/**
 * Write a conformance report to a JSON file.
 *
 * @param report - Conformance report to write
 * @param outputPath - Path to output file
 */
export async function writeJsonReport(
	report: ConformanceReport,
	outputPath: string,
): Promise<void> {
	const json = formatJsonReport(report);
	await Bun.write(outputPath, json);
}
