import type {TreeNode} from "../tree-description";
import type {Json, JsonObject} from "./loader-utils";
import {forceToString, formatMetric, hasOwnProperty, tryToString} from "./loader-utils";
import type {ConversionState, NodeRenderingConfig} from "./tree-postprocessing";

export type PlanNodeType = "operator" | "expression";

export interface AdaptiveTreeConfig {
    getRenderingConfig(
        nodeType: PlanNodeType,
        tag: string,
        rawNode: JsonObject,
        properties: Map<string, string>,
    ): NodeRenderingConfig;
    alwaysPropertyKeys: string[];
    fixedChildOrder: string[];
    getDebugName?(rawNode: JsonObject): string | undefined;
    shouldExpandChild?(rawNode: JsonObject, key: string): boolean | undefined;
    shouldFlattenChild?(rawNode: JsonObject, key: string): boolean | undefined;
    isErrored?(rawNode: JsonObject, metadata: Map<string, string>): boolean;
    getExecutionTime?(rawNode: JsonObject): number | undefined;
    getEstimatedCardinality?(rawNode: JsonObject): number | undefined;
    getActualCardinality?(rawNode: JsonObject): number | undefined;
}

function isTaggedObject(value: Json, key: PlanNodeType): value is JsonObject {
    return typeof value === "object" && !Array.isArray(value) && value !== null && hasOwnProperty(value, key);
}

function containsOperator(value: Json): boolean {
    while (Array.isArray(value) && value.length > 0) {
        value = value[0];
    }
    return isTaggedObject(value, "operator");
}

function shouldExpandChild(rawNode: JsonObject, key: string, config: AdaptiveTreeConfig): boolean {
    const configured = config.shouldExpandChild?.(rawNode, key);
    if (configured !== undefined) {
        return configured;
    }
    return hasOwnProperty(rawNode, "operator") && containsOperator(rawNode[key]);
}

function orderedKeys(rawNode: JsonObject, nodeType: PlanNodeType | undefined, config: AdaptiveTreeConfig): string[] {
    return Object.getOwnPropertyNames(rawNode)
        .filter((key) => key !== nodeType && !config.alwaysPropertyKeys.includes(key))
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

function appendChild(target: TreeNode[], converted: TreeNode | TreeNode[], key: string, flatten: boolean): void {
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
        target.push({name: key, collapsedChildren: converted});
    } else if (!converted.name) {
        converted.name = key;
        target.push(converted);
    } else {
        target.push({name: key, children: [converted]});
    }
}

function classifyNode(rawNode: JsonObject): {nodeType?: PlanNodeType; nodeTag?: string} {
    for (const nodeType of ["operator", "expression"] as const) {
        if (!hasOwnProperty(rawNode, nodeType)) {
            continue;
        }
        const nodeTag = tryToString(rawNode[nodeType]);
        if (nodeTag !== undefined) {
            return {nodeType, nodeTag};
        }
        break;
    }
    return {};
}

export function convertAdaptiveJsonNode(
    rawNode: Json,
    parentKey: string,
    state: ConversionState,
    config: AdaptiveTreeConfig,
    metadata: Map<string, string>,
): TreeNode | TreeNode[] {
    const scalar = tryToString(rawNode);
    if (scalar !== undefined) {
        return {name: scalar};
    }

    if (Array.isArray(rawNode)) {
        return rawNode.map((value, index) => {
            const name = `${parentKey}.${index}`;
            const converted = convertAdaptiveJsonNode(value, name, state, config, metadata);
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
    const {nodeType, nodeTag} = classifyNode(rawNode);

    for (const key of config.alwaysPropertyKeys) {
        if (hasOwnProperty(rawNode, key)) {
            properties.set(key, forceToString(rawNode[key]));
        }
    }

    for (const key of orderedKeys(rawNode, nodeType, config)) {
        const value = tryToString(rawNode[key]);
        if (value !== undefined) {
            properties.set(key, value);
            continue;
        }

        const target = shouldExpandChild(rawNode, key, config) ? expandedChildren : collapsedChildren;
        const converted = convertAdaptiveJsonNode(rawNode[key], key, state, config, metadata);
        const configuredFlatten = config.shouldFlattenChild?.(rawNode, key);
        appendChild(target, converted, key, configuredFlatten ?? config.fixedChildOrder.includes(key));
    }

    const renderingConfig =
        nodeType !== undefined && nodeTag !== undefined ? config.getRenderingConfig(nodeType, nodeTag, rawNode, properties) : {};
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
        expandedByDefault: nodeType !== "operator" && expandedChildren.length === 0,
    };

    if (config.isErrored?.(rawNode, metadata)) {
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
