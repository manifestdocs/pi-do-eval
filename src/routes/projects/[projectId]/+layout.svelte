<script lang="ts">
	import { page } from "$app/state";
	import { goto } from "$app/navigation";
	import ProjectTabs from "$lib/components/ProjectTabs.svelte";
	import {
		activeProjectId,
		projects,
		projectsLoading,
		removeProject,
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
	let confirmRemove = $state(false);

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

	async function doRemove() {
		if (!knownProject) return;
		await removeProject(knownProject.id);
		confirmRemove = false;
		void goto("/projects");
	}
</script>

{#if $projectsLoading}
	<div class="flex items-center justify-center h-full text-foreground-muted">Loading project…</div>
{:else if !knownProject}
	<div class="flex items-center justify-center h-full text-foreground-muted">
		Project not found. <a href="/projects" class="ml-1 underline">Back to projects</a>
	</div>
{:else}
	<div class="flex h-full flex-col">
		<header class="flex items-center gap-4 border-b border-border-default bg-background-subtle px-5 py-3">
			<a href="/projects" class="text-[11px] uppercase tracking-wider text-foreground-muted hover:text-foreground">
				← Projects
			</a>
			<div class="min-w-0 flex-1">
				<h1 class="truncate text-[15px] font-semibold text-foreground">{knownProject.name}</h1>
				<p class="truncate text-[11px] text-foreground-muted" title={knownProject.evalDir}>
					{knownProject.evalDir}
				</p>
			</div>
			{#if confirmRemove}
				<div class="flex items-center gap-2 text-[11px] text-foreground-muted">
					<span>Remove?</span>
					<button
						type="button"
						class="rounded border border-accent-red px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent-red transition-colors hover:bg-accent-red hover:text-background"
						onclick={() => void doRemove()}
					>
						Confirm
					</button>
					<button
						type="button"
						class="rounded border border-border-default px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-foreground-muted hover:text-foreground"
						onclick={() => (confirmRemove = false)}
					>
						Cancel
					</button>
				</div>
			{:else}
				<button
					type="button"
					class="rounded border border-border-default px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-foreground-muted transition-colors hover:border-foreground-subtle hover:text-foreground"
					onclick={() => (confirmRemove = true)}
				>
					Remove
				</button>
			{/if}
		</header>

		<ProjectTabs projectId={knownProject.id} />

		<div class="flex-1 overflow-hidden">
			{@render children()}
		</div>
	</div>
{/if}
