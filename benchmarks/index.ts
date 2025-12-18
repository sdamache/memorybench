import type { LoCoMoBenchmarkItem } from "./LoCoMo/types";
import type { RAGBenchmarkItem } from "./RAG-template-benchmark/types";

export interface BenchmarkRegistry {
	"RAG-template-benchmark": RAGBenchmarkItem;
	LoCoMo: LoCoMoBenchmarkItem;
	// Future benchmarks can be added here
	// 'QA': QABenchmarkItem;
	// 'Summarization': SummarizationBenchmarkItem;
}

export type BenchmarkType = keyof BenchmarkRegistry;
export type BenchmarkData<T extends BenchmarkType> = BenchmarkRegistry[T];

// Export all benchmark types and data
export * from "./RAG-template-benchmark";
