<script lang="ts">
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import {
		launcherBusy,
		launcherConfig,
		loadLauncherConfig,
		launchRun,
	} from "../../../../stores/launcher.js";
	import { activeProjectId, projectApiPath } from "../../../../stores/projects.js";
	import { suiteIndex } from "../../../../stores/runs.js";

	let config = $derived($launcherConfig);
	let error = $state<string | null>(null);
	let busyTrial = $state<string | null>(null);

	let trialUsage = $derived.by(() => {
		const usage = new Map<string, Set<string>>();
		const conf = config;
		if (!conf) return usage;
		for (const [suiteName, entries] of Object.entries(conf.suites)) {
			for (const entry of entries) {
				const key = `${entry.trial}`;
				if (!usage.has(key)) usage.set(key, new Set());
				usage.get(key)?.add(suiteName);
			}
		}
		return usage;
	});

	async function runTrial(trial: string, variant: string) {
		error = null;
		const result = await launchRun({ type: "trial", trial, variant });
		if (!result.ok) {
			error = result.error ?? "Failed to start run";
			return;
		}
		await goto(`/projects/${encodeURIComponent(page.params.projectId ?? "")}/runs`);
	}

	async function toggleEnabled(trialName: string, nextEnabled: boolean) {
		const projectId = $activeProjectId;
		if (!projectId) return;
		busyTrial = trialName;
		error = null;
		try {
			const url = projectApiPath(`/trials/${encodeURIComponent(trialName)}`, projectId);
			if (!url) return;
			const resp = await fetch(url, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ enabled: nextEnabled }),
			});
			if (!resp.ok) {
				const payload = (await resp.json().catch(() => null)) as { error?: string } | null;
				error = payload?.error ?? "Failed to update trial";
				return;
			}
			await loadLauncherConfig(projectId);
		} finally {
			busyTrial = null;
		}
	}
</script>

<main class="h-full overflow-y-auto p-6">
	<div class="mx-auto max-w-5xl">
		<div class="mb-4 flex items-end justify-between">
			<div>
				<h2 class="text-[16px] font-semibold text-foreground">Trials</h2>
				<p class="mt-1 text-[12px] text-foreground-muted">
					Trial code lives in <code>eval/trials/*/config.ts</code>. Per-trial overrides
					(description, tags, enabled) live in an optional <code>meta.json</code> alongside and
					can be edited here.
				</p>
			</div>
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
		{:else if config.trials.length === 0}
			<div class="rounded border border-dashed border-border-default bg-background-subtle p-4 text-[12px] text-foreground-muted">
				No trials defined yet.
			</div>
		{:else}
			<div class="overflow-hidden rounded border border-border-default bg-background-subtle">
				<table class="w-full text-[12px]">
					<thead>
						<tr class="border-b border-border-default text-[10px] uppercase tracking-wider text-foreground-subtle">
							<th class="px-3 py-2 text-left">Trial</th>
							<th class="px-3 py-2 text-left">Description</th>
							<th class="px-3 py-2 text-left">Variants</th>
							<th class="px-3 py-2 text-left">Used in suites</th>
							<th class="px-3 py-2 text-right">Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each config.trials as trial (trial.name)}
							{@const enabled = trial.enabled !== false}
							<tr
								class="border-t border-border-muted align-top"
								class:opacity-60={!enabled}
							>
								<td class="px-3 py-2">
									<div class="flex items-start gap-2">
										<input
											type="checkbox"
											class="mt-1 accent-accent-blue"
											checked={enabled}
											disabled={busyTrial === trial.name}
											onchange={(event) =>
												void toggleEnabled(trial.name, (event.currentTarget as HTMLInputElement).checked)}
											title={enabled ? "Disable trial" : "Enable trial"}
										/>
										<div class="min-w-0">
											<div class="font-mono text-[11px] text-foreground">{trial.name}</div>
											{#if trial.tags && trial.tags.length > 0}
												<div class="mt-1 flex flex-wrap gap-1">
													{#each trial.tags as tag (tag)}
														<code class="rounded border border-border-muted bg-background-muted px-1 py-0.5 text-[10px] text-foreground-muted">{tag}</code>
													{/each}
												</div>
											{/if}
										</div>
									</div>
								</td>
								<td class="px-3 py-2 text-foreground-muted">{trial.description || "—"}</td>
								<td class="px-3 py-2">
									<div class="flex flex-wrap gap-1">
										{#each trial.variants as variant (variant)}
											<code class="rounded border border-border-muted bg-background-muted px-1.5 py-0.5 text-[11px]">{variant}</code>
										{/each}
									</div>
								</td>
								<td class="px-3 py-2 text-foreground-muted">
									{#if trialUsage.get(trial.name)}
										{[...(trialUsage.get(trial.name) ?? [])].join(", ")}
									{:else}
										—
									{/if}
								</td>
								<td class="px-3 py-2 text-right">
									<div class="flex flex-wrap items-center justify-end gap-1">
										{#each trial.variants as variant (variant)}
											<button
												type="button"
												class="rounded border border-border-default px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-foreground-muted transition-colors hover:border-accent-blue hover:text-accent-blue disabled:opacity-40"
												disabled={$launcherBusy || !enabled}
												title={enabled ? `Run ${trial.name} (${variant})` : "Trial is disabled"}
												onclick={() => void runTrial(trial.name, variant)}
											>
												Run {variant}
											</button>
										{/each}
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
</main>
