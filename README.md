# react-render-profile-mcp 🐸⚡

[![npm version](https://img.shields.io/npm/v/react-render-profile-mcp.svg)](https://www.npmjs.com/package/react-render-profile-mcp)
[![npm downloads](https://img.shields.io/npm/dm/react-render-profile-mcp.svg)](https://www.npmjs.com/package/react-render-profile-mcp)
[![CI](https://github.com/vola-trebla/react-render-profile-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/vola-trebla/react-render-profile-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An MCP server that decodes React DevTools Profiler exports into **actionable performance diagnostics and render summaries** for AI agents.

Your agent just refactored a context provider or updated state logic. Now 80 components re-render on every keystroke. It has no idea. This server bridges that visual and runtime perception gap.

---

## 🤔 The Problem

AI agents modify React state management, restructure component trees, and refactor context — and they're completely blind to the performance impact.

The React DevTools Profiler can capture exactly what happened: which components re-rendered, why, and how long it took. But the exported `.json` is a dense structure with Fiber IDs, encoded operations, and microsecond timing data across hundreds of commits.

```json
{
  "version": 5,
  "dataForRoots": [{
    "commitData": [{
      "fiberActualDurations": [[3, 15.2], [4, 8.1], [142, 3.2], ...],
      "fiberSelfDurations": [[3, 3.9], [4, 4.9], [142, 3.2], ...],
      "changeDescriptions": { "4": { "props": [], "didHooksChange": false, ... } },
      ...
    }],
    ...
  }]
}
```

The agent can't parse this. Even if it could, it can't run the aggregation to identify which components are wasting renders — it's raw tick data, not a performance summary.

---

## ✅ The Solution

This MCP server loads the profiler export and gives agents exactly what they need:

- **Render Summaries & Lifecycle Anomaly Detection**: Spotting components being destroyed/recreated (unstable `key` prop) instead of updated.
- **Spurious Renders Classification**: Labeling triggers (`UNSTABLE_PARENT_REF`, `CONTEXT_UPDATE`, `INTENTIONAL_CONCURRENT_YIELD`).
- **Next-Gen SRE Diagnostic Tools**: Checking React Compiler efficacy, client-side hydration mismatches, Suspense waterfalls, Zustand/Redux selector loops, and update cascade propagation depths.

---

## 🛠️ MCP Tools

All tools take a required `profile_path` (absolute path to the exported `.json` profile).

---

### 1. `get_render_summary`

Provides a high-level overview: total commits, total render time, top 5 slowest components, and total spurious render count. Each component includes lifecycle counts so the agent can spot key-instability patterns.

```json
{
  "total_commits": 24,
  "total_render_ms": 312.4,
  "total_spurious_renders": 18,
  "top_components": [
    {
      "component": "ProductList",
      "render_count": 24,
      "mount_count": 1,
      "unmount_count": 0,
      "update_count": 23,
      "lifecycle_anomaly": false,
      "total_self_ms": 89.2,
      "pct_of_total": 28.55
    },
    {
      "component": "ListItem",
      "render_count": 20,
      "mount_count": 20,
      "unmount_count": 19,
      "update_count": 0,
      "lifecycle_anomaly": true,
      "total_self_ms": 61.1,
      "pct_of_total": 19.56
    }
  ]
}
```

- `lifecycle_anomaly: true` indicates that a component is unmounted and mounted again on every commit instead of updating (a sign of unstable or index-based `key` props).

---

### 2. `find_spurious_renders`

Identifies components that re-rendered unnecessarily, with the root cause classified so the agent knows the correct fix.

```json
{
  "spurious_renders": [
    {
      "component": "ProductList",
      "render_count": 24,
      "spurious_count": 23,
      "wasted_ms": 84.3,
      "render_trigger": "UNSTABLE_PARENT_REF",
      "concurrent_yield": false,
      "recommendation": "Wrap with React.memo — re-renders are driven by unstable object/function/array references from the parent."
    },
    {
      "component": "UserAvatar",
      "render_count": 12,
      "spurious_count": 11,
      "wasted_ms": 18.7,
      "render_trigger": "CONTEXT_UPDATE",
      "concurrent_yield": false,
      "recommendation": "React.memo cannot help here — context updates bypass memo. Stabilize the context value with useMemo, or split the context."
    }
  ]
}
```

---

### 3. `analyze_compiler_efficacy`

Computes the **Invalidation Index** ($I = \frac{S_{spurious}}{S_{total}} \times T_{spurious\_ms}$) to highlight where manual `React.memo` or React Compiler (React 19) fails due to inline object allocations or unstable parent references.

- **Optional Parameter**: `invalid_threshold` (number, default: `10`).

```json
{
  "verdicts": [
    {
      "severity": "CRITICAL",
      "component_name": "ProductList",
      "target_file_path": "src/components/ProductList.tsx",
      "ineffective_render_count": 23,
      "wasted_ms": 84.3,
      "trigger_cause": "UNSTABLE_PARENT_PROP_REFERENCE",
      "recommendation": "🐸 Ineffective rendering detected! Component <ProductList> has a high invalidation index (80.79) due to spurious renders. Memoize parent component props using useMemo/useCallback or hoist static objects out of the parent's render function to stabilize references."
    }
  ]
}
```

---

### 4. `diagnose_hydration_and_suspense`

Catches client-side hydration mismatches (where React discards server-rendered HTML and mounts the tree from scratch) and monitors spacing between consecutive Suspense resolves to flag sequential nested mount fetch waterfalls.

- **Optional Parameter**: `waterfall_threshold_ms` (number, default: `100`).

```json
{
  "verdicts": [
    {
      "severity": "CRITICAL",
      "anomaly_type": "HYDRATION_MISMATCH_RECOVERY",
      "root_component": "App",
      "affected_suspense_boundaries": ["SuspenseList", "SidebarSuspense"],
      "blocking_duration_ms": 185.4,
      "trigger_cause": "NON_DETERMINISTIC_MARKUP",
      "recommendation": "🐸 Hydration mismatch recovery detected. The initial mount took abnormally long with unmounts. Ensure server and client HTML markup match exactly. Avoid browser-only APIs (window, document) or random/time values during initial render, or wrap them in useEffect."
    },
    {
      "severity": "WARNING",
      "anomaly_type": "NESTED_MOUNT_FETCH_WATERFALL",
      "root_component": "ProfileDetails",
      "affected_suspense_boundaries": ["ProfileDetails"],
      "blocking_duration_ms": 120.5,
      "trigger_cause": "NESTED_MOUNT_FETCH_WATERFALL",
      "recommendation": "🐸 Suspense Waterfall detected! Boundary <ProfileDetails> took 120.5ms to resolve. Avoid nested Suspense boundaries fetching data sequentially. Prefetch data at the parent level, use Promise.all, or migrate to a data-fetching framework."
    }
  ]
}
```

---

### 5. `evaluate_external_store_performance`

Tracks Zustand/Redux selector reference changes that trigger rapid consecutive renders, and identifies synchronous concurrency bypasses where heavy store updates block high-priority lanes.

- **Optional Parameter**: `max_blocking_task_ms` (number, default: `50`).

```json
{
  "verdicts": [
    {
      "severity": "CRITICAL",
      "store_hook_id": "useSyncExternalStore",
      "impacted_components": ["CartSummary"],
      "longest_sync_task_ms": 12.5,
      "is_infinite_loop": true,
      "trigger_cause": "UNSTABLE_SELECTOR_OBJECT_ALLOCATION",
      "recommendation": "🐸 Unstable store selector! Component <CartSummary> rendered rapidly in consecutive frames (10 times). The selector function likely returns a new object reference on every call. Wrap the selector in useCallback or return primitive values to prevent unnecessary store trigger cycles."
    },
    {
      "severity": "WARNING",
      "store_hook_id": "useSyncExternalStore",
      "impacted_components": ["BigStoreProvider"],
      "longest_sync_task_ms": 68.2,
      "is_infinite_loop": false,
      "trigger_cause": "SYNC_CONCURRENCY_BYPASS",
      "recommendation": "🐸 Concurrency bypass! Heavy synchronous store update took 68.2ms in high-priority lane. Wrap store dispatch or update actions in startTransition to run them concurrently without blocking the main UI thread."
    }
  ]
}
```

---

### 6. `trace_state_cascade_footprint`

Reconstructs virtual trees to trace propagation depth and the consumer count of updates for a specific commit index, classifying them into Context cascades or Store Subscriber ripples.

- **Required Parameter**: `commit_index` (integer).

```json
{
  "verdict": {
    "severity": "HIGH_FOOTPRINT",
    "update_trigger_source": "ThemeButton",
    "propagation_channel": "CONTEXT_PROVIDER",
    "cascade_render_depth": 7,
    "rendered_consumer_count": 28,
    "total_duration_ms": 42.1,
    "recommendation": "🐸 Context propagation wave! Split the context provider into smaller, more focused providers, or memoize context values and children to prevent re-rendering all consumers on any minor value change."
  }
}
```

---

### 7. `suggest_memoization`

Provides memoization recommendations with ROI viability scores. It flags if a component is too fast (< 2ms average) for memoization, since `Object.is` overhead can exceed render cost.

```json
{
  "suggestions": [
    {
      "component": "ProductList",
      "render_count": 24,
      "spurious_count": 23,
      "wasted_ms": 84.3,
      "avg_render_ms": 3.72,
      "prop_stability": "UNSTABLE_REFERENCES",
      "recommendation": "MEMOIZE",
      "reasoning": "Re-rendered 23×/24 times with unchanged props, wasting 84.3ms. Wrap with React.memo to skip renders when props are shallowly equal."
    },
    {
      "component": "Badge",
      "render_count": 30,
      "spurious_count": 28,
      "wasted_ms": 4.2,
      "avg_render_ms": 0.15,
      "prop_stability": "UNSTABLE_REFERENCES",
      "recommendation": "DO_NOT_MEMOIZE",
      "reasoning": "avg render time (0.15ms) is below 2ms — React.memo comparison overhead likely exceeds render cost. Fix the unstable reference in the parent instead."
    }
  ]
}
```

---

### 8. `get_hottest_components` & `trace_render_cascade`

- `get_hottest_components` lists components taking the most CPU self-time.
- `trace_render_cascade` lists the sequential render chain for any specific commit, showing timing, triggers, and parent-child dependencies.

---

## 🚀 Setup

### Claude Desktop

Add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "react-render-profile": {
      "command": "npx",
      "args": ["-y", "react-render-profile-mcp"]
    }
  }
}
```

### Cursor / VS Code / Other MCP Clients

```json
{
  "react-render-profile": {
    "command": "npx",
    "args": ["-y", "react-render-profile-mcp"]
  }
}
```

---

## 📋 How to Export a Profile

1. Open React DevTools in Chrome/Firefox DevTools.
2. Navigate to the **Profiler** tab.
3. Click **Record**, interact with your application, then click **Stop**.
4. Click the **Save Profile** icon (💾) to download the `.json` file.
5. Provide the absolute path to this file as `profile_path` to the MCP tools.

---

## 🔧 Under the Hood

The parser decodes the React DevTools Profiler export format (version 5):

- **Fiber to Name Mapping**: Extracted from `snapshots` (primary) or decoded from `operations` opcodes (fallback).
- **Spurious Render Math**: Uses `changeDescriptions.props === []` — where React detects a props reference change but no values actually changed.
- **Concurrent Mode Lane Detection**: Examines `commit.priorityLevel` (`"Low Priority"` / `"Idle"` indicate `startTransition`/`useDeferredValue` lanes) to avoid flagging intentional concurrent yields as regressions.
- **Virtual Tree Reconstruction**: Builds parent-child and owner relationships using `parentMap` and `operations` ADD/REMOVE opcodes.

No React runtime or DevTools dependency is needed. Just fast, pure JSON parsing.

---

## 📖 Recommended Agent Debugging Workflow

To optimize performance systematically, let your agent follow this workflow:

```
1. get_render_summary         → Get high-level overview & detect lifecycle_anomalies (key bugs).
2. find_spurious_renders      → Map which renders are unnecessary vs context-driven.
3. analyze_compiler_efficacy  → Check where React Compiler or React.memo is bypassed.
4. diagnose_hydration_and_suspense → Pinpoint hydration mismatch blocks and nested waterfalls.
5. evaluate_external_store_performance → Spot Zustand/Redux loops and blocking sync tasks.
6. trace_state_cascade_footprint → Find the propagation channel & depth of heavy commits.
7. suggest_memoization        → Get high-ROI React.memo recommendation verdicts.
```

---

## 🐸 Part of the MCP Toolbelt

Built alongside:

- [tailwind-context-resolver-mcp](https://github.com/vola-trebla/tailwind-context-resolver-mcp) — Resolve Tailwind design tokens and validate utility classes.
- [v8-cpu-profile-decoder-mcp](https://github.com/vola-trebla/v8-cpu-profile-decoder-mcp) — Decode V8 CPU profiles for deep Node.js performance triaging.

---

## License

MIT
