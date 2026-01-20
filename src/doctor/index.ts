/**
 * Doctor Command Orchestrator
 *
 * Main entry point for the doctor conformance testing command.
 * Orchestrates provider loading, test execution, and report generation.
 *
 * @module src/doctor/index
 * @see specs/017-doctor-command/spec.md
 */

import type { ScopeContext } from "../../types/core";
import { ProviderRegistry } from "../loaders/providers";
import { retryExecutor } from "../runner/retry";
import { formatConsoleReport, writeJsonReport } from "./report";
import {
	runDeleteLeakageTest,
	runScopeIsolationTest,
	runUpdateStalenessTest,
	runVisibilityDelayTest,
} from "./tests";
import type {
	ConformanceReport,
	ConformanceReportStatus,
	ConformanceTestResult,
	DoctorOptions,
	TestContext,
} from "./types";
import type { VisibilityDelayDetails } from "./types";
import { isAuthErrorMessage } from "./utils";

// =============================================================================
// Constants
// =============================================================================

/** Default timeout for visibility delay polling (30 seconds per FR-003) */
const DEFAULT_VISIBILITY_TIMEOUT_MS = 30000;

/** Default number of samples for visibility delay measurement */
const DEFAULT_VISIBILITY_SAMPLES = 3;

// =============================================================================
// Doctor Orchestrator
// =============================================================================

/**
 * Run the doctor conformance tests against a provider.
 *
 * @param options - Doctor command options
 * @returns Conformance report with all test results
 * @throws Error if provider not found or authentication fails
 *
 * @example
 * ```typescript
 * const report = await runDoctor({ provider: "LocalBaseline", json_output: false });
 * console.log(report.overall_status); // "pass" | "fail" | "partial"
 * ```
 */
export async function runDoctor(
	options: DoctorOptions,
): Promise<ConformanceReport> {
	const startTime = Date.now();
	const timestamp = new Date().toISOString();

	// Load provider via registry
	const registry = await ProviderRegistry.getInstance();
	const providerEntry = registry.getProvider(options.provider);

	if (!providerEntry) {
		// Get available providers for actionable error message
		const availableProviders = registry
			.listProviders()
			.map((p) => p.manifest.provider.name)
			.sort();

		throw new Error(
			`Provider '${options.provider}' not found.\nAvailable providers: ${availableProviders.length > 0 ? availableProviders.join(", ") : "none"}\n\nUsage: bun run index.ts doctor --provider <name>`,
		);
	}

	const { adapter: provider, manifest } = providerEntry;

	// Create test context
	const runId = `doctor_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
	const ctx: TestContext = {
		provider,
		manifest,
		run_id: runId,
		visibility_timeout_ms: DEFAULT_VISIBILITY_TIMEOUT_MS,
		visibility_samples: DEFAULT_VISIBILITY_SAMPLES,
	};

	// Fail fast on missing/invalid credentials (FR-010)
	await preflightProviderAuth(ctx);

	// Run all conformance tests
	const tests: ConformanceTestResult[] = [];

	// 1. Scope Isolation Test (required)
	tests.push(await runScopeIsolationTest(ctx));

	// 2. Visibility Delay Test (required)
	tests.push(await runVisibilityDelayTest(ctx));

	// 3. Delete Leakage Test (required)
	tests.push(await runDeleteLeakageTest(ctx));

	// 4. Update Staleness Test (capability-gated)
	tests.push(await runUpdateStalenessTest(ctx));

	// Calculate suggested convergence_wait_ms from visibility delay test
	const visibilityTest = tests.find((t) => t.test_name === "visibility_delay");
	let suggestedConvergenceWaitMs: number | null = null;

	const visibilityDetailsCandidate =
		visibilityTest?.status === "pass" ? visibilityTest.details : undefined;

	if (isVisibilityDelayDetails(visibilityDetailsCandidate)) {
		const details = visibilityDetailsCandidate;
		// Use max as conservative estimate, with 20% buffer
		if (details.max_visibility_ms !== null) {
			suggestedConvergenceWaitMs = Math.ceil(details.max_visibility_ms * 1.2);
		} else if (details.p95_visibility_ms !== null) {
			suggestedConvergenceWaitMs = Math.ceil(details.p95_visibility_ms * 1.2);
		}
	}

	// Calculate overall status
	const overallStatus = calculateOverallStatus(tests);

	// Build report
	const report: ConformanceReport = {
		provider_name: manifest.provider.name,
		provider_version: manifest.provider.version,
		timestamp,
		duration_ms: Date.now() - startTime,
		tests,
		suggested_convergence_wait_ms: suggestedConvergenceWaitMs,
		overall_status: overallStatus,
	};

	// Output report
	if (options.json_output) {
		const outputPath = options.output_path ?? "doctor_report.json";
		await writeJsonReport(report, outputPath);
		console.log(`Doctor report written to: ${outputPath}`);
	} else {
		console.log(formatConsoleReport(report));
	}

	return report;
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

async function preflightProviderAuth(ctx: TestContext): Promise<void> {
	const scope: ScopeContext = {
		user_id: `doctor_preflight_${ctx.run_id}`,
		run_id: ctx.run_id,
		namespace: "doctor_preflight",
	};

	const query = `DOCTOR_AUTH_CHECK_${crypto.randomUUID().slice(0, 8)}`;

	const retryResult = await retryExecutor.execute(
		() => ctx.provider.retrieve_memory(scope, query, 1),
		{
			base_delay_ms: 250,
			max_delay_ms: 2000,
			max_retries: 1,
			jitter_factor: 0.25,
		},
	);

	if (retryResult.success) {
		return;
	}

	const message = retryResult.error.original.message;
	if (isAuthErrorMessage(message)) {
		throw new Error(
			`Provider '${ctx.manifest.provider.name}' authentication failed.\n${message}`,
		);
	}

	// If we can't even call retrieve_memory, the provider is not usable. Avoid running
	// all tests just to surface the same failure repeatedly.
	if (retryResult.error.category === "permanent") {
		throw new Error(
			`Provider '${ctx.manifest.provider.name}' preflight failed.\n${message}`,
		);
	}
}

/**
 * Calculate overall status from individual test results.
 *
 * - "pass": All tests passed or were skipped with valid reason
 * - "fail": One or more tests failed
 * - "partial": Some tests passed, some errored
 *
 * @param tests - Array of test results
 * @returns Overall status
 */
function calculateOverallStatus(
	tests: ConformanceTestResult[],
): ConformanceReportStatus {
	const hasFailure = tests.some((t) => t.status === "fail");
	const hasError = tests.some((t) => t.status === "error");
	const allPassOrSkip = tests.every(
		(t) => t.status === "pass" || t.status === "skip",
	);

	if (hasFailure) {
		return "fail";
	}

	if (hasError && !allPassOrSkip) {
		return "partial";
	}

	return "pass";
}

// =============================================================================
// Exports
// =============================================================================

export {
	formatConsoleReport,
	formatJsonReport,
	writeJsonReport,
} from "./report";
export type {
	ConformanceReport,
	ConformanceTestResult,
	DoctorOptions,
	TestContext,
} from "./types";
