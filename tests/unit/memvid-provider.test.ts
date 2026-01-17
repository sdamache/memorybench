import { describe, expect, test } from "bun:test";
import memvidProvider from "../../providers/memvid";
import type { ScopeContext } from "../../types/core";

describe("memvid provider", () => {
	test("adds, retrieves, and resets scope", async () => {
		const scope: ScopeContext = {
			user_id: "test-user-memvid",
			run_id: "test-run-memvid",
			session_id: "memvid_unit_test",
			namespace: "unit",
		};

		await memvidProvider.reset_scope?.(scope);

		const content = "=== Session: D1 ===\n\n[USER]: Alice likes tea.";
		const record = await memvidProvider.add_memory(scope, content, {
			_sessionId: "D1",
		});
		expect(record.id.length).toBeGreaterThan(0);

		const results = await memvidProvider.retrieve_memory(scope, "tea", 5);
		expect(results.length).toBeGreaterThan(0);
		expect(results[0]?.record.context).toContain("Alice likes tea.");
		expect(results[0]?.record.context).toContain("=== Session: D1 ===");

		const ok = await memvidProvider.reset_scope?.(scope);
		expect(ok).toBe(true);

		const after = await memvidProvider.retrieve_memory(scope, "tea", 5);
		expect(after.length).toBe(0);
	});
});
