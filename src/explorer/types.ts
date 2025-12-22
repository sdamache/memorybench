import type {
	MetricsSummary,
	ResultRecord,
	RunManifest,
} from "../results/schema";

/**
 * Data bundle for the Results Explorer.
 * Contains everything needed to render the explorer UI for a single run.
 */
export interface ExplorerData {
	/** The run configuration and metadata */
	manifest: RunManifest;
	/** The aggregated metrics and statistics */
	summary: MetricsSummary;
	/** The individual case results */
	results: ResultRecord[];
}

/**
 * Brief info about a run for the run picker.
 */
export interface RunInfo {
	/** Unique run identifier */
	run_id: string;
	/** When the run was started */
	timestamp: string;
	/** List of providers used */
	providers: string[];
	/** List of benchmarks used */
	benchmarks: string[];
	/** Number of results (if available) */
	result_count?: number;
}
