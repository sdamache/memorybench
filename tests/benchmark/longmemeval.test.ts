/**
 * LongMemEval benchmark tests (data-driven)
 * Tests for the manifest-based LongMemEval benchmark.
 */

import { describe, expect, test } from "bun:test";
import { BenchmarkRegistry } from "../../src/loaders/benchmarks";
import {
	loadBenchmarkManifest,
	hasManifest,
} from "../../src/loaders/data-driven-benchmark";
import { validateBenchmarkManifest } from "../../types/benchmark-manifest";

// =============================================================================
// Manifest Validation Tests
// =============================================================================

describe("LongMemEval manifest", () => {
	test("manifest.json exists in LongMemEval directory", async () => {
		const exists = await hasManifest("benchmarks/LongMemEval");
		expect(exists).toBe(true);
	});

	test("manifest.json is valid according to schema", async () => {
		const manifest = await loadBenchmarkManifest(
			"benchmarks/LongMemEval/manifest.json",
		);

		expect(manifest.manifest_version).toBe("1");
		expect(manifest.name).toBe("LongMemEval");
		expect(manifest.version).toBe("1.0.0");
	});

	test("manifest has correct ingestion config", async () => {
		const manifest = await loadBenchmarkManifest(
			"benchmarks/LongMemEval/manifest.json",
		);

		expect(manifest.ingestion.strategy).toBe("session-based");
		if (manifest.ingestion.strategy === "session-based") {
			expect(manifest.ingestion.sessions_field).toBe("haystack_sessions");
			expect(manifest.ingestion.session_ids_field).toBe("haystack_session_ids");
			expect(manifest.ingestion.dates_field).toBe("haystack_dates");
			expect(manifest.ingestion.answer_session_ids_field).toBe(
				"answer_session_ids",
			);
		}
	});

	test("manifest has correct evaluation config", async () => {
		const manifest = await loadBenchmarkManifest(
			"benchmarks/LongMemEval/manifest.json",
		);

		expect(manifest.evaluation.protocol).toBe("llm-as-judge");
		if (manifest.evaluation.protocol === "llm-as-judge") {
			expect(manifest.evaluation.type_field).toBe("question_type");
			expect(manifest.evaluation.type_instructions_file).toBe(
				"type_instructions.json",
			);
		}
	});

	test("manifest has correct query config", async () => {
		const manifest = await loadBenchmarkManifest(
			"benchmarks/LongMemEval/manifest.json",
		);

		expect(manifest.query.question_field).toBe("question");
		expect(manifest.query.expected_answer_field).toBe("answer");
		expect(manifest.query.retrieval_limit).toBe(10);
	});

	test("manifest has required capabilities", async () => {
		const manifest = await loadBenchmarkManifest(
			"benchmarks/LongMemEval/manifest.json",
		);

		expect(manifest.required_capabilities).toContain("add_memory");
		expect(manifest.required_capabilities).toContain("retrieve_memory");
	});

	test("manifest has correct metrics", async () => {
		const manifest = await loadBenchmarkManifest(
			"benchmarks/LongMemEval/manifest.json",
		);

		expect(manifest.metrics).toContain("correctness");
		expect(manifest.metrics).toContain("faithfulness");
		expect(manifest.metrics).toContain("retrieval_precision");
	});
});

// =============================================================================
// Type Instructions Tests
// =============================================================================

describe("LongMemEval type instructions", () => {
	test("type_instructions.json exists", async () => {
		const file = Bun.file("benchmarks/LongMemEval/type_instructions.json");
		expect(await file.exists()).toBe(true);
	});

	test("type_instructions.json has all 6 question types", async () => {
		const file = Bun.file("benchmarks/LongMemEval/type_instructions.json");
		const instructions = await file.json();

		const expectedTypes = [
			"temporal-reasoning",
			"multi-session",
			"knowledge-update",
			"single-session-user",
			"single-session-assistant",
			"single-session-preference",
		];

		for (const type of expectedTypes) {
			expect(instructions[type]).toBeDefined();
			expect(typeof instructions[type]).toBe("string");
			expect(instructions[type].length).toBeGreaterThan(0);
		}
	});
});

// =============================================================================
// Data File Tests
// =============================================================================

describe("LongMemEval data file", () => {
	test("data file exists at configured path", async () => {
		const manifest = await loadBenchmarkManifest(
			"benchmarks/LongMemEval/manifest.json",
		);
		const dataPath = `benchmarks/LongMemEval/${manifest.data_file}`;
		const file = Bun.file(dataPath);

		expect(await file.exists()).toBe(true);
	});

	test("data file contains valid JSON array", async () => {
		const manifest = await loadBenchmarkManifest(
			"benchmarks/LongMemEval/manifest.json",
		);
		const dataPath = `benchmarks/LongMemEval/${manifest.data_file}`;
		const file = Bun.file(dataPath);
		const data = await file.json();

		expect(Array.isArray(data)).toBe(true);
		expect(data.length).toBeGreaterThan(0);
	});

	test("data items have required fields per manifest", async () => {
		const manifest = await loadBenchmarkManifest(
			"benchmarks/LongMemEval/manifest.json",
		);
		const dataPath = `benchmarks/LongMemEval/${manifest.data_file}`;
		const file = Bun.file(dataPath);
		const data = await file.json();
		const firstItem = data[0];

		// Check fields from ingestion config
		if (manifest.ingestion.strategy === "session-based") {
			expect(firstItem[manifest.ingestion.sessions_field]).toBeDefined();
			if (manifest.ingestion.session_ids_field) {
				expect(firstItem[manifest.ingestion.session_ids_field]).toBeDefined();
			}
		}

		// Check fields from query config
		expect(firstItem[manifest.query.question_field]).toBeDefined();
		expect(firstItem[manifest.query.expected_answer_field]).toBeDefined();

		// Check fields from evaluation config
		if (
			manifest.evaluation.protocol === "llm-as-judge" &&
			manifest.evaluation.type_field
		) {
			expect(firstItem[manifest.evaluation.type_field]).toBeDefined();
		}
	});
});
