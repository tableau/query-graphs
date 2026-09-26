import {ReactFlow, MiniMap, MiniMapNode, Controls, ReactFlowProvider, useReactFlow} from "@xyflow/react";
import type {MiniMapNodeProps} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type {TreeDescription, TreeNode} from "../tree-description";
import {allChildren, visitTreeNodes} from "../tree-description";
import type {MouseEvent, ReactNode} from "react";
import {useEffect, useMemo, useRef} from "react";
import cc from "classcat";
import {QueryNode} from "./QueryNode";
import type {QueryGraphNode} from "./QueryNode";
import {ColoredEdge} from "./ColoredEdge";
import {createGraphRenderingStore, GraphRenderingStoreContext, useGraphRenderingStore} from "./store";
import {AnimateGraphChangeContext, useAnimatedGraphLayout} from "./useAnimatedGraphLayout";
import {indexGraph} from "./graph-index";
import type {TreeParents} from "./tree-topology";
import {graphAnimationDuration, graphAnimationsEnabled} from "./animation-timing";
import {horizontalViewportInsets, type ScreenRectangle, visibleRectangleFraction} from "./viewport-geometry";
import "./QueryGraph.css";

interface QueryGraphProps {
    treeDescription: TreeDescription;
    children: ReactNode | ReactNode[];
}

interface QueryGraphInternalProps extends QueryGraphProps {
    nodeIdMapping: Map<TreeNode, string>;
    treeParents: TreeParents;
}

function minimapNodeColor(n: QueryGraphNode): string {
    if (n.data.nodeColor) return n.data.nodeColor;
    if (n.data.iconColor) return n.data.iconColor;
    return "hsl(0, 0%, 72%)";
}

function QueryGraphMiniMapNode(props: MiniMapNodeProps) {
    const highlighted = useGraphRenderingStore((state) => state.visibleHighlightedNodeIds.has(props.id));
    return <MiniMapNode {...props} className={cc([props.className, {"qg-highlighted": highlighted}])} />;
}

const nodeTypes = {
    querynode: QueryNode,
};

const edgeTypes = {
    colored: ColoredEdge,
};

function preventNodeDoubleClickZoom(event: MouseEvent): void {
    if (event.target instanceof Element && event.target.closest(".react-flow__node") !== null) event.stopPropagation();
}

const minimumVisibleNodeFraction = 0.5;

function getViewportObstacles(flowElement: HTMLElement): ScreenRectangle[] {
    return [...flowElement.querySelectorAll<HTMLElement>(".qg-viewport-obstacle")].map((obstacle) =>
        obstacle.getBoundingClientRect(),
    );
}

function isRenderedNodeWellVisible(
    flowElement: HTMLElement,
    nodeId: string,
    viewportObstacles: readonly ScreenRectangle[],
): boolean {
    const nodeElement = [...flowElement.querySelectorAll<HTMLElement>(".react-flow__node")].find(
        (candidate) => candidate.dataset.id === nodeId,
    );
    if (nodeElement === undefined) return false;
    return (
        visibleRectangleFraction(nodeElement.getBoundingClientRect(), flowElement.getBoundingClientRect(), viewportObstacles) >=
        minimumVisibleNodeFraction
    );
}

function fitViewPadding(flowBounds: ScreenRectangle, viewportObstacles: readonly ScreenRectangle[]) {
    const insets = horizontalViewportInsets(flowBounds, viewportObstacles, 16);
    // On narrow screens an expanded document can cover the entire graph. Do
    // not move the hidden canvas or leave it displaced after the panel closes.
    if (insets === undefined) return undefined;
    return {top: "16px", right: `${insets.right}px`, bottom: "16px", left: `${insets.left}px`} as const;
}

function QueryGraphInternal({treeDescription, children, nodeIdMapping, treeParents}: QueryGraphInternalProps) {
    const expandedSubtrees = useGraphRenderingStore((s) => s.expandedSubtrees);
    const nodeIdsToReveal = useGraphRenderingStore((state) => state.nodeIdsToReveal);
    const animatedLayout = useAnimatedGraphLayout(treeDescription, nodeIdMapping, treeParents, expandedSubtrees);
    const flowElement = useRef<HTMLDivElement>(null);
    const {fitView, getZoom} = useReactFlow<QueryGraphNode>();

    useEffect(() => {
        if (nodeIdsToReveal === undefined || !animatedLayout.initialViewportReady) return;
        // Hover is exploratory, so wait briefly before moving the viewport and
        // cancel the move when the pointer reaches another linked range first.
        const timer = window.setTimeout(() => {
            const element = flowElement.current;
            if (element === null) return;
            const viewportObstacles = getViewportObstacles(element);
            const nodeIds = [...nodeIdsToReveal];
            if (nodeIds.length === 0 || nodeIds.some((nodeId) => isRenderedNodeWellVisible(element, nodeId, viewportObstacles)))
                return;
            const padding = fitViewPadding(element.getBoundingClientRect(), viewportObstacles);
            if (padding === undefined) return;

            void fitView({
                nodes: nodeIds.map((id) => ({id})),
                padding,
                duration: graphAnimationsEnabled() ? graphAnimationDuration : 0,
                // Following may zoom out to fit several nodes, but should not
                // unexpectedly magnify a graph the user deliberately zoomed out.
                maxZoom: getZoom(),
            });
        }, 150);
        return () => window.clearTimeout(timer);
    }, [animatedLayout.initialViewportReady, fitView, getZoom, nodeIdsToReveal]);
    // Hide the full tree initially to avoid flickering. We use `opacity` instead
    // of `visibility: hidden` because React Flow overrides inherited
    // visibility on nodes after measuring them.
    const initialViewportStyle = {opacity: animatedLayout.initialViewportReady ? 1 : 0};

    return (
        <AnimateGraphChangeContext.Provider value={animatedLayout.animateGraphChange}>
            <ReactFlow
                ref={flowElement}
                nodes={animatedLayout.nodes}
                edges={animatedLayout.edges}
                nodeOrigin={[0.5, 0]}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                onNodesChange={animatedLayout.onNodesChange}
                onDoubleClickCapture={preventNodeDoubleClickZoom}
                minZoom={0.2}
                maxZoom={1.5}
                elementsSelectable={true}
                nodesDraggable={false}
                nodesConnectable={false}
                nodesFocusable={false}
                className={"query-graph"}
                style={initialViewportStyle}
                inert={!animatedLayout.initialViewportReady}
            >
                {...Array.isArray(children) ? children : [children]}
                <MiniMap zoomable={true} pannable={true} nodeColor={minimapNodeColor} nodeComponent={QueryGraphMiniMapNode} />
                <Controls showInteractive={false} />
            </ReactFlow>
        </AnimateGraphChangeContext.Provider>
    );
}

let nextGraphInstanceId = 0;

function createGraphState(treeDescription: TreeDescription) {
    let nextId = 0;
    const nodeIdMapping = new Map<TreeNode, string>();
    const expandedSubtrees: Record<string, boolean> = {};
    visitTreeNodes(
        treeDescription.root,
        (node) => {
            const id = "" + nextId++;
            nodeIdMapping.set(node, id);
            if (node.expandedByDefault) expandedSubtrees[id] = true;
        },
        allChildren,
    );
    const graphIndex = indexGraph(treeDescription, nodeIdMapping);
    return {
        instanceId: nextGraphInstanceId++,
        nodeIdMapping,
        graphIndex,
        graphStore: createGraphRenderingStore({expandedSubtrees, graphIndex}),
    };
}

export function QueryGraph(props: QueryGraphProps) {
    const {instanceId, nodeIdMapping, graphIndex, graphStore} = useMemo(
        () => createGraphState(props.treeDescription),
        [props.treeDescription],
    );

    // This artificial key remounts React Flow when the tree changes, keeping
    // its viewport, measurements, and animation state scoped to one graph.
    return (
        <ReactFlowProvider key={instanceId}>
            <GraphRenderingStoreContext.Provider value={graphStore}>
                <QueryGraphInternal {...props} nodeIdMapping={nodeIdMapping} treeParents={graphIndex.treeTopology.parents} />
            </GraphRenderingStoreContext.Provider>
        </ReactFlowProvider>
    );
}
