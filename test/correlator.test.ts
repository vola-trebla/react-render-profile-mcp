import { describe, it, expect } from "vitest";
import {
  MultiLayerTimelineCorrelator,
  ReactCommit,
  ChromeTraceEvent,
} from "../src/correlator.js";

describe("Timeline Trace Correlator", () => {
  it("aligns timeline and calculates style, layout, paint, CLS and INP estimates", () => {
    // Commit starts at 10ms, duration 20ms
    const commits: ReactCommit[] = [
      {
        commitIndex: 0,
        commitTime: 10,
        duration: 20,
      },
    ];

    // Trace events absolute time (in microseconds).
    // Let's say syncMark is at 100,000us (100ms)
    // The traceOriginUs = 100,000us.
    // firstCommitMs = 10ms.
    // For commit 0:
    // startUs = 100,000 + (10 - 10) * 1000 = 100,000us.
    // endUs = 100,000 + 20 * 1000 = 120,000us.
    // postCommitBufferUs = 120,000 + 150,000 = 270,000us.
    const traceEvents: ChromeTraceEvent[] = [
      {
        cat: "blink.user_timing",
        name: "⚛ App [mount]",
        ph: "B",
        ts: 100000,
      },
      // RecalculateStyles (10ms) executing inside the buffer window (e.g. at 130,000us)
      {
        cat: "devtools.timeline",
        name: "RecalculateStyles",
        ph: "X",
        ts: 130000,
        dur: 10000, // 10ms
      },
      // Layout (15ms) executing inside the buffer window (e.g. at 150,000us)
      {
        cat: "devtools.timeline",
        name: "Layout",
        ph: "X",
        ts: 150000,
        dur: 15000, // 15ms
      },
      // Paint (5ms) executing inside the buffer window (e.g. at 180,000us)
      {
        cat: "devtools.timeline",
        name: "Paint",
        ph: "X",
        ts: 180000,
        dur: 5000, // 5ms
      },
      // LayoutShift with score 0.05
      {
        cat: "devtools.timeline",
        name: "LayoutShift",
        ph: "I",
        ts: 160000,
        args: {
          data: {
            score: 0.05,
          },
        },
      },
    ];

    const reports = MultiLayerTimelineCorrelator.correlateTimeline(
      commits,
      traceEvents,
    );

    expect(reports).toHaveLength(1);
    const report = reports[0];
    expect(report.commitIndex).toBe(0);
    expect(report.reactDurationMs).toBe(20);
    expect(report.styleRecalcMs).toBe(10);
    expect(report.layoutMs).toBe(15);
    expect(report.paintMs).toBe(5);
    expect(report.layoutShiftScore).toBeCloseTo(0.05);
    // Total blocking work = 20 + 10 + 15 + 5 = 50ms.
    // INP estimate is totalBlockingWork if > 50, otherwise 0.
    expect(report.inpEstimateMs).toBe(0);
    expect(report.degradesCoreWebVitals).toBe(false);
  });

  it("flags degraded Core Web Vitals if INP/CLS limits exceeded", () => {
    const commits: ReactCommit[] = [
      {
        commitIndex: 0,
        commitTime: 0,
        duration: 80, // Heavy React render
      },
    ];

    const traceEvents: ChromeTraceEvent[] = [
      {
        cat: "blink.user_timing",
        name: "⚛ App",
        ph: "B",
        ts: 0,
      },
      {
        cat: "devtools.timeline",
        name: "LayoutShift",
        ph: "I",
        ts: 10000,
        args: {
          data: {
            score: 0.15, // Exceeds CLS threshold (0.1)
          },
        },
      },
    ];

    const reports = MultiLayerTimelineCorrelator.correlateTimeline(
      commits,
      traceEvents,
    );
    expect(reports[0].degradesCoreWebVitals).toBe(true);
    expect(reports[0].inpEstimateMs).toBe(80); // 80 > 50
  });

  it("throws error if synchronization marker is missing", () => {
    expect(() => {
      MultiLayerTimelineCorrelator.correlateTimeline(
        [{ commitIndex: 0, commitTime: 0, duration: 10 }],
        [],
      );
    }).toThrow(
      "Sync failed: Could not locate React timeline markers inside the trace",
    );
  });
});
