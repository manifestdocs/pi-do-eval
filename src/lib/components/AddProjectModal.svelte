<script lang="ts">
	import { tick } from "svelte";
	import { addProject, projectsBusy, projectsError } from "../../stores/projects.js";

	let { open = $bindable(false), onadded }: { open?: boolean; onadded?: (id: string) => void } = $props();

	let projectPath = $state("");
	let pathInput = $state<HTMLInputElement | null>(null);

	$effect(() => {
		if (open) {
			projectPath = "";
			void tick().then(() => pathInput?.focus());
		}
	});

	async function close() {
		if ($projectsBusy) return;
		open = false;
	}

	async function submit() {
		const trimmed = projectPath.trim();
		if (!trimmed) return;
		const id = await addProject(trimmed);
		if (!$projectsError) {
			open = false;
			if (id) onadded?.(id);
		}
	}
</script>

<svelte:window
	onkeydown={(event) => {
		if (open && event.key === "Escape") void close();
	}}
/>

{#if open}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-[2px]">
		<div
			class="w-full max-w-lg rounded border border-border-default bg-background-subtle shadow-2xl"
			role="dialog"
			aria-modal="true"
			aria-labelledby="add-project-title"
		>
			<form
				onsubmit={(event) => {
					event.preventDefault();
					void submit();
				}}
			>
				<div class="border-b border-border-default px-4 py-3">
					<h2 id="add-project-title" class="text-sm font-semibold tracking-wide text-foreground">
						Add Project
					</h2>
					<p class="mt-1 text-[11px] text-foreground-muted">
						Pass a repo root to use <code>eval/</code> by convention, or point directly at an eval dir.
					</p>
				</div>

				<div class="px-4 py-4">
					<label
						for="add-project-path"
						class="block text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle"
					>
						Path
					</label>
					<input
						id="add-project-path"
						bind:this={pathInput}
						class="mt-2 w-full rounded border border-border-default bg-background-muted px-3 py-2 text-[12px] text-foreground placeholder:text-foreground-subtle"
						type="text"
						bind:value={projectPath}
						placeholder="~/sandbox/pi-tdd"
					/>
					{#if $projectsError}
						<p class="mt-2 text-[11px] text-accent-red">{$projectsError}</p>
					{/if}
				</div>

				<div class="flex items-center justify-end gap-2 border-t border-border-default px-4 py-3">
					<button
						type="button"
						class="rounded border border-border-default px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-foreground-muted transition-colors hover:border-foreground-subtle hover:text-foreground disabled:opacity-40"
						disabled={$projectsBusy}
						onclick={() => void close()}
					>
						Cancel
					</button>
					<button
						type="submit"
						class="rounded bg-accent-blue px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-background transition-colors hover:brightness-110 disabled:opacity-40"
						disabled={!projectPath.trim() || $projectsBusy}
					>
						{$projectsBusy ? "Adding..." : "Add Project"}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}
