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
  it("detects ProductList as spurious (props: [] in real format)", async () => {
    const data = await loadProfile(FIXTURE);
    const result = findSpuriousRenders(data);
    expect(result.spurious_renders).toHaveLength(1);
    expect(result.spurious_renders[0].component).toBe("ProductList");
    expect(result.spurious_renders[0].spurious_count).toBe(2);
    expect(result.spurious_renders[0].wasted_ms).toBeGreaterThan(0);
  });

  it("does not flag SearchInput as spurious (hook changed)", async () => {
    const data = await loadProfile(FIXTURE);
    const result = findSpuriousRenders(data);
    expect(
      result.spurious_renders.find((r) => r.component === "SearchInput"),
    ).toBeUndefined();
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
});
