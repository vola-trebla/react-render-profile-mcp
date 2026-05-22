import {
  Project,
  SyntaxKind,
  FunctionDeclaration,
  ArrowFunction,
  Block,
} from "ts-morph";

export interface RemediationTarget {
  filePath: string;
  componentName: string;
  unstableProps: string; // Comma-separated or space-separated list of props to memoize
  roiScore: number;
}

export class ASTPerformanceRemediator {
  private project: Project;

  constructor() {
    this.project = new Project({
      compilerOptions: { allowJs: true, outDir: "dist" },
    });
  }

  public optimizeComponent(target: RemediationTarget): string {
    const sourceFile = this.project.addSourceFileAtPath(target.filePath);
    const componentNode = this.locateComponent(
      sourceFile,
      target.componentName,
    );

    if (!componentNode) {
      throw new Error(
        `Component target ${target.componentName} not resolved in file: ${target.filePath}`,
      );
    }

    const componentBody = componentNode.getBody();
    if (!componentBody || !componentBody.isKind(SyntaxKind.Block)) {
      return sourceFile.getFullText();
    }

    const bodyBlock = componentBody as Block;

    // 1. Hoist static references out of the rendering body
    this.hoistStaticDeclarations(
      componentNode,
      bodyBlock,
      target.componentName,
    );

    // 2. Wrap unstable functions in useCallback
    if (target.unstableProps && target.unstableProps.trim().length > 0) {
      const freshComponent = this.locateComponent(
        sourceFile,
        target.componentName,
      );
      if (freshComponent) {
        const freshBody = freshComponent.getBody();
        if (freshBody && freshBody.isKind(SyntaxKind.Block)) {
          this.memoizeReactiveClosures(
            freshComponent,
            freshBody as Block,
            target.unstableProps,
          );
        }
      }
    }

    // 3. Inject React.memo wrapper if ROI score justifies overhead
    if (target.roiScore > 1.5) {
      this.applyMemoizationWrapper(sourceFile, target.componentName);
    }

    sourceFile.saveSync();
    return sourceFile.getFullText();
  }

  private locateComponent(
    sourceFile: any,
    name: string,
  ): FunctionDeclaration | ArrowFunction | null {
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
        return init as any;
      }
    }
    return null;
  }

  private hoistStaticDeclarations(
    component: any,
    body: Block,
    componentName: string,
  ): void {
    const parentSource = component.getSourceFile();
    const hoistedTexts: string[] = [];

    while (true) {
      const currentComponent = this.locateComponent(
        parentSource,
        componentName,
      );
      if (!currentComponent) break;

      const currentBody = currentComponent.getBody();
      if (!currentBody || !currentBody.isKind(SyntaxKind.Block)) break;

      const varStatements = currentBody.getDescendantsOfKind(
        SyntaxKind.VariableStatement,
      );
      let hoistedAny = false;

      for (const statement of varStatements) {
        if (statement.wasForgotten()) continue;
        const declarations = statement.getDeclarations();
        let allDeclsStatic = true;
        let hasLiteralInit = false;

        for (const decl of declarations) {
          const initializer = decl.getInitializer();
          if (
            initializer &&
            (initializer.isKind(SyntaxKind.ObjectLiteralExpression) ||
              initializer.isKind(SyntaxKind.ArrayLiteralExpression))
          ) {
            hasLiteralInit = true;
            if (!this.isExpressionStatic(initializer, currentComponent)) {
              allDeclsStatic = false;
              break;
            }
          } else {
            allDeclsStatic = false;
            break;
          }
        }

        if (hasLiteralInit && allDeclsStatic) {
          const statementText = statement.getText();
          hoistedTexts.push(statementText);
          statement.remove();
          hoistedAny = true;
          break;
        }
      }

      if (!hoistedAny) {
        break;
      }
    }

    if (hoistedTexts.length > 0) {
      const freshComponent = this.locateComponent(parentSource, componentName);
      if (freshComponent) {
        let targetInsertNode: any = freshComponent;
        if (
          freshComponent.isKind(SyntaxKind.ArrowFunction) ||
          freshComponent.isKind(SyntaxKind.FunctionExpression)
        ) {
          const varDecl = freshComponent.getFirstAncestorByKind(
            SyntaxKind.VariableDeclaration,
          );
          if (varDecl) {
            const varStatement = varDecl.getFirstAncestorByKind(
              SyntaxKind.VariableStatement,
            );
            if (varStatement) {
              targetInsertNode = varStatement;
            } else {
              targetInsertNode = varDecl;
            }
          }
        }
        const insertPosition = targetInsertNode.getStart();
        const textToInsert = hoistedTexts.join("\n\n") + "\n\n";
        parentSource.insertText(insertPosition, textToInsert);
      }
    }
  }

  private isExpressionStatic(node: any, component: any): boolean {
    const componentScopeBindings = new Set(
      component.getLocals().map((l: any) => l.getName()),
    );
    const identifiers = node.getDescendantsOfKind(SyntaxKind.Identifier);

    for (const ident of identifiers) {
      if (componentScopeBindings.has(ident.getText())) {
        return false; // Depends on state, props, or local hooks
      }
    }
    return true;
  }

  private memoizeReactiveClosures(
    component: any,
    body: Block,
    unstableProps: string,
  ): void {
    const arrowFunctions = body.getDescendantsOfKind(SyntaxKind.ArrowFunction);

    for (const fn of arrowFunctions) {
      const parentVar = fn.getFirstAncestorByKind(
        SyntaxKind.VariableDeclaration,
      );
      if (parentVar) {
        const varName = parentVar.getName();
        if (unstableProps.includes(varName)) {
          const dependencies = this.resolveReactiveDependencies(fn, component);
          const originalBody = fn.getBody().getText();
          const params = fn
            .getParameters()
            .map((p: any) => p.getText())
            .join(", ");

          parentVar.setInitializer(
            `useCallback((${params}) => ${originalBody}, [${dependencies.join(", ")}])`,
          );
        }
      }
    }
  }

  private resolveReactiveDependencies(node: any, component: any): string[] {
    const componentScopeBindings = new Set(
      component.getLocals().map((l: any) => l.getName()),
    );
    const identifiers = node.getDescendantsOfKind(SyntaxKind.Identifier);
    const resolvedDeps = new Set<string>();

    for (const ident of identifiers) {
      const name = ident.getText();
      if (
        componentScopeBindings.has(name) &&
        name !== "useCallback" &&
        name !== "useMemo"
      ) {
        resolvedDeps.add(name);
      }
    }
    return Array.from(resolvedDeps);
  }

  private applyMemoizationWrapper(sourceFile: any, name: string): void {
    const exportAssignment = sourceFile.getExportAssignment(
      (exp: any) => exp.getExpression().getText() === name,
    );
    if (exportAssignment) {
      exportAssignment.setExpression(`React.memo(${name})`);
      return;
    }

    const varDecl = sourceFile.getVariableDeclaration(name);
    if (varDecl && varDecl.isExported()) {
      const init = varDecl.getInitializer();
      if (init) {
        varDecl.setInitializer(`React.memo(${init.getText()})`);
      }
    }
  }
}
