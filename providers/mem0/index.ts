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
const UUID_REGEX =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getScopedUserId(scope: ScopeContext): string {
	const sanitize = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_");
	const runPart = sanitize(scope.run_id).slice(0, 12);
	const sessionKey = scope.session_id ?? scope.namespace ?? "default";

	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(`${scope.user_id}|${scope.run_id}|${sessionKey}`);
	const scopeHash = hasher.digest("hex").slice(0, 12);

	return `memorybench_${runPart}_${scopeHash}`;
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function parseSearchResults(raw: unknown): SearchResult[] {
	const items: unknown[] = Array.isArray(raw)
		? raw
		: isRecord(raw) && Array.isArray(raw.results)
			? raw.results
			: [];

	const results: SearchResult[] = [];
	for (const item of items) {
		if (!isRecord(item)) continue;
		const id = typeof item.id === "string" ? item.id : null;
		const memory = typeof item.memory === "string" ? item.memory : null;
		if (!id || !memory) continue;

		const created_at =
			typeof item.created_at === "string" ? item.created_at : "";
		const updated_at =
			typeof item.updated_at === "string" ? item.updated_at : "";
		const user_id = typeof item.user_id === "string" ? item.user_id : undefined;
		const metadata = isRecord(item.metadata) ? item.metadata : undefined;
		const categories = Array.isArray(item.categories)
			? item.categories.filter((c): c is string => typeof c === "string")
			: undefined;
		const score = typeof item.score === "number" ? item.score : undefined;

		results.push({
			id,
			memory,
			user_id,
			created_at,
			updated_at,
			metadata,
			categories,
			score,
		});
	}

	return results;
}

function parseListResults(raw: unknown): ListMemoryResult[] {
	const items: unknown[] = Array.isArray(raw)
		? raw
		: isRecord(raw) && Array.isArray(raw.results)
			? raw.results
			: [];

	const results: ListMemoryResult[] = [];
	for (const item of items) {
		if (!isRecord(item)) continue;
		const id = typeof item.id === "string" ? item.id : null;
		const memory = typeof item.memory === "string" ? item.memory : null;
		if (!id || !memory) continue;

		const created_at =
			typeof item.created_at === "string" ? item.created_at : "";
		const updated_at =
			typeof item.updated_at === "string" ? item.updated_at : "";
		const owner = typeof item.owner === "string" ? item.owner : undefined;
		const metadata = isRecord(item.metadata) ? item.metadata : undefined;

		results.push({ id, memory, created_at, updated_at, owner, metadata });
	}

	return results;
}

async function fetchMetadataForIds(params: {
	apiKey: string;
	userId: string;
	ids: readonly string[];
}): Promise<Map<string, Record<string, unknown>>> {
	const apiKey = params.apiKey;
	const userId = params.userId;
	const ids = params.ids;

	const idSet = new Set(
		ids.filter((id) => typeof id === "string" && id.length > 0),
	);
	const metadataById = new Map<string, Record<string, unknown>>();
	if (idSet.size === 0) return metadataById;

	const maxPages = 5;
	const pageSize = 100;

	for (let page = 1; page <= maxPages; page++) {
		// Use trailing slash to avoid redirect (some servers convert POST -> GET on 301/302).
		const resp = await fetch(`${API_BASE_URL}/v2/memories/`, {
			method: "POST",
			headers: {
				Authorization: `Token ${apiKey}`,
				"Content-Type": "application/json",
				Accept: "application/json",
			},
			body: JSON.stringify({
				filters: { user_id: userId },
				version: "v2",
				page,
				page_size: pageSize,
			}),
		});

		if (!resp.ok) {
			break;
		}

		const raw = (await resp.json()) as unknown;
		const memories = parseListResults(raw);

		let matchedThisPage = 0;
		for (const mem of memories) {
			if (!idSet.has(mem.id)) continue;
			if (isRecord(mem.metadata)) {
				metadataById.set(mem.id, mem.metadata);
				matchedThisPage++;
			}
		}

		// Stop early if we've resolved all IDs
		if (metadataById.size >= idSet.size) break;

		// If this page had no results, we're done
		if (memories.length === 0) break;

		// If we didn't even see full page size, assume end
		if (memories.length < pageSize) break;

		// If we saw no matches, still continue a couple pages in case ordering differs
		if (matchedThisPage === 0 && page >= 2) {
			// Likely not going to find these IDs via list (or list API behavior changed)
			break;
		}
	}

	return metadataById;
}

async function fetchIdsPresentInList(params: {
	apiKey: string;
	userId: string;
	ids: readonly string[];
}): Promise<Set<string>> {
	const apiKey = params.apiKey;
	const userId = params.userId;
	const ids = params.ids;

	const idSet = new Set(
		ids.filter((id) => typeof id === "string" && id.length > 0),
	);
	const found = new Set<string>();
	if (idSet.size === 0) return found;

	const maxPages = 5;
	const pageSize = 100;

	for (let page = 1; page <= maxPages; page++) {
		// Use trailing slash to avoid redirect (some servers convert POST -> GET on 301/302).
		const resp = await fetch(`${API_BASE_URL}/v2/memories/`, {
			method: "POST",
			headers: {
				Authorization: `Token ${apiKey}`,
				"Content-Type": "application/json",
				Accept: "application/json",
			},
			body: JSON.stringify({
				filters: { user_id: userId },
				version: "v2",
				page,
				page_size: pageSize,
			}),
		});

		if (!resp.ok) {
			break;
		}

		const raw = (await resp.json()) as unknown;
		const memories = parseListResults(raw);

		for (const mem of memories) {
			if (idSet.has(mem.id)) {
				found.add(mem.id);
			}
		}

		if (found.size >= idSet.size) break;
		if (memories.length === 0) break;
		if (memories.length < pageSize) break;
	}

	return found;
}

async function getEventStatus(params: {
	apiKey: string;
	eventId: string;
}): Promise<string | null> {
	const resp = await fetch(
		`${API_BASE_URL}/v1/event/${encodeURIComponent(params.eventId)}/`,
		{
			headers: {
				Authorization: `Token ${params.apiKey}`,
				Accept: "application/json",
			},
		},
	);

	if (!resp.ok) return null;

	const raw = (await resp.json()) as unknown;
	if (!isRecord(raw)) return null;
	return typeof raw.status === "string" ? raw.status : null;
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
		const scopedUserId = getScopedUserId(scope);

		const response = await apiRequest<AddMemoryResponse[]>("/v1/memories/", {
			method: "POST",
			body: JSON.stringify({
				user_id: scopedUserId,
				messages: [{ role: "user", content }],
				metadata: {
					...metadata,
					scope_user_id: scope.user_id,
					scope_run_id: scope.run_id,
					scope_session_id: scope.session_id,
					scope_namespace: scope.namespace,
				},
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
		const scopedUserId = getScopedUserId(scope);

		const raw = await apiRequest<unknown>("/v2/memories/search/", {
			method: "POST",
			body: JSON.stringify({
				query,
				filters: {
					user_id: scopedUserId,
				},
				version: "v2",
				top_k: limit,
			}),
		});

		const response = parseSearchResults(raw);

		// Some Mem0 search output formats omit metadata. If so, backfill metadata
		// for the retrieved IDs via the list API so retrieval metrics can still
		// map results to benchmark session IDs.
		const needsMetadataBackfill = response.some((r) => !isRecord(r.metadata));
		const metadataById = needsMetadataBackfill
			? await fetchMetadataForIds({
					apiKey: getApiKey(),
					userId: scopedUserId,
					ids: response.map((r) => r.id),
				})
			: new Map<string, Record<string, unknown>>();

		return response.map((result) => {
			const meta =
				(isRecord(result.metadata)
					? result.metadata
					: metadataById.get(result.id)) ?? {};

			return {
				record: {
					id: result.id,
					context: result.memory,
					metadata: meta,
					timestamp: result.created_at
						? new Date(result.created_at).getTime()
						: Date.now(),
				},
				score: result.score ?? 0.5,
			};
		});
	},

	async await_convergence(
		scope: ScopeContext,
		ingestedIds: string[],
		timeoutMs: number,
	): Promise<void> {
		const scopedUserId = getScopedUserId(scope);
		const apiKey = getApiKey();

		const uniqueIds = Array.from(
			new Set(
				ingestedIds.filter((id) => typeof id === "string" && id.length > 0),
			),
		);
		if (uniqueIds.length === 0) return;

		const deadline = Date.now() + timeoutMs;
		const pollIntervalMs = 1000;
		const completed = new Set<string>();

		// Determine if these look like Mem0 event IDs (async_mode) by probing one ID.
		let useEventStatus = false;
		try {
			const firstId = uniqueIds[0];
			if (!firstId) {
				return;
			}
			const status = await getEventStatus({
				apiKey,
				eventId: firstId,
			});
			useEventStatus = typeof status === "string";
			if (status === "SUCCEEDED" || status === "FAILED") {
				completed.add(firstId);
			}
		} catch {
			useEventStatus = false;
		}

		while (true) {
			try {
				if (useEventStatus) {
					for (const eventId of uniqueIds) {
						if (completed.has(eventId)) continue;
						const status = await getEventStatus({ apiKey, eventId });
						if (status === "SUCCEEDED" || status === "FAILED") {
							completed.add(eventId);
						}
					}

					if (completed.size >= uniqueIds.length) return;
				} else {
					const found = await fetchIdsPresentInList({
						apiKey,
						userId: scopedUserId,
						ids: uniqueIds,
					});
					if (found.size >= uniqueIds.length) return;
				}
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
		// Mem0 requires valid UUIDs for deletion - skip if not a UUID
		if (!UUID_REGEX.test(memory_id)) {
			// Not a valid UUID, skip deletion silently
			return true;
		}
		try {
			await apiRequest(`/v1/memories/${encodeURIComponent(memory_id)}`, {
				method: "DELETE",
			});
			return true;
		} catch {
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
		if (!UUID_REGEX.test(memory_id)) {
			throw new Error(
				`Invalid memory ID for update: ${memory_id} (must be UUID format)`,
			);
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
			timestamp: response.updated_at
				? new Date(response.updated_at).getTime()
				: Date.now(),
		};
	},

	async list_memories(
		scope: ScopeContext,
		limit = 100,
		offset = 0,
	): Promise<MemoryRecord[]> {
		const scopedUserId = getScopedUserId(scope);
		const page = Math.floor(offset / limit) + 1;

		const raw = await apiRequest<unknown>("/v2/memories/", {
			method: "POST",
			body: JSON.stringify({
				filters: {
					user_id: scopedUserId,
				},
				version: "v2",
				page,
				page_size: limit,
			}),
		});

		const response = parseListResults(raw);

		return response.map((doc) => ({
			id: doc.id,
			context: doc.memory,
			metadata: (doc.metadata as Record<string, unknown>) ?? {},
			timestamp: doc.created_at
				? new Date(doc.created_at).getTime()
				: Date.now(),
		}));
	},

	async reset_scope(scope: ScopeContext): Promise<boolean> {
		const scopedUserId = getScopedUserId(scope);
		const pageSize = 100;
		const maxPages = 50;

		for (let page = 1; page <= maxPages; page++) {
			let raw: unknown;
			try {
				raw = await apiRequest<unknown>("/v2/memories/", {
					method: "POST",
					body: JSON.stringify({
						filters: { user_id: scopedUserId },
						version: "v2",
						page,
						page_size: pageSize,
					}),
				});
			} catch {
				return false;
			}

			const memories = parseListResults(raw);
			if (memories.length === 0) break;

			for (const mem of memories) {
				if (!UUID_REGEX.test(mem.id)) continue;
				try {
					await apiRequest(`/v1/memories/${encodeURIComponent(mem.id)}`, {
						method: "DELETE",
					});
				} catch {
					// Ignore delete errors during cleanup
				}
			}

			if (memories.length < pageSize) break;
		}

		return true;
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
				async_indexing: true,
				convergence_wait_ms: 30000, // 30s wait for async indexing to complete
			},
			intelligence_flags: {
				auto_extraction: true,
				graph_support: true,
			},
		};
	},
};

export default mem0Provider;
