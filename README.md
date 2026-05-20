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
- Which re-renders were **spurious** (props reference changed, no actual keys differed) vs **context-driven** (React.memo can't help)
- Whether a component is being **destroyed and recreated** instead of updated (unstable `key` prop)
- What triggered a specific render cascade — and whether it was a React 18 **transition commit**
- Which components are `React.memo` candidates — and which are too fast for memo to help

---

## 🛠️ Tools

### `get_render_summary`

High-level overview: total commits, total render time, top 5 slowest components, total spurious render count. Each component includes lifecycle counts so the agent can spot key-instability patterns.

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

`lifecycle_anomaly: true` means the component is being destroyed and recreated on every render instead of updating — the classic unstable `key` prop bug. React rebuilds the entire DOM subtree each time.

**Use first** to understand the scale of the problem.

### `find_spurious_renders`

Components that re-rendered unnecessarily, with the root cause classified so the agent knows the correct fix.

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
    },
    {
      "component": "DeferredList",
      "render_count": 8,
      "spurious_count": 6,
      "wasted_ms": 24.1,
      "render_trigger": "UNSTABLE_PARENT_REF",
      "concurrent_yield": true,
      "recommendation": "INTENTIONAL_CONCURRENT_YIELD — all spurious renders happened during startTransition/useDeferredValue commits. This is expected React 18 behavior; do not add React.memo."
    }
  ]
}
```

- `UNSTABLE_PARENT_REF` — fix with `React.memo`
- `CONTEXT_UPDATE` — fix by stabilizing the context value; `React.memo` does nothing here
- `concurrent_yield: true` — React 18 intentionally renders these multiple times during transitions; do not optimize

### `get_hottest_components`

Top N components by self CPU time (excluding children). Includes `transition_render_count` so the agent can see what fraction of renders are React 18 deferred work.

```json
{
  "total_profile_ms": 312.4,
  "components": [
    {
      "component": "ProductList",
      "render_count": 24,
      "transition_render_count": 3,
      "total_self_ms": 89.2,
      "avg_self_ms": 3.72,
      "pct_of_total": 28.55
    }
  ]
}
```

### `trace_render_cascade`

For a specific commit, shows what triggered it and every component that re-rendered as a result, sorted by duration. Now includes `is_concurrent_commit` so the agent knows whether this is a React 18 transition render.

```json
{
  "commit_index": 7,
  "is_concurrent_commit": true,
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

`is_concurrent_commit: true` means this commit was triggered by `startTransition` or `useDeferredValue`. React intentionally re-renders and discards incomplete trees in these lanes — flagging them as regressions would be wrong.

**Use to understand propagation** — why did 40 components re-render from one click?

### `suggest_memoization`

Memoization suggestions with viability scores. Not every component with spurious renders benefits from `React.memo` — for components that render in under 2ms, the `Object.is()` comparison overhead can exceed the render cost.

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
    },
    {
      "component": "DeferredList",
      "render_count": 8,
      "spurious_count": 6,
      "wasted_ms": 24.1,
      "avg_render_ms": 3.01,
      "prop_stability": "UNSTABLE_REFERENCES",
      "recommendation": "INTENTIONAL_CONCURRENT_YIELD",
      "reasoning": "All spurious renders occurred during startTransition/useDeferredValue commits. React 18 intentionally renders these components multiple times while resolving deferred work — do not add React.memo."
    }
  ]
}
```

- `MEMOIZE` — high ROI, wrap with `React.memo`
- `DO_NOT_MEMOIZE` — too fast; memo overhead exceeds render cost; fix the parent reference instead
- `INTENTIONAL_CONCURRENT_YIELD` — React 18 concurrent behavior; do not optimize

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
- **Context render detection** via `changeDescriptions.context === true` — surfaced separately because React.memo cannot prevent these
- **Lifecycle tracking** via `isFirstMount` per commit and `TREE_OPERATION_REMOVE` opcodes in the operations array
- **Concurrent render detection** via `commit.priorityLevel` — `"Low Priority"` and `"Idle"` indicate `startTransition`/`useDeferredValue` lanes
- **Aggregation** across all commits: total self time, render counts, wasted time per component

No React dependency. No DevTools packages. Pure JSON parsing.

---

## 📖 Agent Workflow

```
1. get_render_summary         → understand the scale; spot lifecycle_anomaly (key instability)
2. find_spurious_renders      → classify root cause: UNSTABLE_PARENT_REF vs CONTEXT_UPDATE vs concurrent_yield
3. trace_render_cascade       → understand propagation; check is_concurrent_commit before flagging as regression
4. suggest_memoization        → get verdicts: MEMOIZE / DO_NOT_MEMOIZE / INTENTIONAL_CONCURRENT_YIELD
```

---

## 🐸 Part of the MCP Toolbelt

Built alongside:

- [tailwind-context-resolver-mcp](https://github.com/vola-trebla/tailwind-context-resolver-mcp) — resolve Tailwind design tokens and validate class strings
- [v8-cpu-profile-decoder-mcp](https://github.com/vola-trebla/v8-cpu-profile-decoder-mcp) — V8 CPU profile analysis for Node.js performance

---

## License

MIT
