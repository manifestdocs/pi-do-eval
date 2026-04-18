<script lang="ts">
	import "../app.css";
	import { onMount } from "svelte";
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import TopNav from "$lib/components/TopNav.svelte";
	import { activeProjectId, loadProjects, projectsLoading } from "../stores/projects.js";
	import { disconnectSSE } from "../stores/sse.js";
	import { get } from "svelte/store";

	let { children } = $props();
	let initialRedirectChecked = false;

	onMount(() => {
		void loadProjects().then(() => void maybeRedirectToRunning());
		return () => disconnectSSE();
	});

	// If a run is already in flight when the app loads, jump straight to
	// the runs tab so the user lands on the thing that's happening.
	async function maybeRedirectToRunning() {
		if (initialRedirectChecked) return;
		initialRedirectChecked = true;
		const pathname = page.url?.pathname ?? "/";
		// Only hijack when the user landed on a non-project route.
		if (pathname.startsWith("/projects/")) return;
		const projectId = get(activeProjectId);
		if (!projectId) return;
		try {
			const statusResp = await fetch(
				`/api/projects/${encodeURIComponent(projectId)}/launcher?status`,
			);
			if (!statusResp.ok) return;
			const status = (await statusResp.json()) as { active?: boolean };
			if (status.active) {
				void goto(`/projects/${encodeURIComponent(projectId)}/runs`);
			}
		} catch {
			// Ignore — best-effort redirect only.
		}
	}
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
