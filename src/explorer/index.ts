import { join } from "node:path";
import { loadExplorerData, listAvailableRuns } from "./export";

/**
 * Starts the Results Explorer server.
 * Bundles the React frontend and serves it along with the run data.
 *
 * @param runId - Unique run identifier to explore
 * @param port - Port to run the server on (default: 3000)
 * @returns The Bun server instance
 */
export async function startExplorer(runId: string, port = 3000) {
	console.log(`Loading data for run: ${runId}...`);

	let currentRunId = runId;
	const noStoreHeaders = { "Cache-Control": "no-store" } as const;

	console.log("Bundling frontend...");
	const buildResult = await Bun.build({
		entrypoints: [join(import.meta.dir, "frontend.tsx")],
		minify: false,
		sourcemap: "inline",
	});

	if (!buildResult.success) {
		console.error("Build failed:");
		for (const message of buildResult.logs) {
			console.error(message);
		}
		throw new Error("Failed to bundle frontend");
	}

	const frontendJs = buildResult.outputs[0];

	const server = Bun.serve({
		port,
		async fetch(req) {
			const url = new URL(req.url);

			// API endpoint for current run data
			if (url.pathname === "/api/data") {
				try {
					const data = await loadExplorerData(currentRunId);
					return Response.json(data, { headers: noStoreHeaders });
				} catch (err) {
					const message = err instanceof Error ? err.message : "Unknown error";
					return Response.json({ error: message }, { status: 404, headers: noStoreHeaders });
				}
			}

			// API endpoint for listing available runs
			if (url.pathname === "/api/runs") {
				const runs = await listAvailableRuns();
				return Response.json(runs, { headers: noStoreHeaders });
			}

			// API endpoint for switching to a different run
			if (url.pathname.startsWith("/api/run/")) {
				const newRunId = url.pathname.replace("/api/run/", "");
				try {
					await loadExplorerData(newRunId);
					currentRunId = newRunId;
					return Response.json({ success: true, run_id: newRunId }, { headers: noStoreHeaders });
				} catch (err) {
					const message = err instanceof Error ? err.message : "Unknown error";
					return Response.json({ success: false, error: message }, { status: 404, headers: noStoreHeaders });
				}
			}

			// Serve static assets
			if (url.pathname === "/" || url.pathname === "/index.html") {
				return new Response(Bun.file(join(import.meta.dir, "index.html")), {
					headers: { "Content-Type": "text/html; charset=utf-8", ...noStoreHeaders },
				});
			}

			if (url.pathname === "/styles.css") {
				return new Response(Bun.file(join(import.meta.dir, "styles.css")), {
					headers: { "Content-Type": "text/css; charset=utf-8", ...noStoreHeaders },
				});
			}

			if (url.pathname === "/frontend.js") {
				return new Response(frontendJs, {
					headers: { "Content-Type": "text/javascript; charset=utf-8", ...noStoreHeaders },
				});
			}

			return new Response("Not Found", { status: 404 });
		},
	});

	console.log(`\n🚀 Explorer running at http://localhost:${server.port}`);
	console.log("Press Ctrl+C to stop.\n");

	return server;
}
