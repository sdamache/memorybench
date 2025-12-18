/*
Search script for LongMemEval questions.
Searches for ingested questions and stores results with default parameters.
*/

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { config, validateConfig } from "../utils/config.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

validateConfig(["apiKey", "baseUrl"]);

// Get command line arguments
const args = process.argv.slice(2);
if (args.length < 2) {
	console.error("Usage: bun run search.ts <questionId> <runId>");
	console.error("Example: bun run search.ts e25c3b8d run1");
	process.exit(1);
}

const questionId = args[0];
const runId = args[1];
const containerTag = `${questionId}-${runId}`;

// Fixed default search parameters
const searchParams = {
	limit: 10,
	threshold: 0.3,
	includeChunks: true,
	rerank: false,
	rewrite: false,
};

const resultsFolder = "results";

console.log(`Question ID: ${questionId}`);
console.log(`Container Tag: ${containerTag}`);

// Read the question data
const questionFilePath = join(
	__dirname,
	"../../datasets/questions",
	`${questionId}.json`,
);
if (!existsSync(questionFilePath)) {
	console.error(`Error: Question file not found at ${questionFilePath}`);
	process.exit(1);
}

const data = JSON.parse(readFileSync(questionFilePath, "utf8"));
const question = data.question;
const questionDate = data.question_date;
const answer = data.answer;
const questionType = data.question_type;

// Setup results directory
const resultsDir = join(__dirname, "../../", resultsFolder);
if (!existsSync(resultsDir)) {
	mkdirSync(resultsDir, { recursive: true });
}

// Generate standard filename
const resultFilePath = join(resultsDir, `${questionId}-${runId}.json`);

// Perform search
const performSearch = async () => {
	console.log(`\nSearching for: "${question}"`);

	try {
		const requestBody = {
			q: question,
			containerTag: containerTag,
			limit: searchParams.limit,
			threshold: searchParams.threshold,
			include: {
				chunks: searchParams.includeChunks,
			},
		};

		const response = await fetch(`${config.baseUrl}/v4/search`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${config.apiKey}`,
			},
			body: JSON.stringify(requestBody),
		});

		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}`);
		}

		const searchResults = await response.json();

		// Save results with metadata
		const resultData = {
			metadata: {
				questionId,
				runId,
				containerTag,
				question,
				questionDate,
				questionType,
				groundTruthAnswer: answer,
				searchParams, // Always default
				timestamp: new Date().toISOString(),
			},
			searchResults,
		};

		writeFileSync(resultFilePath, JSON.stringify(resultData, null, 2));
		console.log(`\nResults saved to: ${resultFilePath}`);

		// Display summary
		console.log(`\nSearch Summary:`);
		// @ts-ignore
		console.log(`- Total results: ${searchResults.results?.length || 0}`);
		// @ts-ignore
		if (searchResults.results && searchResults.results.length > 0) {
			// @ts-ignore
			console.log(`- Top similarity: ${searchResults.results[0].similarity}`);
			// @ts-ignore
			console.log(
				`- Top memory preview: ${searchResults.results[0].memory?.substring(0, 100)}...`,
			);
		}

		return true;
	} catch (error) {
		console.error(`Search failed:`, error);

		// Save error result
		const errorData = {
			metadata: {
				questionId,
				runId,
				containerTag,
				question,
				questionDate,
				questionType,
				groundTruthAnswer: answer,
				searchParams,
				timestamp: new Date().toISOString(),
			},
			error: error instanceof Error ? error.message : String(error),
		};

		writeFileSync(resultFilePath, JSON.stringify(errorData, null, 2));
		console.log(`\nError details saved to: ${resultFilePath}`);

		return false;
	}
};

// Run search
const success = await performSearch();
process.exit(success ? 0 : 1);
