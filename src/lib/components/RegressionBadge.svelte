<script lang="ts">
	import type { RegressionStatus } from "$eval/types.js";

	let { status }: { status: RegressionStatus | undefined | null } = $props();

	let label = $derived.by(() => {
		switch (status) {
			case "improved":
				return "Improved";
			case "regressed":
				return "Regressed";
			case "stable":
				return "Stable";
			case "baseline":
				return "Baseline";
			default:
				return "—";
		}
	});

	let colorClass = $derived.by(() => {
		switch (status) {
			case "improved":
				return "border-accent-green text-accent-green";
			case "regressed":
				return "border-accent-red text-accent-red";
			case "stable":
				return "border-border-default text-foreground-muted";
			case "baseline":
				return "border-accent-blue text-accent-blue";
			default:
				return "border-border-default text-foreground-subtle";
		}
	});
</script>

<span
	class="inline-block rounded border px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider {colorClass}"
>
	{label}
</span>
