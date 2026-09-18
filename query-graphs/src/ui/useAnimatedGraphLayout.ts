import type {Dimensions, InternalNode, NodeChange} from "@xyflow/react";
import {Position, useReactFlow} from "@xyflow/react";
import type {CSSProperties} from "react";
import {createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState} from "react";
import {assertNotNull} from "../assert";
import type {TreeDescription, TreeNode} from "../tree-description";
import type {QueryGraphNode} from "./QueryNode";
import {layoutTree} from "./tree-layout";
import type {GraphNodeDimensions} from "./tree-layout";
import {animationStartTime, graphAnimationProgress} from "./animation-timing";
import type {AnimatedLayout, GraphLayout, LayoutAnchor, TransitionAnchors} from "./animated-layout";
import {createLayoutInterpolator, refreshLayoutData, sameLayoutTarget, staticLayout} from "./animated-layout";

interface LayoutAnimation {
    kind: "resize" | "subtree";
    startedAt: number;
    // Entering and exiting nodes animate from or toward this measured handle.
    anchor?: LayoutAnchor;
}

interface NodeResizeRequest {
    nodeId: string;
    nodeElement: HTMLElement;
    targetExpanded: boolean;
}

interface NodeResizeAnimation {
    nodeId: string;
    targetDimensions: Dimensions;
    bodyElement: HTMLElement;
    bodyFrom: Dimensions;
    bodyTo: Dimensions;
}

export interface GraphAnimationController {
    animateNodeResize: (request: NodeResizeRequest, updateGraph: () => void) => void;
    animateSubtreeChange: (anchorNodeId: string, updateGraph: () => void) => void;
}

export const subtreeHandleId = "subtree";
export const GraphAnimationContext = createContext<GraphAnimationController | null>(null);

export function useGraphAnimationController(): GraphAnimationController {
    const controller = useContext(GraphAnimationContext);
    assertNotNull(controller);
    return controller;
}

interface DimensionsState {
    nodeIds: Map<TreeNode, string>;
    dimensions: ReadonlyMap<string, GraphNodeDimensions>;
}

interface BodyAnimation {
    element: HTMLElement;
    animationFrame?: number;
}

function withAnimationStyle(style: CSSProperties | undefined, opacity: number, transient: boolean): CSSProperties | undefined {
    if (opacity === 1 && !transient) return style;
    return {
        ...style,
        ...(opacity === 1 ? {} : {opacity}),
        ...(transient ? {pointerEvents: "none"} : {}),
    };
}

function measureNodeResize({nodeId, nodeElement, targetExpanded}: NodeResizeRequest): NodeResizeAnimation | undefined {
    const flowNode = nodeElement.closest<HTMLElement>(".react-flow__node");
    const bodyElement = nodeElement.querySelector<HTMLElement>(".qg-graph-node-body-wrapper");
    if (flowNode === null || flowNode.parentElement === null || bodyElement === null) return undefined;
    const flowContainer = flowNode.parentElement;

    const clone = flowNode.cloneNode(true) as HTMLElement;
    const clonedNode = clone.querySelector<HTMLElement>(".qg-graph-node");
    const clonedBody = clone.querySelector<HTMLElement>(".qg-graph-node-body-wrapper");
    if (clonedNode === null || clonedBody === null) return undefined;
    clone.style.position = "fixed";
    clone.style.transform = "none";
    clone.style.visibility = "hidden";
    clone.style.pointerEvents = "none";
    clonedNode.classList.toggle("qg-expanded", targetExpanded);
    clonedBody.style.removeProperty("width");
    clonedBody.style.removeProperty("height");
    clonedBody.style.removeProperty("max-width");
    clonedBody.style.removeProperty("max-height");
    flowContainer.append(clone);
    const targetDimensions = {width: clone.offsetWidth, height: clone.offsetHeight};
    const bodyTo = {width: clonedBody.offsetWidth, height: clonedBody.offsetHeight};
    clone.remove();
    if (targetDimensions.width === 0 || targetDimensions.height === 0) return undefined;
    return {
        nodeId,
        targetDimensions,
        bodyElement,
        bodyFrom: {width: bodyElement.offsetWidth, height: bodyElement.offsetHeight},
        bodyTo,
    };
}

function measuredSourceAnchor(node: InternalNode<QueryGraphNode> | undefined, handleId: string): LayoutAnchor | undefined {
    const handle = node?.internals.handleBounds?.source?.find((candidate) => candidate.id === handleId);
    if (node === undefined || handle === undefined) return undefined;

    const horizontal = handle.position === Position.Left || handle.position === Position.Right;
    const x =
        node.internals.positionAbsolute.x +
        handle.x +
        (horizontal ? (handle.position === Position.Right ? handle.width : 0) : handle.width / 2);
    const y =
        node.internals.positionAbsolute.y +
        handle.y +
        (horizontal ? handle.height / 2 : handle.position === Position.Bottom ? handle.height : 0);
    return {nodeId: node.id, offset: {x: x - node.position.x, y: y - node.position.y}};
}

function transitionAnchors(from: AnimatedLayout, to: GraphLayout, anchor: LayoutAnchor | undefined): TransitionAnchors {
    const anchors = new Map<string, LayoutAnchor>();
    if (anchor === undefined) return anchors;
    const fromNodeIds = new Set(from.nodes.map((entry) => entry.node.id));
    const toNodeIds = new Set(to.nodes.map((node) => node.id));
    for (const id of toNodeIds) if (!fromNodeIds.has(id)) anchors.set(id, anchor);
    for (const id of fromNodeIds) if (!toNodeIds.has(id)) anchors.set(id, anchor);
    return anchors;
}

export function useAnimatedGraphLayout(
    treeDescription: TreeDescription,
    nodeIds: Map<TreeNode, string>,
    expandedSubtrees: Record<string, boolean>,
): GraphLayout & {
    onNodesChange: (changes: NodeChange<QueryGraphNode>[]) => void;
    animationController: GraphAnimationController;
} {
    const {fitView, getInternalNode} = useReactFlow<QueryGraphNode>();
    const activeResizeNodesRef = useRef(new Set<string>());
    const bodyAnimationsRef = useRef(new Map<string, BodyAnimation>());
    const animationRef = useRef<LayoutAnimation | undefined>(undefined);
    const [dimensionsState, setDimensionsState] = useState<DimensionsState>(() => ({
        nodeIds,
        dimensions: new Map(),
    }));
    const nodeDimensions = useMemo(
        () => (dimensionsState.nodeIds === nodeIds ? dimensionsState.dimensions : new Map<string, GraphNodeDimensions>()),
        [dimensionsState, nodeIds],
    );
    const target = useMemo(
        () => layoutTree(treeDescription, nodeIds, nodeDimensions, expandedSubtrees),
        [treeDescription, nodeIds, nodeDimensions, expandedSubtrees],
    );
    const targetMeasured = target.nodes.every((node) => nodeDimensions.has(node.id));

    const onNodesChange = useCallback(
        (changes: NodeChange<QueryGraphNode>[]) => {
            const updates = changes.flatMap((change) => {
                if (change.type !== "dimensions" || change.dimensions === undefined) return [];
                return [[change.id, change.dimensions] as const];
            });
            if (updates.length === 0) return;
            setDimensionsState((current) => {
                const currentDimensions = current.nodeIds === nodeIds ? current.dimensions : new Map<string, GraphNodeDimensions>();
                let next: Map<string, GraphNodeDimensions> | undefined;
                for (const [nodeId, measured] of updates) {
                    const previous = currentDimensions.get(nodeId);
                    const targetDimensions = activeResizeNodesRef.current.has(nodeId) ? (previous?.target ?? measured) : measured;
                    if (
                        previous?.measured.width === measured.width &&
                        previous.measured.height === measured.height &&
                        previous.target.width === targetDimensions.width &&
                        previous.target.height === targetDimensions.height
                    )
                        continue;
                    next ??= new Map(currentDimensions);
                    next.set(nodeId, {measured, target: targetDimensions});
                }
                if (next === undefined && current.nodeIds === nodeIds) return current;
                return {nodeIds, dimensions: next ?? currentDimensions};
            });
        },
        [nodeIds],
    );

    const stopBodyAnimation = useCallback((nodeId: string) => {
        const animation = bodyAnimationsRef.current.get(nodeId);
        if (animation === undefined) return;
        if (animation.animationFrame !== undefined) cancelAnimationFrame(animation.animationFrame);
        animation.element.style.removeProperty("width");
        animation.element.style.removeProperty("height");
        animation.element.style.removeProperty("max-width");
        animation.element.style.removeProperty("max-height");
        bodyAnimationsRef.current.delete(nodeId);
        activeResizeNodesRef.current.delete(nodeId);
    }, []);

    const animationController = useMemo<GraphAnimationController>(
        () => ({
            animateNodeResize: (request, updateGraph) => {
                const animation = measureNodeResize(request);
                if (animation === undefined) {
                    stopBodyAnimation(request.nodeId);
                    animationRef.current = undefined;
                    updateGraph();
                    return;
                }
                const startedAt = animationStartTime();
                stopBodyAnimation(animation.nodeId);
                setDimensionsState((current) => {
                    const currentDimensions =
                        current.nodeIds === nodeIds ? current.dimensions : new Map<string, GraphNodeDimensions>();
                    const previous = currentDimensions.get(animation.nodeId);
                    const dimensions = new Map(currentDimensions);
                    dimensions.set(animation.nodeId, {
                        measured: previous?.measured ?? animation.targetDimensions,
                        target: animation.targetDimensions,
                    });
                    return {nodeIds, dimensions};
                });
                if (startedAt === undefined) {
                    animationRef.current = undefined;
                    updateGraph();
                    return;
                }

                activeResizeNodesRef.current.add(animation.nodeId);
                animationRef.current = {kind: "resize", startedAt};

                const bodyAnimation: BodyAnimation = {element: animation.bodyElement};
                bodyAnimationsRef.current.set(animation.nodeId, bodyAnimation);
                animation.bodyElement.style.maxWidth = "none";
                animation.bodyElement.style.maxHeight = "none";
                const step = (now: number) => {
                    const progress = graphAnimationProgress(startedAt, now);
                    const width = animation.bodyFrom.width + (animation.bodyTo.width - animation.bodyFrom.width) * progress;
                    const height = animation.bodyFrom.height + (animation.bodyTo.height - animation.bodyFrom.height) * progress;
                    animation.bodyElement.style.width = `${width}px`;
                    animation.bodyElement.style.height = `${height}px`;
                    if (progress < 1) {
                        bodyAnimation.animationFrame = requestAnimationFrame(step);
                    } else if (bodyAnimationsRef.current.get(animation.nodeId) === bodyAnimation) {
                        stopBodyAnimation(animation.nodeId);
                    }
                };
                step(startedAt);
                updateGraph();
            },
            animateSubtreeChange: (anchorNodeId, updateGraph) => {
                const anchor = measuredSourceAnchor(getInternalNode(anchorNodeId), subtreeHandleId);
                const startedAt = anchor === undefined ? undefined : animationStartTime();
                animationRef.current = startedAt === undefined ? undefined : {kind: "subtree", startedAt, anchor};
                updateGraph();
            },
        }),
        [getInternalNode, nodeIds, stopBodyAnimation],
    );

    const targetRef = useRef(target);
    const [rendered, setRendered] = useState(() => staticLayout(target));
    const renderedRef = useRef(rendered);
    const nodeIdsRef = useRef(nodeIds);
    const initialFitDoneRef = useRef(false);
    const animationFrameRef = useRef<number | undefined>(undefined);

    useLayoutEffect(() => {
        const graphChanged = nodeIdsRef.current !== nodeIds;
        const targetChanged = graphChanged || !sameLayoutTarget(targetRef.current, target);
        const animation = animationRef.current;
        const animationReady = animation !== undefined && targetMeasured && animationFrameRef.current === undefined;
        nodeIdsRef.current = nodeIds;
        targetRef.current = target;
        renderedRef.current = refreshLayoutData(renderedRef.current, target);
        // Measurements can recompute an equivalent target. Only restart when
        // its endpoint changes or staged nodes become measurable.
        if (!targetChanged && !animationReady) return;

        const wasAnimating = animationFrameRef.current !== undefined;
        if (animationFrameRef.current !== undefined) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = undefined;
        }
        if (graphChanged) {
            initialFitDoneRef.current = false;
            for (const nodeId of [...bodyAnimationsRef.current.keys()]) stopBodyAnimation(nodeId);
        }
        if (animation === undefined || graphChanged) {
            animationRef.current = undefined;
            const next = staticLayout(target);
            renderedRef.current = next;
            setRendered(next);
            return;
        }

        // Newly revealed nodes have no dimensions yet. Render them invisibly at
        // the anchor so React Flow can measure them before computing the endpoint.
        if (!targetMeasured) {
            const interpolate = createLayoutInterpolator(
                renderedRef.current,
                target,
                transitionAnchors(renderedRef.current, target, animation.anchor),
            );
            const staged = interpolate(0);
            renderedRef.current = staged;
            setRendered(staged);
            return;
        }

        const start = renderedRef.current;
        // Retarget an active transition from its current frame instead of
        // snapping or jumping ahead on the original easing curve.
        const startTime = wasAnimating || animation.kind === "subtree" ? performance.now() : animation.startedAt;
        const anchors = transitionAnchors(start, target, animation.anchor);
        const interpolate = createLayoutInterpolator(start, target, anchors);
        const step = (now: number) => {
            const progress = graphAnimationProgress(startTime, now);
            const interpolated = interpolate(progress);
            const next = targetRef.current === target ? interpolated : refreshLayoutData(interpolated, targetRef.current);
            renderedRef.current = next;
            setRendered(next);
            if (progress < 1) {
                animationFrameRef.current = requestAnimationFrame(step);
            } else {
                animationFrameRef.current = undefined;
                if (animationRef.current === animation) animationRef.current = undefined;
            }
        };
        animationFrameRef.current = requestAnimationFrame(step);
    }, [nodeIds, stopBodyAnimation, target, targetMeasured]);

    useEffect(() => {
        if (
            initialFitDoneRef.current ||
            !targetMeasured ||
            animationRef.current !== undefined ||
            animationFrameRef.current !== undefined
        )
            return;
        const animationFrame = requestAnimationFrame(() => {
            initialFitDoneRef.current = true;
            void fitView();
        });
        return () => cancelAnimationFrame(animationFrame);
    }, [fitView, rendered, targetMeasured]);

    useEffect(
        () => () => {
            if (animationFrameRef.current !== undefined) cancelAnimationFrame(animationFrameRef.current);
            for (const nodeId of [...bodyAnimationsRef.current.keys()]) stopBodyAnimation(nodeId);
        },
        [stopBodyAnimation],
    );

    const targetNodes = useMemo(() => new Map(target.nodes.map((node) => [node.id, node])), [target.nodes]);
    const targetEdges = useMemo(() => new Map(target.edges.map((edge) => [edge.id, edge])), [target.edges]);
    return useMemo(
        () => ({
            nodes: rendered.nodes.map(({node, position, opacity, transient}) => {
                const latest = targetNodes.get(node.id) ?? node;
                return {
                    ...latest,
                    position,
                    style: withAnimationStyle(latest.style, opacity, transient),
                };
            }),
            edges: rendered.edges.map(({edge, opacity, transient}) => {
                const latest = targetEdges.get(edge.id) ?? edge;
                return {
                    ...latest,
                    style: withAnimationStyle(latest.style, opacity, transient),
                    labelStyle: withAnimationStyle(latest.labelStyle, opacity, transient),
                    labelBgStyle: withAnimationStyle(latest.labelBgStyle, opacity, transient),
                    interactionWidth: transient ? 0 : latest.interactionWidth,
                    selectable: transient ? false : latest.selectable,
                    focusable: transient ? false : latest.focusable,
                };
            }),
            onNodesChange,
            animationController,
        }),
        [animationController, onNodesChange, rendered, targetEdges, targetNodes],
    );
}
