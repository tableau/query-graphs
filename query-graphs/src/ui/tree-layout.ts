import * as d3flextree from "d3-flextree";
import * as d3hierarchy from "d3-hierarchy";

import {NodeDimensions} from "./store";
import * as treeDescription from "../tree-description";
import {TreeNode, TreeDescription} from "../tree-description";
import type {Edge, Node} from "reactflow";
import {assertNotNull} from "../loader-utils";
import {CSSProperties} from "react";
import {HighlightThresholds, deriveNodeDisplay} from "../highlight-rules";

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
            d = deriveNodeDisplay(n, highlightThresholds, treeData.planCpuTotal ?? 0, treeData.planProcessedTotal ?? 0);
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

    // Layout the tree
    const heighOffset = 60;
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
                // This is just a default. We will immediately re-render with the updated actual values.
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
    const nodes = d3nodes.map((n) => {
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
                  nodeColor: derived.nodeColor,
                  resizeObserver,
              }
            : {...n.data, resizeObserver};
        // In focus mode, dim every node that is not an actual issue so the flagged issues pop.
        // Only costly scans and index recommendations count as issues; a used index is good,
        // not a problem, so it is dimmed like any ordinary node.
        const isIssue = data.highlightNode === "costly-scan" || data.highlightNode === "index-rec";
        const dimmed = focusIssues && !isIssue;
        if (dimmed) dimmedNodeIds.add(nodeIds.get(n.data)!);
        return {
            id: nodeIds.get(n.data),
            position: {x: n.x, y: n.y},
            type: "querynode",
            data,
            className: dimmed ? "qg-node-dimmed" : undefined,
        } as Node;
    });
    const edges = d3edges.map((e) => {
        const sourceId = nodeIds.get(e.source.data);
        const targetId = nodeIds.get(e.target.data);
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
        const edgeDimmed = dimmedNodeIds.has(targetId!);
        return {
            id: `${sourceId}->${targetId}`,
            source: sourceId,
            target: targetId,
            type: "queryedge",
            label: e.target.data.edgeLabel,
            className: [edgeClass, edgeDimmed ? "qg-edge-dimmed" : undefined].filter(Boolean).join(" ") || undefined,
            style: style,
            focusable: false,
            // Carried through to the custom edge so it can show a "why highlighted" hover tooltip.
            data: {edgeReason},
        } as Edge;
    });

    // Add crosslinks
    const descendants = root.descendants();
    const map = (d: treeDescription.TreeNode) => {
        return descendants.find((h) => {
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
