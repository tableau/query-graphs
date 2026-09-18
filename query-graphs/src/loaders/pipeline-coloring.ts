import type {Crosslink, TreeNode} from "../tree-description";
import {allChildren} from "../tree-description";

// A categorical color palette for execution pipelines (the Tableau 20 colors).
// The ten saturated base hues come first, then their lighter companions, so
// that adjacent pipelines never get near-identical shades (e.g. light-blue does
// not follow blue). Colors are assigned to pipelines left-to-right and rotate
// (index % length) once exhausted.
const PIPELINE_PALETTE = [
    // Base hues.
    "#4e79a7", // blue
    "#f28e2b", // orange
    "#59a14f", // green
    "#b6992d", // gold
    "#499894", // teal
    "#e15759", // red
    "#79706e", // gray
    "#d37295", // pink
    "#b07aa1", // purple
    "#9d7660", // brown
    // Lighter companions (only reached by wide plans).
    "#a0cbe8", // light blue
    "#ffbe7d", // light orange
    "#8cd17d", // light green
    "#f1ce63", // light gold
    "#86bcb6", // light teal
    "#ff9d9a", // light red
    "#bab0ac", // light gray
    "#fabfd2", // light pink
    "#d4a6c8", // light purple
    "#d7b5a6", // light brown
];

function pipelineColor(index: number): string {
    return PIPELINE_PALETTE[index % PIPELINE_PALETTE.length];
}

export interface ExecutionPipeline {
    id: number;
    nodes: TreeNode[];
}

// Color the per-node bars, edges and icons for the merged execution pipelines in one pre-order DFS, coloring each pipeline on first appearance so colors track tree position, not pipeline ids.
export function assignPipelineColors(root: TreeNode, pipelines: ExecutionPipeline[], crosslinks: Crosslink[]): void {
    interface ResolvedPipeline {
        id: number;
        nodes: TreeNode[];
        color: string;
    }

    const resolved: ResolvedPipeline[] = pipelines.map((pipeline) => ({
        ...pipeline,
        color: "",
    }));

    // Record, per tree node, every pipeline it belongs to (kept local: the
    // "pipeline" concept never leaks into the presentation model, which only
    // ever sees colors).
    const nodePipelines = new Map<TreeNode, ResolvedPipeline[]>();
    for (const pipeline of resolved) {
        for (const node of pipeline.nodes) {
            const nodeEntries = nodePipelines.get(node) ?? [];
            nodeEntries.push(pipeline);
            nodePipelines.set(node, nodeEntries);
        }
    }

    // A crosslink feeds data into its source like a child would (e.g. an explicit
    // scan reading a shared operator, or a magic join reading its magic side), but
    // it is not a tree child. Treat the crosslink target as an extra child so a
    // reader still gets the below-bar for the pipeline it reads through the link.
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
            // Color the pipelines appearing here for the first time.
            for (const pipeline of nodeEntries) {
                if (pipeline.color === "") {
                    pipeline.color = pipelineColor(nextColor++);
                }
            }

            // Order segments left-to-right by the position of the first child
            // that carries each pipeline, so the bars line up with the branches
            // below. Ties (several pipelines entering through the same child, or
            // pipelines with no child) keep their appearance order via the stable
            // sort.
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

            // Outgoing (above): pipelines shared with the parent. The root has no
            // parent, so it gets no bar above.
            let outgoing: ResolvedPipeline[] = [];
            if (parent !== undefined) {
                const parentPipelineIds = new Set((nodePipelines.get(parent) ?? []).map((pipeline) => pipeline.id));
                outgoing = nodeEntries.filter((pipeline) => parentPipelineIds.has(pipeline.id));
            }
            if (outgoing.length > 0) {
                node.barsAbove = ordered(outgoing).map((pipeline) => pipeline.color);
                node.edgeColors = node.barsAbove;
            }

            // Incoming (below): pipelines shared with an operator child. A leaf has
            // no operator child, so it gets no bar below.
            const incoming = nodeEntries.filter((pipeline) => childOrder.has(pipeline.id));
            if (incoming.length > 0) {
                node.barsBelow = ordered(incoming).map((pipeline) => pipeline.color);
            }

            // Tint the operator icon (and thereby the minimap) with the node's
            // right-most pipeline color, unless already colored (e.g. the red
            // error highlight, which takes precedence).
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
