<script lang="ts">
	import { onMount } from "svelte";
	import ProjectCard from "$lib/components/ProjectCard.svelte";
	import { projects, projectsLoading } from "../../stores/projects.js";
	import {
		allProjectStats,
		loadAllProjectStats,
		projectStatsLoading,
	} from "../../stores/project-stats.js";

	onMount(() => {
		void loadAllProjectStats();
	});

	let sortedProjects = $derived(
		[...$projects].sort((a, b) => a.name.localeCompare(b.name)),
	);
</script>

<main class="mx-auto max-w-5xl overflow-y-auto p-6">
	<div class="mb-6 flex items-end justify-between">
		<div>
			<h1 class="text-[20px] font-semibold text-foreground">Projects</h1>
			<p class="mt-1 text-[12px] text-foreground-muted">
				Every project registered with pi-do-eval.
			</p>
		</div>
		<a
			href="/projects/new"
			class="rounded bg-accent-blue px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-background transition-colors hover:brightness-110"
		>
			New Project
		</a>
	</div>

	{#if $projectsLoading && $projects.length === 0}
		<div class="flex items-center justify-center py-16 text-foreground-muted">Loading projects…</div>
	{:else if $projects.length === 0}
		<div class="rounded border border-dashed border-border-default bg-background-subtle px-6 py-12 text-center text-[12px] text-foreground-muted">
			No projects yet.
		</div>
	{:else}
		<div class="flex flex-col gap-3">
			{#each sortedProjects as project (project.id)}
				<ProjectCard
					{project}
					stats={$allProjectStats[project.id] ?? null}
					loading={$projectStatsLoading[project.id] ?? false}
				/>
			{/each}
		</div>
	{/if}
</main>
