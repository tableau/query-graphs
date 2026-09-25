import {ReactFlow, MiniMap, MiniMapNode, Controls, ReactFlowProvider, useReactFlow} from "@xyflow/react";
import type {MiniMapNodeProps} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type {TreeDescription, TreeNode} from "../tree-description";
import {allChildren, visitTreeNodes} from "../tree-description";
import type {MouseEvent, ReactNode} from "react";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import cc from "classcat";
import {QueryNode} from "./QueryNode";
import type {QueryGraphNode} from "./QueryNode";
import {ColoredEdge} from "./ColoredEdge";
import {createGraphRenderingStore, GraphRenderingStoreContext, useGraphRenderingStore} from "./store";
import {AnimateGraphChangeContext, useAnimatedGraphLayout} from "./useAnimatedGraphLayout";
import {indexGraph} from "./graph-index";
import type {TreeParents} from "./tree-topology";
import {graphAnimationDuration, graphAnimationsEnabled} from "./animation-timing";
import {
    intersectRectangles,
    primaryDirectionOutsideRectangle,
    type RectangleDirection,
    type ScreenRectangle,
    viewportBetweenSideObstructions,
    visibleRectangleFraction,
} from "./viewport-geometry";
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
const offscreenDirections = ["above", "right", "below", "left"] as const;
const offscreenDirectionArrows: Record<RectangleDirection, string> = {
    above: "↑",
    right: "→",
    below: "↓",
    left: "←",
};

interface OffscreenHighlightIndicatorLayout {
    frame: {top: number; left: number; width: number; height: number};
    counts: Record<RectangleDirection, number>;
}

function getViewportObstacles(flowElement: HTMLElement): ScreenRectangle[] {
    return [...flowElement.querySelectorAll<HTMLElement>(".qg-viewport-obstacle")].map((obstacle) =>
        obstacle.getBoundingClientRect(),
    );
}

function equalIndicatorLayouts(
    left: OffscreenHighlightIndicatorLayout | undefined,
    right: OffscreenHighlightIndicatorLayout | undefined,
): boolean {
    if (left === undefined || right === undefined) return left === right;
    return (
        left.frame.top === right.frame.top &&
        left.frame.left === right.frame.left &&
        left.frame.width === right.frame.width &&
        left.frame.height === right.frame.height &&
        offscreenDirections.every((direction) => left.counts[direction] === right.counts[direction])
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
    let left = 16;
    let right = 16;
    for (const obstacle of viewportObstacles) {
        const coveredArea = intersectRectangles(flowBounds, obstacle);
        if (coveredArea === undefined) continue;
        // Reserve an explicitly marked panel's covered width on whichever
        // horizontal edge it is closest to.
        if (coveredArea.left - flowBounds.left <= flowBounds.right - coveredArea.right)
            left = Math.max(left, coveredArea.right - flowBounds.left + 16);
        else right = Math.max(right, flowBounds.right - coveredArea.left + 16);
    }
    // On narrow screens an expanded document can cover the entire graph. Do
    // not move the hidden canvas or leave it displaced after the panel closes.
    if (left + right >= flowBounds.right - flowBounds.left) return undefined;
    return {top: "16px", right: `${right}px`, bottom: "16px", left: `${left}px`} as const;
}

function QueryGraphInternal({treeDescription, children, nodeIdMapping, treeParents}: QueryGraphInternalProps) {
    const expandedSubtrees = useGraphRenderingStore((s) => s.expandedSubtrees);
    const visibleHighlightedNodeIds = useGraphRenderingStore((state) => state.visibleHighlightedNodeIds);
    const nodeRevealRequest = useGraphRenderingStore((state) => state.nodeRevealRequest);
    const animatedLayout = useAnimatedGraphLayout(treeDescription, nodeIdMapping, treeParents, expandedSubtrees);
    const flowElement = useRef<HTMLDivElement>(null);
    const indicatorUpdateFrame = useRef<number | undefined>(undefined);
    const [indicatorLayout, setIndicatorLayout] = useState<OffscreenHighlightIndicatorLayout>();
    const {fitView, getZoom} = useReactFlow<QueryGraphNode>();

    const scheduleIndicatorUpdate = useCallback(() => {
        indicatorUpdateFrame.current ??= requestAnimationFrame(() => {
            indicatorUpdateFrame.current = undefined;
            const element = flowElement.current;
            if (element === null || visibleHighlightedNodeIds.size === 0 || !animatedLayout.initialViewportReady) {
                setIndicatorLayout((current) => (current === undefined ? current : undefined));
                return;
            }
            const flowBounds = element.getBoundingClientRect();
            const obstacles = getViewportObstacles(element);
            const indicatorViewport = viewportBetweenSideObstructions(flowBounds, obstacles);
            if (indicatorViewport === undefined) {
                setIndicatorLayout((current) => (current === undefined ? current : undefined));
                return;
            }
            const counts: Record<RectangleDirection, number> = {above: 0, right: 0, below: 0, left: 0};
            for (const node of element.querySelectorAll<HTMLElement>(".react-flow__node")) {
                if (node.dataset.id === undefined || !visibleHighlightedNodeIds.has(node.dataset.id)) continue;
                const nodeBounds = node.getBoundingClientRect();
                if (visibleRectangleFraction(nodeBounds, flowBounds, obstacles) >= minimumVisibleNodeFraction) continue;
                counts[primaryDirectionOutsideRectangle(nodeBounds, indicatorViewport)]++;
            }
            if (offscreenDirections.every((direction) => counts[direction] === 0)) {
                setIndicatorLayout((current) => (current === undefined ? current : undefined));
                return;
            }
            const nextLayout = {
                frame: {
                    top: indicatorViewport.top - flowBounds.top,
                    left: indicatorViewport.left - flowBounds.left,
                    width: indicatorViewport.right - indicatorViewport.left,
                    height: indicatorViewport.bottom - indicatorViewport.top,
                },
                counts,
            };
            setIndicatorLayout((current) => (equalIndicatorLayouts(current, nextLayout) ? current : nextLayout));
        });
    }, [animatedLayout.initialViewportReady, visibleHighlightedNodeIds]);

    useEffect(() => {
        scheduleIndicatorUpdate();
        return () => {
            if (indicatorUpdateFrame.current !== undefined) cancelAnimationFrame(indicatorUpdateFrame.current);
            indicatorUpdateFrame.current = undefined;
        };
    }, [animatedLayout.nodes, scheduleIndicatorUpdate]);

    useEffect(() => {
        const element = flowElement.current;
        if (element === null) return;
        const observer = new ResizeObserver(scheduleIndicatorUpdate);
        observer.observe(element);
        for (const obstacle of element.querySelectorAll<HTMLElement>(".qg-viewport-obstacle")) observer.observe(obstacle);
        for (const node of element.querySelectorAll<HTMLElement>(".react-flow__node")) {
            if (node.dataset.id !== undefined && visibleHighlightedNodeIds.has(node.dataset.id)) observer.observe(node);
        }
        return () => observer.disconnect();
    }, [scheduleIndicatorUpdate, visibleHighlightedNodeIds]);

    useEffect(() => {
        if (nodeRevealRequest === undefined || !animatedLayout.initialViewportReady) return;
        // Hover is exploratory, so wait briefly before moving the viewport and
        // cancel the move when the pointer reaches another linked range first.
        const timer = window.setTimeout(() => {
            const element = flowElement.current;
            if (element === null) return;
            const viewportObstacles = getViewportObstacles(element);
            const nodeIds = [...nodeRevealRequest.nodeIds];
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
    }, [animatedLayout.initialViewportReady, fitView, getZoom, nodeRevealRequest]);
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
                onMove={scheduleIndicatorUpdate}
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
                {indicatorLayout === undefined ? null : (
                    <div
                        className="qg-offscreen-highlight-indicators"
                        style={indicatorLayout.frame}
                        role="note"
                        aria-label={`Offscreen highlighted nodes: ${offscreenDirections
                            .filter((direction) => indicatorLayout.counts[direction] > 0)
                            .map((direction) => {
                                const count = indicatorLayout.counts[direction];
                                return `${count} highlighted ${count === 1 ? "node" : "nodes"} ${direction}`;
                            })
                            .join(", ")}`}
                    >
                        {offscreenDirections.map((direction) => (
                            <span
                                key={direction}
                                className="qg-offscreen-highlight-indicator"
                                data-direction={direction}
                                hidden={indicatorLayout.counts[direction] === 0}
                                aria-hidden="true"
                            >
                                {offscreenDirectionArrows[direction]} {indicatorLayout.counts[direction]}
                            </span>
                        ))}
                    </div>
                )}
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
