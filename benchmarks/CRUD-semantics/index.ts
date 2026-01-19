/**
 * CRUD Semantics Benchmark
 *
 * Evaluates memory provider lifecycle semantics:
 * - Write/Retrieve: Verify stored content is retrievable
 * - Update Staleness: Verify old values don't persist after updates (capability-gated)
 * - Delete Leakage: Verify deleted content doesn't leak through queries
 *
 * @module benchmarks/CRUD-semantics
 * @see specs/014-crud-semantics-benchmark/spec.md
 */

import { cleanupIngested } from "../../src/ingestion";
import type {
	Benchmark,
	BenchmarkCase,
	CaseResult,
} from "../../types/benchmark";
import type { ScopeContext } from "../../types/core";
import type { BaseProvider } from "../../types/provider";
import { crudTestCases } from "./cases";
import type { CRUDScores, CRUDTestCase } from "./types";
import { detectToken, expandTemplate, waitForConvergence } from "./utils";

/**
 * Convert CRUDTestCase to BenchmarkCase format
 */
function convertToBenchmarkCase(testCase: CRUDTestCase): BenchmarkCase {
	return {
		id: testCase.id,
		description: testCase.description,
		input: {
			type: testCase.type,
			fact: testCase.fact,
			setup_facts: testCase.setup_facts,
			query: testCase.query,
			adversarial_queries: testCase.adversarial_queries,
			requires_capability: testCase.requires_capability,
		},
		expected:
			testCase.type === "write_retrieve" ? "token_found" : "token_not_found",
		metadata: {
			category: testCase.fact.category,
			case_type: testCase.type,
		},
	};
}

/**
 * Default scores for initialization
 */
function defaultScores(): CRUDScores {
	return {
		write_retrieve_success: 0,
		staleness_violation_count: 0,
		delete_leakage_count: 0,
		add_latency_ms: 0,
		retrieve_latency_ms: 0,
		update_latency_ms: 0,
		delete_latency_ms: 0,
	};
}

/**
 * CRUD Semantics Benchmark implementation
 */
const crudBenchmark: Benchmark = {
	meta: {
		name: "CRUD-semantics",
		version: "1.0.0",
		description:
			"Evaluates memory lifecycle semantics: write/retrieve correctness, update staleness, and delete leakage",
		required_capabilities: ["add_memory", "retrieve_memory", "delete_memory"],
	},

	cases() {
		return crudTestCases.map(convertToBenchmarkCase);
	},

	async run_case(
		provider: BaseProvider,
		scope: ScopeContext,
		benchmarkCase: BenchmarkCase,
	): Promise<CaseResult> {
		const start = performance.now();
		const ingestedIds: string[] = [];
		const scores = { ...defaultScores() };
		const artifacts: Record<string, unknown> = {};

		try {
			const input = benchmarkCase.input as {
				type: string;
				fact: {
					category: string;
					initial_value: string;
					updated_value?: string;
					content_template: string;
					verification_query?: string;
				};
				setup_facts?: Array<{
					category: string;
					initial_value: string;
					updated_value?: string;
					content_template: string;
					verification_query?: string;
				}>;
				query: string;
				adversarial_queries?: string[];
				requires_capability?: string;
			};

			// Check capability gating for update_memory
			if (input.requires_capability === "update_memory") {
				if (typeof provider.update_memory !== "function") {
					return {
						case_id: benchmarkCase.id,
						status: "skip",
						scores,
						duration_ms: performance.now() - start,
						artifacts: {
							...artifacts,
							skip_reason: "Provider does not support update_memory",
						},
					};
				}
			}

			// Execute based on case type
			switch (input.type) {
				case "write_retrieve":
					return await runWriteRetrieve(
						provider,
						scope,
						benchmarkCase,
						input,
						ingestedIds,
						scores,
						artifacts,
						start,
					);

				case "delete_leakage":
					return await runDeleteLeakage(
						provider,
						scope,
						benchmarkCase,
						input,
						ingestedIds,
						scores,
						artifacts,
						start,
					);

				case "update_staleness":
					return await runUpdateStaleness(
						provider,
						scope,
						benchmarkCase,
						input,
						ingestedIds,
						scores,
						artifacts,
						start,
					);

				default:
					throw new Error(`Unknown case type: ${input.type}`);
			}
		} catch (error) {
			return {
				case_id: benchmarkCase.id,
				status: "error",
				scores,
				duration_ms: performance.now() - start,
				error: {
					message: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : undefined,
				},
				artifacts,
			};
		} finally {
			// Cleanup ingested records
			if (ingestedIds.length > 0) {
				await cleanupIngested(provider, scope, ingestedIds).catch(() => {
					// Ignore cleanup errors
				});
			}
		}
	},
};

// =============================================================================
// Case Type Implementations
// =============================================================================

/**
 * Run a write_retrieve test case
 */
async function runWriteRetrieve(
	provider: BaseProvider,
	scope: ScopeContext,
	benchmarkCase: BenchmarkCase,
	input: {
		fact: {
			initial_value: string;
			content_template: string;
			verification_query?: string;
		};
		setup_facts?: Array<{
			category: string;
			initial_value: string;
			content_template: string;
			verification_query?: string;
		}>;
		query: string;
	},
	ingestedIds: string[],
	scores: CRUDScores,
	artifacts: Record<string, unknown>,
	start: number,
): Promise<CaseResult> {
	const mutableScores = { ...scores };
	const mutableArtifacts = { ...artifacts };

	// Step 1: Add optional setup facts first (multiple facts in same scope)
	if (input.setup_facts) {
		for (const fact of input.setup_facts) {
			const content = expandTemplate(fact.content_template, fact.initial_value);
			const record = await provider.add_memory(scope, content);
			ingestedIds.push(record.id);
		}
	}

	// Step 2: Add primary memory
	const content = expandTemplate(
		input.fact.content_template,
		input.fact.initial_value,
	);
	const addStart = performance.now();
	const record = await provider.add_memory(scope, content);
	mutableScores.add_latency_ms = performance.now() - addStart;
	ingestedIds.push(record.id);
	mutableArtifacts.ingested_ids = [...ingestedIds];

	// Step 3: Wait for convergence
	await waitForConvergence(provider, scope, ingestedIds);

	// Step 4: Retrieve and verify token
	const verificationQuery = input.fact.verification_query ?? input.query;
	const retrieveStart = performance.now();
	const results = await provider.retrieve_memory(scope, verificationQuery, 5);
	mutableScores.retrieve_latency_ms = performance.now() - retrieveStart;

	// Step 5: Token detection
	const detection = detectToken(results, input.fact.initial_value);
	mutableScores.write_retrieve_success = detection.found ? 1 : 0;
	mutableArtifacts.expected_token = input.fact.initial_value;
	mutableArtifacts.token_found = detection.found;
	mutableArtifacts.verification_query = verificationQuery;

	if (detection.found) {
		mutableArtifacts.token_found_in = detection.found_in_indices.map(
			(i) => results[i]?.record.id ?? `index_${i}`,
		);
	}

	// Store retrieve results for debugging
	mutableArtifacts.retrieve_results = results.map((r) => ({
		id: r.record.id,
		context: r.record.context.substring(0, 200), // Truncate for readability
		score: r.score,
	}));

	return {
		case_id: benchmarkCase.id,
		status: detection.found ? "pass" : "fail",
		scores: mutableScores,
		duration_ms: performance.now() - start,
		artifacts: mutableArtifacts,
	};
}

/**
 * Run a delete_leakage test case
 */
async function runDeleteLeakage(
	provider: BaseProvider,
	scope: ScopeContext,
	benchmarkCase: BenchmarkCase,
	input: {
		fact: { initial_value: string; content_template: string };
		query: string;
		adversarial_queries?: string[];
	},
	ingestedIds: string[],
	scores: CRUDScores,
	artifacts: Record<string, unknown>,
	start: number,
): Promise<CaseResult> {
	const mutableScores = { ...scores };
	const mutableArtifacts = { ...artifacts };

	// Step 1: Add memory
	const content = expandTemplate(
		input.fact.content_template,
		input.fact.initial_value,
	);
	const addStart = performance.now();
	const record = await provider.add_memory(scope, content);
	mutableScores.add_latency_ms = performance.now() - addStart;
	const recordId = record.id;
	mutableArtifacts.ingested_id = recordId;

	// Add to cleanup list BEFORE deleting - ensures cleanup runs if delete fails
	// (cleanupIngested handles already-deleted IDs gracefully)
	ingestedIds.push(recordId);

	// Step 2: Wait for convergence
	await waitForConvergence(provider, scope, [recordId]);

	// Step 3: Delete the memory
	const deleteStart = performance.now();
	await provider.delete_memory(scope, recordId);
	mutableScores.delete_latency_ms = performance.now() - deleteStart;

	// Step 4: Wait for delete to propagate
	await waitForConvergence(provider, scope, []);

	// Step 5: Run adversarial queries and count leaks
	// Include exact deleted content to satisfy the acceptance scenario.
	const exactContentQuery = content;
	const tokenQuery = input.fact.initial_value;
	const queries = [
		input.query,
		tokenQuery,
		exactContentQuery,
		...(input.adversarial_queries ?? []),
	];
	let leakCount = 0;

	for (const query of queries) {
		const retrieveStart = performance.now();
		const results = await provider.retrieve_memory(scope, query, 5);
		mutableScores.retrieve_latency_ms = Math.max(
			mutableScores.retrieve_latency_ms,
			performance.now() - retrieveStart,
		);

		const detection = detectToken(results, input.fact.initial_value);
		if (detection.found) {
			leakCount++;
		}
	}

	mutableScores.delete_leakage_count = leakCount;
	mutableArtifacts.expected_token = input.fact.initial_value;
	mutableArtifacts.token_found = leakCount > 0;
	mutableArtifacts.verification_query = queries.join(" | ");

	return {
		case_id: benchmarkCase.id,
		status: leakCount === 0 ? "pass" : "fail",
		scores: mutableScores,
		duration_ms: performance.now() - start,
		artifacts: mutableArtifacts,
	};
}

/**
 * Run an update_staleness test case
 */
async function runUpdateStaleness(
	provider: BaseProvider,
	scope: ScopeContext,
	benchmarkCase: BenchmarkCase,
	input: {
		fact: {
			initial_value: string;
			updated_value?: string;
			content_template: string;
			verification_query?: string;
		};
		query: string;
		adversarial_queries?: string[];
	},
	ingestedIds: string[],
	scores: CRUDScores,
	artifacts: Record<string, unknown>,
	start: number,
): Promise<CaseResult> {
	const mutableScores = { ...scores };
	const mutableArtifacts = { ...artifacts };

	// This should only be called if update_memory exists (checked earlier)
	if (typeof provider.update_memory !== "function") {
		return {
			case_id: benchmarkCase.id,
			status: "skip",
			scores: mutableScores,
			duration_ms: performance.now() - start,
			artifacts: { skip_reason: "Provider does not support update_memory" },
		};
	}

	const updatedValue = input.fact.updated_value ?? `UPDATED_${Date.now()}`;

	// Step 1: Add initial memory
	const initialContent = expandTemplate(
		input.fact.content_template,
		input.fact.initial_value,
	);
	const addStart = performance.now();
	const record = await provider.add_memory(scope, initialContent);
	mutableScores.add_latency_ms = performance.now() - addStart;
	ingestedIds.push(record.id);
	mutableArtifacts.ingested_ids = [...ingestedIds];

	// Step 2: Wait for convergence
	await waitForConvergence(provider, scope, ingestedIds);

	// Step 3: Update to new value
	const updatedContent = expandTemplate(
		input.fact.content_template,
		updatedValue,
	);
	const updateStart = performance.now();
	await provider.update_memory(scope, record.id, updatedContent);
	mutableScores.update_latency_ms = performance.now() - updateStart;

	// Step 4: Wait for update to propagate
	await waitForConvergence(provider, scope, ingestedIds);

	// Step 5: Retrieve and check for staleness
	const verificationQueries = [
		input.fact.verification_query ?? input.query,
		...(input.adversarial_queries ?? []),
	];

	let stalenessViolations = 0;
	let newTokenFound = false;
	const allResults: Array<{
		query: string;
		results: Array<{ id: string; context: string; score: number }>;
	}> = [];

	for (const query of verificationQueries) {
		const retrieveStart = performance.now();
		const results = await provider.retrieve_memory(scope, query, 5);
		mutableScores.retrieve_latency_ms = Math.max(
			mutableScores.retrieve_latency_ms,
			performance.now() - retrieveStart,
		);

		const oldTokenDetection = detectToken(results, input.fact.initial_value);
		const newTokenDetection = detectToken(results, updatedValue);

		if (oldTokenDetection.found) stalenessViolations++;
		if (newTokenDetection.found) newTokenFound = true;

		allResults.push({
			query,
			results: results.map((r) => ({
				id: r.record.id,
				context: r.record.context.substring(0, 200),
				score: r.score,
			})),
		});
	}

	mutableScores.staleness_violation_count = stalenessViolations;
	mutableScores.write_retrieve_success = newTokenFound ? 1 : 0;

	mutableArtifacts.expected_token = updatedValue;
	mutableArtifacts.token_found = newTokenFound;
	mutableArtifacts.verification_query = verificationQueries.join(" | ");
	mutableArtifacts.retrieve_results = allResults.flatMap((q) => q.results);

	// Pass only if the new token is present and there are no staleness violations
	const status = newTokenFound && stalenessViolations === 0 ? "pass" : "fail";

	return {
		case_id: benchmarkCase.id,
		status,
		scores: mutableScores,
		duration_ms: performance.now() - start,
		artifacts: mutableArtifacts,
	};
}

export default crudBenchmark;
