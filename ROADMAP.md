# react-render-profile-mcp — Implementation Roadmap

## What We're Building

An MCP server that loads a React DevTools Profiler export (`.json`) and exposes actionable
render analysis to AI agents. Agents refactoring React apps are blind to performance impact —
they can't load the DevTools, can't parse the Fiber tree format, and can't hold a large profile
in context. This MCP compresses the raw data into semantic summaries.

---

## The Epistemic Blindness

When an agent modifies state management or restructures components, it has no idea:

- How many components re-rendered after the change
- Which components re-rendered with identical props/state (wasted renders)
- What caused a specific component to re-render (`props`, `state`, `context`, `hooks`)
- Which components are the most expensive by self time
- Whether memoization (`React.memo`, `useMemo`, `useCallback`) would help

The agent guesses. Silent regressions ship.

---

## React DevTools Profiler Format

React DevTools exports a JSON file when you click "Save profile". The format:

```json
{
  "version": 5,
  "dataForRoots": [
    {
      "commitData": [
        {
          "changeDescriptions": {
            "1": {
              "context": false,
              "didHooksChange": false,
              "isFirstMount": false,
              "props": ["onClick"],
              "state": null,
              "hooks": null
            }
          },
          "duration": 12.4,
          "effectDuration": 0.2,
          "fiberActualDurations": [
            [1, 8.1],
            [2, 3.2]
          ],
          "fiberSelfDurations": [
            [1, 2.3],
            [2, 1.1]
          ],
          "passiveEffectDuration": 0.1,
          "priorityLevel": "Normal",
          "timestamp": 1234.5,
          "updaters": [
            { "displayName": "Button", "id": 1, "key": null, "type": 5 }
          ]
        }
      ],
      "displayName": "App",
      "initialTreeBaseDurations": [
        [1, 5.0],
        [2, 2.0]
      ],
      "operations": [],
      "rootID": 1,
      "snapshots": []
    }
  ]
}
```

Key fields:

- `commitData` — one entry per React commit (render cycle)
- `fiberActualDurations` — `[fiberID, ms]` pairs: how long each component took including children
- `fiberSelfDurations` — `[fiberID, ms]` pairs: self time excluding children
- `changeDescriptions` — why each fiber re-rendered: `props`, `state`, `context`, `hooks`
- `updaters` — which component triggered this commit
- `initialTreeBaseDurations` — baseline time if the component hadn't been memoized

The profile also contains a fiber ID → component name map (built from `operations` and `snapshots`).

---

## File Structure

```
src/
  types.ts    — profile format interfaces + result types
  parser.ts   — load profile JSON, build fiberID → name map, aggregate metrics
  analyzer.ts — spurious render detection, cascade tracing, memoization suggestions
  index.ts    — MCP server, 4 tools
```

---

## Types (src/types.ts)

```typescript
// Raw profile shape (subset we care about)
export interface ProfileCommit {
  duration: number;
  fiberActualDurations: [number, number][];
  fiberSelfDurations: [number, number][];
  changeDescriptions: Record<string, ChangeDescription>;
  updaters: Updater[];
  timestamp: number;
  priorityLevel: string;
}

export interface ChangeDescription {
  context: boolean | null;
  didHooksChange: boolean;
  isFirstMount: boolean;
  props: string[] | null; // changed prop names
  state: string[] | null; // changed state keys
  hooks: number[] | null; // changed hook indices
}

// Aggregated per-component metrics
export interface ComponentMetrics {
  name: string;
  fiberID: number;
  renderCount: number;
  totalActualMs: number;
  totalSelfMs: number;
  avgSelfMs: number;
  changeReasons: ChangeReason[];
}

export interface ChangeReason {
  commit: number;
  reason: "props" | "state" | "context" | "hooks" | "first-mount" | "unknown";
  changedKeys?: string[];
}

// Tool result types
export interface SpuriousRendersResult {
  total_commits: number;
  spurious_renders: Array<{
    component: string;
    render_count: number;
    wasted_ms: number;
    reason: string;
  }>;
}

export interface HottestComponentsResult {
  components: Array<{
    component: string;
    render_count: number;
    total_self_ms: number;
    avg_self_ms: number;
    pct_of_total: number;
  }>;
  total_profile_ms: number;
}

export interface RenderCascadeResult {
  trigger: string;
  commit_index: number;
  cascade: Array<{
    component: string;
    self_ms: number;
    reason: string;
  }>;
  total_ms: number;
}

export interface MemoSuggestionsResult {
  suggestions: Array<{
    component: string;
    render_count: number;
    wasted_ms: number;
    suggestion: "React.memo" | "useMemo" | "useCallback";
    reason: string;
  }>;
}
```

---

## Core Logic

### Parser (src/parser.ts)

1. **Load profile JSON** — `fs/promises.readFile` + `JSON.parse`
2. **Build fiberID → name map** from `operations` arrays:
   - Operations are encoded as typed integers. Mount ops contain the display name.
   - Simpler fallback: use `initialTreeBaseDurations` keys + `snapshots` if available.
3. **Aggregate per-component metrics** across all commits:
   - Sum `fiberSelfDurations` per fiberID across all commits → `totalSelfMs`
   - Count renders per fiberID → `renderCount`
   - Collect `changeDescriptions` per fiberID per commit → `changeReasons`

### Analyzer (src/analyzer.ts)

**Spurious renders** — re-renders where `changeDescriptions` shows:

- `props: []` (empty array = props object identity changed but no key actually changed)
- `context: false` and `state: null` and `didHooksChange: false`
- Not `isFirstMount`

These are wasted renders — the component re-rendered but nothing it uses changed.

**Hottest components** — rank by `totalSelfMs` descending, compute `pct_of_total`.

**Render cascade** — for a given commit, return all components that re-rendered sorted by
`fiberActualDurations` descending. Show the updater (triggering component) + cascade.

**Memoization suggestions**:

- `React.memo` → component has high `renderCount` + spurious renders (props didn't change)
- `useMemo` → expensive child computation (`avgSelfMs` > threshold) called from re-rendering parent
- `useCallback` → component passes callbacks to children that re-render spuriously

---

## Tools (src/index.ts)

### `get_render_summary`

```typescript
{
  profile_path: string;
}
```

High-level overview: total commits, total render time, top 5 hottest components, total spurious
render count. Use first to understand the scale of the problem.

### `find_spurious_renders`

```typescript
{ profile_path: string, min_render_count?: number }
```

Components that re-rendered without meaningful changes. Returns component name, render count,
wasted ms, and why it's considered spurious. Most actionable result for the agent.

### `get_hottest_components`

```typescript
{ profile_path: string, top_n?: number }
```

Top N components by self CPU time across all commits. Percentage of total profile time included.

### `trace_render_cascade`

```typescript
{ profile_path: string, commit_index: number }
```

For a specific commit, shows what triggered the render and which components re-rendered as a
result. Helps the agent understand propagation — e.g. a context update re-rendering 40 children.

### `suggest_memoization`

```typescript
{ profile_path: string, min_wasted_ms?: number }
```

Concrete memoization suggestions: which components need `React.memo`, `useMemo`, or `useCallback`,
and why. Returns only suggestions above the wasted ms threshold.

---

## Key Decisions

1. **No React dependency** — parse the JSON export directly. React DevTools format is stable
   enough across v4/v5 profile versions.

2. **fiberID → name resolution** — the `operations` format is a compact binary-like integer array.
   Rather than implementing the full decoder, use `snapshots` (human-readable component tree
   snapshot) as the primary name source. Fall back to `fiberID` if name unavailable.

3. **Spurious render definition** — `props` array is empty (`[]`) in `changeDescriptions`.
   React records which prop keys changed; empty array = reference changed but no keys differed
   (classic unstable reference / inline object/function).

4. **5 tools** — one extra vs the standard 4. `get_render_summary` is the "start here" tool;
   the rest drill down. Agent workflow: summary → spurious → cascade → memoization.

---

## Dependencies

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "zod": "^4.4.3"
  }
}
```

No React, no DevTools packages needed — pure JSON parsing.
