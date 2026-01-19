/**
 * CRUD Semantics Benchmark - Local Type Definitions
 *
 * These types define the interface contracts for the CRUD Semantics benchmark.
 * They mirror the contracts in specs/014-crud-semantics-benchmark/contracts/benchmark-types.ts
 *
 * @module benchmarks/CRUD-semantics/types
 * @see specs/014-crud-semantics-benchmark/data-model.md
 */

// =============================================================================
// Test Case Types
// =============================================================================

/**
 * Types of CRUD test cases supported by the benchmark
 */
export type CRUDCaseType =
	| "write_retrieve"
	| "update_staleness"
	| "delete_leakage";

/**
 * Synthetic fact with unique tokens for deterministic verification
 */
export interface SyntheticFact {
	/** Fact category (e.g., "FAVORITE_COLOR", "PET_NAME") */
	readonly category: string;

	/** Initial unique token (e.g., "ULTRAVIOLET_123") */
	readonly initial_value: string;

	/** Updated token for update tests (e.g., "CRIMSON_456") */
	readonly updated_value?: string;

	/** Template for memory content with {value} placeholder */
	readonly content_template: string;

	/** Query to validate this fact (optional; falls back to case.query) */
	readonly verification_query?: string;

	/** Optional metadata markers for fallback verification */
	readonly metadata?: Record<string, unknown>;
}

/**
 * A single CRUD test case definition
 */
export interface CRUDTestCase {
	/** Unique case identifier (e.g., "write_retrieve_01") */
	readonly id: string;

	/** Type of CRUD operation being tested */
	readonly type: CRUDCaseType;

	/** Human-readable description */
	readonly description?: string;

	/** The synthetic fact to test */
	readonly fact: SyntheticFact;

	/** Optional additional facts to pre-load into the same scope */
	readonly setup_facts?: readonly SyntheticFact[];

	/** Primary verification query */
	readonly query: string;

	/** Additional queries (used for delete leakage and update staleness checks) */
	readonly adversarial_queries?: readonly string[];

	/** Optional capability gate (e.g., "update_memory") */
	readonly requires_capability?: string;
}

// =============================================================================
// Result Types
// =============================================================================

/**
 * Metrics emitted by CRUD benchmark cases
 */
export interface CRUDScores {
	/** 1 if initial token found after write, 0 otherwise */
	readonly write_retrieve_success: number;

	/** Count of queries returning old token after update */
	readonly staleness_violation_count: number;

	/** Count of queries returning deleted token */
	readonly delete_leakage_count: number;

	/** Time for add_memory operation in milliseconds */
	readonly add_latency_ms: number;

	/** Time for retrieve_memory operation in milliseconds */
	readonly retrieve_latency_ms: number;

	/** Time for update_memory operation (0 if skipped) */
	readonly update_latency_ms: number;

	/** Time for delete_memory operation in milliseconds */
	readonly delete_latency_ms: number;
}

/**
 * Debug artifacts for failed cases
 */
export interface CRUDArtifacts {
	/** Memory IDs returned from add_memory (including any setup facts) */
	readonly ingested_ids?: readonly string[];

	/** Which results contained the expected token */
	readonly token_found_in?: readonly string[];

	/** Raw query used for verification */
	readonly verification_query?: string;

	/** Token that was searched for */
	readonly expected_token?: string;

	/** Whether token was found (for debugging) */
	readonly token_found?: boolean;

	/** Raw retrieval results for debugging */
	readonly retrieve_results?: readonly {
		id: string;
		context: string;
		score: number;
	}[];
}

// =============================================================================
// Utility Types
// =============================================================================

/**
 * Result of token detection in retrieval results
 */
export interface TokenDetectionResult {
	/** Whether the token was found */
	readonly found: boolean;

	/** Which result indices contained the token */
	readonly found_in_indices: readonly number[];

	/** Total number of results checked */
	readonly total_results: number;
}
