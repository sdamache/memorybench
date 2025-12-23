/**
 * Benchmark Manifest Types and Schema
 *
 * Defines the schema for data-driven benchmarks where benchmarks
 * are configured via manifest.json + data files instead of custom code.
 *
 * @module types/benchmark-manifest
 * @see specs/006-benchmark-interface/data-driven-benchmark-design.md
 */

import { z } from "zod";

// =============================================================================
// Ingestion Configuration Schemas
// =============================================================================

/**
 * Simple ingestion configuration schema
 */
export const SimpleIngestionSchema = z.object({
	strategy: z.literal("simple"),
	/** Field in case input containing content to ingest */
	content_field: z.string(),
	/** Whether content field is an array of items */
	is_array: z.boolean().optional().default(false),
	/** Fields to include as metadata */
	metadata_fields: z.array(z.string()).optional(),
});

/**
 * Session-based ingestion configuration schema
 *
 * Supports two session formats:
 * - "array": Sessions are in an array field (LongMemEval style)
 * - "dynamic_keys": Sessions are in dynamic keys like session_1, session_2 (LoCoMo style)
 */
export const SessionBasedIngestionSchema = z.object({
	strategy: z.literal("session-based"),
	/** Field containing array of sessions (for array format) or object with session keys (for dynamic_keys) */
	sessions_field: z.string(),
	/** Field containing session IDs */
	session_ids_field: z.string().optional(),
	/** Field containing session dates */
	dates_field: z.string().optional(),
	/** Field containing answer session IDs for selective ingestion */
	answer_session_ids_field: z.string().optional(),
	/** Ingestion mode: lazy (dev), shared (demo), full (production) */
	mode: z.enum(["lazy", "shared", "full"]).optional().default("full"),
	/** Sample size for shared mode */
	shared_sample_size: z.number().optional().default(10),
	/** Content formatter */
	content_formatter: z.enum(["conversation", "raw"]).optional().default("conversation"),

	// === Dynamic keys format options (for LoCoMo-style data) ===
	/** Session format: "array" for arrays, "dynamic_keys" for session_1, session_2, etc. */
	sessions_format: z.enum(["array", "dynamic_keys"]).optional().default("array"),
	/** Prefix for dynamic session keys (e.g., "session_" matches session_1, session_2) */
	session_key_prefix: z.string().optional().default("session_"),
	/** Suffix to append to session key to find date (e.g., "_date_time" finds session_1_date_time) */
	date_key_suffix: z.string().optional().default("_date_time"),
	/** Field containing evidence references (alternative to answer_session_ids_field) */
	evidence_field: z.string().optional(),
	/** How to parse evidence to session IDs: "direct" or "dialog_refs" (parses "D1:3" -> "D1") */
	evidence_parser: z.enum(["direct", "dialog_refs"]).optional().default("direct"),
	/** Content formatter for dynamic keys format */
	dialogue_content_formatter: z.enum(["speaker_text", "role_content"]).optional().default("speaker_text"),
});

/**
 * Add-delete-verify ingestion configuration schema
 */
export const AddDeleteVerifyIngestionSchema = z.object({
	strategy: z.literal("add-delete-verify"),
	/** Field containing content to add */
	add_content_field: z.string(),
	/** Field containing IDs to delete */
	delete_target_field: z.string(),
	/** Field containing verification queries */
	verify_query_field: z.string().optional(),
	/** Delay between phases in ms */
	phase_delay_ms: z.number().optional().default(100),
});

/**
 * Combined ingestion configuration schema
 */
export const IngestionConfigSchema = z.discriminatedUnion("strategy", [
	SimpleIngestionSchema,
	SessionBasedIngestionSchema,
	AddDeleteVerifyIngestionSchema,
]);

// =============================================================================
// Evaluation Configuration Schemas
// =============================================================================

/**
 * Exact match evaluation configuration schema
 */
export const ExactMatchEvaluationSchema = z.object({
	protocol: z.literal("exact-match"),
	/** Case sensitive comparison */
	case_sensitive: z.boolean().optional().default(false),
	/** Normalize whitespace */
	normalize_whitespace: z.boolean().optional().default(true),
});

/**
 * LLM-as-judge evaluation configuration schema
 */
export const LLMJudgeEvaluationSchema = z.object({
	protocol: z.literal("llm-as-judge"),
	/** Which backend to use for the judge */
	judge_backend: z
		.enum(["anthropic-vertex", "google-vertex", "openai", "azure-openai", "anthropic", "google"])
		.optional(),
	/** Google Cloud project ID (for Vertex-backed judges) */
	project_id: z.string().optional(),
	/** Google Cloud region/location (for Vertex-backed judges) */
	region: z.string().optional(),
	/** Model to use for evaluation */
	model: z.string().optional(),
	/** Field containing question type */
	type_field: z.string().optional(),
	/** Inline type instructions */
	type_instructions: z.record(z.string(), z.string()).optional(),
	/** Path to type instructions JSON file */
	type_instructions_file: z.string().optional(),
});

/**
 * Deletion check evaluation configuration schema
 */
export const DeletionCheckEvaluationSchema = z.object({
	protocol: z.literal("deletion-check"),
	/** Field containing verification queries */
	verification_query_field: z.string(),
	/** Field containing deleted content */
	deleted_content_field: z.string(),
	/** Use fuzzy matching */
	fuzzy_match: z.boolean().optional().default(false),
});

/**
 * Combined evaluation configuration schema
 */
export const EvaluationConfigSchema = z.discriminatedUnion("protocol", [
	ExactMatchEvaluationSchema,
	LLMJudgeEvaluationSchema,
	DeletionCheckEvaluationSchema,
]);

// =============================================================================
// Query Configuration Schema
// =============================================================================

/**
 * Query configuration schema
 */
export const QueryConfigSchema = z.object({
	/** Field containing the question/query */
	question_field: z.string(),
	/** Field containing the expected answer */
	expected_answer_field: z.string(),
	/** Number of memories to retrieve */
	retrieval_limit: z.number().optional().default(10),
});

// =============================================================================
// Data Transformation Schema
// =============================================================================

/**
 * Flatten configuration for expanding nested arrays into separate records
 *
 * This allows benchmarks like LoCoMo (which has multiple QA pairs per sample)
 * to be processed as individual cases without transformation scripts.
 */
export const FlattenConfigSchema = z.object({
	/** Field containing array to flatten (e.g., "qa" for LoCoMo) */
	field: z.string(),
	/** Maximum items to take from the array (for limiting benchmark size) */
	max_items: z.number().optional(),
	/** Fields from flattened items to promote to root level */
	promote_fields: z.array(z.string()).optional(),
});

// =============================================================================
// Main Benchmark Manifest Schema
// =============================================================================

/**
 * Benchmark manifest schema
 */
export const BenchmarkManifestSchema = z.object({
	/** Manifest version (for future compatibility) */
	manifest_version: z.literal("1"),

	/** Benchmark name (unique identifier) */
	name: z.string().min(1),

	/** Semantic version */
	version: z.string().regex(/^\d+\.\d+\.\d+$/),

	/** Human-readable description */
	description: z.string().optional(),

	/** Source reference (paper, repo, etc.) */
	source: z.string().optional(),

	/** Path to data file (relative to manifest) */
	data_file: z.string(),

	/** Flatten nested arrays into separate records (optional) */
	flatten: FlattenConfigSchema.optional(),

	/** Ingestion configuration */
	ingestion: IngestionConfigSchema,

	/** Query configuration */
	query: QueryConfigSchema,

	/** Evaluation configuration */
	evaluation: EvaluationConfigSchema,

	/** Metrics to calculate */
	metrics: z.array(z.string()),

	/** Required provider capabilities */
	required_capabilities: z.array(z.string()),
});

// =============================================================================
// TypeScript Types (derived from schemas)
// =============================================================================

export type SimpleIngestionConfig = z.infer<typeof SimpleIngestionSchema>;
export type SessionBasedIngestionConfig = z.infer<typeof SessionBasedIngestionSchema>;
export type AddDeleteVerifyIngestionConfig = z.infer<typeof AddDeleteVerifyIngestionSchema>;
export type IngestionConfig = z.infer<typeof IngestionConfigSchema>;

export type ExactMatchEvaluationConfig = z.infer<typeof ExactMatchEvaluationSchema>;
export type LLMJudgeEvaluationConfig = z.infer<typeof LLMJudgeEvaluationSchema>;
export type DeletionCheckEvaluationConfig = z.infer<typeof DeletionCheckEvaluationSchema>;
export type EvaluationConfig = z.infer<typeof EvaluationConfigSchema>;

export type QueryConfig = z.infer<typeof QueryConfigSchema>;
export type BenchmarkManifest = z.infer<typeof BenchmarkManifestSchema>;

// =============================================================================
// Validation Functions
// =============================================================================

/**
 * Validation result for benchmark manifest
 */
export interface ManifestValidationResult {
	success: boolean;
	data?: BenchmarkManifest;
	errors?: Array<{
		path: string;
		message: string;
	}>;
}

/**
 * Validate a benchmark manifest
 *
 * @param json - The parsed JSON to validate
 * @returns Validation result with typed data or errors
 */
export function validateBenchmarkManifest(
	json: unknown,
): ManifestValidationResult {
	const result = BenchmarkManifestSchema.safeParse(json);

	if (result.success) {
		return { success: true, data: result.data };
	}

	return {
		success: false,
		errors: result.error.issues.map((err) => ({
			path: err.path.join("."),
			message: err.message,
		})),
	};
}

/**
 * Format validation errors for display
 *
 * @param errors - Array of validation errors
 * @returns Formatted error message
 */
export function formatManifestErrors(
	errors: Array<{ path: string; message: string }>,
): string {
	return errors
		.map((err) => `  - ${err.path}: ${err.message}`)
		.join("\n");
}

// =============================================================================
// Supported Manifest Versions
// =============================================================================

/**
 * List of supported manifest versions
 */
export const SUPPORTED_BENCHMARK_MANIFEST_VERSIONS = ["1"] as const;
