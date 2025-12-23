/**
 * Data-Driven Benchmark Loader
 *
 * Creates Benchmark implementations from manifest.json + data files.
 * This enables config-only benchmarks without custom TypeScript code.
 *
 * @module src/loaders/data-driven-benchmark
 * @see specs/006-benchmark-interface/data-driven-benchmark-design.md
 */

import path from "node:path";
import type {
	Benchmark,
	BenchmarkCase,
	CaseResult,
} from "../../types/benchmark";
import type { ScopeContext } from "../../types/core";
import type { BaseProvider } from "../../types/provider";
import type {
	BenchmarkManifest,
	EvaluationConfig,
	IngestionConfig,
} from "../../types/benchmark-manifest";
import {
	validateBenchmarkManifest,
	formatManifestErrors,
} from "../../types/benchmark-manifest";
import {
	createExactMatch,
	createLLMJudge,
	loadTypeInstructions,
} from "../evaluation";
import type { EvaluationProtocol } from "../evaluation/types";
import {
	createSimpleIngestion,
	createSessionBasedIngestion,
	cleanupIngested,
} from "../ingestion";
import type { IngestionStrategy } from "../ingestion/types";
import {
	averagePrecision,
	calculateRetrievalMetrics,
	coverageAtK,
	ndcgAtK,
} from "../metrics";

function parseEvidenceToSessionIds(
	evidence: unknown,
	parser: "direct" | "dialog_refs" = "direct",
): string[] {
	const evidenceItems = Array.isArray(evidence)
		? evidence
		: evidence !== undefined && evidence !== null
			? [evidence]
			: [];

	if (parser === "direct") {
		return evidenceItems
			.filter((e): e is string => typeof e === "string")
			.map((e) => e.trim())
			.filter((e) => e.length > 0);
	}

	const sessionIds = new Set<string>();
	for (const item of evidenceItems) {
		if (typeof item !== "string") continue;

		// Handle both "D1:3" and "D1:3; D2:5" formats
		const parts = item.split(";").map((p) => p.trim());
		for (const part of parts) {
			const match = part.match(/^(D\d+)(?::|$)/i);
			if (match?.[1]) {
				sessionIds.add(match[1].toUpperCase());
			}
		}
	}

	return Array.from(sessionIds);
}

/**
 * Error thrown when manifest loading fails
 */
export class ManifestLoadError extends Error {
	constructor(
		message: string,
		public readonly manifestPath: string,
		public readonly cause?: Error,
	) {
		super(message);
		this.name = "ManifestLoadError";
	}
}

/**
 * Load and parse a benchmark manifest
 *
 * @param manifestPath - Path to manifest.json
 * @returns Parsed and validated manifest
 * @throws ManifestLoadError if loading or validation fails
 */
export async function loadBenchmarkManifest(
	manifestPath: string,
): Promise<BenchmarkManifest> {
	try {
		const file = Bun.file(manifestPath);
		const json = await file.json();
		const result = validateBenchmarkManifest(json);

		if (!result.success) {
			throw new ManifestLoadError(
				`Invalid manifest:\n${formatManifestErrors(result.errors ?? [])}`,
				manifestPath,
			);
		}

		return result.data!;
	} catch (error) {
		if (error instanceof ManifestLoadError) {
			throw error;
		}
		throw new ManifestLoadError(
			`Failed to load manifest: ${error instanceof Error ? error.message : String(error)}`,
			manifestPath,
			error instanceof Error ? error : undefined,
		);
	}
}

/**
 * Load benchmark data from a file
 *
 * @param dataPath - Path to data file (JSON or JSONL)
 * @returns Array of data items
 */
export async function loadBenchmarkData(
	dataPath: string,
): Promise<Record<string, unknown>[]> {
	const file = Bun.file(dataPath);
	const content = await file.text();

	// Check if it's JSONL format
	if (dataPath.endsWith(".jsonl")) {
		return content
			.split("\n")
			.filter((line) => line.trim())
			.map((line) => JSON.parse(line));
	}

	// Assume JSON array
	const parsed = JSON.parse(content);
	return Array.isArray(parsed) ? parsed : [parsed];
}

/**
 * Flatten nested arrays into separate records
 *
 * This allows benchmarks like LoCoMo (which has multiple QA pairs per sample)
 * to be processed as individual cases without transformation scripts.
 *
 * @param data - Array of records to flatten
 * @param config - Flatten configuration
 * @returns Flattened array of records
 */
export function flattenData(
	data: Record<string, unknown>[],
	config: { field: string; max_items?: number; promote_fields?: string[] },
): Record<string, unknown>[] {
	const result: Record<string, unknown>[] = [];

	for (const record of data) {
		const arr = record[config.field];
		if (!Array.isArray(arr)) {
			// If no array to flatten, keep record as-is
			result.push(record);
			continue;
		}

		// Limit items if specified
		const items = config.max_items ? arr.slice(0, config.max_items) : arr;

		for (let i = 0; i < items.length; i++) {
			const item = items[i] as Record<string, unknown>;
			// Create new record without the flattened array field
			const { [config.field]: _, ...parent } = record;

			// Promote specified fields from the item to root level
			const promoted: Record<string, unknown> = {};
			for (const field of config.promote_fields ?? []) {
				if (item[field] !== undefined) {
					promoted[field] = item[field];
				}
			}

			// Generate unique ID
			const parentId = (parent.sample_id as string) ?? (parent.id as string) ?? `rec_${result.length}`;

			result.push({
				id: `${parentId}_q${i}`,
				...parent,
				...promoted,
				_flatten_index: i,
			});
		}
	}

	return result;
}

/**
 * Create an ingestion strategy from config
 */
function createIngestionStrategy(config: IngestionConfig): IngestionStrategy {
	switch (config.strategy) {
		case "simple":
			return createSimpleIngestion({
				contentField: config.content_field,
				isArray: config.is_array,
				metadataFields: config.metadata_fields,
			});

		case "session-based":
			return createSessionBasedIngestion({
				sessionsField: config.sessions_field,
				sessionIdsField: config.session_ids_field,
				datesField: config.dates_field,
				answerSessionIdsField: config.answer_session_ids_field,
				mode: config.mode,
				sharedSampleSize: config.shared_sample_size,
				contentFormatter: config.content_formatter,
				// Dynamic keys format options (for LoCoMo-style data)
				sessionsFormat: config.sessions_format,
				sessionKeyPrefix: config.session_key_prefix,
				dateKeySuffix: config.date_key_suffix,
				evidenceField: config.evidence_field,
				evidenceParser: config.evidence_parser,
				dialogueContentFormatter: config.dialogue_content_formatter,
			});

		case "add-delete-verify":
			// TODO: Implement add-delete-verify strategy
			throw new Error("add-delete-verify strategy not yet implemented");

		default:
			throw new Error(`Unknown ingestion strategy: ${(config as IngestionConfig).strategy}`);
	}
}

/**
 * Create an evaluation protocol from config
 */
async function createEvaluationProtocol(
	config: EvaluationConfig,
	benchmarkDir: string,
): Promise<EvaluationProtocol> {
	switch (config.protocol) {
		case "exact-match":
			return createExactMatch({
				caseSensitive: config.case_sensitive,
				normalizeWhitespace: config.normalize_whitespace,
			});

		case "llm-as-judge": {
			let typeInstructions = config.type_instructions;

			// Load type instructions from file if specified
			if (config.type_instructions_file) {
				const filePath = path.join(benchmarkDir, config.type_instructions_file);
				typeInstructions = await loadTypeInstructions(filePath);
			}

			return createLLMJudge({
				backend: config.judge_backend,
				model: config.model,
				region: config.region,
				projectId: config.project_id,
				typeField: config.type_field,
				typeInstructions,
			});
		}

		case "deletion-check":
			// TODO: Implement deletion check protocol
			throw new Error("deletion-check protocol not yet implemented");

		default:
			throw new Error(`Unknown evaluation protocol: ${(config as EvaluationConfig).protocol}`);
	}
}

/**
 * Create a Benchmark implementation from a manifest
 *
 * @param manifest - The parsed manifest
 * @param manifestPath - Path to the manifest file
 * @returns Benchmark implementation
 */
export async function createDataDrivenBenchmark(
	manifest: BenchmarkManifest,
	manifestPath: string,
): Promise<Benchmark> {
	const benchmarkDir = path.dirname(manifestPath);
	const dataPath = path.join(benchmarkDir, manifest.data_file);

	// Load data
	let data = await loadBenchmarkData(dataPath);

	// Apply flatten transformation if configured
	if (manifest.flatten) {
		data = flattenData(data, {
			field: manifest.flatten.field,
			max_items: manifest.flatten.max_items,
			promote_fields: manifest.flatten.promote_fields,
		});
	}

	// Create ingestion strategy
	const ingestionStrategy = createIngestionStrategy(manifest.ingestion);

	// Create evaluation protocol
	const evaluationProtocol = await createEvaluationProtocol(
		manifest.evaluation,
		benchmarkDir,
	);

	// Create cases from data
	const cases: BenchmarkCase[] = data.map((item, index) => {
		const id = (item.id as string) ?? (item.question_id as string) ?? `case_${index}`;
		const question = item[manifest.query.question_field] as string;

		return {
			id,
			description: question?.slice(0, 100),
			input: item,
			expected: item[manifest.query.expected_answer_field],
			metadata: {
				index,
				...(item.metadata as Record<string, unknown> | undefined),
			},
		};
	});

	return {
		meta: {
			name: manifest.name,
			version: manifest.version,
			description: manifest.description,
			required_capabilities: manifest.required_capabilities,
		},

		*cases(): Generator<BenchmarkCase> {
			for (const benchmarkCase of cases) {
				yield benchmarkCase;
			}
		},

		async run_case(
			provider: BaseProvider,
			scope: ScopeContext,
			benchmarkCase: BenchmarkCase,
		): Promise<CaseResult> {
			const startTime = performance.now();
			let ingestedIds: string[] = [];

			try {
				// Phase 1: Ingest data
				const ingestionResult = await ingestionStrategy.ingest({
					provider,
					scope,
					input: benchmarkCase.input,
				});
				ingestedIds = ingestionResult.ingestedIds;

				// Phase 2: Retrieve relevant memories
				const question = benchmarkCase.input[manifest.query.question_field] as string;
				const retrievalResults = await provider.retrieve_memory(
					scope,
					question,
					manifest.query.retrieval_limit,
				);

						// Phase 3: Synthesize answer from context (only for LLM-based evaluation)
				const retrievedContext = retrievalResults.map((r) => r.record.context);
				let generatedAnswer: string;

				if (manifest.evaluation.protocol === "llm-as-judge") {
					// Use LLM to generate answer from retrieved context
					const { generateAnswerFromContext } = await import("../evaluation/llm-judge");
					const judgeConfig = {
						backend: manifest.evaluation.judge_backend,
						model: manifest.evaluation.model,
						region: manifest.evaluation.region,
						projectId: manifest.evaluation.project_id,
					};

					generatedAnswer = await generateAnswerFromContext(
						question,
						retrievedContext.slice(0, 5), // Use top 5 results
						judgeConfig,
					);
				} else {
					// For exact-match or other protocols, just concatenate retrieved context
					generatedAnswer = retrievedContext.length > 0
						? `Based on retrieved memories:\n\n${retrievedContext.slice(0, 3).join("\n\n---\n\n")}`
						: "I don't have enough information to answer this question.";
				}

				// Phase 4: Evaluate
				const expectedAnswer = String(benchmarkCase.expected ?? "");
				const questionType = manifest.evaluation.protocol === "llm-as-judge" &&
					"type_field" in manifest.evaluation &&
					manifest.evaluation.type_field
					? (benchmarkCase.input[manifest.evaluation.type_field] as string | undefined)
					: undefined;

				const evalResult = await evaluationProtocol.evaluate({
					question,
					expectedAnswer,
					generatedAnswer,
					retrievedContext,
					questionType,
					retrievalResults,
				});

				// Phase 5: Calculate retrieval metrics
				// Use configured field name from manifest instead of hard-coded key
				let relevantIds: string[] | undefined;
				if (manifest.ingestion.strategy === "session-based") {
					// LongMemEval-style: explicit answer session IDs field
					if (manifest.ingestion.answer_session_ids_field) {
						const ids = benchmarkCase.input[
							manifest.ingestion.answer_session_ids_field
						] as unknown;
						if (Array.isArray(ids)) {
							relevantIds = ids.map((id) => String(id));
						}
					}

					// LoCoMo-style: evidence references that imply relevant sessions
					if (!relevantIds && manifest.ingestion.evidence_field) {
						const evidence = benchmarkCase.input[manifest.ingestion.evidence_field];
						const parser = manifest.ingestion.evidence_parser ?? "direct";
						const parsed = parseEvidenceToSessionIds(evidence, parser);
						if (parsed.length > 0) {
							relevantIds = parsed;
						}
					}
				}
				if (relevantIds && relevantIds.length > 0) {
					// Deduplicate while preserving order
					relevantIds = Array.from(new Set(relevantIds));
				} else {
					relevantIds = undefined;
				}

				const retrievalMetrics = relevantIds
					? calculateRetrievalMetrics({
							retrievalResults,
							relevantIds,
						})
					: null;
				const retrievalK = Math.min(
					manifest.query.retrieval_limit ?? retrievalResults.length,
					retrievalResults.length,
				);

				// Build scores
				const scores: Record<string, number> = {
					correctness: evalResult.correctness,
					faithfulness: evalResult.faithfulness,
				};

				if (evalResult.typeSpecificScore !== undefined) {
					scores.type_specific = evalResult.typeSpecificScore;
				}

				if (retrievalMetrics) {
					scores.retrieval_precision = retrievalMetrics.precision;
					scores.retrieval_recall = retrievalMetrics.recall;
					scores.retrieval_f1 = retrievalMetrics.f1;

					// Additional rank/coverage metrics at K (where K = retrieval_limit)
					scores.retrieval_coverage = coverageAtK(
						retrievalResults,
						relevantIds!,
						retrievalK,
					);
					scores.retrieval_ndcg = ndcgAtK(
						retrievalResults,
						relevantIds!,
						retrievalK,
					);
					scores.retrieval_map = averagePrecision(
						retrievalResults.slice(0, retrievalK),
						relevantIds!,
					);
				}

				if (evalResult.additionalMetrics) {
					for (const [key, value] of Object.entries(evalResult.additionalMetrics)) {
						scores[key] = value;
					}
				}

				// Determine status
				const judgeErrored = evalResult.additionalMetrics?.judge_error === 1;
				const status = judgeErrored
					? "error"
					: evalResult.correctness >= 0.7 && evalResult.faithfulness >= 0.5
						? "pass"
						: "fail";

				const duration = performance.now() - startTime;

				return {
					case_id: benchmarkCase.id,
					status,
					scores,
					duration_ms: duration,
					artifacts: {
						generatedAnswer,
						reasoning: evalResult.reasoning,
						ingestedCount: ingestionResult.ingestedCount,
						retrievedCount: retrievalResults.length,
					},
				};
			} catch (error) {
				const duration = performance.now() - startTime;

				return {
					case_id: benchmarkCase.id,
					status: "error",
					scores: {},
					duration_ms: duration,
					error: {
						message: error instanceof Error ? error.message : String(error),
						stack: error instanceof Error ? error.stack : undefined,
					},
				};
			} finally {
				// Cleanup ingested data
				if (ingestedIds.length > 0) {
					await cleanupIngested(provider, scope, ingestedIds).catch(() => {
						// Ignore cleanup errors
					});
				}
			}
		},
	};
}

/**
 * Check if a directory contains a benchmark manifest
 *
 * @param dir - Directory to check
 * @returns True if manifest.json exists
 */
export async function hasManifest(dir: string): Promise<boolean> {
	const manifestPath = path.join(dir, "manifest.json");
	const file = Bun.file(manifestPath);
	return file.exists();
}
