import { findSimilarChunks } from "./db";
import { SEARCH_RESULTS } from "./utils/config";
import { generateEmbeddings } from "./utils/llm";

export const retrieve = async (query: string) => {
	const embeddings = await generateEmbeddings([query]);

	if (
		!embeddings ||
		embeddings.length === 0 ||
		!Array.isArray(embeddings[0])
	) {
		throw new Error("Failed to generate embeddings");
	}

	const similarChunks = await findSimilarChunks(embeddings[0], SEARCH_RESULTS);

	return similarChunks;
};
