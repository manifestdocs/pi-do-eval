<script lang="ts">
	import { page } from "$app/state";

	let { projectId }: { projectId: string } = $props();

	const tabs = [
		{ slug: "overview", label: "Overview" },
		{ slug: "trials", label: "Trials" },
		{ slug: "suites", label: "Suites" },
		{ slug: "runs", label: "Runs" },
		{ slug: "settings", label: "Settings" },
	];

	let pathname = $derived(page.url?.pathname ?? "");

	function hrefFor(slug: string): string {
		return `/projects/${encodeURIComponent(projectId)}/${slug}`;
	}

	function isActive(slug: string): boolean {
		return pathname.startsWith(hrefFor(slug));
	}
</script>

<nav class="flex items-center gap-1 border-b border-border-default bg-background px-5">
	{#each tabs as tab (tab.slug)}
		<a
			href={hrefFor(tab.slug)}
			class="relative px-3 py-2 text-[12px] font-semibold uppercase tracking-wider transition-colors"
			class:text-foreground={isActive(tab.slug)}
			class:text-foreground-muted={!isActive(tab.slug)}
			class:hover:text-foreground={!isActive(tab.slug)}
		>
			{tab.label}
			{#if isActive(tab.slug)}
				<span class="absolute bottom-[-1px] left-0 right-0 h-[2px] bg-accent-blue"></span>
			{/if}
		</a>
	{/each}
</nav>
