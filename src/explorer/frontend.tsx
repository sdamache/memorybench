/// <reference lib="dom" />
import React, { useState, useEffect, useMemo } from "react";
import { createRoot } from "react-dom/client";
import type { ResultRecord } from "../results/schema";
import type { ExplorerData, RunInfo } from "./types";

const JUDGE_METRIC_KEYS = ["correctness", "faithfulness", "type_specific"] as const;
const RETRIEVAL_METRIC_KEYS = [
	"retrieval_precision",
	"retrieval_recall",
	"retrieval_f1",
	"retrieval_coverage",
	"retrieval_ndcg",
	"retrieval_map",
] as const;

const METRIC_LABELS: Record<string, string> = {
	correctness: "Corr",
	faithfulness: "Faith",
	type_specific: "Type",
	retrieval_precision: "Prec",
	retrieval_recall: "Rec",
	retrieval_f1: "F1",
	retrieval_coverage: "Cov",
	retrieval_ndcg: "nDCG",
	retrieval_map: "MAP",
};

// --- Icon Component (uses Iconify loaded in HTML) ---
// Use a wrapper div to prevent React/Iconify DOM conflicts
function Icon({ name, className = "" }: { name: string; className?: string }) {
	return (
		<span
			className={className}
			dangerouslySetInnerHTML={{
				__html: `<span class="iconify" data-icon="${name}"></span>`,
			}}
		/>
	);
}

// --- Header Component ---
function Header({
	data,
	onSelectRun,
	onExport,
}: { data: ExplorerData; onSelectRun: () => void; onExport: () => void }) {
	const runDate = new Date(data.manifest.timestamp);
	const timeAgo = getTimeAgo(runDate);

	return (
		<header className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-white/10 pb-6">
			<div className="space-y-2">
				<div className="flex items-center gap-2">
					<div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
					<span className="text-xs font-mono text-accent uppercase tracking-widest">
						Run Complete
					</span>
				</div>
				<h1 className="text-3xl md:text-4xl font-medium text-white tracking-tight">
					Results Explorer
				</h1>
				<p className="text-gray-500 font-mono text-xs">
					Viewing Run:{" "}
					<span className="text-white">{data.manifest.run_id}</span>
					<span className="mx-2 text-white/20">|</span>
					<span className="text-gray-600">{timeAgo}</span>
				</p>
			</div>

			<div className="flex items-center gap-3">
				<button
					onClick={onSelectRun}
					className="group relative px-6 py-2 bg-transparent text-white border border-white/20 hover:border-accent hover:text-accent transition-colors clip-chamfer"
				>
					<span className="text-xs font-bold uppercase tracking-wider">
						Select Run
					</span>
				</button>
				<button
					onClick={onExport}
					className="group relative px-6 py-2 bg-accent text-black hover:bg-white transition-colors clip-chamfer"
				>
					<div className="flex items-center gap-2">
						<Icon name="lucide:download" />
						<span className="text-xs font-bold uppercase tracking-wider">
							Export
						</span>
					</div>
				</button>
			</div>
		</header>
	);
}

// --- Dashboard Cards ---
function Dashboard({ data }: { data: ExplorerData }) {
	const { totals } = data.summary;
	const passRate =
		totals.cases > 0 ? ((totals.passed / totals.cases) * 100).toFixed(1) : "0";
	const avgDurationSeconds =
		totals.cases > 0 ? totals.duration_ms / totals.cases / 1000 : 0;

	return (
		<div className="grid grid-cols-1 md:grid-cols-4 gap-4">
			<MetricCard
				icon="lucide:layers"
				label="Total Cases"
				value={totals.cases.toLocaleString()}
				subtext={`${totals.passed} passed`}
				subtextColor="text-green-500"
			/>
			<MetricCard
				icon="lucide:clock"
				label="Avg Duration"
				value={avgDurationSeconds.toFixed(1)}
				unit="s"
				subtext="Per case"
			/>
			<MetricCard
				icon="lucide:check-circle"
				label="Pass Rate"
				value={passRate}
				unit="%"
				progress={Number.parseFloat(passRate)}
			/>
			<MetricCard
				icon="lucide:server"
				label="Providers"
				value={data.manifest.providers.length.toString()}
				subtext="In this run"
			/>
		</div>
	);
}

function MetricCard({
	icon,
	label,
	value,
	unit,
	subtext,
	subtextColor = "text-gray-500",
	progress,
}: {
	icon: string;
	label: string;
	value: string;
	unit?: string;
	subtext?: string;
	subtextColor?: string;
	progress?: number;
}) {
	return (
		<div className="cursor-pointer p-6 bg-hex-card border border-white/10 relative overflow-hidden group hover:border-accent/50 transition-all duration-300">
			<div className="absolute top-4 right-4 text-gray-700 group-hover:text-accent transition-colors">
				<Icon name={icon} className="w-6 h-6" />
			</div>
			<div className="text-gray-500 text-[10px] uppercase tracking-widest font-mono mb-2">
				{label}
			</div>
			<div className="text-3xl font-medium text-white">
				{value}
				{unit && <span className="text-lg text-gray-500 ml-1">{unit}</span>}
			</div>
			{progress !== undefined && (
				<div className="w-full bg-gray-800 h-1 mt-3 overflow-hidden">
					<div
						className="bg-accent h-full transition-all duration-500"
						style={{ width: `${progress}%` }}
					/>
				</div>
			)}
			{subtext && (
				<div className={`mt-2 text-xs font-mono ${subtextColor}`}>{subtext}</div>
			)}
		</div>
	);
}

function ScoreOverview({
	data,
	selectedProvider,
	selectedBenchmark,
}: {
	data: ExplorerData;
	selectedProvider: string;
	selectedBenchmark: string;
}) {
	const [view, setView] = useState<"judge" | "retrieval">("judge");

	const combinations = useMemo(() => {
		const filtered = data.summary.by_combination.filter((combo) => {
			if (selectedProvider !== "all" && combo.provider_name !== selectedProvider)
				return false;
			if (selectedBenchmark !== "all" && combo.benchmark_name !== selectedBenchmark)
				return false;
			return true;
		});

		return filtered.slice().sort((a, b) => {
			const providerCmp = a.provider_name.localeCompare(b.provider_name);
			if (providerCmp !== 0) return providerCmp;
			return a.benchmark_name.localeCompare(b.benchmark_name);
		});
	}, [data.summary.by_combination, selectedBenchmark, selectedProvider]);

	const metricCandidates = useMemo(() => {
		return view === "judge" ? [...JUDGE_METRIC_KEYS] : [...RETRIEVAL_METRIC_KEYS];
	}, [view]);

	const visibleMetrics = useMemo(() => {
		return metricCandidates.filter((metricKey) =>
			combinations.some((combo) => combo.score_averages[metricKey] !== undefined),
		);
	}, [combinations, metricCandidates]);

	if (combinations.length === 0) return null;

	return (
		<div className="overflow-hidden border border-white/10 bg-hex-card">
			<div className="p-4 border-b border-white/10 flex items-center justify-between">
				<div className="flex items-center gap-2">
					<Icon name="lucide:bar-chart-2" className="text-accent" />
					<span className="text-xs font-bold uppercase tracking-wider text-white">
						Average Scores
					</span>
				</div>

				<div className="flex items-center gap-2">
					<ToggleButton
						active={view === "judge"}
						onClick={() => setView("judge")}
					>
						Judge
					</ToggleButton>
					<ToggleButton
						active={view === "retrieval"}
						onClick={() => setView("retrieval")}
					>
						Retrieval
					</ToggleButton>
				</div>
			</div>

			{visibleMetrics.length === 0 ? (
				<div className="p-6 text-xs text-gray-500 font-mono">
					No metrics available for this view.
				</div>
			) : (
				<div className="overflow-x-auto">
					<table className="w-full text-left border-collapse text-xs font-mono">
						<thead>
							<tr className="border-b border-white/10 bg-white/5 text-gray-500 uppercase tracking-wider">
								<th className="p-4 font-bold">Provider</th>
								<th className="p-4 font-bold">Benchmark</th>
								<th className="p-4 font-bold text-right">Cases</th>
								<th className="p-4 font-bold text-right">Pass</th>
								<th className="p-4 font-bold text-right">Avg Dur</th>
								{visibleMetrics.map((metricKey) => (
									<th
										key={metricKey}
										className="p-4 font-bold text-right"
										title={metricKey}
									>
										{METRIC_LABELS[metricKey] ?? metricKey}
									</th>
								))}
							</tr>
						</thead>
						<tbody className="divide-y divide-white/5">
							{combinations.map((combo) => {
								const pass =
									combo.counts.cases > 0
										? (combo.counts.passed / combo.counts.cases) * 100
										: 0;
								const avgMs =
									combo.counts.cases > 0
										? combo.duration_ms / combo.counts.cases
										: 0;
								const avg = formatDurationMs(avgMs);

								return (
									<tr
										key={`${combo.provider_name}:${combo.benchmark_name}`}
										className="hover:bg-white/5 transition-colors"
									>
										<td className="p-4 text-gray-300">{combo.provider_name}</td>
										<td className="p-4 text-gray-400">{combo.benchmark_name}</td>
										<td className="p-4 text-right text-gray-500">
											{combo.counts.cases.toLocaleString()}
										</td>
										<td className="p-4 text-right text-gray-500">
											{pass.toFixed(1)}%
										</td>
										<td className="p-4 text-right text-gray-500">
											{avg.value}
											<span className="text-gray-600 ml-1">{avg.unit}</span>
										</td>
										{visibleMetrics.map((metricKey) => {
											const scoreValue = combo.score_averages[metricKey];
											return (
												<td
													key={metricKey}
													className="p-4 text-right text-gray-300"
												>
													{scoreValue === undefined
														? "—"
														: formatMetricValue(metricKey, scoreValue, 1)}
												</td>
											);
										})}
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}

function ToggleButton({
	active,
	onClick,
	children,
}: {
	active: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`px-3 py-1.5 border text-[10px] font-bold uppercase tracking-wider transition-colors clip-chamfer ${
				active
					? "bg-accent text-black border-accent"
					: "bg-hex-surface text-gray-300 border-white/10 hover:border-accent/50 hover:text-white"
			}`}
		>
			{children}
		</button>
	);
}

// --- Filters Toolbar ---
function Filters({
	providers,
	benchmarks,
	selectedProvider,
	setSelectedProvider,
	selectedBenchmark,
	setSelectedBenchmark,
	statusFilter,
	setStatusFilter,
	caseQuery,
	setCaseQuery,
	filteredCount,
	totalCount,
}: {
	providers: { name: string }[];
	benchmarks: { name: string }[];
	selectedProvider: string;
	setSelectedProvider: (v: string) => void;
	selectedBenchmark: string;
	setSelectedBenchmark: (v: string) => void;
	statusFilter: string;
	setStatusFilter: (v: string) => void;
	caseQuery: string;
	setCaseQuery: (v: string) => void;
	filteredCount: number;
	totalCount: number;
}) {
	return (
		<div className="flex flex-wrap items-center gap-4 p-4 bg-hex-surface border border-white/10 clip-chamfer">
			<div className="flex items-center gap-3">
				<Icon name="lucide:filter" className="text-accent" />
				<span className="text-xs font-bold uppercase tracking-wider text-white">
					Filters:
				</span>
			</div>

			<div className="h-4 w-px bg-white/10" />

			<div className="flex gap-4">
				<FilterSelect
					value={selectedProvider}
					onChange={setSelectedProvider}
					options={[
						{ value: "all", label: "All Providers" },
						...providers.map((p) => ({ value: p.name, label: p.name })),
					]}
				/>
				<FilterSelect
					value={selectedBenchmark}
					onChange={setSelectedBenchmark}
					options={[
						{ value: "all", label: "All Benchmarks" },
						...benchmarks.map((b) => ({ value: b.name, label: b.name })),
					]}
				/>
				<FilterSelect
					value={statusFilter}
					onChange={setStatusFilter}
					options={[
						{ value: "all", label: "Any Status" },
						{ value: "pass", label: "Passed" },
						{ value: "fail", label: "Failed" },
						{ value: "error", label: "Error" },
						{ value: "skip", label: "Skipped" },
					]}
				/>
				<div className="relative group">
					<input
						value={caseQuery}
						onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
							setCaseQuery(e.target.value)
						}
						placeholder="Search Case ID"
						className="bg-black border border-white/20 text-xs text-gray-300 pl-3 pr-8 py-1.5 focus:border-accent outline-none tracking-wide w-48"
					/>
					{caseQuery ? (
						<button
							type="button"
							onClick={() => setCaseQuery("")}
							className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-accent"
						>
							<Icon name="lucide:x" />
						</button>
					) : (
						<span className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500">
							<Icon name="lucide:search" />
						</span>
					)}
				</div>
			</div>

			<div className="ml-auto flex items-center gap-2">
				<span className="text-[10px] text-gray-500 font-mono">
					Showing {filteredCount} of {totalCount}
				</span>
			</div>
		</div>
	);
}

function FilterSelect({
	value,
	onChange,
	options,
}: {
	value: string;
	onChange: (v: string) => void;
	options: { value: string; label: string }[];
}) {
	return (
		<div className="relative group">
			<select
				value={value}
				onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}
				className="appearance-none bg-black border border-white/20 text-xs text-gray-300 pl-3 pr-8 py-1.5 focus:border-accent outline-none uppercase tracking-wide cursor-pointer w-40"
			>
				{options.map((opt) => (
					<option key={opt.value} value={opt.value}>
						{opt.label}
					</option>
				))}
			</select>
			<span className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500">
				<Icon name="lucide:chevron-down" />
			</span>
		</div>
	);
}

/**
 * Get score color based on value (0-1 scale)
 */
function getScoreColor(value: number): string {
	if (!Number.isFinite(value)) return "text-gray-500";
	if (value >= 0.8) return "text-emerald-400";
	if (value >= 0.5) return "text-amber-400";
	return "text-red-400";
}

/**
 * Get background color class for score badge
 */
function getScoreBg(value: number): string {
	if (!Number.isFinite(value)) return "bg-gray-500/10";
	if (value >= 0.8) return "bg-emerald-500/15";
	if (value >= 0.5) return "bg-amber-500/15";
	return "bg-red-500/15";
}

/**
 * Mini score dot indicator
 */
function ScoreDot({ value, label }: { value: number | undefined; label: string }) {
	if (value === undefined) return null;
	const color = value >= 0.8 ? "bg-emerald-400" : value >= 0.5 ? "bg-amber-400" : "bg-red-400";
	return (
		<div className="flex flex-col items-center gap-0.5" title={`${label}: ${(value * 100).toFixed(0)}%`}>
			<div className={`w-2 h-2 rounded-full ${color}`} />
		</div>
	);
}

function ScoresCell({ scores }: { scores: Record<string, number> }) {
	const entries = sortScoreEntries(scores);
	if (entries.length === 0) return <span className="text-[10px] text-gray-600">—</span>;

	const correctness = scores.correctness;
	const faithfulness = scores.faithfulness;

	// Retrieval metrics
	const hasRetrieval = scores.retrieval_precision !== undefined ||
		scores.retrieval_recall !== undefined ||
		scores.retrieval_f1 !== undefined;

	// Calculate average retrieval score for summary
	const retrievalScores = [
		scores.retrieval_precision,
		scores.retrieval_recall,
		scores.retrieval_f1,
		scores.retrieval_coverage,
		scores.retrieval_ndcg,
		scores.retrieval_map,
	].filter((v): v is number => v !== undefined && Number.isFinite(v));

	const avgRetrieval = retrievalScores.length > 0
		? retrievalScores.reduce((a, b) => a + b, 0) / retrievalScores.length
		: undefined;

	// Build detailed tooltip
	const tooltipLines = entries.map(
		([key, value]) => `${key}: ${formatMetricValue(key, value, 1)}`
	);
	const tooltip = tooltipLines.join("\n");

	return (
		<div className="flex items-center justify-end gap-2" title={tooltip}>
			{/* Primary metrics as compact badges */}
			{correctness !== undefined && (
				<div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded ${getScoreBg(correctness)}`}>
					<span className="text-[9px] uppercase tracking-wide text-gray-500 font-medium">C</span>
					<span className={`text-xs font-semibold tabular-nums ${getScoreColor(correctness)}`}>
						{(correctness * 100).toFixed(0)}
					</span>
				</div>
			)}

			{faithfulness !== undefined && (
				<div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded ${getScoreBg(faithfulness)}`}>
					<span className="text-[9px] uppercase tracking-wide text-gray-500 font-medium">F</span>
					<span className={`text-xs font-semibold tabular-nums ${getScoreColor(faithfulness)}`}>
						{(faithfulness * 100).toFixed(0)}
					</span>
				</div>
			)}

			{/* Retrieval summary as dot cluster */}
			{hasRetrieval && avgRetrieval !== undefined && (
				<div
					className={`inline-flex items-center gap-1.5 px-2 py-1 rounded ${getScoreBg(avgRetrieval)}`}
					title={`Retrieval Avg: ${(avgRetrieval * 100).toFixed(0)}%\nP: ${scores.retrieval_precision !== undefined ? (scores.retrieval_precision * 100).toFixed(0) : '—'}%\nR: ${scores.retrieval_recall !== undefined ? (scores.retrieval_recall * 100).toFixed(0) : '—'}%\nF1: ${scores.retrieval_f1 !== undefined ? (scores.retrieval_f1 * 100).toFixed(0) : '—'}%`}
				>
					<span className="text-[9px] uppercase tracking-wide text-gray-500 font-medium">R</span>
					<div className="flex gap-0.5">
						<ScoreDot value={scores.retrieval_precision} label="Precision" />
						<ScoreDot value={scores.retrieval_recall} label="Recall" />
						<ScoreDot value={scores.retrieval_f1} label="F1" />
					</div>
				</div>
			)}

			{/* Extra metrics indicator */}
			{entries.length > 3 && (
				<span className="text-[9px] text-gray-600 font-mono">
					+{entries.length - 3}
				</span>
			)}
		</div>
	);
}

// --- Results Table ---
function ResultsTable({
	results,
	onSelect,
}: { results: ResultRecord[]; onSelect: (r: ResultRecord) => void }) {
	const [sortKey, setSortKey] = useState<string>("case_id");
	const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
	const [page, setPage] = useState(0);
	const [pageSize, setPageSize] = useState(100);

	const sortedResults = useMemo(() => {
		return [...results].sort((a, b) => {
			const valA = (a as unknown as Record<string, unknown>)[sortKey];
			const valB = (b as unknown as Record<string, unknown>)[sortKey];
			if (valA === undefined || valA === null || valB === undefined || valB === null) return 0;
			if (valA < valB) return sortOrder === "asc" ? -1 : 1;
			if (valA > valB) return sortOrder === "asc" ? 1 : -1;
			return 0;
		});
	}, [results, sortKey, sortOrder]);

	useEffect(() => {
		setPage(0);
	}, [results, pageSize]);

	const pageCount = Math.max(1, Math.ceil(sortedResults.length / pageSize));
	const clampedPage = Math.min(page, pageCount - 1);
	const startIndex = clampedPage * pageSize;
	const pageResults = sortedResults.slice(startIndex, startIndex + pageSize);

	useEffect(() => {
		if (page !== clampedPage) {
			setPage(clampedPage);
		}
	}, [page, clampedPage]);

	const handleSort = (key: string) => {
		if (sortKey === key) {
			setSortOrder(sortOrder === "asc" ? "desc" : "asc");
		} else {
			setSortKey(key);
			setSortOrder("asc");
		}
	};

	const SortHeader = ({
		field,
		label,
		align = "left",
	}: { field: string; label: string; align?: "left" | "right" }) => (
		<th
			onClick={() => handleSort(field)}
			className={`p-4 font-bold cursor-pointer hover:text-white transition-colors ${align === "right" ? "text-right" : ""}`}
		>
			<div
				className={`flex items-center gap-1 ${align === "right" ? "justify-end" : ""}`}
			>
				{label}
				{sortKey === field && (
					<Icon
						name={sortOrder === "asc" ? "lucide:arrow-up" : "lucide:arrow-down"}
						className="w-3 h-3"
					/>
				)}
			</div>
		</th>
	);

	return (
		<div className="overflow-hidden border border-white/10 bg-hex-card">
			<table className="w-full text-left border-collapse text-xs font-mono">
				<thead>
					<tr className="border-b border-white/10 bg-white/5 text-gray-500 uppercase tracking-wider">
						<SortHeader field="status" label="Status" />
						<SortHeader field="case_id" label="Case ID" />
						<SortHeader field="provider_name" label="Provider" />
						<SortHeader field="benchmark_name" label="Benchmark" />
						<SortHeader field="duration_ms" label="Duration" align="right" />
						<th className="p-4 font-bold text-right">Scores</th>
						<th className="p-4 font-bold w-12" />
					</tr>
				</thead>
				<tbody className="divide-y divide-white/5">
					{pageResults.length === 0 ? (
						<tr>
							<td colSpan={7} className="p-10 text-center text-gray-500">
								No results match the current filters.
							</td>
						</tr>
					) : (
						pageResults.map((result) => (
							<tr
								key={`${result.run_id}:${result.provider_name}:${result.benchmark_name}:${result.case_id}`}
								onClick={() => onSelect(result)}
								className="group hover:bg-white/5 transition-colors cursor-pointer"
							>
								<td className="p-4">
									<StatusIcon status={result.status} />
								</td>
								<td className="p-4 text-white font-medium">{result.case_id}</td>
								<td className="p-4 text-gray-300">{result.provider_name}</td>
									<td className="p-4 text-gray-400">{result.benchmark_name}</td>
									<td className="p-4 text-right text-gray-500">
										{formatDurationLabel(result.duration_ms)}
									</td>
									<td className="p-4 text-right">
										<ScoresCell scores={result.scores} />
									</td>
									<td className="p-4 text-center text-gray-600 group-hover:text-accent">
										<Icon name="lucide:chevron-right" />
									</td>
								</tr>
						))
					)}
				</tbody>
			</table>
			<div className="p-4 border-t border-white/5 flex flex-col md:flex-row md:items-center gap-3 justify-between bg-black/20">
				<div className="flex items-center gap-3 text-[10px] text-gray-500 font-mono uppercase tracking-wider">
					<span>Rows</span>
					<div className="relative group">
						<select
							value={pageSize.toString()}
							onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
								setPageSize(Number.parseInt(e.target.value, 10))
							}
							className="appearance-none bg-black border border-white/20 text-[10px] text-gray-300 pl-3 pr-8 py-1 focus:border-accent outline-none uppercase tracking-wide cursor-pointer"
						>
							<option value="50">50</option>
							<option value="100">100</option>
							<option value="200">200</option>
							<option value="500">500</option>
						</select>
						<span className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500">
							<Icon name="lucide:chevron-down" />
						</span>
					</div>
				</div>

				<div className="flex items-center justify-between md:justify-end gap-3">
					<div className="text-[10px] text-gray-500 font-mono">
						{sortedResults.length === 0
							? "0 results"
							: `${startIndex + 1}-${Math.min(startIndex + pageSize, sortedResults.length)} of ${sortedResults.length}`}
					</div>
					<div className="flex items-center gap-2">
						<button
							type="button"
							disabled={clampedPage === 0}
							onClick={() => setPage((p) => Math.max(0, p - 1))}
							className="px-3 py-1 bg-hex-surface border border-white/10 hover:border-accent hover:text-accent disabled:opacity-50 disabled:hover:border-white/10 disabled:hover:text-gray-500 transition-colors clip-chamfer text-[10px] font-bold uppercase tracking-wider text-gray-300"
						>
							Prev
						</button>
						<button
							type="button"
							disabled={clampedPage >= pageCount - 1}
							onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
							className="px-3 py-1 bg-hex-surface border border-white/10 hover:border-accent hover:text-accent disabled:opacity-50 disabled:hover:border-white/10 disabled:hover:text-gray-500 transition-colors clip-chamfer text-[10px] font-bold uppercase tracking-wider text-gray-300"
						>
							Next
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}

function StatusIcon({ status }: { status: string }) {
	const config: Record<string, { icon: string; color: string }> = {
		pass: { icon: "lucide:check-circle", color: "text-green-500" },
		fail: { icon: "lucide:x-circle", color: "text-red-500" },
		error: { icon: "lucide:alert-circle", color: "text-red-500" },
		skip: { icon: "lucide:minus-circle", color: "text-yellow-500" },
	};
	const statusConfig = config[status] ?? config.skip!;
	return (
		<div className={`flex items-center gap-2 ${statusConfig.color}`}>
			<Icon name={statusConfig.icon} />
		</div>
	);
}

// --- Drilldown Panel ---
function Drilldown({
	result,
	onClose,
}: { result: ResultRecord; onClose: () => void }) {
	const hasScores: boolean =
		result.scores != null && Object.keys(result.scores).length > 0;
	const scores: Record<string, number> = result.scores ?? {};

	return (
		<div
			className="fixed inset-0 bg-black/70 z-50 flex justify-end animate-reveal"
			onClick={onClose}
		>
			<div
				className="w-full max-w-2xl bg-hex-card h-full overflow-y-auto shadow-2xl"
				onClick={(e) => e.stopPropagation()}
			>
				{/* Header */}
				<div className="sticky top-0 bg-hex-card border-b border-white/10 p-6 flex items-center justify-between">
					<div className="flex items-center gap-4">
						<button
							onClick={onClose}
							className="flex items-center gap-2 px-4 py-2 bg-hex-surface border border-white/10 hover:border-accent hover:text-accent transition-colors clip-chamfer"
						>
							<Icon name="lucide:arrow-left" className="w-4 h-4" />
							<span className="text-xs font-bold uppercase tracking-wider">
								Back
							</span>
						</button>
						<div className="h-8 w-px bg-white/10" />
						<div>
							<h2 className="text-xl font-medium text-white">
								{result.case_id}
							</h2>
							<div className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">
								Drilldown Analysis
							</div>
						</div>
					</div>
					<StatusBadge status={result.status} />
				</div>

				{/* Content */}
				<div className="p-6 space-y-6">
					{/* Metadata Card */}
					<div className="p-6 bg-hex-surface border border-white/10">
						<div className="flex items-center gap-2 mb-4">
							<Icon name="lucide:database" className="text-accent" />
							<span className="text-xs font-bold uppercase tracking-wider text-white">
								Metadata
							</span>
						</div>
						<div className="space-y-3">
							<MetadataRow label="Provider" value={result.provider_name} />
							<MetadataRow label="Benchmark" value={result.benchmark_name} />
							<MetadataRow
								label="Duration"
								value={formatDurationLabel(result.duration_ms)}
							/>
							<MetadataRow label="Run ID" value={result.run_id} />
						</div>
					</div>

					{/* Scores Card */}
					{hasScores ? (
						<div className="p-6 bg-hex-surface border border-white/10">
							<div className="flex items-center gap-2 mb-4">
								<Icon name="lucide:bar-chart-2" className="text-accent" />
								<span className="text-xs font-bold uppercase tracking-wider text-white">
									Scores
								</span>
								</div>
								<div className="grid grid-cols-2 gap-4">
									{sortScoreEntries(scores).map(([name, score]) => {
										const ratioMetric = isRatioMetricValue(score);
										return (
											<div
												key={name}
												className="p-3 bg-black/30 border border-white/5"
											>
												<div className="text-[10px] text-gray-500 uppercase mb-1">
													{name}
												</div>
												<div
													className={`text-xl font-medium ${
														ratioMetric
															? score >= 0.7
																? "text-green-400"
																: "text-red-400"
															: "text-white"
													}`}
												>
													{formatMetricValue(name, score, 1)}
												</div>
											</div>
										);
									})}
								</div>
						</div>
					) : null}

					{/* Error Card */}
					{result.error && (
						<div className="p-6 bg-red-500/5 border border-red-500/30">
							<div className="flex items-center gap-2 mb-4">
								<Icon name="lucide:alert-triangle" className="text-red-500" />
								<span className="text-xs font-bold uppercase tracking-wider text-red-500">
									Error
								</span>
							</div>
							<pre className="text-xs text-red-300 font-mono whitespace-pre-wrap overflow-x-auto">
								{typeof result.error === "string"
									? result.error
									: JSON.stringify(result.error, null, 2)}
							</pre>
						</div>
					)}

					{/* Details Card - REMOVED: "details" property not in ResultRecord type */}

					{/* Raw Result */}
					<details className="group">
						<summary className="cursor-pointer text-xs text-gray-500 hover:text-white transition-colors flex items-center gap-2">
							<Icon
								name="lucide:chevron-right"
								className="w-4 h-4 group-open:rotate-90 transition-transform"
							/>
							<span className="uppercase tracking-wider">View Raw Result</span>
						</summary>
						<pre className="mt-4 text-xs text-gray-400 font-mono whitespace-pre-wrap overflow-x-auto bg-black/30 p-4 border border-white/5">
							{JSON.stringify(result, null, 2)}
						</pre>
					</details>
				</div>
			</div>
		</div>
	);
}

function StatusBadge({ status }: { status: string }) {
	const config: Record<string, { bg: string; border: string; text: string }> = {
		pass: {
			bg: "bg-green-500/10",
			border: "border-green-500",
			text: "text-green-500",
		},
		fail: {
			bg: "bg-red-500/10",
			border: "border-red-500",
			text: "text-red-500",
		},
		error: {
			bg: "bg-red-500/10",
			border: "border-red-500",
			text: "text-red-500",
		},
		skip: {
			bg: "bg-yellow-500/10",
			border: "border-yellow-500",
			text: "text-yellow-500",
		},
	};
	const statusConfig = config[status] ?? config.skip!;
	return (
		<span
			className={`px-3 py-1 ${statusConfig.bg} border ${statusConfig.border} ${statusConfig.text} text-xs font-bold uppercase tracking-widest clip-chamfer`}
		>
			{status}
		</span>
	);
}

function MetadataRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex justify-between text-xs">
			<span className="text-gray-500">{label}</span>
			<span className="text-white font-mono">{value}</span>
		</div>
	);
}

// --- Run Picker Modal ---
function RunPicker({
	runs,
	currentRunId,
	onSelect,
	onClose,
	loading,
}: {
	runs: RunInfo[];
	currentRunId: string;
	onSelect: (runId: string) => void;
	onClose: () => void;
	loading: boolean;
}) {
	return (
		<div
			className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center animate-reveal"
			onClick={onClose}
		>
			<div
				className="w-full max-w-2xl bg-hex-card max-h-[80vh] overflow-hidden shadow-2xl border border-white/10"
				onClick={(e) => e.stopPropagation()}
			>
				{/* Header */}
				<div className="sticky top-0 bg-hex-card border-b border-white/10 p-6 flex items-center justify-between">
					<div className="flex items-center gap-4">
						<Icon name="lucide:folder-open" className="text-accent w-6 h-6" />
						<div>
							<h2 className="text-xl font-medium text-white">Select Run</h2>
							<div className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">
								{runs.length} runs available
							</div>
						</div>
					</div>
					<button
						onClick={onClose}
						className="p-2 hover:bg-white/10 transition-colors"
					>
						<Icon name="lucide:x" className="w-5 h-5 text-gray-400 hover:text-white" />
					</button>
				</div>

				{/* Content */}
				<div className="overflow-y-auto max-h-[60vh] p-4">
					{loading ? (
						<div className="flex items-center justify-center py-12">
							<Icon name="lucide:loader-2" className="w-6 h-6 animate-spin text-accent" />
							<span className="ml-2 text-gray-500">Loading runs...</span>
						</div>
					) : runs.length === 0 ? (
						<div className="text-center py-12 text-gray-500">
							No runs found in the runs folder.
						</div>
					) : (
						<div className="space-y-2">
							{runs.map((run) => {
								const isCurrentRun = run.run_id === currentRunId;
								const runDate = new Date(run.timestamp);
								const timeAgo = getTimeAgo(runDate);

								return (
									<button
										key={run.run_id}
										onClick={() => !isCurrentRun && onSelect(run.run_id)}
										disabled={isCurrentRun}
										className={`w-full text-left p-4 border transition-all ${
											isCurrentRun
												? "border-accent bg-accent/10 cursor-default"
												: "border-white/10 hover:border-accent/50 hover:bg-white/5 cursor-pointer"
										}`}
									>
										<div className="flex items-start justify-between">
											<div className="space-y-1">
												<div className="flex items-center gap-2">
													<span className="text-white font-mono text-sm">
														{run.run_id}
													</span>
													{isCurrentRun && (
														<span className="px-2 py-0.5 bg-accent/20 text-accent text-[10px] uppercase tracking-wider">
															Current
														</span>
													)}
												</div>
												<div className="text-[10px] text-gray-500 font-mono">
													{runDate.toLocaleString()} ({timeAgo})
												</div>
												<div className="flex flex-wrap gap-2 mt-2">
													{run.providers.map((p) => (
														<span
															key={p}
															className="px-2 py-0.5 bg-blue-500/10 border border-blue-500/30 text-blue-400 text-[10px]"
														>
															{p}
														</span>
													))}
													{run.benchmarks.map((b) => (
														<span
															key={b}
															className="px-2 py-0.5 bg-purple-500/10 border border-purple-500/30 text-purple-400 text-[10px]"
														>
															{b}
														</span>
													))}
												</div>
											</div>
											<div className="text-right">
												{run.result_count !== undefined && (
													<div className="text-gray-400 text-xs">
														{run.result_count} results
													</div>
												)}
											</div>
										</div>
									</button>
								);
							})}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

// --- Utility Functions ---
function formatDurationMs(ms: number): { value: string; unit: "ms" | "s" } {
	if (!Number.isFinite(ms) || ms <= 0) return { value: "0", unit: "ms" };

	if (ms < 1000) {
		return { value: ms.toFixed(0), unit: "ms" };
	}

	const seconds = ms / 1000;
	const decimals = seconds < 10 ? 2 : seconds < 100 ? 1 : 0;
	return { value: seconds.toFixed(decimals), unit: "s" };
}

function formatDurationLabel(ms: number): string {
	const formatted = formatDurationMs(ms);
	return `${formatted.value}${formatted.unit}`;
}

// Metrics that should always be displayed as percentages (0-1 scale)
const RATIO_METRICS: Set<string> = new Set([
	...JUDGE_METRIC_KEYS,
	...RETRIEVAL_METRIC_KEYS,
]);

function isRatioMetric(metricKey: string): boolean {
	return RATIO_METRICS.has(metricKey);
}

function isRatioMetricValue(value: number): boolean {
	return Number.isFinite(value) && value >= 0 && value <= 1;
}

function formatMetricPercent(value: number, decimals: number): string {
	if (!Number.isFinite(value)) return "—";
	// Cap at 100% for display (handles buggy old data with values > 1)
	const capped = Math.min(value, 1);
	return (capped * 100).toFixed(decimals);
}

function formatMetricValue(metricKey: string, value: number, decimals: number): string {
	if (!Number.isFinite(value)) return "—";

	// Count metrics stay as raw numbers
	if (metricKey.endsWith("_count")) {
		return value.toFixed(0);
	}

	// Known ratio metrics always show as percentage (handles buggy old data)
	if (isRatioMetric(metricKey)) {
		return `${formatMetricPercent(value, decimals)}%`;
	}

	// Other metrics: show as percentage if 0-1, otherwise raw
	if (isRatioMetricValue(value)) {
		return `${formatMetricPercent(value, decimals)}%`;
	}

	return value.toFixed(2);
}

function sortScoreEntries(scores: Record<string, number>): Array<[string, number]> {
	const order = [...JUDGE_METRIC_KEYS, ...RETRIEVAL_METRIC_KEYS];
	const indexByKey = new Map<string, number>();
	for (let i = 0; i < order.length; i += 1) {
		const key = order[i];
		if (key) indexByKey.set(key, i);
	}

	return Object.entries(scores)
		.filter(([, value]) => Number.isFinite(value))
		.sort(([keyA], [keyB]) => {
			const idxA = indexByKey.get(keyA);
			const idxB = indexByKey.get(keyB);
			if (idxA !== undefined && idxB !== undefined) return idxA - idxB;
			if (idxA !== undefined) return -1;
			if (idxB !== undefined) return 1;
			return keyA.localeCompare(keyB);
		});
}

function getTimeAgo(date: Date): string {
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffMins = Math.floor(diffMs / 60000);
	const diffHours = Math.floor(diffMins / 60);
	const diffDays = Math.floor(diffHours / 24);

	if (diffDays > 0) return `${diffDays}d ago`;
	if (diffHours > 0) return `${diffHours}h ago`;
	if (diffMins > 0) return `${diffMins}m ago`;
	return "Just now";
}

// --- Main App ---
export function App() {
	const [data, setData] = useState<ExplorerData | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const [selectedProvider, setSelectedProvider] = useState("all");
	const [selectedBenchmark, setSelectedBenchmark] = useState("all");
	const [statusFilter, setStatusFilter] = useState("all");
	const [caseQuery, setCaseQuery] = useState("");
	const [selectedResult, setSelectedResult] = useState<ResultRecord | null>(
		null,
	);

	// Run picker state
	const [showRunPicker, setShowRunPicker] = useState(false);
	const [availableRuns, setAvailableRuns] = useState<RunInfo[]>([]);
	const [loadingRuns, setLoadingRuns] = useState(false);

	// Fetch initial data
	useEffect(() => {
		fetch("/api/data")
			.then((res) => {
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				return res.json() as Promise<ExplorerData>;
			})
			.then((fetchedData) => {
				setData(fetchedData);
				setLoading(false);
			})
			.catch((err: Error) => {
				setError(err.message);
				setLoading(false);
			});
	}, []);

	// Fetch available runs when picker opens
	const handleOpenRunPicker = () => {
		setShowRunPicker(true);
		setLoadingRuns(true);
		fetch("/api/runs")
			.then((res) => {
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				return res.json() as Promise<RunInfo[]>;
			})
			.then((runs) => {
				setAvailableRuns(runs);
				setLoadingRuns(false);
			})
			.catch(() => {
				setAvailableRuns([]);
				setLoadingRuns(false);
			});
	};

	// Switch to a different run
	const handleSelectRun = (runId: string) => {
		setShowRunPicker(false);
		setLoading(true);
		setError(null);

		fetch(`/api/run/${runId}`)
			.then((res) => {
				if (!res.ok) throw new Error(`Failed to switch run`);
				return res.json();
			})
			.then(() => {
				// Fetch the new data
				return fetch("/api/data");
			})
			.then((res) => {
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				return res.json() as Promise<ExplorerData>;
			})
			.then((fetchedData) => {
				setData(fetchedData);
				setLoading(false);
				// Reset filters when switching runs
				setSelectedProvider("all");
				setSelectedBenchmark("all");
				setStatusFilter("all");
				setCaseQuery("");
				setSelectedResult(null);
			})
			.catch((err: Error) => {
				setError(err.message);
				setLoading(false);
			});
	};

	const availableProviders = useMemo(() => {
		if (!data) return [];
		const names = new Set<string>();

		for (const result of data.results) {
			names.add(result.provider_name);
		}

		for (const provider of data.manifest.providers) {
			names.add(provider.name);
		}

		// If there are no results (e.g., parse error / empty file), still show manifest entries.
		return [...names].sort().map((name) => ({ name }));
	}, [data]);

	const availableBenchmarks = useMemo(() => {
		if (!data) return [];
		const names = new Set<string>();

		for (const result of data.results) {
			names.add(result.benchmark_name);
		}

		for (const benchmark of data.manifest.benchmarks) {
			names.add(benchmark.name);
		}

		return [...names].sort().map((name) => ({ name }));
	}, [data]);

	useEffect(() => {
		if (selectedProvider === "all") return;
		if (availableProviders.some((p) => p.name === selectedProvider)) return;
		setSelectedProvider("all");
	}, [availableProviders, selectedProvider]);

	useEffect(() => {
		if (selectedBenchmark === "all") return;
		if (availableBenchmarks.some((b) => b.name === selectedBenchmark)) return;
		setSelectedBenchmark("all");
	}, [availableBenchmarks, selectedBenchmark]);

	const filteredResults = useMemo(() => {
		if (!data) return [];
		const query = caseQuery.trim().toLowerCase();
		return data.results.filter((r) => {
			if (selectedProvider !== "all" && r.provider_name !== selectedProvider)
				return false;
			if (selectedBenchmark !== "all" && r.benchmark_name !== selectedBenchmark)
				return false;
			if (statusFilter !== "all" && r.status !== statusFilter) return false;
			if (query && !r.case_id.toLowerCase().includes(query)) return false;
			return true;
		});
	}, [data, selectedProvider, selectedBenchmark, statusFilter, caseQuery]);

	const handleExport = () => {
		if (!data) return;
		const payload = JSON.stringify(data, null, 2);
		const blob = new Blob([payload], { type: "application/json" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `memorybench_${data.manifest.run_id}.json`;
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	};

	if (loading) {
		return (
			<div className="flex items-center justify-center py-20">
				<div className="flex items-center gap-3 text-gray-500">
					<Icon name="lucide:loader-2" className="w-6 h-6 animate-spin" />
					<span className="text-sm font-mono uppercase tracking-wider">
						Loading Results...
					</span>
				</div>
			</div>
		);
	}

	if (error) {
		return (
			<div className="flex flex-col items-center justify-center py-20 gap-4">
				<Icon name="lucide:alert-circle" className="w-12 h-12 text-red-500" />
				<div className="text-red-400 font-mono text-sm">Error: {error}</div>
				<button
					onClick={() => window.location.reload()}
					className="px-6 py-2 bg-hex-surface border border-white/20 hover:border-accent text-white text-xs font-bold uppercase tracking-wider clip-chamfer"
				>
					Retry
				</button>
			</div>
		);
	}

	if (!data) {
		return (
			<div className="flex items-center justify-center py-20">
				<div className="text-gray-500 font-mono text-sm">No data found.</div>
			</div>
		);
	}

	return (
		<>
			<Header data={data} onSelectRun={handleOpenRunPicker} onExport={handleExport} />
			<Dashboard data={data} />
			<ScoreOverview
				data={data}
				selectedProvider={selectedProvider}
				selectedBenchmark={selectedBenchmark}
			/>
			<Filters
				providers={availableProviders}
				benchmarks={availableBenchmarks}
				selectedProvider={selectedProvider}
				setSelectedProvider={setSelectedProvider}
				selectedBenchmark={selectedBenchmark}
				setSelectedBenchmark={setSelectedBenchmark}
				statusFilter={statusFilter}
				setStatusFilter={setStatusFilter}
				caseQuery={caseQuery}
				setCaseQuery={setCaseQuery}
				filteredCount={filteredResults.length}
				totalCount={data.results.length}
			/>
			<ResultsTable results={filteredResults} onSelect={setSelectedResult} />
			{selectedResult && (
				<Drilldown
					result={selectedResult}
					onClose={() => setSelectedResult(null)}
				/>
			)}
			{showRunPicker && (
				<RunPicker
					runs={availableRuns}
					currentRunId={data.manifest.run_id}
					onSelect={handleSelectRun}
					onClose={() => setShowRunPicker(false)}
					loading={loadingRuns}
				/>
			)}
		</>
	);
}

// --- Mount React ---
const container = document.getElementById("root");
if (container) {
	const root = createRoot(container);
	root.render(<App />);
}
