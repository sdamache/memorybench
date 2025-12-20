/**
 * ProviderRegistry Tests
 *
 * Tests registry loading, provider lookup, and multi-provider handling.
 * (T021, T022, User Story 2)
 */

import { test, expect, describe, beforeEach } from "bun:test";
import type { BaseProvider } from "../../types/provider";
import type { ScopeContext } from "../../types/core";

// Dynamic import to allow reset between tests
async function getRegistry() {
	const { ProviderRegistry } = await import("../../src/loaders/providers");
	return ProviderRegistry;
}

describe("ProviderRegistry - Singleton and Initialization", () => {
	beforeEach(async () => {
		// Reset singleton before each test
		const Registry = await getRegistry();
		Registry.reset();
	});

	test("getInstance() creates singleton instance", async () => {
		const Registry = await getRegistry();
		const fixturesDir = process.cwd() + "/tests/registry/fixtures";

		const instance1 = await Registry.getInstance(fixturesDir);
		const instance2 = await Registry.getInstance(fixturesDir);

		// Same instance returned
		expect(instance1).toBe(instance2);
	});

	test("reset() clears singleton instance", async () => {
		const Registry = await getRegistry();
		const fixturesDir = process.cwd() + "/tests/registry/fixtures";

		const instance1 = await Registry.getInstance(fixturesDir);
		Registry.reset();
		const instance2 = await Registry.getInstance(fixturesDir);

		// Different instances after reset
		expect(instance1).not.toBe(instance2);
	});

	test("initialize() eagerly loads providers from fixtures", async () => {
		const Registry = await getRegistry();
		const fixturesDir = process.cwd() + "/tests/registry/fixtures";

		const registry = await Registry.getInstance(fixturesDir);
		const providers = registry.listProviders();

		// Should find valid-minimal and valid-full fixtures
		expect(providers.length).toBeGreaterThanOrEqual(2);
	});
});

describe("ProviderRegistry - Provider Lookup (T021)", () => {
	beforeEach(async () => {
		const Registry = await getRegistry();
		Registry.reset();
	});

	test("getProvider() returns provider by name", async () => {
		const Registry = await getRegistry();
		const fixturesDir = process.cwd() + "/tests/registry/fixtures";

		const registry = await Registry.getInstance(fixturesDir);
		const provider = registry.getProvider("valid-minimal");

		expect(provider).toBeDefined();
		expect(provider?.adapter.name).toBe("valid-minimal");
	});

	test("getProvider() returns undefined for non-existent provider", async () => {
		const Registry = await getRegistry();
		const fixturesDir = process.cwd() + "/tests/registry/fixtures";

		const registry = await Registry.getInstance(fixturesDir);
		const provider = registry.getProvider("non-existent-provider");

		expect(provider).toBeUndefined();
	});

	test("getProvider() returns LoadedProviderEntry with adapter, manifest, and path", async () => {
		const Registry = await getRegistry();
		const fixturesDir = process.cwd() + "/tests/registry/fixtures";

		const registry = await Registry.getInstance(fixturesDir);
		const entry = registry.getProvider("valid-minimal");

		expect(entry).toBeDefined();
		expect(entry?.adapter).toBeDefined();
		expect(entry?.manifest).toBeDefined();
		expect(entry?.path).toBeDefined();

		// Verify structure
		expect(entry?.adapter.name).toBe("valid-minimal");
		expect(entry?.manifest.provider.name).toBe("valid-minimal");
		expect(entry?.path).toContain("valid-minimal");
	});

	test("listProviders() returns all loaded providers", async () => {
		const Registry = await getRegistry();
		const fixturesDir = process.cwd() + "/tests/registry/fixtures";

		const registry = await Registry.getInstance(fixturesDir);
		const providers = registry.listProviders();

		// Should have at least valid-minimal and valid-full
		expect(providers.length).toBeGreaterThanOrEqual(2);

		// Each entry should have adapter, manifest, path
		for (const entry of providers) {
			expect(entry.adapter).toBeDefined();
			expect(entry.manifest).toBeDefined();
			expect(entry.path).toBeDefined();
		}
	});

	test("listProviders() returns providers with names matching manifests", async () => {
		const Registry = await getRegistry();
		const fixturesDir = process.cwd() + "/tests/registry/fixtures";

		const registry = await Registry.getInstance(fixturesDir);
		const providers = registry.listProviders();

		// Find valid-minimal and valid-full
		const minimal = providers.find((p) => p.adapter.name === "valid-minimal");
		const full = providers.find((p) => p.adapter.name === "valid-full");

		expect(minimal).toBeDefined();
		expect(full).toBeDefined();

		// Names should match manifests
		expect(minimal?.manifest.provider.name).toBe("valid-minimal");
		expect(full?.manifest.provider.name).toBe("valid-full");
	});
});

describe("ProviderRegistry - Multi-Provider Loading (T022)", () => {
	beforeEach(async () => {
		const Registry = await getRegistry();
		Registry.reset();
	});

	test("loads multiple providers with different capabilities", async () => {
		const Registry = await getRegistry();
		const fixturesDir = process.cwd() + "/tests/registry/fixtures";

		const registry = await Registry.getInstance(fixturesDir);

		const minimal = registry.getProvider("valid-minimal");
		const full = registry.getProvider("valid-full");

		expect(minimal).toBeDefined();
		expect(full).toBeDefined();

		// valid-minimal has no optional operations
		expect(minimal?.adapter.update_memory).toBeUndefined();
		expect(minimal?.adapter.list_memories).toBeUndefined();

		// valid-full has all optional operations
		expect(full?.adapter.update_memory).toBeDefined();
		expect(full?.adapter.list_memories).toBeDefined();
		expect(full?.adapter.reset_scope).toBeDefined();
		expect(full?.adapter.get_capabilities).toBeDefined();
	});

	test("can call add_memory on any loaded provider with same interface", async () => {
		const Registry = await getRegistry();
		const fixturesDir = process.cwd() + "/tests/registry/fixtures";

		const registry = await Registry.getInstance(fixturesDir);
		const providers = registry.listProviders();

		const scope: ScopeContext = {
			user_id: "test-user",
			run_id: "multi-provider-test",
		};

		// Call add_memory on each provider - same interface
		for (const entry of providers) {
			const record = await entry.adapter.add_memory(
				scope,
				`Test content for ${entry.adapter.name}`,
				{ test: true },
			);

			// All should return MemoryRecord with same structure
			expect(record).toHaveProperty("id");
			expect(record).toHaveProperty("context");
			expect(record).toHaveProperty("metadata");
			expect(record).toHaveProperty("timestamp");
			expect(record.context).toContain(entry.adapter.name);
		}
	});

	test("can call retrieve_memory on any loaded provider with same interface", async () => {
		const Registry = await getRegistry();
		const fixturesDir = process.cwd() + "/tests/registry/fixtures";

		const registry = await Registry.getInstance(fixturesDir);
		const providers = registry.listProviders();

		const scope: ScopeContext = {
			user_id: "test-user",
			run_id: "retrieve-test",
		};

		// Add a memory first
		for (const entry of providers) {
			await entry.adapter.add_memory(
				scope,
				"searchable content",
				{},
			);
		}

		// Retrieve from each provider - same interface
		for (const entry of providers) {
			const results = await entry.adapter.retrieve_memory(
				scope,
				"searchable",
				10,
			);

			// All should return RetrievalItem[]
			expect(Array.isArray(results)).toBe(true);

			if (results.length > 0) {
				expect(results[0]).toHaveProperty("record");
				expect(results[0]).toHaveProperty("score");
			}
		}
	});

	test("provider-agnostic iteration pattern works", async () => {
		const Registry = await getRegistry();
		const fixturesDir = process.cwd() + "/tests/registry/fixtures";

		const registry = await Registry.getInstance(fixturesDir);

		const scope: ScopeContext = {
			user_id: "test-user",
			run_id: "iteration-test",
		};

		// Pattern: Runner code that doesn't know about specific providers
		const results: Array<{ provider: string; memoryId: string }> = [];

		for (const entry of registry.listProviders()) {
			const provider = entry.adapter;

			// Same code works for all providers
			const memory = await provider.add_memory(
				scope,
				"test content",
				{},
			);
			results.push({ provider: provider.name, memoryId: memory.id });
		}

		// Should have results from all providers
		expect(results.length).toBeGreaterThanOrEqual(2);
		expect(results.some((r) => r.provider === "valid-minimal")).toBe(true);
		expect(results.some((r) => r.provider === "valid-full")).toBe(true);
	});
});
