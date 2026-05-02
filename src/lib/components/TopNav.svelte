<script lang="ts">
	import { page } from "$app/state";

	const tabs = [
		{ slug: "runs", label: "Runs" },
		{ slug: "trials", label: "Trials" },
		{ slug: "suites", label: "Suites" },
	];

	let pathname = $derived(page.url?.pathname ?? "");
	let projectId = $derived(page.params?.projectId as string | undefined);

	function hrefFor(slug: string): string {
		return `/projects/${encodeURIComponent(projectId ?? "")}/${slug}`;
	}

	function isActive(slug: string): boolean {
		if (!projectId) return false;
		return pathname.startsWith(hrefFor(slug));
	}
</script>

<header class="flex items-center gap-6 border-b border-border-default bg-background-subtle px-5 py-2">
	<a href="/" class="flex items-center gap-1.5 text-[14.5px] font-bold tracking-wide text-foreground">
		<span>do eval</span>
		<span aria-hidden="true" class="text-[20px] leading-none">😈😇</span>
	</a>
	{#if projectId}
		<nav class="flex items-center gap-1">
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
						<span class="absolute bottom-[-9px] left-0 right-0 h-[2px] bg-accent-blue"></span>
					{/if}
				</a>
			{/each}
		</nav>
	{/if}
</header>
