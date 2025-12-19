/**
 * Core Types for Memory Benchmark Harness
 *
 * This file defines the shared type contracts used by:
 * - Memory providers (implement these interfaces)
 * - Benchmarks (consume these interfaces)
 * - Runner (orchestrates using these interfaces)
 *
 * @module types/core
 * @see specs/003-core-types/spec.md
 */

// =============================================================================
// Type Exports
// =============================================================================

// =============================================================================
// ScopeContext - Execution context for memory operations
// =============================================================================

/**
 * Represents the execution context for memory operations.
 * Enables test isolation and multi-tenancy.
 *
 * @example
 * const scope: ScopeContext = {
 *   user_id: "user_123",
 *   run_id: "run_456",
 *   session_id: "session_789", // optional
 *   namespace: "benchmark_a"   // optional
 * };
 */
export interface ScopeContext {
	/** Unique identifier for the user/tenant (required) */
	user_id: string;

	/** Unique identifier for the benchmark run (required) */
	run_id: string;

	/** Optional session grouping within a run */
	session_id?: string;

	/** Optional namespace for logical isolation */
	namespace?: string;
}

// =============================================================================
// MemoryRecord - A stored memory item
// =============================================================================

/**
 * Represents a single memory item stored by a provider.
 * Aligns with existing PreparedData pattern but adds id and timestamp.
 *
 * @example
 * const record: MemoryRecord = {
 *   id: "mem_001",
 *   context: "User prefers dark mode for all interfaces",
 *   metadata: { category: "preference", confidence: 0.95 },
 *   timestamp: Date.now()
 * };
 */
export interface MemoryRecord {
	/** Unique identifier for this record */
	id: string;

	/** The content being remembered (aligns with PreparedData.context) */
	context: string;

	/** Flexible key-value metadata (must be JSON-serializable) */
	metadata: Record<string, unknown>;

	/** Creation timestamp as Unix epoch milliseconds */
	timestamp: number;
}

// =============================================================================
// RetrievalItem - A search result
// =============================================================================

/**
 * Represents a single result from a memory retrieval operation.
 * Wraps MemoryRecord with relevance scoring.
 *
 * @example
 * const result: RetrievalItem = {
 *   record: { id: "mem_001", context: "...", metadata: {}, timestamp: 123 },
 *   score: 0.87,
 *   match_context: "Matched on keyword 'dark mode'"
 * };
 */
export interface RetrievalItem {
	/** The matched memory record */
	record: MemoryRecord;

	/** Relevance score, normalized to range [0, 1] where 1 is exact match */
	score: number;

	/** Optional explanation of why/how the match occurred */
	match_context?: string;
}

// =============================================================================
// ProviderCapabilities - Provider feature declaration
// =============================================================================

/**
 * Core operations that all providers must support.
 */
export interface CoreOperations {
	/** Provider can store new memories */
	add_memory: boolean;

	/** Provider can search/retrieve memories */
	retrieve_memory: boolean;

	/** Provider can delete memories */
	delete_memory: boolean;
}

/**
 * Optional operations that providers may support.
 */
export interface OptionalOperations {
	/** Provider can modify existing memories */
	update_memory?: boolean;

	/** Provider can enumerate all memories in a scope */
	list_memories?: boolean;

	/** Provider can clear all memories in a scope */
	reset_scope?: boolean;

	/** Provider can describe its own capabilities */
	get_capabilities?: boolean;
}

/**
 * System-level flags for async behavior and timing.
 */
export interface SystemFlags {
	/** Whether the provider indexes asynchronously */
	async_indexing: boolean;

	/** Expected processing latency in milliseconds */
	processing_latency?: number;

	/** Milliseconds to wait for index convergence after writes */
	convergence_wait_ms?: number;
}

/**
 * Intelligence flags for advanced features.
 */
export interface IntelligenceFlags {
	/** Provider automatically extracts entities/facts from content */
	auto_extraction: boolean;

	/** Provider maintains a knowledge graph */
	graph_support: boolean;

	/** Type of graph if supported (e.g., "knowledge", "temporal", "social") */
	graph_type?: string;
}

/**
 * Declares what operations and features a memory provider supports.
 * Used by the runner to adapt test execution.
 *
 * @note Provider implementations are responsible for validating that declared
 * capabilities match actual implementation. The type system allows any combination;
 * semantic validation (e.g., ensuring all core operations are truly implemented) is
 * the provider's responsibility.
 *
 * @example
 * const capabilities: ProviderCapabilities = {
 *   core_operations: {
 *     add_memory: true,
 *     retrieve_memory: true,
 *     delete_memory: true
 *   },
 *   optional_operations: {
 *     update_memory: false,
 *     list_memories: true
 *   },
 *   system_flags: {
 *     async_indexing: true,
 *     convergence_wait_ms: 500
 *   },
 *   intelligence_flags: {
 *     auto_extraction: true,
 *     graph_support: false
 *   }
 * };
 */
export interface ProviderCapabilities {
	/** Core operations (all should be true for valid provider) */
	core_operations: CoreOperations;

	/** Optional operations the provider supports */
	optional_operations: OptionalOperations;

	/** System-level async and timing flags */
	system_flags: SystemFlags;

	/** Advanced intelligence features */
	intelligence_flags: IntelligenceFlags;
}

// =============================================================================
// Type Guards (optional utilities)
// =============================================================================

/**
 * Type guard to check if an object is a valid ScopeContext.
 */
export function isScopeContext(obj: unknown): obj is ScopeContext {
	return (
		typeof obj === "object" &&
		obj !== null &&
		typeof (obj as ScopeContext).user_id === "string" &&
		typeof (obj as ScopeContext).run_id === "string"
	);
}

/**
 * Type guard to check if an object is a valid MemoryRecord.
 */
export function isMemoryRecord(obj: unknown): obj is MemoryRecord {
	return (
		typeof obj === "object" &&
		obj !== null &&
		typeof (obj as MemoryRecord).id === "string" &&
		typeof (obj as MemoryRecord).context === "string" &&
		typeof (obj as MemoryRecord).metadata === "object" &&
		typeof (obj as MemoryRecord).timestamp === "number"
	);
}

/**
 * Type guard to check if a score is valid (0-1 range).
 */
export function isValidScore(score: number): boolean {
	return typeof score === "number" && score >= 0 && score <= 1;
}
