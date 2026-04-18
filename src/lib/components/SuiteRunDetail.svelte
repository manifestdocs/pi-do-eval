<script lang="ts">
	import { selectRun } from "../../stores/selection.js";
	import { scoreColor, deltaColor, formatDelta, formatDate, formatDuration } from "$lib/utils.js";
	import type { SuiteReport, SuiteComparisonEntry } from "$eval/types.js";

	let { report }: { report: SuiteReport } = $props();

	let comparison = $derived(report.comparison);

	function severityLabel(sev: string | undefined): string {
		if (sev === "hard") return "HARD";
		if (sev === "clear") return "CLEAR";
		if (sev === "drift") return "drift";
		return "ok";
	}

	function severityColor(sev: string | undefined): string {
		if (sev === "hard") return "var(--color-accent-red)";
		if (sev === "clear") return "var(--color-accent-orange)";
		if (sev === "drift") return "var(--color-accent-orange)";
		return "var(--color-accent-green)";
	}
</script>

<div>
	<h2 class="text-xl font-bold mb-1">
		Suite: {report.suite}
		<span class="text-foreground-subtle font-normal text-sm ml-2">{formatDate(report.startedAt)}</span>
	</h2>

	<div class="flex flex-wrap gap-4 mb-6 mt-4">
		<dl class="bg-background-subtle rounded px-4 py-2 border border-border-muted">
			<dt class="text-[10px] uppercase tracking-wider text-foreground-subtle">Runs</dt>
			<dd class="text-lg font-bold">{report.summary.totalRuns}</dd>
		</dl>
		<dl class="bg-background-subtle rounded px-4 py-2 border border-border-muted">
			<dt class="text-[10px] uppercase tracking-wider text-foreground-subtle">Completed</dt>
			<dd class="text-lg font-bold">{report.summary.completedRuns}</dd>
		</dl>
		<dl class="bg-background-subtle rounded px-4 py-2 border border-border-muted">
			<dt class="text-[10px] uppercase tracking-wider text-foreground-subtle">Score</dt>
			<dd class="text-lg font-bold">{report.summary.averageOverall}</dd>
		</dl>
		{#if report.epochs && report.epochs > 1}
			<dl class="bg-background-subtle rounded px-4 py-2 border border-border-muted">
				<dt class="text-[10px] uppercase tracking-wider text-foreground-subtle">Epochs</dt>
				<dd class="text-lg font-bold">{report.epochs}</dd>
			</dl>
		{/if}
		{#if report.workerModel}
			<dl class="bg-background-subtle rounded px-4 py-2 border border-border-muted">
				<dt class="text-[10px] uppercase tracking-wider text-foreground-subtle">Model</dt>
				<dd class="text-sm font-mono">{report.workerModel}</dd>
			</dl>
		{/if}
	</div>

	<!-- Entries table -->
	<div class="bg-background-subtle rounded border border-border-muted p-4 mb-6">
		<h3 class="text-xs font-semibold uppercase tracking-wider text-foreground-subtle mb-3">Trial Results</h3>
		<div class="overflow-x-auto">
			<table class="w-full text-sm">
				<thead>
					<tr class="text-[10px] uppercase tracking-wider text-foreground-subtle">
						<th class="text-left py-2 pr-4">Trial / Variant</th>
						<th class="text-center py-2 px-2">Status</th>
						<th class="text-center py-2 px-2">Overall</th>
						{#each Object.keys(report.entries[0]?.deterministic ?? {}) as key}
							<th class="text-center py-2 px-2">{key}</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each report.entries as entry (entry.runDir)}
						<tr
							class="border-t border-border-muted hover:bg-background-muted cursor-pointer transition-colors"
							onclick={() => selectRun(entry.runDir)}
						>
							<td class="py-2 pr-4 font-medium">{entry.trial}/{entry.variant}</td>
							<td class="py-2 px-2 text-center">
								{#if entry.status !== "completed"}
									<span class="text-accent-red text-xs" title="Run {entry.status}">{entry.status}</span>
								{:else if entry.verifyPassed === false}
									<span class="text-accent-orange text-xs" title="Run completed but the verify step did not pass">verify failed</span>
								{:else}
									<span class="text-accent-green text-xs" title="Run completed">✓</span>
								{/if}
							</td>
							<td class="py-2 px-2 text-center">
								<span
									class="inline-block min-w-[2rem] text-center text-xs font-bold rounded px-1.5 py-0.5"
									style="background-color: {scoreColor(entry.overall)}; color: var(--color-background)"
								>
									{entry.overall}
								</span>
							</td>
							{#each Object.entries(entry.deterministic) as [, value]}
								<td class="py-2 px-2 text-center text-foreground-muted">{value}</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>

	<!-- Regression comparison -->
	{#if comparison}
		<div class="bg-background-subtle rounded border border-border-muted p-4">
			<h3 class="text-xs font-semibold uppercase tracking-wider text-foreground-subtle mb-3">
				Regression Analysis
				<span class="text-foreground-muted font-normal normal-case">
					vs {comparison.baselineSuiteRunId}
				</span>
			</h3>

			<div class="flex gap-3 mb-3 text-xs">
				{#if comparison.hardRegressionCount > 0}
					<span class="text-accent-red font-bold">{comparison.hardRegressionCount} hard</span>
				{/if}
				{#if comparison.clearRegressionCount > 0}
					<span class="text-accent-orange font-bold">{comparison.clearRegressionCount} clear</span>
				{/if}
				{#if comparison.driftCount > 0}
					<span class="text-accent-orange">{comparison.driftCount} drift</span>
				{/if}
				{#if !comparison.hasRegression}
					<span class="text-accent-green">No regressions</span>
				{/if}
			</div>

			<div class="space-y-1">
				{#each comparison.entries as entry}
					<div class="flex items-center gap-2 text-sm py-1">
						<span class="w-48 truncate">{entry.trial}/{entry.variant}</span>
						{#if entry.deltaOverall != null}
							<span class="font-mono text-xs w-12 text-right" style="color: {deltaColor(entry.deltaOverall)}">
								{formatDelta(entry.deltaOverall)}
							</span>
						{/if}
						<span class="text-xs font-bold" style="color: {severityColor(entry.severity)}">
							{severityLabel(entry.severity)}
						</span>
						{#if entry.findings.length > 0}
							<span class="text-xs text-foreground-muted truncate">{entry.findings[0]}</span>
						{/if}
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>
