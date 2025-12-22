/**
 * BM25 (Best Matching 25) scoring algorithm for lexical retrieval.
 * Used by LocalBaseline provider for deterministic, zero-dependency text matching.
 *
 * BM25 is an industry-standard probabilistic ranking function that considers:
 * - Term frequency (TF): How often a term appears in a document
 * - Inverse document frequency (IDF): How rare a term is across all documents
 * - Document length normalization: Adjusts for varying document lengths
 */

// Standard BM25 parameters (empirically optimal for most use cases)
const K1 = 1.5; // Term frequency saturation parameter
const B = 0.75; // Document length normalization parameter

/**
 * Tokenize text into lowercase words, removing punctuation.
 * @param text - Input text to tokenize
 * @returns Array of lowercase tokens (words with length > 1)
 */
export function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^\w\s]/g, " ") // Replace punctuation with spaces
		.split(/\s+/) // Split on whitespace
		.filter((token) => token.length > 1); // Remove single characters
}

/**
 * Compute term frequency map for a list of tokens.
 * @param tokens - Array of tokens
 * @returns Map of term -> frequency count
 */
export function termFreq(tokens: string[]): Map<string, number> {
	const freq = new Map<string, number>();
	for (const token of tokens) {
		freq.set(token, (freq.get(token) || 0) + 1);
	}
	return freq;
}

/**
 * Compute Inverse Document Frequency (IDF) for a term.
 * Uses the smoothed IDF formula: log((N - df + 0.5) / (df + 0.5) + 1)
 * @param term - The term to compute IDF for
 * @param allDocTokens - Array of tokenized documents (each doc is string[])
 * @returns IDF score (higher = rarer term)
 */
export function idf(term: string, allDocTokens: string[][]): number {
	const N = allDocTokens.length;
	if (N === 0) return 0;

	const docsWithTerm = allDocTokens.filter((docTokens) =>
		docTokens.includes(term),
	).length;

	if (docsWithTerm === 0) return 0;

	// Smoothed IDF formula
	return Math.log((N - docsWithTerm + 0.5) / (docsWithTerm + 0.5) + 1);
}

/**
 * Compute average document length across all documents.
 * @param allDocTokens - Array of tokenized documents
 * @returns Average number of tokens per document
 */
export function avgDocLength(allDocTokens: string[][]): number {
	if (allDocTokens.length === 0) return 0;
	const totalTokens = allDocTokens.reduce((sum, doc) => sum + doc.length, 0);
	return totalTokens / allDocTokens.length;
}

/**
 * Compute BM25 score for a query against a single document.
 * @param queryTokens - Tokenized query
 * @param docTokens - Tokenized document
 * @param allDocTokens - All documents in corpus (for IDF calculation)
 * @param avgDl - Average document length (precomputed for efficiency)
 * @returns BM25 score (higher = more relevant)
 */
export function bm25Score(
	queryTokens: string[],
	docTokens: string[],
	allDocTokens: string[][],
	avgDl: number,
): number {
	// Guard against division by zero (e.g., all documents tokenize to [])
	if (avgDl <= 0) {
		return 0;
	}

	const docFreq = termFreq(docTokens);
	const docLen = docTokens.length;

	let score = 0;
	for (const term of queryTokens) {
		const tf = docFreq.get(term) || 0;
		if (tf === 0) continue;

		const idfScore = idf(term, allDocTokens);
		const numerator = tf * (K1 + 1);
		const denominator = tf + K1 * (1 - B + B * (docLen / avgDl));
		score += idfScore * (numerator / denominator);
	}

	return score;
}

/**
 * Rank documents by BM25 relevance to a query.
 * @param query - Search query string
 * @param documents - Array of document strings to search
 * @returns Array of {index, score} sorted by score descending
 */
export function rankDocuments(
	query: string,
	documents: string[],
): Array<{ index: number; score: number }> {
	const queryTokens = tokenize(query);
	const allDocTokens = documents.map(tokenize);
	const avgDl = avgDocLength(allDocTokens);

	const scores = allDocTokens.map((docTokens, index) => ({
		index,
		score: bm25Score(queryTokens, docTokens, allDocTokens, avgDl),
	}));

	// Sort by score descending
	return scores.sort((a, b) => b.score - a.score);
}
