<script lang="ts">
	import Launcher from "$lib/components/Launcher.svelte";
	import RegressionBadge from "$lib/components/RegressionBadge.svelte";
	import { launcherConfig } from "../../../../stores/launcher.js";
	import { suiteIndex, runs } from "../../../../stores/runs.js";
	import { activeProject } from "../../../../stores/projects.js";
	import { computeProjectStats } from "$lib/project-stats.js";
	import { deltaColor, formatDate, formatDelta, scoreColor } from "$lib/utils.js";

	let stats = $derived(computeProjectStats($launcherConfig, $suiteIndex));
	let recentRuns = $derived([...$runs].slice(0, 5));
</script>

<div class="grid h-full grid-cols-[320px_1fr]">
	<aside class="overflow-y-auto border-r border-border-default bg-background-subtle">
		<Launcher />
	</aside>

	<main class="overflow-y-auto p-6">
		<div class="mx-auto max-w-3xl space-y-6">
			<section>
				<h2 class="text-[14px] font-semibold text-foreground">At a glance</h2>
				<div class="mt-3 grid grid-cols-3 gap-3">
					<div class="rounded border border-border-default bg-background-subtle p-3">
						<div class="text-[10px] uppercase tracking-wider text-foreground-subtle">Trials</div>
						<div class="mt-1 text-[20px] font-semibold text-foreground">{stats.trialCount}</div>
					</div>
					<div class="rounded border border-border-default bg-background-subtle p-3">
						<div class="text-[10px] uppercase tracking-wider text-foreground-subtle">Suites</div>
						<div class="mt-1 text-[20px] font-semibold text-foreground">{stats.suiteCount}</div>
					</div>
					<div class="rounded border border-border-default bg-background-subtle p-3">
						<div class="text-[10px] uppercase tracking-wider text-foreground-subtle">Suite runs</div>
						<div class="mt-1 text-[20px] font-semibold text-foreground">{stats.suiteRunCount}</div>
					</div>
				</div>
			</section>

			{#if stats.latestSuiteRun}
				<section>
					<h2 class="text-[14px] font-semibold text-foreground">Latest suite run</h2>
					<div class="mt-3 rounded border border-border-default bg-background-subtle p-4">
						<div class="flex items-start justify-between gap-4">
							<div class="min-w-0">
								<div class="flex items-center gap-2">
									<span class="text-[12px] font-semibold text-foreground">{stats.latestSuiteRun.suite}</span>
									<RegressionBadge status={stats.latestSuiteRun.regressionStatus} />
								</div>
								<div class="mt-0.5 text-[11px] text-foreground-muted">
									{formatDate(stats.latestSuiteRun.completedAt)}
								</div>
								{#if stats.latestSuiteRun.hardFailureCount > 0}
									<div class="mt-1 text-[11px] text-accent-red">
										{stats.latestSuiteRun.hardFailureCount} hard failures
									</div>
								{/if}
							</div>
							<div class="flex flex-col items-end gap-1">
								<span
									class="inline-block min-w-[2.5rem] rounded px-1.5 py-0.5 text-center text-[14px] font-bold"
									style="background-color: {scoreColor(stats.latestSuiteRun.averageOverall)}; color: var(--color-background)"
								>
									{stats.latestSuiteRun.averageOverall}
								</span>
								{#if stats.latestSuiteRun.delta != null && stats.latestSuiteRun.delta !== 0}
									<span class="font-mono text-[11px]" style="color: {deltaColor(stats.latestSuiteRun.delta)}">
										{formatDelta(Math.round(stats.latestSuiteRun.delta * 10) / 10)}
									</span>
								{/if}
							</div>
						</div>
						{#if $activeProject}
							<a
								href="/projects/{$activeProject.id}/runs"
								class="mt-3 inline-block text-[11px] font-semibold uppercase tracking-wider text-accent-blue hover:underline"
							>
								View runs →
							</a>
						{/if}
					</div>
				</section>
			{/if}

			{#if recentRuns.length > 0}
				<section>
					<h2 class="text-[14px] font-semibold text-foreground">Recent runs</h2>
					<div class="mt-3 divide-y divide-border-muted rounded border border-border-default bg-background-subtle">
						{#each recentRuns as run (run.dir)}
							<div class="flex items-center gap-3 px-3 py-2">
								<div class="min-w-0 flex-1">
									<div class="truncate text-[12px] text-foreground">{run.trial}/{run.variant}</div>
									<div class="text-[10.5px] text-foreground-subtle">
										{formatDate(run.startedAt)}
										{#if run.suite}· {run.suite}{/if}
									</div>
								</div>
								{#if run.status === "running"}
									<span class="text-[10.5px] font-bold text-accent-green">LIVE</span>
								{:else if run.status !== "completed"}
									<span class="text-[10.5px] text-accent-red">{run.status}</span>
								{:else}
									<span
										class="inline-block min-w-[2rem] rounded px-1 py-0.5 text-center text-[11px] font-bold"
										style="background-color: {scoreColor(run.overall)}; color: var(--color-background)"
									>
										{run.overall}
									</span>
								{/if}
							</div>
						{/each}
					</div>
				</section>
			{/if}

			{#if !$launcherConfig}
				<div class="rounded border border-dashed border-border-default bg-background-subtle p-4 text-[12px] text-foreground-muted">
					Launcher config isn't available. Check that this project has a valid <code>eval/</code> directory.
				</div>
			{/if}
		</div>
	</main>
</div>
