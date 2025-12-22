import type {
	MemoryRecord,
	ProviderCapabilities,
	RetrievalItem,
	ScopeContext,
} from "../../types/core";
import type { BaseProvider } from "../../types/provider";
import { tokenize, bm25Score, avgDocLength } from "../../src/utils/bm25";

// In-memory storage for LocalBaseline provider
const memories = new Map<string, MemoryRecord>();

/**
 * LocalBaseline Provider
 *
 * A zero-dependency, in-memory provider for MemoryBench that uses BM25
 * lexical retrieval. Designed for:
 * - Harness sanity checks (if this passes, the runner works)
 * - Comparison baseline (sets the "floor" for real providers)
 * - Zero-config testing (runs in CI without API keys)
 *
 * Retrieval uses BM25 (Best Matching 25), an industry-standard probabilistic
 * ranking function for lexical text matching.
 */
const localBaseline: BaseProvider = {
	name: "LocalBaseline", // Must match manifest.provider.name

	// === Required Operations ===

	async add_memory(
		scope: ScopeContext,
		content: string,
		metadata?: Record<string, unknown>,
	): Promise<MemoryRecord> {
		const id = crypto.randomUUID();
		const record: MemoryRecord = {
			id,
			context: content,
			metadata: metadata ?? {},
			timestamp: Date.now(),
		};

		// Scope isolation: key includes user_id and run_id
		const key = `${scope.user_id}:${scope.run_id}:${id}`;
		memories.set(key, record);

		return record;
	},

	async retrieve_memory(
		scope: ScopeContext,
		query: string,
		limit = 10,
	): Promise<RetrievalItem[]> {
		const prefix = `${scope.user_id}:${scope.run_id}:`;

		// Collect all records in scope
		const scopedRecords: Array<{ key: string; record: MemoryRecord }> = [];
		for (const [key, record] of memories) {
			if (key.startsWith(prefix)) {
				scopedRecords.push({ key, record });
			}
		}

		if (scopedRecords.length === 0) {
			return [];
		}

		// Tokenize query and all documents for BM25 scoring
		const queryTokens = tokenize(query);
		const allDocTokens = scopedRecords.map((r) => tokenize(r.record.context));
		const avgDl = avgDocLength(allDocTokens);

		// Score each document using BM25
		const scoredResults = scopedRecords.map((r, index) => {
			const docTokens = allDocTokens[index] ?? [];
			const score = bm25Score(queryTokens, docTokens, allDocTokens, avgDl);
			return {
				record: r.record,
				score,
			};
		});

		// Sort by score descending and filter out zero scores
		const results = scoredResults
			.filter((r) => r.score > 0)
			.sort((a, b) => b.score - a.score)
			.slice(0, limit);

		return results;
	},

	async delete_memory(
		scope: ScopeContext,
		memory_id: string,
	): Promise<boolean> {
		const key = `${scope.user_id}:${scope.run_id}:${memory_id}`;
		return memories.delete(key);
	},

	// === Optional Operations (only if declared in manifest) ===

	async list_memories(
		scope: ScopeContext,
		limit = 100,
		offset = 0,
	): Promise<MemoryRecord[]> {
		const prefix = `${scope.user_id}:${scope.run_id}:`;
		const results: MemoryRecord[] = [];

		for (const [key, record] of memories) {
			if (key.startsWith(prefix)) {
				results.push(record);
			}
		}

		return results.slice(offset, offset + limit);
	},

	async get_capabilities(): Promise<ProviderCapabilities> {
		return {
			core_operations: {
				add_memory: true,
				retrieve_memory: true,
				delete_memory: true,
			},
			optional_operations: {
				update_memory: false,
				list_memories: true,
				reset_scope: false,
				get_capabilities: true,
			},
			system_flags: {
				async_indexing: false,
			},
			intelligence_flags: {
				auto_extraction: false,
				graph_support: false,
			},
		};
	},
};

export default localBaseline;
