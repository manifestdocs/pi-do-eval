<script lang="ts">
	import { sidebarItems, benchIndex } from "../../stores/runs.js";
	import {
		selectedSuiteName,
		selectedSuiteRunId,
		selectedRunDir,
		selectedBenchId,
		expandedSuites,
		expandedRuns,
		selectSuiteName,
		selectSuiteRun,
		selectRun,
		selectBench,
		toggleSuite,
		toggleSuiteRun,
	} from "../../stores/selection.js";
	import { scoreColor, deltaColor, formatDelta, formatDate } from "$lib/utils.js";
</script>

<nav class="flex flex-col h-full overflow-y-auto bg-background-subtle border-r border-border-default">
	<div class="px-4 py-2 text-[10.5px] font-semibold tracking-wider uppercase text-foreground-subtle border-b border-border-muted">
		Suites & Runs
	</div>

	{#if $sidebarItems.length === 0 && $benchIndex.length === 0}
		<div class="px-5 py-4 text-[12.75px] text-foreground-muted">No suite runs yet.</div>
	{/if}

	<div class="flex-1 overflow-y-auto">
		{#each $sidebarItems as suite (suite.suite)}
			<div class="border-b border-border-muted">
				<div
					class="flex items-center gap-1 px-3 py-1.5 hover:bg-background-muted transition-colors"
					class:border-l-2={$selectedSuiteName === suite.suite && !$selectedSuiteRunId}
					class:border-l-accent-blue={$selectedSuiteName === suite.suite && !$selectedSuiteRunId}
				>
					<button
						type="button"
						class="flex h-7 w-7 shrink-0 items-center justify-center rounded text-[12.75px] text-foreground-subtle transition-colors hover:bg-background-subtle"
						aria-label={$expandedSuites.has(suite.suite) ? `Collapse ${suite.suite}` : `Expand ${suite.suite}`}
						onclick={() => toggleSuite(suite.suite)}
					>
						<span class="transition-transform" class:rotate-90={$expandedSuites.has(suite.suite)}>&#9656;</span>
					</button>
					<button
						type="button"
						class="flex min-w-0 flex-1 items-center gap-1.5 pr-1 text-left text-[12.75px]"
						onclick={() => selectSuiteName(suite.suite)}
					>
						<span class="font-semibold text-[11px] tracking-wider uppercase text-foreground-muted">
							{suite.suite}
						</span>
						<span class="text-[11px] text-foreground-subtle ml-auto">
							{suite.suiteRuns.length}
						</span>
						{#if suite.delta != null && suite.delta !== 0}
							<span class="text-[11px] font-mono" style="color: {deltaColor(suite.delta)}">
								{formatDelta(suite.delta)}
							</span>
						{/if}
						{#if suite.latestAvg != null}
							<span
								class="inline-block min-w-[2rem] text-center text-[11px] font-bold rounded px-1 py-0.5"
								style="background-color: {scoreColor(suite.latestAvg)}; color: var(--color-background)"
							>
								{suite.latestAvg}
							</span>
						{/if}
					</button>
				</div>

				{#if $expandedSuites.has(suite.suite)}
					{#each suite.suiteRuns as sr (sr.suiteRunId)}
						<div>
							<div
								class="flex items-center gap-1 pl-6 pr-3 py-1 hover:bg-background-muted transition-colors"
								class:border-l-2={$selectedSuiteRunId === sr.suiteRunId}
								class:border-l-accent-blue={$selectedSuiteRunId === sr.suiteRunId}
							>
								<button
									type="button"
									class="flex h-7 w-7 shrink-0 items-center justify-center rounded text-[12.75px] text-foreground-subtle transition-colors hover:bg-background-subtle"
									aria-label={$expandedRuns.has(sr.suiteRunId) ? `Collapse ${sr.suiteRunId}` : `Expand ${sr.suiteRunId}`}
									onclick={() => toggleSuiteRun(sr.suiteRunId)}
								>
									<span class="transition-transform" class:rotate-90={$expandedRuns.has(sr.suiteRunId)}>&#9656;</span>
								</button>
								<button
									type="button"
									class="flex min-w-0 flex-1 items-center gap-1.5 pr-1 text-left text-[11px]"
									onclick={() => selectSuiteRun(suite.suite, sr.suiteRunId)}
								>
									<span class="text-foreground-muted">{formatDate(sr.children[0]?.startedAt)}</span>
									{#if sr.status === "running"}
										<span class="text-accent-green text-[10.5px] font-bold animate-pulse">LIVE</span>
									{/if}
									<span class="text-foreground-subtle ml-auto">{sr.finishedRuns}/{sr.totalRuns}</span>
									{#if sr.epochs > 1}
										<span class="text-[10.5px] text-foreground-muted">x{sr.epochs}</span>
									{/if}
									{#if sr.averageOverall != null}
										<span
											class="inline-block min-w-[2rem] text-center font-bold rounded px-1 py-0.5"
											style="background-color: {scoreColor(sr.averageOverall)}; color: var(--color-background)"
										>
											{sr.averageOverall}
										</span>
									{/if}
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
										>
											<span class="text-foreground">{run.trial}/{run.variant}</span>
											{#if run.status === "running"}
												<span class="text-accent-green text-[10.5px] font-bold animate-pulse">LIVE</span>
											{:else if run.status !== "completed"}
												<span class="text-accent-red text-[10.5px]">{run.status}</span>
											{/if}
											<span class="ml-auto">
												{#if run.status !== "running"}
													<span
														class="inline-block min-w-[2rem] text-center font-bold rounded px-1 py-0.5"
														style="background-color: {scoreColor(run.overall)}; color: var(--color-background)"
													>
														{run.overall}
													</span>
												{/if}
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
	</div>

	{#if $benchIndex.length > 0}
		<div class="border-t border-border-default">
			<div class="px-4 py-2 text-[10.5px] font-semibold tracking-wider uppercase text-foreground-subtle">
				Benchmarks
			</div>
			{#each $benchIndex as bench (bench.benchRunId)}
				<button
					class="w-full flex items-center gap-1.5 px-4 py-1.5 text-left text-[11px] transition-colors hover:bg-background-muted"
					class:border-l-2={$selectedBenchId === bench.benchRunId}
					class:border-l-accent-blue={$selectedBenchId === bench.benchRunId}
					onclick={() => selectBench(bench.benchRunId)}
				>
					<span class="text-foreground">{bench.suite}</span>
					<span class="text-foreground-subtle">{bench.models.length} models</span>
					<span class="ml-auto text-[10.5px] text-foreground-subtle">{formatDate(bench.completedAt)}</span>
				</button>
			{/each}
		</div>
	{/if}
</nav>
