import type {IconName, TreeNode} from "../tree-description";
import type {Json, JsonObject} from "./loader-utils";
import {forceToString, formatMetric, hasOwnProperty, tryToString} from "./loader-utils";
import type {UnresolvedCrosslink} from "./tree-postprocessing";

export interface NodeRenderingConfig {
    displayNameKey?: string;
    crosslinkSourceKey?: string;
    icon?: IconName;
}

export interface DecoratedJsonTreeState {
    crosslinks: UnresolvedCrosslink[];
    edgeWidths: {node: TreeNode; width: number}[];
    runtimes: {node: TreeNode; time: number}[];
    metadata: Map<string, string>;
}

export function createDecoratedJsonTreeState(): DecoratedJsonTreeState {
    return {crosslinks: [], edgeWidths: [], runtimes: [], metadata: new Map()};
}

export interface DecoratedJsonTreeConfig {
    getRenderingConfig(nodeTypeKey: string, tag: string, rawNode: JsonObject): NodeRenderingConfig;
    nodeTypeKeys: readonly string[];
    alwaysPropertyKeys: readonly string[];
    fixedChildOrder: readonly string[];
    getDebugName?(rawNode: JsonObject): string | undefined;
    shouldCollapseChild?(rawNode: JsonObject, key: string, child: Json): boolean;
    shouldExpandCollapsedChildren?(rawNode: JsonObject, nodeTypeKey: string | undefined): boolean;
    isErrored?(rawNode: JsonObject, metadata: Map<string, string>): boolean;
    getExecutionTime?(rawNode: JsonObject): number | undefined;
    getEstimatedCardinality?(rawNode: JsonObject): number | undefined;
    getActualCardinality?(rawNode: JsonObject): number | undefined;
}

function orderedKeys(rawNode: JsonObject, nodeTypeKey: string | undefined, config: DecoratedJsonTreeConfig): string[] {
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
            target.push(...converted);
        } else {
            if (!converted.name) {
                converted.name = key;
            }
            target.push(converted);
        }
    } else if (Array.isArray(converted)) {
        target.push(collapse ? {name: key, collapsedChildren: converted} : {name: key, children: converted});
    } else if (!converted.name) {
        converted.name = key;
        target.push(converted);
    } else {
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
        throw new Error("Invalid query plan");
    }

    const expandedChildren: TreeNode[] = [];
    const collapsedChildren: TreeNode[] = [];
    const properties = new Map<string, string>();
    const {nodeTypeKey, nodeTag} = classifyNode(rawNode, config);

    for (const key of config.alwaysPropertyKeys) {
        if (hasOwnProperty(rawNode, key)) {
            properties.set(key, forceToString(rawNode[key]));
        }
    }

    for (const key of orderedKeys(rawNode, nodeTypeKey, config)) {
        const value = tryToString(rawNode[key]);
        if (value !== undefined) {
            properties.set(key, value);
            continue;
        }

        const collapse = config.shouldCollapseChild?.(rawNode, key, rawNode[key]) ?? false;
        const target = collapse ? collapsedChildren : expandedChildren;
        const converted = convertDecoratedJsonValue(rawNode[key], key, state, config);
        appendChild(target, converted, key, config.fixedChildOrder.includes(key), collapse);
    }

    const renderingConfig =
        nodeTypeKey !== undefined && nodeTag !== undefined ? config.getRenderingConfig(nodeTypeKey, nodeTag, rawNode) : {};
    const displayName =
        config.getDebugName?.(rawNode) ??
        (renderingConfig.displayNameKey === undefined ? undefined : properties.get(renderingConfig.displayNameKey)) ??
        properties.get("name") ??
        nodeTag ??
        "";
    const convertedNode: TreeNode = {
        name: displayName,
        icon: renderingConfig.icon,
        properties,
        children: expandedChildren,
        collapsedChildren,
        expandedByDefault: expandedChildren.length === 0 && (config.shouldExpandCollapsedChildren?.(rawNode, nodeTypeKey) ?? true),
    };

    if (config.isErrored?.(rawNode, state.metadata)) {
        convertedNode.iconColor = "red";
    }

    const executionTime = config.getExecutionTime?.(rawNode);
    if (executionTime !== undefined) {
        state.runtimes.push({node: convertedNode, time: executionTime});
    }

    const estimatedCardinality = config.getEstimatedCardinality?.(rawNode);
    if (estimatedCardinality !== undefined) {
        const actualCardinality = config.getActualCardinality?.(rawNode);
        const edgeWidth = actualCardinality ?? estimatedCardinality;
        state.edgeWidths.push({node: convertedNode, width: edgeWidth});
        convertedNode.edgeLabel =
            actualCardinality === undefined
                ? formatMetric(estimatedCardinality)
                : `${formatMetric(actualCardinality)}/${formatMetric(estimatedCardinality)}`;
        if (
            actualCardinality !== undefined &&
            (estimatedCardinality > actualCardinality * 10 || actualCardinality > estimatedCardinality * 10)
        ) {
            convertedNode.edgeClass = "qg-label-highlighted";
        }
    }

    if (renderingConfig.crosslinkSourceKey !== undefined) {
        const targetId = properties.get(renderingConfig.crosslinkSourceKey);
        if (targetId !== undefined) {
            state.crosslinks.push({source: convertedNode, targetId});
        }
    }

    return convertedNode;
}

export function convertDecoratedJsonNode(
    rawNode: Json,
    rootName: string,
    state: DecoratedJsonTreeState,
    config: DecoratedJsonTreeConfig,
): TreeNode {
    const converted = convertDecoratedJsonValue(rawNode, rootName, state, config);
    return Array.isArray(converted) ? {name: rootName, children: converted} : converted;
}
