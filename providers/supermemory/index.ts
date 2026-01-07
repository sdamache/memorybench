/**
 * Supermemory Provider
 *
 * Integrates with the Supermemory API (https://supermemory.ai) for
 * intelligent memory storage and retrieval with automatic chunking
 * and semantic search.
 *
 * Authentication: Requires SUPERMEMORY_API_KEY environment variable
 */
import type {
	MemoryRecord,
	ProviderCapabilities,
	RetrievalItem,
	ScopeContext,
} from "../../types/core";
import type { BaseProvider } from "../../types/provider";

const API_BASE_URL =
	process.env.SUPERMEMORY_API_URL ?? "https://api.supermemory.ai/v3";

/**
 * Get API key from environment
 */
function getApiKey(): string {
	const apiKey = process.env.SUPERMEMORY_API_KEY;
	if (!apiKey) {
		throw new Error(
			"SUPERMEMORY_API_KEY environment variable is required for Supermemory provider",
		);
	}
	return apiKey;
}

/**
 * Generate a container tag for scope isolation
 * Format: memorybench_{run12}_{scopeHash12}
 *
 * Note: We intentionally include scope.session_id (when present) via a hash to ensure
 * per-case isolation during concurrent execution. Using only user_id/run_id causes
 * cross-case contamination and degraded benchmark scores.
 */
function getScopeTag(scope: ScopeContext): string {
	// Sanitize to alphanumeric with hyphens and underscores only
	const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_");

	const sessionKey = scope.session_id ?? scope.namespace ?? "default";
	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(`${scope.user_id}|${scope.run_id}|${sessionKey}`);
	const scopeHash = hasher.digest("hex").slice(0, 12);

	const runPart = sanitize(scope.run_id).slice(0, 12);
	return `memorybench_${runPart}_${scopeHash}`;
}

/**
 * Make authenticated API request
 */
async function apiRequest<T>(
	endpoint: string,
	options: RequestInit = {},
): Promise<T> {
	const apiKey = getApiKey();

	const response = await fetch(`${API_BASE_URL}${endpoint}`, {
		...options,
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
			...options.headers,
		},
	});

	if (!response.ok) {
		const errorText = await response.text().catch(() => "Unknown error");
		throw new Error(
			`Supermemory API error: ${response.status} ${response.statusText} - ${errorText}`,
		);
	}

	// Handle 204 No Content (for DELETE)
	if (response.status === 204) {
		return {} as T;
	}

	return response.json() as Promise<T>;
}

// Type definitions for Supermemory API responses
interface AddDocumentResponse {
	id: string;
	status: string;
}

interface SearchResult {
	chunks: Array<{
		content: string;
		isRelevant: boolean;
		score: number;
	}>;
	documentId: string;
	score: number;
	title?: string;
	metadata?: Record<string, unknown>;
	createdAt?: string;
}

interface SearchResponse {
	results: SearchResult[];
	timing: number;
	total: number;
}

interface ListDocument {
	id: string;
	customId?: string;
	containerTags?: string[];
	title?: string;
	type?: string;
	status?: string;
	metadata?: Record<string, unknown>;
	summary?: string;
	createdAt?: string;
	updatedAt?: string;
}

interface ListResponse {
	memories: ListDocument[];
	pagination: {
		currentPage: number;
		limit: number;
		totalItems: number;
		totalPages: number;
	};
}

function isTerminalStatus(status: string): boolean {
	const normalized = status.trim().toLowerCase();
	return normalized === "done" || normalized === "failed";
}

async function fetchDocumentsForIds(params: {
	containerTag: string;
	ids: readonly string[];
}): Promise<Map<string, ListDocument>> {
	const containerTag = params.containerTag;
	const ids = params.ids;

	const idSet = new Set(
		ids.filter((id) => typeof id === "string" && id.length > 0),
	);
	const found = new Map<string, ListDocument>();
	if (idSet.size === 0) return found;

	const pageSize = 100;
	const maxPages = 10;

	for (let page = 1; page <= maxPages; page++) {
		const response = await apiRequest<ListResponse>("/documents/list", {
			method: "POST",
			body: JSON.stringify({
				containerTags: [containerTag],
				limit: pageSize,
				page,
				order: "desc",
				sort: "createdAt",
			}),
		});

		for (const doc of response.memories) {
			if (idSet.has(doc.id)) {
				found.set(doc.id, doc);
			}
			if (doc.customId && idSet.has(doc.customId)) {
				found.set(doc.customId, doc);
			}
		}

		if (found.size >= idSet.size) break;
		if (response.memories.length === 0) break;
		if (page >= response.pagination.totalPages) break;
	}

	return found;
}

/**
 * Supermemory Provider Implementation
 */
const supermemoryProvider: BaseProvider = {
	name: "supermemory",

	async add_memory(
		scope: ScopeContext,
		content: string,
		metadata?: Record<string, unknown>,
	): Promise<MemoryRecord> {
		const containerTag = getScopeTag(scope);
		const customId = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

		const response = await apiRequest<AddDocumentResponse>("/documents", {
			method: "POST",
			body: JSON.stringify({
				content,
				containerTag,
				customId,
				metadata: {
					...metadata,
					scope_user_id: scope.user_id,
					scope_run_id: scope.run_id,
					scope_session_id: scope.session_id,
					scope_namespace: scope.namespace,
				},
			}),
		});

		return {
			id: response.id || customId,
			context: content,
			metadata: metadata ?? {},
			timestamp: Date.now(),
		};
	},

	async retrieve_memory(
		scope: ScopeContext,
		query: string,
		limit = 10,
	): Promise<RetrievalItem[]> {
		// Use containerTags for scope isolation
		const containerTag = getScopeTag(scope);
		const response = await apiRequest<SearchResponse>("/search", {
			method: "POST",
			body: JSON.stringify({
				q: query,
				containerTags: [containerTag], // Scope isolation enabled
				limit: Math.min(limit, 100),
				onlyMatchingChunks: false,
			}),
		});

		return response.results.map((result) => ({
			record: {
				id: result.documentId,
				context: result.chunks.map((c) => c.content).join("\n\n"),
				metadata: (result.metadata as Record<string, unknown>) ?? {},
				timestamp: result.createdAt
					? new Date(result.createdAt).getTime()
					: Date.now(),
			},
			score: result.score,
		}));
	},

	async await_convergence(
		scope: ScopeContext,
		ingestedIds: string[],
		timeoutMs: number,
	): Promise<void> {
		const containerTag = getScopeTag(scope);
		const uniqueIds = Array.from(
			new Set(
				ingestedIds.filter((id) => typeof id === "string" && id.length > 0),
			),
		);
		if (uniqueIds.length === 0) return;

		const deadline = Date.now() + timeoutMs;
		const pollIntervalMs = 2000;

		while (true) {
			try {
				const docsById = await fetchDocumentsForIds({
					containerTag,
					ids: uniqueIds,
				});

				let pending = 0;
				for (const id of uniqueIds) {
					const doc = docsById.get(id);
					if (!doc) {
						pending++;
						continue;
					}

					if (typeof doc.status !== "string" || !isTerminalStatus(doc.status)) {
						pending++;
					}
				}

				if (pending === 0) return;
			} catch {
				// Ignore errors and rely on timeout fallback
			}

			if (Date.now() >= deadline) return;
			await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
		}
	},

	async delete_memory(
		scope: ScopeContext,
		memory_id: string,
	): Promise<boolean> {
		try {
			await apiRequest(`/documents/${encodeURIComponent(memory_id)}`, {
				method: "DELETE",
			});
			return true;
		} catch (error) {
			console.error(`Failed to delete memory ${memory_id}:`, error);
			return false;
		}
	},

	async update_memory(
		scope: ScopeContext,
		memory_id: string,
		content: string,
		metadata?: Record<string, unknown>,
	): Promise<MemoryRecord> {
		const response = await apiRequest<{
			id: string;
			status: string;
		}>(`/documents/${encodeURIComponent(memory_id)}`, {
			method: "PATCH",
			body: JSON.stringify({
				content,
				metadata: {
					...metadata,
					scope_user_id: scope.user_id,
					scope_run_id: scope.run_id,
				},
			}),
		});

		// PATCH response only includes {id, status}, return updated content from input
		return {
			id: response.id,
			context: content,
			metadata: metadata ?? {},
			timestamp: Date.now(),
		};
	},

	async list_memories(
		scope: ScopeContext,
		limit = 100,
		offset = 0,
	): Promise<MemoryRecord[]> {
		const containerTag = getScopeTag(scope);
		const page = Math.floor(offset / limit) + 1;

		const response = await apiRequest<ListResponse>("/documents/list", {
			method: "POST",
			body: JSON.stringify({
				containerTags: [containerTag],
				limit,
				page,
				order: "desc",
				sort: "createdAt",
			}),
		});

		return response.memories.map((doc) => ({
			id: doc.id,
			context: doc.summary || doc.title || "",
			metadata: (doc.metadata as Record<string, unknown>) ?? {},
			timestamp: doc.createdAt ? new Date(doc.createdAt).getTime() : Date.now(),
		}));
	},

	async reset_scope(scope: ScopeContext): Promise<boolean> {
		const containerTag = getScopeTag(scope);
		try {
			const response = await apiRequest<{
				success: boolean;
				deletedCount: number;
				errors?: Array<{ id: string; error: string }>;
				containerTags?: string[];
			}>("/documents/bulk", {
				method: "DELETE",
				body: JSON.stringify({ containerTags: [containerTag] }),
			});
			return response.success === true;
		} catch {
			return false;
		}
	},

	async get_capabilities(): Promise<ProviderCapabilities> {
		return {
			core_operations: {
				add_memory: true,
				retrieve_memory: true,
				delete_memory: true,
			},
			optional_operations: {
				update_memory: true,
				list_memories: true,
				reset_scope: true,
				get_capabilities: true,
			},
			system_flags: {
				async_indexing: true, // Documents are queued for processing
				convergence_wait_ms: 30000, // Max wait for async indexing to complete
			},
			intelligence_flags: {
				auto_extraction: true, // Extracts from URLs, PDFs, etc.
				graph_support: false,
			},
		};
	},
};

export default supermemoryProvider;
