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
  it("suggests React.memo for ProductList", async () => {
    const data = await loadProfile(FIXTURE);
    const result = suggestMemoization(data);
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].component).toBe("ProductList");
    expect(result.suggestions[0].suggestion).toBe("React.memo");
  });

  it("respects min_wasted_ms threshold", async () => {
    const data = await loadProfile(FIXTURE);
    const result = suggestMemoization(data, 999);
    expect(result.suggestions).toHaveLength(0);
  });
});
