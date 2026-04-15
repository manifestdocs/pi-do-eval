function createEvalViewer() {
  return {
    // -- State ---------------------------------------------------------------
    runs: [],
    suiteIndex: [],
    loading: true,
    error: null,

    // Selection (three levels)
    selectedSuiteName: null,
    selectedSuiteRunId: null,
    selectedRunDir: null,

    // Expanded state in sidebar
    expandedSuites: new Set(),
    expandedRuns: new Set(),

    // Data for main panel
    suiteReportCache: {},
    suiteRunReports: {},
    runReport: null,
    reportLoading: false,
    reportError: null,

    // Bench
    benchIndex: [],
    selectedBenchId: null,
    benchReport: null,

    // Chart instance
    _trendChart: null,

    // SSE
    _eventSource: null,
    _sseConnected: false,
    _liveInterval: null,

    // -- Normalization --------------------------------------------------------
    _normalizeComparison(comparison) {
      if (!comparison) return comparison;
      // Migrate "significant" -> "clear" from older reports
      if (comparison.significantRegressionCount != null && comparison.clearRegressionCount == null) {
        comparison.clearRegressionCount = comparison.significantRegressionCount;
        delete comparison.significantRegressionCount;
      }
      if (comparison.entries) {
        for (const entry of comparison.entries) {
          if (entry.severity === "significant") entry.severity = "clear";
        }
      }
      return comparison;
    },

    _normalizeSuiteReport(report) {
      if (!report) return report;
      if (report.comparison) this._normalizeComparison(report.comparison);
      return report;
    },

    _isValidRunReport(report) {
      return !!report && !!report.meta && !!report.scores;
    },

    _isValidSuiteReport(report) {
      return !!report && Array.isArray(report.entries) && !!report.summary;
    },

    // -- Init ----------------------------------------------------------------
    async init() {
      this._trySSE();
      await Promise.all([this._loadSuiteIndex(), this._loadBenchIndex()]);
    },

    // -- SSE -----------------------------------------------------------------
    _trySSE() {
      const source = new EventSource("/events");
      this._eventSource = source;
      source.onopen = () => {
        this._sseConnected = true;
        this.loading = false;
      };
      source.onmessage = (e) => this._handleSSEEvent(JSON.parse(e.data));
      source.onerror = () => {
        if (!this._sseConnected) {
          source.close();
          this._eventSource = null;
          this._initFilePolling();
        }
      };
    },

    _handleSSEEvent(event) {
      switch (event.type) {
        case "index_updated":
          this.runs = event.runs;
          this.loading = false;
          this._autoSelectIfNeeded();
          break;
        case "run_started":
          if (!this.runs.find((r) => r.dir === event.dir)) {
            this.runs.push({
              dir: event.dir,
              trial: event.trial,
              variant: event.variant,
              status: "running",
              overall: 0,
              durationMs: 0,
              startedAt: new Date(event.timestamp).toISOString(),
              workerModel: event.workerModel || "",
              suite: event.suite,
              suiteRunId: event.suiteRunId,
              epoch: event.epoch,
              totalEpochs: event.totalEpochs,
            });
          }
          break;
        case "run_progress":
          if (this.selectedRunDir === event.dir) this._fetchLive(event.dir);
          break;
        case "run_completed": {
          const run = this.runs.find((r) => r.dir === event.dir);
          if (run) {
            run.status = event.status;
            if (event.overall != null) run.overall = event.overall;
            run.durationMs = event.durationMs;
          }
          if (this.selectedRunDir === event.dir) this._fetchRunReport(event.dir);
          break;
        }
      }
    },

    async _initFilePolling() {
      try {
        const resp = await fetch("runs/index.json");
        if (resp.ok) {
          this.runs = await resp.json();
          this._autoSelectIfNeeded();
        }
      } catch (e) {
        this.error = e.message || "Failed to load run index.";
      } finally {
        this.loading = false;
      }
    },

    async _loadSuiteIndex() {
      try {
        const resp = await fetch("runs/suites/index.json");
        if (resp.ok) this.suiteIndex = await resp.json();
      } catch {}
    },

    async _loadBenchIndex() {
      try {
        const resp = await fetch("runs/bench/index.json");
        if (resp.ok) this.benchIndex = await resp.json();
      } catch {}
    },

    _autoSelectIfNeeded() {
      if (this.selectedSuiteName || this.selectedSuiteRunId || this.selectedRunDir) return;
      const items = this.sidebarItems;
      if (items.length > 0) {
        const first = items[0];
        this.expandedSuites.add(first.suite);
        this.selectSuiteName(first.suite);
      }
    },

    // -- Sidebar computed ----------------------------------------------------
    get sidebarItems() {
      // Group runs by suite name, then by suiteRunId
      const suiteMap = new Map();

      for (const run of this.runs) {
        if (!run.suite || !run.suiteRunId) continue; // hide orphans
        if (!suiteMap.has(run.suite)) {
          suiteMap.set(run.suite, new Map());
        }
        const runMap = suiteMap.get(run.suite);
        if (!runMap.has(run.suiteRunId)) {
          runMap.set(run.suiteRunId, []);
        }
        runMap.get(run.suiteRunId).push(run);
      }

      const suites = [];
      for (const [suiteName, runMap] of suiteMap) {
        const suiteRuns = [];
        for (const [suiteRunId, children] of runMap) {
          children.sort((a, b) => (a.trial + a.variant).localeCompare(b.trial + b.variant));
          const completed = children.filter((r) => r.status !== "running");
          const scores = completed.map((r) => r.overall).filter((s) => Number.isFinite(s) && s > 0);
          const avg =
            scores.length > 0 ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null;
          const isRunning = children.some((r) => r.status === "running");
          const epochs = Math.max(1, ...children.map((r) => r.totalEpochs || 1));

          suiteRuns.push({
            suiteRunId,
            children,
            averageOverall: avg,
            totalRuns: children.length,
            finishedRuns: completed.length,
            durationMs: children.reduce((sum, r) => sum + (r.durationMs || 0), 0),
            status: isRunning ? "running" : this._worstStatus(children),
            epochs,
            workerModel: children[0]?.workerModel || "",
            sortKey: this._runSortKey(children[0]),
          });
        }
        suiteRuns.sort((a, b) => b.sortKey - a.sortKey);

        // Suite-level score = latest run's average
        const latestAvg = suiteRuns[0]?.averageOverall;
        // Delta vs previous run
        const prevAvg = suiteRuns[1]?.averageOverall;
        const delta = latestAvg != null && prevAvg != null ? Math.round((latestAvg - prevAvg) * 10) / 10 : null;

        suites.push({
          suite: suiteName,
          suiteRuns,
          latestAvg,
          delta,
          sortKey: suiteRuns[0]?.sortKey || 0,
        });
      }

      suites.sort((a, b) => b.sortKey - a.sortKey);
      return suites;
    },

    // -- Selection -----------------------------------------------------------
    selectSuiteName(name) {
      this.selectedSuiteName = name;
      this.selectedSuiteRunId = null;
      this.selectedRunDir = null;
      this.selectedBenchId = null;
      this.benchReport = null;
      this.runReport = null;
      this.reportLoading = true;
      this.reportError = null;
      this._loadSuiteIndex().then(() => {
        this._loadAllSuiteReports(name).then(() => {
          this.reportLoading = false;
          this.$nextTick(() => this._renderTrendChart());
        });
      });
    },

    selectSuiteRun(suiteName, suiteRunId) {
      this.selectedSuiteName = null;
      this.selectedSuiteRunId = suiteRunId;
      this.selectedRunDir = null;
      this.selectedBenchId = null;
      this.benchReport = null;
      this.runReport = null;
      this.reportLoading = true;
      this.reportError = null;
      this.expandedSuites.add(suiteName);
      this.expandedRuns.add(suiteRunId);
      this._loadSuiteReport(suiteName, suiteRunId).then(() => {
        this._loadSuiteRunReports(suiteRunId);
        this.reportLoading = false;
      });
    },

    selectRun(dir) {
      this.selectedSuiteName = null;
      this.selectedSuiteRunId = null;
      this.selectedRunDir = dir;
      this.selectedBenchId = null;
      this.benchReport = null;
      this.runReport = null;
      this.reportLoading = true;
      this.reportError = null;
      if (this._liveInterval) {
        clearInterval(this._liveInterval);
        this._liveInterval = null;
      }
      const run = this.runs.find((r) => r.dir === dir);
      if (run?.suiteRunId) {
        this.expandedSuites.add(run.suite);
        this.expandedRuns.add(run.suiteRunId);
      }
      if (run?.status === "running") {
        this._fetchLive(dir);
        if (!this._sseConnected) {
          this._liveInterval = setInterval(() => this._pollLive(dir), 2000);
        }
      } else {
        this._fetchRunReport(dir);
      }
    },

    selectBench(benchId) {
      this.selectedSuiteName = null;
      this.selectedSuiteRunId = null;
      this.selectedRunDir = null;
      this.selectedBenchId = benchId;
      this.runReport = null;
      this.benchReport = null;
      this.reportLoading = true;
      this.reportError = null;
      const entry = this.benchIndex.find((e) => e.benchRunId === benchId);
      if (!entry) {
        this.reportError = "Bench report not found";
        this.reportLoading = false;
        return;
      }
      fetch(`runs/bench/${entry.dir}/report.json`)
        .then((r) => (r.ok ? r.json() : null))
        .then((report) => {
          this.benchReport = report;
          this.reportLoading = false;
        })
        .catch(() => {
          this.reportError = "Failed to load bench report";
          this.reportLoading = false;
        });
    },

    toggleSuite(name) {
      if (this.expandedSuites.has(name)) this.expandedSuites.delete(name);
      else this.expandedSuites.add(name);
    },

    toggleSuiteRun(id) {
      if (this.expandedRuns.has(id)) this.expandedRuns.delete(id);
      else this.expandedRuns.add(id);
    },

    isSuiteExpanded(name) {
      return this.expandedSuites.has(name);
    },

    isSuiteRunExpanded(id) {
      return this.expandedRuns.has(id);
    },

    // -- Data loading --------------------------------------------------------
    async _loadAllSuiteReports(suiteName) {
      const entries = this.suiteIndex.filter((e) => e.suite === suiteName);
      await Promise.all(entries.map((e) => this._loadSuiteReport(suiteName, e.suiteRunId)));
    },

    async _loadSuiteReport(suiteName, suiteRunId) {
      const key = suiteRunId;
      if (this.suiteReportCache[key]) return;
      try {
        const dir = `${suiteRunId}-${suiteName}`;
        const resp = await fetch(`runs/suites/${dir}/report.json`);
        if (resp.ok) {
          const report = await resp.json();
          this.suiteReportCache[key] = this._normalizeSuiteReport(report);
        }
      } catch {}
    },

    async _loadSuiteRunReports(suiteRunId) {
      this.suiteRunReports = {};
      const children = this.runs.filter((r) => r.suiteRunId === suiteRunId && r.status !== "running");
      await Promise.all(
        children.map(async (run) => {
          try {
            const resp = await fetch(`runs/${run.dir}/report.json`);
            if (resp.ok) {
              const report = await resp.json();
              if (this._isValidRunReport(report)) this.suiteRunReports[run.dir] = report;
            }
          } catch {}
        }),
      );
    },

    async _fetchRunReport(dir) {
      try {
        const resp = await fetch(`runs/${dir}/report.json`);
        if (resp.ok) {
          const report = await resp.json();
          if (this._isValidRunReport(report)) {
            this.runReport = report;
          } else {
            this.reportError = "Unsupported report format.";
          }
        } else {
          this.reportError = `Failed to load report: ${resp.status}`;
        }
      } catch (e) {
        this.reportError = e.message || "Failed to load report.";
      } finally {
        this.reportLoading = false;
      }
    },

    async _fetchLive(dir) {
      try {
        const resp = await fetch(`runs/${dir}/live.json`);
        if (resp.ok) {
          const report = await resp.json();
          this.runReport = report;
          this.reportLoading = false;
        }
      } catch {}
    },

    async _pollLive(dir) {
      if (this.selectedRunDir !== dir) {
        clearInterval(this._liveInterval);
        this._liveInterval = null;
        return;
      }
      try {
        const reportResp = await fetch(`runs/${dir}/report.json`);
        if (reportResp.ok) {
          const report = await reportResp.json();
          if (!this._isValidRunReport(report)) {
            this.reportError = "Unsupported report format.";
            clearInterval(this._liveInterval);
            this._liveInterval = null;
            return;
          }
          this.runReport = report;
          clearInterval(this._liveInterval);
          this._liveInterval = null;
          const run = this.runs.find((r) => r.dir === dir);
          if (run) {
            run.status = this.runReport.meta?.status || "completed";
            run.overall = this.runReport.scores?.overall || 0;
          }
          return;
        }
      } catch {}
      await this._fetchLive(dir);
    },

    // -- Suite trend view computed -------------------------------------------
    get suiteTrendData() {
      if (!this.selectedSuiteName) return null;
      const entries = this.suiteIndex
        .filter((e) => e.suite === this.selectedSuiteName)
        .sort((a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime());

      return entries.map((e) => ({
        suiteRunId: e.suiteRunId,
        date: new Date(e.completedAt),
        averageOverall: e.averageOverall,
        totalRuns: e.totalRuns,
        hardFailures: e.hardFailureCount,
        report: this.suiteReportCache[e.suiteRunId],
      }));
    },

    get suiteStats() {
      const data = this.suiteTrendData;
      if (!data || data.length === 0) return null;
      const scores = data.map((d) => d.averageOverall).filter((s) => s != null);
      if (scores.length === 0) return null;
      const avg = Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
      const latest = scores[scores.length - 1];
      const best = Math.max(...scores);
      const worst = Math.min(...scores);
      const trend = scores.length >= 2 ? scores[scores.length - 1] - scores[scores.length - 2] : 0;
      return { avg, latest, best, worst, trend: Math.round(trend * 10) / 10, totalRuns: data.length };
    },

    get suiteTrialTrends() {
      if (!this.selectedSuiteName) return [];
      const data = this.suiteTrendData;
      if (!data) return [];

      // Collect all trial::variant keys across all runs
      const trialKeys = new Set();
      for (const d of data) {
        if (!d.report?.entries) continue;
        for (const entry of d.report.entries) {
          trialKeys.add(`${entry.trial}/${entry.variant}`);
        }
      }

      return Array.from(trialKeys)
        .sort()
        .map((key) => {
          const points = data.map((d) => {
            if (!d.report?.entries) return null;
            const [trial, variant] = key.split("/");
            const matching = d.report.entries.filter((e) => e.trial === trial && e.variant === variant);
            if (matching.length === 0) return null;
            const avg = matching.reduce((sum, e) => sum + e.overall, 0) / matching.length;
            return Math.round(avg * 10) / 10;
          });
          return { key, points };
        });
    },

    // -- Suite run view computed ----------------------------------------------
    get currentSuiteReport() {
      if (!this.selectedSuiteRunId) return null;
      return this.suiteReportCache[this.selectedSuiteRunId] || null;
    },

    get currentSuiteRunItem() {
      for (const suite of this.sidebarItems) {
        for (const sr of suite.suiteRuns) {
          if (sr.suiteRunId === this.selectedSuiteRunId) return { suite: suite.suite, ...sr };
        }
      }
      return null;
    },

    get suiteRunComparison() {
      const report = this.currentSuiteReport;
      if (!report?.comparison) return null;
      return report.comparison;
    },

    get suiteRunScoreCategories() {
      const cats = new Set();
      for (const report of Object.values(this.suiteRunReports)) {
        if (report?.scores?.deterministic) {
          for (const k of Object.keys(report.scores.deterministic)) cats.add(k);
        }
        if (report?.scores?.judge) {
          for (const k of Object.keys(report.scores.judge)) cats.add(k);
        }
      }
      return Array.from(cats);
    },

    // -- Run detail view computed --------------------------------------------
    get scoreRows() {
      if (!this.runReport?.scores) return [];
      const scores = this.runReport.scores;
      const rows = [];
      if (scores.deterministic) {
        for (const [key, val] of Object.entries(scores.deterministic)) {
          rows.push({ label: this.formatScoreKey(key), value: val });
        }
      }
      if (scores.judge) {
        for (const [key, val] of Object.entries(scores.judge)) {
          rows.push({ label: this.formatScoreKey(key) + " (judge)", value: val });
        }
      }
      return rows;
    },

    get allFindings() {
      const top = this.runReport?.findings || [];
      const judge = this.runReport?.judgeResult?.findings || [];
      const seen = new Set(top);
      const merged = [...top];
      for (const f of judge) {
        if (!seen.has(f)) merged.push(f);
      }
      return merged;
    },

    get judgeReasonEntries() {
      const reasons = this.runReport?.judgeResult?.reasons;
      if (!reasons) return [];
      return Object.entries(reasons);
    },

    get timeline() {
      const s = this.runReport?.session;
      if (!s) return [];
      const events = [];
      for (const tc of s.toolCalls || []) events.push({ kind: "tool", timestamp: tc.timestamp, data: tc });
      for (const fw of s.fileWrites || []) events.push({ kind: "file", timestamp: fw.timestamp, data: fw });
      for (const ev of s.pluginEvents || []) events.push({ kind: "plugin", timestamp: ev.timestamp, data: ev });
      for (const tr of s.testRuns || []) events.push({ kind: "test", timestamp: tr.timestamp, data: tr });
      for (const pc of s.phaseChanges || []) events.push({ kind: "phase", timestamp: pc.timestamp, data: pc });
      events.sort((a, b) => a.timestamp - b.timestamp);
      return events;
    },

    timelineFilters: { tool: true, file: true, plugin: true, test: true, phase: true },

    get filteredTimeline() {
      return this.timeline.filter((e) => this.timelineFilters[e.kind]);
    },

    get timelineKinds() {
      const counts = {};
      for (const e of this.timeline) counts[e.kind] = (counts[e.kind] || 0) + 1;
      return [
        { key: "tool", label: "Tools", count: counts.tool || 0 },
        { key: "file", label: "Files", count: counts.file || 0 },
        { key: "plugin", label: "Plugin", count: counts.plugin || 0 },
        { key: "test", label: "Tests", count: counts.test || 0 },
        { key: "phase", label: "Phases", count: counts.phase || 0 },
      ].filter((k) => k.count > 0);
    },

    // -- Chart ---------------------------------------------------------------
    _renderTrendChart() {
      const canvas = document.getElementById("trend-chart");
      if (!canvas) return;
      if (this._trendChart) {
        this._trendChart.destroy();
        this._trendChart = null;
      }

      const data = this.suiteTrendData;
      if (!data || data.length === 0) return;

      const labels = data.map((d) => this.formatDate(d.date.toISOString()));
      const avgScores = data.map((d) => d.averageOverall);
      const trialTrends = this.suiteTrialTrends;

      const datasets = [
        {
          label: "Average",
          data: avgScores,
          borderColor: "#58a6ff",
          backgroundColor: "rgba(88, 166, 255, 0.1)",
          borderWidth: 2.5,
          pointRadius: 4,
          pointBackgroundColor: "#58a6ff",
          fill: true,
          tension: 0.2,
        },
      ];

      const trialColors = ["#89d185", "#d29922", "#f85149", "#c4b5fd", "#fde68a", "#86efac", "#93c5fd", "#fca5a5"];
      for (let i = 0; i < trialTrends.length; i++) {
        const t = trialTrends[i];
        datasets.push({
          label: t.key,
          data: t.points,
          borderColor: trialColors[i % trialColors.length],
          borderWidth: 1,
          pointRadius: 2,
          borderDash: [4, 2],
          tension: 0.2,
          spanGaps: true,
        });
      }

      this._trendChart = new Chart(canvas, {
        type: "line",
        data: { labels, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: {
              min: Math.max(
                0,
                Math.floor(
                  (Math.min(...avgScores, ...trialTrends.flatMap((t) => t.points.filter((p) => p != null))) - 5) / 5,
                ) * 5,
              ),
              max: Math.min(
                100,
                Math.ceil(
                  (Math.max(...avgScores, ...trialTrends.flatMap((t) => t.points.filter((p) => p != null))) + 5) / 5,
                ) * 5,
              ),
              grid: { color: "rgba(255,255,255,0.06)" },
              ticks: { color: "#7d8590", font: { size: 11 } },
            },
            x: {
              grid: { color: "rgba(255,255,255,0.04)" },
              ticks: { color: "#7d8590", font: { size: 11 }, maxRotation: 0 },
            },
          },
          plugins: {
            legend: {
              position: "bottom",
              align: "start",
              labels: { color: "#8b949e", font: { size: 11 }, boxWidth: 12, padding: 12 },
            },
            tooltip: {
              backgroundColor: "#21262d",
              titleColor: "#e6edf3",
              bodyColor: "#8b949e",
              borderColor: "#30363d",
              borderWidth: 1,
            },
          },
        },
      });
    },

    // -- Helpers --------------------------------------------------------------
    scoreColor(score) {
      if (score == null) return "var(--foreground-subtle)";
      if (score > 80) return "var(--score-green)";
      if (score > 50) return "var(--score-yellow)";
      return "var(--score-red)";
    },

    deltaColor(delta) {
      if (delta == null) return "";
      if (delta > 0) return "var(--score-green)";
      if (delta < 0) return "var(--score-red)";
      return "var(--foreground-subtle)";
    },

    formatDelta(delta) {
      if (delta == null) return "";
      return delta > 0 ? `+${delta}` : `${delta}`;
    },

    formatScoreKey(key) {
      return key
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .replace(/\bTdd\b/, "TDD")
        .replace(/\bPrd\b/, "PRD");
    },

    formatDuration(ms) {
      if (!ms) return "--";
      if (ms < 1000) return `${ms}ms`;
      const s = Math.round(ms / 1000);
      if (s < 60) return `${s}s`;
      const m = Math.floor(s / 60);
      const rem = s % 60;
      return `${m}m ${rem}s`;
    },

    formatDate(iso) {
      if (!iso) return "--";
      const d = new Date(iso);
      if (!Number.isFinite(d.getTime()) || d.getTime() <= 0) return "--";
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    },

    formatTimestamp(ts) {
      if (!ts) return "--";
      return new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    },

    formatArgs(args) {
      if (!args) return "";
      if (typeof args === "string") return args;
      if (args.command) return args.command;
      if (args.path) return args.path;
      return JSON.stringify(args);
    },

    truncate(str, len) {
      if (!str) return "";
      return str.length <= len ? str : `${str.slice(0, len)}...`;
    },

    formatNumber(n) {
      if (n == null) return "0";
      return n.toLocaleString();
    },

    shortModelName(m) {
      if (!m) return "--";
      const parts = m.split("/");
      return parts[parts.length - 1] || m;
    },

    _worstStatus(children) {
      if (children.some((r) => r.status === "crashed")) return "crashed";
      if (children.some((r) => r.status === "stalled")) return "stalled";
      if (children.some((r) => r.status === "timeout")) return "timeout";
      return "completed";
    },

    _runSortKey(run) {
      if (!run?.startedAt) return 0;
      const t = new Date(run.startedAt).getTime();
      return Number.isFinite(t) && t > 0 ? t : 0;
    },
  };
}

document.addEventListener("alpine:init", () => {
  window.Alpine.data("evalViewer", createEvalViewer);
});
