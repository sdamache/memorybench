/**
 * CRUD Semantics Benchmark - Test Case Definitions
 *
 * Defines synthetic facts with unique tokens for deterministic verification.
 * Each case uses a unique token pattern: {CATEGORY}_{UNIQUE_VALUE}_{CASE_ID}
 *
 * @module benchmarks/CRUD-semantics/cases
 * @see specs/014-crud-semantics-benchmark/data-model.md
 */

import type { CRUDTestCase } from "./types";

/**
 * All CRUD test cases for the benchmark
 *
 * Test cases are organized by type:
 * - write_retrieve: Verify basic write and retrieval
 * - delete_leakage: Verify deleted data doesn't leak
 * - update_staleness: Verify old values don't persist (capability-gated)
 */
export const crudTestCases: readonly CRUDTestCase[] = [
	// =========================================================================
	// User Story 1: Write Then Retrieve Verification (P1)
	// =========================================================================

	/**
	 * T007: Basic fact storage with FAVORITE_COLOR token
	 * Tests the most fundamental write/retrieve operation
	 */
	{
		id: "write_retrieve_01",
		type: "write_retrieve",
		description: "Basic fact storage and retrieval with FAVORITE_COLOR token",
		fact: {
			category: "FAVORITE_COLOR",
			initial_value: "ULTRAVIOLET_9X7K2M",
			content_template:
				"My favorite color is {value}. I find this color very calming and use it in my home decor.",
		},
		query: "What is the user's favorite color?",
	},

	/**
	 * T008: PET_NAME token with different category
	 * Tests retrieval with a different fact category
	 */
	{
		id: "write_retrieve_02",
		type: "write_retrieve",
		description: "Multiple facts in one scope; retrieve specific fact",
		setup_facts: [
			{
				category: "FAVORITE_MOVIE",
				initial_value: "CITIZENKANE_1A2B3C",
				content_template: "My favorite movie is {value}.",
			},
		],
		fact: {
			category: "PET_NAME",
			initial_value: "FLUFFYZORAX_3B8N4P",
			content_template:
				"My pet's name is {value}. It's a golden retriever that loves to play fetch.",
		},
		query: "What is the name of the user's pet?",
	},

	/**
	 * T009: BIRTHPLACE token - tests async convergence handling
	 * Verifies the system handles convergence delays properly
	 */
	{
		id: "write_retrieve_03",
		type: "write_retrieve",
		description: "Birthplace storage testing async convergence handling",
		fact: {
			category: "BIRTHPLACE",
			initial_value: "QUANTUMVILLE_5H2J9R",
			content_template:
				"I was born in {value}. It's a small coastal town known for its beautiful sunsets.",
		},
		query: "Where was the user born?",
	},

	// =========================================================================
	// User Story 2: Delete Then Leakage Verification (P2)
	// =========================================================================

	/**
	 * T012: Adversarial exact query after delete
	 * Tests direct query for deleted content
	 */
	{
		id: "delete_leakage_01",
		type: "delete_leakage",
		description: "Adversarial exact query after delete - direct fact query",
		fact: {
			category: "SECRET_CODE",
			initial_value: "XYLOPHONE_7K3M9W",
			content_template:
				"My secret code is {value}. I use this for my bank account.",
		},
		query: "What is the user's secret code?",
		adversarial_queries: [
			"Tell me about the user's secret code",
			"What code does the user use for banking?",
		],
	},

	/**
	 * T013: Adversarial semantic query after delete
	 * Tests semantic/paraphrased queries for deleted content
	 */
	{
		id: "delete_leakage_02",
		type: "delete_leakage",
		description:
			"Adversarial semantic query after delete - paraphrased queries",
		fact: {
			category: "MEDICAL_CONDITION",
			initial_value: "ZORPLAXITIS_2N5P8Q",
			content_template:
				"I was diagnosed with {value}. It requires daily medication.",
		},
		query: "What medical condition does the user have?",
		adversarial_queries: [
			"What health issues affect the user?",
			"Tell me about the user's diagnosis",
			"What illness was the user diagnosed with?",
		],
	},

	/**
	 * T014: Related topic query after delete
	 * Tests if deleted info leaks through tangentially related queries
	 */
	{
		id: "delete_leakage_03",
		type: "delete_leakage",
		description: "Related topic query after delete - tangential queries",
		fact: {
			category: "SALARY_INFO",
			initial_value: "GOLDENTHALERS_4J7R2X",
			content_template:
				"My annual salary is {value}. I negotiate it every year.",
		},
		query: "What is the user's salary?",
		adversarial_queries: [
			"How much money does the user make?",
			"Tell me about the user's income",
			"What does the user earn annually?",
			"User financial compensation details",
		],
	},

	// =========================================================================
	// User Story 3: Update Then Staleness Verification (P3)
	// =========================================================================

	/**
	 * T017: Update fact, verify old token absent
	 * Tests basic update staleness - old value should not be returned
	 */
	{
		id: "update_staleness_01",
		type: "update_staleness",
		description: "Update fact and verify new token present + old token absent",
		fact: {
			category: "FAVORITE_FOOD",
			initial_value: "PIZZADRON_8M4K6T",
			updated_value: "SUSHITRON_3X9W2P",
			content_template:
				"My favorite food is {value}. I eat it at least twice a week.",
		},
		query: "What is the user's favorite food?",
		adversarial_queries: ["Is the user's favorite food PIZZADRON_8M4K6T?"],
		requires_capability: "update_memory",
	},

	/**
	 * T018: Update with semantic query verification
	 * Tests update staleness with more semantic/paraphrased queries
	 */
	{
		id: "update_staleness_02",
		type: "update_staleness",
		description: "Update with semantic query verification",
		fact: {
			category: "HOME_ADDRESS",
			initial_value: "NEBULA_STREET_7R2Q5Y",
			updated_value: "COSMOS_AVENUE_4B8J1N",
			content_template:
				"I live at {value}. It's in a quiet neighborhood with good schools.",
		},
		query: "Where does the user live?",
		requires_capability: "update_memory",
	},
];
