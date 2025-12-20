/**
 * Exact Match Evaluation Protocol
 *
 * Simple string comparison evaluation for benchmarks where
 * exact matching is sufficient (e.g., NoLiMa needle retrieval).
 *
 * @module src/evaluation/exact-match
 * @see specs/006-benchmark-interface/data-driven-benchmark-design.md
 */

import type {
	EvaluationContext,
	EvaluationProtocol,
	EvaluationResult,
	ExactMatchConfig,
} from "./types";

/**
 * Default configuration for exact match
 */
const DEFAULT_CONFIG: Required<ExactMatchConfig> = {
	caseSensitive: false,
	normalizeWhitespace: true,
	trim: true,
};

/**
 * Normalize a string based on configuration
 */
function normalizeString(str: string, config: Required<ExactMatchConfig>): string {
	let result = str;

	if (config.trim) {
		result = result.trim();
	}

	if (config.normalizeWhitespace) {
		result = result.replace(/\s+/g, " ");
	}

	if (!config.caseSensitive) {
		result = result.toLowerCase();
	}

	return result;
}

/**
 * Calculate similarity between two strings (0-1)
 * Uses Levenshtein distance normalized by max length
 */
function calculateSimilarity(str1: string, str2: string): number {
	if (str1 === str2) return 1;
	if (str1.length === 0 || str2.length === 0) return 0;

	// Simple character overlap for partial matches
	const set1 = new Set(str1.split(/\s+/));
	const set2 = new Set(str2.split(/\s+/));

	let intersection = 0;
	for (const word of set1) {
		if (set2.has(word)) {
			intersection++;
		}
	}

	const union = new Set([...set1, ...set2]).size;
	return union > 0 ? intersection / union : 0;
}

/**
 * Check if expected answer is contained in the generated answer
 */
function checkContainment(
	generated: string,
	expected: string,
	config: Required<ExactMatchConfig>,
): boolean {
	const normalizedGenerated = normalizeString(generated, config);
	const normalizedExpected = normalizeString(expected, config);

	return normalizedGenerated.includes(normalizedExpected);
}

/**
 * Create an exact match evaluation protocol
 *
 * @param config - Configuration for exact match evaluation
 * @returns Evaluation protocol implementation
 *
 * @example
 * ```typescript
 * const exactMatch = createExactMatch({
 *   caseSensitive: false,
 *   normalizeWhitespace: true
 * });
 *
 * const result = await exactMatch.evaluate({
 *   question: "What is the capital?",
 *   expectedAnswer: "Paris",
 *   generatedAnswer: "The capital is Paris",
 *   retrievedContext: []
 * });
 * ```
 */
export function createExactMatch(
	config: ExactMatchConfig = {},
): EvaluationProtocol {
	const mergedConfig: Required<ExactMatchConfig> = {
		...DEFAULT_CONFIG,
		...config,
	};

	return {
		name: "exact-match",

		async evaluate(context: EvaluationContext): Promise<EvaluationResult> {
			const normalizedExpected = normalizeString(
				context.expectedAnswer,
				mergedConfig,
			);
			const normalizedGenerated = normalizeString(
				context.generatedAnswer,
				mergedConfig,
			);

			// Check for exact match
			const isExactMatch = normalizedExpected === normalizedGenerated;

			// Check for containment (expected is within generated)
			const isContained = checkContainment(
				context.generatedAnswer,
				context.expectedAnswer,
				mergedConfig,
			);

			// Calculate similarity score
			const similarity = calculateSimilarity(
				normalizedExpected,
				normalizedGenerated,
			);

			// Calculate faithfulness based on whether answer appears in context
			let faithfulness = 0;
			for (const ctx of context.retrievedContext) {
				const normalizedCtx = normalizeString(ctx, mergedConfig);
				if (normalizedCtx.includes(normalizedExpected)) {
					faithfulness = 1;
					break;
				}
				// Partial credit for partial matches
				const ctxSimilarity = calculateSimilarity(normalizedCtx, normalizedExpected);
				if (ctxSimilarity > faithfulness) {
					faithfulness = ctxSimilarity;
				}
			}

			// Determine correctness score
			let correctness: number;
			let reasoning: string;

			if (isExactMatch) {
				correctness = 1.0;
				reasoning = "Exact match between expected and generated answer.";
			} else if (isContained) {
				correctness = 0.9;
				reasoning = "Expected answer is contained within generated answer.";
			} else if (similarity >= 0.8) {
				correctness = 0.7;
				reasoning = `High similarity (${(similarity * 100).toFixed(1)}%) between expected and generated.`;
			} else if (similarity >= 0.5) {
				correctness = 0.5;
				reasoning = `Partial similarity (${(similarity * 100).toFixed(1)}%) between expected and generated.`;
			} else if (similarity > 0) {
				correctness = similarity * 0.5;
				reasoning = `Low similarity (${(similarity * 100).toFixed(1)}%) between expected and generated.`;
			} else {
				correctness = 0;
				reasoning = "No match between expected and generated answer.";
			}

			return {
				correctness,
				faithfulness,
				reasoning,
				additionalMetrics: {
					similarity,
					isExactMatch: isExactMatch ? 1 : 0,
					isContained: isContained ? 1 : 0,
				},
			};
		},
	};
}
