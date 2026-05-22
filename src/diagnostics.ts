import { getComponentType } from "./parser.js";
import type {
  ProfileData,
  CompilerEfficacyResult,
  HydrationSuspenseResult,
  ExternalStoreResult,
  StateCascadeResult,
} from "./types.js";

/**
 * Computes the Invalidation Index and maps spurious renders of Memo/Function components.
 * Help find where React 19 compiler or manual memoization fails due to unstable prop references!
 */
export function analyzeCompilerEfficacy(
  profileData: ProfileData,
  invalidThreshold: number = 10,
): CompilerEfficacyResult {
  const verdicts: CompilerEfficacyResult["verdicts"] = [];

  for (const m of profileData.metrics) {
    const type = getComponentType(m.fiberID, profileData.typeMap, m.name);
    // Focus on Function Components (5) and Memo Components (8)
    if (type !== 5 && type !== 8) continue;

    if (m.renderCount === 0) continue;

    // Formula: I = (S_spurious / S_total) * T_spurious_ms
    const invalidationIndex =
      (m.spuriousRenderCount / m.renderCount) * m.spuriousWastedMs;

    if (invalidationIndex >= invalidThreshold && m.spuriousRenderCount > 0) {
      let severity: "CRITICAL" | "WARNING" | "INFO" = "INFO";
      if (invalidationIndex >= 100 || m.spuriousWastedMs > 100) {
        severity = "CRITICAL";
      } else if (invalidationIndex >= 10 || m.spuriousWastedMs > 10) {
        severity = "WARNING";
      }

      verdicts.push({
        severity,
        component_name: m.name,
        target_file_path: `src/components/${m.name}.tsx`,
        ineffective_render_count: m.spuriousRenderCount,
        wasted_ms: m.spuriousWastedMs,
        trigger_cause: "UNSTABLE_PARENT_PROP_REFERENCE",
        recommendation: `Ineffective rendering detected! Component <${m.name}> has a high invalidation index (${invalidationIndex.toFixed(2)}) due to spurious renders. Memoize parent component props using useMemo/useCallback or hoist static objects out of the parent's render function to stabilize references.`,
      });
    }
  }

  return { verdicts };
}

/**
 * Detects hydration mismatches and tracks Suspense waterfalls based on timeline/commit deltas.
 * Don't let server-client mismatches or slow Suspense chains slow down the user!
 */
export function diagnoseHydrationAndSuspense(
  profileData: ProfileData,
  waterfallThresholdMs: number = 100,
): HydrationSuspenseResult {
  const verdicts: HydrationSuspenseResult["verdicts"] = [];

  // 1. Detect Hydration Mismatches (NON_DETERMINISTIC_MARKUP)
  // Check the first commit (index 0). If the duration is very high (> 150ms) and we have unmounts
  // across the session, it indicates client-side hydration fell back to client rendering.
  const firstCommit = profileData.commits[0];
  if (firstCommit) {
    const totalUnmounts = profileData.metrics.reduce(
      (acc, m) => acc + m.unmountCount,
      0,
    );
    if (firstCommit.duration > 150 && totalUnmounts > 0) {
      // Find root component (minimum fiber ID in nameMap)
      let rootComponent = "Root";
      let minId = Infinity;
      for (const [id, name] of profileData.nameMap) {
        if (id < minId) {
          minId = id;
          rootComponent = name;
        }
      }

      // Gather suspense boundaries
      const suspenseBoundaries: string[] = [];
      for (const id of profileData.typeMap.keys()) {
        const name = profileData.nameMap.get(id);
        if (name && getComponentType(id, profileData.typeMap, name) === 12) {
          suspenseBoundaries.push(name);
        }
      }

      verdicts.push({
        severity: "CRITICAL",
        anomaly_type: "HYDRATION_MISMATCH_RECOVERY",
        root_component: rootComponent,
        affected_suspense_boundaries: suspenseBoundaries,
        blocking_duration_ms: firstCommit.duration,
        trigger_cause: "NON_DETERMINISTIC_MARKUP",
        recommendation:
          "Hydration mismatch recovery detected. The initial mount took abnormally long with unmounts. Ensure server and client HTML markup match exactly. Avoid browser-only APIs (window, document) or random/time values during initial render, or wrap them in useEffect.",
      });
    }
  }

  // 2. Detect Suspense Waterfalls (NESTED_MOUNT_FETCH_WATERFALL)
  // Track spacing between consecutive commits of Suspense components (type 12)
  const suspenseIds: number[] = [];
  for (const [id, name] of profileData.nameMap) {
    if (getComponentType(id, profileData.typeMap, name) === 12) {
      suspenseIds.push(id);
    }
  }

  for (const sId of suspenseIds) {
    const sName = profileData.nameMap.get(sId)!;
    const renders: Array<{ commitIndex: number; timestamp: number }> = [];

    for (let ci = 0; ci < profileData.commits.length; ci++) {
      const commit = profileData.commits[ci];
      const selfDurations = new Map(commit.fiberSelfDurations);
      if (selfDurations.has(sId)) {
        renders.push({ commitIndex: ci, timestamp: commit.timestamp });
      }
    }

    renders.sort((a, b) => a.timestamp - b.timestamp);

    for (let i = 0; i < renders.length - 1; i++) {
      const diff = renders[i + 1].timestamp - renders[i].timestamp;
      if (diff > waterfallThresholdMs) {
        verdicts.push({
          severity: diff > 500 ? "CRITICAL" : "WARNING",
          anomaly_type: "NESTED_MOUNT_FETCH_WATERFALL",
          root_component: sName,
          affected_suspense_boundaries: [sName],
          blocking_duration_ms: diff,
          trigger_cause: "NESTED_MOUNT_FETCH_WATERFALL",
          recommendation: `Suspense Waterfall detected! Boundary <${sName}> took ${diff.toFixed(1)}ms to resolve. Avoid nested Suspense boundaries fetching data sequentially. Prefetch data at the parent level, use Promise.all, or migrate to a data-fetching framework.`,
        });
      }
    }
  }

  return { verdicts };
}

/**
 * Analyzes useSyncExternalStore performance, selector instability, and synchronous bypasses.
 * Redux/Zustand store speed check! Don't let selectors flood your renders!
 */
export function evaluateExternalStorePerformance(
  profileData: ProfileData,
  maxBlockingTaskMs: number = 50,
): ExternalStoreResult {
  const verdicts: ExternalStoreResult["verdicts"] = [];

  // 1. Detect UNSTABLE_SELECTOR_OBJECT_ALLOCATION
  // Look for components rendering in consecutive commits with small timestamp deltas (<16ms)
  // triggered by hook/state changes.
  for (const m of profileData.metrics) {
    const renders: Array<{
      commitIndex: number;
      timestamp: number;
      didHooksChange: boolean;
    }> = [];
    for (let ci = 0; ci < profileData.commits.length; ci++) {
      const commit = profileData.commits[ci];
      const selfDurations = new Map(commit.fiberSelfDurations);
      if (selfDurations.has(m.fiberID)) {
        const desc = commit.changeDescriptions?.[String(m.fiberID)];
        renders.push({
          commitIndex: ci,
          timestamp: commit.timestamp,
          didHooksChange: desc?.didHooksChange || false,
        });
      }
    }

    renders.sort((a, b) => a.timestamp - b.timestamp);

    let unstableSequences = 0;
    let maxTaskMs = 0;
    for (let i = 0; i < renders.length - 1; i++) {
      const delta = renders[i + 1].timestamp - renders[i].timestamp;
      if (
        delta < 16 &&
        renders[i].didHooksChange &&
        renders[i + 1].didHooksChange
      ) {
        unstableSequences++;
        const commit = profileData.commits[renders[i + 1].commitIndex];
        const selfMs = new Map(commit.fiberSelfDurations).get(m.fiberID) ?? 0;
        if (selfMs > maxTaskMs) {
          maxTaskMs = selfMs;
        }
      }
    }

    if (unstableSequences >= 3) {
      verdicts.push({
        severity: unstableSequences > 8 ? "CRITICAL" : "WARNING",
        store_hook_id: "useSyncExternalStore",
        impacted_components: [m.name],
        longest_sync_task_ms: maxTaskMs,
        is_infinite_loop: unstableSequences > 8,
        trigger_cause: "UNSTABLE_SELECTOR_OBJECT_ALLOCATION",
        recommendation: `Unstable store selector! Component <${m.name}> rendered rapidly in consecutive frames (${unstableSequences} times). The selector function likely returns a new object reference on every call. Wrap the selector in useCallback or return primitive values to prevent unnecessary store trigger cycles.`,
      });
    }
  }

  // 2. Detect SYNC_CONCURRENCY_BYPASS
  // Heavy synchronous store updates (duration > maxBlockingTaskMs) scheduled in high-priority blocking lanes.
  for (let ci = 0; ci < profileData.commits.length; ci++) {
    const commit = profileData.commits[ci];
    const isTransition =
      commit.priorityLevel === "Low Priority" ||
      commit.priorityLevel === "Idle";

    if (!isTransition && commit.duration > maxBlockingTaskMs) {
      const storeComponents: string[] = [];
      if (commit.changeDescriptions) {
        for (const [idStr, desc] of Object.entries(commit.changeDescriptions)) {
          const id = Number(idStr);
          if (desc.didHooksChange || (desc.state && desc.state.length > 0)) {
            const name = profileData.nameMap.get(id);
            if (
              name &&
              (name.includes("Store") ||
                name.includes("Selector") ||
                name.includes("Connect") ||
                name.includes("Provider") ||
                name.includes("Zustand") ||
                name.includes("Redux"))
            ) {
              storeComponents.push(name);
            }
          }
        }
      }

      if (storeComponents.length > 0) {
        verdicts.push({
          severity: commit.duration > 150 ? "CRITICAL" : "WARNING",
          store_hook_id: "useSyncExternalStore",
          impacted_components: storeComponents,
          longest_sync_task_ms: commit.duration,
          is_infinite_loop: false,
          trigger_cause: "SYNC_CONCURRENCY_BYPASS",
          recommendation: `Concurrency bypass! Heavy synchronous store update took ${commit.duration.toFixed(1)}ms in high-priority lane. Wrap store dispatch or update actions in startTransition to run them concurrently without blocking the main UI thread.`,
        });
      }
    }
  }

  return { verdicts };
}

/**
 * Reconstructs the render cascade traversal for a specific commit and counts affected consumers.
 * Trace the ripples! See how a single state change causes a wave of re-renders.
 */
export function traceStateCascadeFootprint(
  profileData: ProfileData,
  commitIndex: number,
): StateCascadeResult {
  if (commitIndex < 0 || commitIndex >= profileData.commits.length) {
    return { verdict: null };
  }

  const commit = profileData.commits[commitIndex];
  const renderedIds = new Set(commit.fiberSelfDurations.map(([id]) => id));

  if (renderedIds.size === 0) {
    return { verdict: null };
  }

  // Calculate cascade render depth
  let maxDepth = 0;
  for (const id of renderedIds) {
    let depth = 1;
    let curr = id;
    while (true) {
      const parent = profileData.parentMap.get(curr);
      if (!parent) break;
      if (renderedIds.has(parent)) {
        depth++;
      }
      curr = parent;
    }
    if (depth > maxDepth) {
      maxDepth = depth;
    }
  }

  // Detect context updates in this commit
  let hasContextUpdate = false;
  if (commit.changeDescriptions) {
    for (const desc of Object.values(commit.changeDescriptions)) {
      if (desc.context === true) {
        hasContextUpdate = true;
        break;
      }
    }
  }

  // Identify update trigger source
  let triggerSource = "Unknown Source";
  if (commit.updaters && commit.updaters.length > 0) {
    triggerSource = commit.updaters
      .map((u) => u.displayName || `Component #${u.id}`)
      .join(", ");
  } else {
    // Fallback: find topmost rendered components
    const topComponents: string[] = [];
    for (const id of renderedIds) {
      const parent = profileData.parentMap.get(id);
      if (!parent || !renderedIds.has(parent)) {
        const name = profileData.nameMap.get(id);
        if (name) topComponents.push(name);
      }
    }
    if (topComponents.length > 0) {
      triggerSource = topComponents.join(", ");
    }
  }

  const renderedConsumerCount = renderedIds.size;
  const severity =
    renderedConsumerCount > 15 || maxDepth > 5 ? "HIGH_FOOTPRINT" : "NORMAL";
  const propagationChannel = hasContextUpdate
    ? "CONTEXT_PROVIDER"
    : "GRANULAR_STORE_SUBSCRIBER";

  const recommendation = hasContextUpdate
    ? "Context propagation wave! Split the context provider into smaller, more focused providers, or memoize context values and children to prevent re-rendering all consumers on any minor value change."
    : "Subscriber cascade footprint! Re-renders are driven by store selectors. Use more granular selectors, or verify if the component is subscribing to too much state.";

  return {
    verdict: {
      severity,
      update_trigger_source: triggerSource,
      propagation_channel: propagationChannel,
      cascade_render_depth: maxDepth,
      rendered_consumer_count: renderedConsumerCount,
      total_duration_ms: commit.duration,
      recommendation,
    },
  };
}
