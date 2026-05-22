// Raw React DevTools Profiler export format (version 5)
export interface ReactProfile {
  version: number;
  dataForRoots: ProfileRoot[];
}

export interface ProfileRoot {
  commitData: ProfileCommit[];
  displayName: string;
  initialTreeBaseDurations: [number, number][];
  operations: number[];
  rootID: number;
  snapshots: [number, SnapshotNode][];
}

export interface ProfileCommit {
  changeDescriptions: Record<string, ChangeDescription> | null;
  duration: number;
  effectDuration: number | null;
  fiberActualDurations: [number, number][];
  fiberSelfDurations: [number, number][];
  passiveEffectDuration: number | null;
  priorityLevel: string | null;
  timestamp: number;
  updaters: Updater[] | null;
}

export interface ChangeDescription {
  context: boolean | null;
  didHooksChange: boolean;
  isFirstMount: boolean;
  props: string[] | null; // null=unknown, []=ref changed but no keys, ["key"]=key changed
  state: string[] | null;
  hooks: number[] | null;
}

export interface Updater {
  displayName: string | null;
  id: number;
  key: string | null;
  type: number;
}

export interface SnapshotNode {
  id: number;
  children: number[];
  displayName: string | null;
  key: number | string | null;
  parentID: number;
}

// Aggregated per-component data (across all commits)
export interface ComponentMetrics {
  name: string;
  fiberID: number;
  renderCount: number;
  mountCount: number;
  unmountCount: number;
  updateCount: number;
  totalActualMs: number;
  totalSelfMs: number;
  avgSelfMs: number;
  spuriousRenderCount: number;
  spuriousWastedMs: number;
  contextRenderCount: number;
  contextWastedMs: number;
  transitionRenderCount: number;
  transitionSpuriousCount: number;
  transitionSpuriousWastedMs: number;
  changeReasons: ChangeReason[];
}

export interface ChangeReason {
  commitIndex: number;
  reason: "props" | "state" | "context" | "hooks" | "first-mount" | "unknown";
  changedKeys?: string[];
}

// Output from parser — passed to all analyzer functions
export interface ProfileData {
  profilePath: string;
  totalCommits: number;
  totalMs: number;
  metrics: ComponentMetrics[];
  commits: ProfileCommit[];
  nameMap: Map<number, string>;
  typeMap: Map<number, number>;
  parentMap: Map<number, number>;
  childrenMap: Map<number, number[]>;
  ownerMap: Map<number, number>;
}

// Tool result types
export interface RenderSummaryResult {
  profile_path: string;
  total_commits: number;
  total_render_ms: number;
  total_components_tracked: number;
  total_spurious_renders: number;
  top_components: Array<{
    component: string;
    render_count: number;
    mount_count: number;
    unmount_count: number;
    update_count: number;
    lifecycle_anomaly: boolean;
    total_self_ms: number;
    pct_of_total: number;
  }>;
}

export interface SpuriousRendersResult {
  total_commits: number;
  spurious_renders: Array<{
    component: string;
    render_count: number;
    spurious_count: number;
    wasted_ms: number;
    render_trigger: "UNSTABLE_PARENT_REF" | "CONTEXT_UPDATE";
    concurrent_yield: boolean;
    recommendation: string;
  }>;
}

export interface HottestComponentsResult {
  total_profile_ms: number;
  components: Array<{
    component: string;
    render_count: number;
    transition_render_count: number;
    total_self_ms: number;
    avg_self_ms: number;
    pct_of_total: number;
  }>;
}

export interface RenderCascadeResult {
  commit_index: number;
  is_concurrent_commit: boolean;
  trigger: string;
  total_commit_ms: number;
  cascade: Array<{
    component: string;
    self_ms: number;
    actual_ms: number;
    reason: string;
  }>;
}

export interface MemoSuggestionsResult {
  suggestions: Array<{
    component: string;
    render_count: number;
    spurious_count: number;
    wasted_ms: number;
    avg_render_ms: number;
    prop_stability: "STABLE" | "UNSTABLE_REFERENCES";
    recommendation:
      | "MEMOIZE"
      | "DO_NOT_MEMOIZE"
      | "INTENTIONAL_CONCURRENT_YIELD";
    reasoning: string;
  }>;
}

export interface CompilerEfficacyResult {
  verdicts: Array<{
    severity: "CRITICAL" | "WARNING" | "INFO";
    component_name: string;
    target_file_path: string;
    ineffective_render_count: number;
    wasted_ms: number;
    trigger_cause: "UNSTABLE_PARENT_PROP_REFERENCE" | "INLINE_SPREAD_OPERATOR";
    recommendation: string;
  }>;
}

export interface HydrationSuspenseResult {
  verdicts: Array<{
    severity: "CRITICAL" | "WARNING";
    anomaly_type:
      | "HYDRATION_MISMATCH_RECOVERY"
      | "NESTED_MOUNT_FETCH_WATERFALL";
    root_component: string;
    affected_suspense_boundaries: string[];
    blocking_duration_ms: number;
    trigger_cause: "NON_DETERMINISTIC_MARKUP" | "NESTED_MOUNT_FETCH_WATERFALL";
    recommendation: string;
  }>;
}

export interface ExternalStoreResult {
  verdicts: Array<{
    severity: "CRITICAL" | "WARNING";
    store_hook_id: string;
    impacted_components: string[];
    longest_sync_task_ms: number;
    is_infinite_loop: boolean;
    trigger_cause:
      | "UNSTABLE_SELECTOR_OBJECT_ALLOCATION"
      | "SYNC_CONCURRENCY_BYPASS";
    recommendation: string;
  }>;
}

export interface StateCascadeResult {
  verdict: {
    severity: "HIGH_FOOTPRINT" | "NORMAL";
    update_trigger_source: string;
    propagation_channel: "CONTEXT_PROVIDER" | "GRANULAR_STORE_SUBSCRIBER";
    cascade_render_depth: number;
    rendered_consumer_count: number;
    total_duration_ms: number;
    recommendation: string;
  } | null;
}
