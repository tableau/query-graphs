import * as d3flextree from "d3-flextree";
import * as d3hierarchy from "d3-hierarchy";

import {NodeDimensions} from "./useNodeSizes";
import * as treeDescription from "../tree-description";
import {TreeNode, TreeDescription} from "../tree-description";
// TODO: import type; fix `prettier` first :/
import {Edge, Node} from "reactflow";
import {assertNotNull} from "../loader-utils";
import {CSSProperties} from "react";

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
            return [measuredSize.width + 20, measuredSize.height + 50];
        })
        .spacing((a, b) => (a.parent === b.parent ? 0 : 40));
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
        const style = {} as CSSProperties;
        if (e.target.data.edgeWidth) {
            const width = Math.max(1, 10 * Math.min(1, e.target.data.edgeWidth));
            style.strokeWidth = `${width}px`;
        }
        return {
            id: `${sourceId}->${targetId}`,
            source: sourceId,
            target: targetId,
            label: e.target.data.edgeLabel,
            className: e.target.data.edgeClass,
            style: style,
        } as Edge;
    });

    // Add crosslinks
    const descendants = root.descendants();
    const map = (d: treeDescription.TreeNode) => {
        return descendants.find(h => {
            return h.data === d;
        });
    };
    const crosslinks = [] as Edge[];
    for (const link of treeData.crosslinks ?? []) {
        const sourceNode = map(link.source);
        const targetNode = map(link.target);
        if (!targetNode || !sourceNode) continue;
        const sourceId = nodeIds.get(sourceNode.data)!;
        const targetId = nodeIds.get(targetNode.data)!;
        crosslinks.push({
            id: `${sourceId}->${targetId}`,
            source: sourceId,
            target: targetId,
            className: "qg-crosslink",
        });
    }

    return {nodes: nodes, edges: edges.concat(crosslinks)};
}
