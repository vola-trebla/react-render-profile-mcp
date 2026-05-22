import { describe, it, expect } from "vitest";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { loadProfile } from "../src/parser.js";
import {
  analyzeCompilerEfficacy,
  diagnoseHydrationAndSuspense,
  evaluateExternalStorePerformance,
  traceStateCascadeFootprint,
} from "../src/diagnostics.js";
import { writeFile, unlink } from "fs/promises";

const FIXTURE_BASIC = resolve(
  fileURLToPath(import.meta.url),
  "../../test/fixtures/basic.profile.json",
);

describe("Diagnostics Engine 🐸", () => {
  describe("analyzeCompilerEfficacy", () => {
    it("reports warnings/critical for high invalidation index", async () => {
      const data = await loadProfile(FIXTURE_BASIC);
      // Let's run compiler efficacy with a very low threshold to trigger reports
      const result = analyzeCompilerEfficacy(data, 1);

      expect(result.verdicts).toBeDefined();
      const productListVerdict = result.verdicts.find(
        (v) => v.component_name === "ProductList",
      );
      expect(productListVerdict).toBeDefined();
      expect(productListVerdict!.trigger_cause).toBe(
        "UNSTABLE_PARENT_PROP_REFERENCE",
      );
      expect(productListVerdict!.ineffective_render_count).toBe(2);
    });
  });

  describe("diagnoseHydrationAndSuspense", () => {
    it("detects hydration mismatches and suspense waterfalls", async () => {
      const tmpFile = "./test/fixtures/tmp-hydration.profile.json";

      const mockProfile = {
        version: 5,
        dataForRoots: [
          {
            displayName: "TestRoot",
            initialTreeBaseDurations: [] as [number, number][],
            operations: [1, 1, 0, 2, 1, 2], // rendererID=1, rootID=1, stringTableSize=0, Opcode 2 (REMOVE), count=1, id=2
            rootID: 1,
            snapshots: [
              [1, { id: 1, displayName: "App", parentID: 0, children: [2] }],
              [
                2,
                { id: 2, displayName: "Suspense", parentID: 1, children: [] },
              ],
            ] as [number, any][],
            commitData: [
              {
                // First commit takes 200ms
                duration: 200.0,
                effectDuration: 0,
                passiveEffectDuration: 0,
                fiberActualDurations: [
                  [1, 200.0],
                  [2, 150.0],
                ],
                fiberSelfDurations: [
                  [1, 50.0],
                  [2, 150.0],
                ],
                priorityLevel: "Normal",
                timestamp: 100,
                updaters: [] as any[],
                changeDescriptions: [
                  [
                    1,
                    {
                      isFirstMount: true,
                      props: null,
                      state: null,
                      hooks: null,
                      didHooksChange: false,
                      context: null,
                    },
                  ],
                  [
                    2,
                    {
                      isFirstMount: true,
                      props: null,
                      state: null,
                      hooks: null,
                      didHooksChange: false,
                      context: null,
                    },
                  ],
                ],
              },
              {
                // Second commit where Suspense resolves after 150ms
                duration: 20.0,
                effectDuration: 0,
                passiveEffectDuration: 0,
                fiberActualDurations: [[2, 20.0]],
                fiberSelfDurations: [[2, 20.0]],
                priorityLevel: "Normal",
                timestamp: 250, // 150ms after first commit
                updaters: [] as any[],
                changeDescriptions: [
                  [
                    2,
                    {
                      isFirstMount: false,
                      props: [],
                      state: null,
                      hooks: null,
                      didHooksChange: false,
                      context: null,
                    },
                  ],
                ],
              },
            ],
          },
        ],
      };

      await writeFile(tmpFile, JSON.stringify(mockProfile));

      try {
        const data = await loadProfile(tmpFile);
        const result = diagnoseHydrationAndSuspense(data, 100);

        // Should find HYDRATION_MISMATCH_RECOVERY
        const hydration = result.verdicts.find(
          (v) => v.anomaly_type === "HYDRATION_MISMATCH_RECOVERY",
        );
        expect(hydration).toBeDefined();
        expect(hydration!.severity).toBe("CRITICAL");
        expect(hydration!.trigger_cause).toBe("NON_DETERMINISTIC_MARKUP");

        // Should find NESTED_MOUNT_FETCH_WATERFALL (diff = 150ms > 100ms)
        const waterfall = result.verdicts.find(
          (v) => v.anomaly_type === "NESTED_MOUNT_FETCH_WATERFALL",
        );
        expect(waterfall).toBeDefined();
        expect(waterfall!.affected_suspense_boundaries).toContain("Suspense");
      } finally {
        await unlink(tmpFile);
      }
    });
  });

  describe("evaluateExternalStorePerformance", () => {
    it("detects unstable selector object allocations", async () => {
      const tmpFile = "./test/fixtures/tmp-store.profile.json";

      // Mock profile with a component rendering 4 times with short deltas (<16ms) and didHooksChange: true
      const mockProfile = {
        version: 5,
        dataForRoots: [
          {
            displayName: "StoreRoot",
            initialTreeBaseDurations: [] as [number, number][],
            operations: [] as number[],
            rootID: 1,
            snapshots: [
              [
                1,
                {
                  id: 1,
                  displayName: "StoreComponent",
                  parentID: 0,
                  children: [],
                },
              ],
            ] as [number, any][],
            commitData: [
              {
                duration: 2.0,
                effectDuration: 0,
                passiveEffectDuration: 0,
                fiberActualDurations: [[1, 2.0]],
                fiberSelfDurations: [[1, 2.0]],
                priorityLevel: "Normal",
                timestamp: 1000,
                updaters: [] as any[],
                changeDescriptions: [
                  [
                    1,
                    {
                      isFirstMount: false,
                      props: null,
                      state: null,
                      hooks: [1],
                      didHooksChange: true,
                      context: null,
                    },
                  ],
                ],
              },
              {
                duration: 2.0,
                effectDuration: 0,
                passiveEffectDuration: 0,
                fiberActualDurations: [[1, 2.0]],
                fiberSelfDurations: [[1, 2.0]],
                priorityLevel: "Normal",
                timestamp: 1010, // delta = 10ms
                updaters: [] as any[],
                changeDescriptions: [
                  [
                    1,
                    {
                      isFirstMount: false,
                      props: null,
                      state: null,
                      hooks: [1],
                      didHooksChange: true,
                      context: null,
                    },
                  ],
                ],
              },
              {
                duration: 2.0,
                effectDuration: 0,
                passiveEffectDuration: 0,
                fiberActualDurations: [[1, 2.0]],
                fiberSelfDurations: [[1, 2.0]],
                priorityLevel: "Normal",
                timestamp: 1020, // delta = 10ms
                updaters: [] as any[],
                changeDescriptions: [
                  [
                    1,
                    {
                      isFirstMount: false,
                      props: null,
                      state: null,
                      hooks: [1],
                      didHooksChange: true,
                      context: null,
                    },
                  ],
                ],
              },
              {
                duration: 2.0,
                effectDuration: 0,
                passiveEffectDuration: 0,
                fiberActualDurations: [[1, 2.0]],
                fiberSelfDurations: [[1, 2.0]],
                priorityLevel: "Normal",
                timestamp: 1030, // delta = 10ms
                updaters: [] as any[],
                changeDescriptions: [
                  [
                    1,
                    {
                      isFirstMount: false,
                      props: null,
                      state: null,
                      hooks: [1],
                      didHooksChange: true,
                      context: null,
                    },
                  ],
                ],
              },
            ],
          },
        ],
      };

      await writeFile(tmpFile, JSON.stringify(mockProfile));

      try {
        const data = await loadProfile(tmpFile);
        const result = evaluateExternalStorePerformance(data, 50);

        const verdict = result.verdicts.find(
          (v) => v.trigger_cause === "UNSTABLE_SELECTOR_OBJECT_ALLOCATION",
        );
        expect(verdict).toBeDefined();
        expect(verdict!.impacted_components).toContain("StoreComponent");
      } finally {
        await unlink(tmpFile);
      }
    });

    it("detects sync concurrency bypasses", async () => {
      const tmpFile = "./test/fixtures/tmp-bypass.profile.json";

      // Mock profile with a long synchronous update (>50ms) to a component with "Store" or "Selector" in its name
      const mockProfile = {
        version: 5,
        dataForRoots: [
          {
            displayName: "StoreRoot",
            initialTreeBaseDurations: [] as [number, number][],
            operations: [] as number[],
            rootID: 1,
            snapshots: [
              [
                1,
                {
                  id: 1,
                  displayName: "MyReduxStoreComponent",
                  parentID: 0,
                  children: [],
                },
              ],
            ] as [number, any][],
            commitData: [
              {
                duration: 80.0, // > 50ms
                effectDuration: 0,
                passiveEffectDuration: 0,
                fiberActualDurations: [[1, 80.0]],
                fiberSelfDurations: [[1, 80.0]],
                priorityLevel: "Normal", // Synchronous blocking lane
                timestamp: 1000,
                updaters: [] as any[],
                changeDescriptions: [
                  [
                    1,
                    {
                      isFirstMount: false,
                      props: null,
                      state: null,
                      hooks: [1],
                      didHooksChange: true,
                      context: null,
                    },
                  ],
                ],
              },
            ],
          },
        ],
      };

      await writeFile(tmpFile, JSON.stringify(mockProfile));

      try {
        const data = await loadProfile(tmpFile);
        const result = evaluateExternalStorePerformance(data, 50);

        const verdict = result.verdicts.find(
          (v) => v.trigger_cause === "SYNC_CONCURRENCY_BYPASS",
        );
        expect(verdict).toBeDefined();
        expect(verdict!.impacted_components).toContain("MyReduxStoreComponent");
      } finally {
        await unlink(tmpFile);
      }
    });
  });

  describe("traceStateCascadeFootprint", () => {
    it("traces cascade render depth and counts consumers", async () => {
      const tmpFile = "./test/fixtures/tmp-cascade.profile.json";

      // Reconstruct a simple tree structure: 1 -> 2 -> 3
      const mockProfile = {
        version: 5,
        dataForRoots: [
          {
            displayName: "Root",
            initialTreeBaseDurations: [] as [number, number][],
            operations: [] as number[],
            rootID: 1,
            snapshots: [
              [1, { id: 1, displayName: "App", parentID: 0, children: [2] }],
              [2, { id: 2, displayName: "Parent", parentID: 1, children: [3] }],
              [3, { id: 3, displayName: "Child", parentID: 2, children: [] }],
            ] as [number, any][],
            commitData: [
              {
                duration: 15.0,
                effectDuration: 0,
                passiveEffectDuration: 0,
                fiberActualDurations: [
                  [1, 15.0],
                  [2, 12.0],
                  [3, 10.0],
                ],
                fiberSelfDurations: [
                  [1, 3.0],
                  [2, 2.0],
                  [3, 10.0],
                ],
                priorityLevel: "Normal",
                timestamp: 1000,
                updaters: [{ id: 1, displayName: "App", type: 1, key: null }],
                changeDescriptions: [
                  [
                    1,
                    {
                      isFirstMount: false,
                      props: null,
                      state: ["someState"],
                      hooks: null,
                      didHooksChange: false,
                      context: null,
                    },
                  ],
                  [
                    2,
                    {
                      isFirstMount: false,
                      props: [],
                      state: null,
                      hooks: null,
                      didHooksChange: false,
                      context: null,
                    },
                  ],
                  [
                    3,
                    {
                      isFirstMount: false,
                      props: [],
                      state: null,
                      hooks: null,
                      didHooksChange: false,
                      context: null,
                    },
                  ],
                ],
              },
            ],
          },
        ],
      };

      await writeFile(tmpFile, JSON.stringify(mockProfile));

      try {
        const data = await loadProfile(tmpFile);
        const result = traceStateCascadeFootprint(data, 0);

        expect(result.verdict).toBeDefined();
        expect(result.verdict!.cascade_render_depth).toBe(3); // App -> Parent -> Child
        expect(result.verdict!.rendered_consumer_count).toBe(3);
        expect(result.verdict!.update_trigger_source).toBe("App");
        expect(result.verdict!.propagation_channel).toBe(
          "GRANULAR_STORE_SUBSCRIBER",
        );
      } finally {
        await unlink(tmpFile);
      }
    });

    it("detects context propagation channel when context is true", async () => {
      const tmpFile = "./test/fixtures/tmp-context.profile.json";

      const mockProfile = {
        version: 5,
        dataForRoots: [
          {
            displayName: "Root",
            initialTreeBaseDurations: [] as [number, number][],
            operations: [] as number[],
            rootID: 1,
            snapshots: [
              [
                1,
                { id: 1, displayName: "Provider", parentID: 0, children: [2] },
              ],
              [
                2,
                { id: 2, displayName: "Consumer", parentID: 1, children: [] },
              ],
            ] as [number, any][],
            commitData: [
              {
                duration: 5.0,
                effectDuration: 0,
                passiveEffectDuration: 0,
                fiberActualDurations: [
                  [1, 5.0],
                  [2, 4.0],
                ],
                fiberSelfDurations: [
                  [1, 1.0],
                  [2, 4.0],
                ],
                priorityLevel: "Normal",
                timestamp: 1000,
                updaters: [] as any[],
                changeDescriptions: [
                  [
                    2,
                    {
                      isFirstMount: false,
                      props: null,
                      state: null,
                      hooks: null,
                      didHooksChange: false,
                      context: true,
                    },
                  ],
                ],
              },
            ],
          },
        ],
      };

      await writeFile(tmpFile, JSON.stringify(mockProfile));

      try {
        const data = await loadProfile(tmpFile);
        const result = traceStateCascadeFootprint(data, 0);

        expect(result.verdict).toBeDefined();
        expect(result.verdict!.propagation_channel).toBe("CONTEXT_PROVIDER");
      } finally {
        await unlink(tmpFile);
      }
    });
  });
});
