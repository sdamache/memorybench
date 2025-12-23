/**
 * LoCoMo benchmark tests (data-driven)
 * Tests for the manifest-based LoCoMo benchmark.
 */

import { describe, expect, test } from "bun:test";
import {
	hasManifest,
	loadBenchmarkManifest,
} from "../../src/loaders/data-driven-benchmark";

describe("LoCoMo manifest", () => {
	test("manifest.json exists in LoCoMo directory", async () => {
		const exists = await hasManifest("benchmarks/LoCoMo");
		expect(exists).toBe(true);
	});

	test("manifest.json is valid according to schema", async () => {
		const manifest = await loadBenchmarkManifest("benchmarks/LoCoMo/manifest.json");

		expect(manifest.manifest_version).toBe("1");
		expect(manifest.name).toBe("LoCoMo");
		expect(manifest.version).toBe("1.0.0");
	});

	test("manifest has LoCoMo-specific flatten config", async () => {
		const manifest = await loadBenchmarkManifest("benchmarks/LoCoMo/manifest.json");
		expect(manifest.flatten).toBeDefined();
		expect(manifest.flatten?.field).toBe("qa");
		expect(manifest.flatten?.max_items).toBe(5);
		expect(manifest.flatten?.promote_fields).toContain("evidence");
	});

	test("manifest has correct ingestion config for dynamic sessions", async () => {
		const manifest = await loadBenchmarkManifest("benchmarks/LoCoMo/manifest.json");

		expect(manifest.ingestion.strategy).toBe("session-based");
		if (manifest.ingestion.strategy === "session-based") {
			expect(manifest.ingestion.sessions_field).toBe("conversation");
			expect(manifest.ingestion.sessions_format).toBe("dynamic_keys");
			expect(manifest.ingestion.session_key_prefix).toBe("session_");
			expect(manifest.ingestion.date_key_suffix).toBe("_date_time");
			expect(manifest.ingestion.evidence_field).toBe("evidence");
			expect(manifest.ingestion.evidence_parser).toBe("dialog_refs");
			expect(manifest.ingestion.mode).toBe("lazy");
		}
	});

	test("manifest declares retrieval metrics including rank/coverage", async () => {
		const manifest = await loadBenchmarkManifest("benchmarks/LoCoMo/manifest.json");

		expect(manifest.metrics).toContain("retrieval_precision");
		expect(manifest.metrics).toContain("retrieval_recall");
		expect(manifest.metrics).toContain("retrieval_f1");
		expect(manifest.metrics).toContain("retrieval_coverage");
		expect(manifest.metrics).toContain("retrieval_ndcg");
		expect(manifest.metrics).toContain("retrieval_map");
	});
});

describe("LoCoMo type instructions", () => {
	test("type_instructions.json exists", async () => {
		const file = Bun.file("benchmarks/LoCoMo/type_instructions.json");
		expect(await file.exists()).toBe(true);
	});

	test("type_instructions.json contains categories 1-3", async () => {
		const file = Bun.file("benchmarks/LoCoMo/type_instructions.json");
		const instructions = (await file.json()) as Record<string, unknown>;

		for (const key of ["1", "2", "3"]) {
			expect(instructions[key]).toBeDefined();
			expect(typeof instructions[key]).toBe("string");
			expect((instructions[key] as string).length).toBeGreaterThan(0);
		}
	});
});

