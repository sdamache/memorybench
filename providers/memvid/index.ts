import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { use } from "@memvid/sdk";
import type { FindInput, Memvid } from "@memvid/sdk";
import type {
	MemoryRecord,
	ProviderCapabilities,
	RetrievalItem,
	ScopeContext,
} from "../../types/core";
import type { BaseProvider } from "../../types/provider";

const STORAGE_DIR = join(process.cwd(), "checkpoints", "memvid");

type HandleEntry = {
	mv: Memvid;
	path: string;
	metadataByUri: Map<string, Record<string, unknown>>;
};

type FindResult = Awaited<ReturnType<Memvid["find"]>>;

const handles = new Map<string, HandleEntry>();

function getScopeTag(scope: ScopeContext): string {
	const sanitize = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_");

	const runPart = sanitize(scope.run_id).slice(0, 12);
	const sessionKey = scope.session_id ?? scope.namespace ?? "default";

	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(`${scope.user_id}|${scope.run_id}|${sessionKey}`);
	const scopeHash = hasher.digest("hex").slice(0, 12);

	return `memorybench_${runPart}_${scopeHash}`;
}

function getFindModeFromEnv(): FindInput["mode"] {
	const raw = process.env.MEMVID_FIND_MODE?.trim().toLowerCase();
	if (raw === "lex" || raw === "sem" || raw === "auto") return raw;
	return "lex";
}

function getSnippetCharsFromEnv(): number {
	const raw = process.env.MEMVID_SNIPPET_CHARS;
	if (!raw) return 4000;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 4000;
}

const MEMVID_STOPWORDS = new Set([
	"a",
	"an",
	"and",
	"are",
	"as",
	"at",
	"be",
	"been",
	"but",
	"by",
	"did",
	"do",
	"does",
	"for",
	"from",
	"go",
	"had",
	"has",
	"have",
	"he",
	"her",
	"his",
	"how",
	"i",
	"if",
	"in",
	"into",
	"is",
	"it",
	"its",
	"me",
	"my",
	"no",
	"not",
	"of",
	"on",
	"or",
	"our",
	"she",
	"so",
	"that",
	"the",
	"their",
	"them",
	"then",
	"there",
	"they",
	"this",
	"to",
	"was",
	"we",
	"were",
	"what",
	"when",
	"where",
	"which",
	"who",
	"why",
	"with",
	"you",
	"your",
]);

function rewriteQueryForMemvidLex(
	query: string,
	options: { force?: boolean } = {},
): string {
	if (!query.trim()) return query;

	// If caller already uses explicit operators, assume they know what they're doing.
	if (!options.force && /\b(AND|OR|NOT)\b/.test(query)) return query;

	// Memvid's Tantivy query parser uses AND semantics by default. For natural-language
	// questions (LoCoMo/LongMemEval), rewrite to an OR query over non-stopword tokens.
	const tokens = query.match(/[A-Za-z0-9_]+/g) ?? [];
	const filtered = tokens
		.map((t) => t.trim())
		.filter((t) => t.length > 0)
		.filter((t) => !MEMVID_STOPWORDS.has(t.toLowerCase()));

	const unique: string[] = [];
	const seen = new Set<string>();
	for (const token of filtered) {
		const key = token.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		unique.push(token);
	}

	if (unique.length === 0) return query;
	return unique.join(" OR ");
}

async function getOrCreateHandle(scope: ScopeContext): Promise<HandleEntry> {
	const tag = getScopeTag(scope);
	const cached = handles.get(tag);
	if (cached) return cached;

	await mkdir(STORAGE_DIR, { recursive: true });
	const filePath = join(STORAGE_DIR, `${tag}.mv2`);

	// Create is safest for benchmark isolation: each case gets a clean, empty file.
	const mv = await use("basic", filePath, {
		mode: "create",
		enableLex: true,
		enableVec: false,
	});

	const entry: HandleEntry = { mv, path: filePath, metadataByUri: new Map() };
	handles.set(tag, entry);
	return entry;
}

async function getHandleIfExists(
	scope: ScopeContext,
): Promise<HandleEntry | null> {
	const tag = getScopeTag(scope);
	const cached = handles.get(tag);
	if (cached) return cached;

	const filePath = join(STORAGE_DIR, `${tag}.mv2`);
	const file = Bun.file(filePath);
	if (!(await file.exists())) return null;

	await mkdir(STORAGE_DIR, { recursive: true });
	const mv = await use("basic", filePath, {
		mode: "open",
		enableLex: true,
		enableVec: false,
	});

	const entry: HandleEntry = { mv, path: filePath, metadataByUri: new Map() };
	handles.set(tag, entry);
	return entry;
}

async function closeHandle(scope: ScopeContext): Promise<void> {
	const tag = getScopeTag(scope);
	const cached = handles.get(tag);
	if (!cached) return;

	try {
		await cached.mv.seal();
	} finally {
		handles.delete(tag);
	}
}

async function deleteFiles(filePath: string): Promise<void> {
	await rm(filePath, { force: true }).catch(() => {});
	await rm(`${filePath}.lock`, { force: true }).catch(() => {});
}

const memvidProvider: BaseProvider = {
	name: "memvid",

	async add_memory(
		scope: ScopeContext,
		content: string,
		metadata?: Record<string, unknown>,
	): Promise<MemoryRecord> {
		const { mv, metadataByUri } = await getOrCreateHandle(scope);

		const sessionId =
			typeof metadata?._sessionId === "string"
				? metadata._sessionId
				: undefined;

		const uri = `memorybench://${getScopeTag(scope)}/${crypto.randomUUID()}`;

		await mv.put({
			title: sessionId ? `Session ${sessionId}` : "MemoryBench",
			label: "memorybench",
			text: content,
			metadata: metadata ?? {},
			uri,
		});

		metadataByUri.set(uri, metadata ?? {});

		return {
			id: uri,
			context: content,
			metadata: metadata ?? {},
			timestamp: Date.now(),
		};
	},

	async retrieve_memory(
		scope: ScopeContext,
		query: string,
		limit = 10,
	): Promise<RetrievalItem[]> {
		const entry = await getHandleIfExists(scope);
		if (!entry) return [];

		const { mv } = entry;
		const findMode = getFindModeFromEnv();
		const snippetChars = getSnippetCharsFromEnv();

		const runFind = async (
			q: string,
			mode: FindInput["mode"],
		): Promise<FindResult> => {
			return await mv.find(q, {
				mode,
				k: limit,
				snippetChars,
			});
		};

		const tryFind = async (
			q: string,
			mode: FindInput["mode"],
		): Promise<FindResult | null> => {
			try {
				return await runFind(q, mode);
			} catch {
				return null;
			}
		};

		const rawQuery = query;
		// Memvid's Tantivy parser treats quotes as syntax. LoCoMo questions sometimes
		// contain unbalanced quotes, which causes hard errors. Prefer a safe rewrite
		// for any query containing quotes.
		const needsForcedRewrite = /["'`]/.test(rawQuery);
		const initialQuery = needsForcedRewrite
			? rewriteQueryForMemvidLex(rawQuery, { force: true })
			: rawQuery;

		let res: FindResult | null = await tryFind(initialQuery, findMode);

		// If the configured mode errors (e.g., invalid query syntax), fall back to lex.
		if (!res && findMode !== "lex") {
			res = await tryFind(initialQuery, "lex");
		}

		// If the query still errors (common with unbalanced quotes), force-rewrite into
		// Memvid-friendly OR syntax and retry.
		if (!res) {
			const forced = rewriteQueryForMemvidLex(rawQuery, { force: true });
			res = await tryFind(forced, findMode);
			if (!res && findMode !== "lex") {
				res = await tryFind(forced, "lex");
			}
		}

		if (!res) return [];

		// If the configured mode yields no hits (common when mode=sem/auto without embeddings),
		// fall back to lexical search to avoid false negatives in benchmarks.
		if (res.hits.length === 0 && findMode !== "lex") {
			const lex = await tryFind(initialQuery, "lex");
			if (lex) {
				res = lex;
			}
		}

		// If we still got no hits, rewrite the query into Memvid-friendly OR syntax.
		// Example: "When did Caroline go to the LGBTQ support group?" ->
		// "Caroline OR LGBTQ OR support OR group"
		if (res.hits.length === 0) {
			const rewritten = rewriteQueryForMemvidLex(rawQuery);
			if (rewritten !== query) {
				const rewrittenRes =
					(await tryFind(rewritten, findMode)) ??
					(findMode !== "lex" ? await tryFind(rewritten, "lex") : null);
				if (rewrittenRes) {
					res = rewrittenRes;
				}
			}
		}

		const maxScore = res.hits.reduce((max, hit) => Math.max(max, hit.score), 0);

		const results: RetrievalItem[] = [];
		for (const hit of res.hits.slice(0, limit)) {
			const storedMeta = entry.metadataByUri.get(hit.uri) ?? {};
			const metadata: Record<string, unknown> = {
				...storedMeta,
				_memvid: {
					frame_id: hit.frame_id,
					uri: hit.uri,
					title: hit.title,
					tags: hit.tags,
					labels: hit.labels,
				},
			};

			const ts = Number.isFinite(Date.parse(hit.created_at))
				? Date.parse(hit.created_at)
				: Date.now();

			results.push({
				record: {
					id: hit.uri,
					context: hit.snippet,
					metadata,
					timestamp: ts,
				},
				score: maxScore > 0 ? hit.score / maxScore : 0,
				match_context: hit.snippet,
			});
		}

		return results;
	},

	async delete_memory(
		scope: ScopeContext,
		_memory_id: string,
	): Promise<boolean> {
		// Memvid frames are append-only; treat deletes as scope resets for benchmark cleanup.
		if (!this.reset_scope) return false;
		try {
			return await this.reset_scope(scope);
		} catch {
			return false;
		}
	},

	async reset_scope(scope: ScopeContext): Promise<boolean> {
		const tag = getScopeTag(scope);
		const filePath = join(STORAGE_DIR, `${tag}.mv2`);

		await closeHandle(scope).catch(() => {});
		await deleteFiles(filePath);
		return true;
	},

	async get_capabilities(): Promise<ProviderCapabilities> {
		return {
			core_operations: {
				add_memory: true,
				retrieve_memory: true,
				delete_memory: true,
			},
			optional_operations: {
				update_memory: false,
				list_memories: false,
				reset_scope: true,
				get_capabilities: true,
			},
			system_flags: {
				async_indexing: false,
				convergence_wait_ms: 0,
			},
			intelligence_flags: {
				auto_extraction: true,
				graph_support: true,
				graph_type: "knowledge",
			},
		};
	},
};

export default memvidProvider;
