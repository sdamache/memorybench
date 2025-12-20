/**
 * LLM-as-Judge Evaluation Protocol
 *
 * Uses Claude via Anthropic Vertex SDK to evaluate memory system answers
 * with optional type-aware instructions for different question categories.
 *
 * Extracted from: benchmarks/LongMemEval/judge.ts
 *
 * @module src/evaluation/llm-judge
 * @see specs/006-benchmark-interface/data-driven-benchmark-design.md
 */

import AnthropicVertex from "@anthropic-ai/vertex-sdk";
import type {
	EvaluationContext,
	EvaluationProtocol,
	EvaluationResult,
	LLMJudgeConfig,
} from "./types";

/**
 * Default model for LLM evaluation
 */
const DEFAULT_MODEL = "claude-sonnet-4-20250514";

/**
 * Default region for Vertex AI
 */
const DEFAULT_REGION = "us-east5";

/**
 * Lazily initialized Anthropic Vertex client
 */
let client: AnthropicVertex | null = null;

/**
 * Get or create the Anthropic Vertex client
 */
function getClient(config: LLMJudgeConfig): AnthropicVertex {
	if (!client) {
		client = new AnthropicVertex({
			region: config.region ?? process.env.CLOUD_ML_REGION ?? DEFAULT_REGION,
			projectId: config.projectId ?? process.env.GOOGLE_CLOUD_PROJECT,
		});
	}
	return client;
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

2. **Faithfulness (0-1)**: Is the answer grounded in the retrieved context?
   - 1.0: Fully supported by retrieved evidence
   - 0.5: Partially supported
   - 0.0: Not supported or hallucinated

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
}`;
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
			// Get type-specific instructions if available
			let typeInstructions: string | undefined;
			if (context.questionType && config.typeInstructions) {
				typeInstructions = config.typeInstructions[context.questionType];
			}

			const prompt = buildPrompt(context, typeInstructions);

			try {
				const anthropic = getClient(config);

				const response = await anthropic.messages.create({
					model: config.model ?? DEFAULT_MODEL,
					max_tokens: 1024,
					messages: [
						{
							role: "user",
							content: prompt,
						},
					],
				});

				// Extract text content from response
				const textContent = response.content.find(
					(block) => block.type === "text",
				);
				if (!textContent || textContent.type !== "text") {
					return {
						correctness: 0,
						faithfulness: 0,
						reasoning: "No text response from judge",
					};
				}

				return parseJudgeResponse(textContent.text);
			} catch (error) {
				return {
					correctness: 0,
					faithfulness: 0,
					reasoning: `Judge error: ${error instanceof Error ? error.message : String(error)}`,
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
