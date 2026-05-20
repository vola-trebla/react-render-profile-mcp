# review.md — react-render-profile-mcp

## Overall Assessment

**Ready for version bump to 0.2.0.** All 4 v2 roadmap features shipped and verified. One issue found and fixed during validation. README needs updating to document new output fields from all 4 issues before release.

---

## Verification Run

```
npm run build   ✅ clean
npm test        ✅ 24 tests, 0 failures
npm run lint    ✅ clean
npm run format:check ✅ clean
npm pack --dry-run   ✅ 11 files, 10.8kB packed
```

Stdio JSON-RPC smoke test — all 5 tools:

- `get_render_summary` ✅ returns new lifecycle fields (mount_count, unmount_count, update_count, lifecycle_anomaly)
- `find_spurious_renders` ✅ returns render_trigger, concurrent_yield, recommendation per entry
- `get_hottest_components` ✅ returns transition_render_count per component
- `trace_render_cascade` ✅ returns is_concurrent_commit boolean
- `suggest_memoization` ✅ returns avg_render_ms, prop_stability, recommendation (MEMOIZE/DO_NOT_MEMOIZE/INTENTIONAL_CONCURRENT_YIELD), reasoning

Edge cases:

- Missing profile path → `isError: true`, clean message ✅
- Out-of-range commit_index → `isError: true`, message includes valid range ✅

---

## Issues Found

### 1. `serverInfo.version` out of sync — FIXED

**File:** `src/index.ts:16`  
`version: "0.1.0"` while `package.json` was `"0.1.1"`. Fixed in commit `8b2f927` on main. Will be updated again to `"0.2.0"` during version bump.

### 2. README doesn't document v2 output fields — OPEN

**File:** `README.md`  
None of the 4 new feature sets appear in the README:

- Issue #1: `mount_count`, `unmount_count`, `update_count`, `lifecycle_anomaly` in `get_render_summary`
- Issue #2: `avg_render_ms`, `prop_stability`, `recommendation` (MEMOIZE/DO_NOT_MEMOIZE), `reasoning` in `suggest_memoization`
- Issue #3: `render_trigger` (UNSTABLE_PARENT_REF/CONTEXT_UPDATE), `concurrent_yield`, `recommendation` in `find_spurious_renders`
- Issue #4: `concurrent_yield`, `transition_render_count`, `is_concurrent_commit`, `INTENTIONAL_CONCURRENT_YIELD` across all tools

The README shows old example output. Agent consuming the tool would not know about the new fields.  
**Fix:** Update all tool example JSON blocks in README before 0.2.0 release.

### 3. `test` script missing `--passWithNoTests` — MINOR

**File:** `package.json`  
`"test": "vitest run"` should be `"vitest run --passWithNoTests"` per project rule. Harmless now (tests exist) but will break CI if tests are ever removed from the file.

---

## What Shipped (v2 roadmap, all 4 issues)

| PR  | Issue | Description                                                                        |
| --- | ----- | ---------------------------------------------------------------------------------- |
| #5  | #1    | mount/unmount lifecycle counts in `get_render_summary`                             |
| #6  | #2    | Viability score in `suggest_memoization` (MEMOIZE / DO_NOT_MEMOIZE)                |
| #7  | #3    | `render_trigger` in `find_spurious_renders` (UNSTABLE_PARENT_REF / CONTEXT_UPDATE) |
| #8  | #4    | React 18 concurrent features across all 4 tools                                    |

---

## Realistic Fixture Validation

`sample-playwright-project` is not the target for this server — it has no React. Use the fixture at `test/fixtures/realistic.profile.json` instead.

The fixture covers every v2 analysis pattern:

| Component         | Pattern                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| `ProductGrid`     | `MEMOIZE` — avg >2ms, mixed normal+transition spurious (not all transitions → not INTENTIONAL) |
| `FilterPanel`     | `DO_NOT_MEMOIZE` — avg 0.45ms, memo overhead > render cost                                     |
| `DeferredResults` | `INTENTIONAL_CONCURRENT_YIELD` — all spurious in Low Priority commits                          |
| `Sidebar`         | `MEMOIZE` — 1 normal + 1 transition spurious                                                   |
| `UserAvatar`      | `CONTEXT_UPDATE` — context consumer, React.memo cannot help                                    |
| `ListItem`        | `lifecycle_anomaly: true` — always `isFirstMount` (unstable key)                               |
| commits 4–5       | `is_concurrent_commit: true` — `priorityLevel: "Low Priority"`                                 |

```bash
cat > /tmp/react-mcp-realistic.ndjson << 'NDJSON'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_render_summary","arguments":{"profile_path":"/Users/albertdev/Projects/ideas/react-render-profile-mcp/test/fixtures/realistic.profile.json"}}}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"find_spurious_renders","arguments":{"profile_path":"/Users/albertdev/Projects/ideas/react-render-profile-mcp/test/fixtures/realistic.profile.json"}}}
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"get_hottest_components","arguments":{"profile_path":"/Users/albertdev/Projects/ideas/react-render-profile-mcp/test/fixtures/realistic.profile.json","top_n":10}}}
{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"trace_render_cascade","arguments":{"profile_path":"/Users/albertdev/Projects/ideas/react-render-profile-mcp/test/fixtures/realistic.profile.json","commit_index":4}}}
{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"suggest_memoization","arguments":{"profile_path":"/Users/albertdev/Projects/ideas/react-render-profile-mcp/test/fixtures/realistic.profile.json"}}}
NDJSON
node dist/index.js < /tmp/react-mcp-realistic.ndjson 2>/dev/null
```

Verified output (all confirmed ✅):

- `get_render_summary`: `ListItem` `lifecycle_anomaly: true`, `mount_count == render_count`
- `find_spurious_renders`: `UserAvatar` → `CONTEXT_UPDATE`; `DeferredResults` → `concurrent_yield: true`; `ProductGrid` → `concurrent_yield: false`
- `get_hottest_components`: `DeferredResults` `transition_render_count: 2`
- `trace_render_cascade` commit 4: `is_concurrent_commit: true`
- `suggest_memoization`: `ProductGrid` → `MEMOIZE`; `FilterPanel` → `DO_NOT_MEMOIZE`; `DeferredResults` → `INTENTIONAL_CONCURRENT_YIELD`; `Sidebar` → `MEMOIZE`

---

## Before 0.2.0 Release

1. Update README with v2 output examples (all 4 sections)
2. Fix `"test"` script → `"vitest run --passWithNoTests"`
3. Sync version across: `package.json` → `0.2.0`, `src/index.ts` serverInfo → `0.2.0`, `server.json` (both fields) → `0.2.0`
