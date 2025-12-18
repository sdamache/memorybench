export interface Config {
	apiKey: string;
	baseUrl: string;
	googleVertexProjectId: string;
}

export const config: Config = {
	apiKey: process.env.SUPERMEMORY_API_KEY || "",
	baseUrl: process.env.SUPERMEMORY_API_URL || "https://api.supermemory.ai",
	googleVertexProjectId: process.env.GOOGLE_VERTEX_PROJECT_ID || "",
};

export function validateConfig(required: (keyof Config)[]) {
	const missing = required.filter((key) => !config[key]);
	if (missing.length > 0) {
		console.error(
			`Missing required environment variables: ${missing.join(", ")}`,
		);
		process.exit(1);
	}
}
