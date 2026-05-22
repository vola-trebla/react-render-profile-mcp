# react-render-profile-mcp 🐸⚡

[![npm version](https://img.shields.io/npm/v/react-render-profile-mcp.svg)](https://www.npmjs.com/package/react-render-profile-mcp)
[![npm downloads](https://img.shields.io/npm/dm/react-render-profile-mcp.svg)](https://www.npmjs.com/package/react-render-profile-mcp)
[![CI](https://github.com/vola-trebla/react-render-profile-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/vola-trebla/react-render-profile-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An MCP server that decodes React DevTools Profiler exports into **actionable performance diagnostics, interactive SVG cascades, and AST auto-remediations** for AI agents.

Your agent just refactored a context provider or updated state logic. Now 80 components re-render on every keystroke. It has no idea. This server bridges that visual, runtime, and remediation perception gap.

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

The agent can't parse this. Even if it could, it can't run the aggregation to identify which components are wasting renders — it's raw tick data, not a performance summary. And once a bottleneck is found, the agent must spend time manually rewriting AST trees to hoist static literals or add hooks.

---

## ✅ The Solution

This MCP server loads the profiler export and gives agents exactly what they need:

- **Render Summaries & Lifecycle Anomaly Detection**: Spotting components being destroyed/recreated (unstable `key` prop) instead of updated.
- **Spurious Renders Classification**: Labeling triggers (`UNSTABLE_PARENT_REF`, `CONTEXT_UPDATE`, `INTENTIONAL_CONCURRENT_YIELD`).
- **Next-Gen SRE Diagnostic Tools**: Checking React Compiler efficacy, client-side hydration mismatches, Suspense waterfalls, Zustand/Redux selector loops, and update cascade propagation depths.
- **Interactive SVG Cascades**: Generating parent-child render cascades via MCP Resource Templates.
- **AST Auto-Remediation**: Hoisting static object/array literals, wrapping dynamic variables in `useCallback` / `useMemo`, and adding `React.memo` based on calculated ROI scores.
- **RSC Flight Stream Profiling**: Auditing payload size (>50KB), request waterfalls, and scanning for prototype traversal hazards like **CVE-2025-55182 (React2Shell)**.

---

## 🛠️ MCP Tools & Resources

### Interactive Resources

#### `react-profile-cascade`

Dynamic SVG flowchart visualizer representing rendering cascades for a React commit.

- **URI Template**: `react-profile://commits/{commitId}/cascade?profile_path={profile_path}`
- Distinct HSL colors indicate triggering propagation channels:
  - 🔵 **Context Trigger**: Blue (ocean wave)
  - 🟠 **Zustand/Store Subscription**: Orange (subscriber ripple)
  - 🔴 **Props Invalidation**: Red (reference mismatch)
  - 🟢 **State Change**: Green (emerald trigger source)

---

### Profiler Data Tools

#### 1. `get_render_summary`

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

#### 2. `find_spurious_renders`

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
    }
  ]
}
```

---

#### 3. `analyze_compiler_efficacy`

Computes the **Invalidation Index** ($I = \frac{S_{spurious}}{S_{total}} \times T_{spurious\_ms}$) to highlight where manual `React.memo` or React Compiler (React 19) fails due to inline object allocations.

- **Optional Parameter**: `invalid_threshold` (number, default: `10`).

---

#### 4. `diagnose_hydration_and_suspense`

Catches client-side hydration mismatches (where React discards server-rendered HTML and mounts the tree from scratch) and monitors spacing between consecutive Suspense resolves to flag sequential nested mount fetch waterfalls.

- **Optional Parameter**: `waterfall_threshold_ms` (number, default: `100`).

---

#### 5. `evaluate_external_store_performance`

Tracks Zustand/Redux selector reference changes that trigger rapid consecutive renders, and identifies synchronous concurrency bypasses where heavy store updates block high-priority lanes.

- **Optional Parameter**: `max_blocking_task_ms` (number, default: `50`).

---

#### 6. `trace_state_cascade_footprint`

Reconstructs virtual trees to trace propagation depth and the consumer count of updates for a specific commit index.

- **Required Parameter**: `commit_index` (integer).

---

#### 7. `suggest_memoization`

Provides memoization recommendations with ROI viability scores. It flags if a component is too fast (< 2ms average) for memoization, since `Object.is` overhead can exceed render cost.

---

#### 8. `get_hottest_components` & `trace_render_cascade`

- `get_hottest_components` lists components taking the most CPU self-time.
- `trace_render_cascade` lists the sequential render chain for any specific commit, showing timing, triggers, and parent-child dependencies.

---

### Remediation & Advanced Tools

#### 9. `remediate_component`

Automatically optimizes a React component's AST on disk using `ts-morph`:

- **Hoisting**: Move static array and object literals out of render scope.
- **Hook Wrapping**: Wrap unstable variables/closures in `useCallback` / `useMemo` with computed dependency arrays.
- **Memoization Wrapping**: Wraps the component declaration in `React.memo` if its profiling ROI score exceeds `1.5`.

```json
// Parameters
{
  "file_path": "/path/to/Component.tsx",
  "component_name": "ProductList",
  "unstable_props": "items, filterOptions, onItemClick",
  "roi_score": 2.4
}
```

---

#### 10. `audit_compiler_rules`

Statically audits a component file on disk to identify violations of compiler-safety rules (Date.now(), Math.random(), useRef mutations during render body, or `"use no memo"` directives).

```json
// Parameters
{
  "file_path": "/path/to/Component.tsx",
  "component_name": "ProductList"
}
```

---

#### 11. `profile_rsc_stream`

Analyzes raw line-separated React Server Components (RSC) Flight stream payloads. Detects heavy chunks (> 50KB), sequential loading waterfalls, and scans for prototype traversal hazards like **CVE-2025-55182 (React2Shell)** exploits.

```json
// Parameters
{
  "stream_payload": "1:I{\"id\":\"./src/components/List.tsx\",\"name\":\"\"}\n2:J[\"$\",\"div\",null,...]\n"
}
```

---

#### 12. `correlate_chrome_trace`

Aligns React profiler commits with Chrome timeline trace events using `blink.user_timing` ⚛ markers to measure direct layout/paint durations and Core Web Vitals (INP/CLS) impacts.

```json
// Parameters
{
  "profile_path": "/path/to/profile.json",
  "trace_path": "/path/to/chrometrace.json"
}
```

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
- **AST Modification Safeguards**: Employs `ts-morph` block statements replacement to prevent `forgotten node` AST compiler errors during code updates.

No React runtime or DevTools dependency is needed. Just fast, pure JSON parsing and static AST analysis.

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
8. remediate_component        → Automate hoisting and hook memoization rewrites.
```

---

## 🐸 Part of the MCP Toolbelt

Built alongside:

- [tailwind-context-resolver-mcp](https://github.com/vola-trebla/tailwind-context-resolver-mcp) — Resolve Tailwind design tokens and validate utility classes.
- [v8-cpu-profile-decoder-mcp](https://github.com/vola-trebla/v8-cpu-profile-decoder-mcp) — Decode V8 CPU profiles for deep Node.js performance triaging.

---

## License

MIT
