/**
 * Tests for exact match evaluation protocol
 *
 * @see src/evaluation/exact-match.ts
 */

import { describe, expect, test } from "bun:test";
import { createExactMatch } from "../../src/evaluation/exact-match";
import type { EvaluationContext } from "../../src/evaluation/types";

describe("createExactMatch", () => {
	test("returns evaluation protocol with correct name", () => {
		const protocol = createExactMatch();
		expect(protocol.name).toBe("exact-match");
	});

	test("exact match returns correctness 1.0", async () => {
		const protocol = createExactMatch();

		const context: EvaluationContext = {
			question: "What is the capital of France?",
			expectedAnswer: "Paris",
			generatedAnswer: "Paris",
			retrievedContext: [],
		};

		const result = await protocol.evaluate(context);

		expect(result.correctness).toBe(1.0);
		expect(result.additionalMetrics?.isExactMatch).toBe(1);
	});

	test("case insensitive match by default", async () => {
		const protocol = createExactMatch();

		const context: EvaluationContext = {
			question: "What is the capital of France?",
			expectedAnswer: "Paris",
			generatedAnswer: "PARIS",
			retrievedContext: [],
		};

		const result = await protocol.evaluate(context);

		expect(result.correctness).toBe(1.0);
	});

	test("case sensitive mode respects case", async () => {
		const protocol = createExactMatch({ caseSensitive: true });

		const context: EvaluationContext = {
			question: "What is the capital of France?",
			expectedAnswer: "Paris",
			generatedAnswer: "PARIS",
			retrievedContext: [],
		};

		const result = await protocol.evaluate(context);

		// Not an exact match when case sensitive
		expect(result.correctness).toBeLessThan(1.0);
		expect(result.additionalMetrics?.isExactMatch).toBe(0);
	});

	test("whitespace normalization", async () => {
		const protocol = createExactMatch({ normalizeWhitespace: true });

		const context: EvaluationContext = {
			question: "What is the answer?",
			expectedAnswer: "hello   world",
			generatedAnswer: "hello world",
			retrievedContext: [],
		};

		const result = await protocol.evaluate(context);

		expect(result.correctness).toBe(1.0);
	});

	test("containment gives high score", async () => {
		const protocol = createExactMatch();

		const context: EvaluationContext = {
			question: "What is the capital of France?",
			expectedAnswer: "Paris",
			generatedAnswer: "The capital of France is Paris.",
			retrievedContext: [],
		};

		const result = await protocol.evaluate(context);

		expect(result.correctness).toBeGreaterThanOrEqual(0.9);
		expect(result.additionalMetrics?.isContained).toBe(1);
	});

	test("partial match gives partial score", async () => {
		const protocol = createExactMatch();

		const context: EvaluationContext = {
			question: "What cities did I visit?",
			expectedAnswer: "Paris and London",
			generatedAnswer: "Paris and Tokyo",
			retrievedContext: [],
		};

		const result = await protocol.evaluate(context);

		// Partial overlap should give partial score
		expect(result.correctness).toBeGreaterThan(0);
		expect(result.correctness).toBeLessThan(1.0);
	});

	test("no match returns 0", async () => {
		const protocol = createExactMatch();

		const context: EvaluationContext = {
			question: "What is the capital of France?",
			expectedAnswer: "Paris",
			generatedAnswer: "Tokyo",
			retrievedContext: [],
		};

		const result = await protocol.evaluate(context);

		expect(result.correctness).toBe(0);
	});

	test("faithfulness based on context", async () => {
		const protocol = createExactMatch();

		const context: EvaluationContext = {
			question: "What is the capital of France?",
			expectedAnswer: "Paris",
			generatedAnswer: "Paris",
			retrievedContext: ["The capital of France is Paris."],
		};

		const result = await protocol.evaluate(context);

		expect(result.faithfulness).toBe(1.0);
	});

	test("no faithfulness when not in context", async () => {
		const protocol = createExactMatch();

		const context: EvaluationContext = {
			question: "What is the capital of France?",
			expectedAnswer: "Paris",
			generatedAnswer: "Paris",
			retrievedContext: ["London is a city in England."],
		};

		const result = await protocol.evaluate(context);

		expect(result.faithfulness).toBeLessThan(1.0);
	});

	test("reasoning is provided", async () => {
		const protocol = createExactMatch();

		const context: EvaluationContext = {
			question: "Test?",
			expectedAnswer: "answer",
			generatedAnswer: "answer",
			retrievedContext: [],
		};

		const result = await protocol.evaluate(context);

		expect(result.reasoning).toBeDefined();
		expect(result.reasoning.length).toBeGreaterThan(0);
	});
});
