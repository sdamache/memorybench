/**
 * LLM-as-Judge Evaluation Protocol
 *
 * Supports multiple judge backends (Vertex Claude, Vertex Gemini, etc.) to
 * evaluate memory system answers with optional type-aware instructions for
 * different question categories.
 *
 * Extracted from: benchmarks/LongMemEval/judge.ts
 *
 * @module src/evaluation/llm-judge
 * @see specs/006-benchmark-interface/data-driven-benchmark-design.md
 */

import AnthropicVertex from "@anthropic-ai/vertex-sdk";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createVertex } from "@ai-sdk/google-vertex";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import type {
	EvaluationContext,
	EvaluationProtocol,
	EvaluationResult,
	LLMJudgeConfig,
} from "./types";

/**
 * Default model for Anthropic Vertex (Claude) evaluation.
 *
 * Vertex model IDs differ from Anthropic's public API IDs; in particular, the
 * trailing date suffix often needs to be removed (e.g. `...-20250514`).
 */
const DEFAULT_ANTHROPIC_VERTEX_MODEL = "claude-sonnet-4";

/**
 * Default model for Google Vertex (Gemini) evaluation.
 */
const DEFAULT_GOOGLE_VERTEX_MODEL = "gemini-2.5-flash";

/**
 * Default region for Vertex AI
 */
const DEFAULT_ANTHROPIC_VERTEX_REGION = "us-east5";
const DEFAULT_GOOGLE_VERTEX_LOCATION = "us-central1";

/**
 * Lazily initialized clients/providers (keyed by config)
 */
const anthropicVertexClients = new Map<string, AnthropicVertex>();
const googleVertexProviders = new Map<string, ReturnType<typeof createVertex>>();

/**
 * Normalize Anthropic model IDs for Vertex AI.
 * Example: `claude-sonnet-4-20250514` -> `claude-sonnet-4`
 */
function normalizeAnthropicVertexModelId(modelId: string): string {
	// Vertex uses simplified IDs (no trailing -YYYYMMDD). Don't touch the @-style IDs.
	if (modelId.includes("@")) return modelId;
	return modelId.replace(/-\d{8}$/, "");
}

function resolveBackend(config: LLMJudgeConfig): NonNullable<LLMJudgeConfig["backend"]> {
	const env = process.env.MEMORYBENCH_JUDGE_BACKEND ?? process.env.LLM_JUDGE_BACKEND;
	const backend = env ?? config.backend ?? "anthropic-vertex";

	// Runtime validation: ensure backend is valid
	const validBackends = ["anthropic-vertex", "google-vertex", "openai", "azure-openai", "anthropic", "google"] as const;
	if (!validBackends.includes(backend as any)) {
		throw new Error(
			`Invalid judge backend: "${backend}". Valid options: ${validBackends.join(", ")}`
		);
	}

	return backend as NonNullable<LLMJudgeConfig["backend"]>;
}

function resolveModel(config: LLMJudgeConfig, backend: NonNullable<LLMJudgeConfig["backend"]>): string {
	const env = process.env.MEMORYBENCH_JUDGE_MODEL ?? process.env.LLM_JUDGE_MODEL;
	if (env) return env;
	if (config.model) return config.model;
	switch (backend) {
		case "google-vertex":
			return DEFAULT_GOOGLE_VERTEX_MODEL;
		case "anthropic-vertex":
			return DEFAULT_ANTHROPIC_VERTEX_MODEL;
		case "openai":
			return "gpt-4o";
		case "azure-openai":
			// Azure OpenAI uses deployment names, not model names
			// User must specify via config.model or MEMORYBENCH_JUDGE_MODEL
			throw new Error(
				"azure-openai backend requires explicit deployment name via config.model or MEMORYBENCH_JUDGE_MODEL env var"
			);
		case "anthropic":
			return "claude-sonnet-4-20250514";
		case "google":
			return "gemini-1.5-flash";
		default:
			// Exhaustive check - should never reach here due to resolveBackend validation
			throw new Error(`Unhandled backend in resolveModel: ${backend satisfies never}`);
	}
}

function resolveProjectId(config: LLMJudgeConfig): string | undefined {
	return (
		config.projectId ??
		process.env.MEMORYBENCH_JUDGE_PROJECT_ID ??
		process.env.GOOGLE_VERTEX_PROJECT_ID ??
		process.env.GOOGLE_CLOUD_PROJECT ??
		process.env.GCLOUD_PROJECT ??
		process.env.GOOGLE_VERTEX_PROJECT
	);
}

function resolveRegion(config: LLMJudgeConfig, fallback: string): string {
	return (
		config.region ??
		process.env.MEMORYBENCH_JUDGE_REGION ??
		process.env.GOOGLE_VERTEX_LOCATION ??
		process.env.CLOUD_ML_REGION ??
		fallback
	);
}

function getAnthropicVertexClient(config: LLMJudgeConfig): AnthropicVertex {
	const region = resolveRegion(config, DEFAULT_ANTHROPIC_VERTEX_REGION);
	const projectId = resolveProjectId(config);
	if (!projectId) {
		throw new Error(
			"Missing Google Cloud project for judge. Set evaluation.project_id in the benchmark manifest, or set GOOGLE_CLOUD_PROJECT / GOOGLE_VERTEX_PROJECT_ID.",
		);
	}

	const key = `${projectId}:${region}`;
	const existing = anthropicVertexClients.get(key);
	if (existing) return existing;

	const created = new AnthropicVertex({ region, projectId });
	anthropicVertexClients.set(key, created);
	return created;
}

function getGoogleVertexProvider(config: LLMJudgeConfig): ReturnType<typeof createVertex> {
	const location = resolveRegion(config, DEFAULT_GOOGLE_VERTEX_LOCATION);
	const project = resolveProjectId(config);
	if (!project) {
		throw new Error(
			"Missing Google Cloud project for judge. Set evaluation.project_id in the benchmark manifest, or set GOOGLE_CLOUD_PROJECT / GOOGLE_VERTEX_PROJECT_ID.",
		);
	}

	const key = `${project}:${location}`;
	const existing = googleVertexProviders.get(key);
	if (existing) return existing;

	const created = createVertex({ project, location });
	googleVertexProviders.set(key, created);
	return created;
}

/**
 * Parse the judge's JSON response
 */
function parseJudgeResponse(content: string): EvaluationResult {
	try {
		// Extract JSON from the response (handle markdown code blocks)
		let jsonStr = content;
		const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
		if (jsonMatch?.[1]) {
			jsonStr = jsonMatch[1].trim();
		}

		const parsed = JSON.parse(jsonStr);

		return {
			correctness: Math.max(0, Math.min(1, Number(parsed.correctness) || 0)),
			faithfulness: Math.max(0, Math.min(1, Number(parsed.faithfulness) || 0)),
			reasoning: String(parsed.reasoning || "No reasoning provided"),
			typeSpecificScore:
				parsed.typeSpecificScore !== undefined && parsed.typeSpecificScore !== null
					? Math.max(0, Math.min(1, Number(parsed.typeSpecificScore)))
					: undefined,
		};
	} catch {
		// If parsing fails, return conservative scores
		return {
			correctness: 0,
			faithfulness: 0,
			reasoning: `Failed to parse judge response: ${content.slice(0, 200)}`,
			additionalMetrics: { judge_error: 1 },
		};
	}
}

/**
 * Build the evaluation prompt
 */
function buildPrompt(
	context: EvaluationContext,
	typeInstructions?: string,
): string {
	const typeSection = context.questionType
		? `QUESTION TYPE: ${context.questionType}\n\n${typeInstructions ?? ""}\n\n`
		: "";

	return `You are an expert evaluator for memory system benchmarks. Your task is to evaluate whether a memory system correctly answered a question based on retrieved context.

${typeSection}EVALUATION CRITERIA:
1. **Correctness (0-1)**: Does the generated answer match the expected answer semantically?
   - 1.0: Perfect or near-perfect match
   - 0.7-0.9: Mostly correct with minor differences
   - 0.4-0.6: Partially correct
   - 0.1-0.3: Contains some relevant information but mostly wrong
   - 0.0: Completely wrong or irrelevant

2. **Faithfulness (0-1)**: Is the answer grounded in the retrieved context AND provides useful information?
   - 1.0: Fully supported by retrieved evidence and answers the question
   - 0.5: Partially supported or only answers part of the question
   - 0.0: Not supported, hallucinated, OR simply says "I don't know/not enough information"

   IMPORTANT: Responses like "I don't have enough information" or "I cannot answer" should receive 0.0 faithfulness because they fail to provide useful information from the memory system, even if they avoid hallucination.

3. **Type-Specific Score (0-1)**: Based on the question type instructions above (if applicable).

---

QUESTION: ${context.question}

EXPECTED ANSWER: ${context.expectedAnswer}

GENERATED ANSWER: ${context.generatedAnswer}

RETRIEVED CONTEXT:
${context.retrievedContext.length > 0 ? context.retrievedContext.join("\n\n---\n\n") : "(No context retrieved)"}

---

Evaluate the answer and respond with a JSON object:
{
  "correctness": <number 0-1>,
  "faithfulness": <number 0-1>,
  "reasoning": "<your explanation>",
  "typeSpecificScore": <number 0-1 or null if not applicable>
}

Return ONLY valid JSON (no markdown, no code fences).`;
}

/**
 * Create an LLM-as-Judge evaluation protocol
 *
 * @param config - Configuration for the LLM judge
 * @returns Evaluation protocol implementation
 *
 * @example
 * ```typescript
 * const judge = createLLMJudge({
 *   typeField: "question_type",
 *   typeInstructions: {
 *     "temporal-reasoning": "Check if dates/times are correctly identified...",
 *     "multi-session": "Verify cross-session aggregation..."
 *   }
 * });
 *
 * const result = await judge.evaluate({
 *   question: "What did I mention about my trip?",
 *   expectedAnswer: "Paris in June",
 *   generatedAnswer: "You mentioned a trip to Paris in June",
 *   retrievedContext: ["User: I'm planning to go to Paris in June"],
 *   questionType: "temporal-reasoning"
 * });
 * ```
 */
export function createLLMJudge(config: LLMJudgeConfig = {}): EvaluationProtocol {
	return {
		name: "llm-as-judge",

		async evaluate(context: EvaluationContext): Promise<EvaluationResult> {
			try {
				// Get type-specific instructions if available
				let typeInstructions: string | undefined;
				if (context.questionType && config.typeInstructions) {
					typeInstructions = config.typeInstructions[context.questionType];
				}

				const prompt = buildPrompt(context, typeInstructions);
				const backend = resolveBackend(config);
				const model = resolveModel(config, backend);
				switch (backend) {
					case "anthropic-vertex": {
						const anthropic = getAnthropicVertexClient(config);
						const vertexModel = normalizeAnthropicVertexModelId(model);

						const response = await anthropic.messages.create({
							model: vertexModel,
							max_tokens: 8192,
							messages: [{ role: "user", content: prompt }],
						});

						const textContent = response.content.find((block) => block.type === "text");
						if (!textContent || textContent.type !== "text") {
							return {
								correctness: 0,
								faithfulness: 0,
								reasoning: "No text response from judge",
								additionalMetrics: { judge_error: 1 },
							};
						}

						return parseJudgeResponse(textContent.text);
					}

					case "google-vertex": {
						const vertex = getGoogleVertexProvider(config);
						const { text } = await generateText({
							model: vertex(model),
							prompt,
							maxOutputTokens: 8192,
						});

						if (!text) {
							return {
								correctness: 0,
								faithfulness: 0,
								reasoning: "No text response from judge",
								additionalMetrics: { judge_error: 1 },
							};
						}

						return parseJudgeResponse(text);
					}

					case "openai": {
						const apiKey = process.env.OPENAI_API_KEY;
						if (!apiKey) {
							throw new Error("OPENAI_API_KEY is required for judge backend 'openai'");
						}

						const openai = createOpenAI({ apiKey });
						const { text } = await generateText({
							model: openai(model),
							prompt,
							maxOutputTokens: 8192,
						});

						if (!text) {
							return {
								correctness: 0,
								faithfulness: 0,
								reasoning: "No text response from judge",
								additionalMetrics: { judge_error: 1 },
							};
						}

						return parseJudgeResponse(text);
					}

					case "azure-openai": {
						const apiKey = process.env.AZURE_OPENAI_API_KEY;
						const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
						const apiVersion = process.env.AZURE_OPENAI_API_VERSION ?? "2024-10-21";
						if (!apiKey || !endpoint) {
							throw new Error(
								"AZURE_OPENAI_API_KEY and AZURE_OPENAI_ENDPOINT are required for judge backend 'azure-openai'"
							);
						}

						// Azure OpenAI uses deployment names, not model IDs
						const deploymentName = model;
						const azureOpenAI = createOpenAI({
							apiKey,
							baseURL: `${endpoint}/openai/deployments/${deploymentName}`,
							headers: { "api-key": apiKey },
							fetch: (url, init) => {
								// Append api-version query param to all requests
								const urlObj = new URL(url);
								urlObj.searchParams.set("api-version", apiVersion);
								return fetch(urlObj.toString(), init);
							},
						});

						const { text } = await generateText({
							model: azureOpenAI(deploymentName),
							prompt,
							maxOutputTokens: 8192,
						});

						if (!text) {
							return {
								correctness: 0,
								faithfulness: 0,
								reasoning: "No text response from judge",
								additionalMetrics: { judge_error: 1 },
							};
						}

						return parseJudgeResponse(text);
					}

					case "anthropic": {
						const apiKey = process.env.ANTHROPIC_API_KEY;
						if (!apiKey) {
							throw new Error(
								"ANTHROPIC_API_KEY is required for judge backend 'anthropic'",
							);
						}

						const anthropic = createAnthropic({ apiKey });
						const { text } = await generateText({
							model: anthropic(model),
							prompt,
							maxOutputTokens: 8192,
						});

						if (!text) {
							return {
								correctness: 0,
								faithfulness: 0,
								reasoning: "No text response from judge",
								additionalMetrics: { judge_error: 1 },
							};
						}

						return parseJudgeResponse(text);
					}

					case "google": {
						const apiKey = process.env.GOOGLE_API_KEY;
						if (!apiKey) {
							throw new Error("GOOGLE_API_KEY is required for judge backend 'google'");
						}

						const google = createGoogleGenerativeAI({ apiKey });
						const { text } = await generateText({
							model: google(model),
							prompt,
							maxOutputTokens: 8192,
						});

						if (!text) {
							return {
								correctness: 0,
								faithfulness: 0,
								reasoning: "No text response from judge",
								additionalMetrics: { judge_error: 1 },
							};
						}

						return parseJudgeResponse(text);
					}

					default:
						// Exhaustive check - should never reach here due to resolveBackend validation
						throw new Error(`Unhandled backend in evaluate: ${backend satisfies never}`);
				}
			} catch (error) {
				return {
					correctness: 0,
					faithfulness: 0,
					reasoning: `Judge error: ${error instanceof Error ? error.message : String(error)}`,
					additionalMetrics: { judge_error: 1 },
				};
			}
		},
	};
}

/**
 * Batch evaluate multiple answers (for efficiency)
 * Uses sequential calls to avoid rate limiting
 *
 * @param protocol - The evaluation protocol to use
 * @param contexts - Array of evaluation contexts
 * @returns Array of evaluation results
 */
export async function evaluateBatch(
	protocol: EvaluationProtocol,
	contexts: EvaluationContext[],
): Promise<EvaluationResult[]> {
	const results: EvaluationResult[] = [];

	for (const context of contexts) {
		const result = await protocol.evaluate(context);
		results.push(result);
	}

	return results;
}

/**
 * Load type instructions from a JSON file
 *
 * @param filePath - Path to the JSON file
 * @returns Record of type to instruction string
 */
export async function loadTypeInstructions(
	filePath: string,
): Promise<Record<string, string>> {
	try {
		const file = Bun.file(filePath);
		const content = await file.json();
		return content as Record<string, string>;
	} catch (error) {
		console.warn(
			`Failed to load type instructions from ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
		);
		return {};
	}
}

/**
 * Generate an answer from retrieved context using an LLM
 * This is the "answering machine" that synthesizes context into answers
 */
export async function generateAnswerFromContext(
	question: string,
	retrievedContext: string[],
	config: LLMJudgeConfig = {},
): Promise<string> {
	if (retrievedContext.length === 0) {
		return "I don't have enough information to answer this question.";
	}

	// Answer generation can use separate backend from judge
	const answerBackendEnv = process.env.MEMORYBENCH_ANSWER_BACKEND;
	const answerModelEnv = process.env.MEMORYBENCH_ANSWER_MODEL;

	// Create config with answer-specific overrides
	const answerConfig: LLMJudgeConfig = {
		...config,
		backend: answerBackendEnv ? (answerBackendEnv as LLMJudgeConfig["backend"]) : config.backend,
		model: answerModelEnv || config.model,
	};

	const backend = resolveBackend(answerConfig);
	const model = resolveModel(answerConfig, backend);

	const prompt = `You are a helpful assistant with access to a memory system. Based on the retrieved memories below, answer the user's question concisely and accurately.

RETRIEVED MEMORIES:
${retrievedContext.join("\n\n---\n\n")}

USER QUESTION: ${question}

Instructions:
- Answer based ONLY on the information in the retrieved memories
- Be concise and direct
- If the memories don't contain the answer, say "I don't have enough information to answer this question."
- Extract the specific fact or information requested

ANSWER:`;

	try {
		switch (backend) {
			case "google-vertex": {
				const vertex = getGoogleVertexProvider(config);
				const { text } = await generateText({
					model: vertex(model),
					prompt,
					maxOutputTokens: 1024,
				});
				return text || "I don't have enough information to answer this question.";
			}

			case "openai": {
				const apiKey = process.env.OPENAI_API_KEY;
				if (!apiKey) {
					throw new Error("OPENAI_API_KEY is required for answer generation");
				}
				const openai = createOpenAI({ apiKey });
				const { text } = await generateText({
					model: openai(model),
					prompt,
					maxOutputTokens: 1024,
				});
				return text || "I don't have enough information to answer this question.";
			}

			case "azure-openai": {
				const apiKey = process.env.AZURE_OPENAI_API_KEY;
				const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
				const apiVersion = process.env.AZURE_OPENAI_API_VERSION ?? "2024-10-21";
				if (!apiKey || !endpoint) {
					throw new Error("AZURE_OPENAI_API_KEY and AZURE_OPENAI_ENDPOINT are required for answer generation");
				}
				const deploymentName = model;
				const azureOpenAI = createOpenAI({
					apiKey,
					baseURL: `${endpoint}/openai/deployments/${deploymentName}`,
					headers: { "api-key": apiKey },
					fetch: (url, init) => {
						// Append api-version query param to all requests
						const urlObj = new URL(url);
						urlObj.searchParams.set("api-version", apiVersion);
						return fetch(urlObj.toString(), init);
					},
				});
				const { text } = await generateText({
					model: azureOpenAI(deploymentName),
					prompt,
					maxOutputTokens: 1024,
				});
				return text || "I don't have enough information to answer this question.";
			}

			case "anthropic": {
				const apiKey = process.env.ANTHROPIC_API_KEY;
				if (!apiKey) {
					throw new Error("ANTHROPIC_API_KEY is required for answer generation");
				}
				const anthropic = createAnthropic({ apiKey });
				const { text } = await generateText({
					model: anthropic(model),
					prompt,
					maxOutputTokens: 1024,
				});
				return text || "I don't have enough information to answer this question.";
			}

			case "google": {
				const apiKey = process.env.GOOGLE_API_KEY;
				if (!apiKey) {
					throw new Error("GOOGLE_API_KEY is required for answer generation");
				}
				const google = createGoogleGenerativeAI({ apiKey });
				const { text } = await generateText({
					model: google(model),
					prompt,
					maxOutputTokens: 1024,
				});
				return text || "I don't have enough information to answer this question.";
			}

			case "anthropic-vertex": {
				const client = getAnthropicVertexClient(config);
				const normalizedModel = normalizeAnthropicVertexModelId(model);
				const response = await client.messages.create({
					model: normalizedModel,
					max_tokens: 1024,
					messages: [{ role: "user", content: prompt }],
				});
				const textContent = response.content.find((block) => block.type === "text");
				if (!textContent || textContent.type !== "text") {
					return "I don't have enough information to answer this question.";
				}
				return textContent.text;
			}

			default:
				// Exhaustive check - should never reach here due to resolveBackend validation
				throw new Error(`Unhandled backend in generateAnswerFromContext: ${backend satisfies never}`);
		}
	} catch (error) {
		console.error("Answer generation error:", error);
		return "I don't have enough information to answer this question.";
	}
}
