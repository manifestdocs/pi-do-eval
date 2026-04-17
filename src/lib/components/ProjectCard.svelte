<script lang="ts">
	import type { ProjectStats } from "$lib/project-stats.js";
	import { deltaColor, formatDate, formatDelta, scoreColor } from "$lib/utils.js";
	import type { ProjectSummary } from "../../stores/projects.js";

	let {
		project,
		stats,
		loading = false,
	}: { project: ProjectSummary; stats: ProjectStats | null; loading?: boolean } = $props();

	let latest = $derived(stats?.latestSuiteRun ?? null);
</script>

<a
	href="/projects/{project.id}/runs"
	class="block rounded border border-border-default bg-background-subtle p-4 transition-colors hover:border-foreground-subtle"
>
	<div class="flex items-start justify-between gap-3">
		<div class="min-w-0 flex-1">
			<h3 class="truncate text-[14px] font-semibold text-foreground">{project.name}</h3>
			<p class="mt-0.5 truncate text-[11px] text-foreground-muted" title={project.evalDir}>
				{project.evalDir}
			</p>
		</div>
		{#if latest}
			<div class="flex flex-col items-end gap-1">
				<span
					class="inline-block min-w-[2.5rem] rounded px-1.5 py-0.5 text-center text-[12px] font-bold"
					style="background-color: {scoreColor(latest.averageOverall)}; color: var(--color-background)"
				>
					{latest.averageOverall}
				</span>
				{#if latest.delta != null && latest.delta !== 0}
					<span class="font-mono text-[11px]" style="color: {deltaColor(latest.delta)}">
						{formatDelta(Math.round(latest.delta * 10) / 10)}
					</span>
				{/if}
			</div>
		{/if}
	</div>

	<div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-foreground-muted">
		{#if loading && !stats}
			<span class="text-foreground-subtle">Loading…</span>
		{:else if !stats?.configAvailable}
			<span class="text-accent-red">Config unavailable</span>
		{:else}
			<span><strong class="text-foreground">{stats.trialCount}</strong> trials</span>
			<span><strong class="text-foreground">{stats.suiteCount}</strong> suites</span>
			<span><strong class="text-foreground">{stats.suiteRunCount}</strong> suite runs</span>
			{#if latest}
				<span class="ml-auto text-foreground-subtle">
					Last run {formatDate(latest.completedAt)} · {latest.suite}
				</span>
			{/if}
		{/if}
	</div>
</a>
