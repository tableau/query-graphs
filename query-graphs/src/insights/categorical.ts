import type {TreeNode} from "../tree-description";
import {allChildren, visitTreeNodes} from "../tree-description";

/** A node is selected when any configured property is present or equals its required value. */
export interface CategoricalInsightPredicate {
    property: string;
    equals?: string;
}

/** Candidate labels are checked in order; JSON paths address serialized property values. */
export type CategoricalInsightValueSource = {property: string; jsonPath?: readonly string[]} | {nodeName: true};

/** Each selected node follows exactly one path through the configured levels. */
export interface CategoricalInsightLevel {
    valueSourceAlternatives: readonly CategoricalInsightValueSource[];
    fallbackValue: string;
    next?: CategoricalInsightLevel;
    nextByValue?: Readonly<Record<string, CategoricalInsightLevel>>;
}

/** A flat category list is a one-level categorical insight. */
export interface CategoricalInsightDefinition {
    id: string;
    title: string;
    /** Alternatives are ORed; omitting where selects every node. */
    where?: readonly [CategoricalInsightPredicate, ...CategoricalInsightPredicate[]];
    groupBy: CategoricalInsightLevel;
}

export interface CategoricalInsightCategory {
    value: string;
    nodes: readonly TreeNode[];
    children: readonly CategoricalInsightCategory[];
}

interface CategoryBuilder {
    nodes: TreeNode[];
    children: Map<string, CategoryBuilder>;
}

function readValue(node: TreeNode, source: CategoricalInsightValueSource): string | undefined {
    let value: unknown = "nodeName" in source ? node.name : node.properties?.get(source.property);
    if ("jsonPath" in source && source.jsonPath && typeof value === "string") {
        try {
            value = JSON.parse(value);
            for (const key of source.jsonPath) {
                if (typeof value !== "object" || value === null || !(key in value)) return undefined;
                value = (value as Record<string, unknown>)[key];
            }
        } catch {
            return undefined;
        }
    }
    return typeof value === "string" && value !== "" ? value : undefined;
}

function groupingPath(node: TreeNode, level: CategoricalInsightLevel): string[] {
    const label =
        level.valueSourceAlternatives.map((source) => readValue(node, source)).find((candidate) => candidate !== undefined) ??
        level.fallbackValue;
    const next = level.nextByValue && Object.hasOwn(level.nextByValue, label) ? level.nextByValue[label] : level.next;
    return next ? [label, ...groupingPath(node, next)] : [label];
}

export function computeCategoricalInsight(root: TreeNode, definition: CategoricalInsightDefinition): CategoricalInsightCategory[] {
    const groups = new Map<string, CategoryBuilder>();
    const seen = new Set<TreeNode>();
    // Count the complete plan tree, including nodes hidden by collapsed graph subtrees.
    // Each node follows one category path, so every parent's count equals the sum of its children.
    visitTreeNodes(
        root,
        (node) => {
            if (seen.has(node)) return;
            seen.add(node);
            if (
                definition.where &&
                !definition.where.some(({property, equals}) =>
                    equals === undefined ? node.properties?.has(property) : node.properties?.get(property) === equals,
                )
            )
                return;
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
