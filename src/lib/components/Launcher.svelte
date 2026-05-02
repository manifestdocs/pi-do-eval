<script lang="ts">
	import { onMount } from "svelte";
	import type { LauncherConfig, RunRequest } from "$eval/types.js";
	import { launcherConfig, launcherError } from "../../stores/launcher.js";
	import { resetCurrentReports, runs } from "../../stores/runs.js";
	import { clearPendingLaunch, pendingLaunch } from "../../stores/selection.js";
	import { setAutoSelect } from "../../stores/sse.js";
	import { activeProjectId, projectApiPath } from "../../stores/projects.js";
	import { normalizeLauncherSelection } from "./launcher-state.js";
	import RunProgress from "./RunProgress.svelte";

	let { onlaunched }: { onlaunched?: () => void } = $props();

	let config = $derived($launcherConfig);
	let hasActiveRun = $derived($runs.some((run) => run.status === "running"));
	let isRunning = $derived(hasActiveRun || $pendingLaunch != null);
	let runType = $state<"suite" | "trial" | "bench">("suite");
	let runTypeInitializedForProject = $state<string | null>(null);
	// `value` is the wire shape for RunRequest.type (kept as "suite" for the
	// single-profile run because that's what the harness actually invokes);
	// `label` is what users see. The labels match the sidebar's vocabulary —
	// "Regression" for a single-profile suite run that lands in a regression
	// timeline, "Bench" for a multi-profile comparison.
	const launcherTabs = [
		{ value: "bench" as const, label: "Bench" },
		{ value: "suite" as const, label: "Regression" },
		{ value: "trial" as const, label: "Trial" },
	];
	let selectedTrial = $state("");
	let selectedVariant = $state("");
	let selectedSuite = $state("");
	let running = $state(false);
	let error = $state<string | null>(null);
	let statusPoll = $state<ReturnType<typeof setInterval> | null>(null);
	let suiteNames = $derived(config ? Object.keys(config.suites) : []);

	let selectedTrialEntry = $derived(
		config?.trials.find((t) => t.name === selectedTrial),
	);
	let availableVariants = $derived(selectedTrialEntry?.variants ?? []);
	let variantLabels = $derived(selectedTrialEntry?.variantLabels ?? {});

	// Worker model and judge are sourced from eval.config.ts; the launcher does
	// not expose model overrides or a "skip judge" toggle. The value of running
	// inside do-eval (vs a script) is the LLM judge — disabling it would
	// turn the run into a deterministic-only pipeline that belongs at the CLI.
	function formatModel(m: { provider?: string; model?: string }): string {
		if (m.provider && m.model) return `${m.provider}/${m.model}`;
		return m.model ?? m.provider ?? "default";
	}

	let defaultWorkerLabel = $derived(
		config?.defaultWorker?.model ? formatModel(config.defaultWorker) : "agent default",
	);

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
		runTypeInitializedForProject = null;
		clearPendingLaunch();
	});

	// Apply the project's preferred launch tab the first time its config loads.
	// Tracking by project ID lets the user freely switch tabs after the initial
	// preselect without our reapplying the default on every config refresh.
	$effect(() => {
		const projectId = $activeProjectId;
		if (!config || !projectId) return;
		if (runTypeInitializedForProject === projectId) return;
		runType = config.defaultLaunchType ?? "suite";
		runTypeInitializedForProject = projectId;
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

		const body: RunRequest =
			runType === "trial"
				? {
						type: "trial",
						trial: selectedTrial,
						variant: selectedVariant,
					}
				: {
						type: runType,
						suite: selectedSuite,
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
						modelLabel: defaultWorkerLabel,
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

{#if $launcherError}
	<div class="launch-bar flex items-start gap-2 rounded-lg border border-accent-red/40 bg-accent-red/5 px-3 py-2">
		<span class="text-[10px] font-bold uppercase tracking-widest text-accent-red">Project error</span>
		<pre class="whitespace-pre-wrap break-words text-[11px] text-accent-red">{$launcherError}</pre>
	</div>
{:else if config}
	{#if isRunning}
		<RunProgress />
	{:else}
	<div class="launch-bar flex flex-wrap items-center gap-2 rounded-lg border border-accent-blue/40 bg-accent-blue/5 px-3 py-1.5">
		<span class="text-[10px] font-bold uppercase tracking-widest text-accent-blue">
			Launch
		</span>

		<div class="inline-flex overflow-hidden rounded border border-border-default">
			{#each launcherTabs as tab (tab.value)}
				<button
					type="button"
					class="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors disabled:cursor-not-allowed"
					class:bg-accent-blue={runType === tab.value}
					class:text-background={runType === tab.value}
					class:text-foreground-muted={runType !== tab.value}
					class:hover:text-foreground={runType !== tab.value && !running}
					onclick={() => (runType = tab.value)}
				>
					{tab.label}
				</button>
			{/each}
		</div>

		{#if runType === "trial"}
			<select
				class="max-w-[160px] truncate rounded border border-border-default bg-background-muted px-2 py-1 text-[12px] text-foreground"
				bind:value={selectedTrial}
				aria-label="Trial"
			>
				{#each config.trials as trial (trial.name)}
					<option value={trial.name}>{trial.name}</option>
				{/each}
			</select>
			<select
				class="max-w-[160px] truncate rounded border border-border-default bg-background-muted px-2 py-1 text-[12px] text-foreground"
				bind:value={selectedVariant}
				aria-label="Variant"
			>
				{#each availableVariants as variant (variant)}
					<option value={variant}>{variantLabels[variant] ?? variant}</option>
				{/each}
			</select>
		{:else}
			<select
				class="max-w-[180px] truncate rounded border border-border-default bg-background-muted px-2 py-1 text-[12px] text-foreground"
				bind:value={selectedSuite}
				aria-label="Suite"
			>
				{#each suiteNames as suite (suite)}
					<option value={suite}>{suite} ({config.suites[suite]?.length ?? 0})</option>
				{/each}
			</select>
		{/if}

		<button
			type="button"
			class="run-btn ml-1 flex items-center gap-1.5 rounded px-4 py-1.5 text-[12px] font-bold uppercase tracking-wider transition-all disabled:opacity-40"
			class:active={!running && canRun()}
			class:bg-score-green={!running}
			class:text-background={!running}
			class:bg-background-muted={running}
			class:text-foreground-muted={running}
			disabled={!canRun() || running}
			onclick={launch}
		>
			{#if running}
				<span class="animate-pulse">Running…</span>
			{:else}
				<span class="text-[14px] leading-none">▶</span>
				<span>Run</span>
			{/if}
		</button>

		{#if error}
			<span class="text-[11px] text-accent-red">{error}</span>
		{/if}
	</div>
	{/if}
{/if}

<style>
	.launch-bar {
		box-shadow: 0 0 0 1px rgba(116, 192, 255, 0.08),
			inset 0 1px 0 rgba(116, 192, 255, 0.05);
	}

	.run-btn.active {
		/* Solid 1px edge anchors the shape so the surrounding glow doesn't read
		   as a fuzzy halo without a button inside it. */
		border: 1px solid rgb(86, 194, 113);
		box-shadow: 0 0 16px rgba(86, 194, 113, 0.35);
		animation: run-btn-breathe 2.8s ease-in-out infinite;
	}
	.run-btn.active:hover {
		transform: translateY(-1px);
		box-shadow: 0 0 24px rgba(86, 194, 113, 0.55);
		filter: brightness(1.1);
	}

	@keyframes run-btn-breathe {
		0%, 100% {
			box-shadow: 0 0 14px rgba(86, 194, 113, 0.3);
		}
		50% {
			box-shadow: 0 0 22px rgba(86, 194, 113, 0.55);
		}
	}
</style>
