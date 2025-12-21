/**
 * Checkpoint Manager Implementation
 *
 * Provides checkpoint functionality for resuming interrupted runs.
 * Uses atomic file writes (temp + rename) to prevent corruption.
 *
 * @module src/runner/checkpoint
 * @see specs/008-checkpoint-resume/data-model.md
 */

import { existsSync, mkdirSync, renameSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { CaseStatus } from "../../types/benchmark";
import type {
	CaseKey,
	Checkpoint,
	CheckpointLoadResult,
	CheckpointedCase,
	RunSelection,
	SelectionValidationResult,
} from "./types";

// =============================================================================
// Constants
// =============================================================================

const RUNS_DIR = join(import.meta.dir, "../../runs");
const CHECKPOINT_FILENAME = "checkpoint.json";

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Generate a filesystem-safe run ID with timestamp and random suffix.
 * Format: YYYY-MM-DDTHH-MM-SS-{random6}
 *
 * @returns Run ID string
 */
export function generateRunId(): string {
	const now = new Date();
	const timestamp = now
		.toISOString()
		.replace(/:/g, "-") // Replace colons for Windows compatibility
		.replace(/\.\d+Z$/, ""); // Remove milliseconds and Z

	// Generate 6-character random suffix
	const random = Math.random().toString(36).substring(2, 8);

	return `${timestamp}-${random}`;
}

/**
 * Build a case key from components.
 * Format: {provider_name}|{benchmark_name}|{case_id}
 *
 * @param providerName - Provider name
 * @param benchmarkName - Benchmark name
 * @param caseId - Case ID
 * @returns Case key string
 */
export function buildCaseKey(
	providerName: string,
	benchmarkName: string,
	caseId: string,
): CaseKey {
	return `${providerName}|${benchmarkName}|${caseId}`;
}

/**
 * Parse a case key into components.
 *
 * @param key - Case key to parse
 * @returns Parsed components or null if invalid format
 */
export function parseCaseKey(
	key: CaseKey,
): { providerName: string; benchmarkName: string; caseId: string } | null {
	const parts = key.split("|");
	if (parts.length !== 3) {
		return null;
	}

	const [providerName, benchmarkName, caseId] = parts;

	// Ensure all parts are defined
	if (!providerName || !benchmarkName || !caseId) {
		return null;
	}

	return { providerName, benchmarkName, caseId };
}

/**
 * Get the checkpoint file path for a run.
 *
 * @param runId - Run identifier
 * @returns Full path to checkpoint file
 */
export function getCheckpointPath(runId: string): string {
	return join(RUNS_DIR, runId, CHECKPOINT_FILENAME);
}

/**
 * Get the run directory path.
 *
 * @param runId - Run identifier
 * @returns Full path to run directory
 */
export function getRunDir(runId: string): string {
	return join(RUNS_DIR, runId);
}

/**
 * Write data to file atomically using temp file + rename.
 * This prevents corruption if process is killed during write.
 *
 * @param path - Target file path
 * @param data - Data to write
 */
async function atomicWrite(path: string, data: string): Promise<void> {
	const tempPath = `${path}.tmp`;

	// Write to temp file
	await Bun.write(tempPath, data);

	// Atomic rename (POSIX atomic operation)
	renameSync(tempPath, path);
}

/**
 * Validate checkpoint schema.
 *
 * @param data - Parsed checkpoint data
 * @returns Error message if invalid, null if valid
 */
function validateCheckpointSchema(data: unknown): string | null {
	if (typeof data !== "object" || data === null) {
		return "Checkpoint must be an object";
	}

	const checkpoint = data as Record<string, unknown>;

	// Check version
	if (checkpoint.version !== 1) {
		return `Unsupported checkpoint version: ${checkpoint.version}`;
	}

	// Check required fields
	const requiredFields = [
		"run_id",
		"created_at",
		"updated_at",
		"selections",
		"completed",
		"total_cases",
		"completed_count",
	];

	for (const field of requiredFields) {
		if (!(field in checkpoint)) {
			return `Missing required field: ${field}`;
		}
	}

	// Validate completed_count matches completed object size
	const completedCount = checkpoint.completed_count;
	const completed = checkpoint.completed as Record<string, unknown>;

	if (typeof completedCount !== "number") {
		return "completed_count must be a number";
	}

	if (typeof completed !== "object" || completed === null) {
		return "completed must be an object";
	}

	if (Object.keys(completed).length !== completedCount) {
		return `completed_count (${completedCount}) does not match completed object size (${Object.keys(completed).length})`;
	}

	return null;
}

// =============================================================================
// Checkpoint Manager
// =============================================================================

/**
 * Checkpoint manager for creating, loading, and updating checkpoints.
 */
export class CheckpointManager {
	/**
	 * Create a new checkpoint for a fresh run.
	 *
	 * @param runId - Unique run identifier
	 * @param selections - CLI selections
	 * @param totalCases - Total cases in run plan
	 * @returns Created checkpoint
	 */
	async create(
		runId: string,
		selections: RunSelection,
		totalCases: number,
	): Promise<Checkpoint> {
		// Create run directory
		const runDir = getRunDir(runId);
		if (!existsSync(runDir)) {
			mkdirSync(runDir, { recursive: true });
		}

		const now = new Date().toISOString();
		const checkpoint: Checkpoint = {
			version: 1,
			run_id: runId,
			created_at: now,
			updated_at: now,
			selections,
			completed: {},
			total_cases: totalCases,
			completed_count: 0,
		};

		// Write checkpoint atomically
		const checkpointPath = getCheckpointPath(runId);
		await atomicWrite(checkpointPath, JSON.stringify(checkpoint, null, 2));

		return checkpoint;
	}

	/**
	 * Load existing checkpoint from disk.
	 *
	 * @param runId - Run identifier to load
	 * @returns Load result with checkpoint or error
	 */
	async load(runId: string): Promise<CheckpointLoadResult> {
		const checkpointPath = getCheckpointPath(runId);

		// Check if checkpoint exists
		if (!existsSync(checkpointPath)) {
			return { status: "not_found" };
		}

		try {
			// Read checkpoint file
			const file = Bun.file(checkpointPath);
			const content = await file.text();
			const data = JSON.parse(content);

			// Validate schema
			const error = validateCheckpointSchema(data);
			if (error) {
				return { status: "invalid", error };
			}

			return {
				status: "loaded",
				checkpoint: data as Checkpoint,
			};
		} catch (err) {
			const error = err instanceof Error ? err.message : String(err);
			return {
				status: "invalid",
				error: `Failed to parse checkpoint: ${error}`,
			};
		}
	}

	/**
	 * Record a completed case and persist to disk atomically.
	 *
	 * @param checkpoint - Current checkpoint state
	 * @param caseKey - Completed case key
	 * @param status - Final case status
	 * @returns Updated checkpoint
	 */
	async recordCompletion(
		checkpoint: Checkpoint,
		caseKey: CaseKey,
		status: CaseStatus,
	): Promise<Checkpoint> {
		const now = new Date().toISOString();

		// Create updated checkpoint
		const completedCase: CheckpointedCase = {
			status,
			completed_at: now,
		};

		const updated: Checkpoint = {
			...checkpoint,
			updated_at: now,
			completed: {
				...checkpoint.completed,
				[caseKey]: completedCase,
			},
			completed_count: checkpoint.completed_count + 1,
		};

		// Write atomically
		const checkpointPath = getCheckpointPath(checkpoint.run_id);
		await atomicWrite(checkpointPath, JSON.stringify(updated, null, 2));

		return updated;
	}

	/**
	 * Validate that resume selections match checkpoint.
	 *
	 * @param checkpoint - Loaded checkpoint
	 * @param selections - CLI selections for resume
	 * @returns Validation result
	 */
	validateSelections(
		checkpoint: Checkpoint,
		selections: RunSelection,
	): SelectionValidationResult {
		const original = checkpoint.selections;

		// Convert to sets for comparison
		const originalProviders = new Set(original.providers);
		const resumeProviders = new Set(selections.providers);
		const originalBenchmarks = new Set(original.benchmarks);
		const resumeBenchmarks = new Set(selections.benchmarks);

		// Find differences
		const missingProviders = Array.from(originalProviders).filter(
			(p) => !resumeProviders.has(p),
		);
		const extraProviders = Array.from(resumeProviders).filter(
			(p) => !originalProviders.has(p),
		);
		const missingBenchmarks = Array.from(originalBenchmarks).filter(
			(b) => !resumeBenchmarks.has(b),
		);
		const extraBenchmarks = Array.from(resumeBenchmarks).filter(
			(b) => !originalBenchmarks.has(b),
		);

		// Check if selections match exactly
		if (
			missingProviders.length === 0 &&
			extraProviders.length === 0 &&
			missingBenchmarks.length === 0 &&
			extraBenchmarks.length === 0
		) {
			return { valid: true };
		}

		return {
			valid: false,
			missing_providers: missingProviders,
			extra_providers: extraProviders,
			missing_benchmarks: missingBenchmarks,
			extra_benchmarks: extraBenchmarks,
		};
	}

	/**
	 * Get set of completed case keys for filtering run plan.
	 *
	 * @param checkpoint - Checkpoint to query
	 * @returns Set of completed case keys
	 */
	getCompletedKeys(checkpoint: Checkpoint): Set<CaseKey> {
		return new Set(Object.keys(checkpoint.completed));
	}
}

/**
 * Default checkpoint manager instance.
 */
export const checkpointManager = new CheckpointManager();

/**
 * List all available run IDs from the runs directory.
 *
 * @returns Array of run IDs sorted by creation time (newest first)
 */
export async function listAvailableRuns(): Promise<string[]> {
	if (!existsSync(RUNS_DIR)) {
		return [];
	}

	try {
		const entries = readdirSync(RUNS_DIR, { withFileTypes: true });
		const runIds = entries
			.filter((entry) => entry.isDirectory() && entry.name !== ".gitkeep")
			.map((entry) => entry.name)
			.sort()
			.reverse(); // Newest first (thanks to timestamp format)

		return runIds;
	} catch {
		return [];
	}
}
