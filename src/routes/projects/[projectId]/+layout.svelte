<script lang="ts">
	import { page } from "$app/state";
	import { goto } from "$app/navigation";
	import Launcher from "$lib/components/Launcher.svelte";
	import ProjectTabs from "$lib/components/ProjectTabs.svelte";
	import {
		activeProjectId,
		projects,
		projectsLoading,
		selectActiveProject,
	} from "../../../stores/projects.js";
	import {
		loadInitialData,
		resetCurrentReports,
		resetRunData,
	} from "../../../stores/runs.js";
	import { loadLauncherConfig, resetLauncherConfig } from "../../../stores/launcher.js";
	import { connectSSE, disconnectSSE } from "../../../stores/sse.js";
	import { resetSelection } from "../../../stores/selection.js";

	let { children } = $props();

	let routeProjectId = $derived(page.params.projectId);
	let knownProject = $derived($projects.find((project) => project.id === routeProjectId) ?? null);

	$effect(() => {
		const projectId = routeProjectId;
		if (!projectId) return;

		// Wait for registry
		if ($projectsLoading) return;

		// Unknown project → bounce back to projects list
		if ($projects.length > 0 && !knownProject) {
			void goto("/projects");
			return;
		}

		if (!knownProject) return;

		let cancelled = false;

		resetSelection();
		resetRunData();
		resetCurrentReports();
		resetLauncherConfig();
		disconnectSSE();

		// Set client-side active project immediately so API calls use the right project,
		// and persist the selection server-side asynchronously for next launch.
		if ($activeProjectId !== projectId) {
			activeProjectId.set(projectId);
			void selectActiveProject(projectId);
		}

		void Promise.all([loadInitialData(projectId), loadLauncherConfig(projectId)]).then(() => {
			if (cancelled) return;
			connectSSE(projectId);
		});

		return () => {
			cancelled = true;
		};
	});

</script>

{#if $projectsLoading}
	<div class="flex items-center justify-center h-full text-foreground-muted">Loading project…</div>
{:else if !knownProject}
	<div class="flex items-center justify-center h-full text-foreground-muted">
		Project not found. <a href="/" class="ml-1 underline">Back to dashboard</a>
	</div>
{:else}
	<div class="flex h-full flex-col">
		<header class="grid grid-cols-[320px_1fr] items-center border-b border-border-default bg-background-subtle">
			<div class="min-w-0 px-5 py-3">
				<h1 class="truncate text-[15px] font-semibold text-foreground">{knownProject.name}</h1>
				<p class="truncate text-[11px] text-foreground-muted" title={knownProject.evalDir}>
					{knownProject.evalDir}
				</p>
			</div>
			<div class="flex items-center px-5 py-3">
				<Launcher />
			</div>
		</header>

		<ProjectTabs projectId={knownProject.id} />

		<div class="flex-1 overflow-hidden">
			{@render children()}
		</div>
	</div>
{/if}
