/**
 * RAG Template Benchmark - New Benchmark Interface Implementation
 *
 * Migrated to use the pluggable benchmark interface while maintaining
 * backward compatibility with existing data.
 */

import type {
	Benchmark,
	BenchmarkCase,
	CaseResult,
} from "../../types/benchmark";
import type { ScopeContext } from "../../types/core";
import type { BaseProvider } from "../../types/provider";
import { ragBenchmarkData } from "./data";
import type { RAGBenchmarkItem } from "./types";

/**
 * Convert RAGBenchmarkItem to BenchmarkCase format
 */
function convertToBenchmarkCase(item: RAGBenchmarkItem): BenchmarkCase {
	return {
		id: item.id,
		description: item.question,
		input: {
			question: item.question,
			documents: item.documents,
		},
		expected: item.expected_answer,
		metadata: {
			difficulty: item.metadata.difficulty,
			category: item.metadata.category,
			source_dataset: item.metadata.source_dataset,
		},
	};
}

/**
 * RAG Template Benchmark implementation
 */
const ragBenchmark: Benchmark = {
	meta: {
		name: "RAG-template-benchmark",
		version: "1.0.0",
		description:
			"Basic RAG (Retrieval-Augmented Generation) benchmark for testing document retrieval and question answering",
		required_capabilities: ["add_memory", "retrieve_memory"],
	},

	cases() {
		return ragBenchmarkData.map(convertToBenchmarkCase);
	},

	async run_case(
		provider: BaseProvider,
		scope: ScopeContext,
		benchmarkCase: BenchmarkCase,
	): Promise<CaseResult> {
		const start = performance.now();

		try {
			const input = benchmarkCase.input as {
				question: string;
				documents: Array<{ id: string; content: string }>;
			};

			// Step 1: Add all documents to the provider
			for (const doc of input.documents) {
				await provider.add_memory(scope, doc.content);
			}

			// Step 2: Wait for indexing (use a short delay for testing)
			// In production, this should respect provider's convergence_wait_ms
			await new Promise((resolve) => setTimeout(resolve, 100));

			// Step 3: Retrieve relevant documents
			const results = await provider.retrieve_memory(scope, input.question, 5);

			// Step 4: Calculate scores
			const expected = benchmarkCase.expected as string;
			const expectedLower = expected.toLowerCase();
			const hasRelevantDoc = results.some((result) =>
				result.record.context.toLowerCase().includes(expectedLower),
			);

			// Calculate precision: How many retrieved docs are relevant
			const relevantCount = results.filter((result) => {
				// Simple heuristic: check if result contains key terms from expected answer
				const contextLower = result.record.context.toLowerCase();
				return expectedLower
					.split(" ")
					.some((term) => term.length > 3 && contextLower.includes(term));
			}).length;

			const precision = results.length > 0 ? relevantCount / results.length : 0;

			// Top score from retrieval results
			const topScore = results.length > 0 ? results[0]!.score : 0;

			const duration_ms = performance.now() - start;

			return {
				case_id: benchmarkCase.id,
				status: hasRelevantDoc ? "pass" : "fail",
				scores: {
					precision,
					retrieval_count: results.length,
					top_score: topScore,
				},
				duration_ms,
			};
		} catch (error) {
			const duration_ms = performance.now() - start;

			return {
				case_id: benchmarkCase.id,
				status: "error",
				scores: {},
				duration_ms,
				error: {
					message: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : undefined,
				},
			};
		}
	},
};

export default ragBenchmark;
