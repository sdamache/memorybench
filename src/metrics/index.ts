/**
 * Metrics Module
 *
 * Provides reusable metrics calculations for data-driven benchmarks.
 * Includes retrieval quality, task success, and lifecycle metrics.
 *
 * @module src/metrics
 * @see specs/006-benchmark-interface/data-driven-benchmark-design.md
 */

// Types
export type {
	AggregateStats,
	IdExtractor,
	LifecycleMetrics,
	MetricsContext,
	RetrievalMetrics,
	TaskMetrics,
} from "./types";

// Retrieval metrics
export {
	aggregateRetrievalMetrics,
	averagePrecision,
	calculateRetrievalMetrics,
	coverageAtK,
	defaultIdExtractor,
	extractIds,
	ndcgAtK,
	precisionAtK,
	recallAtK,
	recordIdExtractor,
} from "./retrieval";

// Performance metrics (types)
export type {
	APICallRecord,
	CasePerformanceMetrics,
	PhaseTimingRaw,
	RunPerformanceMetrics,
	TimingStats,
	TokenStats,
	TokenUsage,
} from "./performance";

// Performance metrics (utilities)
export {
	aggregateRunPerformance,
	aggregateTokenStats,
	APICallCollector,
	calculateTimingStats,
	createPerformanceContext,
	PhaseTimer,
} from "./performance";
