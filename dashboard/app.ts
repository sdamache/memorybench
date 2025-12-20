/**
 * Dashboard Application - Vanilla TypeScript
 *
 * A lightweight dashboard for comparing benchmark results across providers.
 * Uses vanilla DOM manipulation for zero external dependencies.
 */

import "./styles.css";

import type {
	RunManifest,
	BenchmarkResult,
	ProviderBenchmarkSummary,
	TestStatus,
} from "../types/results";

// =============================================================================
// Data Loading
// =============================================================================

async function loadDashboardData(): Promise<{
	manifest: RunManifest;
	results: BenchmarkResult[];
}> {
	const [manifestRes, resultsRes] = await Promise.all([
		fetch("/data/run_manifest.json"),
		fetch("/data/results.json"),
	]);

	const manifest = (await manifestRes.json()) as RunManifest;
	const results = (await resultsRes.json()) as BenchmarkResult[];

	return { manifest, results };
}

// =============================================================================
// State Management
// =============================================================================

interface DashboardState {
	manifest: RunManifest | null;
	results: BenchmarkResult[];
	selectedProvider: string;
	selectedBenchmark: string;
	selectedStatus: string;
	compSortKey: keyof ProviderBenchmarkSummary;
	compSortDir: "asc" | "desc";
	resultsSortKey: string;
	resultsSortDir: "asc" | "desc";
	expandedResultId: string | null;
}

const state: DashboardState = {
	manifest: null,
	results: [],
	selectedProvider: "",
	selectedBenchmark: "",
	selectedStatus: "",
	compSortKey: "pass_rate",
	compSortDir: "desc",
	resultsSortKey: "status",
	resultsSortDir: "asc",
	expandedResultId: null,
};

// =============================================================================
// Utility Functions
// =============================================================================

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	return `${(ms / 60000).toFixed(1)}m`;
}

function formatPercent(value: number): string {
	return `${value.toFixed(1)}%`;
}

function formatScore(value: number | undefined): string {
	if (value === undefined) return "-";
	return value.toFixed(2);
}

function getScoreClass(value: number | undefined): string {
	if (value === undefined) return "";
	if (value >= 0.8) return "good";
	if (value >= 0.6) return "medium";
	return "poor";
}

function getPassRateClass(rate: number): string {
	if (rate >= 80) return "high";
	if (rate >= 60) return "medium";
	return "low";
}

function escapeHtml(str: string): string {
	const div = document.createElement("div");
	div.textContent = str;
	return div.innerHTML;
}

// =============================================================================
// Compute Summaries
// =============================================================================

function computeSummaries(
	results: BenchmarkResult[],
): ProviderBenchmarkSummary[] {
	const groupedResults = new Map<string, BenchmarkResult[]>();

	for (const result of results) {
		const key = `${result.provider}:${result.benchmark}`;
		const existing = groupedResults.get(key) || [];
		existing.push(result);
		groupedResults.set(key, existing);
	}

	const summaries: ProviderBenchmarkSummary[] = [];

	for (const [key, group] of groupedResults) {
		const [provider, benchmark] = key.split(":");
		const passed = group.filter((r) => r.status === "passed").length;
		const failed = group.filter((r) => r.status === "failed").length;
		const skipped = group.filter((r) => r.status === "skipped").length;
		const errored = group.filter((r) => r.status === "errored").length;
		const total = group.length;

		const avgRetrievalLatency =
			group.reduce((sum, r) => sum + r.metrics.retrieval_latency_ms, 0) / total;
		const avgRelevance =
			group.reduce((sum, r) => sum + r.metrics.avg_relevance_score, 0) / total;

		const f1Scores = group
			.map((r) => r.metrics.f1_score)
			.filter((s): s is number => s !== undefined);
		const avgF1 =
			f1Scores.length > 0
				? f1Scores.reduce((a, b) => a + b, 0) / f1Scores.length
				: undefined;

		const exactMatches = group
			.map((r) => r.metrics.exact_match)
			.filter((s): s is number => s !== undefined);
		const avgExactMatch =
			exactMatches.length > 0
				? exactMatches.reduce((a, b) => a + b, 0) / exactMatches.length
				: undefined;

		const totalDuration = group.reduce((sum, r) => sum + r.duration_ms, 0);

		summaries.push({
			provider: provider!,
			benchmark: benchmark!,
			passed,
			failed,
			skipped,
			errored,
			total,
			pass_rate: (passed / total) * 100,
			avg_retrieval_latency_ms: avgRetrievalLatency,
			avg_relevance_score: avgRelevance,
			avg_f1_score: avgF1,
			avg_exact_match: avgExactMatch,
			total_duration_ms: totalDuration,
		});
	}

	return summaries;
}

// =============================================================================
// Filter and Sort
// =============================================================================

function getFilteredResults(): BenchmarkResult[] {
	return state.results.filter((r) => {
		if (state.selectedProvider && r.provider !== state.selectedProvider)
			return false;
		if (state.selectedBenchmark && r.benchmark !== state.selectedBenchmark)
			return false;
		if (state.selectedStatus && r.status !== state.selectedStatus) return false;
		return true;
	});
}

function getSortedSummaries(
	summaries: ProviderBenchmarkSummary[],
): ProviderBenchmarkSummary[] {
	return [...summaries].sort((a, b) => {
		const aVal = a[state.compSortKey];
		const bVal = b[state.compSortKey];
		if (typeof aVal === "number" && typeof bVal === "number") {
			return state.compSortDir === "asc" ? aVal - bVal : bVal - aVal;
		}
		const aStr = String(aVal ?? "");
		const bStr = String(bVal ?? "");
		return state.compSortDir === "asc"
			? aStr.localeCompare(bStr)
			: bStr.localeCompare(aStr);
	});
}

function getSortedResults(results: BenchmarkResult[]): BenchmarkResult[] {
	return [...results].sort((a, b) => {
		let aVal: unknown;
		let bVal: unknown;

		if (state.resultsSortKey === "metrics.avg_relevance_score") {
			aVal = a.metrics.avg_relevance_score;
			bVal = b.metrics.avg_relevance_score;
		} else if (state.resultsSortKey === "metrics.f1_score") {
			aVal = a.metrics.f1_score;
			bVal = b.metrics.f1_score;
		} else if (state.resultsSortKey in a) {
			aVal = a[state.resultsSortKey as keyof BenchmarkResult];
			bVal = b[state.resultsSortKey as keyof BenchmarkResult];
		}

		if (typeof aVal === "number" && typeof bVal === "number") {
			return state.resultsSortDir === "asc" ? aVal - bVal : bVal - aVal;
		}
		const aStr = String(aVal ?? "");
		const bStr = String(bVal ?? "");
		return state.resultsSortDir === "asc"
			? aStr.localeCompare(bStr)
			: bStr.localeCompare(aStr);
	});
}

// =============================================================================
// Render Functions
// =============================================================================

function renderHeader(): string {
	const manifest = state.manifest!;
	const startDate = new Date(manifest.started_at);

	return `
    <header class="header">
      <h1>
        <span>&#128202;</span>
        MemoryBench Dashboard
      </h1>
      <div class="run-info">
        <div class="run-info-item">
          <span>Run:</span>
          <strong>${escapeHtml(manifest.run_id)}</strong>
        </div>
        <div class="run-info-item">
          <span>Started:</span>
          <span>${startDate.toLocaleString()}</span>
        </div>
        ${
					manifest.summary
						? `
          <div class="run-info-item">
            <span>Duration:</span>
            <span>${formatDuration(manifest.summary.duration_ms)}</span>
          </div>
        `
						: ""
				}
        <span class="status-badge ${manifest.status}">${manifest.status}</span>
      </div>
    </header>
  `;
}

function renderSummaryCards(): string {
	const manifest = state.manifest!;
	const summary = manifest.summary;
	if (!summary) return "";

	const passRate = ((summary.passed / summary.total_items) * 100).toFixed(1);

	return `
    <div class="summary-cards">
      <div class="summary-card">
        <div class="summary-card-label">Total Tests</div>
        <div class="summary-card-value">${summary.total_items}</div>
        <div class="summary-card-sub">${manifest.providers.length} providers x ${manifest.benchmarks.length} benchmarks</div>
      </div>
      <div class="summary-card">
        <div class="summary-card-label">Passed</div>
        <div class="summary-card-value passed">${summary.passed}</div>
        <div class="summary-card-sub">${passRate}% pass rate</div>
      </div>
      <div class="summary-card">
        <div class="summary-card-label">Failed</div>
        <div class="summary-card-value failed">${summary.failed}</div>
        <div class="summary-card-sub">assertion failures</div>
      </div>
      <div class="summary-card">
        <div class="summary-card-label">Errored</div>
        <div class="summary-card-value errored">${summary.errored}</div>
        <div class="summary-card-sub">execution errors</div>
      </div>
      <div class="summary-card">
        <div class="summary-card-label">Duration</div>
        <div class="summary-card-value">${formatDuration(summary.duration_ms)}</div>
        <div class="summary-card-sub">total execution time</div>
      </div>
    </div>
  `;
}

function renderFilters(): string {
	const providers = [...new Set(state.results.map((r) => r.provider))];
	const benchmarks = [...new Set(state.results.map((r) => r.benchmark))];

	return `
    <div class="filters">
      <div class="filter-group">
        <label class="filter-label">Provider</label>
        <select class="filter-select" id="filter-provider">
          <option value="">All Providers</option>
          ${providers.map((p) => `<option value="${escapeHtml(p)}" ${state.selectedProvider === p ? "selected" : ""}>${escapeHtml(p)}</option>`).join("")}
        </select>
      </div>
      <div class="filter-group">
        <label class="filter-label">Benchmark</label>
        <select class="filter-select" id="filter-benchmark">
          <option value="">All Benchmarks</option>
          ${benchmarks.map((b) => `<option value="${escapeHtml(b)}" ${state.selectedBenchmark === b ? "selected" : ""}>${escapeHtml(b)}</option>`).join("")}
        </select>
      </div>
      <div class="filter-group">
        <label class="filter-label">Status</label>
        <select class="filter-select" id="filter-status">
          <option value="">All Statuses</option>
          <option value="passed" ${state.selectedStatus === "passed" ? "selected" : ""}>Passed</option>
          <option value="failed" ${state.selectedStatus === "failed" ? "selected" : ""}>Failed</option>
          <option value="errored" ${state.selectedStatus === "errored" ? "selected" : ""}>Errored</option>
          <option value="skipped" ${state.selectedStatus === "skipped" ? "selected" : ""}>Skipped</option>
        </select>
      </div>
    </div>
  `;
}

function getSortClass(key: string, currentKey: string, dir: string): string {
	if (key !== currentKey) return "sortable";
	return dir === "asc" ? "sorted-asc" : "sorted-desc";
}

function renderComparisonTable(summaries: ProviderBenchmarkSummary[]): string {
	const sorted = getSortedSummaries(summaries);

	return `
    <div class="comparison-section">
      <h2><span>&#128200;</span> Provider Comparison</h2>
      <table class="comparison-table">
        <thead>
          <tr>
            <th class="${getSortClass("provider", state.compSortKey, state.compSortDir)}" data-sort="provider">Provider</th>
            <th class="${getSortClass("benchmark", state.compSortKey, state.compSortDir)}" data-sort="benchmark">Benchmark</th>
            <th class="${getSortClass("pass_rate", state.compSortKey, state.compSortDir)}" data-sort="pass_rate">Pass Rate</th>
            <th class="${getSortClass("passed", state.compSortKey, state.compSortDir)}" data-sort="passed">P/F/E</th>
            <th class="${getSortClass("avg_relevance_score", state.compSortKey, state.compSortDir)}" data-sort="avg_relevance_score">Avg Relevance</th>
            <th class="${getSortClass("avg_f1_score", state.compSortKey, state.compSortDir)}" data-sort="avg_f1_score">Avg F1</th>
            <th class="${getSortClass("avg_retrieval_latency_ms", state.compSortKey, state.compSortDir)}" data-sort="avg_retrieval_latency_ms">Avg Latency</th>
            <th class="${getSortClass("total_duration_ms", state.compSortKey, state.compSortDir)}" data-sort="total_duration_ms">Total Time</th>
          </tr>
        </thead>
        <tbody>
          ${sorted
						.map(
							(s) => `
            <tr>
              <td><strong>${escapeHtml(s.provider)}</strong></td>
              <td>${escapeHtml(s.benchmark)}</td>
              <td>
                <div class="pass-rate">
                  <div class="pass-rate-bar">
                    <div class="pass-rate-fill ${getPassRateClass(s.pass_rate)}" style="width: ${s.pass_rate}%"></div>
                  </div>
                  <span>${formatPercent(s.pass_rate)}</span>
                </div>
              </td>
              <td>
                <span class="metric-value good">${s.passed}</span>/
                <span class="metric-value poor">${s.failed}</span>/
                <span class="metric-value medium">${s.errored}</span>
              </td>
              <td><span class="metric-value ${getScoreClass(s.avg_relevance_score)}">${formatScore(s.avg_relevance_score)}</span></td>
              <td><span class="metric-value ${getScoreClass(s.avg_f1_score)}">${formatScore(s.avg_f1_score)}</span></td>
              <td><span class="metric-value">${s.avg_retrieval_latency_ms.toFixed(0)}ms</span></td>
              <td><span class="metric-value">${formatDuration(s.total_duration_ms)}</span></td>
            </tr>
          `,
						)
						.join("")}
        </tbody>
      </table>
    </div>
  `;
}

function getStatusIcon(status: TestStatus): string {
	switch (status) {
		case "passed":
			return "&#10003;";
		case "failed":
			return "&#10007;";
		case "errored":
			return "&#9888;";
		case "skipped":
			return "&#8212;";
	}
}

function renderDrilldown(result: BenchmarkResult): string {
	return `
    <tr class="drilldown-row">
      <td colspan="8">
        <div class="drilldown-content">
          <div class="drilldown-grid">
            <div class="drilldown-section">
              <h4>Metrics</h4>
              <div class="drilldown-item">
                <span class="drilldown-label">Retrieval Count</span>
                <span class="drilldown-value">${result.metrics.retrieval_count}</span>
              </div>
              <div class="drilldown-item">
                <span class="drilldown-label">Relevance Score</span>
                <span class="drilldown-value">${formatScore(result.metrics.avg_relevance_score)}</span>
              </div>
              <div class="drilldown-item">
                <span class="drilldown-label">Retrieval Latency</span>
                <span class="drilldown-value">${result.metrics.retrieval_latency_ms}ms</span>
              </div>
              ${
								result.metrics.generation_latency_ms !== undefined
									? `
              <div class="drilldown-item">
                <span class="drilldown-label">Generation Latency</span>
                <span class="drilldown-value">${result.metrics.generation_latency_ms}ms</span>
              </div>
              `
									: ""
							}
              ${
								result.metrics.precision_at_k !== undefined
									? `
              <div class="drilldown-item">
                <span class="drilldown-label">Precision@K</span>
                <span class="drilldown-value">${formatScore(result.metrics.precision_at_k)}</span>
              </div>
              `
									: ""
							}
              ${
								result.metrics.recall !== undefined
									? `
              <div class="drilldown-item">
                <span class="drilldown-label">Recall</span>
                <span class="drilldown-value">${formatScore(result.metrics.recall)}</span>
              </div>
              `
									: ""
							}
              ${
								result.metrics.f1_score !== undefined
									? `
              <div class="drilldown-item">
                <span class="drilldown-label">F1 Score</span>
                <span class="drilldown-value">${formatScore(result.metrics.f1_score)}</span>
              </div>
              `
									: ""
							}
              ${
								result.metrics.semantic_similarity !== undefined
									? `
              <div class="drilldown-item">
                <span class="drilldown-label">Semantic Similarity</span>
                <span class="drilldown-value">${formatScore(result.metrics.semantic_similarity)}</span>
              </div>
              `
									: ""
							}
            </div>
            <div class="drilldown-section">
              <h4>Question & Answer</h4>
              <div class="qa-section">
                <div class="qa-item">
                  <div class="qa-label">Query</div>
                  <div class="qa-content">${escapeHtml(result.query)}</div>
                </div>
                <div class="qa-item">
                  <div class="qa-label">Expected</div>
                  <div class="qa-content expected">${escapeHtml(result.expected)}</div>
                </div>
                <div class="qa-item">
                  <div class="qa-label">Actual</div>
                  <div class="qa-content actual ${result.status !== "passed" ? "mismatch" : ""}">
                    ${result.actual ? escapeHtml(result.actual) : "(no response)"}
                  </div>
                </div>
              </div>
              ${
								result.error
									? `
              <div class="error-box">
                <div class="error-code">${escapeHtml(result.error.code)}</div>
                <div class="error-message">${escapeHtml(result.error.message)}</div>
              </div>
              `
									: ""
							}
              ${
								result.retrieved_context && result.retrieved_context.length > 0
									? `
              <h4 style="margin-top: 16px">Retrieved Context</h4>
              <ul class="context-list">
                ${result.retrieved_context.map((ctx) => `<li>${escapeHtml(ctx)}</li>`).join("")}
              </ul>
              `
									: ""
							}
            </div>
          </div>
        </div>
      </td>
    </tr>
  `;
}

function renderResultsTable(results: BenchmarkResult[]): string {
	const sorted = getSortedResults(results);

	return `
    <div class="results-section">
      <h2>Detailed Results (${results.length})</h2>
      <table class="results-table">
        <thead>
          <tr>
            <th class="${getSortClass("provider", state.resultsSortKey, state.resultsSortDir)}" data-rsort="provider">Provider</th>
            <th class="${getSortClass("benchmark", state.resultsSortKey, state.resultsSortDir)}" data-rsort="benchmark">Benchmark</th>
            <th class="${getSortClass("item_id", state.resultsSortKey, state.resultsSortDir)}" data-rsort="item_id">Test ID</th>
            <th class="${getSortClass("status", state.resultsSortKey, state.resultsSortDir)}" data-rsort="status">Status</th>
            <th class="${getSortClass("metrics.avg_relevance_score", state.resultsSortKey, state.resultsSortDir)}" data-rsort="metrics.avg_relevance_score">Relevance</th>
            <th class="${getSortClass("metrics.f1_score", state.resultsSortKey, state.resultsSortDir)}" data-rsort="metrics.f1_score">F1</th>
            <th class="${getSortClass("duration_ms", state.resultsSortKey, state.resultsSortDir)}" data-rsort="duration_ms">Duration</th>
            <th>Query</th>
          </tr>
        </thead>
        <tbody>
          ${sorted
						.map(
							(result) => `
            <tr class="expandable" data-result-id="${result.result_id}">
              <td>${escapeHtml(result.provider)}</td>
              <td>${escapeHtml(result.benchmark)}</td>
              <td><code>${escapeHtml(result.item_id)}</code></td>
              <td>
                <span class="test-status ${result.status}">
                  ${getStatusIcon(result.status)}
                  ${result.status}
                </span>
              </td>
              <td><span class="metric-value ${getScoreClass(result.metrics.avg_relevance_score)}">${formatScore(result.metrics.avg_relevance_score)}</span></td>
              <td><span class="metric-value ${getScoreClass(result.metrics.f1_score)}">${formatScore(result.metrics.f1_score)}</span></td>
              <td><span class="metric-value">${formatDuration(result.duration_ms)}</span></td>
              <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(result.query)}">${escapeHtml(result.query)}</td>
            </tr>
            ${state.expandedResultId === result.result_id ? renderDrilldown(result) : ""}
          `,
						)
						.join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderSidebar(): string {
	const manifest = state.manifest;
	const providers = [...new Set(state.results.map((r) => r.provider))];
	const benchmarks = [...new Set(state.results.map((r) => r.benchmark))];

	return `
    <aside class="sidebar">
      <div class="sidebar-header">
        <div class="logo">
          <div class="logo-icon">&#9881;</div>
          <span class="logo-text">MemoryBench</span>
        </div>
      </div>

      <nav class="sidebar-nav">
        <div class="nav-item active">
          <span class="nav-icon">&#128200;</span>
          Dashboard
        </div>
        <div class="nav-item">
          <span class="nav-icon">&#128202;</span>
          Comparison
        </div>
        <div class="nav-item">
          <span class="nav-icon">&#128203;</span>
          Results
        </div>

        <div class="nav-section">
          <div class="nav-section-title">Providers</div>
          ${providers.map((p) => `
            <div class="nav-item ${state.selectedProvider === p ? "active" : ""}" data-provider="${escapeHtml(p)}">
              <span class="nav-icon">&#9881;</span>
              ${escapeHtml(p)}
            </div>
          `).join("")}
        </div>

        <div class="nav-section">
          <div class="nav-section-title">Benchmarks</div>
          ${benchmarks.map((b) => `
            <div class="nav-item ${state.selectedBenchmark === b ? "active" : ""}" data-benchmark="${escapeHtml(b)}">
              <span class="nav-icon">&#128196;</span>
              ${escapeHtml(b)}
            </div>
          `).join("")}
        </div>
      </nav>

      <div class="sidebar-footer">
        ${manifest ? `
          <div class="run-badge">
            <span class="run-badge-dot ${manifest.status === "failed" ? "failed" : ""}"></span>
            <span>${escapeHtml(manifest.run_id.slice(-12))}</span>
          </div>
        ` : ""}
      </div>
    </aside>
  `;
}

function renderPageHeader(): string {
	const manifest = state.manifest!;
	const startDate = new Date(manifest.started_at);

	return `
    <div class="page-header">
      <div class="page-header-top">
        <div>
          <h1 class="page-title">Benchmark Results</h1>
          <p class="page-subtitle">Compare memory provider performance across benchmarks</p>
        </div>
        <div class="header-meta">
          <div class="meta-item">
            <span>Run ID:</span>
            <strong>${escapeHtml(manifest.run_id)}</strong>
          </div>
          <div class="meta-item">
            <span>Started:</span>
            <strong>${startDate.toLocaleString()}</strong>
          </div>
          ${manifest.summary ? `
            <div class="meta-item">
              <span>Duration:</span>
              <strong>${formatDuration(manifest.summary.duration_ms)}</strong>
            </div>
          ` : ""}
          <span class="status-pill ${manifest.status}">${manifest.status}</span>
        </div>
      </div>
    </div>
  `;
}

function render(): void {
	const root = document.getElementById("root");
	if (!root) return;

	if (!state.manifest) {
		root.innerHTML = `
      <div class="app-container">
        <div class="main-content" style="margin-left: 0; max-width: 100%;">
          <div class="loading">
            <div class="loading-spinner"></div>
          </div>
        </div>
      </div>
    `;
		return;
	}

	const filteredResults = getFilteredResults();
	const summaries = computeSummaries(filteredResults);

	root.innerHTML = `
    <div class="app-container">
      ${renderSidebar()}
      <main class="main-content">
        ${renderPageHeader()}
        ${renderSummaryCards()}
        ${renderFilters()}
        ${renderComparisonTable(summaries)}
        ${renderResultsTable(filteredResults)}
      </main>
    </div>
  `;

	// Re-attach event listeners
	attachEventListeners();
}

// =============================================================================
// Event Handlers
// =============================================================================

function attachEventListeners(): void {
	// Filter listeners
	document.getElementById("filter-provider")?.addEventListener("change", (e) => {
		state.selectedProvider = (e.target as HTMLSelectElement).value;
		render();
	});

	document.getElementById("filter-benchmark")?.addEventListener("change", (e) => {
		state.selectedBenchmark = (e.target as HTMLSelectElement).value;
		render();
	});

	document.getElementById("filter-status")?.addEventListener("change", (e) => {
		state.selectedStatus = (e.target as HTMLSelectElement).value;
		render();
	});

	// Comparison table sort listeners
	document.querySelectorAll("[data-sort]").forEach((th) => {
		th.addEventListener("click", () => {
			const key = (th as HTMLElement).dataset.sort as keyof ProviderBenchmarkSummary;
			if (state.compSortKey === key) {
				state.compSortDir = state.compSortDir === "asc" ? "desc" : "asc";
			} else {
				state.compSortKey = key;
				state.compSortDir = "desc";
			}
			render();
		});
	});

	// Results table sort listeners
	document.querySelectorAll("[data-rsort]").forEach((th) => {
		th.addEventListener("click", () => {
			const key = (th as HTMLElement).dataset.rsort!;
			if (state.resultsSortKey === key) {
				state.resultsSortDir = state.resultsSortDir === "asc" ? "desc" : "asc";
			} else {
				state.resultsSortKey = key;
				state.resultsSortDir = "desc";
			}
			render();
		});
	});

	// Row click for drilldown
	document.querySelectorAll("[data-result-id]").forEach((tr) => {
		tr.addEventListener("click", () => {
			const resultId = (tr as HTMLElement).dataset.resultId!;
			state.expandedResultId = state.expandedResultId === resultId ? null : resultId;
			render();
		});
	});

	// Sidebar provider navigation
	document.querySelectorAll("[data-provider]").forEach((item) => {
		item.addEventListener("click", () => {
			const provider = (item as HTMLElement).dataset.provider!;
			state.selectedProvider = state.selectedProvider === provider ? "" : provider;
			render();
		});
	});

	// Sidebar benchmark navigation
	document.querySelectorAll("[data-benchmark]").forEach((item) => {
		item.addEventListener("click", () => {
			const benchmark = (item as HTMLElement).dataset.benchmark!;
			state.selectedBenchmark = state.selectedBenchmark === benchmark ? "" : benchmark;
			render();
		});
	});
}

// =============================================================================
// Initialize
// =============================================================================

async function init(): Promise<void> {
	render(); // Show loading state

	try {
		const { manifest, results } = await loadDashboardData();
		state.manifest = manifest;
		state.results = results;
		render();
	} catch (error) {
		const root = document.getElementById("root");
		if (root) {
			root.innerHTML = `
        <div class="dashboard">
          <div class="empty-state">
            <div class="empty-state-icon">&#9888;</div>
            <div>Failed to load dashboard data: ${escapeHtml(String(error))}</div>
          </div>
        </div>
      `;
		}
	}
}

// Start the app
init();
