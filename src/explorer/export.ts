import { join } from "node:path";
import { readdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import type { MetricsSummary, RunManifest, ResultRecord } from "../results/schema";
import { buildMetricsSummary } from "../results/summarize";
import { getRunDir, readExistingResults } from "../results/writer";
import type { ExplorerData, RunInfo } from "./types";

/**
 * Computes summary statistics from results when metrics_summary.json is missing.
 */
function computeSummaryFromResults(runId: string, results: ResultRecord[]): MetricsSummary {
	const totals = {
		cases: results.length,
		passed: 0,
		failed: 0,
		skipped: 0,
		errors: 0,
		duration_ms: 0,
	};

	for (const result of results) {
		totals.duration_ms += result.duration_ms;
		switch (result.status) {
			case "pass":
				totals.passed++;
				break;
			case "fail":
				totals.failed++;
				break;
			case "skip":
				totals.skipped++;
				break;
			case "error":
				totals.errors++;
				break;
		}
	}

	return {
		version: 1,
		run_id: runId,
		generated_at: new Date().toISOString(),
		totals,
		by_combination: [],
	};
}

async function countJsonlLines(path: string): Promise<number | undefined> {
	try {
		const file = Bun.file(path);
		if (!(await file.exists())) {
			return undefined;
		}

		const reader = file.stream().getReader();
		let sawByte = false;
		let lastByte = 0;
		let lines = 0;

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;

			sawByte = true;
			lastByte = value[value.length - 1] ?? lastByte;

			for (const byte of value) {
				if (byte === 10) {
					lines++;
				}
			}
		}

		// If the file has content and does not end with a newline, count the last line.
		if (sawByte && lastByte !== 10) {
			lines++;
		}

		return lines;
	} catch {
		return undefined;
	}
}

/**
 * Loads all results and metadata for a given run and bundles them into ExplorerData.
 *
 * @param runId - Unique run identifier
 * @param baseDir - Base directory for runs (default: "runs")
 * @returns Bundled explorer data
 */
export async function loadExplorerData(
	runId: string,
	baseDir = "runs",
): Promise<ExplorerData> {
	const runDir = getRunDir(runId, baseDir);

	const manifestPath = join(runDir, "run_manifest.json");
	const summaryPath = join(runDir, "metrics_summary.json");

	const manifestFile = Bun.file(manifestPath);
	const summaryFile = Bun.file(summaryPath);

	if (!(await manifestFile.exists())) {
		throw new Error(`Run manifest not found in ${runDir}`);
	}

	const manifest = (await manifestFile.json()) as RunManifest;
	const results = await readExistingResults(runDir);

	// Prefer computing summary from results for consistency with the table view.
	// Fall back to metrics_summary.json only if there are no parsed results.
	let summary: MetricsSummary;
	if (results.length > 0) {
		summary = buildMetricsSummary(runId, results);
	} else if (await summaryFile.exists()) {
		summary = (await summaryFile.json()) as MetricsSummary;
	} else {
		summary = buildMetricsSummary(runId, results);
	}

	return {
		manifest,
		summary,
		results,
	};
}

/**
 * Lists all available runs in the runs directory.
 *
 * @param baseDir - Base directory for runs (default: "runs")
 * @returns Array of run info objects, sorted by timestamp (newest first)
 */
export async function listAvailableRuns(baseDir = "runs"): Promise<RunInfo[]> {
	const runsPath = join(process.cwd(), baseDir);

	let entries: Dirent[];
	try {
		entries = await readdir(runsPath, { withFileTypes: true });
	} catch {
		return [];
	}

	const runDirs = entries
		.filter((entry) => entry.isDirectory() && entry.name.startsWith("run_"))
		.map((entry) => entry.name);
	const runs: RunInfo[] = [];

	for (const runDir of runDirs) {
		const manifestPath = join(runsPath, runDir, "run_manifest.json");
		const manifestFile = Bun.file(manifestPath);

		if (await manifestFile.exists()) {
			try {
				const manifest = (await manifestFile.json()) as RunManifest;

				// Try to get result count from metrics_summary.json (fast path)
				let resultCount: number | undefined;
				const summaryPath = join(runsPath, runDir, "metrics_summary.json");
				const summaryFile = Bun.file(summaryPath);
				if (await summaryFile.exists()) {
					try {
						const summary = (await summaryFile.json()) as MetricsSummary;
						resultCount = summary.totals.cases;
					} catch {
						// Fall back to counting JSONL lines below
					}
				}

				// Fallback: count results.jsonl lines without loading the entire file into memory
				if (resultCount === undefined) {
					const resultsPath = join(runsPath, runDir, "results.jsonl");
					const counted = await countJsonlLines(resultsPath);
					if (counted !== undefined) {
						resultCount = counted;
					}
				}

				runs.push({
					run_id: manifest.run_id,
					timestamp: manifest.timestamp,
					providers: manifest.providers.map((p) => p.name),
					benchmarks: manifest.benchmarks.map((b) => b.name),
					result_count: resultCount,
				});
			} catch {
				// Skip invalid manifests
			}
		}
	}

	// Sort by timestamp, newest first
	runs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

	return runs;
}
