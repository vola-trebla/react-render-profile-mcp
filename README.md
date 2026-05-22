# react-render-profile-mcp 🐸⚡

[![npm version](https://img.shields.io/npm/v/react-render-profile-mcp.svg)](https://www.npmjs.com/package/react-render-profile-mcp)
[![npm downloads](https://img.shields.io/npm/dm/react-render-profile-mcp.svg)](https://www.npmjs.com/package/react-render-profile-mcp)
[![CI](https://github.com/vola-trebla/react-render-profile-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/vola-trebla/react-render-profile-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An **Autonomous Performance SRE & Auto-Remediation Engine** for React, exposed as a Model Context Protocol (MCP) server. Built specifically to bridge the performance perception gap for AI coding agents (Claude, Cursor, Copilot).

---

## 👁️ The Blind Spot: Why AI Agents Break React Production

When an AI agent refactors a Context Provider, changes state architecture, or hooks up a global store, it is **completely blind** to the runtime performance impact.

An agent can successfully pass unit tests and compile code while introducing catastrophic performance regressions:

- A single state update cascading into **80 unnecessary child re-renders**.
- Infinite rendering loops triggered by **unstable Zustand/Redux selector references**.
- **Hydration mismatches** forcing React to throw away server-rendered HTML and mount from scratch.
- **Unstable `key` props** causing components to unmount and mount on every render cycle (lifecycle anomalies).

**`react-render-profile-mcp` gives AI agents a "third eye" to dynamically measure, visualize, and auto-remediate these performance bottlenecks.**

---

## ⚡ The Four Pillars of AI-SRE

Instead of raw JSON dumps, this server organizes performance data into structured, actionable insights across four core engineering pillars:

### 🧠 1. AST Auto-Remediation Engine (`ts-morph`)

ア When a bottleneck is found, the agent doesn't need to manually rewrite code. The server can mutate component source code on disk:

- **Hoisting**: Statically hoisting object and array literals out of render bodies.
- **Dynamic Memoization**: Wrapping unstable functions and variables in `useCallback` and `useMemo` with computed dependency arrays.
- **ROI Wrapping**: Wrapping components in `React.memo` only if the profiled self-time and spurious render count justify the comparison overhead (ROI > 1.5).
- **Rule Auditing**: Scanning code to prevent compiler bailouts (detecting `Date.now()`, `Math.random()`, or render-phase `useRef` mutations).

### 📊 2. Interactive SVG Cascade Visualizer (MCP Resource)

Generates parent-child rendering graphs directly into the agent's chat window using the custom resource URI scheme `react-profile://commits/{commitId}/cascade?profile_path={profile_path}`.

- Triggers are styled with distinct HSL palettes to isolate propagation channels:
  - 🔵 **Context Trigger**: Blue (ocean wave)
  - 🟠 **Zustand/Redux Store**: Orange (subscriber ripple)
  - 🔴 **Props Invalidation**: Red (reference mismatch)
  - 🟢 **State Change**: Green (emerald trigger source)

### 🛡️ 3. RSC Flight Stream & Security Profiler

Analyzes React Server Components (RSC) Flight streams to optimize delivery:

- Identifies bloated chunks (> 50KB) and sequential waterfalls.
- Scans payloads for prototype traversal vulnerabilities like **CVE-2025-55182 (React2Shell)** exploits.

### ⚛️ 4. Multi-Layer Trace Correlator

Aligns React commits with Chrome Performance timeline events using `blink.user_timing` markers.

- Measures post-commit layout, paint, and style calculation tasks to calculate real Core Web Vitals impacts (CLS / INP estimates).

---

## 🛠️ MCP Tools Reference

Below is a compact summary of the tools exposed by this server. All tools accept a required `profile_path` pointing to a React DevTools export `.json`.

| Tool Name                                 | Parameters                                                   | Purpose / Output                                                                                                              |
| :---------------------------------------- | :----------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------- |
| **`get_render_summary`**                  | `profile_path`                                               | Overview of commits, total render time, spurious renders count, and lifecycle anomalies.                                      |
| **`find_spurious_renders`**               | `profile_path`, `min_render_count`?                          | Lists components that rendered with identical props/state. Classifies trigger into `UNSTABLE_PARENT_REF` or `CONTEXT_UPDATE`. |
| **`analyze_compiler_efficacy`**           | `profile_path`, `invalid_threshold`?                         | Computes Invalidation Index to identify where React Compiler or `React.memo` is bypassed.                                     |
| **`diagnose_hydration_and_suspense`**     | `profile_path`, `waterfall_threshold_ms`?                    | Detects server-client hydration mismatches and nested Suspense fetch waterfalls.                                              |
| **`evaluate_external_store_performance`** | `profile_path`, `max_blocking_task_ms`?                      | Finds unstable useSyncExternalStore selectors and high-priority blocking sync tasks.                                          |
| **`trace_state_cascade_footprint`**       | `profile_path`, `commit_index`                               | Traces virtual owner tree to measure propagation depth and consumer count of updates.                                         |
| **`suggest_memoization`**                 | `profile_path`, `min_wasted_ms`?                             | Provides high-ROI `React.memo` suggestions based on average self-time (> 2ms threshold).                                      |
| **`remediate_component`**                 | `file_path`, `component_name`, `unstable_props`, `roi_score` | Modifies AST on disk to hoist variables, wrap hooks, and apply memoization.                                                   |
| **`audit_compiler_rules`**                | `file_path`, `component_name`                                | Statically audits component source code for React Compiler rule violations.                                                   |
| **`profile_rsc_stream`**                  | `stream_payload`                                             | Parses RSC Flight logs to audit chunk sizes, waterfalls, and `React2Shell` exploits.                                          |
| **`correlate_chrome_trace`**              | `profile_path`, `trace_path`                                 | Aligns React commits with Chrome trace events to calculate CLS/INP web vitals impacts.                                        |

---

## 🤖 Prompt Injection: Teach Your Agent to Profile

To get the most out of this server, add the following prompt to your agent's system instructions (e.g., in `.cursorrules`, Cursor System Prompt, or Claude Custom Instructions):

```markdown
You are equipped with `react-render-profile-mcp`. Use it systematically whenever:

1. You make structural changes to React components, global state providers, or store selectors.
2. The user reports lag, slow input response, or UI stuttering.
3. You refactor context providers, Zustand selectors, or Redux dispatches.

Debugging Workflow:

- Ask the user to record and export a React DevTools profile (.json).
- Run `get_render_summary` to understand the scale of the problem and look for `lifecycle_anomaly: true` (unstable keys).
- Run `find_spurious_renders` and `analyze_compiler_efficacy` to pinpoint unstable prop references.
- Call the `react-profile://commits/{commitId}/cascade` resource to visualize cascades.
- Use `remediate_component` to automatically apply AST optimizations (hoisting static variables, wrapping hooks) instead of doing it manually.
```

---

## 📋 How to Export a Profile

1. Open **React DevTools** in your browser.
2. Navigate to the **Profiler** tab.
3. Click the **Record** button (circle), interact with your application to trigger the performance issue, and click **Stop**.
4. Click the **Save Profile** icon (💾) to download the `.json` file.
5. Provide the absolute path to this file to the MCP server.

---

## ⚙️ Setup & Installation

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

### Cursor / VS Code / Other Clients

Add an MCP server of type `command`:

- **Command**: `npx -y react-render-profile-mcp`

---

## 🔧 Under the Hood

- **ESM-Native**: Built with TypeScript ESM, optimized for fast Node.js imports.
- **React DevTools v5 Protocol**: Natively decodes serialized operations arrays, resolving fiber snapshots and name maps.
- **Lane Identification**: Distinguishes between high-priority lane updates and concurrent transition commits (Low Priority/Idle) to prevent false-positive regression flags.
- **AST Modification Safety**: Implements `ts-morph` statement manipulation blocks, avoiding common parser state corruption during multi-pass rewrites.

---

## 🐸 Part of the MCP Toolbelt

Developed alongside:

- [tailwind-context-resolver-mcp](https://github.com/vola-trebla/tailwind-context-resolver-mcp) — Resolve Tailwind design tokens and validate utility classes.
- [v8-cpu-profile-decoder-mcp](https://github.com/vola-trebla/v8-cpu-profile-decoder-mcp) — Decode V8 CPU profiles for Node.js backend performance tuning.

---

## License

MIT
