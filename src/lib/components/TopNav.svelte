<script lang="ts">
	import { page } from "$app/state";
	import LaunchMenu from "./LaunchMenu.svelte";
	import { activeProject } from "../../stores/projects.js";

	const links = [
		{ href: "/", label: "Dashboard" },
		{ href: "/projects", label: "Projects" },
	];

	let current = $derived(page.url?.pathname ?? "/");

	function isActive(href: string): boolean {
		if (href === "/") return current === "/";
		return current === href || current.startsWith(`${href}/`);
	}
</script>

<header class="flex items-center gap-6 border-b border-border-default bg-background-subtle px-5 py-2.5">
	<a href="/" class="text-[14.5px] font-bold tracking-wide text-foreground">
		Pi, do Eval
	</a>
	<nav class="flex items-center gap-1">
		{#each links as link (link.href)}
			<a
				href={link.href}
				class="rounded px-2.5 py-1 text-[12px] font-semibold uppercase tracking-wider transition-colors"
				class:text-foreground={isActive(link.href)}
				class:bg-background-muted={isActive(link.href)}
				class:text-foreground-muted={!isActive(link.href)}
				class:hover:text-foreground={!isActive(link.href)}
			>
				{link.label}
			</a>
		{/each}
	</nav>
	<div class="ml-auto flex items-center gap-3">
		{#if $activeProject}
			<div class="flex items-center gap-2 text-[11px] text-foreground-muted">
				<span class="uppercase tracking-wider text-foreground-subtle">Project</span>
				<a
					href="/projects/{$activeProject.id}/runs"
					class="font-semibold text-foreground hover:underline"
				>
					{$activeProject.name}
				</a>
			</div>
		{/if}
		<LaunchMenu />
	</div>
</header>
