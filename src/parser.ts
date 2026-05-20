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
}

// Decodes the React DevTools operations integer array.
// Operations format (version 5):
//   [rendererID, rootFiberID, stringTableSize, ...strings, ...opcodes]
// Opcode 1 (ADD): [1, id, type, parentID, ownerID, nameStringIdx, keyStringIdx]
// Opcode 2 (REMOVE): [2, count, id1, id2, ...]
function decodeOperations(operations: number[]): OperationsResult {
  const nameMap = new Map<number, string>();
  const unmountCounts = new Map<number, number>();
  if (operations.length < 3) return { nameMap, unmountCounts };

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
        i++; // type
        i++; // parentID
        i++; // ownerID
        const nameIdx = operations[i++];
        i++; // keyIdx
        if (nameIdx > 0 && nameIdx < strings.length)
          nameMap.set(id, strings[nameIdx]);
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
        return { nameMap, unmountCounts }; // unknown opcode — stop parsing safely
    }
  }

  return { nameMap, unmountCounts };
}

interface RootData {
  nameMap: Map<number, string>;
  unmountCounts: Map<number, number>;
}

function buildRootData(root: ProfileRoot): RootData {
  const nameMap = new Map<number, string>();
  let unmountCounts = new Map<number, number>();

  // Primary source: snapshots (most reliable, human-readable)
  for (const [id, snapshot] of root.snapshots) {
    if (snapshot.displayName) nameMap.set(id, snapshot.displayName);
  }

  // Always decode operations — needed for unmount counts even when snapshots cover names
  if (root.operations.length > 0) {
    try {
      const result = decodeOperations(root.operations);
      unmountCounts = result.unmountCounts;
      // Only use name fallback when snapshots didn't cover names
      if (nameMap.size === 0) {
        for (const [id, name] of result.nameMap) nameMap.set(id, name);
      }
    } catch {
      // silently ignore — parsing is best-effort
    }
  }

  // Always collect names from updaters (available in every commit)
  for (const commit of root.commitData) {
    for (const updater of commit.updaters ?? []) {
      if (updater.displayName && updater.id)
        nameMap.set(updater.id, updater.displayName);
    }
  }

  return { nameMap, unmountCounts };
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

      m.changeReasons.push(classifyReason(fiberID, ci, commit));
      if (isSpurious(fiberID, commit)) {
        m.spuriousRenderCount++;
        m.spuriousWastedMs += selfMs;
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
  const profile = JSON.parse(raw) as ReactProfile;

  if (profile.version !== 5) {
    throw new Error(
      `Unsupported profile version: ${profile.version}. Only React DevTools Profiler export version 5 is supported.`,
    );
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

  for (const root of profile.dataForRoots) {
    const { nameMap: rootNames, unmountCounts } = buildRootData(root);
    for (const [id, name] of rootNames) nameMap.set(id, name);

    for (const m of aggregateMetrics(root.commitData, nameMap, unmountCounts)) {
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
  };
}
