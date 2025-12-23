/**
 * Performance Metrics Tests
 *
 * Tests for the performance metrics module including:
 * - Timing utilities (PhaseTimer, APICallCollector)
 * - Statistical calculations (calculateTimingStats, aggregateTokenStats)
 * - Run-level aggregation (aggregateRunPerformance)
 *
 * @module tests/metrics/performance
 */
import { describe, expect, test, beforeEach } from "bun:test";
import {
	PhaseTimer,
	APICallCollector,
	calculateTimingStats,
	aggregateTokenStats,
	aggregateRunPerformance,
	createPerformanceContext,
	type CasePerformanceMetrics,
	type TokenStats,
} from "../../src/metrics/performance";

// =============================================================================
// PhaseTimer Tests
// =============================================================================

describe("PhaseTimer", () => {
	let timer: PhaseTimer;

	beforeEach(() => {
		timer = new PhaseTimer();
	});

	test("records single phase timing", async () => {
		timer.startPhase("ingestion");
		await new Promise((r) => setTimeout(r, 10)); // Wait 10ms
		timer.endPhase();

		const phases = timer.getPhases();
		expect(phases.length).toBe(1);
		expect(phases[0]?.phase).toBe("ingestion");
		expect(phases[0]?.duration_ms).toBeGreaterThan(5);
		expect(phases[0]?.started_at).toBeDefined();
		expect(phases[0]?.ended_at).toBeDefined();
	});

	test("automatically ends previous phase when starting new one", async () => {
		timer.startPhase("ingestion");
		await new Promise((r) => setTimeout(r, 5));
		timer.startPhase("retrieval"); // Should auto-end ingestion
		await new Promise((r) => setTimeout(r, 5));
		timer.endPhase();

		const phases = timer.getPhases();
		expect(phases.length).toBe(2);
		expect(phases[0]?.phase).toBe("ingestion");
		expect(phases[1]?.phase).toBe("retrieval");
	});

	test("getTotalDuration returns overall time", async () => {
		timer.startPhase("phase1");
		await new Promise((r) => setTimeout(r, 10));
		timer.endPhase();

		const total = timer.getTotalDuration();
		expect(total).toBeGreaterThan(5);
	});

	test("reset clears all state", () => {
		timer.startPhase("test");
		timer.endPhase();
		timer.reset();

		expect(timer.getPhases().length).toBe(0);
		expect(timer.getTotalDuration()).toBe(0);
	});
});

// =============================================================================
// APICallCollector Tests
// =============================================================================

describe("APICallCollector", () => {
	let collector: APICallCollector;

	beforeEach(() => {
		collector = new APICallCollector();
	});

	test("records API calls", () => {
		collector.record({
			service: "mem0",
			operation: "add_memory",
			duration_ms: 150,
		});

		const calls = collector.getCalls();
		expect(calls.length).toBe(1);
		expect(calls[0]?.service).toBe("mem0");
		expect(calls[0]?.operation).toBe("add_memory");
		expect(calls[0]?.duration_ms).toBe(150);
		expect(calls[0]?.timestamp).toBeDefined();
	});

	test("wrap() records timing and returns result", async () => {
		const result = await collector.wrap("vertex-ai", "generate", async () => {
			await new Promise((r) => setTimeout(r, 5));
			return { text: "Hello" };
		});

		expect(result).toEqual({ text: "Hello" });

		const calls = collector.getCalls();
		expect(calls.length).toBe(1);
		expect(calls[0]?.service).toBe("vertex-ai");
		expect(calls[0]?.operation).toBe("generate");
		expect(calls[0]?.duration_ms).toBeGreaterThan(0);
	});

	test("wrap() extracts token usage when provided", async () => {
		await collector.wrap(
			"vertex-ai",
			"generate",
			async () => ({
				text: "Hello",
				usage: { input_tokens: 100, output_tokens: 50 },
			}),
			(result) => ({
				input_tokens: result.usage.input_tokens,
				output_tokens: result.usage.output_tokens,
				total_tokens: result.usage.input_tokens + result.usage.output_tokens,
			}),
		);

		const calls = collector.getCalls();
		expect(calls[0]?.tokens).toEqual({
			input_tokens: 100,
			output_tokens: 50,
			total_tokens: 150,
		});
	});

	test("getTokenStats() aggregates token usage", () => {
		collector.record({
			service: "vertex-ai",
			operation: "generate",
			duration_ms: 100,
			tokens: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
		});
		collector.record({
			service: "vertex-ai",
			operation: "judge",
			duration_ms: 100,
			tokens: { input_tokens: 200, output_tokens: 100, total_tokens: 300 },
		});

		const stats = collector.getTokenStats();
		expect(stats?.call_count).toBe(2);
		expect(stats?.total_input_tokens).toBe(300);
		expect(stats?.total_output_tokens).toBe(150);
		expect(stats?.total_tokens).toBe(450);
	});

	test("getTokenStats() returns undefined when no token usage", () => {
		collector.record({
			service: "mem0",
			operation: "add_memory",
			duration_ms: 100,
		});

		expect(collector.getTokenStats()).toBeUndefined();
	});
});

// =============================================================================
// Statistical Calculation Tests
// =============================================================================

describe("calculateTimingStats", () => {
	test("calculates stats for empty array", () => {
		const stats = calculateTimingStats([]);
		expect(stats.count).toBe(0);
		expect(stats.mean_ms).toBe(0);
	});

	test("calculates stats for single value", () => {
		const stats = calculateTimingStats([100]);
		expect(stats.count).toBe(1);
		expect(stats.min_ms).toBe(100);
		expect(stats.max_ms).toBe(100);
		expect(stats.mean_ms).toBe(100);
		expect(stats.p50_ms).toBe(100);
	});

	test("calculates stats for multiple values", () => {
		// 10 values: 1-10
		const durations = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
		const stats = calculateTimingStats(durations);

		expect(stats.count).toBe(10);
		expect(stats.total_ms).toBe(55);
		expect(stats.min_ms).toBe(1);
		expect(stats.max_ms).toBe(10);
		expect(stats.mean_ms).toBe(5.5);
		expect(stats.p50_ms).toBe(5); // 50th percentile
	});

	test("handles unsorted input", () => {
		const durations = [10, 1, 5, 3, 8];
		const stats = calculateTimingStats(durations);

		expect(stats.min_ms).toBe(1);
		expect(stats.max_ms).toBe(10);
	});
});

describe("aggregateTokenStats", () => {
	test("handles empty array", () => {
		const result = aggregateTokenStats([]);
		expect(result.call_count).toBe(0);
		expect(result.total_tokens).toBe(0);
	});

	test("handles array with undefined values", () => {
		const result = aggregateTokenStats([undefined, undefined]);
		expect(result.call_count).toBe(0);
	});

	test("aggregates multiple token stats", () => {
		const stats: (TokenStats | undefined)[] = [
			{
				call_count: 2,
				total_input_tokens: 200,
				total_output_tokens: 100,
				total_tokens: 300,
				avg_input_tokens: 100,
				avg_output_tokens: 50,
			},
			{
				call_count: 1,
				total_input_tokens: 100,
				total_output_tokens: 50,
				total_tokens: 150,
				avg_input_tokens: 100,
				avg_output_tokens: 50,
			},
		];

		const result = aggregateTokenStats(stats);
		expect(result.call_count).toBe(3);
		expect(result.total_input_tokens).toBe(300);
		expect(result.total_output_tokens).toBe(150);
		expect(result.total_tokens).toBe(450);
	});
});

// =============================================================================
// Run Aggregation Tests
// =============================================================================

describe("aggregateRunPerformance", () => {
	test("aggregates empty case array", () => {
		const result = aggregateRunPerformance([]);
		expect(result.overall_latency.count).toBe(0);
		expect(Object.keys(result.by_phase)).toEqual([]);
	});

	test("aggregates single case", () => {
		const caseMetrics: CasePerformanceMetrics = {
			phases: [
				{
					phase: "ingestion",
					duration_ms: 100,
					started_at: "2024-01-01T00:00:00Z",
					ended_at: "2024-01-01T00:00:00.1Z",
				},
				{
					phase: "retrieval",
					duration_ms: 50,
					started_at: "2024-01-01T00:00:00.1Z",
					ended_at: "2024-01-01T00:00:00.15Z",
				},
			],
			api_calls: [
				{
					service: "mem0",
					operation: "add_memory",
					duration_ms: 80,
					timestamp: "2024-01-01T00:00:00Z",
				},
			],
			total_duration_ms: 150,
		};

		const result = aggregateRunPerformance([caseMetrics]);

		expect(result.by_phase.ingestion.count).toBe(1);
		expect(result.by_phase.ingestion.mean_ms).toBe(100);
		expect(result.by_phase.retrieval.count).toBe(1);
		expect(result.by_phase.retrieval.mean_ms).toBe(50);
		expect(result.api_call_counts["mem0:add_memory"]).toBe(1);
		expect(result.overall_latency.mean_ms).toBe(150);
	});

	test("aggregates multiple cases", () => {
		const cases: CasePerformanceMetrics[] = [
			{
				phases: [{ phase: "ingestion", duration_ms: 100, started_at: "", ended_at: "" }],
				api_calls: [],
				total_duration_ms: 100,
			},
			{
				phases: [{ phase: "ingestion", duration_ms: 200, started_at: "", ended_at: "" }],
				api_calls: [],
				total_duration_ms: 200,
			},
		];

		const result = aggregateRunPerformance(cases);

		expect(result.by_phase.ingestion.count).toBe(2);
		expect(result.by_phase.ingestion.mean_ms).toBe(150);
		expect(result.overall_latency.count).toBe(2);
		expect(result.overall_latency.mean_ms).toBe(150);
	});
});

// =============================================================================
// Factory Function Tests
// =============================================================================

describe("createPerformanceContext", () => {
	test("creates context with timer and collector", () => {
		const ctx = createPerformanceContext();

		expect(ctx.timer).toBeInstanceOf(PhaseTimer);
		expect(ctx.collector).toBeInstanceOf(APICallCollector);
		expect(typeof ctx.finalize).toBe("function");
	});

	test("finalize() returns complete metrics", async () => {
		const ctx = createPerformanceContext();

		ctx.timer.startPhase("test");
		await new Promise((r) => setTimeout(r, 5));
		ctx.timer.endPhase();

		ctx.collector.record({
			service: "test",
			operation: "op",
			duration_ms: 10,
		});

		const metrics = ctx.finalize();

		expect(metrics.phases.length).toBe(1);
		expect(metrics.api_calls.length).toBe(1);
		expect(metrics.total_duration_ms).toBeGreaterThan(0);
	});
});
