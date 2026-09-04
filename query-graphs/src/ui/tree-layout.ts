import * as d3flextree from "d3-flextree";
import * as d3hierarchy from "d3-hierarchy";

import type {NodeDimensions} from "./store";
import type * as treeDescription from "../tree-description";
import type {TreeNode, TreeDescription} from "../tree-description";
import type {Edge} from "@xyflow/react";
import type {QueryGraphNode} from "./QueryNode";
import type {QueryGraphEdge as ColoredQueryGraphEdge} from "./QueryEdge";
import {assertNotNull} from "../assert";
import type {CSSProperties} from "react";
import type {HighlightThresholds} from "../highlight-rules";
import {deriveNodeDisplay} from "../highlight-rules";

// Crosslinks have no `type`/`data` of their own, so they stay plain `Edge`s.
type QueryGraphEdge = ColoredQueryGraphEdge | Edge;

interface TreeLayout {
    nodes: QueryGraphNode[];
    edges: QueryGraphEdge[];
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
    focusIssues: boolean,
    highlightThresholds: HighlightThresholds,
): TreeLayout {
    // For plans that support adjustable highlighting (Hyper), recompute each node's
    // threshold-dependent display (costly scan, cardinality misestimate, runtime hotspot) from the
    // live thresholds. Other loaders bake highlights, so `derived` stays undefined for them.
    // Results are memoized per node so the node pass and the edge pass (which both need the target
    // node's display) don't recompute it twice — on large plans that halves the per-keystroke work.
    const displayCache = new Map<TreeNode, ReturnType<typeof deriveNodeDisplay>>();
    const derive = (n: TreeNode) => {
        if (!treeData.adjustableHighlights) return undefined;
        let d = displayCache.get(n);
        if (d === undefined) {
            d = deriveNodeDisplay(
                n,
                highlightThresholds,
                treeData.planCpuTotal ?? 0,
                treeData.planProcessedTotal ?? 0,
                treeData.planMemoryTotal ?? 0,
            );
            displayCache.set(n, d);
        }
        return d;
    };
    const root = d3hierarchy.hierarchy(treeData.root, (d) => {
        if (expandedSubtrees[nodeIds.get(d)!] && d.collapsedChildren) {
            return (d.children ?? []).concat(d.collapsedChildren);
        }
        return d.children;
    });

    // Layout the tree.
    // This offset is added to every node's layout height, so it becomes the vertical gap between one
    // level and the next. A collapsed node is short (head only, no body), so with a small offset its
    // edge to the level below is short and the row-count label gets crammed against the child. Keep the
    // gap generous so collapsed levels read as roomily as expanded ones and the edge labels have space.
    const heighOffset = 100;
    const treelayout = d3flextree
        .flextree<treeDescription.TreeNode>()
        .nodeSize((d) => {
            const id = nodeIds.get(d.data);
            assertNotNull(id);
            const dim = nodeDimensions[id];
            if (
                dim == undefined ||
                dim.headWidth === undefined ||
                dim.headHeight === undefined ||
                dim.bodyWidth === undefined ||
                dim.bodyHeight === undefined
            ) {
                // Layout is a two-pass process: node sizes are only known after they are rendered and
                // measured by the ResizeObserver. On the first pass we lay out with this placeholder size,
                // then re-render once the measured dimensions arrive in `nodeDimensions`.
                return [50, 50];
            }
            if (expandedNodes[id]) {
                return [Math.max(dim.headWidth, dim.bodyWidth) + 20, dim.headHeight + dim.bodyHeight + heighOffset];
            } else return [dim.headWidth + 20, dim.headHeight + heighOffset];
        })
        .spacing((a, b) => (a.parent === b.parent ? 10 : 40));
    const layout = treelayout(root);
    const d3nodes = layout.descendants().reverse();
    const d3edges = layout.links();

    // Transform tree representation from d3 into reactflow
    // Track which nodes end up dimmed in focus mode, so the edges leading into them can be dimmed to
    // match — otherwise a highlighted (e.g. cardinality-misestimate) edge would point at a greyed-out
    // node and read as a broken focus view.
    const dimmedNodeIds = new Set<string>();
    const nodes: QueryGraphNode[] = d3nodes.map((n) => {
        const id = nodeIds.get(n.data);
        assertNotNull(id);
        const derived = derive(n.data);
        // The recomputed display fully replaces the loader's baked values (assigning even `undefined`,
        // so a highlight that no longer applies under the current thresholds is cleared).
        const data = derived
            ? {
                  ...n.data,
                  highlightNode: derived.highlightNode,
                  highlightReason: derived.highlightReason,
                  costlyScan: derived.costlyScan,
                  costlyScanColor: derived.costlyScanColor,
                  highVolumeScan: derived.highVolumeScan,
                  nodeColor: derived.nodeColor,
                  memoryColor: derived.memoryColor,
                  resizeObserver,
              }
            : {...n.data, resizeObserver};
        // In focus mode, dim every node that is not an actual issue so the flagged issues pop.
        // Issues are costly scans, index recommendations, runtime / memory hotspots (the latter two
        // carry a `nodeColor` / `memoryColor` tint), duplicate output columns, and — most severe of
        // all — a node that raised a runtime error. These match the problem categories PlanInsights
        // lists and lets its "Next issue" navigation jump to, so focus mode never dims a node the panel
        // treats as an issue. A used index is good, not a problem, so it is dimmed like any ordinary node.
        const isIssue =
            data.highlightNode === "costly-scan" ||
            data.highlightNode === "high-volume-scan" ||
            data.highlightNode === "index-rec" ||
            !!data.nodeColor ||
            !!data.memoryColor ||
            !!data.duplicateColumns ||
            !!data.errorMessage;
        const dimmed = focusIssues && !isIssue;
        if (dimmed) dimmedNodeIds.add(id);
        return {
            id,
            position: {x: n.x, y: n.y},
            type: "querynode",
            data,
            className: dimmed ? "qg-node-dimmed" : undefined,
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
        // The edge highlight (cardinality misestimate / costly-scan) is threshold-dependent, so take
        // it from the recomputed display when available, otherwise from the baked loader values.
        const derived = derive(e.target.data);
        const edgeClass = derived ? derived.edgeClass : e.target.data.edgeClass;
        const edgeReason = derived ? derived.edgeReason : e.target.data.edgeReason;
        // Dim an edge whenever its target node is dimmed, so focus mode fades the edge and the node
        // it points at together instead of leaving a colored edge crossing into a greyed-out node.
        const edgeDimmed = dimmedNodeIds.has(targetId);
        return {
            id: `${sourceId}->${targetId}`,
            source: sourceId,
            target: targetId,
            type: "queryedge",
            label: e.target.data.edgeLabel,
            className: [edgeClass, edgeDimmed ? "qg-edge-dimmed" : undefined].filter(Boolean).join(" ") || undefined,
            style: style,
            // Carried through to the custom edge so it can draw the color gradient, highlight the
            // row-count label, and show a "why highlighted" hover tooltip. `labelHighlighted` is
            // passed via data (not just the edge className) because the label renders in the
            // edge-label layer, out of reach of a descendant selector on the edge wrapper.
            data: {colors: e.target.data.edgeColors, edgeReason, labelHighlighted: edgeClass === "qg-label-highlighted"},
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
        // Dim the crosslink when either endpoint is dimmed, so focus mode never leaves a fully-opaque
        // crosslink pointing at (or from) a greyed-out node — matching how tree edges dim with their
        // target.
        const linkDimmed = dimmedNodeIds.has(sourceId) || dimmedNodeIds.has(targetId);
        crosslinks.push({
            id: `${sourceId}->${targetId}`,
            source: sourceId,
            target: targetId,
            className: ["qg-crosslink", linkDimmed ? "qg-edge-dimmed" : undefined].filter(Boolean).join(" "),
            focusable: true,
        });
    }

    return {nodes: nodes, edges: edges.concat(crosslinks)};
}
