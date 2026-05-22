import { describe, it, expect } from "vitest";
import { RSCStreamingProfiler } from "../src/rscProfiler.js";

describe("RSC Streaming Profiler", () => {
  it("parses and profiles a standard RSC Flight stream log", () => {
    const payload = `
1:I{"id":"./src/components/ClientComp.tsx","name":""}
2:J["$","div",null,{"children":"Hello World"}]
`;
    const chunks = RSCStreamingProfiler.parseRawFlightStream(payload);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].payloadType).toBe("CLIENT_BOUNDARY");
    expect(chunks[1].payloadType).toBe("JSX");

    const report = RSCStreamingProfiler.profileRSCStream(chunks);
    expect(report.isSafe).toBe(true);
    expect(report.bloatedChunks).toHaveLength(0);
    expect(report.waterfallDetections).toHaveLength(0);
  });

  it("flags bloated chunks above 50KB budget", () => {
    // Generate a line exceeding 50KB
    const largeJson = "A".repeat(55 * 1024);
    const payload = `1:J{"data":"${largeJson}"}\n`;

    const chunks = RSCStreamingProfiler.parseRawFlightStream(payload);
    const report = RSCStreamingProfiler.profileRSCStream(chunks);

    expect(report.bloatedChunks).toHaveLength(1);
    expect(report.bloatedChunks[0]).toContain("is bloated");
    expect(report.recommendations).toContain(
      "Optimize Chunk 1: Minimize database models before passing them to Client Components.",
    );
  });

  it("detects sequential Suspense waterfalls", () => {
    const payload = `
1:J{"status":"fulfilled","status":"fulfilled","status":"fulfilled","status":"fulfilled"}
`;
    // We mock the parsed metric to simulate heavy resolved promises and high duration
    const chunks = RSCStreamingProfiler.parseRawFlightStream(payload);
    // Force chunk duration and resolvedPromises to trigger the waterfall rule (>3 promises, >150ms)
    chunks[0].resolvedPromises = 4;
    chunks[0].durationMs = 200;

    const report = RSCStreamingProfiler.profileRSCStream(chunks);

    expect(report.waterfallDetections).toHaveLength(1);
    expect(report.waterfallDetections[0]).toContain("Waterfalls detected");
    expect(report.recommendations).toContain(
      "Parallelize queries in Chunk 1 with Promise.all() to prevent blocking the stream.",
    );
  });

  it("detects constructor traversing exploits (CVE-2025-55182 / React2Shell)", () => {
    const payload = `
1:J{"status":"fulfilled","data":"$1:constructor:prototype:toString"}
`;
    const chunks = RSCStreamingProfiler.parseRawFlightStream(payload);
    const report = RSCStreamingProfiler.profileRSCStream(chunks);

    expect(report.isSafe).toBe(false);
    expect(report.vulnerabilities).toHaveLength(1);
    expect(report.vulnerabilities[0]).toContain("CRITICAL EXPLOIT DETECTED");
  });
});
