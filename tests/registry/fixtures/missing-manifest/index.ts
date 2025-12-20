/**
 * Missing Manifest Fixture - Error Test
 *
 * Provider with index.ts but no manifest.json.
 * Should produce "missing manifest" warning.
 */

import type { BaseProvider } from "../../../../types/provider";
import type {
	ScopeContext,
	MemoryRecord,
	RetrievalItem,
} from "../../../../types/core";

const missingManifestProvider: BaseProvider = {
	name: "missing-manifest",

	async add_memory(
		scope: ScopeContext,
		content: string,
		metadata?: Record<string, unknown>,
	): Promise<MemoryRecord> {
		return {
			id: crypto.randomUUID(),
			context: content,
			metadata: metadata ?? {},
			timestamp: Date.now(),
		};
	},

	async retrieve_memory(
		scope: ScopeContext,
		query: string,
		limit: number = 10,
	): Promise<RetrievalItem[]> {
		return [];
	},

	async delete_memory(
		scope: ScopeContext,
		memory_id: string,
	): Promise<boolean> {
		return true;
	},
};

export default missingManifestProvider;
