/**
 * Unit Tests for BM25 Scoring Algorithm
 *
 * Tests the BM25 (Best Matching 25) implementation used by LocalBaseline provider.
 *
 * @module tests/utils/bm25.test.ts
 */

import { describe, test, expect } from "bun:test";
import {
	tokenize,
	termFreq,
	idf,
	avgDocLength,
	bm25Score,
	rankDocuments,
} from "../../src/utils/bm25";

// =============================================================================
// Tokenizer Tests
// =============================================================================

describe("tokenize", () => {
	test("should lowercase all tokens", () => {
		expect(tokenize("Hello World")).toEqual(["hello", "world"]);
	});

	test("should remove punctuation", () => {
		expect(tokenize("What is the capital?")).toEqual([
			"what",
			"is",
			"the",
			"capital",
		]);
	});

	test("should handle multiple spaces", () => {
		expect(tokenize("hello    world")).toEqual(["hello", "world"]);
	});

	test("should filter single character tokens", () => {
		expect(tokenize("I am a test")).toEqual(["am", "test"]);
	});

	test("should handle empty string", () => {
		expect(tokenize("")).toEqual([]);
	});

	test("should handle string with only punctuation", () => {
		expect(tokenize("!@#$%")).toEqual([]);
	});
});

// =============================================================================
// Term Frequency Tests
// =============================================================================

describe("termFreq", () => {
	test("should count term frequencies correctly", () => {
		const tokens = ["hello", "world", "hello"];
		const freq = termFreq(tokens);
		expect(freq.get("hello")).toBe(2);
		expect(freq.get("world")).toBe(1);
	});

	test("should return empty map for empty array", () => {
		const freq = termFreq([]);
		expect(freq.size).toBe(0);
	});

	test("should handle single token", () => {
		const freq = termFreq(["single"]);
		expect(freq.get("single")).toBe(1);
	});
});

// =============================================================================
// IDF Tests
// =============================================================================

describe("idf", () => {
	test("should return higher score for rarer terms", () => {
		const docs = [
			["apple", "banana"],
			["apple", "cherry"],
			["apple", "date"],
		];
		const idfApple = idf("apple", docs); // appears in all 3 docs
		const idfBanana = idf("banana", docs); // appears in 1 doc

		expect(idfBanana).toBeGreaterThan(idfApple);
	});

	test("should return 0 for term not in any document", () => {
		const docs = [["apple"], ["banana"]];
		expect(idf("cherry", docs)).toBe(0);
	});

	test("should return 0 for empty corpus", () => {
		expect(idf("anything", [])).toBe(0);
	});
});

// =============================================================================
// Average Document Length Tests
// =============================================================================

describe("avgDocLength", () => {
	test("should calculate correct average", () => {
		const docs = [
			["a", "b", "c"], // 3 tokens
			["d", "e"], // 2 tokens
			["f"], // 1 token
		];
		expect(avgDocLength(docs)).toBe(2); // (3+2+1)/3 = 2
	});

	test("should return 0 for empty corpus", () => {
		expect(avgDocLength([])).toBe(0);
	});
});

// =============================================================================
// BM25 Score Tests
// =============================================================================

describe("bm25Score", () => {
	test("should return 0 when query has no matching terms", () => {
		const queryTokens = ["xyz"];
		const docTokens = ["apple", "banana"];
		const allDocs = [docTokens];
		const avgDl = avgDocLength(allDocs);

		expect(bm25Score(queryTokens, docTokens, allDocs, avgDl)).toBe(0);
	});

	test("should return positive score when query matches document", () => {
		const queryTokens = ["apple"];
		const docTokens = ["apple", "banana"];
		const allDocs = [docTokens, ["cherry", "date"]];
		const avgDl = avgDocLength(allDocs);

		expect(bm25Score(queryTokens, docTokens, allDocs, avgDl)).toBeGreaterThan(
			0,
		);
	});

	test("should score document with more matching terms higher", () => {
		const queryTokens = ["capital", "france"];
		const doc1Tokens = ["paris", "capital", "france"]; // 2 matches
		const doc2Tokens = ["berlin", "capital", "germany"]; // 1 match
		const allDocs = [doc1Tokens, doc2Tokens];
		const avgDl = avgDocLength(allDocs);

		const score1 = bm25Score(queryTokens, doc1Tokens, allDocs, avgDl);
		const score2 = bm25Score(queryTokens, doc2Tokens, allDocs, avgDl);

		expect(score1).toBeGreaterThan(score2);
	});
});

// =============================================================================
// Rank Documents Tests
// =============================================================================

describe("rankDocuments", () => {
	test("should rank relevant documents higher", () => {
		const query = "capital of France";
		const documents = [
			"Berlin is the capital of Germany",
			"Paris is the capital of France",
			"The weather is nice today",
		];

		const ranked = rankDocuments(query, documents);

		// Document about Paris/France should rank highest
		expect(ranked[0]?.index).toBe(1);
		// Document about Berlin/Germany should rank second (shares "capital")
		expect(ranked[1]?.index).toBe(0);
		// Weather document should rank lowest
		expect(ranked[2]?.index).toBe(2);
	});

	test("should return scores in descending order", () => {
		const query = "test query";
		const documents = ["first document", "test document", "query document"];

		const ranked = rankDocuments(query, documents);

		for (let i = 1; i < ranked.length; i++) {
			expect(ranked[i - 1]!.score).toBeGreaterThanOrEqual(ranked[i]!.score);
		}
	});

	test("should handle empty documents array", () => {
		const ranked = rankDocuments("test", []);
		expect(ranked).toEqual([]);
	});

	test("should handle query with no matches", () => {
		const ranked = rankDocuments("xyz", ["apple banana", "cherry date"]);
		// All scores should be 0
		for (const result of ranked) {
			expect(result.score).toBe(0);
		}
	});
});

// =============================================================================
// Integration: RAG Benchmark Scenarios
// =============================================================================

describe("RAG Benchmark Scenarios", () => {
	test("should match 'capital of France' query to Paris document", () => {
		const query = "What is the capital of France?";
		const documents = [
			"Paris is the capital and most populous city of France. With an official estimated population of 2,102,650 residents.",
			"France is a country primarily located in Western Europe.",
		];

		const ranked = rankDocuments(query, documents);

		// Paris document should rank first
		expect(ranked[0]?.index).toBe(0);
		expect(ranked[0]?.score).toBeGreaterThan(0);
	});

	test("should match photosynthesis query to relevant documents", () => {
		const query = "How does photosynthesis work in plants?";
		const documents = [
			"Photosynthesis is a process used by plants and other organisms to convert light energy into chemical energy.",
			"The weather in tropical regions is typically hot and humid.",
		];

		const ranked = rankDocuments(query, documents);

		// Photosynthesis document should rank first
		expect(ranked[0]?.index).toBe(0);
		expect(ranked[0]?.score).toBeGreaterThan(ranked[1]?.score ?? 0);
	});
});
