<script lang="ts">
	import { onMount } from "svelte";
	import { goto } from "$app/navigation";
	import { addProject, loadProjects, projectsBusy } from "../../../stores/projects.js";

	type DetectResult = {
		exists: boolean;
		path: string;
		isDirectory?: boolean;
		hasPackageJson?: boolean;
		hasEvalTs?: boolean;
		hasEvalDir?: boolean;
		packageName?: string;
	};

	let pathInput = $state("");
	let detect = $state<DetectResult | null>(null);
	let detectError = $state<string | null>(null);
	let detecting = $state(false);
	let scaffolding = $state(false);
	let pathInputEl = $state<HTMLInputElement | null>(null);
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;

	onMount(() => {
		pathInputEl?.focus();
	});

	$effect(() => {
		const current = pathInput.trim();
		detect = null;
		detectError = null;
		if (!current) return;
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			void runDetect(current);
		}, 250);
	});

	async function runDetect(candidate: string) {
		detecting = true;
		try {
			const resp = await fetch(`/api/projects/detect?path=${encodeURIComponent(candidate)}`);
			const data = (await resp.json()) as DetectResult & { error?: string };
			if (!resp.ok) {
				detectError = data.error ?? "Could not resolve path";
				return;
			}
			detect = data;
		} catch (err) {
			detectError = err instanceof Error ? err.message : "Network error";
		} finally {
			detecting = false;
		}
	}

	let status = $derived.by<
		| { kind: "empty" }
		| { kind: "missing"; path: string }
		| { kind: "file" }
		| { kind: "eval-dir" }
		| { kind: "project-with-eval"; packageName?: string }
		| { kind: "project-missing-eval"; packageName?: string; hasPackageJson: boolean }
	>(() => {
		if (!detect) return { kind: "empty" };
		if (!detect.exists) return { kind: "missing", path: detect.path };
		if (detect.isDirectory === false) return { kind: "file" };
		if (detect.hasEvalTs) return { kind: "eval-dir" };
		if (detect.hasEvalDir)
			return { kind: "project-with-eval", packageName: detect.packageName };
		return {
			kind: "project-missing-eval",
			packageName: detect.packageName,
			hasPackageJson: detect.hasPackageJson ?? false,
		};
	});

	async function registerExisting() {
		const id = await addProject(pathInput.trim());
		if (id) void goto(`/projects/${encodeURIComponent(id)}/runs`);
	}

	async function scaffoldAndRegister() {
		scaffolding = true;
		try {
			const resp = await fetch("/api/projects/scaffold", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ repoRoot: pathInput.trim() }),
			});
			const data = (await resp.json()) as {
				error?: string;
				registry?: { activeProjectId: string | null };
			};
			if (!resp.ok || data.error) {
				detectError = data.error ?? "Scaffold failed";
				return;
			}
			await loadProjects();
			if (data.registry?.activeProjectId) {
				void goto(`/projects/${encodeURIComponent(data.registry.activeProjectId)}/runs`);
			}
		} finally {
			scaffolding = false;
		}
	}
</script>

<main class="mx-auto max-w-2xl overflow-y-auto p-6">
	<div class="mb-5">
		<a
			href="/projects"
			class="text-[11px] uppercase tracking-wider text-foreground-muted hover:text-foreground"
		>
			← Projects
		</a>
		<h1 class="mt-2 text-[20px] font-semibold text-foreground">New Project</h1>
		<p class="mt-1 text-[12px] text-foreground-muted">
			Point pi-do-eval at an existing <code>eval/</code> directory, or scaffold one into a repo
			that doesn't have one yet.
		</p>
	</div>

	<section class="rounded border border-border-default bg-background-subtle p-4">
		<h2 class="text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle">
			1. Project path
		</h2>
		<input
			bind:this={pathInputEl}
			bind:value={pathInput}
			class="mt-2 w-full rounded border border-border-default bg-background-muted px-3 py-2 font-mono text-[12px] text-foreground placeholder:text-foreground-subtle"
			placeholder="~/code/my-extension"
			type="text"
			spellcheck="false"
			autocomplete="off"
		/>
		<p class="mt-2 text-[11px] text-foreground-muted">
			Pass a repo root (to scaffold <code>eval/</code>) or point directly at an <code>eval/</code> directory.
		</p>
		{#if detecting}
			<p class="mt-2 text-[11px] text-foreground-subtle">Checking path…</p>
		{/if}
		{#if detectError}
			<p class="mt-2 text-[11px] text-accent-red">{detectError}</p>
		{/if}
	</section>

	{#if status.kind !== "empty"}
		<section class="mt-4 rounded border border-border-default bg-background-subtle p-4">
			<h2 class="text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle">
				2. Review
			</h2>

			{#if status.kind === "missing"}
				<p class="mt-2 text-[12px] text-accent-red">
					Path does not exist: <code>{status.path}</code>
				</p>
			{:else if status.kind === "file"}
				<p class="mt-2 text-[12px] text-accent-red">That path is a file, not a directory.</p>
			{:else if status.kind === "eval-dir"}
				<p class="mt-2 text-[12px] text-foreground-muted">
					<strong class="text-foreground">Eval directory detected</strong> — contains <code>eval.ts</code>.
					Ready to register.
				</p>
			{:else if status.kind === "project-with-eval"}
				<p class="mt-2 text-[12px] text-foreground-muted">
					<strong class="text-foreground">Project directory</strong>
					{#if status.packageName}(<code>{status.packageName}</code>){/if}
					with <code>eval/</code> subdirectory. Ready to register.
				</p>
			{:else if status.kind === "project-missing-eval"}
				{#if status.hasPackageJson}
					<p class="mt-2 text-[12px] text-foreground-muted">
						<strong class="text-foreground">Project directory</strong>
						{#if status.packageName}(<code>{status.packageName}</code>){/if}
						— no <code>eval/</code> yet. We'll scaffold the harness (eval.ts, example trial,
						plugin skeleton, config) into <code>eval/</code>. You'll still need to run
						<code>npm install</code> and fill in the plugin.
					</p>
				{:else}
					<p class="mt-2 text-[12px] text-accent-red">
						Directory has no <code>package.json</code> — scaffold needs a Pi extension repo.
					</p>
				{/if}
			{/if}
		</section>

		<section class="mt-4 rounded border border-border-default bg-background-subtle p-4">
			<h2 class="text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle">
				3. Confirm
			</h2>
			<div class="mt-3 flex items-center gap-2">
				{#if status.kind === "eval-dir" || status.kind === "project-with-eval"}
					<button
						type="button"
						class="rounded bg-accent-blue px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-background transition-colors hover:brightness-110 disabled:opacity-40"
						disabled={$projectsBusy}
						onclick={() => void registerExisting()}
					>
						{$projectsBusy ? "Adding…" : "Add Project"}
					</button>
				{:else if status.kind === "project-missing-eval" && status.hasPackageJson}
					<button
						type="button"
						class="rounded bg-accent-blue px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-background transition-colors hover:brightness-110 disabled:opacity-40"
						disabled={scaffolding}
						onclick={() => void scaffoldAndRegister()}
					>
						{scaffolding ? "Scaffolding…" : "Scaffold eval/ and Add"}
					</button>
				{:else}
					<button
						type="button"
						class="rounded bg-accent-blue px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-background opacity-40"
						disabled
					>
						Fix the path above to continue
					</button>
				{/if}
				<a
					href="/projects"
					class="rounded border border-border-default px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-foreground-muted transition-colors hover:border-foreground-subtle hover:text-foreground"
				>
					Cancel
				</a>
			</div>
		</section>
	{/if}
</main>
