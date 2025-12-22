/**
 * Results Writer Implementation
 *
 * Implements the ResultsWriter interface for persisting run outputs.
 * Provides atomic writes, incremental JSONL appending, and summary generation.
 *
 * @module src/results/writer
 */

import { join } from "node:path";
import { rename, appendFile } from "node:fs/promises";
import { platform, release, arch } from "node:os";
import { createHash } from "node:crypto";
import type {
	ResultsWriter,
	RunManifest,
	ResultRecord,
	MetricsSummary,
	EnvironmentInfo,
	ProviderInfo,
	BenchmarkInfo,
} from "./schema";
import type { RunSelection, RunPlan } from "../runner/types";

// =============================================================================
// Path Management
// =============================================================================

/**
 * Get the run directory path for a given run ID.
 *
 * @param runId - Unique run identifier
 * @param baseDir - Base directory for runs (default: "runs")
 * @returns Absolute path to run directory
 */
export function getRunDir(runId: string, baseDir = "runs"): string {
	return join(process.cwd(), baseDir, runId);
}

// =============================================================================
// Atomic Write Helpers
// =============================================================================

/**
 * Atomically write JSON data to a file.
 * Writes to a temp file first, then renames to prevent corruption.
 *
 * @param path - Target file path
 * @param data - Data to write as JSON
 */
export async function atomicWriteJson(
	path: string,
	data: unknown,
): Promise<void> {
	const tempPath = `${path}.tmp`;

	// Write to temp file
	await Bun.write(tempPath, JSON.stringify(data, null, 2));

	// Atomic rename (POSIX guarantees atomicity)
	await rename(tempPath, path);
}

// =============================================================================
// Git Information
// =============================================================================

/**
 * Get git commit hash and branch name.
 *
 * @returns Object with commit hash and branch, or empty object if not in git repo
 */
export async function getGitInfo(): Promise<{
	git_commit?: string;
	git_branch?: string;
}> {
	try {
		// Get commit hash
		const commitProc = Bun.spawn(["git", "rev-parse", "HEAD"], {
			stdout: "pipe",
			stderr: "ignore",
		});
		const commitText = await new Response(commitProc.stdout).text();
		await commitProc.exited; // Wait for process to exit

		// Check exit code and non-empty output
		if (commitProc.exitCode !== 0 || !commitText.trim()) {
			return {};
		}
		const git_commit = commitText.trim();

		// Get branch name
		const branchProc = Bun.spawn(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
			stdout: "pipe",
			stderr: "ignore",
		});
		const branchText = await new Response(branchProc.stdout).text();
		await branchProc.exited; // Wait for process to exit

		// Check exit code and non-empty output
		if (branchProc.exitCode !== 0 || !branchText.trim()) {
			return { git_commit }; // Return commit if we got it, but no branch
		}
		const git_branch = branchText.trim();

		return { git_commit, git_branch };
	} catch {
		// Not in a git repository or git not available
		return {};
	}
}

// =============================================================================
// Environment Information
// =============================================================================

/**
 * Get environment information for reproducibility.
 *
 * @returns Environment metadata
 */
export function getEnvironmentInfo(): EnvironmentInfo {
	return {
		runtime: "bun",
		runtime_version: Bun.version,
		os: platform(),
		os_version: release(),
		platform: arch(),
	};
}

// =============================================================================
// Manifest Hash Computation
// =============================================================================

/**
 * Compute SHA-256 hash of a manifest object.
 * Uses canonical JSON representation (sorted keys) for deterministic hashing.
 *
 * @param manifest - Manifest object to hash
 * @returns SHA-256 hash as hex string
 */
export function computeManifestHash(manifest: unknown): string {
	// Convert to canonical JSON (sorted keys recursively)
	const canonical = JSON.stringify(manifest, Object.keys(manifest as object).sort());

	// Compute SHA-256 hash
	return createHash("sha256").update(canonical).digest("hex");
}

// =============================================================================
// Build Run Manifest
// =============================================================================

/**
 * Build a run manifest from run configuration and plan.
 *
 * @param runId - Unique run identifier
 * @param timestamp - ISO 8601 timestamp when run started
 * @param selections - CLI selections
 * @param plan - Run plan with provider/benchmark matrix
 * @param providers - Provider metadata
 * @param benchmarks - Benchmark metadata
 * @returns Complete run manifest
 */
export async function buildRunManifest(
	runId: string,
	timestamp: string,
	selections: RunSelection,
	plan: RunPlan,
	providers: readonly ProviderInfo[],
	benchmarks: readonly BenchmarkInfo[],
): Promise<RunManifest> {
	const gitInfo = await getGitInfo();
	const environment = getEnvironmentInfo();

	return {
		version: 1,
		run_id: runId,
		timestamp,
		...gitInfo,
		selections,
		providers,
		benchmarks,
		environment,
		cli_args: process.argv.slice(2),
	};
}

// =============================================================================
// ResultsWriter Implementation
// =============================================================================

class ResultsWriterImpl implements ResultsWriter {
	readonly runDir: string;
	private resultsFilePath: string;
	private appendQueue: Promise<void> = Promise.resolve();

	constructor(runId: string, baseDir = "runs") {
		this.runDir = getRunDir(runId, baseDir);
		this.resultsFilePath = join(this.runDir, "results.jsonl");
	}

	async writeManifest(manifest: RunManifest): Promise<void> {
		const manifestPath = join(this.runDir, "run_manifest.json");
		await atomicWriteJson(manifestPath, manifest);
	}

	async appendResult(result: ResultRecord): Promise<void> {
		// Serialize append operations to prevent interleaving (concurrent write safety)
		this.appendQueue = this.appendQueue.then(async () => {
			const line = JSON.stringify(result) + "\n";

			// Use Node.js appendFile for atomic line-level appends
			// This handles concurrent writes safely at the OS level
			await appendFile(this.resultsFilePath, line, { encoding: "utf-8" });
		});

		await this.appendQueue;
	}

	async writeSummary(summary: MetricsSummary): Promise<void> {
		const summaryPath = join(this.runDir, "metrics_summary.json");
		await atomicWriteJson(summaryPath, summary);
	}

	async close(): Promise<void> {
		// Wait for all pending appends to complete before closing
		await this.appendQueue;
	}
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a results writer for a given run.
 *
 * @param runId - Unique run identifier
 * @param baseDir - Base directory for runs (default: "runs")
 * @returns Configured results writer
 */
export async function createResultsWriter(
	runId: string,
	baseDir = "runs",
): Promise<ResultsWriter> {
	const writer = new ResultsWriterImpl(runId, baseDir);

	// Ensure run directory exists by writing .gitkeep with createPath
	const runDir = writer.runDir;
	await Bun.write(join(runDir, ".gitkeep"), "", { createPath: true });

	return writer;
}
