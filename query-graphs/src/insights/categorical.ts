import type {TreeNode} from "../tree-description";
import {allChildren, visitTreeNodes} from "../tree-description";
import {forceToString} from "../loaders/loader-utils";
import type {Predicate, PropertyPath} from "./property-query";
import {accessPropertyPath, evaluatePredicate} from "./property-query";

/** Each selected node follows exactly one path through the configured levels. */
export interface CategoricalInsightLevel {
    /** Property paths checked in order for a category label. */
    valueSourceAlternatives: readonly PropertyPath[];
    /** Label used when no value source yields a category label. */
    fallbackValue: string;
    /** Default grouping level below this one. */
    next?: CategoricalInsightLevel;
    /** Grouping levels for specific labels, overriding next. */
    nextByValue?: Readonly<Record<string, CategoricalInsightLevel>>;
}

/** Describes a category list derived from matching plan nodes. A flat list has one grouping level. */
export interface CategoricalInsightDefinition {
    /** Stable identifier used to distinguish this insight from other definitions. */
    id: string;
    /** User-facing heading for the category list. */
    title: string;
    /** Predicate selecting nodes included in this insight. */
    where: Predicate;
    /** Category levels through which each selected node is grouped. */
    groupBy: CategoricalInsightLevel;
}

/** One distinct category value and all plan nodes grouped under it. */
export interface CategoricalInsightCategory {
    /** Value displayed as the category label. */
    value: string;
    /** Matching nodes included in the category count and highlight interaction. */
    nodes: readonly TreeNode[];
    /** Subcategories partitioning these same matching nodes, if configured. */
    children: readonly CategoricalInsightCategory[];
}

function groupingPath(node: TreeNode, level: CategoricalInsightLevel): string[] {
    const value = level.valueSourceAlternatives
        .map((source) => accessPropertyPath(node, source))
        .find((candidate) => candidate !== undefined);
    const label = value === undefined ? level.fallbackValue : forceToString(value);
    const next = level.nextByValue && Object.hasOwn(level.nextByValue, label) ? level.nextByValue[label] : level.next;
    return next ? [label, ...groupingPath(node, next)] : [label];
}

export function computeCategoricalInsight(root: TreeNode, definition: CategoricalInsightDefinition): CategoricalInsightCategory[] {
    interface CategoryBuilder {
        nodes: TreeNode[];
        children: Map<string, CategoryBuilder>;
    }

    const groups = new Map<string, CategoryBuilder>();
    // Count the complete plan tree, including nodes hidden by collapsed graph subtrees.
    // Each node follows one category path, so every parent's count equals the sum of its children.
    visitTreeNodes(
        root,
        (node) => {
            if (!evaluatePredicate(node, definition.where)) return;
            let level = groups;
            for (const value of groupingPath(node, definition.groupBy)) {
                let category = level.get(value);
                if (!category) {
                    category = {nodes: [], children: new Map()};
                    level.set(value, category);
                }
                category.nodes.push(node);
                level = category.children;
            }
        },
        allChildren,
    );
    // Keep the most frequent categories first, with stable alphabetical ordering for ties.
    const finish = (level: Map<string, CategoryBuilder>): CategoricalInsightCategory[] =>
        [...level]
            .map(([value, {nodes, children}]) => ({value, nodes, children: finish(children)}))
            .sort((a, b) => b.nodes.length - a.nodes.length || a.value.localeCompare(b.value));
    return finish(groups);
}
