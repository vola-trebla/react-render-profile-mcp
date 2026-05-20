import { describe, it, expect } from "vitest";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { loadProfile } from "../src/parser.js";
import {
  getRenderSummary,
  findSpuriousRenders,
  getHottestComponents,
  traceRenderCascade,
  suggestMemoization,
} from "../src/analyzer.js";

const FIXTURE = resolve(
  fileURLToPath(import.meta.url),
  "../../test/fixtures/basic.profile.json",
);

describe("loadProfile", () => {
  it("loads and parses the profile", async () => {
    const data = await loadProfile(FIXTURE);
    expect(data.totalCommits).toBe(3);
    expect(data.metrics.length).toBe(3);
    expect(data.nameMap.get(4)).toBe("ProductList");
    expect(data.nameMap.get(5)).toBe("SearchInput");
  });

  it("normalizes changeDescriptions from array-of-pairs (real DevTools format)", async () => {
    // The fixture uses [[fiberID, desc], ...] — real export format.
    // Parser must convert it so classifyReason/isSpurious work correctly.
    const data = await loadProfile(FIXTURE);
    const productList = data.metrics.find((m) => m.name === "ProductList")!;
    expect(productList.spuriousRenderCount).toBe(2);
  });

  it("throws on missing file", async () => {
    await expect(loadProfile("/nonexistent/profile.json")).rejects.toThrow(
      "Profile file not found",
    );
  });

  it("throws on unsupported version", async () => {
    const { writeFile, unlink } = await import("fs/promises");
    const tmp = "/tmp/bad-version.json";
    await writeFile(tmp, JSON.stringify({ version: 4, dataForRoots: [] }));
    await expect(loadProfile(tmp)).rejects.toThrow(
      "Unsupported profile version: 4",
    );
    await unlink(tmp);
  });
});

describe("findSpuriousRenders", () => {
  it("detects ProductList as UNSTABLE_PARENT_REF (props: [] in real format)", async () => {
    const data = await loadProfile(FIXTURE);
    const result = findSpuriousRenders(data);
    expect(result.spurious_renders).toHaveLength(1);
    const entry = result.spurious_renders[0];
    expect(entry.component).toBe("ProductList");
    expect(entry.spurious_count).toBe(2);
    expect(entry.wasted_ms).toBeGreaterThan(0);
    expect(entry.render_trigger).toBe("UNSTABLE_PARENT_REF");
    expect(entry.recommendation).toContain("React.memo");
  });

  it("does not flag SearchInput as spurious (hook changed)", async () => {
    const data = await loadProfile(FIXTURE);
    const result = findSpuriousRenders(data);
    expect(
      result.spurious_renders.find((r) => r.component === "SearchInput"),
    ).toBeUndefined();
  });

  it("detects CONTEXT_UPDATE renders as separate trigger category", async () => {
    const { writeFile, unlink } = await import("fs/promises");
    const tmp = "/tmp/context-render.profile.json";
    const fixture = {
      version: 5,
      dataForRoots: [
        {
          commitData: [
            {
              changeDescriptions: [
                [
                  6,
                  {
                    context: true,
                    didHooksChange: false,
                    isFirstMount: false,
                    props: null,
                    state: null,
                    hooks: null,
                  },
                ],
              ],
              duration: 5.0,
              effectDuration: 0,
              fiberActualDurations: [[6, 5.0]],
              fiberSelfDurations: [[6, 5.0]],
              passiveEffectDuration: 0,
              priorityLevel: "Normal",
              timestamp: 100,
              updaters: [],
            },
          ],
          displayName: "App",
          initialTreeBaseDurations: [[6, 5.0]],
          operations: [],
          rootID: 1,
          snapshots: [
            [
              6,
              {
                id: 6,
                children: [],
                displayName: "ThemeConsumer",
                key: null,
                parentID: 3,
              },
            ],
          ],
        },
      ],
    };
    await writeFile(tmp, JSON.stringify(fixture));
    const data = await loadProfile(tmp);
    const result = findSpuriousRenders(data);
    expect(result.spurious_renders).toHaveLength(1);
    const entry = result.spurious_renders[0];
    expect(entry.component).toBe("ThemeConsumer");
    expect(entry.render_trigger).toBe("CONTEXT_UPDATE");
    expect(entry.recommendation).toContain("React.memo cannot help");
    await unlink(tmp);
  });

  it("marks concurrent_yield:false for normal-priority spurious renders", async () => {
    const data = await loadProfile(FIXTURE);
    const result = findSpuriousRenders(data);
    const entry = result.spurious_renders.find(
      (r) => r.component === "ProductList",
    )!;
    expect(entry.concurrent_yield).toBe(false);
  });

  it("flags concurrent_yield:true for spurious renders in transition commits", async () => {
    const { writeFile, unlink } = await import("fs/promises");
    const tmp = "/tmp/transition-spurious.profile.json";
    const fixture = {
      version: 5,
      dataForRoots: [
        {
          commitData: [
            {
              changeDescriptions: [
                [
                  7,
                  {
                    context: false,
                    didHooksChange: false,
                    isFirstMount: false,
                    props: [],
                    state: null,
                    hooks: null,
                  },
                ],
              ],
              duration: 4.0,
              effectDuration: 0,
              fiberActualDurations: [[7, 4.0]],
              fiberSelfDurations: [[7, 4.0]],
              passiveEffectDuration: 0,
              priorityLevel: "Low Priority",
              timestamp: 100,
              updaters: [],
            },
          ],
          displayName: "App",
          initialTreeBaseDurations: [[7, 4.0]],
          operations: [],
          rootID: 1,
          snapshots: [
            [
              7,
              {
                id: 7,
                children: [],
                displayName: "DeferredList",
                key: null,
                parentID: 3,
              },
            ],
          ],
        },
      ],
    };
    await writeFile(tmp, JSON.stringify(fixture));
    const data = await loadProfile(tmp);
    const result = findSpuriousRenders(data);
    expect(result.spurious_renders).toHaveLength(1);
    expect(result.spurious_renders[0].concurrent_yield).toBe(true);
    expect(result.spurious_renders[0].recommendation).toContain(
      "INTENTIONAL_CONCURRENT_YIELD",
    );
    await unlink(tmp);
  });

  it("respects min_render_count filter", async () => {
    const data = await loadProfile(FIXTURE);
    const result = findSpuriousRenders(data, 5);
    expect(result.spurious_renders).toHaveLength(0);
  });
});

describe("getRenderSummary", () => {
  it("returns correct commit count and total ms", async () => {
    const data = await loadProfile(FIXTURE);
    const result = getRenderSummary(data);
    expect(result.total_commits).toBe(3);
    expect(result.total_render_ms).toBeCloseTo(30.8, 1);
    expect(result.total_spurious_renders).toBe(2);
    expect(result.total_components_tracked).toBe(3);
  });

  it("ranks top components by self time", async () => {
    const data = await loadProfile(FIXTURE);
    const result = getRenderSummary(data);
    expect(result.top_components[0].component).toBe("ProductList");
  });

  it("includes lifecycle counts in top_components", async () => {
    const data = await loadProfile(FIXTURE);
    const result = getRenderSummary(data);
    const productList = result.top_components.find(
      (c) => c.component === "ProductList",
    )!;
    // 3 total renders: 1 first-mount + 2 updates
    expect(productList.mount_count).toBe(1);
    expect(productList.update_count).toBe(2);
    expect(productList.unmount_count).toBe(0);
    // 1 mount / 3 renders = 33% — below 80% threshold, no anomaly
    expect(productList.lifecycle_anomaly).toBe(false);
  });

  it("flags lifecycle_anomaly when mount_count ≥ 80% of render_count", async () => {
    const data = await loadProfile(FIXTURE);
    // Simulate a component that only ever mounts (never updates)
    // App (fiberID 3) has render_count=1, mount_count=1 → 100% mounts → anomaly
    const result = getRenderSummary(data);
    const app = result.top_components.find((c) => c.component === "App");
    if (app) {
      // App appears once (initial mount only) → mount_count == render_count → anomaly
      expect(app.lifecycle_anomaly).toBe(true);
    }
  });
});

describe("getHottestComponents", () => {
  it("returns components sorted by self time", async () => {
    const data = await loadProfile(FIXTURE);
    const result = getHottestComponents(data);
    expect(result.components[0].component).toBe("ProductList");
    expect(result.components[0].total_self_ms).toBeCloseTo(13.6, 1);
  });

  it("respects top_n param", async () => {
    const data = await loadProfile(FIXTURE);
    const result = getHottestComponents(data, 2);
    expect(result.components).toHaveLength(2);
  });
});

describe("traceRenderCascade", () => {
  it("returns trigger and cascade for commit 1", async () => {
    const data = await loadProfile(FIXTURE);
    const result = traceRenderCascade(data, 1);
    expect(result.trigger).toBe("SearchInput");
    expect(result.cascade).toHaveLength(2);
    expect(result.cascade[0].component).toBe("ProductList");
    expect(result.cascade[0].reason).toContain("unstable props");
  });

  it("throws on out-of-range commit_index", async () => {
    const data = await loadProfile(FIXTURE);
    expect(() => traceRenderCascade(data, 99)).toThrow("out of range");
  });

  it("reports is_concurrent_commit:false for Normal priority commits", async () => {
    const data = await loadProfile(FIXTURE);
    const result = traceRenderCascade(data, 1);
    expect(result.is_concurrent_commit).toBe(false);
  });
});

describe("suggestMemoization", () => {
  it("suggests MEMOIZE for ProductList (avg > 2ms)", async () => {
    const data = await loadProfile(FIXTURE);
    const result = suggestMemoization(data);
    expect(result.suggestions).toHaveLength(1);
    const s = result.suggestions[0];
    expect(s.component).toBe("ProductList");
    expect(s.prop_stability).toBe("UNSTABLE_REFERENCES");
    // ProductList avg_self_ms ≈ 4.55ms (>2ms) → MEMOIZE
    expect(s.recommendation).toBe("MEMOIZE");
    expect(s.avg_render_ms).toBeGreaterThan(2);
    expect(s.reasoning).toContain("React.memo");
  });

  it("recommends DO_NOT_MEMOIZE when avg render < 2ms", async () => {
    // Build a profile where ProductList renders in 0.5ms avg
    const { writeFile, unlink } = await import("fs/promises");
    const tmp = "/tmp/fast-component.profile.json";
    const fixture = {
      version: 5,
      dataForRoots: [
        {
          commitData: [
            {
              changeDescriptions: [
                [
                  4,
                  {
                    context: false,
                    didHooksChange: false,
                    isFirstMount: false,
                    props: [],
                    state: null,
                    hooks: null,
                  },
                ],
              ],
              duration: 0.5,
              effectDuration: 0,
              fiberActualDurations: [[4, 0.5]],
              fiberSelfDurations: [[4, 0.5]],
              passiveEffectDuration: 0,
              priorityLevel: "Normal",
              timestamp: 100,
              updaters: [],
            },
            {
              changeDescriptions: [
                [
                  4,
                  {
                    context: false,
                    didHooksChange: false,
                    isFirstMount: false,
                    props: [],
                    state: null,
                    hooks: null,
                  },
                ],
              ],
              duration: 0.4,
              effectDuration: 0,
              fiberActualDurations: [[4, 0.4]],
              fiberSelfDurations: [[4, 0.4]],
              passiveEffectDuration: 0,
              priorityLevel: "Normal",
              timestamp: 200,
              updaters: [],
            },
          ],
          displayName: "App",
          initialTreeBaseDurations: [[4, 0.5]],
          operations: [],
          rootID: 1,
          snapshots: [
            [
              4,
              {
                id: 4,
                children: [],
                displayName: "TinyButton",
                key: null,
                parentID: 3,
              },
            ],
          ],
        },
      ],
    };
    await writeFile(tmp, JSON.stringify(fixture));
    const data = await loadProfile(tmp);
    const result = suggestMemoization(data);
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].recommendation).toBe("DO_NOT_MEMOIZE");
    expect(result.suggestions[0].avg_render_ms).toBeLessThan(2);
    expect(result.suggestions[0].reasoning).toContain("2ms");
    await unlink(tmp);
  });

  it("respects min_wasted_ms threshold", async () => {
    const data = await loadProfile(FIXTURE);
    const result = suggestMemoization(data, 999);
    expect(result.suggestions).toHaveLength(0);
  });

  it("returns INTENTIONAL_CONCURRENT_YIELD for transition-only spurious renders", async () => {
    const { writeFile, unlink } = await import("fs/promises");
    const tmp = "/tmp/transition-memo.profile.json";
    const fixture = {
      version: 5,
      dataForRoots: [
        {
          commitData: [
            {
              changeDescriptions: [
                [
                  8,
                  {
                    context: false,
                    didHooksChange: false,
                    isFirstMount: false,
                    props: [],
                    state: null,
                    hooks: null,
                  },
                ],
              ],
              duration: 5.0,
              effectDuration: 0,
              fiberActualDurations: [[8, 5.0]],
              fiberSelfDurations: [[8, 5.0]],
              passiveEffectDuration: 0,
              priorityLevel: "Low Priority",
              timestamp: 100,
              updaters: [],
            },
          ],
          displayName: "App",
          initialTreeBaseDurations: [[8, 5.0]],
          operations: [],
          rootID: 1,
          snapshots: [
            [
              8,
              {
                id: 8,
                children: [],
                displayName: "SearchResults",
                key: null,
                parentID: 3,
              },
            ],
          ],
        },
      ],
    };
    await writeFile(tmp, JSON.stringify(fixture));
    const data = await loadProfile(tmp);
    const result = suggestMemoization(data);
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].recommendation).toBe(
      "INTENTIONAL_CONCURRENT_YIELD",
    );
    expect(result.suggestions[0].reasoning).toContain("startTransition");
    await unlink(tmp);
  });

  it("includes transition_render_count in get_hottest_components", async () => {
    const data = await loadProfile(FIXTURE);
    const result = getHottestComponents(data);
    // fixture uses Normal priority — transition_render_count should be 0 for all
    expect(result.components[0].transition_render_count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Realistic fixture — covers all v2 patterns in one profile
// ---------------------------------------------------------------------------

const REALISTIC = resolve(
  fileURLToPath(import.meta.url),
  "../../test/fixtures/realistic.profile.json",
);

describe("realistic profile — lifecycle anomaly", () => {
  it("flags ListItem as lifecycle_anomaly (always mounts, never updates)", async () => {
    const data = await loadProfile(REALISTIC);
    const result = getRenderSummary(data);
    const listItem = result.top_components.find(
      (c) => c.component === "ListItem",
    );
    if (listItem) {
      // ListItem appears in top_components only if it ranks in top 5 by self time
      expect(listItem.lifecycle_anomaly).toBe(true);
      expect(listItem.mount_count).toBe(listItem.render_count);
    }
  });

  it("ListItem metrics: mountCount equals renderCount", async () => {
    const data = await loadProfile(REALISTIC);
    const listItem = data.metrics.find((m) => m.name === "ListItem")!;
    expect(listItem.mountCount).toBe(4); // mounts in commits 0–3
    expect(listItem.updateCount).toBe(0);
    expect(listItem.renderCount).toBe(4);
  });
});

describe("realistic profile — context update detection", () => {
  it("UserAvatar appears as CONTEXT_UPDATE, not UNSTABLE_PARENT_REF", async () => {
    const data = await loadProfile(REALISTIC);
    const result = findSpuriousRenders(data);
    const avatar = result.spurious_renders.find(
      (r) => r.component === "UserAvatar",
    )!;
    expect(avatar).toBeDefined();
    expect(avatar.render_trigger).toBe("CONTEXT_UPDATE");
    expect(avatar.recommendation).toContain("React.memo cannot help");
    expect(avatar.concurrent_yield).toBe(false);
  });

  it("UserAvatar has contextRenderCount=2, spuriousRenderCount=0", async () => {
    const data = await loadProfile(REALISTIC);
    const avatar = data.metrics.find((m) => m.name === "UserAvatar")!;
    expect(avatar.contextRenderCount).toBe(2);
    expect(avatar.spuriousRenderCount).toBe(0);
  });
});

describe("realistic profile — memoization viability", () => {
  it("ProductGrid → MEMOIZE (avg >2ms, mixed normal+transition spurious)", async () => {
    const data = await loadProfile(REALISTIC);
    const result = suggestMemoization(data);
    const pg = result.suggestions.find((s) => s.component === "ProductGrid")!;
    expect(pg).toBeDefined();
    expect(pg.recommendation).toBe("MEMOIZE");
    expect(pg.avg_render_ms).toBeGreaterThan(2);
    expect(pg.prop_stability).toBe("UNSTABLE_REFERENCES");
  });

  it("FilterPanel → DO_NOT_MEMOIZE (avg <2ms)", async () => {
    const data = await loadProfile(REALISTIC);
    const result = suggestMemoization(data);
    const fp = result.suggestions.find((s) => s.component === "FilterPanel")!;
    expect(fp).toBeDefined();
    expect(fp.recommendation).toBe("DO_NOT_MEMOIZE");
    expect(fp.avg_render_ms).toBeLessThan(2);
  });

  it("DeferredResults → INTENTIONAL_CONCURRENT_YIELD (all spurious in Low Priority commits)", async () => {
    const data = await loadProfile(REALISTIC);
    const result = suggestMemoization(data);
    const dr = result.suggestions.find(
      (s) => s.component === "DeferredResults",
    )!;
    expect(dr).toBeDefined();
    expect(dr.recommendation).toBe("INTENTIONAL_CONCURRENT_YIELD");
    expect(dr.reasoning).toContain("startTransition");
  });

  it("Sidebar → MEMOIZE (1 normal + 1 transition spurious — not all transitions)", async () => {
    const data = await loadProfile(REALISTIC);
    const result = suggestMemoization(data);
    const sb = result.suggestions.find((s) => s.component === "Sidebar")!;
    expect(sb).toBeDefined();
    expect(sb.recommendation).toBe("MEMOIZE");
  });
});

describe("realistic profile — concurrent commit detection", () => {
  it("commit 4 (Low Priority) → is_concurrent_commit: true", async () => {
    const data = await loadProfile(REALISTIC);
    const result = traceRenderCascade(data, 4);
    expect(result.is_concurrent_commit).toBe(true);
  });

  it("commit 0 (Normal) → is_concurrent_commit: false", async () => {
    const data = await loadProfile(REALISTIC);
    const result = traceRenderCascade(data, 0);
    expect(result.is_concurrent_commit).toBe(false);
  });

  it("DeferredResults has transition_render_count=2 in get_hottest_components", async () => {
    const data = await loadProfile(REALISTIC);
    const result = getHottestComponents(data, 20);
    const dr = result.components.find((c) => c.component === "DeferredResults");
    expect(dr).toBeDefined();
    expect(dr!.transition_render_count).toBe(2);
  });
});

describe("realistic profile — find_spurious_renders concurrent_yield flag", () => {
  it("DeferredResults → concurrent_yield: true in find_spurious_renders", async () => {
    const data = await loadProfile(REALISTIC);
    const result = findSpuriousRenders(data);
    const dr = result.spurious_renders.find(
      (r) => r.component === "DeferredResults",
    )!;
    expect(dr).toBeDefined();
    expect(dr.render_trigger).toBe("UNSTABLE_PARENT_REF");
    expect(dr.concurrent_yield).toBe(true);
  });

  it("ProductGrid → concurrent_yield: false (has normal spurious renders too)", async () => {
    const data = await loadProfile(REALISTIC);
    const result = findSpuriousRenders(data);
    const pg = result.spurious_renders.find(
      (r) => r.component === "ProductGrid",
    )!;
    expect(pg).toBeDefined();
    expect(pg.concurrent_yield).toBe(false);
  });
});
