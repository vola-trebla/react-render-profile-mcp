import { describe, it, expect } from "vitest";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { writeFile, unlink } from "fs/promises";
import { ASTPerformanceRemediator } from "../src/remediator.js";
import { CompilerEfficacyAuditor } from "../src/compilerAuditor.js";

describe("AST Performance Remediator & Compiler Auditor 🐸", () => {
  it("hoists static declarations, wraps callbacks in useCallback, and wraps in React.memo if ROI justifies", async () => {
    const filePath = resolve(
      fileURLToPath(import.meta.url),
      "../../test/fixtures/temp-component.tsx",
    );

    const initialCode = `
import React from 'react';

export const MyComponent = () => {
  const staticObject = { a: 1, b: 2 };
  const staticArray = [1, 2, 3];
  
  const someLocal = 42;
  const unstableCallback = () => {
    console.log(someLocal);
  };

  return (
    <div>
      {staticArray.map(x => <span key={x}>{x}</span>)}
    </div>
  );
};
export default MyComponent;
`;

    await writeFile(filePath, initialCode, "utf-8");

    try {
      const remediator = new ASTPerformanceRemediator();
      const updatedCode = remediator.optimizeComponent({
        filePath,
        componentName: "MyComponent",
        unstableProps: "unstableCallback",
        roiScore: 2.0, // Should trigger React.memo wrapping
      });

      // Verify static array and object are hoisted before the component definition
      expect(updatedCode).toContain("const staticObject = { a: 1, b: 2 };");
      expect(updatedCode).toContain("const staticArray = [1, 2, 3];");

      // Verify unstableCallback is wrapped in useCallback with someLocal as dependency
      expect(updatedCode).toContain("useCallback(() => {");
      expect(updatedCode).toContain("[someLocal]");

      // Verify React.memo is applied
      expect(updatedCode).toContain("React.memo(MyComponent)");
    } finally {
      await unlink(filePath).catch(() => {});
    }
  });

  it("audits compiler rules for Date.now(), Math.random(), ref mutations and use no memo", async () => {
    const filePath = resolve(
      fileURLToPath(import.meta.url),
      "../../test/fixtures/temp-audit.tsx",
    );

    const codeToAudit = `
import React, { useRef } from 'react';

export const BadComponent = () => {
  const countRef = useRef(0);
  const now = Date.now();
  const rand = Math.random();

  countRef.current = countRef.current + 1; // In-render ref mutation

  if (now > 0) {
    "use no memo";
  }

  return <div>Bad component</div>;
};
`;

    await writeFile(filePath, codeToAudit, "utf-8");

    try {
      const auditor = new CompilerEfficacyAuditor();
      const result = auditor.auditComponentInFile(filePath, "BadComponent");

      expect(result.efficacyRate).toBe(0);
      expect(result.bailoutReasons).toHaveLength(4);
      expect(result.bailoutReasons).toContain(
        'Bailout: Side effect "Date.now()" detected in render body.',
      );
      expect(result.bailoutReasons).toContain(
        'Bailout: Non-deterministic operation "Math.random()" prevents static optimization.',
      );
      expect(result.bailoutReasons).toContain(
        "Bailout: In-render mutation of useRef.current violates predictability rules.",
      );
      expect(result.bailoutReasons).toContain(
        'Bailout: Explicit "use no memo" directive used.',
      );
      expect(result.suggestedASTAction).toBe("STABILIZE_MUTATION");
    } finally {
      await unlink(filePath).catch(() => {});
    }
  });
});
