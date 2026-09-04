import * as d3flextree from "d3-flextree";
import * as d3hierarchy from "d3-hierarchy";

import type * as treeDescription from "../tree-description";
import type {TreeNode, TreeDescription} from "../tree-description";
import type {Dimensions, Edge} from "@xyflow/react";
import type {QueryGraphNode} from "./QueryNode";
import type {ColoredGraphEdge} from "./ColoredEdge";
import {assertNotNull} from "../assert";
import type {CSSProperties} from "react";

// Crosslinks have no `type`/`data` of their own, so they stay plain `Edge`s.
type QueryGraphEdge = ColoredGraphEdge | Edge;

interface TreeLayout {
    nodes: QueryGraphNode[];
    edges: QueryGraphEdge[];
}

export interface GraphNodeDimensions {
    measured: Dimensions;
    target: Dimensions;
}

//
// Layout a tree
//
// Returns node and edge lists
export function layoutTree(
    treeData: TreeDescription,
    nodeIds: Map<TreeNode, string>,
    nodeDimensions: ReadonlyMap<string, GraphNodeDimensions>,
    expandedSubtrees: Record<string, boolean>,
): TreeLayout {
    const root = d3hierarchy.hierarchy(treeData.root, (d) => {
        if (expandedSubtrees[nodeIds.get(d)!] && d.collapsedChildren) {
            return (d.children ?? []).concat(d.collapsedChildren);
        }
        return d.children;
    });

    // Layout the tree
    const heightOffset = 60;
    const treelayout = d3flextree
        .flextree<treeDescription.TreeNode>()
        .nodeSize((d) => {
            const id = nodeIds.get(d.data);
            assertNotNull(id);
            const dim = nodeDimensions.get(id)?.target;
            if (dim === undefined) {
                // React Flow measures new nodes after their first render. It keeps them hidden until then,
                // so this placeholder only determines where that measurement render happens.
                return [50, 50];
            }
            return [dim.width + 20, dim.height + heightOffset];
        })
        .spacing((a, b) => (a.parent === b.parent ? 10 : 40));
    const layout = treelayout(root);
    const d3nodes = layout.descendants().reverse();
    const d3edges = layout.links();

    // Transform tree representation from d3 into reactflow
    const nodes: QueryGraphNode[] = d3nodes.map((n) => {
        const id = nodeIds.get(n.data);
        assertNotNull(id);
        return {
            id,
            position: {x: n.x, y: n.y},
            type: "querynode",
            data: n.data,
            measured: nodeDimensions.get(id)?.measured,
        };
    });
    const edges: QueryGraphEdge[] = d3edges.map((e) => {
        const sourceId = nodeIds.get(e.source.data);
        const targetId = nodeIds.get(e.target.data);
        assertNotNull(sourceId);
        assertNotNull(targetId);
        const style = {} as CSSProperties;
        if (e.target.data.edgeWidth) {
            const width = Math.max(1, 10 * Math.min(1, e.target.data.edgeWidth));
            style.strokeWidth = `${width}px`;
        }
        return {
            id: `${sourceId}->${targetId}`,
            source: sourceId,
            target: targetId,
            type: "colored",
            label: e.target.data.edgeLabel,
            className: e.target.data.edgeClass,
            style: style,
            data: {colors: e.target.data.edgeColors},
            focusable: false,
        };
    });

    // Add crosslinks
    const descendants = root.descendants();
    const map = (d: treeDescription.TreeNode) => {
        return descendants.find((h) => {
            return h.data === d;
        });
    };
    const crosslinks: Edge[] = [];
    for (const link of treeData.crosslinks ?? []) {
        const sourceNode = map(link.source);
        const targetNode = map(link.target);
        if (!targetNode || !sourceNode) continue;
        const sourceId = nodeIds.get(sourceNode.data);
        const targetId = nodeIds.get(targetNode.data);
        assertNotNull(sourceId);
        assertNotNull(targetId);
        crosslinks.push({
            id: `${sourceId}->${targetId}`,
            source: sourceId,
            target: targetId,
            className: "qg-crosslink",
            focusable: true,
        });
    }

    return {nodes: nodes, edges: edges.concat(crosslinks)};
}
