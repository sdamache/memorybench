/**
 * Evaluation Protocols Module
 *
 * Provides reusable evaluation protocols for data-driven benchmarks.
 * Each protocol implements a specific evaluation strategy.
 *
 * @module src/evaluation
 * @see specs/006-benchmark-interface/data-driven-benchmark-design.md
 */

// Types
export type {
	EvaluationContext,
	EvaluationProtocol,
	EvaluationProtocolFactory,
	EvaluationResult,
	ExactMatchConfig,
	LLMJudgeConfig,
	DeletionCheckConfig,
} from "./types";

// LLM-as-Judge protocol
export {
	createLLMJudge,
	evaluateBatch,
	loadTypeInstructions,
} from "./llm-judge";

// Exact match protocol
export { createExactMatch } from "./exact-match";
