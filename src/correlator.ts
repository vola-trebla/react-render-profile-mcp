export interface ChromeTraceEvent {
  cat: string;
  name: string;
  ph: string; // Event Phase: B (Begin), E (End), X (Complete)
  ts: number; // Absolute Microseconds
  dur?: number; // Microseconds
  args?: any;
}

export interface ReactCommit {
  commitIndex: number;
  commitTime: number; // Relative Milliseconds
  duration: number; // Milliseconds
}

export interface AlignedTimelineReport {
  commitIndex: number;
  reactDurationMs: number;
  styleRecalcMs: number;
  layoutMs: number;
  paintMs: number;
  layoutShiftScore: number;
  inpEstimateMs: number;
  degradesCoreWebVitals: boolean;
}

export class MultiLayerTimelineCorrelator {
  public static correlateTimeline(
    commits: ReactCommit[],
    traceEvents: ChromeTraceEvent[],
  ): AlignedTimelineReport[] {
    const reports: AlignedTimelineReport[] = [];

    // 1. Locate the React Synchronization Mark in Chrome Trace (emitted in development mode)
    const syncMark = traceEvents.find(
      (e) => e.cat === "blink.user_timing" && e.name.startsWith("⚛"),
    );

    if (!syncMark) {
      throw new Error(
        "Sync failed: Could not locate React timeline markers inside the trace. Ensure development mode was active.",
      );
    }

    // Determine temporal offset between timelines
    const traceOriginUs = syncMark.ts; // Trace absolute microseconds
    const firstCommitMs = commits[0]?.commitTime || 0;

    for (const commit of commits) {
      // Align relative milliseconds to trace absolute microseconds
      const startUs =
        traceOriginUs + (commit.commitTime - firstCommitMs) * 1000;
      const endUs = startUs + commit.duration * 1000;
      const postCommitBufferUs = endUs + 150000; // 150ms window for downstream browser work

      // 2. Filter browser tasks executing within this commit window
      const styleTasks = traceEvents.filter(
        (e) =>
          (e.name === "UpdateLayoutTree" || e.name === "RecalculateStyles") &&
          e.ts >= startUs &&
          e.ts <= postCommitBufferUs,
      );

      const layoutTasks = traceEvents.filter(
        (e) =>
          e.name === "Layout" && e.ts >= startUs && e.ts <= postCommitBufferUs,
      );

      const paintTasks = traceEvents.filter(
        (e) =>
          (e.name === "Paint" || e.name === "Rasterize") &&
          e.ts >= startUs &&
          e.ts <= postCommitBufferUs,
      );

      const layoutShifts = traceEvents.filter(
        (e) =>
          e.name === "LayoutShift" &&
          e.ts >= startUs &&
          e.ts <= postCommitBufferUs,
      );

      // Convert task durations to milliseconds
      const styleRecalcMs =
        styleTasks.reduce((acc, curr) => acc + (curr.dur || 0), 0) / 1000;
      const layoutMs =
        layoutTasks.reduce((acc, curr) => acc + (curr.dur || 0), 0) / 1000;
      const paintMs =
        paintTasks.reduce((acc, curr) => acc + (curr.dur || 0), 0) / 1000;

      // Extract layout shift impact scores
      const layoutShiftScore = layoutShifts.reduce((acc, curr) => {
        const score = curr.args?.data?.score || 0;
        return acc + score;
      }, 0);

      // 3. Estimate INP impact (flagging blocking work over 50ms)
      const totalBlockingWorkMs =
        commit.duration + styleRecalcMs + layoutMs + paintMs;
      const inpEstimateMs = totalBlockingWorkMs > 50 ? totalBlockingWorkMs : 0;
      const degradesCoreWebVitals =
        inpEstimateMs > 200 || layoutShiftScore > 0.1; // Standard INP / CLS boundaries

      reports.push({
        commitIndex: commit.commitIndex,
        reactDurationMs: commit.duration,
        styleRecalcMs,
        layoutMs,
        paintMs,
        layoutShiftScore,
        inpEstimateMs,
        degradesCoreWebVitals,
      });
    }

    return reports;
  }
}
