import { createVertex } from "@ai-sdk/google-vertex";
import { embedMany } from "ai";
import { EMBEDDING_DIMENSION } from "./config";

/**
 * Generate embedding using Gemini Embedding 001 via Vertex AI
 * Uses gcloud application-default credentials for authentication
 * @param inputs - String or array of strings to embed
 * @returns Array of embedding vectors (3072 dimensions)
 */
export async function generateEmbeddings(
	inputs: string | string[],
): Promise<number[][]> {
	try {
		if (typeof inputs === "string") {
			inputs = [inputs];
		}

		// Get project from environment or gcloud config
		const project = process.env.GOOGLE_VERTEX_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
		if (!project) {
			throw new Error(
				"GOOGLE_VERTEX_PROJECT_ID or GOOGLE_CLOUD_PROJECT environment variable is required for Vertex AI"
			);
		}

		// Create Vertex AI instance with project and location
		const vertexAI = createVertex({
			project,
			location: "us-central1",
		});

		const { embeddings } = await embedMany({
			model: vertexAI.textEmbeddingModel("gemini-embedding-001"),
			values: inputs,
		});

		return embeddings;
	} catch (error) {
		console.error(error);
		throw new Error("Failed to generate embeddings");
	}
}
