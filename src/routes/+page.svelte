<script lang="ts">
	import { onMount } from "svelte";
	import ProjectCard from "$lib/components/ProjectCard.svelte";
	import { projects, projectsLoading } from "../stores/projects.js";
	import {
		allProjectStats,
		loadAllProjectStats,
		projectStatsLoading,
	} from "../stores/project-stats.js";

	onMount(() => {
		void loadAllProjectStats();
	});

	// Reload stats when the projects list changes (e.g. after adding a project)
	let lastProjectIds = "";
	$effect(() => {
		const ids = $projects.map((project) => project.id).join(",");
		if (ids && ids !== lastProjectIds) {
			lastProjectIds = ids;
			void loadAllProjectStats();
		}
	});

	let sortedProjects = $derived(
		[...$projects].sort((a, b) => {
			const aTime = new Date(a.lastSelectedAt || a.updatedAt).getTime();
			const bTime = new Date(b.lastSelectedAt || b.updatedAt).getTime();
			return bTime - aTime;
		}),
	);
</script>

<main class="mx-auto max-w-5xl overflow-y-auto p-6">
	<div class="mb-6 flex items-end justify-between">
		<div>
			<h1 class="text-[20px] font-semibold text-foreground">Dashboard</h1>
			<p class="mt-1 text-[12px] text-foreground-muted">
				Eval projects and their latest suite run at a glance.
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
		<div
			class="rounded border border-dashed border-border-default bg-background-subtle px-6 py-12 text-center"
		>
			<h2 class="text-[16px] font-semibold text-foreground">Set up your first project</h2>
			<p class="mx-auto mt-2 max-w-md text-[12px] text-foreground-muted">
				Point pi-do-eval at a repo with an <code>eval/</code> directory, or scaffold one into a
				repo that doesn't have one yet.
			</p>
			<a
				href="/projects/new"
				class="mt-4 inline-block rounded bg-accent-blue px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-background transition-colors hover:brightness-110"
			>
				Set up first project
			</a>
		</div>
	{:else}
		<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
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
