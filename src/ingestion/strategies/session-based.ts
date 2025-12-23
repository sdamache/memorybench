/**
 * Session-Based Ingestion Strategy
 *
 * Ingests data session-by-session with configurable modes:
 * - lazy: Only answer sessions (for dev testing)
 * - shared: Sample of sessions + answer sessions (for demo)
 * - full: All sessions (for production)
 *
 * Supports two session formats:
 * - "array": Sessions are in an array field (LongMemEval style)
 * - "dynamic_keys": Sessions are in dynamic keys like session_1, session_2 (LoCoMo style)
 *
 * Extracted from: benchmarks/LongMemEval/ingestion.ts
 *
 * @module src/ingestion/strategies/session-based
 * @see specs/006-benchmark-interface/data-driven-benchmark-design.md
 */

import type {
	IngestionContext,
	IngestionResult,
	IngestionStrategy,
	Message,
	SessionBasedConfig,
} from "../types";
import { formatConversation } from "../types";

/**
 * Default configuration for session-based ingestion
 */
const DEFAULT_CONFIG: Partial<SessionBasedConfig> = {
	mode: "full",
	sharedSampleSize: 10,
	contentFormatter: "conversation",
	sessionsFormat: "array",
	sessionKeyPrefix: "session_",
	dateKeySuffix: "_date_time",
	evidenceParser: "direct",
	dialogueContentFormatter: "speaker_text",
};

/**
 * LoCoMo dialogue turn format
 */
interface DialogueTurn {
	speaker: string;
	dia_id: string;
	text: string;
	img_url?: string[];
}

/**
 * Extract sessions from dynamic keys (LoCoMo format)
 *
 * Converts { session_1: [...], session_1_date_time: "...", session_2: [...] }
 * into arrays of sessions, session IDs, and dates
 */
function extractDynamicSessions(
	conversationObj: Record<string, unknown>,
	config: SessionBasedConfig,
): { sessions: unknown[]; sessionIds: string[]; dates: string[] } {
	const prefix = config.sessionKeyPrefix ?? "session_";
	const dateSuffix = config.dateKeySuffix ?? "_date_time";

	// Find all session keys (session_1, session_2, etc.)
	const sessionKeyPattern = new RegExp(`^${prefix}\\d+$`);
	const sessionKeys = Object.keys(conversationObj)
		.filter((k) => sessionKeyPattern.test(k))
		.sort((a, b) => {
			const numA = Number.parseInt(a.replace(prefix, ""));
			const numB = Number.parseInt(b.replace(prefix, ""));
			return numA - numB;
		});

	const sessions: unknown[] = [];
	const sessionIds: string[] = [];
	const dates: string[] = [];

	for (const key of sessionKeys) {
		const num = key.replace(prefix, "");
		const sessionData = conversationObj[key];
		const dateValue = conversationObj[key + dateSuffix] as string | undefined;

		if (Array.isArray(sessionData)) {
			sessions.push(sessionData);
			sessionIds.push(`D${num}`); // Generate ID like D1, D2, etc.
			dates.push(dateValue ?? "");
		}
	}

	return { sessions, sessionIds, dates };
}

/**
 * Parse evidence references to session IDs
 *
 * Handles formats like:
 * - "D1:3" -> "D1"
 * - "D1:3; D2:5" -> ["D1", "D2"]
 */
function parseEvidenceToSessionIds(
	evidence: unknown[],
	parser: "direct" | "dialog_refs",
): string[] {
	if (parser === "direct") {
		// Evidence is already session IDs
		return evidence.filter((e) => typeof e === "string") as string[];
	}

	// Parse dialog_refs format (e.g., "D1:3" -> "D1")
	const sessionIds = new Set<string>();

	for (const e of evidence) {
		if (typeof e !== "string") continue;

		// Handle both "D1:3" and "D1:3; D2:5" formats
		const parts = e.split(";").map((p) => p.trim());
		for (const part of parts) {
			const match = part.match(/^D(\d+):/);
			if (match) {
				sessionIds.add(`D${match[1]}`);
			}
		}
	}

	return Array.from(sessionIds);
}

/**
 * Format dialogue turns to Message[] format
 */
function formatDialogueTurns(
	turns: DialogueTurn[],
	speakerA: string,
	formatter: "speaker_text" | "role_content",
): Message[] {
	return turns.map((turn) => ({
		role: turn.speaker === speakerA ? "user" : "assistant",
		content:
			formatter === "speaker_text"
				? `${turn.speaker}: ${turn.text}`
				: turn.text,
	}));
}

/**
 * Select a distributed sample of indices
 * Ensures even distribution across the array
 */
function selectDistributedSample(
	totalCount: number,
	sampleSize: number,
): number[] {
	if (sampleSize >= totalCount) {
		return Array.from({ length: totalCount }, (_, i) => i);
	}

	const step = totalCount / sampleSize;
	const indices: number[] = [];

	for (let i = 0; i < sampleSize; i++) {
		const index = Math.floor(i * step);
		if (!indices.includes(index)) {
			indices.push(index);
		}
	}

	return indices;
}

/**
 * Determine which session indices to ingest based on mode
 */
function getSessionIndicesToIngest(
	sessions: unknown[],
	sessionIds: string[] | undefined,
	answerSessionIds: string[] | undefined,
	mode: SessionBasedConfig["mode"],
	sharedSampleSize: number,
): number[] {
	const totalSessions = sessions.length;

	switch (mode) {
		case "lazy": {
			// Only ingest sessions that contain the answer
			if (!answerSessionIds || !sessionIds) {
				return [0]; // Default to first session if no answer info
			}

			const answerIndices: number[] = [];
			for (let idx = 0; idx < sessionIds.length; idx++) {
				const sessionId = sessionIds[idx];
				if (sessionId && answerSessionIds.includes(sessionId)) {
					answerIndices.push(idx);
				}
			}
			return answerIndices.length > 0 ? answerIndices : [0];
		}

		case "shared": {
			// Ingest a sample of sessions including answer sessions
			const answerIndices = new Set<number>();

			if (answerSessionIds && sessionIds) {
				for (let idx = 0; idx < sessionIds.length; idx++) {
					const sessionId = sessionIds[idx];
					if (sessionId && answerSessionIds.includes(sessionId)) {
						answerIndices.add(idx);
					}
				}
			}

			// Get distributed sample of remaining indices
			const remainingSampleSize = Math.max(sharedSampleSize - answerIndices.size, 5);
			const sampleIndices = selectDistributedSample(totalSessions, remainingSampleSize);

			// Combine answer indices with sample
			const combined = new Set([...answerIndices, ...sampleIndices]);
			return Array.from(combined).sort((a, b) => a - b);
		}

		case "full":
		default: {
			// Ingest all sessions
			return Array.from({ length: totalSessions }, (_, i) => i);
		}
	}
}

/**
 * Get convergence wait time from provider if available
 */
async function getConvergenceWaitMs(
	provider: IngestionContext["provider"],
): Promise<number> {
	if (provider.get_capabilities) {
		try {
			const capabilities = await provider.get_capabilities();
			return capabilities?.system_flags?.convergence_wait_ms ?? 0;
		} catch {
			return 0;
		}
	}
	return 0;
}

/**
 * Create a session-based ingestion strategy
 *
 * @param config - Configuration for session-based ingestion
 * @returns Ingestion strategy implementation
 *
 * @example
 * ```typescript
 * const strategy = createSessionBasedIngestion({
 *   sessionsField: "haystack_sessions",
 *   sessionIdsField: "haystack_session_ids",
 *   datesField: "haystack_dates",
 *   answerSessionIdsField: "answer_session_ids",
 *   mode: "full"
 * });
 *
 * const result = await strategy.ingest({
 *   provider,
 *   scope,
 *   input: {
 *     haystack_sessions: [[{role: "user", content: "..."}, ...]],
 *     haystack_session_ids: ["s1", "s2", ...],
 *     haystack_dates: ["2024-01-01", ...],
 *     answer_session_ids: ["s5"]
 *   }
 * });
 * ```
 */
export function createSessionBasedIngestion(
	config: SessionBasedConfig,
): IngestionStrategy {
	const mergedConfig = { ...DEFAULT_CONFIG, ...config };

	return {
		name: "session-based",

		async ingest(context: IngestionContext): Promise<IngestionResult> {
			const { provider, scope, input, metadata: extraMetadata } = context;
			const ingestedIds: string[] = [];
			const errors: string[] = [];

			let sessions: unknown[];
			let sessionIds: string[] | undefined;
			let dates: string[] | undefined;
			let answerSessionIds: string[] | undefined;
			let speakerA: string | undefined;

			// Handle different session formats
			if (mergedConfig.sessionsFormat === "dynamic_keys") {
				// LoCoMo-style: sessions are in dynamic keys like session_1, session_2
				const conversationObj = input[mergedConfig.sessionsField] as
					| Record<string, unknown>
					| undefined;

				if (!conversationObj || typeof conversationObj !== "object") {
					return {
						ingestedIds: [],
						ingestedCount: 0,
						skippedCount: 0,
						totalCount: 0,
						errors: [
							`Sessions field '${mergedConfig.sessionsField}' not found or not an object`,
						],
					};
				}

				// Extract sessions from dynamic keys
				const extracted = extractDynamicSessions(conversationObj, mergedConfig);
				sessions = extracted.sessions;
				sessionIds = extracted.sessionIds;
				dates = extracted.dates;
				speakerA = conversationObj.speaker_a as string | undefined;

				// Get answer session IDs from evidence field if configured
				if (mergedConfig.evidenceField) {
					const evidence = input[mergedConfig.evidenceField] as unknown[] | undefined;
					if (evidence && Array.isArray(evidence)) {
						answerSessionIds = parseEvidenceToSessionIds(
							evidence,
							mergedConfig.evidenceParser ?? "direct",
						);
					}
				} else if (mergedConfig.answerSessionIdsField) {
					answerSessionIds = input[mergedConfig.answerSessionIdsField] as
						| string[]
						| undefined;
				}
				} else {
					// Array format (LongMemEval-style)
					const rawSessions = input[mergedConfig.sessionsField] as unknown;
					if (!Array.isArray(rawSessions)) {
						return {
							ingestedIds: [],
							ingestedCount: 0,
							skippedCount: 0,
							totalCount: 0,
							errors: [
								`Sessions field '${mergedConfig.sessionsField}' not found or not an array`,
							],
						};
					}
					sessions = rawSessions;

					sessionIds = mergedConfig.sessionIdsField
						? (input[mergedConfig.sessionIdsField] as string[] | undefined)
						: undefined;
				dates = mergedConfig.datesField
					? (input[mergedConfig.datesField] as string[] | undefined)
					: undefined;
				answerSessionIds = mergedConfig.answerSessionIdsField
					? (input[mergedConfig.answerSessionIdsField] as string[] | undefined)
					: undefined;
			}

			const totalSessions = sessions.length;

			if (totalSessions === 0) {
				return {
					ingestedIds: [],
					ingestedCount: 0,
					skippedCount: 0,
					totalCount: 0,
					errors: ["No sessions found to ingest"],
				};
			}

			// Determine which sessions to ingest
			const indicesToIngest = getSessionIndicesToIngest(
				sessions,
				sessionIds,
				answerSessionIds,
				mergedConfig.mode,
				mergedConfig.sharedSampleSize ?? 10,
			);

			// Ingest selected sessions
			for (const idx of indicesToIngest) {
				const session = sessions[idx];
				const sessionId = sessionIds?.[idx];
				const sessionDate = dates?.[idx];

				if (!session) {
					continue;
				}

				// Format session content
				let content: string;
				if (mergedConfig.contentFormatter === "conversation") {
					// Check if this is LoCoMo dialogue format (has speaker/text) or standard Message format
					const firstTurn = Array.isArray(session) ? session[0] : null;
					const isDialogueFormat =
						firstTurn && "speaker" in firstTurn && "text" in firstTurn;

					if (isDialogueFormat && speakerA) {
						// LoCoMo format: convert DialogueTurn[] to Message[]
						const messages = formatDialogueTurns(
							session as DialogueTurn[],
							speakerA,
							mergedConfig.dialogueContentFormatter ?? "speaker_text",
						);
						content = formatConversation(messages, sessionId, sessionDate);
					} else {
						// Standard Message[] format
						const messages = session as Message[];
						content = formatConversation(messages, sessionId, sessionDate);
					}
				} else {
					content =
						typeof session === "string" ? session : JSON.stringify(session);
				}

				try {
					const record = await provider.add_memory(scope, content, {
						...extraMetadata,
						_sessionId: sessionId,
						_sessionDate: sessionDate,
						_sessionIndex: idx,
					});
					ingestedIds.push(record.id);
				} catch (error) {
					errors.push(
						`Failed to ingest session ${sessionId ?? idx}: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			}

			// Respect provider convergence time if specified
			const convergenceWaitMs = await getConvergenceWaitMs(provider);
			if (convergenceWaitMs > 0) {
				await new Promise((resolve) => setTimeout(resolve, convergenceWaitMs));
			}

			return {
				ingestedIds,
				ingestedCount: ingestedIds.length,
				skippedCount: totalSessions - indicesToIngest.length,
				totalCount: totalSessions,
				errors: errors.length > 0 ? errors : undefined,
			};
		},
	};
}
