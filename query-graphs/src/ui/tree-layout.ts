import * as d3flextree from "d3-flextree";
import * as d3hierarchy from "d3-hierarchy";

import type {NodeDimensions} from "./store";
import type * as treeDescription from "../tree-description";
import type {TreeNode, TreeDescription} from "../tree-description";
import type {Edge, Node} from "@xyflow/react";
import type {QueryGraphNode} from "./QueryNode";
import type {ColoredGraphEdge} from "./ColoredEdge";
import {assertNotNull} from "../assert";
import type {CSSProperties} from "react";
import type {GroupNodeBox, GroupEdge} from "./group-backdrop";
import {computeGroupBackdrops} from "./group-backdrop";

// Crosslinks have no `type`/`data` of their own, so they stay plain `Edge`s.
type QueryGraphEdge = ColoredGraphEdge | Edge;

interface TreeLayout {
    nodes: (QueryGraphNode | Node)[];
    edges: QueryGraphEdge[];
}

// The rendered width/height of a node's head (and, if expanded, its body), i.e. the actual
// on-screen box — as opposed to the `nodeSize` used for flextree spacing, which additionally
// bakes in inter-sibling/inter-level margins that aren't part of the node's own visual extent.
function measuredNodeSize(dim: NodeDimensions | undefined, expanded: boolean): [number, number] | undefined {
    if (
        dim?.headWidth === undefined ||
        dim.headHeight === undefined ||
        dim.bodyWidth === undefined ||
        dim.bodyHeight === undefined
    ) {
        return undefined;
    }
    if (expanded) {
        return [Math.max(dim.headWidth, dim.bodyWidth), dim.headHeight + dim.bodyHeight];
    }
    return [dim.headWidth, dim.headHeight];
}

//
// Layout a tree
//
// Returns node and edge lists
export function layoutTree(
    treeData: TreeDescription,
    nodeIds: Map<TreeNode, string>,
    nodeDimensions: Record<string, NodeDimensions>,
    expandedNodes: Record<string, boolean>,
    expandedSubtrees: Record<string, boolean>,
    resizeObserver: ResizeObserver,
): TreeLayout {
    const root = d3hierarchy.hierarchy(treeData.root, (d) => {
        if (expandedSubtrees[nodeIds.get(d)!] && d.collapsedChildren) {
            return (d.children ?? []).concat(d.collapsedChildren);
        }
        return d.children;
    });

    // Layout the tree
    const heighOffset = 60;
    const treelayout = d3flextree
        .flextree<treeDescription.TreeNode>()
        .nodeSize((d) => {
            const id = nodeIds.get(d.data);
            assertNotNull(id);
            const size = measuredNodeSize(nodeDimensions[id], !!expandedNodes[id]);
            if (!size) {
                // Layout is a two-pass process: node sizes are only known after they are rendered and
                // measured by the ResizeObserver. On the first pass we lay out with this placeholder size,
                // then re-render once the measured dimensions arrive in `nodeDimensions`.
                return [50, 50];
            }
            const [width, height] = size;
            return [width + 20, height + heighOffset];
        })
        .spacing((a, b) => (a.parent === b.parent ? 10 : 40));
    const layout = treelayout(root);
    const d3nodes = layout.descendants().reverse();
    const d3edges = layout.links();

    // Transform tree representation from d3 into reactflow
    const groupBoxes: GroupNodeBox[] = [];
    // Bounding box of every grouped node, keyed by its underlying tree-data object — used
    // below to build the per-edge connectors between grouped nodes.
    const groupNodeInfo = new Map<treeDescription.TreeNode, {left: number; right: number; top: number; bottom: number}>();
    const nodes: QueryGraphNode[] = d3nodes.map((n) => {
        const id = nodeIds.get(n.data);
        assertNotNull(id);
        if (n.data.group) {
            // Nodes are top-center anchored (see `nodeOrigin` on <ReactFlow>): x is the
            // horizontal center, y is the top edge.
            const size = measuredNodeSize(nodeDimensions[id], !!expandedNodes[id]);
            const [width, height] = size ?? [0, 0];
            const left = n.x - width / 2;
            const right = n.x + width / 2;
            const top = n.y;
            const bottom = n.y + height;
            groupBoxes.push({group: n.data.group, x: left, y: top, width, height});
            groupNodeInfo.set(n.data, {left, right, top, bottom});
        }
        return {
            id,
            position: {x: n.x, y: n.y},
            type: "querynode",
            data: {...n.data, resizeObserver},
        };
    });
    const groupEdges: GroupEdge[] = [];
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
        // Only connect two nodes that both belong to the same group — this deliberately
        // excludes the edge from a group's un-grouped createtemptable boundary node down to
        // its first grouped descendant, so the backdrop starts below that boundary.
        if (e.source.data.group && e.source.data.group === e.target.data.group) {
            const sourceInfo = groupNodeInfo.get(e.source.data);
            const targetInfo = groupNodeInfo.get(e.target.data);
            if (sourceInfo && targetInfo) {
                groupEdges.push({
                    group: e.source.data.group,
                    sourceLeft: sourceInfo.left,
                    sourceRight: sourceInfo.right,
                    sourceBottom: sourceInfo.bottom,
                    targetLeft: targetInfo.left,
                    targetRight: targetInfo.right,
                    targetTop: targetInfo.top,
                });
            }
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

    // Add group backdrops
    const backdrops = computeGroupBackdrops(groupBoxes, groupEdges);
    // The backdrop's position is its top-left corner, unlike the top-center
    // origin used for query nodes (see `nodeOrigin` on <ReactFlow>).
    const backdropOrigin: [number, number] = [0, 0];
    const backdropFillNodes = backdrops.map(
        (b) =>
            ({
                id: `backdrop-fill-${b.groupId}`,
                type: "groupBackdrop",
                position: {x: b.x, y: b.y},
                origin: backdropOrigin,
                data: {
                    width: b.width,
                    height: b.height,
                    pathData: b.pathData,
                    points: [],
                    color: b.color,
                    groupId: b.groupId,
                    role: "fill",
                },
                selectable: false,
                draggable: false,
                style: {zIndex: -1} as CSSProperties,
            }) as Node,
    );
    // Debug vertex markers: a separate node per group, appended after every other node with
    // a high z-index, so they're always visible on top — regardless of stacking order between
    // overlapping backdrop fills or query nodes.
    const backdropMarkerNodes = backdrops.map(
        (b) =>
            ({
                id: `backdrop-markers-${b.groupId}`,
                type: "groupBackdrop",
                position: {x: b.x, y: b.y},
                origin: backdropOrigin,
                data: {
                    width: b.width,
                    height: b.height,
                    pathData: "",
                    points: b.points,
                    color: b.color,
                    groupId: b.groupId,
                    role: "markers",
                },
                selectable: false,
                draggable: false,
                style: {zIndex: 1000} as CSSProperties,
            }) as Node,
    );

    return {nodes: [...backdropFillNodes, ...nodes, ...backdropMarkerNodes], edges: edges.concat(crosslinks)};
}
