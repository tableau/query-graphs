import * as d3flextree from "d3-flextree";
import * as d3hierarchy from "d3-hierarchy";

import {NodeDimensions} from "./useNodeSizes";
import * as treeDescription from "../tree-description";
import {TreeNode, TreeDescription} from "../tree-description";
// TODO: import type; fix `prettier` first :/
import {Edge, Node} from "reactflow";
import {assertNotNull} from "../loader-utils";

interface TreeLayout {
    nodes: Node<TreeNode>[];
    edges: Edge[];
}

//
// Layout a tree
//
// Returns node and edge lists
export function layoutTree(
    treeData: TreeDescription,
    nodeSizes: NodeDimensions | undefined,
    expandedSubtrees: Record<string, boolean>,
): TreeLayout {
    // Assign ids
    let nextId = 0;
    const nodeIds = new Map<TreeNode, string>();
    treeDescription.visitTreeNodes(
        treeData.root,
        d => {
            nodeIds.set(d, "" + nextId++);
        },
        treeDescription.allChildren,
    );

    const root = d3hierarchy.hierarchy(treeData.root, d => {
        if (expandedSubtrees[nodeIds.get(d)!]) return d._children;
        return d.children;
    });

    // Layout the tree
    const treelayout = d3flextree
        .flextree<treeDescription.TreeNode>()
        .nodeSize(d => {
            const id = nodeIds.get(d.data);
            const measuredSize = nodeSizes?.get(assertNotNull(id));
            if (!measuredSize)
                // Fallback values, used before the tree is rendered for the first time
                return [50, 50];
            return [measuredSize.width + 20, measuredSize.height + 40];
        })
        .spacing((a, b) => (a.parent === b.parent ? 0 : 0));
    console.log("layout");
    const layout = treelayout(root);
    const d3nodes = layout.descendants().reverse();
    const d3edges = layout.links();

    // Transform tree representation from d3 into reactflow
    const nodes = d3nodes.map(n => {
        return {
            id: nodeIds.get(n.data),
            position: {x: n.x, y: n.y},
            type: "querynode",
            data: n.data,
        } as Node;
    });
    const edges = d3edges.map(e => {
        const sourceId = nodeIds.get(e.source.data);
        const targetId = nodeIds.get(e.target.data);
        return {
            id: `${sourceId}->${targetId}`,
            source: sourceId,
            target: targetId,
            label: e.target.data.edgeLabel,
            className: e.target.data.edgeClass,
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
            className: "qg-crosslink",
        } as Edge;
    });

    return {nodes: nodes, edges: edges.concat(crosslinks)};
}
