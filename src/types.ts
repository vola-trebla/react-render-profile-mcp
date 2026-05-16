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
  totalActualMs: number;
  totalSelfMs: number;
  avgSelfMs: number;
  spuriousRenderCount: number;
  spuriousWastedMs: number;
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
    reason: string;
  }>;
}

export interface HottestComponentsResult {
  total_profile_ms: number;
  components: Array<{
    component: string;
    render_count: number;
    total_self_ms: number;
    avg_self_ms: number;
    pct_of_total: number;
  }>;
}

export interface RenderCascadeResult {
  commit_index: number;
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
    suggestion: "React.memo" | "useMemo" | "useCallback";
    reason: string;
  }>;
}
