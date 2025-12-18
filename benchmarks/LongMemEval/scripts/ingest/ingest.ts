/*
Ingestion script for LongMemEval questions.
Ingests haystack sessions for a specific question with checkpoint support.
*/

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { type CheckpointData, CheckpointManager } from "../utils/checkpoint.ts";
import { config, validateConfig } from "../utils/config.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

validateConfig(["apiKey", "baseUrl"]);

// Get command line arguments
const args = process.argv.slice(2);
if (args.length < 2) {
	console.error("Usage: bun run ingest.ts <questionId> <runId>");
	process.exit(1);
}

const questionId = args[0]!;
const runId = args[1]!; // Renamed from randomString
const containerTag = `${questionId}-${runId}`;

console.log(`Question ID: ${questionId}`);
console.log(`Container Tag: ${containerTag}`);

// Read the question data
const questionFilePath = join(
	__dirname,
	"../../datasets/questions",
	`${questionId}.json`,
);
try {
	if (!require("fs").existsSync(questionFilePath)) {
		// Check existence before reading
		console.error(`Error: Question file not found at ${questionFilePath}`);
		process.exit(1);
	}
} catch (e) {
	// Ignore error if fs.existsSync fails, though it shouldn't
}

const data = JSON.parse(readFileSync(questionFilePath, "utf8"));
const haystackDates = data.haystack_dates;
const haystackSessions = data.haystack_sessions;

// Setup checkpoint manager
const checkpointManager = new CheckpointManager(
	join(__dirname, "../../checkpoints"),
);
const checkpoint: CheckpointData = checkpointManager.loadCheckpoint(
	questionId,
	runId,
) || {
	questionId,
	runId,
	containerTag,
	sessions: [],
};

if (checkpoint.sessions.length === 0) {
	console.log(`Creating new checkpoint`);

	// Initialize all sessions as not ingested
	const numberOfSessions = Math.min(
		haystackDates.length,
		haystackSessions.length,
	);
	for (let i = 0; i < numberOfSessions; i++) {
		checkpoint.sessions.push({
			index: i,
			date: haystackDates[i],
			ingested: false,
		});
	}
} else {
	console.log(`Loading existing checkpoint`);
}

// Ingest each session
const ingestSessions = async () => {
	// checkpoint is guaranteed to be initialized now

	const numberOfSessions = checkpoint.sessions.length;
	console.log(`\nIngesting ${numberOfSessions} sessions...`);

	for (let i = 0; i < numberOfSessions; i++) {
		const session = checkpoint.sessions[i];
		if (!session) continue;

		if (session.ingested) {
			console.log(
				`Session ${i + 1}/${numberOfSessions}: Already ingested, skipping`,
			);
			continue;
		}

		try {
			// Format the haystack date and session into a single string
			// Escape HTML tags and defang URLs to prevent auto-detection issues
			const sessionStr = JSON.stringify(haystackSessions[i])
				.replace(/</g, "&lt;") // Escape < to prevent HTML detection
				.replace(/>/g, "&gt;"); // Escape > to prevent HTML detection

			const haystack = `Here is the date the following session took place: ${JSON.stringify(haystackDates[i])}

Here is the session as a stringified JSON:
${sessionStr}
`;

			// Log content size for debugging
			const contentSize = new TextEncoder().encode(haystack).length;
			if (contentSize > 100000) {
				console.log(`  (Large session: ${(contentSize / 1024).toFixed(1)}KB)`);
			}

			// Ingest the haystack session into Supermemory
			const response = await fetch(`${config.baseUrl}/v3/documents`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${config.apiKey}`,
				},
				body: JSON.stringify({
					content: haystack,
					containerTags: [containerTag],
				}),
			});

			if (!response.ok) {
				let errorDetails = `status: ${response.status}`;
				try {
					const errorBody = await response.text();
					if (errorBody) {
						errorDetails += ` - ${errorBody.substring(0, 200)}`;
					}
				} catch (e) {
					// Ignore if we can't read the error body
				}
				throw new Error(`HTTP error! ${errorDetails}`);
			}

			// Mark as successfully ingested
			session.ingested = true;
			session.timestamp = new Date().toISOString();
			console.log(
				`Session ${i + 1}/${numberOfSessions}: Successfully ingested`,
			);
		} catch (error) {
			session.error = error instanceof Error ? error.message : String(error);
			console.error(
				`Session ${i + 1}/${numberOfSessions}: Failed - ${session.error}`,
			);

			// Save checkpoint and exit immediately on error
			checkpointManager.saveCheckpoint(checkpoint);
			console.error(
				`\nStopping ingestion due to error. Fix the issue and re-run to resume.`,
			);
			process.exit(1);
		}

		// Save checkpoint after each session
		checkpointManager.saveCheckpoint(checkpoint);

		// Wait 10 seconds before next session (except for the last one)
		if (i < numberOfSessions - 1) {
			await new Promise((resolve) => setTimeout(resolve, 10000));
		}
	}

	const successCount = checkpoint.sessions.filter((s) => s.ingested).length;
	console.log(
		`\nIngestion complete: ${successCount}/${numberOfSessions} sessions successfully ingested`,
	);
};

// Run ingestion
await ingestSessions();
