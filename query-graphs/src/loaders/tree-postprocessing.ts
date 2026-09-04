import type {Crosslink, IconName, TreeNode} from "../tree-description";
import {allChildren, visitTreeNodes} from "../tree-description";
import type {Json, JsonObject} from "./loader-utils";

export interface NodeRenderingConfig {
    displayNameKey?: string;
    crosslinkSourceKey?: string;
    icon?: IconName;
}

export interface UnresolvedCrosslink {
    source: TreeNode;
    targetId: string;
}

export interface ConversionState {
    crosslinks: UnresolvedCrosslink[];
    edgeWidths: {node: TreeNode; width: number}[];
    runtimes: {node: TreeNode; time: number}[];
}

export function newConversionState(): ConversionState {
    return {crosslinks: [], edgeWidths: [], runtimes: []};
}

export function buildIdMap(root: TreeNode, keys: string[]): Map<string, TreeNode> {
    const idMap = new Map<string, TreeNode>();
    visitTreeNodes(
        root,
        (node) => {
            for (const key of keys) {
                const id = node.properties?.get(key);
                if (id !== undefined) {
                    idMap.set(id, node);
                    break;
                }
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

const PIPELINE_PALETTE = [
    "#4e79a7",
    "#f28e2b",
    "#59a14f",
    "#b6992d",
    "#499894",
    "#e15759",
    "#79706e",
    "#d37295",
    "#b07aa1",
    "#9d7660",
    "#a0cbe8",
    "#ffbe7d",
    "#8cd17d",
    "#f1ce63",
    "#86bcb6",
    "#ff9d9a",
    "#bab0ac",
    "#fabfd2",
    "#d4a6c8",
    "#d7b5a6",
];

function pipelineColor(index: number): string {
    return PIPELINE_PALETTE[index % PIPELINE_PALETTE.length];
}

export interface RawPipeline {
    id: number;
    operatorIds: number[];
    duration?: number;
}

export function parsePipelines(
    pipelinesJson: Json,
    extract: (entry: JsonObject, index: number) => RawPipeline | undefined,
): RawPipeline[] {
    if (!Array.isArray(pipelinesJson)) {
        return [];
    }
    const pipelines: RawPipeline[] = [];
    for (const [index, entry] of pipelinesJson.entries()) {
        if (typeof entry !== "object" || Array.isArray(entry) || entry === null) {
            continue;
        }
        const pipeline = extract(entry, index);
        if (pipeline !== undefined) {
            pipelines.push(pipeline);
        }
    }
    return pipelines;
}

export function assignPipelineColors(
    root: TreeNode,
    operatorsById: Map<string, TreeNode>,
    pipelines: RawPipeline[],
    crosslinks: Crosslink[],
): void {
    interface ResolvedPipeline {
        id: number;
        nodes: TreeNode[];
        color: string;
    }

    const resolved: ResolvedPipeline[] = pipelines.map((pipeline) => ({
        id: pipeline.id,
        nodes: pipeline.operatorIds
            .map((operatorId) => operatorsById.get(operatorId.toString()))
            .filter((node) => node !== undefined),
        color: "",
    }));
    const nodePipelines = new Map<TreeNode, ResolvedPipeline[]>();
    for (const pipeline of resolved) {
        for (const node of pipeline.nodes) {
            const nodeEntries = nodePipelines.get(node) ?? [];
            nodeEntries.push(pipeline);
            nodePipelines.set(node, nodeEntries);
        }
    }

    const crosslinkChildren = new Map<TreeNode, TreeNode[]>();
    for (const link of crosslinks) {
        const targets = crosslinkChildren.get(link.source) ?? [];
        targets.push(link.target);
        crosslinkChildren.set(link.source, targets);
    }

    let nextColor = 0;
    const walk = (node: TreeNode, parent: TreeNode | undefined): void => {
        const nodeEntries = nodePipelines.get(node);
        if (nodeEntries !== undefined) {
            for (const pipeline of nodeEntries) {
                if (pipeline.color === "") {
                    pipeline.color = pipelineColor(nextColor++);
                }
            }

            const childOrder = new Map<number, number>();
            const children = [...allChildren(node), ...(crosslinkChildren.get(node) ?? [])];
            children.forEach((child, index) => {
                for (const pipeline of nodePipelines.get(child) ?? []) {
                    if (!childOrder.has(pipeline.id)) {
                        childOrder.set(pipeline.id, index);
                    }
                }
            });
            const ordered = (entries: ResolvedPipeline[]): ResolvedPipeline[] =>
                [...entries].sort((left, right) => (childOrder.get(left.id) ?? Infinity) - (childOrder.get(right.id) ?? Infinity));

            let outgoing: ResolvedPipeline[] = [];
            if (parent !== undefined) {
                const parentPipelineIds = new Set((nodePipelines.get(parent) ?? []).map((pipeline) => pipeline.id));
                outgoing = nodeEntries.filter((pipeline) => parentPipelineIds.has(pipeline.id));
            }
            node.barsAbove = ordered(outgoing).map((pipeline) => pipeline.color);
            if (outgoing.length > 0) {
                node.edgeColors = node.barsAbove;
            }

            const incoming = nodeEntries.filter((pipeline) => childOrder.has(pipeline.id));
            node.barsBelow = ordered(incoming).map((pipeline) => pipeline.color);

            if (!node.iconColor) {
                const entries = ordered(nodeEntries);
                node.iconColor = entries[entries.length - 1].color;
            }
        }
        for (const child of allChildren(node)) {
            walk(child, node);
        }
    };
    walk(root, undefined);
}
