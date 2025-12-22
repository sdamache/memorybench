/**
 * Results Module Public API
 *
 * Exports types and functions for the results writer module.
 *
 * @module src/results
 */

// Export types
export type {
	RunManifest,
	ResultRecord,
	MetricsSummary,
	ResultsWriter,
	ProviderInfo,
	BenchmarkInfo,
	EnvironmentInfo,
	StatusCounts,
	CombinationSummary,
} from "./schema";

// Export writer functions
export {
	createResultsWriter,
	buildRunManifest,
	computeManifestHash,
	getRunDir,
	getGitInfo,
	getEnvironmentInfo,
} from "./writer";

// Export summary functions
export {
	buildMetricsSummary,
	groupResultsByCombination,
	calculateScoreAverages,
} from "./summarize";
