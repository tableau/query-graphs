import ReactFlow, {MiniMap, Node, Controls, ReactFlowProvider} from "reactflow";
import "reactflow/dist/base.css";

import {layoutTree} from "./tree-layout";
import {TreeDescription, TreeNode, allChildren, visitTreeNodes} from "../tree-description";
import {useMemo, useEffect, useRef, ReactNode} from "react";
import {QueryNode} from "./QueryNode";
import {QueryEdge} from "./QueryEdge";
import {PlanInsights} from "./PlanInsights";
import {useGraphRenderingStore} from "./store";
import "./QueryGraph.css";

interface QueryGraphProps {
    treeDescription: TreeDescription;
    children: ReactNode | ReactNode[];
}

function minimapNodeColor(n: Node<TreeNode>): string {
    // A costly scan's proportional red takes precedence so heavy scans are spottable in the minimap;
    // otherwise fall back to the runtime-hotspot tint, then the icon color.
    if (n.data.highlightNode === "costly-scan" && n.data.costlyScanColor) return n.data.costlyScanColor;
    if (n.data.nodeColor) return n.data.nodeColor;
    if (n.data.iconColor) return n.data.iconColor;
    return "hsl(0, 0%, 72%)";
}

const nodeTypes = {
    querynode: QueryNode,
};

const edgeTypes = {
    queryedge: QueryEdge,
};

function QueryGraphInternal({treeDescription, children}: QueryGraphProps) {
    // Assign ids to all nodes
    const nodeIdMapping = useMemo(() => {
        let nextId = 0;
        const nodeIds = new Map<TreeNode, string>();
        visitTreeNodes(
            treeDescription.root,
            (d) => {
                nodeIds.set(d, "" + nextId++);
            },
            allChildren,
        );
        return nodeIds;
    }, [treeDescription]);

    // Initialize our state using the correct "expandedByDefault" state
    const initGraphStore = useGraphRenderingStore((s) => s.init);
    useMemo(() => {
        const expandedSubtrees = {};
        visitTreeNodes(
            treeDescription.root,
            (n) => {
                if (n.expandedByDefault) {
                    expandedSubtrees[nodeIdMapping.get(n)!] = true;
                }
            },
            allChildren,
        );
        initGraphStore(expandedSubtrees);
    }, [treeDescription, initGraphStore, nodeIdMapping]);

    // Create a ResizeObserver to keep track of the sizes of the nodes
    const resizeObserverRef = useRef<ResizeObserver>();
    const updateNodeDimensions = useGraphRenderingStore((s) => s.updateNodeDimensions);
    const resizeObserver = useMemo(() => {
        resizeObserverRef.current?.disconnect();
        const observer = new ResizeObserver(updateNodeDimensions);
        resizeObserverRef.current = observer;
        return observer;
    }, [updateNodeDimensions]);
    useEffect(() => {
        return () => {
            resizeObserverRef.current?.disconnect();
        };
    }, []);

    // Layout the tree, using the actual measured sizes of the DOM nodes
    const nodeDimensions = useGraphRenderingStore((s) => s.nodeDimensions);
    const expandedNodes = useGraphRenderingStore((s) => s.expandedNodes);
    const expandedSubtrees = useGraphRenderingStore((s) => s.expandedSubtrees);
    const focusIssues = useGraphRenderingStore((s) => s.focusIssues);
    const highlightThresholds = useGraphRenderingStore((s) => s.highlightThresholds);
    const layout = useMemo(
        () =>
            layoutTree(
                treeDescription,
                nodeIdMapping,
                nodeDimensions,
                expandedNodes,
                expandedSubtrees,
                resizeObserver,
                focusIssues,
                highlightThresholds,
            ),
        [
            treeDescription,
            nodeIdMapping,
            nodeDimensions,
            expandedNodes,
            expandedSubtrees,
            resizeObserver,
            focusIssues,
            highlightThresholds,
        ],
    );

    return (
        <ReactFlow
            nodes={layout.nodes}
            edges={layout.edges}
            nodeOrigin={[0.5, 0]}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            fitViewOptions={{padding: 0.18}}
            minZoom={0.2}
            maxZoom={1.5}
            elementsSelectable={true}
            nodesDraggable={false}
            nodesConnectable={false}
            nodesFocusable={false}
            className={"query-graph"}
        >
            {...Array.isArray(children) ? children : [children]}
            {/* The insights overlay (summary header + legend/tools panel) is built around the Hyper
                scan-highlighting model, so it's only shown for Hyper plans. Other loaders (e.g.
                Postgres) don't populate the highlight categories, so they'd get an always-empty
                panel. Keyed on the explicit plan source rather than the `adjustableHighlights`
                feature flag, which is deliberately unset for Hyper optimizer-steps trees. */}
            {treeDescription.planSource === "hyper" ? (
                <PlanInsights treeDescription={treeDescription} nodeIdMapping={nodeIdMapping} />
            ) : null}
            <MiniMap zoomable={true} pannable={true} nodeColor={minimapNodeColor} />
            <Controls showInteractive={false} />
        </ReactFlow>
    );
}

export function QueryGraph(props: QueryGraphProps) {
    return (
        <ReactFlowProvider>
            <QueryGraphInternal {...props} />
        </ReactFlowProvider>
    );
}
