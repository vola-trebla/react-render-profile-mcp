import type {
  ProfileData,
  RenderSummaryResult,
  SpuriousRendersResult,
  HottestComponentsResult,
  RenderCascadeResult,
  MemoSuggestionsResult,
} from "./types.js";

function round(n: number, decimals = 2): number {
  return Math.round(n * 10 ** decimals) / 10 ** decimals;
}

export function getRenderSummary(data: ProfileData): RenderSummaryResult {
  const top5 = [...data.metrics]
    .sort((a, b) => b.totalSelfMs - a.totalSelfMs)
    .slice(0, 5);

  const totalSpurious = data.metrics.reduce(
    (s, m) => s + m.spuriousRenderCount,
    0,
  );

  return {
    profile_path: data.profilePath,
    total_commits: data.totalCommits,
    total_render_ms: round(data.totalMs),
    total_components_tracked: data.metrics.length,
    total_spurious_renders: totalSpurious,
    top_components: top5.map((m) => ({
      component: m.name,
      render_count: m.renderCount,
      mount_count: m.mountCount,
      unmount_count: m.unmountCount,
      update_count: m.updateCount,
      // mount_count ≥ 80% of render_count signals key instability: component keeps
      // being destroyed and recreated instead of updating — never updating its DOM
      lifecycle_anomaly:
        m.renderCount > 0 && m.mountCount / m.renderCount >= 0.8,
      total_self_ms: round(m.totalSelfMs),
      pct_of_total: round((m.totalSelfMs / data.totalMs) * 100),
    })),
  };
}

export function findSpuriousRenders(
  data: ProfileData,
  minRenderCount = 1,
): SpuriousRendersResult {
  type Entry = SpuriousRendersResult["spurious_renders"][number];

  const propEntries: Entry[] = data.metrics
    .filter((m) => m.spuriousRenderCount > 0 && m.renderCount >= minRenderCount)
    .map((m) => ({
      component: m.name,
      render_count: m.renderCount,
      spurious_count: m.spuriousRenderCount,
      wasted_ms: round(m.spuriousWastedMs),
      render_trigger: "UNSTABLE_PARENT_REF" as const,
      recommendation:
        "Wrap with React.memo — re-renders are driven by unstable object/function/array references from the parent. React.memo will skip them when props are shallowly equal.",
    }));

  // Context updates bypass React.memo entirely — surface them separately so the
  // agent recommends the correct fix (stabilize the context value, not memo the consumer).
  const contextEntries: Entry[] = data.metrics
    .filter(
      (m) =>
        m.contextRenderCount > 0 &&
        m.spuriousRenderCount === 0 &&
        m.renderCount >= minRenderCount,
    )
    .map((m) => ({
      component: m.name,
      render_count: m.renderCount,
      spurious_count: m.contextRenderCount,
      wasted_ms: round(m.contextWastedMs),
      render_trigger: "CONTEXT_UPDATE" as const,
      recommendation:
        "React.memo cannot help here — context updates bypass memo. Stabilize the context value with useMemo, or split the context so consumers only subscribe to the slice they use.",
    }));

  const combined = [...propEntries, ...contextEntries].sort(
    (a, b) => b.wasted_ms - a.wasted_ms,
  );

  return { total_commits: data.totalCommits, spurious_renders: combined };
}

export function getHottestComponents(
  data: ProfileData,
  topN = 10,
): HottestComponentsResult {
  const sorted = [...data.metrics]
    .sort((a, b) => b.totalSelfMs - a.totalSelfMs)
    .slice(0, topN);

  return {
    total_profile_ms: round(data.totalMs),
    components: sorted.map((m) => ({
      component: m.name,
      render_count: m.renderCount,
      total_self_ms: round(m.totalSelfMs),
      avg_self_ms: round(m.avgSelfMs),
      pct_of_total: round((m.totalSelfMs / data.totalMs) * 100),
    })),
  };
}

export function traceRenderCascade(
  data: ProfileData,
  commitIndex: number,
): RenderCascadeResult {
  if (commitIndex < 0 || commitIndex >= data.commits.length) {
    throw new Error(
      `commit_index ${commitIndex} out of range. Profile has ${data.commits.length} commits (0–${data.commits.length - 1}).`,
    );
  }

  const commit = data.commits[commitIndex];
  const selfMap = new Map(commit.fiberSelfDurations);
  const actualMap = new Map(commit.fiberActualDurations);

  const trigger =
    (commit.updaters ?? [])
      .map((u) => u.displayName ?? data.nameMap.get(u.id) ?? `[#${u.id}]`)
      .join(", ") || "unknown";

  const cascade = [...actualMap.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([fiberID, actualMs]) => {
      const selfMs = selfMap.get(fiberID) ?? 0;
      const name = data.nameMap.get(fiberID) ?? `[Component #${fiberID}]`;
      const desc = commit.changeDescriptions?.[String(fiberID)];

      let reason = "unknown";
      if (desc) {
        if (desc.isFirstMount) reason = "first mount";
        else if (desc.context) reason = "context changed";
        else if (desc.state && desc.state.length > 0)
          reason = `state: ${desc.state.join(", ")}`;
        else if (desc.didHooksChange) reason = "hook changed";
        else if (desc.props !== null)
          reason =
            desc.props.length > 0
              ? `props: ${desc.props.join(", ")}`
              : "parent re-rendered (unstable props reference)";
      }

      return {
        component: name,
        self_ms: round(selfMs),
        actual_ms: round(actualMs),
        reason,
      };
    });

  return {
    commit_index: commitIndex,
    trigger,
    total_commit_ms: round(commit.duration),
    cascade,
  };
}

export function suggestMemoization(
  data: ProfileData,
  minWastedMs = 0,
): MemoSuggestionsResult {
  const suggestions: MemoSuggestionsResult["suggestions"] = data.metrics
    .filter(
      (m) => m.spuriousRenderCount > 0 && m.spuriousWastedMs >= minWastedMs,
    )
    .sort((a, b) => b.spuriousWastedMs - a.spuriousWastedMs)
    .map((m) => {
      const avgRenderMs = round(m.avgSelfMs);
      // React.memo adds Object.is() comparison on every parent render.
      // When avg render time < 2ms, that overhead likely exceeds the savings.
      const recommendation: "MEMOIZE" | "DO_NOT_MEMOIZE" =
        m.avgSelfMs < 2 ? "DO_NOT_MEMOIZE" : "MEMOIZE";

      const reasoning =
        recommendation === "DO_NOT_MEMOIZE"
          ? `avg render time (${avgRenderMs}ms) is below 2ms — React.memo comparison overhead likely exceeds render cost. Fix the unstable reference in the parent instead (stabilize with useMemo/useCallback or move the value outside render).`
          : `Re-rendered ${m.spuriousRenderCount}×/${m.renderCount} times with unchanged props, wasting ${round(m.spuriousWastedMs)}ms. Wrap with React.memo to skip renders when props are shallowly equal.`;

      return {
        component: m.name,
        render_count: m.renderCount,
        spurious_count: m.spuriousRenderCount,
        wasted_ms: round(m.spuriousWastedMs),
        avg_render_ms: avgRenderMs,
        prop_stability: "UNSTABLE_REFERENCES" as const,
        recommendation,
        reasoning,
      };
    });

  return { suggestions };
}
