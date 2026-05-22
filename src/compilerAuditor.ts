import { Project, SyntaxKind } from "ts-morph";

export interface CompilerAuditResult {
  efficacyRate: number;
  bailoutReasons: string[];
  suggestedASTAction:
    | "STABILIZE_MUTATION"
    | "HOIST_SIDE_EFFECT"
    | "STRUCTURAL_SPLIT"
    | "NONE";
}

export class CompilerEfficacyAuditor {
  private project: Project;

  constructor() {
    this.project = new Project({
      compilerOptions: { allowJs: true, outDir: "dist" },
    });
  }

  public auditComponentInFile(
    filePath: string,
    componentName: string,
  ): CompilerAuditResult {
    const sourceFile = this.project.addSourceFileAtPath(filePath);
    const componentNode = this.locateComponent(sourceFile, componentName);

    if (!componentNode) {
      throw new Error(
        `Component ${componentName} not resolved in file: ${filePath}`,
      );
    }

    return this.auditComponent(componentNode);
  }

  public auditComponent(astNode: any): CompilerAuditResult {
    const bailoutReasons: string[] = [];

    // Scan AST for side effects inside the render path
    const dateCalls = astNode
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .filter((c: any) => c.getExpression().getText() === "Date.now");
    if (dateCalls.length > 0) {
      bailoutReasons.push(
        'Bailout: Side effect "Date.now()" detected in render body.',
      );
    }

    const randomCalls = astNode
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .filter((c: any) => c.getExpression().getText().includes("Math.random"));
    if (randomCalls.length > 0) {
      bailoutReasons.push(
        'Bailout: Non-deterministic operation "Math.random()" prevents static optimization.',
      );
    }

    // Identify mutable references passed into render pipelines
    const refMutations = astNode
      .getDescendantsOfKind(SyntaxKind.BinaryExpression)
      .filter(
        (b: any) =>
          b.getLeft().getText().includes(".current") &&
          b.getOperatorToken().getText() === "=",
      );
    if (refMutations.length > 0) {
      bailoutReasons.push(
        "Bailout: In-render mutation of useRef.current violates predictability rules.",
      );
    }

    const hasNoMemoDirective = astNode
      .getDescendantsOfKind(SyntaxKind.ExpressionStatement)
      .some(
        (e: any) =>
          e.getText().includes('"use no memo"') ||
          e.getText().includes("'use no memo'"),
      );
    if (hasNoMemoDirective) {
      bailoutReasons.push('Bailout: Explicit "use no memo" directive used.');
    }

    const action:
      | "STABILIZE_MUTATION"
      | "HOIST_SIDE_EFFECT"
      | "STRUCTURAL_SPLIT"
      | "NONE" =
      refMutations.length > 0
        ? "STABILIZE_MUTATION"
        : dateCalls.length > 0 || randomCalls.length > 0
          ? "HOIST_SIDE_EFFECT"
          : bailoutReasons.length > 0
            ? "STRUCTURAL_SPLIT"
            : "NONE";

    return {
      efficacyRate: bailoutReasons.length === 0 ? 100 : 0,
      bailoutReasons,
      suggestedASTAction: action,
    };
  }

  private locateComponent(sourceFile: any, name: string): any {
    const funcDecl = sourceFile.getFunction(name);
    if (funcDecl) return funcDecl;

    const varDecl = sourceFile.getVariableDeclaration(name);
    if (varDecl) {
      const init = varDecl.getInitializer();
      if (
        init &&
        (init.isKind(SyntaxKind.ArrowFunction) ||
          init.isKind(SyntaxKind.FunctionExpression))
      ) {
        return init;
      }
    }
    return null;
  }
}
