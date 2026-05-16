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
      total_self_ms: round(m.totalSelfMs),
      pct_of_total: round((m.totalSelfMs / data.totalMs) * 100),
    })),
  };
}

export function findSpuriousRenders(
  data: ProfileData,
  minRenderCount = 1,
): SpuriousRendersResult {
  const spurious = data.metrics
    .filter((m) => m.spuriousRenderCount > 0 && m.renderCount >= minRenderCount)
    .sort((a, b) => b.spuriousWastedMs - a.spuriousWastedMs);

  return {
    total_commits: data.totalCommits,
    spurious_renders: spurious.map((m) => ({
      component: m.name,
      render_count: m.renderCount,
      spurious_count: m.spuriousRenderCount,
      wasted_ms: round(m.spuriousWastedMs),
      reason:
        "props reference changed but no prop keys differed — unstable object/function/array from parent",
    })),
  };
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
    .map((m) => ({
      component: m.name,
      render_count: m.renderCount,
      spurious_count: m.spuriousRenderCount,
      wasted_ms: round(m.spuriousWastedMs),
      suggestion: "React.memo" as const,
      reason: `Re-rendered ${m.spuriousRenderCount}×/${m.renderCount} times with unchanged props. Wrap with React.memo to skip renders when props are shallowly equal.`,
    }));

  return { suggestions };
}
