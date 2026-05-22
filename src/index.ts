#!/usr/bin/env node
import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import fs from "fs/promises";
import { loadProfile } from "./parser.js";
import { ASTPerformanceRemediator } from "./remediator.js";
import { CompilerEfficacyAuditor } from "./compilerAuditor.js";
import { RSCStreamingProfiler } from "./rscProfiler.js";
import { MultiLayerTimelineCorrelator } from "./correlator.js";
import { DynamicSVGGenerator } from "./visualizer.js";
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
  version: "1.0.0",
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

function registerProfileTool(
  name: string,
  description: string,
  inputSchema: any,
  handler: (data: any, args: any) => any,
) {
  server.registerTool(
    name,
    {
      description,
      inputSchema,
    },
    async (args: any): Promise<any> => {
      try {
        const data = await loadProfile(args.profile_path);
        const result = await handler(data, args);
        return {
          content: [
            {
              type: "text" as const,
              text:
                typeof result === "string"
                  ? result
                  : JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );
}

registerProfileTool(
  "get_render_summary",
  "Returns a high-level overview of a React DevTools Profiler export: total commits, total render time, " +
    "top 5 slowest components by self time, and total spurious (wasted) render count. " +
    "Use this first to understand the scale of the performance problem before drilling into specifics.",
  {
    profile_path: z
      .string()
      .describe("Absolute path to the React DevTools Profiler export (.json)"),
  },
  (data) => getRenderSummary(data),
);

registerProfileTool(
  "find_spurious_renders",
  "Finds React components that re-rendered without any meaningful prop, state, context, or hook changes. " +
    "These are wasted renders caused by unstable references (inline objects/functions/arrays) passed from a parent. " +
    "Returns component name, total render count, spurious count, and wasted milliseconds. " +
    "Use to identify the highest-ROI targets for React.memo.",
  {
    profile_path: z
      .string()
      .describe("Absolute path to the React DevTools Profiler export (.json)"),
    min_render_count: z
      .number()
      .optional()
      .describe(
        "Only include components with at least this many total renders (default: 1)",
      ),
  },
  (data, { min_render_count }) => findSpuriousRenders(data, min_render_count),
);

registerProfileTool(
  "get_hottest_components",
  "Returns the top N React components ranked by self CPU time (excluding children) across the entire profiling session. " +
    "Includes total self ms, average per render, and percentage of total profile time. " +
    "Use to find which components are the most expensive to render, regardless of cause.",
  {
    profile_path: z
      .string()
      .describe("Absolute path to the React DevTools Profiler export (.json)"),
    top_n: z
      .number()
      .optional()
      .describe("Number of components to return (default: 10)"),
  },
  (data, { top_n }) => getHottestComponents(data, top_n),
);

registerProfileTool(
  "trace_render_cascade",
  "For a specific React commit (render cycle), shows what triggered it and lists every component " +
    "that re-rendered as a result, sorted by actual duration descending. " +
    "Reveals propagation — e.g. a context update cascading into 40 children. " +
    "Call get_render_summary first to find total_commits, then use 0-based commit_index.",
  {
    profile_path: z
      .string()
      .describe("Absolute path to the React DevTools Profiler export (.json)"),
    commit_index: z
      .number()
      .describe("Zero-based index of the commit to inspect"),
  },
  (data, { commit_index }) => traceRenderCascade(data, commit_index),
);

registerProfileTool(
  "suggest_memoization",
  "Analyzes the profiling data and returns concrete memoization suggestions. " +
    "Currently detects React.memo candidates: components with spurious renders above the wasted ms threshold. " +
    "Each suggestion explains why the component re-renders unnecessarily and what to do about it.",
  {
    profile_path: z
      .string()
      .describe("Absolute path to the React DevTools Profiler export (.json)"),
    min_wasted_ms: z
      .number()
      .optional()
      .describe(
        "Only suggest for components wasting more than this many ms total (default: 0)",
      ),
  },
  (data, { min_wasted_ms }) => suggestMemoization(data, min_wasted_ms),
);

registerProfileTool(
  "analyze_compiler_efficacy",
  "Evaluates React Compiler or manual React.memo efficacy by tracking spurious renders. " +
    "Calculates the Invalidation Index for each component to identify where unstable " +
    "prop references trigger wasteful renders.",
  {
    profile_path: z
      .string()
      .describe("Absolute path to the React DevTools Profiler export (.json)"),
    invalid_threshold: z
      .number()
      .optional()
      .describe("Minimum invalidation index threshold to report (default: 10)"),
  },
  (data, { invalid_threshold }) =>
    analyzeCompilerEfficacy(data, invalid_threshold),
);

registerProfileTool(
  "diagnose_hydration_and_suspense",
  "Detects server-client hydration mismatches and sequential nested Suspense waterfalls " +
    "by analyzing mount durations, unmount events, and timelines.",
  {
    profile_path: z
      .string()
      .describe("Absolute path to the React DevTools Profiler export (.json)"),
    waterfall_threshold_ms: z
      .number()
      .optional()
      .describe(
        "Timeline delta threshold in ms to detect Suspense waterfalls (default: 100)",
      ),
  },
  (data, { waterfall_threshold_ms }) =>
    diagnoseHydrationAndSuspense(data, waterfall_threshold_ms),
);

registerProfileTool(
  "evaluate_external_store_performance",
  "Analyzes useSyncExternalStore performance, identifying selector reference instability " +
    "and concurrency bypasses where heavy store updates block the high-priority main thread.",
  {
    profile_path: z
      .string()
      .describe("Absolute path to the React DevTools Profiler export (.json)"),
    max_blocking_task_ms: z
      .number()
      .optional()
      .describe(
        "Maximum duration budget in ms for synchronous tasks before flagging bypass (default: 50)",
      ),
  },
  (data, { max_blocking_task_ms }) =>
    evaluateExternalStorePerformance(data, max_blocking_task_ms),
);

registerProfileTool(
  "trace_state_cascade_footprint",
  "Reconstructs the virtual parent/owner tree traversal to measure the depth and consumer " +
    "count of a state update cascade for a specific commit index.",
  {
    profile_path: z
      .string()
      .describe("Absolute path to the React DevTools Profiler export (.json)"),
    commit_index: z
      .number()
      .describe("Zero-based index of the commit to trace"),
  },
  (data, { commit_index }) => traceStateCascadeFootprint(data, commit_index),
);

server.registerResource(
  "react-profile-cascade",
  new ResourceTemplate("react-profile://commits/{commitId}/cascade", {
    list: undefined,
  }),
  {
    mimeType: "image/svg+xml",
    description:
      "Interactive SVG flowchart displaying rendering cascades for a React commit",
  },
  async (uri, variables) => {
    try {
      const commitId = variables.commitId;
      if (typeof commitId !== "string" && typeof commitId !== "number") {
        throw new Error("Missing or invalid commitId variable");
      }
      const commitIndex = parseInt(String(commitId), 10);
      const profilePath = uri.searchParams.get("profile_path");
      if (!profilePath) {
        throw new Error("Missing profile_path query parameter");
      }
      const data = await loadProfile(profilePath);
      // Construct CascadeNode tree
      const commit = data.commits[commitIndex];
      if (!commit) {
        throw new Error(`Commit index ${commitIndex} not found in profile`);
      }
      const renderedFiberIds = new Set(
        commit.fiberActualDurations.map(([id]) => id),
      );
      if (renderedFiberIds.size === 0) {
        throw new Error(
          `No components rendered in commit index ${commitIndex}`,
        );
      }

      const buildNode = (fiberId: number, depth: number): any => {
        const name = data.nameMap.get(fiberId) ?? `[Component #${fiberId}]`;
        const renderDuration =
          commit.fiberActualDurations.find(([id]) => id === fiberId)?.[1] ?? 0;

        const desc = commit.changeDescriptions?.[String(fiberId)];
        let triggerSource:
          | "CONTEXT"
          | "STORE_SUBSCRIPTION"
          | "PROPS_INVALIDATION"
          | "STATE_CHANGE" = "PROPS_INVALIDATION";
        if (desc) {
          if (desc.context) {
            triggerSource = "CONTEXT";
          } else if (desc.state && desc.state.length > 0) {
            triggerSource = "STATE_CHANGE";
          } else if (desc.didHooksChange) {
            triggerSource = "STORE_SUBSCRIPTION";
          }
        }

        const childrenIds = data.childrenMap.get(fiberId) ?? [];
        const renderedChildren = childrenIds.filter((id) =>
          renderedFiberIds.has(id),
        );
        const childrenNodes = renderedChildren.map((childId) =>
          buildNode(childId, depth + 1),
        );

        return {
          id: String(fiberId),
          name,
          renderDuration,
          triggerSource,
          depth,
          children: childrenNodes,
        };
      };

      const roots = Array.from(renderedFiberIds).filter((id) => {
        const parentId = data.parentMap.get(id);
        return !parentId || !renderedFiberIds.has(parentId);
      });

      if (roots.length === 0) {
        throw new Error("Could not determine cascade root component");
      }

      let rootNode;
      if (roots.length === 1) {
        rootNode = buildNode(roots[0], 0);
      } else {
        const children = roots.map((rootId) => buildNode(rootId, 1));
        rootNode = {
          id: "virtual-root",
          name: "Render Cascade Root",
          renderDuration: commit.duration,
          triggerSource: "STATE_CHANGE" as const,
          depth: 0,
          children,
        };
      }

      const svg = DynamicSVGGenerator.generateRenderCascade(rootNode);
      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: "image/svg+xml",
            text: svg,
          },
        ],
      };
    } catch (err) {
      throw err;
    }
  },
);

server.registerTool(
  "remediate_component",
  {
    description:
      "Automatically optimizes a React component's AST by hoisting static declarations, " +
      "wrapping unstable callbacks/objects in useCallback/useMemo, and wrapping the component " +
      "in React.memo if the ROI score is above 1.5. Mutates the file on disk.",
    inputSchema: {
      file_path: z
        .string()
        .describe("Absolute path to the React component file on disk"),
      component_name: z
        .string()
        .describe("Name of the React component to optimize"),
      unstable_props: z
        .string()
        .describe(
          "Comma-separated or space-separated list of props to memoize/wrap in hooks",
        ),
      roi_score: z
        .number()
        .describe(
          "Estimated ROI score from profiling (usually 0 to 5) justifying memoization overhead",
        ),
    },
  },
  async ({ file_path, component_name, unstable_props, roi_score }) => {
    try {
      const remediator = new ASTPerformanceRemediator();
      const updatedCode = remediator.optimizeComponent({
        filePath: file_path,
        componentName: component_name,
        unstableProps: unstable_props,
        roiScore: roi_score,
      });
      return {
        content: [
          {
            type: "text",
            text: `Successfully optimized component ${component_name} in ${file_path}.\n\nUpdated AST Output:\n\n${updatedCode}`,
          },
        ],
      };
    } catch (err) {
      return errorResponse(err);
    }
  },
);

server.registerTool(
  "audit_compiler_rules",
  {
    description:
      "Audits a React component file to check if it violates compiler memoization safety guidelines " +
      "(e.g., Date.now(), Math.random(), useRef mutations in render, 'use no memo' bails).",
    inputSchema: {
      file_path: z
        .string()
        .describe("Absolute path to the React component file on disk"),
      component_name: z
        .string()
        .describe("Name of the React component to audit"),
    },
  },
  async ({ file_path, component_name }) => {
    try {
      const auditor = new CompilerEfficacyAuditor();
      const result = auditor.auditComponentInFile(file_path, component_name);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      return errorResponse(err);
    }
  },
);

server.registerTool(
  "profile_rsc_stream",
  {
    description:
      "Analyzes a React Server Components (RSC) Flight stream text log. " +
      "Detects bloated chunks (>50KB), sequential Waterfall request bottlenecks, " +
      "and security hazards like constructor traversing exploits (CVE-2025-55182 / React2Shell).",
    inputSchema: {
      stream_payload: z
        .string()
        .describe("Raw line-separated Flight stream text payload"),
    },
  },
  async ({ stream_payload }) => {
    try {
      const chunks = RSCStreamingProfiler.parseRawFlightStream(stream_payload);
      const result = RSCStreamingProfiler.profileRSCStream(chunks);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      return errorResponse(err);
    }
  },
);

registerProfileTool(
  "correlate_chrome_trace",
  "Aligns React commits with Chrome Performance trace events (re-layout, paint, style calculations) " +
    "using blink.user_timing ⚛ markers to calculate Core Web Vitals (INP/CLS) impact.",
  {
    profile_path: z
      .string()
      .describe("Absolute path to the React DevTools Profiler export (.json)"),
    trace_path: z
      .string()
      .describe(
        "Absolute path to Chrome performance timeline trace export (.json)",
      ),
  },
  async (data, { trace_path }) => {
    const rawTrace = await fs.readFile(trace_path, "utf-8");

    let traceEvents: any;
    try {
      const parsed = JSON.parse(rawTrace);
      traceEvents = Array.isArray(parsed) ? parsed : parsed.traceEvents;
    } catch {
      throw new Error(`Failed to parse Chrome Trace JSON from: ${trace_path}`);
    }

    if (!traceEvents || !Array.isArray(traceEvents)) {
      throw new Error(
        `Invalid Chrome Trace file format at: ${trace_path}. Expected traceEvents array.`,
      );
    }

    const commits = data.commits.map((c: any, idx: number) => ({
      commitIndex: idx,
      commitTime: c.timestamp,
      duration: c.duration,
    }));

    return MultiLayerTimelineCorrelator.correlateTimeline(commits, traceEvents);
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
