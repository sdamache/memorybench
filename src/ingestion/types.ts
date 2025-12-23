/**
 * Shared Types for Ingestion Strategies
 *
 * This module defines the interfaces for ingestion strategies used by
 * data-driven benchmarks. Each strategy implements a specific ingestion
 * pattern (simple, session-based, add-delete-verify, etc.).
 *
 * @module src/ingestion/types
 * @see specs/006-benchmark-interface/data-driven-benchmark-design.md
 */

import type { ScopeContext } from "../../types/core";
import type { BaseProvider } from "../../types/provider";

/**
 * Result from an ingestion operation
 */
export interface IngestionResult {
	/** IDs of successfully ingested memory records */
	ingestedIds: string[];
	/** Number of items successfully ingested */
	ingestedCount: number;
	/** Number of items skipped */
	skippedCount: number;
	/** Total items that could have been ingested */
	totalCount: number;
	/** Any errors that occurred during ingestion */
	errors?: string[];
}

/**
 * Configuration for simple ingestion (add all at once)
 */
export interface SimpleIngestionConfig {
	/** Field in case input containing content to ingest */
	contentField: string;
	/** Fields to include as metadata (optional) */
	metadataFields?: string[];
	/** Whether content field is an array of items */
	isArray?: boolean;
}

/**
 * Ingestion mode for session-based strategies
 */
export type IngestionMode = "lazy" | "shared" | "full";

/**
 * Configuration for session-based ingestion
 *
 * Supports two session formats:
 * - "array": Sessions are in an array field (LongMemEval style)
 * - "dynamic_keys": Sessions are in dynamic keys like session_1, session_2 (LoCoMo style)
 */
export interface SessionBasedConfig {
	/** Field containing array of sessions (for array format) or object with session keys (for dynamic_keys) */
	sessionsField: string;
	/** Field containing session IDs (optional, for array format) */
	sessionIdsField?: string;
	/** Field containing session dates (optional, for array format) */
	datesField?: string;
	/** Field containing answer session IDs for selective ingestion */
	answerSessionIdsField?: string;
	/** Ingestion mode: lazy (dev), shared (demo), full (production) */
	mode?: IngestionMode;
	/** Sample size for shared mode (default: 10) */
	sharedSampleSize?: number;
	/** Content formatter: "conversation" or "raw" */
	contentFormatter?: "conversation" | "raw";

	// === Dynamic keys format options (for LoCoMo-style data) ===
	/** Session format: "array" for arrays, "dynamic_keys" for session_1, session_2, etc. */
	sessionsFormat?: "array" | "dynamic_keys";
	/** Prefix for dynamic session keys (e.g., "session_" matches session_1, session_2) */
	sessionKeyPrefix?: string;
	/** Suffix to append to session key to find date (e.g., "_date_time" finds session_1_date_time) */
	dateKeySuffix?: string;
	/** Field containing evidence references (alternative to answer_session_ids_field) */
	evidenceField?: string;
	/** How to parse evidence to session IDs: "direct" or "dialog_refs" (parses "D1:3" -> "D1") */
	evidenceParser?: "direct" | "dialog_refs";
	/** Content formatter for dynamic keys format: "speaker_text" or "role_content" */
	dialogueContentFormatter?: "speaker_text" | "role_content";
}

/**
 * Configuration for add-delete-verify ingestion (RWKU-style)
 */
export interface AddDeleteVerifyConfig {
	/** Field containing content to add */
	addContentField: string;
	/** Field containing IDs of content to delete */
	deleteTargetField: string;
	/** Field containing queries for verification */
	verifyQueryField?: string;
	/** Delay between add and delete phases (ms) */
	phaseDelayMs?: number;
}

/**
 * Ingestion context provided to strategies
 */
export interface IngestionContext {
	/** The provider to ingest into */
	provider: BaseProvider;
	/** Scope for isolation */
	scope: ScopeContext;
	/** Input data from the benchmark case */
	input: Record<string, unknown>;
	/** Additional metadata to attach to ingested records */
	metadata?: Record<string, unknown>;
}

/**
 * Ingestion strategy interface
 *
 * All ingestion strategies must implement this interface.
 * Strategies are created via factory functions that accept configuration.
 */
export interface IngestionStrategy {
	/** Strategy name for logging and identification */
	readonly name: string;

	/**
	 * Ingest data into the provider's memory
	 *
	 * @param context - All information needed for ingestion
	 * @returns Ingestion result with IDs and counts
	 */
	ingest(context: IngestionContext): Promise<IngestionResult>;
}

/**
 * Factory function type for creating ingestion strategies
 */
export type IngestionStrategyFactory<TConfig> = (
	config: TConfig,
) => IngestionStrategy;

/**
 * Message in a conversation session
 */
export interface Message {
	role: "user" | "assistant" | "system";
	content: string;
}

/**
 * Format a conversation session into a string
 */
export function formatConversation(
	messages: Message[],
	sessionId?: string,
	sessionDate?: string,
): string {
	const formattedMessages = messages
		.map((msg) => `[${msg.role.toUpperCase()}]: ${msg.content}`)
		.join("\n\n");

	const header = sessionId ? `=== Session: ${sessionId} ===` : "";
	const dateStr = sessionDate ? `Date: ${sessionDate}` : "";

	return [header, dateStr, "", formattedMessages].filter(Boolean).join("\n");
}
