import {getScalarProperty} from "../loaders/loader-utils";
import type {TreeNode} from "../tree-description";
import {allChildren, visitTreeNodes} from "../tree-description";

/** Describes a category list derived from a property on matching plan nodes. */
export interface CategoricalInsightDefinition {
    /** Stable identifier used to distinguish this insight from other definitions. */
    id: string;
    /** User-facing heading for the category list. */
    title: string;
    /** Equality predicate selecting the nodes included in the category list. */
    where: {property: string; equals: string};
    /** Property whose distinct values form the categories. */
    groupBy: string;
}

/** One distinct property value and all matching plan nodes that have that value. */
export interface CategoricalInsightCategory {
    /** Property value displayed as the category label. */
    value: string;
    /** Matching nodes included in the category count and highlight interaction. */
    nodes: readonly TreeNode[];
}

export function computeCategoricalInsight(root: TreeNode, definition: CategoricalInsightDefinition): CategoricalInsightCategory[] {
    const groups = new Map<string, TreeNode[]>();
    visitTreeNodes(
        root,
        (node) => {
            if (getScalarProperty(node.properties, definition.where.property) !== definition.where.equals) return;
            const value = getScalarProperty(node.properties, definition.groupBy);
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
