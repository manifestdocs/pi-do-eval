<script lang="ts">
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import { launcherBusy, launcherConfig, launchRun } from "../../../../stores/launcher.js";
	import { suiteIndex } from "../../../../stores/runs.js";
	import { deltaColor, formatDate, formatDelta, scoreColor } from "$lib/utils.js";

	let config = $derived($launcherConfig);
	let error = $state<string | null>(null);

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
</script>

<main class="h-full overflow-y-auto p-6">
	<div class="mx-auto max-w-4xl">
		<div class="mb-4">
			<h2 class="text-[16px] font-semibold text-foreground">Suites</h2>
			<p class="mt-1 text-[12px] text-foreground-muted">
				Defined in <code>eval/eval.config.ts</code>. Each suite bundles a set of trial/variant pairs.
			</p>
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
		{:else if Object.keys(config.suites).length === 0}
			<div class="rounded border border-dashed border-border-default bg-background-subtle p-4 text-[12px] text-foreground-muted">
				No suites defined yet.
			</div>
		{:else}
			<div class="space-y-3">
				{#each Object.entries(config.suites) as [name, entries] (name)}
					{@const latest = latestBySuite.get(name)}
					{@const delta = latest && latest.prior != null ? latest.averageOverall - latest.prior : null}
					<div class="rounded border border-border-default bg-background-subtle p-4">
						<div class="flex items-start justify-between gap-4">
							<div class="min-w-0 flex-1">
								<h3 class="text-[14px] font-semibold text-foreground">{name}</h3>
								<p class="mt-0.5 text-[11px] text-foreground-muted">
									{entries.length} {entries.length === 1 ? "entry" : "entries"}
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
								<div class="flex items-center gap-1">
									<button
										type="button"
										class="rounded bg-accent-blue px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-background transition-colors hover:brightness-110 disabled:opacity-40"
										disabled={$launcherBusy}
										onclick={() => void runSuite(name)}
									>
										Run suite
									</button>
									{#if (config.models?.length ?? 0) > 0}
										<button
											type="button"
											class="rounded border border-border-default px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-foreground-muted transition-colors hover:border-accent-purple hover:text-accent-purple disabled:opacity-40"
											disabled={$launcherBusy}
											onclick={() => void runBench(name)}
										>
											Run bench
										</button>
									{/if}
								</div>
							</div>
						</div>

						<div class="mt-3 flex flex-wrap gap-1">
							{#each entries as entry}
								<code class="rounded border border-border-muted bg-background-muted px-1.5 py-0.5 text-[11px]">
									{entry.trial}/{entry.variant}
								</code>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</main>
