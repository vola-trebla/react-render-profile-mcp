import { readFile } from "fs/promises";
import { existsSync } from "fs";
import type {
  ReactProfile,
  ProfileRoot,
  ProfileCommit,
  ComponentMetrics,
  ChangeDescription,
  ChangeReason,
  ProfileData,
} from "./types.js";

interface OperationsResult {
  nameMap: Map<number, string>;
  unmountCounts: Map<number, number>;
  typeMap: Map<number, number>;
  parentMap: Map<number, number>;
  ownerMap: Map<number, number>;
}

// Decodes the React DevTools operations integer array.
// Operations format (version 5):
//   [rendererID, rootFiberID, stringTableSize, ...strings, ...opcodes]
// Opcode 1 (ADD): [1, id, type, parentID, ownerID, nameStringIdx, keyStringIdx]
// Opcode 2 (REMOVE): [2, count, id1, id2, ...]
function decodeOperations(operations: number[]): OperationsResult {
  const nameMap = new Map<number, string>();
  const unmountCounts = new Map<number, number>();
  const typeMap = new Map<number, number>();
  const parentMap = new Map<number, number>();
  const ownerMap = new Map<number, number>();
  if (operations.length < 3)
    return { nameMap, unmountCounts, typeMap, parentMap, ownerMap };

  let i = 0;
  i += 2; // skip rendererID, rootFiberID

  const stringTableSize = operations[i++];
  const strings: string[] = [""]; // index 0 = null/empty
  for (let j = 0; j < stringTableSize; j++) {
    const len = operations[i++];
    let str = "";
    for (let k = 0; k < len; k++) str += String.fromCharCode(operations[i++]);
    strings.push(str);
  }

  while (i < operations.length) {
    const opcode = operations[i++];
    switch (opcode) {
      case 1: {
        // TREE_OPERATION_ADD
        const id = operations[i++];
        const type = operations[i++];
        const parentID = operations[i++];
        const ownerID = operations[i++];
        const nameIdx = operations[i++];
        i++; // keyIdx
        if (nameIdx > 0 && nameIdx < strings.length)
          nameMap.set(id, strings[nameIdx]);
        typeMap.set(id, type);
        parentMap.set(id, parentID);
        ownerMap.set(id, ownerID);
        break;
      }
      case 2: {
        // TREE_OPERATION_REMOVE
        const count = operations[i++];
        for (let j = 0; j < count; j++) {
          const removedId = operations[i++];
          unmountCounts.set(removedId, (unmountCounts.get(removedId) ?? 0) + 1);
        }
        break;
      }
      case 3: {
        // TREE_OPERATION_REORDER_CHILDREN
        i++;
        const count = operations[i++];
        i += count;
        break;
      }
      case 4: {
        // TREE_OPERATION_UPDATE_TREE_BASE_DURATION
        i += 3; // id + 2 uint32s encoding a float64
        break;
      }
      case 5: {
        // TREE_OPERATION_UPDATE_ERRORS_OR_WARNINGS
        i += 3; // id + errorCount + warningCount
        break;
      }
      case 6: {
        // TREE_OPERATION_UNEXPECTEDLY_UNMOUNTED
        i += 1;
        break;
      }
      case 7: {
        // TREE_OPERATION_RELOAD_AND_PROFILE_SUPPORTED
        break;
      }
      default:
        return { nameMap, unmountCounts, typeMap, parentMap, ownerMap }; // unknown opcode — stop parsing safely
    }
  }

  return { nameMap, unmountCounts, typeMap, parentMap, ownerMap };
}

interface RootData {
  nameMap: Map<number, string>;
  unmountCounts: Map<number, number>;
  typeMap: Map<number, number>;
  parentMap: Map<number, number>;
  childrenMap: Map<number, number[]>;
  ownerMap: Map<number, number>;
}

export function getComponentType(
  id: number,
  typeMap: Map<number, number>,
  name: string,
): number {
  if (typeMap.has(id)) return typeMap.get(id)!;
  if (name.endsWith("Provider")) return 2; // ElementTypeContext
  if (name.endsWith("Consumer")) return 5; // ElementTypeFunction
  if (name.includes("Memo") || name.startsWith("Memo(")) return 8; // ElementTypeMemo
  if (name === "Suspense") return 12; // ElementTypeSuspense
  return 5; // Default to ElementTypeFunction
}

function buildRootData(root: ProfileRoot): RootData {
  const nameMap = new Map<number, string>();
  let unmountCounts = new Map<number, number>();
  const typeMap = new Map<number, number>();
  const parentMap = new Map<number, number>();
  const childrenMap = new Map<number, number[]>();
  const ownerMap = new Map<number, number>();

  // Primary source: snapshots (most reliable, human-readable)
  for (const [id, snapshot] of root.snapshots) {
    if (snapshot.displayName) nameMap.set(id, snapshot.displayName);
    if (snapshot.parentID) parentMap.set(id, snapshot.parentID);
    if (snapshot.children) childrenMap.set(id, snapshot.children);
  }

  // Always decode operations — needed for unmount counts even when snapshots cover names
  if (root.operations.length > 0) {
    try {
      const result = decodeOperations(root.operations);
      unmountCounts = result.unmountCounts;
      for (const [id, type] of result.typeMap) typeMap.set(id, type);
      for (const [id, parent] of result.parentMap) parentMap.set(id, parent);
      for (const [id, owner] of result.ownerMap) ownerMap.set(id, owner);

      // Reconstruct childrenMap from parentMap if snapshots were empty
      if (childrenMap.size === 0) {
        for (const [id, parent] of parentMap) {
          if (!childrenMap.has(parent)) childrenMap.set(parent, []);
          childrenMap.get(parent)!.push(id);
        }
      }

      // Only use name fallback when snapshots didn't cover names
      if (nameMap.size === 0) {
        for (const [id, name] of result.nameMap) nameMap.set(id, name);
      }
    } catch {
      // silently ignore — parsing is best-effort
    }
  }

  // Always collect names and types from updaters (available in every commit)
  for (const commit of root.commitData) {
    for (const updater of commit.updaters ?? []) {
      if (updater.displayName && updater.id)
        nameMap.set(updater.id, updater.displayName);
      if (updater.type !== undefined && updater.id)
        typeMap.set(updater.id, updater.type);
    }
  }

  return {
    nameMap,
    unmountCounts,
    typeMap,
    parentMap,
    childrenMap,
    ownerMap,
  };
}

function classifyReason(
  fiberID: number,
  commitIndex: number,
  commit: ProfileCommit,
): ChangeReason {
  const desc = commit.changeDescriptions?.[String(fiberID)];
  if (!desc) return { commitIndex, reason: "unknown" };
  if (desc.isFirstMount) return { commitIndex, reason: "first-mount" };
  if (desc.context) return { commitIndex, reason: "context" };
  if (desc.state && desc.state.length > 0)
    return { commitIndex, reason: "state", changedKeys: desc.state };
  if (desc.didHooksChange)
    return {
      commitIndex,
      reason: "hooks",
      changedKeys: desc.hooks?.map(String),
    };
  if (desc.props !== null)
    return {
      commitIndex,
      reason: "props",
      changedKeys: desc.props.length > 0 ? desc.props : undefined,
    };
  return { commitIndex, reason: "unknown" };
}

// A render is spurious when props reference changed but no actual prop keys differed.
// React records this as props === [] (empty array, not null).
function isSpurious(fiberID: number, commit: ProfileCommit): boolean {
  const desc = commit.changeDescriptions?.[String(fiberID)];
  if (!desc) return false;
  if (desc.isFirstMount || desc.context || desc.didHooksChange) return false;
  if (desc.state && desc.state.length > 0) return false;
  return desc.props !== null && desc.props.length === 0;
}

// React 18 startTransition/useDeferredValue renders use Low Priority or Idle lanes.
// These are intentional — React may render a component multiple times, discard incomplete
// trees, and restart. Flagging them as regressions would be a false positive.
function isTransitionCommit(commit: ProfileCommit): boolean {
  return (
    commit.priorityLevel === "Low Priority" || commit.priorityLevel === "Idle"
  );
}

function aggregateMetrics(
  commits: ProfileCommit[],
  nameMap: Map<number, string>,
  unmountCounts: Map<number, number>,
): ComponentMetrics[] {
  const map = new Map<number, ComponentMetrics>();

  for (let ci = 0; ci < commits.length; ci++) {
    const commit = commits[ci];
    const selfMap = new Map(commit.fiberSelfDurations);
    const actualMap = new Map(commit.fiberActualDurations);

    for (const [fiberID, selfMs] of selfMap) {
      const actualMs = actualMap.get(fiberID) ?? selfMs;
      const name = nameMap.get(fiberID) ?? `[Component #${fiberID}]`;

      if (!map.has(fiberID)) {
        map.set(fiberID, {
          name,
          fiberID,
          renderCount: 0,
          mountCount: 0,
          unmountCount: unmountCounts.get(fiberID) ?? 0,
          updateCount: 0,
          totalActualMs: 0,
          totalSelfMs: 0,
          avgSelfMs: 0,
          spuriousRenderCount: 0,
          spuriousWastedMs: 0,
          contextRenderCount: 0,
          contextWastedMs: 0,
          transitionRenderCount: 0,
          transitionSpuriousCount: 0,
          transitionSpuriousWastedMs: 0,
          changeReasons: [],
        });
      }

      const m = map.get(fiberID)!;
      m.renderCount++;
      m.totalSelfMs += selfMs;
      m.totalActualMs += actualMs;

      const desc = commit.changeDescriptions?.[String(fiberID)];
      if (desc?.isFirstMount) m.mountCount++;
      else m.updateCount++;

      const transition = isTransitionCommit(commit);
      if (transition) m.transitionRenderCount++;

      m.changeReasons.push(classifyReason(fiberID, ci, commit));
      if (isSpurious(fiberID, commit)) {
        m.spuriousRenderCount++;
        m.spuriousWastedMs += selfMs;
        if (transition) {
          m.transitionSpuriousCount++;
          m.transitionSpuriousWastedMs += selfMs;
        }
      }
      if (desc?.context) {
        m.contextRenderCount++;
        m.contextWastedMs += selfMs;
      }
    }
  }

  for (const m of map.values()) m.avgSelfMs = m.totalSelfMs / m.renderCount;

  return Array.from(map.values());
}

export async function loadProfile(profilePath: string): Promise<ProfileData> {
  if (!existsSync(profilePath))
    throw new Error(`Profile file not found: ${profilePath}`);

  const raw = await readFile(profilePath, "utf-8");

  let profile: ReactProfile;
  try {
    profile = JSON.parse(raw) as ReactProfile;
  } catch (err) {
    throw new Error(
      `Invalid JSON format in profile file: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!profile || typeof profile !== "object") {
    throw new Error("Invalid profile: root is not a JSON object");
  }

  if (profile.version === undefined) {
    throw new Error("Invalid profile: missing version property");
  }

  if (profile.version !== 5) {
    throw new Error(
      `Unsupported profile version: ${profile.version}. Only React DevTools Profiler export version 5 is supported.`,
    );
  }

  if (!Array.isArray(profile.dataForRoots)) {
    throw new Error("Invalid profile: missing dataForRoots array");
  }

  // Real DevTools exports serialize changeDescriptions as [[fiberID, desc], ...] (Map.entries()).
  // Normalize to Record<string, ChangeDescription> so the rest of the code is uniform.
  for (const root of profile.dataForRoots) {
    for (const commit of root.commitData) {
      if (Array.isArray(commit.changeDescriptions)) {
        const record: Record<string, ChangeDescription> = {};
        for (const [id, desc] of commit.changeDescriptions as unknown as [
          number,
          ChangeDescription,
        ][]) {
          record[String(id)] = desc;
        }
        commit.changeDescriptions = record;
      }
    }
  }

  const allCommits: ProfileCommit[] = [];
  const allMetrics = new Map<number, ComponentMetrics>();
  const nameMap = new Map<number, string>();
  const typeMap = new Map<number, number>();
  const parentMap = new Map<number, number>();
  const childrenMap = new Map<number, number[]>();
  const ownerMap = new Map<number, number>();

  for (const root of profile.dataForRoots) {
    const rootData = buildRootData(root);
    for (const [id, name] of rootData.nameMap) nameMap.set(id, name);
    for (const [id, type] of rootData.typeMap) typeMap.set(id, type);
    for (const [id, parent] of rootData.parentMap) parentMap.set(id, parent);
    for (const [id, owner] of rootData.ownerMap) ownerMap.set(id, owner);
    for (const [id, children] of rootData.childrenMap)
      childrenMap.set(id, children);

    for (const m of aggregateMetrics(
      root.commitData,
      nameMap,
      rootData.unmountCounts,
    )) {
      const existing = allMetrics.get(m.fiberID);
      if (existing) {
        existing.renderCount += m.renderCount;
        existing.mountCount += m.mountCount;
        existing.unmountCount += m.unmountCount;
        existing.updateCount += m.updateCount;
        existing.totalSelfMs += m.totalSelfMs;
        existing.totalActualMs += m.totalActualMs;
        existing.spuriousRenderCount += m.spuriousRenderCount;
        existing.spuriousWastedMs += m.spuriousWastedMs;
        existing.contextRenderCount += m.contextRenderCount;
        existing.contextWastedMs += m.contextWastedMs;
        existing.transitionRenderCount += m.transitionRenderCount;
        existing.transitionSpuriousCount += m.transitionSpuriousCount;
        existing.transitionSpuriousWastedMs += m.transitionSpuriousWastedMs;
        existing.changeReasons.push(...m.changeReasons);
        existing.avgSelfMs = existing.totalSelfMs / existing.renderCount;
      } else {
        allMetrics.set(m.fiberID, m);
      }
    }

    allCommits.push(...root.commitData);
  }

  return {
    profilePath,
    totalCommits: allCommits.length,
    totalMs: allCommits.reduce((s, c) => s + c.duration, 0),
    metrics: Array.from(allMetrics.values()),
    commits: allCommits,
    nameMap,
    typeMap,
    parentMap,
    childrenMap,
    ownerMap,
  };
}
