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
import { calculateRetrievalMetrics } from "../metrics";

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
				model: config.model,
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
	const data = await loadBenchmarkData(dataPath);

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

				// Phase 3: Synthesize answer from context
				const retrievedContext = retrievalResults.map((r) => r.record.context);
				const generatedAnswer =
					retrievedContext.length > 0
						? `Based on retrieved memories:\n\n${retrievedContext.slice(0, 3).join("\n\n---\n\n")}`
						: "I don't have enough information to answer this question.";

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
				if (
					manifest.ingestion.strategy === "session-based" &&
					manifest.ingestion.answer_session_ids_field
				) {
					relevantIds = benchmarkCase.input[
						manifest.ingestion.answer_session_ids_field
					] as string[] | undefined;
				}
				const retrievalMetrics = relevantIds
					? calculateRetrievalMetrics({
							retrievalResults,
							relevantIds,
						})
					: null;

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
				}

				if (evalResult.additionalMetrics) {
					for (const [key, value] of Object.entries(evalResult.additionalMetrics)) {
						scores[key] = value;
					}
				}

				// Determine status
				const status =
					evalResult.correctness >= 0.7 && evalResult.faithfulness >= 0.5
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
