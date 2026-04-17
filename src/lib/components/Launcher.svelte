<script lang="ts">
	import { onMount } from "svelte";
	import type { LauncherConfig, RunRequest } from "$eval/types.js";
	import { launcherConfig } from "../../stores/launcher.js";
	import { resetCurrentReports } from "../../stores/runs.js";
	import { clearPendingLaunch } from "../../stores/selection.js";
	import { setAutoSelect } from "../../stores/sse.js";
	import { activeProjectId, projectApiPath } from "../../stores/projects.js";
	import { normalizeLauncherSelection } from "./launcher-state.js";

	let { onlaunched }: { onlaunched?: () => void } = $props();

	let config = $derived($launcherConfig);
	let runType = $state<"suite" | "trial" | "bench">("suite");
	let selectedTrial = $state("");
	let selectedVariant = $state("");
	let selectedSuite = $state("");
	let selectedModel = $state("");
	let noJudge = $state(false);
	let running = $state(false);
	let error = $state<string | null>(null);
	let statusPoll = $state<ReturnType<typeof setInterval> | null>(null);
	let suiteNames = $derived(config ? Object.keys(config.suites) : []);

	let availableVariants = $derived(
		config?.trials.find((t) => t.name === selectedTrial)?.variants ?? [],
	);

	function formatModel(m: { provider?: string; model?: string }): string {
		if (m.provider && m.model) return `${m.provider}/${m.model}`;
		return m.model ?? m.provider ?? "default";
	}

	let defaultWorkerLabel = $derived(
		config?.defaultWorker?.model ? formatModel(config.defaultWorker) : "agent default",
	);

	// All unique model labels: default worker + configured models
	let modelOptions = $derived.by(() => {
		if (!config) return [];
		const options: string[] = [];
		// The bench models are available as overrides for suite/trial too
		for (const m of config.models) {
			const label = formatModel(m);
			if (!options.includes(label)) options.push(label);
		}
		return options;
	});

	let canRun = $derived(() => {
		if (running) return false;
		if (runType === "trial") return !!selectedTrial && !!selectedVariant;
		return !!selectedSuite;
	});

	// Pre-select defaults when config loads
	$effect(() => {
		const _projectId = $activeProjectId;
		if (statusPoll) {
			clearInterval(statusPoll);
			statusPoll = null;
		}
		running = false;
		error = null;
		selectedTrial = "";
		selectedVariant = "";
		selectedSuite = "";
		selectedModel = "";
		noJudge = false;
		clearPendingLaunch();
	});

	$effect(() => {
		if (!config) return;
		const normalized = normalizeLauncherSelection(config, {
			selectedSuite,
			selectedTrial,
			selectedVariant,
		});
		if (normalized.selectedSuite !== selectedSuite) selectedSuite = normalized.selectedSuite;
		if (normalized.selectedTrial !== selectedTrial) selectedTrial = normalized.selectedTrial;
		if (normalized.selectedVariant !== selectedVariant) selectedVariant = normalized.selectedVariant;
	});

	$effect(() => {
		const projectId = $activeProjectId;
		if (!projectId || !config) return;
		void refreshStatus(projectId);
	});

	onMount(() => {
		return () => {
			if (statusPoll) clearInterval(statusPoll);
		};
	});

	$effect(() => {
		const _trial = selectedTrial;
		if (availableVariants.length > 0 && !availableVariants.includes(selectedVariant)) {
			selectedVariant = availableVariants[0] ?? "";
		}
	});

	async function launch() {
		if (!canRun()) return;
		error = null;
		const launcherUrl = projectApiPath("/launcher");
		if (!launcherUrl) {
			error = "Select a project first";
			return;
		}

		const body: RunRequest = {
			type: runType,
			...(runType === "trial" ? { trial: selectedTrial, variant: selectedVariant } : {}),
			...(runType !== "trial" ? { suite: selectedSuite } : {}),
			...(selectedModel ? { model: selectedModel } : {}),
			...(noJudge ? { noJudge: true } : {}),
		};

		try {
			const resp = await fetch(launcherUrl, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
			const result = await resp.json();
			if (result.ok) {
				running = true;
				resetCurrentReports();
				if (runType !== "bench") {
					setAutoSelect({
						id: result.id,
						type: runType,
						suite: runType === "suite" ? selectedSuite : undefined,
						trial: runType === "trial" ? selectedTrial : undefined,
						variant: runType === "trial" ? selectedVariant : undefined,
						modelLabel: selectedModel || defaultWorkerLabel,
						startedAt: new Date().toISOString(),
					});
				}
				const projectId = $activeProjectId;
				if (projectId) {
					startPolling(projectId);
				}
				onlaunched?.();
			} else {
				error = result.error ?? "Failed to start run";
			}
		} catch (e) {
			error = e instanceof Error ? e.message : "Network error";
		}
	}

	function startPolling(projectId: string) {
		if (statusPoll) clearInterval(statusPoll);
		statusPoll = setInterval(async () => {
			if ($activeProjectId !== projectId) {
				if (statusPoll) {
					clearInterval(statusPoll);
					statusPoll = null;
				}
				return;
			}

			const statusUrl = projectApiPath("/launcher?status", projectId);
			if (!statusUrl) return;

			try {
				const resp = await fetch(statusUrl);
				if (resp.ok) {
					const status = await resp.json();
					if (!status.active) {
						running = false;
						clearPendingLaunch();
						if (statusPoll) {
							clearInterval(statusPoll);
							statusPoll = null;
						}
					}
				}
			} catch {
				// Ignore polling errors
			}
		}, 2000);
	}

	async function refreshStatus(projectId: string): Promise<void> {
		const statusUrl = projectApiPath("/launcher?status", projectId);
		if (!statusUrl) return;

		try {
			const resp = await fetch(statusUrl);
			if (!resp.ok || projectId !== $activeProjectId) return;
			const status = (await resp.json()) as { active?: boolean };
			running = !!status.active;
		} catch {
			running = false;
		}
	}
</script>

{#if config}
	<div class="space-y-2">
		{#if running}
			<div class="text-[10px] font-bold uppercase tracking-wider text-accent-green">
				<span class="animate-pulse">Running…</span>
			</div>
		{/if}

		<div class="flex gap-1">
			{#each ["suite", "trial", "bench"] as type}
				<button
					type="button"
					class="flex-1 text-[10px] font-semibold uppercase tracking-wider py-1 px-2 rounded border transition-colors"
					class:bg-accent-blue={runType === type}
					class:text-background={runType === type}
					class:border-accent-blue={runType === type}
					class:border-border-default={runType !== type}
					class:text-foreground-muted={runType !== type}
					class:hover:border-foreground-subtle={runType !== type}
					onclick={() => (runType = type as "suite" | "trial" | "bench")}
				>
					{type}
				</button>
			{/each}
		</div>

		{#if runType === "trial"}
			<select
				class="w-full bg-background-muted border border-border-default rounded px-2 py-1 text-xs text-foreground"
				bind:value={selectedTrial}
			>
				{#each config.trials as trial (trial.name)}
					<option value={trial.name}>{trial.name}</option>
				{/each}
			</select>
			<select
				class="w-full bg-background-muted border border-border-default rounded px-2 py-1 text-xs text-foreground"
				bind:value={selectedVariant}
			>
				{#each availableVariants as variant (variant)}
					<option value={variant}>{variant}</option>
				{/each}
			</select>
		{:else}
			<select
				class="w-full bg-background-muted border border-border-default rounded px-2 py-1 text-xs text-foreground"
				bind:value={selectedSuite}
			>
				{#each suiteNames as suite (suite)}
					<option value={suite}>{suite} ({config.suites[suite]?.length ?? 0})</option>
				{/each}
			</select>
		{/if}

		{#if runType !== "bench"}
			<label class="block">
				<span class="block text-[10px] uppercase tracking-wider text-foreground-subtle mb-1">Model</span>
				<select
					class="w-full bg-background-muted border border-border-default rounded px-2 py-1 text-xs text-foreground"
					bind:value={selectedModel}
				>
					<option value="">{defaultWorkerLabel}</option>
					{#each modelOptions as model (model)}
						<option value={model}>{model}</option>
					{/each}
				</select>
			</label>
		{:else}
			<div class="text-[10px] text-foreground-muted">
				<span class="uppercase tracking-wider text-foreground-subtle">Models:</span>
				{#if modelOptions.length > 0}
					{modelOptions.join(", ")}
				{:else}
					<span class="text-foreground-subtle">from config</span>
				{/if}
			</div>
		{/if}

		<label class="flex items-center gap-1.5 text-xs text-foreground-muted cursor-pointer">
			<input type="checkbox" bind:checked={noJudge} class="accent-accent-blue" />
			No judge
		</label>

		<button
			type="button"
			class="w-full py-1.5 rounded text-xs font-semibold uppercase tracking-wider transition-colors disabled:opacity-40"
			class:bg-score-green={!running}
			class:text-background={!running}
			class:hover:brightness-110={!running}
			class:bg-background-muted={running}
			class:text-foreground-muted={running}
			disabled={!canRun() || running}
			onclick={launch}
		>
			{running ? "Running..." : "Run"}
		</button>

		{#if error}
			<p class="text-accent-red text-xs">{error}</p>
		{/if}
	</div>
{/if}
