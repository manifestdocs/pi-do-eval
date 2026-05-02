<script lang="ts">
	import { sidebarItems, benchIndex, benchSidebarGroups } from "../../stores/runs.js";
	import {
		selectedSuiteRunId,
		selectedRunDir,
		selectedBenchId,
		expandedRuns,
		expandedBenchSuites,
		expandedRegressionGroups,
		sidebarView,
		selectSuiteRun,
		selectRun,
		selectBench,
		setSidebarView,
		toggleSuiteRun,
		toggleBenchSuite,
		toggleRegressionGroup,
		expandRegressionGroup,
	} from "../../stores/selection.js";
	import { benchComparisonAverage, benchFirstAverageDelta, benchProfileCountLabel } from "$lib/bench-view.js";
	import { scoreColor, deltaColor, formatDelta, formatDate } from "$lib/utils.js";

	const tabs = [
		{ id: "bench" as const, label: "Bench", caption: "Profile vs profile" },
		{ id: "regression" as const, label: "Regression", caption: "Drift over time" },
	] as const;
	const benchTab = tabs[0];
	const regressionTab = tabs[1];
</script>

<nav class="flex flex-col h-full overflow-y-auto bg-background-subtle border-r border-border-default">
	<div class="flex border-b border-border-default" role="tablist" aria-label="Sidebar view">
		{#each tabs as tab (tab.id)}
			<button
				type="button"
				role="tab"
				id="sidebar-tab-{tab.id}"
				aria-selected={$sidebarView === tab.id}
				aria-controls="sidebar-panel-{tab.id}"
				class="relative flex-1 px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider transition-colors"
				class:text-foreground={$sidebarView === tab.id}
				class:text-foreground-muted={$sidebarView !== tab.id}
				class:hover:text-foreground={$sidebarView !== tab.id}
				onclick={() => setSidebarView(tab.id)}
			>
				{tab.label}
				{#if $sidebarView === tab.id}
					<span class="absolute bottom-[-1px] left-3 right-3 h-[2px] bg-accent-blue"></span>
				{/if}
			</button>
		{/each}
	</div>

	<div class="flex-1 overflow-y-auto" role="tabpanel" id="sidebar-panel-{$sidebarView}" aria-labelledby="sidebar-tab-{$sidebarView}">
		{#if $sidebarView === "bench"}
			{@const caption = benchTab.caption}
			<div class="border-b border-border-muted px-4 py-2 text-[10.5px] text-foreground-subtle">
				{caption}
			</div>
			{#if $benchIndex.length === 0}
				<div class="px-5 py-4 text-[12.75px] text-foreground-muted">
					No bench runs yet. Use the Bench launcher to compare profiles.
				</div>
			{:else}
				{#each $benchSidebarGroups as group (group.suite)}
					<div class="border-b border-border-muted">
						<div class="flex items-center gap-1 px-3 py-1.5 hover:bg-background-muted transition-colors">
							<button
								type="button"
								class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[16px] leading-none text-foreground-muted transition-colors hover:bg-background-subtle hover:text-foreground"
								aria-label={$expandedBenchSuites.has(group.suite) ? `Collapse ${group.suite} bench runs` : `Expand ${group.suite} bench runs`}
								onclick={() => toggleBenchSuite(group.suite)}
							>
								<span class="inline-block transition-transform" class:rotate-90={$expandedBenchSuites.has(group.suite)}>▸</span>
							</button>
							<button
								type="button"
								class="flex min-w-0 flex-1 items-center gap-1.5 pr-1 text-left text-[12.75px]"
								onclick={() => toggleBenchSuite(group.suite)}
							>
								<span class="font-semibold text-[11px] tracking-wider uppercase text-foreground-muted">
									{group.suite}
								</span>
								<span class="ml-auto min-w-[4.5rem] text-right text-[11px] text-foreground-subtle tabular-nums">
									{group.benches.length}
								</span>
								<span class="min-w-[2.5rem] text-right text-[11px] font-mono tabular-nums" style="color: {group.latestDelta != null && group.latestDelta !== 0 ? deltaColor(group.latestDelta) : 'var(--color-foreground-subtle)'}">
									{group.latestDelta != null && group.latestDelta !== 0 ? formatDelta(group.latestDelta) : ""}
								</span>
								<span class="inline-block min-w-[2rem] text-center text-[11px] font-bold rounded px-1 py-0.5" style={group.latestComparisonAverage != null ? `background-color: ${scoreColor(group.latestComparisonAverage)}; color: var(--color-background)` : ""}>
									{group.latestComparisonAverage != null ? group.latestComparisonAverage : ""}
								</span>
							</button>
						</div>

						{#if $expandedBenchSuites.has(group.suite)}
							{#each group.benches as bench (bench.benchRunId)}
								{@const delta = benchFirstAverageDelta(bench)}
								{@const score = benchComparisonAverage(bench)}
								<button
									class="w-full flex items-center gap-1.5 pl-9 pr-3 py-1 text-left text-[11px] transition-colors hover:bg-background-muted"
									class:border-l-2={$selectedBenchId === bench.benchRunId}
									class:border-l-accent-blue={$selectedBenchId === bench.benchRunId}
									class:bg-background-muted={$selectedBenchId === bench.benchRunId}
									onclick={() => selectBench(bench.benchRunId, bench.suite)}
								>
									<span class="text-foreground-muted">{formatDate(bench.completedAt)}</span>
									<span class="ml-auto min-w-[4.5rem] text-right text-foreground-subtle tabular-nums">
										{benchProfileCountLabel(bench)}
									</span>
									<span class="min-w-[2.5rem] text-right font-mono tabular-nums" style="color: {delta != null && delta !== 0 ? deltaColor(delta) : 'var(--color-foreground-subtle)'}">
										{delta != null && delta !== 0 ? formatDelta(delta) : ""}
									</span>
									<span class="inline-block min-w-[2rem] text-center font-bold rounded px-1 py-0.5" style={score != null ? `background-color: ${scoreColor(score)}; color: var(--color-background)` : ""}>
										{score != null ? score : ""}
									</span>
								</button>
							{/each}
						{/if}
					</div>
				{/each}
			{/if}
		{:else}
			<div class="border-b border-border-muted px-4 py-2 text-[10.5px] text-foreground-subtle">
				{regressionTab.caption}
			</div>
			{#if $sidebarItems.length === 0}
				<div class="px-5 py-4 text-[12.75px] text-foreground-muted">
					No regression runs yet. Use the Regression launcher to start tracking drift.
				</div>
			{:else}
				{#each $sidebarItems as group (group.groupKey)}
			<div class="border-b border-border-muted">
				<div class="flex items-center gap-1 px-3 py-1.5 hover:bg-background-muted transition-colors">
					<button
						type="button"
						class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[16px] leading-none text-foreground-muted transition-colors hover:bg-background-subtle hover:text-foreground"
						aria-label={$expandedRegressionGroups.has(group.groupKey) ? `Collapse ${group.suite} ${group.workerModel}` : `Expand ${group.suite} ${group.workerModel}`}
						onclick={() => toggleRegressionGroup(group.groupKey)}
					>
						<span class="inline-block transition-transform" class:rotate-90={$expandedRegressionGroups.has(group.groupKey)}>▸</span>
					</button>
					<button
						type="button"
						class="flex min-w-0 flex-1 items-center gap-1.5 pr-1 text-left text-[12.75px]"
						onclick={() => toggleRegressionGroup(group.groupKey)}
					>
						<span class="flex min-w-0 flex-1 items-baseline gap-1.5 truncate">
							<span class="font-semibold text-[11px] tracking-wider uppercase text-foreground-muted">
								{group.suite}
							</span>
							<span class="text-[11px] text-foreground-subtle truncate">{group.workerModel}</span>
						</span>
						<span class="ml-auto min-w-[4.5rem] text-right text-[11px] text-foreground-subtle tabular-nums">
							{group.suiteRuns.length}
						</span>
						<span class="min-w-[2.5rem] text-right text-[11px] font-mono tabular-nums" style="color: {group.delta != null && group.delta !== 0 ? deltaColor(group.delta) : 'var(--color-foreground-subtle)'}">
							{group.delta != null && group.delta !== 0 ? formatDelta(group.delta) : ""}
						</span>
						<span class="inline-block min-w-[2rem] text-center text-[11px] font-bold rounded px-1 py-0.5" style={group.latestAvg != null ? `background-color: ${scoreColor(group.latestAvg)}; color: var(--color-background)` : ""}>
							{group.latestAvg != null ? group.latestAvg : ""}
						</span>
					</button>
				</div>

				{#if $expandedRegressionGroups.has(group.groupKey)}
					{#each group.suiteRuns as sr (sr.suiteRunId)}
						<div>
							<div
								class="flex items-center gap-1 pl-6 pr-3 py-1 hover:bg-background-muted transition-colors"
								class:border-l-2={$selectedSuiteRunId === sr.suiteRunId}
								class:border-l-accent-blue={$selectedSuiteRunId === sr.suiteRunId}
							>
								<button
									type="button"
									class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[16px] leading-none text-foreground-muted transition-colors hover:bg-background-subtle hover:text-foreground"
									aria-label={$expandedRuns.has(sr.suiteRunId) ? `Collapse ${sr.suiteRunId}` : `Expand ${sr.suiteRunId}`}
									onclick={() => toggleSuiteRun(sr.suiteRunId)}
								>
									<span class="inline-block transition-transform" class:rotate-90={$expandedRuns.has(sr.suiteRunId)}>▸</span>
								</button>
								<button
									type="button"
									class="flex min-w-0 flex-1 items-center gap-1.5 pr-1 text-left text-[11px]"
									onclick={() => { expandRegressionGroup(group.groupKey); selectSuiteRun(group.suite, sr.suiteRunId); }}
								>
									<span class="text-foreground-muted">{formatDate(sr.children[0]?.startedAt)}</span>
									{#if sr.status === "running"}
										<span class="text-accent-green text-[10.5px] font-bold animate-pulse">LIVE</span>
									{/if}
									<span class="ml-auto min-w-[4.5rem] text-right text-foreground-subtle tabular-nums">
										{sr.finishedRuns}/{sr.totalRuns}{sr.epochs > 1 ? ` ×${sr.epochs}` : ""}
									</span>
									<!-- Reserved delta slot keeps score badges aligned with parent rows
									     even though suite-runs don't carry a per-run drift number. -->
									<span class="min-w-[2.5rem] text-right" aria-hidden="true"></span>
									<span class="inline-block min-w-[2rem] text-center font-bold rounded px-1 py-0.5" style={sr.averageOverall != null ? `background-color: ${scoreColor(sr.averageOverall)}; color: var(--color-background)` : ""}>
										{sr.averageOverall != null ? sr.averageOverall : ""}
									</span>
								</button>
							</div>

							{#if $expandedRuns.has(sr.suiteRunId)}
								<div class="pl-9">
									{#each sr.children as run (run.dir)}
										<button
											class="w-full flex items-center gap-1.5 border-l border-border-muted pl-5 pr-4 py-1 text-left text-[11px] transition-colors hover:bg-background-muted"
											class:border-l-2={$selectedRunDir === run.dir}
											class:border-l-accent-blue={$selectedRunDir === run.dir}
											class:bg-background-muted={$selectedRunDir === run.dir}
											onclick={() => selectRun(run.dir)}
											title={`${run.trial}/${run.variant}`}
										>
											<span class="text-foreground truncate">{run.trial}/{run.variant}</span>
											{#if run.status === "running"}
												<span class="text-accent-green text-[10.5px] font-bold animate-pulse">LIVE</span>
											{:else if run.status !== "completed"}
												<span class="text-accent-red text-[10.5px]">{run.status}</span>
											{/if}
											<!-- Empty meta + delta slots reserve the same column widths as
											     other row types so score badges line up vertically. -->
											<span class="ml-auto min-w-[4.5rem] text-right" aria-hidden="true"></span>
											<span class="min-w-[2.5rem] text-right" aria-hidden="true"></span>
											<span class="inline-block min-w-[2rem] text-center font-bold rounded px-1 py-0.5" style={run.status !== "running" && run.overall != null ? `background-color: ${scoreColor(run.overall)}; color: var(--color-background)` : ""}>
												{run.status !== "running" && run.overall != null ? run.overall : ""}
											</span>
										</button>
									{/each}
								</div>
							{/if}
						</div>
					{/each}
				{/if}
			</div>
		{/each}
			{/if}
		{/if}
	</div>
</nav>
