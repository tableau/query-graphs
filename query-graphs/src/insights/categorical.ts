import type {TreeNode} from "../tree-description";
import {allChildren, visitTreeNodes} from "../tree-description";

export interface CategoricalInsightDefinition {
    id: string;
    title: string;
    where: {property: string; equals: string};
    groupBy: string;
}

export interface CategoricalInsightCategory {
    value: string;
    nodes: readonly TreeNode[];
}

export function computeCategoricalInsight(root: TreeNode, definition: CategoricalInsightDefinition): CategoricalInsightCategory[] {
    const groups = new Map<string, TreeNode[]>();
    visitTreeNodes(
        root,
        (node) => {
            if (node.properties?.get(definition.where.property) !== definition.where.equals) return;
            const value = node.properties?.get(definition.groupBy);
            if (value === undefined || value === "") return;
            const nodes = groups.get(value) ?? [];
            nodes.push(node);
            groups.set(value, nodes);
        },
        allChildren,
    );
    return [...groups]
        .map(([value, nodes]) => ({value, nodes}))
        .sort((a, b) => b.nodes.length - a.nodes.length || a.value.localeCompare(b.value));
}
