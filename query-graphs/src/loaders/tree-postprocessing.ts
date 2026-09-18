import type {Crosslink, TreeNode} from "../tree-description";
import {allChildren, visitTreeNodes} from "../tree-description";

export interface UnresolvedCrosslink {
    source: TreeNode;
    targetId: string;
}

export function buildIdMap(root: TreeNode, key: string): Map<string, TreeNode> {
    const idMap = new Map<string, TreeNode>();
    visitTreeNodes(
        root,
        (node) => {
            const id = node.properties?.get(key);
            if (id !== undefined) {
                idMap.set(id, node);
            }
        },
        allChildren,
    );
    return idMap;
}

export function resolveCrosslinks(crosslinks: UnresolvedCrosslink[], operatorsById: Map<string, TreeNode>): Crosslink[] {
    const resolved: Crosslink[] = [];
    for (const link of crosslinks) {
        const target = operatorsById.get(link.targetId);
        if (target !== undefined) {
            resolved.push({source: link.source, target});
        }
    }
    return resolved;
}

export function colorRelativeExecutionTime(
    runtimes: {node: TreeNode; time: number}[],
    totalTime = runtimes.reduce((sum, runtime) => sum + runtime.time, 0),
): void {
    for (const runtime of runtimes) {
        const relativeExecutionRatio = runtime.time / totalTime;
        const lightness = (95 + (72 - 95) * relativeExecutionRatio).toFixed(3);
        runtime.node.nodeColor = relativeExecutionRatio >= 0.05 ? `hsl(309, 84%, ${lightness}%)` : undefined;
    }
}

export function setEdgeWidths(edgeWidths: {node: TreeNode; width: number}[]): void {
    const maxWidth = edgeWidths.reduce((maximum, edge) => Math.max(maximum, edge.width), 0);
    const minWidth = edgeWidths.reduce((minimum, edge) => Math.min(minimum, edge.width), Infinity);
    if (minWidth === maxWidth) {
        return;
    }
    const factor = Math.max(maxWidth - minWidth, minWidth);
    for (const edge of edgeWidths) {
        edge.node.edgeWidth = (edge.width - minWidth) / factor;
    }
}
