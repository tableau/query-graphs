import type {Dimensions, InternalNode, NodeChange} from "@xyflow/react";
import {Position, useReactFlow} from "@xyflow/react";
import type {CSSProperties} from "react";
import {createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState} from "react";
import {assertNotNull} from "../assert";
import type {TreeDescription, TreeNode} from "../tree-description";
import type {QueryGraphNode} from "./QueryNode";
import {layoutTree} from "./tree-layout";
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

/** Returns the animation controller supplied by the surrounding query graph. */
export function useGraphAnimationController(): GraphAnimationController {
    const controller = useContext(GraphAnimationContext);
    assertNotNull(controller);
    return controller;
}

interface DimensionsState {
    nodeIds: Map<TreeNode, string>;
    measured: ReadonlyMap<string, Dimensions>;
    targets: ReadonlyMap<string, Dimensions>;
}

/** Discards dimensions when a new graph reuses the same string node IDs. */
function dimensionsForGraph(state: DimensionsState | undefined, nodeIds: Map<TreeNode, string>): DimensionsState {
    return state?.nodeIds === nodeIds ? state : {nodeIds, measured: new Map(), targets: new Map()};
}

interface BodyAnimation {
    element: HTMLElement;
    animationFrame?: number;
}

/** Restores CSS control of dimensions after measuring or animating a body. */
function clearBodySize(element: HTMLElement): void {
    for (const property of ["width", "height", "max-width", "max-height"]) element.style.removeProperty(property);
}

/** Tests dimensions by value so unchanged measurements retain their map identity. */
function sameDimensions(left: Dimensions | undefined, right: Dimensions): boolean {
    return left?.width === right.width && left.height === right.height;
}

/** Applies transient animation styles without replacing settled element styles. */
function withAnimationStyle(style: CSSProperties | undefined, opacity: number, transient: boolean): CSSProperties | undefined {
    if (opacity === 1 && !transient) return style;
    return {
        ...style,
        ...(opacity === 1 ? {} : {opacity}),
        ...(transient ? {pointerEvents: "none"} : {}),
    };
}

/**
 * Measures a node's expanded or collapsed dimensions without changing the
 * visible node. An invisible clone is necessary because the target CSS state
 * does not exist in the rendered graph yet.
 */
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
    clearBodySize(clonedBody);
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

/**
 * Converts React Flow's measured source-handle bounds into an offset from the
 * node position. Keeping the offset node-relative lets the anchor follow its
 * node while the surrounding layout moves.
 */
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

/** Assigns the gesture's handle anchor to every node entering or leaving this transition. */
function transitionAnchors(from: AnimatedLayout, to: GraphLayout, anchor: LayoutAnchor | undefined): TransitionAnchors {
    const anchors = new Map<string, LayoutAnchor>();
    if (anchor === undefined) return anchors;
    const fromNodeIds = new Set(from.nodes.map((entry) => entry.node.id));
    const toNodeIds = new Set(to.nodes.map((node) => node.id));
    for (const id of toNodeIds) if (!fromNodeIds.has(id)) anchors.set(id, anchor);
    for (const id of fromNodeIds) if (!toNodeIds.has(id)) anchors.set(id, anchor);
    return anchors;
}

/**
 * Computes and animates the measured query-graph layout consumed by React
 * Flow. Node measurements feed subsequent layouts; resize gestures coordinate
 * body and graph geometry, while subtree gestures stage unmeasured nodes at
 * their handle before animating them to the final layout.
 */
export function useAnimatedGraphLayout(
    treeDescription: TreeDescription,
    nodeIds: Map<TreeNode, string>,
    expandedSubtrees: Record<string, boolean>,
): GraphLayout & {
    onNodesChange: (changes: NodeChange<QueryGraphNode>[]) => void;
    animationController: GraphAnimationController;
} {
    const {fitView, getInternalNode} = useReactFlow<QueryGraphNode>();
    // Active entries both own their cleanup handles and mark dimensions whose
    // final target must be preserved while React Flow reports intermediate sizes.
    const bodyAnimationsRef = useRef(new Map<string, BodyAnimation>());
    const animationRef = useRef<LayoutAnimation | undefined>(undefined);
    const [dimensionsState, setDimensionsState] = useState<DimensionsState>(() => dimensionsForGraph(undefined, nodeIds));
    const dimensions = useMemo<DimensionsState>(() => dimensionsForGraph(dimensionsState, nodeIds), [dimensionsState, nodeIds]);
    // Intermediate measurements update the React Flow projection below, while
    // only stable target dimensions invalidate the comparatively costly layout.
    const target = useMemo(
        () => layoutTree(treeDescription, nodeIds, dimensions.targets, expandedSubtrees),
        [treeDescription, nodeIds, dimensions.targets, expandedSubtrees],
    );
    const targetMeasured = target.nodes.every((node) => dimensions.measured.has(node.id));

    // Record dimensions reported by React Flow. During a body resize, retain
    // the known final size as the layout target while its measured size moves.
    const onNodesChange = useCallback(
        (changes: NodeChange<QueryGraphNode>[]) => {
            const updates = changes.flatMap((change) => {
                if (change.type !== "dimensions" || change.dimensions === undefined) return [];
                return [[change.id, change.dimensions] as const];
            });
            if (updates.length === 0) return;
            setDimensionsState((current) => {
                const currentDimensions = dimensionsForGraph(current, nodeIds);
                let measuredDimensions: Map<string, Dimensions> | undefined;
                let targetDimensions: Map<string, Dimensions> | undefined;
                for (const [nodeId, measured] of updates) {
                    if (!sameDimensions(measuredDimensions?.get(nodeId) ?? currentDimensions.measured.get(nodeId), measured)) {
                        measuredDimensions ??= new Map(currentDimensions.measured);
                        measuredDimensions.set(nodeId, measured);
                    }
                    const target = bodyAnimationsRef.current.has(nodeId)
                        ? (targetDimensions?.get(nodeId) ?? currentDimensions.targets.get(nodeId) ?? measured)
                        : measured;
                    if (!sameDimensions(targetDimensions?.get(nodeId) ?? currentDimensions.targets.get(nodeId), target)) {
                        targetDimensions ??= new Map(currentDimensions.targets);
                        targetDimensions.set(nodeId, target);
                    }
                }
                if (measuredDimensions === undefined && targetDimensions === undefined && current.nodeIds === nodeIds)
                    return current;
                return {
                    nodeIds,
                    measured: measuredDimensions ?? currentDimensions.measured,
                    targets: targetDimensions ?? currentDimensions.targets,
                };
            });
        },
        [nodeIds],
    );

    // Stop direct DOM animation and restore CSS ownership of the body size.
    const stopBodyAnimation = useCallback((nodeId: string) => {
        const animation = bodyAnimationsRef.current.get(nodeId);
        if (animation === undefined) return;
        if (animation.animationFrame !== undefined) cancelAnimationFrame(animation.animationFrame);
        clearBodySize(animation.element);
        bodyAnimationsRef.current.delete(nodeId);
    }, []);

    // Gesture entry points measure their destination before changing the graph
    // so the ensuing render can immediately compute the correct target layout.
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
                    const currentDimensions = dimensionsForGraph(current, nodeIds);
                    const measured = currentDimensions.measured.has(animation.nodeId)
                        ? currentDimensions.measured
                        : new Map(currentDimensions.measured).set(animation.nodeId, animation.targetDimensions);
                    const targets = new Map(currentDimensions.targets).set(animation.nodeId, animation.targetDimensions);
                    return {nodeIds, measured, targets};
                });
                if (startedAt === undefined) {
                    animationRef.current = undefined;
                    updateGraph();
                    return;
                }

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

    // Reconcile each computed target with the currently rendered frame. New
    // nodes are first staged invisibly for measurement; ready targets animate
    // from the current frame so interrupted transitions remain continuous.
    useLayoutEffect(() => {
        const graphChanged = nodeIdsRef.current !== nodeIds;
        const targetDataChanged = targetRef.current !== target;
        const targetChanged = graphChanged || !sameLayoutTarget(targetRef.current, target);
        const animation = animationRef.current;
        const animationReady = animation !== undefined && targetMeasured && animationFrameRef.current === undefined;
        nodeIdsRef.current = nodeIds;
        targetRef.current = target;
        renderedRef.current = refreshLayoutData(renderedRef.current, target);
        // Measurements can recompute an equivalent target. Only restart when
        // its endpoint changes or staged nodes become measurable, but still
        // publish refreshed payload data from an equivalent target.
        if (!targetChanged && !animationReady) {
            if (targetDataChanged) setRendered(renderedRef.current);
            return;
        }

        const wasAnimating = animationFrameRef.current !== undefined;
        if (animationFrameRef.current !== undefined) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = undefined;
        }
        if (graphChanged) {
            initialFitDoneRef.current = false;
            for (const nodeId of bodyAnimationsRef.current.keys()) stopBodyAnimation(nodeId);
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

    // Fit only after the initial graph is fully measured and any transition
    // has settled, ensuring React Flow sees final node bounds.
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

    // Release both React Flow layout frames and direct body animations when
    // the graph unmounts.
    useEffect(
        () => () => {
            if (animationFrameRef.current !== undefined) cancelAnimationFrame(animationFrameRef.current);
            for (const nodeId of bodyAnimationsRef.current.keys()) stopBodyAnimation(nodeId);
        },
        [stopBodyAnimation],
    );

    // Payloads are refreshed when the target changes; rendering only overlays
    // animation styles on that data, including retained exiting elements.
    return useMemo(
        () => ({
            nodes: rendered.nodes.map(({node, position, opacity, transient}) => ({
                ...node,
                measured: dimensions.measured.get(node.id),
                position,
                style: withAnimationStyle(node.style, opacity, transient),
            })),
            edges: rendered.edges.map(({edge, opacity, transient}) => ({
                ...edge,
                style: withAnimationStyle(edge.style, opacity, transient),
                labelStyle: withAnimationStyle(edge.labelStyle, opacity, transient),
                labelBgStyle: withAnimationStyle(edge.labelBgStyle, opacity, transient),
                interactionWidth: transient ? 0 : edge.interactionWidth,
                selectable: transient ? false : edge.selectable,
                focusable: transient ? false : edge.focusable,
            })),
            onNodesChange,
            animationController,
        }),
        [animationController, dimensions.measured, onNodesChange, rendered],
    );
}
