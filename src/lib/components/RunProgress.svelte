<script lang="ts">
	import { onMount } from "svelte";
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import { launcherConfig } from "../../stores/launcher.js";
	import { activeProjectId } from "../../stores/projects.js";
	import { runs } from "../../stores/runs.js";
	import { focusRun } from "../../stores/selection.js";

	let now = $state(Date.now());

	onMount(() => {
		const timer = setInterval(() => (now = Date.now()), 500);
		return () => clearInterval(timer);
	});

	async function jumpToRunningRun() {
		const run = activeRun;
		if (!run) return;
		const projectId = $activeProjectId;
		if (!projectId) return;
		const target = `/projects/${encodeURIComponent(projectId)}/runs`;
		if (!page.url?.pathname?.endsWith("/runs")) {
			await goto(target);
		}
		focusRun(run);
	}

	let allRuns = $derived($runs);

	let activeRuns = $derived(allRuns.filter((run) => run.status === "running"));
	let activeRun = $derived(activeRuns[0] ?? null);
	let suite = $derived(activeRun?.suite ?? null);
	let suiteRunId = $derived(activeRun?.suiteRunId ?? null);

	let plannedTotal = $derived(
		suite && $launcherConfig?.suites?.[suite]?.length
			? $launcherConfig.suites[suite]?.length ?? 1
			: 1,
	);

	let finishedCount = $derived.by(() => {
		if (!suiteRunId) return 0;
		return allRuns.filter(
			(run) => run.suiteRunId === suiteRunId && run.status !== "running",
		).length;
	});

	let inFlightCount = $derived.by(() => {
		if (!suiteRunId) return activeRun ? 1 : 0;
		return activeRuns.filter((run) => run.suiteRunId === suiteRunId).length;
	});

	let startedAtMs = $derived.by(() => {
		if (suiteRunId) {
			const suiteRunEntries = allRuns.filter((run) => run.suiteRunId === suiteRunId);
			const startTimes = suiteRunEntries
				.map((run) => (run.startedAt ? new Date(run.startedAt).getTime() : null))
				.filter((ts): ts is number => ts != null && !Number.isNaN(ts));
			if (startTimes.length > 0) return Math.min(...startTimes);
		}
		if (activeRun?.startedAt) {
			const ts = new Date(activeRun.startedAt).getTime();
			if (!Number.isNaN(ts)) return ts;
		}
		return now;
	});

	let elapsedMs = $derived(Math.max(0, now - startedAtMs));

	function formatDuration(ms: number): string {
		const s = Math.floor(ms / 1000);
		if (s < 60) return `${s}s`;
		const m = Math.floor(s / 60);
		const rem = s % 60;
		return `${m}m ${rem.toString().padStart(2, "0")}s`;
	}
</script>

<button
	type="button"
	class="run-progress group relative flex w-full flex-wrap items-center gap-3 overflow-hidden rounded border border-accent-green/50 bg-accent-green/5 px-3 py-1.5 text-left transition-colors hover:border-accent-green hover:bg-accent-green/10"
	aria-live="polite"
	title="Jump to the running trial"
	onclick={() => void jumpToRunningRun()}
>
	<div class="shimmer pointer-events-none absolute inset-0"></div>

	<span class="relative flex h-2.5 w-2.5 shrink-0">
		<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-green opacity-75"></span>
		<span class="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent-green"></span>
	</span>

	<span class="relative text-[11px] font-bold uppercase tracking-wider text-accent-green">
		Running
	</span>

	{#if suite}
		<span class="relative text-[11px] text-foreground-muted">
			<span class="text-foreground-subtle">suite</span>
			<span class="ml-1 font-semibold text-foreground">{suite}</span>
		</span>
	{/if}

	{#if activeRun}
		<span
			class="relative max-w-[220px] truncate font-mono text-[11px] text-foreground"
			title="{activeRun.trial}/{activeRun.variant}"
		>
			{activeRun.trial}/{activeRun.variant}
		</span>
	{/if}

	{#if plannedTotal > 1}
		<div class="relative flex items-center gap-[3px]" aria-label="Suite progress">
			{#each Array(plannedTotal) as _, i (i)}
				<span
					class="h-2 w-2.5 rounded-sm transition-colors"
					class:bg-accent-green={i < finishedCount}
					class:bg-accent-green-active={i >= finishedCount && i < finishedCount + inFlightCount}
					class:bg-background-muted={i >= finishedCount + inFlightCount}
				></span>
			{/each}
		</div>
	{/if}

	<span class="relative ml-auto text-[11px] font-mono tabular-nums text-foreground-muted">
		{#if plannedTotal > 1}
			<span class="text-foreground">{finishedCount}</span>/<span>{plannedTotal}</span>
			<span class="mx-1 text-foreground-subtle">·</span>
		{/if}
		<span>{formatDuration(elapsedMs)}</span>
	</span>
</button>

<style>
	.run-progress::before {
		content: "";
		position: absolute;
		inset: 0;
		border-radius: inherit;
		background: linear-gradient(
			110deg,
			transparent 20%,
			rgba(86, 194, 113, 0.25) 45%,
			rgba(86, 194, 113, 0.45) 50%,
			rgba(86, 194, 113, 0.25) 55%,
			transparent 80%
		);
		background-size: 200% 100%;
		background-repeat: no-repeat;
		opacity: 0.25;
		animation: sweep 2.8s linear infinite;
		pointer-events: none;
	}

	.shimmer {
		background: radial-gradient(
			ellipse at center,
			rgba(86, 194, 113, 0.12),
			transparent 60%
		);
		animation: breathe 2.4s ease-in-out infinite;
	}

	:global(.bg-accent-green-active) {
		background-color: rgba(86, 194, 113, 0.55);
		animation: blink 1s ease-in-out infinite;
	}

	@keyframes sweep {
		0% {
			background-position: -100% 0;
		}
		100% {
			background-position: 200% 0;
		}
	}

	@keyframes breathe {
		0%, 100% {
			opacity: 0.35;
		}
		50% {
			opacity: 0.9;
		}
	}

	@keyframes blink {
		0%, 100% {
			opacity: 0.55;
		}
		50% {
			opacity: 1;
		}
	}
</style>
