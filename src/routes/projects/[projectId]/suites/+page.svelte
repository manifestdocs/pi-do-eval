<script lang="ts">
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import type { LauncherSuiteDef } from "$eval/types.js";
	import SuiteEditModal from "$lib/components/SuiteEditModal.svelte";
	import { launcherBusy, launcherConfig, loadLauncherConfig, launchRun } from "../../../../stores/launcher.js";
	import { activeProjectId, projectApiPath } from "../../../../stores/projects.js";
	import { suiteIndex } from "../../../../stores/runs.js";
	import { deltaColor, formatDate, formatDelta, scoreColor } from "$lib/utils.js";

	let config = $derived($launcherConfig);
	let suiteDefs = $derived(config?.suiteDefs ?? []);
	let trials = $derived(config?.trials ?? []);
	let error = $state<string | null>(null);

	let editModalOpen = $state(false);
	let editMode = $state<"create" | "edit">("create");
	let editingSuite = $state<LauncherSuiteDef | null>(null);
	let confirmDelete = $state<string | null>(null);

	function groupVariantsByTrial(
		entries: Array<{ trial: string; variant: string }>,
	): Array<{ trial: string; variants: string[] }> {
		const map = new Map<string, string[]>();
		for (const entry of entries) {
			const existing = map.get(entry.trial);
			if (existing) existing.push(entry.variant);
			else map.set(entry.trial, [entry.variant]);
		}
		return [...map].sort(([a], [b]) => a.localeCompare(b)).map(([trial, variants]) => ({
			trial,
			variants: [...variants].sort(),
		}));
	}

	let latestBySuite = $derived.by(() => {
		const map = new Map<string, { averageOverall: number; completedAt: string; prior?: number }>();
		const bySuite = new Map<string, typeof $suiteIndex>();
		for (const entry of $suiteIndex) {
			if (!bySuite.has(entry.suite)) bySuite.set(entry.suite, []);
			bySuite.get(entry.suite)?.push(entry);
		}
		for (const [suite, entries] of bySuite) {
			const sorted = [...entries].sort((a, b) => b.completedAt.localeCompare(a.completedAt));
			const latest = sorted[0];
			if (!latest) continue;
			map.set(suite, {
				averageOverall: latest.averageOverall,
				completedAt: latest.completedAt,
				prior: sorted[1]?.averageOverall,
			});
		}
		return map;
	});

	async function runSuite(suiteName: string) {
		error = null;
		const result = await launchRun({ type: "suite", suite: suiteName });
		if (!result.ok) {
			error = result.error ?? "Failed to start suite";
			return;
		}
		await goto(`/projects/${encodeURIComponent(page.params.projectId ?? "")}/runs`);
	}

	async function runBench(suiteName: string) {
		error = null;
		const result = await launchRun({ type: "bench", suite: suiteName });
		if (!result.ok) {
			error = result.error ?? "Failed to start bench";
			return;
		}
		await goto(`/projects/${encodeURIComponent(page.params.projectId ?? "")}/runs`);
	}

	function openCreate() {
		editMode = "create";
		editingSuite = null;
		editModalOpen = true;
	}

	function openEdit(suite: LauncherSuiteDef) {
		editMode = "edit";
		editingSuite = suite;
		editModalOpen = true;
	}

	async function saveSuite(payload: {
		originalName?: string;
		name: string;
		description: string;
		regressionThreshold: number | undefined;
		trials: Array<{ trial: string; variant: string }>;
	}): Promise<{ ok: true } | { ok: false; error: string }> {
		const projectId = $activeProjectId;
		if (!projectId) return { ok: false, error: "No active project" };

		const body = {
			name: payload.name,
			description: payload.description || undefined,
			trials: payload.trials,
			regressionThreshold: payload.regressionThreshold,
		};

		try {
			let resp: Response;
			if (payload.originalName) {
				const url = projectApiPath(
					`/suites/${encodeURIComponent(payload.originalName)}`,
					projectId,
				);
				if (!url) return { ok: false, error: "Missing project" };
				resp = await fetch(url, {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(body),
				});
			} else {
				const url = projectApiPath("/suites", projectId);
				if (!url) return { ok: false, error: "Missing project" };
				resp = await fetch(url, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(body),
				});
			}

			if (!resp.ok) {
				const payload = (await resp.json().catch(() => null)) as { error?: string } | null;
				return { ok: false, error: payload?.error ?? "Save failed" };
			}

			await loadLauncherConfig(projectId);
			return { ok: true };
		} catch (err) {
			return { ok: false, error: err instanceof Error ? err.message : "Network error" };
		}
	}

	async function deleteSuite(name: string) {
		const projectId = $activeProjectId;
		if (!projectId) return;
		const url = projectApiPath(`/suites/${encodeURIComponent(name)}`, projectId);
		if (!url) return;

		const resp = await fetch(url, { method: "DELETE" });
		if (!resp.ok) {
			const payload = (await resp.json().catch(() => null)) as { error?: string } | null;
			error = payload?.error ?? "Delete failed";
			return;
		}
		confirmDelete = null;
		await loadLauncherConfig(projectId);
	}
</script>

<main class="h-full overflow-y-auto p-6">
	<div class="mx-auto max-w-4xl">
		<div class="mb-4 flex items-end justify-between">
			<div>
				<h2 class="text-[16px] font-semibold text-foreground">Suites</h2>
				<p class="mt-1 text-[12px] text-foreground-muted">
					Bundle trial/variant pairs into reusable run sets. Suites live in
					<code>eval/suites/*.yaml</code> and can be edited here.
				</p>
			</div>
			<button
				type="button"
				class="rounded bg-accent-blue px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-background transition-colors hover:brightness-110 disabled:opacity-40"
				disabled={!config || trials.length === 0}
				onclick={openCreate}
			>
				New Suite
			</button>
		</div>

		{#if error}
			<div class="mb-4 rounded border border-accent-red/40 bg-accent-red/10 px-3 py-2 text-[12px] text-accent-red">
				{error}
			</div>
		{/if}

		{#if !config}
			<div class="rounded border border-dashed border-border-default bg-background-subtle p-4 text-[12px] text-foreground-muted">
				Launcher config not available.
			</div>
		{:else if suiteDefs.length === 0}
			<div class="rounded border border-dashed border-border-default bg-background-subtle p-4 text-[12px] text-foreground-muted">
				No suites defined yet.
			</div>
		{:else}
			<div class="space-y-3">
				{#each suiteDefs as suite (suite.name)}
					{@const latest = latestBySuite.get(suite.name)}
					{@const delta = latest && latest.prior != null ? latest.averageOverall - latest.prior : null}
					<div class="rounded border border-border-default bg-background-subtle p-4">
						<div class="flex items-start justify-between gap-4">
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2">
									<h3 class="text-[14px] font-semibold text-foreground">{suite.name}</h3>
									<span
										class="rounded border px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider"
										class:border-accent-blue={suite.source === "file"}
										class:text-accent-blue={suite.source === "file"}
									>
										File
									</span>
									{#if suite.regressionThreshold != null}
										<span class="text-[10.5px] text-foreground-subtle">
											threshold {suite.regressionThreshold}
										</span>
									{/if}
								</div>
								{#if suite.description}
									<p class="mt-1 text-[11.5px] text-foreground-muted">{suite.description}</p>
								{/if}
								<p class="mt-1 text-[11px] text-foreground-subtle">
									{suite.trials.length} {suite.trials.length === 1 ? "entry" : "entries"}
								</p>
							</div>
							<div class="flex flex-col items-end gap-2">
								{#if latest}
									<div class="flex items-center gap-2">
										<span
											class="inline-block min-w-[2.5rem] rounded px-1.5 py-0.5 text-center text-[12px] font-bold"
											style="background-color: {scoreColor(latest.averageOverall)}; color: var(--color-background)"
										>
											{latest.averageOverall}
										</span>
										{#if delta != null && delta !== 0}
											<span class="font-mono text-[11px]" style="color: {deltaColor(delta)}">
												{formatDelta(Math.round(delta * 10) / 10)}
											</span>
										{/if}
									</div>
									<div class="text-[10.5px] text-foreground-subtle">
										Last run {formatDate(latest.completedAt)}
									</div>
								{/if}
								<div class="flex flex-wrap items-center justify-end gap-1">
									<button
										type="button"
										class="rounded bg-accent-blue px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-background transition-colors hover:brightness-110 disabled:opacity-40"
										disabled={$launcherBusy}
										onclick={() => void runSuite(suite.name)}
									>
										Run suite
									</button>
									<button
										type="button"
										class="rounded border border-border-default px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-foreground-muted transition-colors hover:border-accent-purple hover:text-accent-purple disabled:opacity-40"
										disabled={$launcherBusy}
										onclick={() => void runBench(suite.name)}
									>
										Bench
									</button>
									{#if suite.source === "file"}
										<button
											type="button"
											class="rounded border border-border-default px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-foreground-muted transition-colors hover:border-foreground-subtle hover:text-foreground"
											onclick={() => openEdit(suite)}
										>
											Edit
										</button>
										{#if confirmDelete === suite.name}
											<button
												type="button"
												class="rounded border border-accent-red px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-accent-red transition-colors hover:bg-accent-red hover:text-background"
												onclick={() => void deleteSuite(suite.name)}
											>
												Confirm delete
											</button>
											<button
												type="button"
												class="rounded border border-border-default px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-foreground-muted transition-colors hover:border-foreground-subtle hover:text-foreground"
												onclick={() => (confirmDelete = null)}
											>
												Cancel
											</button>
										{:else}
											<button
												type="button"
												class="rounded border border-border-default px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-foreground-muted transition-colors hover:border-accent-red hover:text-accent-red"
												onclick={() => (confirmDelete = suite.name)}
											>
												Delete
											</button>
										{/if}
									{/if}
								</div>
							</div>
						</div>

						<div class="mt-3 grid grid-cols-[minmax(140px,auto)_1fr] gap-x-4 gap-y-1 border-t border-border-muted pt-3">
							{#each groupVariantsByTrial(suite.trials) as row (row.trial)}
								<div class="font-mono text-[11px] text-foreground-muted">{row.trial}</div>
								<div class="flex flex-wrap gap-1">
									{#each row.variants as variant (variant)}
										<code class="rounded border border-border-muted bg-background-muted px-1.5 py-0.5 text-[11px] text-foreground">
											{variant}
										</code>
									{/each}
								</div>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</main>

<SuiteEditModal
	bind:open={editModalOpen}
	mode={editMode}
	existing={editingSuite}
	trials={trials}
	onsave={saveSuite}
/>
