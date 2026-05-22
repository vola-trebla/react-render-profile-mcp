export interface StreamingChunkMetric {
  chunkId: string;
  payloadLength: number;
  resolvedPromises: number;
  durationMs: number;
  payloadType: "JSX" | "METADATA" | "CLIENT_BOUNDARY" | "ERROR";
  rawText: string;
}

export interface StreamAnalysisReport {
  isSafe: boolean;
  bloatedChunks: string[];
  waterfallDetections: string[];
  vulnerabilities: string[];
  recommendations: string[];
}

export class RSCStreamingProfiler {
  public static profileRSCStream(
    chunks: StreamingChunkMetric[],
  ): StreamAnalysisReport {
    const bloatedChunks: string[] = [];
    const waterfallDetections: string[] = [];
    const vulnerabilities: string[] = [];
    const recommendations: string[] = [];
    let isSafe = true;

    for (const chunk of chunks) {
      // 1. Audit Payload Size Bloat (Flag payloads exceeding a 50KB recommended budget)
      if (chunk.payloadLength > 51200) {
        bloatedChunks.push(
          `Chunk ${chunk.chunkId} is bloated: ${(chunk.payloadLength / 1024).toFixed(1)}KB. Passing large data objects increases network latency and serialization overhead.`,
        );
        recommendations.push(
          `Optimize Chunk ${chunk.chunkId}: Minimize database models before passing them to Client Components.`,
        );
      }

      // 2. Detect Suspense waterfalls from sequential promises
      if (chunk.resolvedPromises > 3 && chunk.durationMs > 150) {
        waterfallDetections.push(
          `Waterfalls detected on Chunk ${chunk.chunkId}: Awaited ${chunk.resolvedPromises} sequential Promises in render block.`,
        );
        recommendations.push(
          `Parallelize queries in Chunk ${chunk.chunkId} with Promise.all() to prevent blocking the stream.`,
        );
      }

      // 3. Scan for constructor chaining vulnerabilities (CVE-2025-55182 / React2Shell)
      const rcePattern = /\$\d+:(constructor|__proto__|prototype)(:\w+)+/gi;
      if (rcePattern.test(chunk.rawText)) {
        isSafe = false;
        vulnerabilities.push(
          `CRITICAL EXPLOIT DETECTED in Chunk ${chunk.chunkId}: Constructor traversing pattern matches React2Shell execution syntax.`,
        );
      }
    }

    return {
      isSafe,
      bloatedChunks,
      waterfallDetections,
      vulnerabilities,
      recommendations,
    };
  }

  /**
   * Helper to parse a raw line-separated Flight protocol stream log.
   */
  public static parseRawFlightStream(
    streamText: string,
  ): StreamingChunkMetric[] {
    const lines = streamText
      .split("\n")
      .filter((line) => line.trim().length > 0);
    return lines.map((line, idx) => {
      const payloadLength = Buffer.byteLength(line, "utf8");
      const firstColon = line.indexOf(":");
      const header = firstColon !== -1 ? line.substring(0, firstColon) : "";
      const typeChar = firstColon !== -1 ? line.charAt(firstColon + 1) : "";

      let payloadType: StreamingChunkMetric["payloadType"] = "METADATA";
      if (typeChar === "I") {
        payloadType = "CLIENT_BOUNDARY";
      } else if (typeChar === "J") {
        payloadType = "JSX";
      } else if (typeChar === "E") {
        payloadType = "ERROR";
      }

      // Estimate resolved promises based on "fulfilled" state markers
      const resolvedPromises = (line.match(/"status"\s*:\s*"fulfilled"/g) || [])
        .length;

      return {
        chunkId: header || `Chunk#${idx}`,
        payloadLength,
        resolvedPromises,
        durationMs: resolvedPromises > 0 ? resolvedPromises * 80 : 0, // Mock fallback latency
        payloadType,
        rawText: line,
      };
    });
  }
}
