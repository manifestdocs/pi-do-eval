export function scoreColor(score: number | null | undefined): string {
  if (score == null) return "var(--color-foreground-subtle)";
  if (score >= 80) return "var(--color-score-green)";
  if (score >= 50) return "var(--color-score-yellow)";
  return "var(--color-score-red)";
}

export function deltaColor(delta: number | null | undefined): string {
  if (delta == null || delta === 0) return "var(--color-foreground-muted)";
  return delta > 0 ? "var(--color-accent-green)" : "var(--color-accent-red)";
}

export function formatDelta(delta: number | null | undefined): string {
  if (delta == null) return "";
  if (delta === 0) return "0";
  return delta > 0 ? `+${delta}` : `${delta}`;
}

export function formatDate(iso: string | undefined): string {
  if (!iso) return "--";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDuration(ms: number | undefined): string {
  if (!ms) return "--";
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  return `${mins}m ${remainSecs}s`;
}

export function formatMetricLabel(key: string): string {
  const ACRONYMS = new Set([
    "ai",
    "api",
    "ci",
    "css",
    "html",
    "http",
    "https",
    "json",
    "llm",
    "sdk",
    "sse",
    "tdd",
    "ui",
    "url",
  ]);
  const normalized = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();

  if (!normalized) return key;

  return normalized
    .split(/\s+/)
    .map((part) => {
      const lower = part.toLowerCase();
      if (ACRONYMS.has(lower)) return lower.toUpperCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

export function shortModelName(model: string): string {
  const parts = model.split("/");
  return parts[parts.length - 1] ?? model;
}
