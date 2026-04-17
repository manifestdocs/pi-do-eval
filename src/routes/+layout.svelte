<script lang="ts">
	import "../app.css";
	import { onMount } from "svelte";
	import TopNav from "$lib/components/TopNav.svelte";
	import { activeProjectId, loadProjects, projectsLoading } from "../stores/projects.js";
	import { launcherConfig, loadLauncherConfig } from "../stores/launcher.js";
	import { disconnectSSE } from "../stores/sse.js";

	let { children } = $props();

	onMount(() => {
		void loadProjects();
		return () => disconnectSSE();
	});

	// Keep launcher config loaded for the active project so the Run popover is
	// available from any route (Dashboard, Projects list, etc.), not just from
	// within /projects/[id]/*.
	$effect(() => {
		const projectId = $activeProjectId;
		if (projectId && !$launcherConfig) {
			void loadLauncherConfig(projectId);
		}
	});
</script>

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;700&family=IBM+Plex+Sans:wght@400;600;700&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<div class="flex flex-col h-dvh">
	<TopNav />
	<div class="flex-1 overflow-hidden">
		{#if $projectsLoading}
			<div class="flex items-center justify-center h-full text-foreground-muted">Loading...</div>
		{:else}
			{@render children()}
		{/if}
	</div>
</div>
