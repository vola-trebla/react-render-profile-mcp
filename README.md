# react-render-profile-mcp 🐸⚡

[![npm version](https://img.shields.io/npm/v/react-render-profile-mcp.svg)](https://www.npmjs.com/package/react-render-profile-mcp)
[![npm downloads](https://img.shields.io/npm/dm/react-render-profile-mcp.svg)](https://www.npmjs.com/package/react-render-profile-mcp)
[![CI](https://github.com/vola-trebla/react-render-profile-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/vola-trebla/react-render-profile-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An MCP server that decodes React DevTools Profiler exports into **actionable render summaries** for AI agents.

Your agent just refactored a context provider. Now 80 components re-render on every keystroke. It has no idea.

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

## ✅ The Fix

This MCP server loads the profiler export and gives agents exactly what they need:

- Which components re-rendered the most — and how much CPU time they consumed
- Which re-renders were **spurious** (props reference changed, no actual keys differed)
- What triggered a specific render cascade
- Which components are `React.memo` candidates

---

## 🛠️ Tools

### `get_render_summary`

High-level overview: total commits, total render time, top 5 slowest components, total spurious render count.

```json
{
  "total_commits": 24,
  "total_render_ms": 312.4,
  "total_spurious_renders": 18,
  "top_components": [
    {
      "component": "ProductList",
      "render_count": 24,
      "total_self_ms": 89.2,
      "pct_of_total": 28.55
    },
    {
      "component": "SearchInput",
      "render_count": 24,
      "total_self_ms": 61.1,
      "pct_of_total": 19.56
    }
  ]
}
```

**Use first** to understand the scale of the problem.

### `find_spurious_renders`

Components that re-rendered without any prop, state, context, or hook changes. These are the classic **unstable reference** bugs — inline objects, arrow functions, or arrays created on every parent render.

```json
{
  "spurious_renders": [
    {
      "component": "ProductList",
      "render_count": 24,
      "spurious_count": 23,
      "wasted_ms": 84.3,
      "reason": "props reference changed but no prop keys differed — unstable object/function/array from parent"
    }
  ]
}
```

**Use to find `React.memo` targets** with the highest ROI.

### `get_hottest_components`

Top N components by self CPU time (excluding children). Includes average per render and percentage of total profile time.

### `trace_render_cascade`

For a specific commit, shows what triggered it and every component that re-rendered as a result, sorted by duration.

```json
{
  "trigger": "SearchInput",
  "total_commit_ms": 28.4,
  "cascade": [
    {
      "component": "ProductList",
      "self_ms": 18.2,
      "actual_ms": 18.2,
      "reason": "parent re-rendered (unstable props reference)"
    },
    {
      "component": "SearchInput",
      "self_ms": 9.1,
      "actual_ms": 9.1,
      "reason": "hook changed"
    }
  ]
}
```

**Use to understand propagation** — why did 40 components re-render from one click?

### `suggest_memoization`

Concrete `React.memo` suggestions ranked by wasted milliseconds, with the reason explained.

---

## 🚀 Setup

### Claude Desktop

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

### Cursor / VS Code / Any MCP client

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

1. Open React DevTools in Chrome DevTools
2. Go to the **Profiler** tab
3. Click **Record**, interact with your app, click **Stop**
4. Click the **Save** icon (💾) to export the `.json` file
5. Pass the absolute path to any tool as `profile_path`

---

## 🔧 How It Works

The parser decodes the React DevTools Profiler export format (version 5):

- **fiberID → component name** from `snapshots` (primary) or the encoded `operations` integer array (fallback)
- **Spurious render detection** via `changeDescriptions.props === []` — React records an empty array when the props object reference changed but no individual prop keys differed
- **Aggregation** across all commits: total self time, render counts, wasted time per component

No React dependency. No DevTools packages. Pure JSON parsing.

---

## 📖 Agent Workflow

```
1. get_render_summary         → understand the scale of the problem
2. find_spurious_renders      → find wasted render targets
3. trace_render_cascade       → understand why a specific commit re-rendered so much
4. suggest_memoization        → get concrete React.memo candidates
```

---

## 🐸 Part of the MCP Toolbelt

Built alongside:

- [tailwind-context-resolver-mcp](https://github.com/vola-trebla/tailwind-context-resolver-mcp) — resolve Tailwind design tokens and validate class strings
- [v8-cpu-profile-decoder-mcp](https://github.com/vola-trebla/v8-cpu-profile-decoder-mcp) — V8 CPU profile analysis for Node.js performance

---

## License

MIT
