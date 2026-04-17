<script lang="ts">
	import ConfigView from "$lib/components/ConfigView.svelte";
	import { launcherConfig } from "../../../../stores/launcher.js";
	import { activeProject } from "../../../../stores/projects.js";
</script>

<main class="h-full overflow-y-auto p-6">
	<div class="mx-auto max-w-4xl">
		{#if $activeProject}
			<div class="mb-4 rounded border border-border-default bg-background-subtle p-4">
				<div class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[12px]">
					<span class="text-foreground-muted">Name</span>
					<span class="font-mono text-[11px] text-foreground">{$activeProject.name}</span>
					<span class="text-foreground-muted">Project root</span>
					<span class="font-mono text-[11px] text-foreground">{$activeProject.projectRoot}</span>
					<span class="text-foreground-muted">Eval directory</span>
					<span class="font-mono text-[11px] text-foreground">{$activeProject.evalDir}</span>
				</div>
			</div>
		{/if}

		{#if $launcherConfig}
			<ConfigView config={$launcherConfig} />
		{:else}
			<div class="rounded border border-dashed border-border-default bg-background-subtle p-4 text-[12px] text-foreground-muted">
				Launcher config not available.
			</div>
		{/if}
	</div>
</main>
