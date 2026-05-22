export interface CascadeNode {
  id: string;
  name: string;
  renderDuration: number;
  triggerSource:
    | "CONTEXT"
    | "STORE_SUBSCRIPTION"
    | "PROPS_INVALIDATION"
    | "STATE_CHANGE";
  depth: number;
  children: CascadeNode[];
}

export class DynamicSVGGenerator {
  public static generateRenderCascade(
    root: CascadeNode,
    width = 900,
    rowHeight = 70,
  ): string {
    let lines = "";
    let nodes = "";

    const draw = (
      node: CascadeNode,
      xOffset: number,
      parentX?: number,
      parentY?: number,
    ) => {
      const y = node.depth * rowHeight + 50;
      const x = xOffset + 120;

      if (parentX !== undefined && parentY !== undefined) {
        // Render bezier connecting curve
        lines += `<path d="M ${parentX} ${parentY} C ${parentX} ${(parentY + y) / 2}, ${x} ${(parentY + y) / 2}, ${x} ${y}" fill="none" stroke="#475569" stroke-width="2" stroke-dasharray="3"/>\n`;
      }

      // Assign colors based on the trigger source
      const colorMap = {
        CONTEXT: "#3b82f6", // Ocean Blue
        STORE_SUBSCRIPTION: "#f59e0b", // Amber Orange
        PROPS_INVALIDATION: "#ef4444", // Crimson Red
        STATE_CHANGE: "#10b981", // Emerald Green
      };
      const color = colorMap[node.triggerSource] || "#64748b";

      nodes += `
        <g transform="translate(${x - 85}, ${y - 20})">
          <rect width="170" height="42" rx="6" fill="${color}" stroke="#1e293b" stroke-width="2"/>
          <text x="85" y="16" fill="#ffffff" font-size="10" font-family="monospace" text-anchor="middle" font-weight="bold">
            ${node.name}
          </text>
          <text x="85" y="32" fill="#e2e8f0" font-size="8" font-family="monospace" text-anchor="middle">
            ${node.renderDuration.toFixed(2)}ms | ${node.triggerSource}
          </text>
        </g>\n`;

      let siblingIndex = 0;
      for (const child of node.children) {
        draw(child, xOffset + siblingIndex * 190, x, y + 22);
        siblingIndex++;
      }
    };

    draw(root, 50);

    // Calculate dynamic height based on tree depth
    const maxDepth = this.getMaxDepth(root);
    const calculatedHeight = Math.max(rowHeight * (maxDepth + 1) + 100, 300);

    return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${calculatedHeight}" width="100%" height="100%" style="background-color: #0f172a;">
  <rect width="100%" height="100%" fill="#0f172a"/>
  <text x="20" y="25" fill="#f8fafc" font-size="14" font-family="monospace" font-weight="bold">
    React Fiber State Cascade &amp; Invalidation Ripple Visualizer
  </text>
  ${lines}
  ${nodes}
</svg>`;
  }

  private static getMaxDepth(node: CascadeNode): number {
    if (node.children.length === 0) return node.depth;
    return Math.max(...node.children.map((c) => this.getMaxDepth(c)));
  }
}
