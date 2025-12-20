/**
 * Dashboard Server
 *
 * Serves the benchmark comparison dashboard using Bun.serve.
 * Run with: bun run dashboard/server.ts
 *
 * @module dashboard/server
 */

import index from "./index.html";

const PORT = Number(process.env.PORT) || 3000;

const server = Bun.serve({
	port: PORT,
	routes: {
		"/": index,
		"/data/run_manifest.json": async () => {
			const file = Bun.file("./dashboard/data/run_manifest.json");
			return new Response(file, {
				headers: { "Content-Type": "application/json" },
			});
		},
		"/data/results.json": async () => {
			const file = Bun.file("./dashboard/data/results.json");
			return new Response(file, {
				headers: { "Content-Type": "application/json" },
			});
		},
	},
	development: {
		hmr: true,
		console: true,
	},
});

console.log(`Dashboard server running at http://localhost:${server.port}`);
console.log(`Press Ctrl+C to stop`);
