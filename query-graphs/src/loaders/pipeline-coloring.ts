import type {Crosslink, TreeNode} from "../tree-description";
import {allChildren} from "../tree-description";

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
