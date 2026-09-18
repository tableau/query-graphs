/**
 * Configurable JSON-to-tree conversion shared by the generic JSON loader and
 * loaders that understand particular JSON plan formats.
 *
 * The baseline conversion is gracefully degrading: scalar object members
 * become tooltip properties, while nested objects and arrays remain visible as
 * tree nodes. Format loaders decorate that baseline through configuration; they
 * can recognize tagged nodes, choose names and icons, order or flatten children,
 * collapse auxiliary data, and extract metrics and crosslinks. Unknown fields
 * continue through the baseline conversion instead of being discarded.
 */

import type {IconName, TreeNode} from "../tree-description";
import type {Json, JsonObject} from "./loader-utils";
import {forceToString, formatMetric, hasOwnProperty, tryToString} from "./loader-utils";
import type {UnresolvedCrosslink} from "./tree-postprocessing";
import {InvalidPlanError} from "./types";

export interface NodeRenderingConfig {
    /** Use this converted scalar property as the node's display name. */
    displayNameKey?: string;
    /** Treat this converted scalar property as the target ID of a crosslink. */
    crosslinkSourceKey?: string;
    icon?: IconName;
}

/** Accumulators produced during recursion for format-specific post-processing. */
export interface DecoratedJsonTreeState {
    crosslinks: UnresolvedCrosslink[];
    edgeWidths: {node: TreeNode; width: number}[];
    nodeColorValues: {node: TreeNode; value: number}[];
    metadata: Map<string, string>;
}

export function createDecoratedJsonTreeState(): DecoratedJsonTreeState {
    return {crosslinks: [], edgeWidths: [], nodeColorValues: [], metadata: new Map()};
}

export interface DecoratedJsonTreeConfig {
    /** Object keys whose scalar values identify a semantic node type, in precedence order. */
    nodeTypeKeys: readonly string[];
    /** Show these children first and omit their otherwise redundant key wrapper. */
    fixedChildOrder: readonly string[];
    /** Keep these values in the tooltip even when they are objects or arrays. */
    alwaysPropertyKeys: readonly string[];
    /** Choose presentation details for an object recognized by one of `nodeTypeKeys`. */
    getRenderingConfig(nodeTypeKey: string, tag: string, rawNode: JsonObject): NodeRenderingConfig;
    /** Override the usual property, tag, or parent-key-derived display name. */
    getDisplayName?(rawNode: JsonObject): string | undefined;
    /** Identify the target of a crosslink originating at this object. */
    getCrosslinkTarget?(rawNode: JsonObject): string | undefined;
    /** Put a nested value in `collapsedChildren` instead of `children`. */
    shouldCollapseChild?(rawNode: JsonObject, key: string, child: Json): boolean;
    /** Open a node's `collapsedChildren` initially when it has no ordinary children. */
    shouldExpandCollapsedChildren?(rawNode: JsonObject, nodeTypeKey: string | undefined): boolean;
    /** Mark a converted node as the failure location. */
    isErrored?(rawNode: JsonObject, metadata: Map<string, string>): boolean;
    /** Collect a numeric value for relative node coloring after conversion. */
    getNodeColorValue?(rawNode: JsonObject): number | undefined;
    /** Label and size the incoming edge using the estimated cardinality. */
    getEstimatedCardinality?(rawNode: JsonObject): number | undefined;
    /** Prefer the actual cardinality when available and compare it with the estimate. */
    getActualCardinality?(rawNode: JsonObject): number | undefined;
}

function orderedKeys(rawNode: JsonObject, nodeTypeKey: string | undefined, config: DecoratedJsonTreeConfig): string[] {
    // Enforce a format-specific order for structural children (for example,
    // "left" before "right") and display all remaining keys alphabetically.
    return Object.getOwnPropertyNames(rawNode)
        .filter((key) => key !== nodeTypeKey && !config.alwaysPropertyKeys.includes(key))
        .sort((left, right) => {
            const leftIndex = config.fixedChildOrder.indexOf(left);
            const rightIndex = config.fixedChildOrder.indexOf(right);
            if (leftIndex !== -1 || rightIndex !== -1) {
                return (leftIndex === -1 ? Infinity : leftIndex) - (rightIndex === -1 ? Infinity : rightIndex);
            }
            if (left < right) return -1;
            if (left > right) return 1;
            return 0;
        });
}

function appendChild(target: TreeNode[], converted: TreeNode | TreeNode[], key: string, flatten: boolean, collapse: boolean): void {
    if (flatten) {
        if (Array.isArray(converted)) {
            // Flatten arrays for structural children such as operator inputs.
            target.push(...converted);
        } else {
            // The key itself is not inserted as a redundant intermediate node.
            if (!converted.name) {
                converted.name = key;
            }
            target.push(converted);
        }
    } else if (Array.isArray(converted)) {
        // Collapsed arrays keep their elements collapsed as well: arrays can be large.
        target.push(collapse ? {name: key, collapsedChildren: converted} : {name: key, children: converted});
    } else if (!converted.name) {
        // Give an unnamed child its object key as a display name.
        converted.name = key;
        target.push(converted);
    } else {
        // Preserve both names by inserting the key as an intermediate node.
        target.push({name: key, children: [converted]});
    }
}

function classifyNode(rawNode: JsonObject, config: DecoratedJsonTreeConfig): {nodeTypeKey?: string; nodeTag?: string} {
    for (const nodeTypeKey of config.nodeTypeKeys) {
        if (!hasOwnProperty(rawNode, nodeTypeKey)) {
            continue;
        }
        const nodeTag = tryToString(rawNode[nodeTypeKey]);
        if (nodeTag !== undefined) {
            return {nodeTypeKey, nodeTag};
        }
        break;
    }
    return {};
}

function convertDecoratedJsonValue(
    rawNode: Json,
    parentKey: string,
    state: DecoratedJsonTreeState,
    config: DecoratedJsonTreeConfig,
): TreeNode | TreeNode[] {
    const scalar = tryToString(rawNode);
    if (scalar !== undefined) {
        return {name: scalar};
    }

    if (Array.isArray(rawNode)) {
        return rawNode.map((value, index) => {
            const name = `${parentKey}.${index}`;
            const converted = convertDecoratedJsonValue(value, name, state, config);
            const node = Array.isArray(converted) ? {children: converted} : converted;
            if (!node.name) {
                node.name = name;
            }
            return node;
        });
    }

    if (typeof rawNode !== "object" || rawNode === null) {
        throw new InvalidPlanError();
    }

    const expandedChildren: TreeNode[] = [];
    const collapsedChildren: TreeNode[] = [];
    const properties = new Map<string, string>();
    // Classify semantic nodes before processing their remaining fields so the
    // identifying key itself does not also appear as a tooltip property.
    const {nodeTypeKey, nodeTag} = classifyNode(rawNode, config);

    // Some complex values are more useful as tooltip properties than subtrees.
    for (const key of config.alwaysPropertyKeys) {
        if (hasOwnProperty(rawNode, key)) {
            properties.set(key, forceToString(rawNode[key]));
        }
    }

    // Display remaining fields adaptively: scalars become tooltip properties,
    // while objects and arrays remain visible in the tree.
    for (const key of orderedKeys(rawNode, nodeTypeKey, config)) {
        const value = tryToString(rawNode[key]);
        if (value !== undefined) {
            properties.set(key, value);
            continue;
        }

        // Format loaders decide which nested structures are initially visible.
        const collapse = config.shouldCollapseChild?.(rawNode, key, rawNode[key]) ?? false;
        const target = collapse ? collapsedChildren : expandedChildren;
        const converted = convertDecoratedJsonValue(rawNode[key], key, state, config);
        appendChild(target, converted, key, config.fixedChildOrder.includes(key), collapse);
    }

    // Determine format-specific rendering and the most meaningful available name.
    const renderingConfig =
        nodeTypeKey !== undefined && nodeTag !== undefined ? config.getRenderingConfig(nodeTypeKey, nodeTag, rawNode) : {};
    const displayName =
        config.getDisplayName?.(rawNode) ??
        (renderingConfig.displayNameKey === undefined ? undefined : properties.get(renderingConfig.displayNameKey)) ??
        properties.get("name") ??
        nodeTag ??
        "";
    // Build the converted node before collecting decorations that reference it.
    const convertedNode: TreeNode = {
        name: displayName,
        icon: renderingConfig.icon,
        properties,
        children: expandedChildren,
        collapsedChildren,
        expandedByDefault: expandedChildren.length === 0 && (config.shouldExpandCollapsedChildren?.(rawNode, nodeTypeKey) ?? true),
    };

    if (config.isErrored?.(rawNode, state.metadata)) {
        // Highlight the node where execution failed.
        convertedNode.iconColor = "red";
    }

    // Collect values that require whole-tree normalization after conversion.
    const nodeColorValue = config.getNodeColorValue?.(rawNode);
    if (nodeColorValue !== undefined) {
        state.nodeColorValues.push({node: convertedNode, value: nodeColorValue});
    }

    // Display cardinality on incoming edges and collect it for relative edge sizing.
    const estimatedCardinality = config.getEstimatedCardinality?.(rawNode);
    if (estimatedCardinality !== undefined) {
        const actualCardinality = config.getActualCardinality?.(rawNode);
        const edgeWidth = actualCardinality ?? estimatedCardinality;
        state.edgeWidths.push({node: convertedNode, width: edgeWidth});
        convertedNode.edgeLabel =
            actualCardinality === undefined
                ? formatMetric(estimatedCardinality)
                : `${formatMetric(actualCardinality)}/${formatMetric(estimatedCardinality)}`;
        // Highlight estimates that differ from the actual cardinality by more than one order of magnitude.
        if (
            actualCardinality !== undefined &&
            (estimatedCardinality > actualCardinality * 10 || actualCardinality > estimatedCardinality * 10)
        ) {
            convertedNode.edgeClass = "qg-label-highlighted";
        }
    }

    // Record crosslinks now and resolve their target nodes after the full tree exists.
    const targetId =
        config.getCrosslinkTarget?.(rawNode) ??
        (renderingConfig.crosslinkSourceKey === undefined ? undefined : properties.get(renderingConfig.crosslinkSourceKey));
    if (targetId !== undefined) {
        state.crosslinks.push({source: convertedNode, targetId});
    }

    return convertedNode;
}

export function convertDecoratedJsonNode(
    rawNode: Json,
    rootName: string,
    state: DecoratedJsonTreeState,
    config: DecoratedJsonTreeConfig,
): TreeNode {
    // Recursive array conversion naturally produces sibling nodes. At the API
    // boundary, wrap them so every caller receives exactly one tree root.
    const converted = convertDecoratedJsonValue(rawNode, rootName, state, config);
    const root = Array.isArray(converted) ? {name: rootName, children: converted} : converted;
    if (!root.name) {
        root.name = rootName;
    }
    return root;
}
