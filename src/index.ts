#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { loadProfile } from "./parser.js";
import {
  getRenderSummary,
  findSpuriousRenders,
  getHottestComponents,
  traceRenderCascade,
  suggestMemoization,
} from "./analyzer.js";
import {
  analyzeCompilerEfficacy,
  diagnoseHydrationAndSuspense,
  evaluateExternalStorePerformance,
  traceStateCascadeFootprint,
} from "./diagnostics.js";

const server = new McpServer({
  name: "react-render-profile-mcp",
  version: "0.3.1",
});

function errorResponse(err: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: `Error: ${err instanceof Error ? err.message : String(err)}`,
      },
    ],
    isError: true,
  };
}

server.registerTool(
  "get_render_summary",
  {
    description:
      "Returns a high-level overview of a React DevTools Profiler export: total commits, total render time, " +
      "top 5 slowest components by self time, and total spurious (wasted) render count. " +
      "Use this first to understand the scale of the performance problem before drilling into specifics.",
    inputSchema: {
      profile_path: z
        .string()
        .describe(
          "Absolute path to the React DevTools Profiler export (.json)",
        ),
    },
  },
  async ({ profile_path }) => {
    try {
      const data = await loadProfile(profile_path);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(getRenderSummary(data), null, 2),
          },
        ],
      };
    } catch (err) {
      return errorResponse(err);
    }
  },
);

server.registerTool(
  "find_spurious_renders",
  {
    description:
      "Finds React components that re-rendered without any meaningful prop, state, context, or hook changes. " +
      "These are wasted renders caused by unstable references (inline objects/functions/arrays) passed from a parent. " +
      "Returns component name, total render count, spurious count, and wasted milliseconds. " +
      "Use to identify the highest-ROI targets for React.memo.",
    inputSchema: {
      profile_path: z
        .string()
        .describe(
          "Absolute path to the React DevTools Profiler export (.json)",
        ),
      min_render_count: z
        .number()
        .optional()
        .describe(
          "Only include components with at least this many total renders (default: 1)",
        ),
    },
  },
  async ({ profile_path, min_render_count }) => {
    try {
      const data = await loadProfile(profile_path);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              findSpuriousRenders(data, min_render_count),
              null,
              2,
            ),
          },
        ],
      };
    } catch (err) {
      return errorResponse(err);
    }
  },
);

server.registerTool(
  "get_hottest_components",
  {
    description:
      "Returns the top N React components ranked by self CPU time (excluding children) across the entire profiling session. " +
      "Includes total self ms, average per render, and percentage of total profile time. " +
      "Use to find which components are the most expensive to render, regardless of cause.",
    inputSchema: {
      profile_path: z
        .string()
        .describe(
          "Absolute path to the React DevTools Profiler export (.json)",
        ),
      top_n: z
        .number()
        .optional()
        .describe("Number of components to return (default: 10)"),
    },
  },
  async ({ profile_path, top_n }) => {
    try {
      const data = await loadProfile(profile_path);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(getHottestComponents(data, top_n), null, 2),
          },
        ],
      };
    } catch (err) {
      return errorResponse(err);
    }
  },
);

server.registerTool(
  "trace_render_cascade",
  {
    description:
      "For a specific React commit (render cycle), shows what triggered it and lists every component " +
      "that re-rendered as a result, sorted by actual duration descending. " +
      "Reveals propagation — e.g. a context update cascading into 40 children. " +
      "Call get_render_summary first to find total_commits, then use 0-based commit_index.",
    inputSchema: {
      profile_path: z
        .string()
        .describe(
          "Absolute path to the React DevTools Profiler export (.json)",
        ),
      commit_index: z
        .number()
        .describe("Zero-based index of the commit to inspect"),
    },
  },
  async ({ profile_path, commit_index }) => {
    try {
      const data = await loadProfile(profile_path);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              traceRenderCascade(data, commit_index),
              null,
              2,
            ),
          },
        ],
      };
    } catch (err) {
      return errorResponse(err);
    }
  },
);

server.registerTool(
  "suggest_memoization",
  {
    description:
      "Analyzes the profiling data and returns concrete memoization suggestions. " +
      "Currently detects React.memo candidates: components with spurious renders above the wasted ms threshold. " +
      "Each suggestion explains why the component re-renders unnecessarily and what to do about it.",
    inputSchema: {
      profile_path: z
        .string()
        .describe(
          "Absolute path to the React DevTools Profiler export (.json)",
        ),
      min_wasted_ms: z
        .number()
        .optional()
        .describe(
          "Only suggest for components wasting more than this many ms total (default: 0)",
        ),
    },
  },
  async ({ profile_path, min_wasted_ms }) => {
    try {
      const data = await loadProfile(profile_path);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              suggestMemoization(data, min_wasted_ms),
              null,
              2,
            ),
          },
        ],
      };
    } catch (err) {
      return errorResponse(err);
    }
  },
);

server.registerTool(
  "analyze_compiler_efficacy",
  {
    description:
      "Evaluates React Compiler or manual React.memo efficacy by tracking spurious renders. " +
      "Calculates the Invalidation Index for each component to identify where unstable " +
      "prop references trigger wasteful renders.",
    inputSchema: {
      profile_path: z
        .string()
        .describe(
          "Absolute path to the React DevTools Profiler export (.json)",
        ),
      invalid_threshold: z
        .number()
        .optional()
        .describe(
          "Minimum invalidation index threshold to report (default: 10)",
        ),
    },
  },
  async ({ profile_path, invalid_threshold }) => {
    try {
      const data = await loadProfile(profile_path);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              analyzeCompilerEfficacy(data, invalid_threshold),
              null,
              2,
            ),
          },
        ],
      };
    } catch (err) {
      return errorResponse(err);
    }
  },
);

server.registerTool(
  "diagnose_hydration_and_suspense",
  {
    description:
      "Detects server-client hydration mismatches and sequential nested Suspense waterfalls " +
      "by analyzing mount durations, unmount events, and timelines.",
    inputSchema: {
      profile_path: z
        .string()
        .describe(
          "Absolute path to the React DevTools Profiler export (.json)",
        ),
      waterfall_threshold_ms: z
        .number()
        .optional()
        .describe(
          "Timeline delta threshold in ms to detect Suspense waterfalls (default: 100)",
        ),
    },
  },
  async ({ profile_path, waterfall_threshold_ms }) => {
    try {
      const data = await loadProfile(profile_path);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              diagnoseHydrationAndSuspense(data, waterfall_threshold_ms),
              null,
              2,
            ),
          },
        ],
      };
    } catch (err) {
      return errorResponse(err);
    }
  },
);

server.registerTool(
  "evaluate_external_store_performance",
  {
    description:
      "Analyzes useSyncExternalStore performance, identifying selector reference instability " +
      "and concurrency bypasses where heavy store updates block the high-priority main thread.",
    inputSchema: {
      profile_path: z
        .string()
        .describe(
          "Absolute path to the React DevTools Profiler export (.json)",
        ),
      max_blocking_task_ms: z
        .number()
        .optional()
        .describe(
          "Maximum duration budget in ms for synchronous tasks before flagging bypass (default: 50)",
        ),
    },
  },
  async ({ profile_path, max_blocking_task_ms }) => {
    try {
      const data = await loadProfile(profile_path);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              evaluateExternalStorePerformance(data, max_blocking_task_ms),
              null,
              2,
            ),
          },
        ],
      };
    } catch (err) {
      return errorResponse(err);
    }
  },
);

server.registerTool(
  "trace_state_cascade_footprint",
  {
    description:
      "Reconstructs the virtual parent/owner tree traversal to measure the depth and consumer " +
      "count of a state update cascade for a specific commit index.",
    inputSchema: {
      profile_path: z
        .string()
        .describe(
          "Absolute path to the React DevTools Profiler export (.json)",
        ),
      commit_index: z
        .number()
        .describe("Zero-based index of the commit to trace"),
    },
  },
  async ({ profile_path, commit_index }) => {
    try {
      const data = await loadProfile(profile_path);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              traceStateCascadeFootprint(data, commit_index),
              null,
              2,
            ),
          },
        ],
      };
    } catch (err) {
      return errorResponse(err);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
