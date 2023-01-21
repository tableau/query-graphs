import * as d3flextree from "d3-flextree";
import * as d3hierarchy from "d3-hierarchy";

import { NodeDimensions } from "./useNodeSizes";
import * as treeDescription from "./tree-description";
import {TreeNode, TreeDescription, GraphOrientation} from "./tree-description";
import type {Edge, Node} from "reactflow";
import { assertNotNull } from "./loader-utils";

const MAX_DISPLAY_LENGTH = 15;
const FLEX_NODE_SIZE = 220;

type d3point = [number, number];

interface Orientation {
    nodesize: (maxLabelLength: number) => d3point;
    nodespacing: (a: d3hierarchy.HierarchyNode<TreeNode>, b: d3hierarchy.HierarchyNode<TreeNode>) => number;
}

// Orientation mapping
const orientations: {[k in GraphOrientation]: Orientation} = {
    "top-to-bottom": {
        nodesize: maxLabelLength => [maxLabelLength * 6, 45] as d3point,
        nodespacing: (a, b) => (a.parent === b.parent ? 0 : 0),
    },
    "right-to-left": {
        nodesize: maxLabelLength =>
            [11.2 /* table node diameter */ + 2, Math.max(90, maxLabelLength * 6 + 10 /* textdimensionoffset */)] as d3point,
        nodespacing: (a, b) => (a.parent === b.parent ? (a.data.nodeToggled && b.data.nodeToggled ? 0 : FLEX_NODE_SIZE / 3) : 0),
    },
    "bottom-to-top": {
        nodesize: maxLabelLength => [maxLabelLength * 6, 45] as d3point,
        nodespacing: (a, b) => (a.parent === b.parent ? 0 : 0),
    },
    "left-to-right": {
        nodesize: maxLabelLength =>
            [11.2 /* table node diameter */ + 2, Math.max(90, maxLabelLength * 6 + 10 /* textdimensionoffset */)] as d3point,
        nodespacing: (a, b) => (a.parent === b.parent ? (a.data.nodeToggled && b.data.nodeToggled ? 0 : FLEX_NODE_SIZE / 3) : 0),
    },
};

interface TreeLayout {
    nodes: Node[];
    edges: Edge[];
}

//
// Layout a tree
//
// Returns node and edge lists
export function layoutTree(treeData: TreeDescription, nodeSizes: NodeDimensions | undefined) : TreeLayout {
    const root = d3hierarchy.hierarchy(treeData.root, (d)=>d.children);
    const graphOrientation = treeData.graphOrientation ?? "top-to-bottom";
    const ooo = orientations[graphOrientation];
    ooo;

    // Establish maxLabelLength and assign ids
    let nextId = 0;
    const nodeIds = new Map<TreeNode, string>();
    let maxLabelLength = 0;
    treeDescription.visitTreeNodes(
        treeData.root,
        d => {
            nodeIds.set(d, "" + nextId++);
            if (d.name) {
                maxLabelLength = Math.max(d.name.length, maxLabelLength);
            }
        },
        treeDescription.allChildren,
    );

    // Limit maximum label length and keep layout tight for short names
    maxLabelLength = Math.min(maxLabelLength, MAX_DISPLAY_LENGTH + 2 /* include ellipsis */);

    // Layout the tree
    const treelayout = d3flextree
        .flextree<treeDescription.TreeNode>()
        .nodeSize(d => {
            const id = nodeIds.get(d.data);
            const measuredSize = nodeSizes?.get(assertNotNull(id));
            if (!measuredSize)
                // Fallback values, used before the tree is rendered for the first time
                return [50,50];
            return [measuredSize.width + 20, measuredSize.height + 20];
        })
        .spacing((a, b) => (a.parent === b.parent ? 0 : 0));
    console.log("layout");
    const layout = treelayout(root);
    const d3nodes = layout.descendants().reverse();
    const d3edges = layout.links();

    // Transform tree representation from d3 into reactflow
    const nodes = d3nodes.map((n) => {
        return {
            id: nodeIds.get(n.data),
            position: {x: n.x, y: n.y},
            type: "querynode",
            data: n.data,
        } as Node;
    });
    const edges = d3edges.map((e) => {
        const sourceId = nodeIds.get(e.source.data);
        const targetId = nodeIds.get(e.target.data);
        return {
            id: `${sourceId}->${targetId}`,
            source: sourceId,
            target: targetId,
        } as Edge;
    });

    // Add crosslinks
    const descendants = root.descendants();
    const map = (d: treeDescription.TreeNode) => descendants.find(h => h.data === d);
    const crosslinks = (treeData.crosslinks ?? []).map(l => {
        const sourceId = nodeIds.get(map(l.source)!.data);
        const targetId = nodeIds.get(map(l.target)!.data);
        return {
            id: `${sourceId}->${targetId}`,
            source: sourceId,
            target: targetId,
        } as Edge;
    });

    return { nodes: nodes, edges: edges.concat(crosslinks)};
}
