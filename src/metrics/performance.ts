/**
 * Performance Metrics Module
 *
 * Provides types and utilities for capturing latency, token usage,
 * and API call metrics during benchmark execution.
 *
 * @module src/metrics/performance
 */

// =============================================================================
// Types - Performance Metrics
// =============================================================================

/**
 * Timing statistics for a set of operations.
 */
export interface TimingStats {
	/** Number of operations measured */
	readonly count: number;
	/** Total time across all operations (ms) */
	readonly total_ms: number;
	/** Minimum time (ms) */
	readonly min_ms: number;
	/** Maximum time (ms) */
	readonly max_ms: number;
	/** Mean time (ms) */
	readonly mean_ms: number;
	/** Median time (ms) - p50 */
	readonly p50_ms: number;
	/** 95th percentile (ms) */
	readonly p95_ms: number;
	/** 99th percentile (ms) */
	readonly p99_ms: number;
}

/**
 * Token usage for a single LLM call.
 */
export interface TokenUsage {
	/** Input/prompt tokens */
	readonly input_tokens: number;
	/** Output/completion tokens */
	readonly output_tokens: number;
	/** Total tokens (input + output) */
	readonly total_tokens: number;
	/** Model used */
	readonly model?: string;
}

/**
 * Aggregated token statistics.
 */
export interface TokenStats {
	/** Total calls made */
	readonly call_count: number;
	/** Total input tokens across all calls */
	readonly total_input_tokens: number;
	/** Total output tokens across all calls */
	readonly total_output_tokens: number;
	/** Total tokens (input + output) */
	readonly total_tokens: number;
	/** Average input tokens per call */
	readonly avg_input_tokens: number;
	/** Average output tokens per call */
	readonly avg_output_tokens: number;
}

/**
 * Single phase timing within a case execution.
 */
export interface PhaseTimingRaw {
	/** Phase name (ingestion, retrieval, answer_generation, evaluation) */
	readonly phase: string;
	/** Duration in milliseconds */
	readonly duration_ms: number;
	/** Timestamp when phase started */
	readonly started_at: string;
	/** Timestamp when phase ended */
	readonly ended_at: string;
}

/**
 * API call record for tracking provider/LLM calls.
 */
export interface APICallRecord {
	/** Service called (mem0, supermemory, vertex-ai, anthropic) */
	readonly service: string;
	/** Operation type (add_memory, retrieve_memory, generate, judge) */
	readonly operation: string;
	/** Duration in milliseconds */
	readonly duration_ms: number;
	/** HTTP status code if applicable */
	readonly status_code?: number;
	/** Token usage if LLM call */
	readonly tokens?: TokenUsage;
	/** Timestamp */
	readonly timestamp: string;
}

/**
 * Per-case performance metrics captured during execution.
 * Stored in CaseResult.artifacts.performance
 */
export interface CasePerformanceMetrics {
	/** Phase-level timing breakdown */
	readonly phases: readonly PhaseTimingRaw[];
	/** Individual API calls made */
	readonly api_calls: readonly APICallRecord[];
	/** Total LLM token usage */
	readonly token_usage?: TokenStats;
	/** Wall-clock time for entire case */
	readonly total_duration_ms: number;
}

/**
 * Aggregated performance metrics for a run.
 * Stored in metrics_summary.json
 */
export interface RunPerformanceMetrics {
	/** Timing stats by phase */
	readonly by_phase: Record<string, TimingStats>;
	/** Timing stats by operation */
	readonly by_operation: Record<string, TimingStats>;
	/** Token usage by LLM call type */
	readonly token_usage: {
		readonly answer_generation?: TokenStats;
		readonly evaluation?: TokenStats;
		readonly total: TokenStats;
	};
	/** API call counts by service */
	readonly api_call_counts: Record<string, number>;
	/** Overall latency stats */
	readonly overall_latency: TimingStats;
}

// =============================================================================
// Utilities - Timing Capture
// =============================================================================

/**
 * High-resolution timer for capturing operation durations.
 */
export class PhaseTimer {
	private startTime: number = 0;
	private phases: PhaseTimingRaw[] = [];
	private currentPhase: string | null = null;
	private currentPhaseStart: number = 0;

	/**
	 * Start timing a new phase.
	 * Automatically ends the previous phase if one is active.
	 */
	startPhase(phase: string): void {
		if (this.currentPhase) {
			this.endPhase();
		}
		this.currentPhase = phase;
		this.currentPhaseStart = performance.now();
		if (this.startTime === 0) {
			this.startTime = this.currentPhaseStart;
		}
	}

	/**
	 * End the current phase.
	 */
	endPhase(): void {
		if (!this.currentPhase) return;

		const endTime = performance.now();
		this.phases.push({
			phase: this.currentPhase,
			duration_ms: endTime - this.currentPhaseStart,
			started_at: new Date(Date.now() - (endTime - this.currentPhaseStart)).toISOString(),
			ended_at: new Date().toISOString(),
		});
		this.currentPhase = null;
	}

	/**
	 * Get all recorded phase timings.
	 */
	getPhases(): readonly PhaseTimingRaw[] {
		// End any active phase
		if (this.currentPhase) {
			this.endPhase();
		}
		return this.phases;
	}

	/**
	 * Get total elapsed time.
	 */
	getTotalDuration(): number {
		const endTime = performance.now();
		return this.startTime > 0 ? endTime - this.startTime : 0;
	}

	/**
	 * Reset the timer for a new case.
	 */
	reset(): void {
		this.startTime = 0;
		this.phases = [];
		this.currentPhase = null;
		this.currentPhaseStart = 0;
	}
}

/**
 * Collector for API call records.
 */
export class APICallCollector {
	private calls: APICallRecord[] = [];

	/**
	 * Record an API call.
	 */
	record(call: Omit<APICallRecord, "timestamp">): void {
		this.calls.push({
			...call,
			timestamp: new Date().toISOString(),
		});
	}

	/**
	 * Wrap an async function to record its API call.
	 */
	async wrap<T>(
		service: string,
		operation: string,
		fn: () => Promise<T>,
		extractTokens?: (result: T) => TokenUsage | undefined,
	): Promise<T> {
		const startTime = performance.now();
		let status_code: number | undefined;

		try {
			const result = await fn();
			const duration_ms = performance.now() - startTime;
			const tokens = extractTokens?.(result);

			this.calls.push({
				service,
				operation,
				duration_ms,
				status_code,
				tokens,
				timestamp: new Date().toISOString(),
			});

			return result;
		} catch (error) {
			const duration_ms = performance.now() - startTime;

			// Extract HTTP status from error if available
			if (error instanceof Error && "status" in error) {
				status_code = (error as { status?: number }).status;
			}

			this.calls.push({
				service,
				operation,
				duration_ms,
				status_code,
				timestamp: new Date().toISOString(),
			});

			throw error;
		}
	}

	/**
	 * Get all recorded API calls.
	 */
	getCalls(): readonly APICallRecord[] {
		return this.calls;
	}

	/**
	 * Calculate token statistics from recorded calls.
	 */
	getTokenStats(): TokenStats | undefined {
		const callsWithTokens = this.calls.filter((c) => c.tokens);
		if (callsWithTokens.length === 0) return undefined;

		const total_input_tokens = callsWithTokens.reduce(
			(sum, c) => sum + (c.tokens?.input_tokens ?? 0),
			0,
		);
		const total_output_tokens = callsWithTokens.reduce(
			(sum, c) => sum + (c.tokens?.output_tokens ?? 0),
			0,
		);

		return {
			call_count: callsWithTokens.length,
			total_input_tokens,
			total_output_tokens,
			total_tokens: total_input_tokens + total_output_tokens,
			avg_input_tokens: total_input_tokens / callsWithTokens.length,
			avg_output_tokens: total_output_tokens / callsWithTokens.length,
		};
	}

	/**
	 * Reset the collector for a new case.
	 */
	reset(): void {
		this.calls = [];
	}
}

// =============================================================================
// Utilities - Statistical Calculations
// =============================================================================

/**
 * Calculate percentile from sorted array.
 */
function percentile(sortedValues: number[], p: number): number {
	if (sortedValues.length === 0) return 0;
	const index = Math.ceil((p / 100) * sortedValues.length) - 1;
	return sortedValues[Math.max(0, Math.min(index, sortedValues.length - 1))] ?? 0;
}

/**
 * Calculate timing statistics from an array of durations.
 */
export function calculateTimingStats(durations: number[]): TimingStats {
	if (durations.length === 0) {
		return {
			count: 0,
			total_ms: 0,
			min_ms: 0,
			max_ms: 0,
			mean_ms: 0,
			p50_ms: 0,
			p95_ms: 0,
			p99_ms: 0,
		};
	}

	const sorted = [...durations].sort((a, b) => a - b);
	const total = durations.reduce((sum, d) => sum + d, 0);

	return {
		count: durations.length,
		total_ms: total,
		min_ms: sorted[0] ?? 0,
		max_ms: sorted[sorted.length - 1] ?? 0,
		mean_ms: total / durations.length,
		p50_ms: percentile(sorted, 50),
		p95_ms: percentile(sorted, 95),
		p99_ms: percentile(sorted, 99),
	};
}

/**
 * Aggregate token stats from multiple cases.
 */
export function aggregateTokenStats(stats: (TokenStats | undefined)[]): TokenStats {
	const validStats = stats.filter((s): s is TokenStats => s !== undefined);

	if (validStats.length === 0) {
		return {
			call_count: 0,
			total_input_tokens: 0,
			total_output_tokens: 0,
			total_tokens: 0,
			avg_input_tokens: 0,
			avg_output_tokens: 0,
		};
	}

	const total_input_tokens = validStats.reduce((sum, s) => sum + s.total_input_tokens, 0);
	const total_output_tokens = validStats.reduce((sum, s) => sum + s.total_output_tokens, 0);
	const call_count = validStats.reduce((sum, s) => sum + s.call_count, 0);

	return {
		call_count,
		total_input_tokens,
		total_output_tokens,
		total_tokens: total_input_tokens + total_output_tokens,
		avg_input_tokens: call_count > 0 ? total_input_tokens / call_count : 0,
		avg_output_tokens: call_count > 0 ? total_output_tokens / call_count : 0,
	};
}

// =============================================================================
// Utilities - Run-Level Aggregation
// =============================================================================

/**
 * Aggregate per-case metrics into run-level summary.
 *
 * @param caseMetrics - Array of per-case performance metrics
 * @returns Aggregated run performance metrics
 */
export function aggregateRunPerformance(
	caseMetrics: CasePerformanceMetrics[],
): RunPerformanceMetrics {
	// Collect all phase timings by phase name
	const phaseTimings: Record<string, number[]> = {};
	for (const m of caseMetrics) {
		for (const phase of m.phases) {
			const existing = phaseTimings[phase.phase] ?? [];
			existing.push(phase.duration_ms);
			phaseTimings[phase.phase] = existing;
		}
	}

	// Collect all API call timings by operation
	const operationTimings: Record<string, number[]> = {};
	const apiCallCounts: Record<string, number> = {};
	for (const m of caseMetrics) {
		for (const call of m.api_calls) {
			const key = `${call.service}:${call.operation}`;
			const existing = operationTimings[key] ?? [];
			existing.push(call.duration_ms);
			operationTimings[key] = existing;
			apiCallCounts[key] = (apiCallCounts[key] ?? 0) + 1;
		}
	}

	// Calculate stats by phase
	const by_phase: Record<string, TimingStats> = {};
	for (const [phase, durations] of Object.entries(phaseTimings)) {
		by_phase[phase] = calculateTimingStats(durations);
	}

	// Calculate stats by operation
	const by_operation: Record<string, TimingStats> = {};
	for (const [operation, durations] of Object.entries(operationTimings)) {
		by_operation[operation] = calculateTimingStats(durations);
	}

	// Aggregate token usage
	const tokenStats = caseMetrics.map((m) => m.token_usage);
	const totalTokens = aggregateTokenStats(tokenStats);

	// Calculate overall latency
	const allDurations = caseMetrics.map((m) => m.total_duration_ms);
	const overall_latency = calculateTimingStats(allDurations);

	return {
		by_phase,
		by_operation,
		token_usage: {
			total: totalTokens,
		},
		api_call_counts: apiCallCounts,
		overall_latency,
	};
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a new performance metrics context for a case.
 */
export function createPerformanceContext(): {
	timer: PhaseTimer;
	collector: APICallCollector;
	finalize: () => CasePerformanceMetrics;
} {
	const timer = new PhaseTimer();
	const collector = new APICallCollector();

	return {
		timer,
		collector,
		finalize: () => ({
			phases: timer.getPhases(),
			api_calls: collector.getCalls(),
			token_usage: collector.getTokenStats(),
			total_duration_ms: timer.getTotalDuration(),
		}),
	};
}
