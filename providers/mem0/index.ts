/**
 * Mem0 Provider
 *
 * Integrates with the Mem0 API (https://mem0.ai) for intelligent
 * memory storage with automatic fact extraction and graph support.
 *
 * Authentication: Requires MEM0_API_KEY environment variable
 */
import type {
	MemoryRecord,
	ProviderCapabilities,
	RetrievalItem,
	ScopeContext,
} from "../../types/core";
import type { BaseProvider } from "../../types/provider";

const API_BASE_URL = "https://api.mem0.ai";

/**
 * Get API key from environment
 */
function getApiKey(): string {
	const apiKey = process.env.MEM0_API_KEY;
	if (!apiKey) {
		throw new Error(
			"MEM0_API_KEY environment variable is required for Mem0 provider",
		);
	}
	return apiKey;
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
			Authorization: `Token ${apiKey}`,
			"Content-Type": "application/json",
			Accept: "application/json",
			...options.headers,
		},
	});

	if (!response.ok) {
		const errorText = await response.text().catch(() => "Unknown error");
		throw new Error(
			`Mem0 API error: ${response.status} ${response.statusText} - ${errorText}`,
		);
	}

	// Handle 204 No Content (for DELETE)
	if (response.status === 204) {
		return {} as T;
	}

	return response.json() as Promise<T>;
}

// Type definitions for Mem0 API responses
interface AddMemoryResponse {
	id: string;
	event: string;
	data: {
		memory: string;
	};
}

interface SearchResult {
	id: string;
	memory: string;
	user_id?: string;
	created_at: string;
	updated_at: string;
	metadata?: Record<string, unknown>;
	categories?: string[];
	score?: number;
}

interface ListMemoryResult {
	id: string;
	memory: string;
	created_at: string;
	updated_at: string;
	owner?: string;
	metadata?: Record<string, unknown>;
}

/**
 * Mem0 Provider Implementation
 */
const mem0Provider: BaseProvider = {
	name: "mem0",

	async add_memory(
		scope: ScopeContext,
		content: string,
		metadata?: Record<string, unknown>,
	): Promise<MemoryRecord> {

		const response = await apiRequest<AddMemoryResponse[]>("/v1/memories/", {
			method: "POST",
			body: JSON.stringify({
				user_id: scope.user_id, // user_id includes run_id for scope isolation
				messages: [{ role: "user", content }],
				metadata: metadata ?? {},
			}),
		});


		// Mem0 returns an array of memory events
		const firstResult = response[0];
		return {
			id: firstResult?.id || `mem_${Date.now()}`,
			context: firstResult?.data?.memory || content,
			metadata: metadata ?? {},
			timestamp: Date.now(),
		};
	},

	async retrieve_memory(
		scope: ScopeContext,
		query: string,
		limit = 10,
	): Promise<RetrievalItem[]> {

		const response = await apiRequest<SearchResult[]>("/v2/memories/search/", {
			method: "POST",
			body: JSON.stringify({
				query,
				filters: {
					user_id: scope.user_id, // user_id includes run_id for scope isolation
				},
				version: "v2",
				top_k: limit,
			}),
		});

		return response.map((result) => ({
			record: {
				id: result.id,
				context: result.memory,
				metadata: (result.metadata as Record<string, unknown>) ?? {},
				timestamp: result.created_at
					? new Date(result.created_at).getTime()
					: Date.now(),
			},
			score: result.score ?? 0.5,
		}));
	},

	async delete_memory(
		scope: ScopeContext,
		memory_id: string,
	): Promise<boolean> {
		// Mem0 requires valid UUIDs for deletion - skip if not a UUID
		const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
		if (!uuidRegex.test(memory_id)) {
			// Not a valid UUID, skip deletion silently
			return true;
		}
		try {
			await apiRequest(`/v1/memories/${encodeURIComponent(memory_id)}`, {
				method: "DELETE",
			});
			return true;
		} catch (error) {
			// Silently handle delete errors for cleanup
			return true;
		}
	},

	async update_memory(
		scope: ScopeContext,
		memory_id: string,
		content: string,
		metadata?: Record<string, unknown>,
	): Promise<MemoryRecord> {
		// Mem0 requires valid UUIDs for updates
		const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
		if (!uuidRegex.test(memory_id)) {
			throw new Error(`Invalid memory ID for update: ${memory_id} (must be UUID format)`);
		}

		const response = await apiRequest<{
			id: string;
			text: string;
			user_id?: string;
			updated_at: string;
			metadata?: Record<string, unknown>;
		}>(`/v1/memories/${encodeURIComponent(memory_id)}`, {
			method: "PUT",
			body: JSON.stringify({
				text: content,
				metadata: metadata ?? {},
			}),
		});

		return {
			id: response.id,
			context: response.text,
			metadata: (response.metadata as Record<string, unknown>) ?? {},
			timestamp: response.updated_at ? new Date(response.updated_at).getTime() : Date.now(),
		};
	},

	async list_memories(
		scope: ScopeContext,
		limit = 100,
		offset = 0,
	): Promise<MemoryRecord[]> {
		const page = Math.floor(offset / limit) + 1;

		const response = await apiRequest<ListMemoryResult[]>("/v2/memories", {
			method: "POST",
			body: JSON.stringify({
				filters: {
					user_id: scope.user_id,
				},
				version: "v2",
				page,
				page_size: limit,
			}),
		});

		return response.map((doc) => ({
			id: doc.id,
			context: doc.memory,
			metadata: (doc.metadata as Record<string, unknown>) ?? {},
			timestamp: doc.created_at ? new Date(doc.created_at).getTime() : Date.now(),
		}));
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
				reset_scope: false,
				get_capabilities: true,
			},
			system_flags: {
				async_indexing: true,
				convergence_wait_ms: 15000, // 15s wait for async indexing to complete
			},
			intelligence_flags: {
				auto_extraction: true,
				graph_support: true,
			},
		};
	},
};

export default mem0Provider;
