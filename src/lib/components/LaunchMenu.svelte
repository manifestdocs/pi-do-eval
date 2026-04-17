<script lang="ts">
	import Launcher from "./Launcher.svelte";
	import { launcherConfig } from "../../stores/launcher.js";
	import { activeProject } from "../../stores/projects.js";

	let open = $state(false);
	let triggerEl = $state<HTMLButtonElement | null>(null);
	let menuEl = $state<HTMLDivElement | null>(null);

	let available = $derived(!!$activeProject && !!$launcherConfig);

	function onDocClick(event: MouseEvent) {
		if (!open) return;
		const target = event.target as Node;
		if (menuEl?.contains(target) || triggerEl?.contains(target)) return;
		open = false;
	}

	function onKey(event: KeyboardEvent) {
		if (event.key === "Escape" && open) open = false;
	}

	$effect(() => {
		if (!open) return;
		document.addEventListener("mousedown", onDocClick);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDocClick);
			document.removeEventListener("keydown", onKey);
		};
	});
</script>

{#if available}
	<div class="relative">
		<button
			type="button"
			bind:this={triggerEl}
			class="rounded border border-accent-blue bg-accent-blue/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-accent-blue transition-colors hover:bg-accent-blue hover:text-background"
			aria-haspopup="dialog"
			aria-expanded={open}
			onclick={() => (open = !open)}
		>
			{open ? "▾ Run" : "▸ Run"}
		</button>

		{#if open}
			<div
				bind:this={menuEl}
				role="dialog"
				class="absolute right-0 top-[calc(100%+6px)] z-40 w-[280px] rounded border border-border-default bg-background-subtle p-3 shadow-xl"
			>
				<div class="mb-2 flex items-baseline justify-between gap-2">
					<span class="text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle">
						Launch
					</span>
					{#if $activeProject}
						<span class="truncate text-[10px] text-foreground-muted" title={$activeProject.name}>
							{$activeProject.name}
						</span>
					{/if}
				</div>
				<Launcher onlaunched={() => (open = false)} />
			</div>
		{/if}
	</div>
{/if}
