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

export function colorRelativeNumber(
    nodeValues: {node: TreeNode; value: number}[],
    total = nodeValues.reduce((sum, entry) => sum + entry.value, 0),
): void {
    for (const entry of nodeValues) {
        const relativeValue = entry.value / total;
        entry.node.nodeColor = relativeHeatColor(relativeValue);
    }
}

export function relativeHeatColor(relativeValue: number): string | undefined {
    if (relativeValue < 0.05) return undefined;
    const opacity = (0.08 + 0.42 * Math.min(relativeValue, 1)).toFixed(3);
    return `hsl(309 84% 55% / ${opacity})`;
}

export function setRelativeEdgeWidths(edgeWidths: {node: TreeNode; width: number}[]): void {
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
