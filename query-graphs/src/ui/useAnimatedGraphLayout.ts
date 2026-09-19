import type {Dimensions, InternalNode, NodeChange} from "@xyflow/react";
import {useReactFlow} from "@xyflow/react";
import type {CSSProperties} from "react";
import {createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState} from "react";
import {assertNotNull} from "../assert";
import type {TreeDescription, TreeNode} from "../tree-description";
import {allChildren} from "../tree-description";
import type {QueryGraphNode} from "./QueryNode";
import {layoutTree} from "./tree-layout";
import {animationStartTime, graphAnimationProgress} from "./animation-timing";
import type {AnimatedLayout, GraphLayout, LayoutAnchor, TransitionAnchors} from "./animated-layout";
import {createLayoutInterpolator, refreshLayoutData, sameLayoutTarget, staticLayout} from "./animated-layout";

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

interface BodyResize {
    element: HTMLElement;
    target: Dimensions;
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
    const bodyFrom = {width: bodyElement.offsetWidth, height: bodyElement.offsetHeight};

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
        bodyFrom,
        bodyTo,
    };
}

/**
 * Converts the center of React Flow's measured source-handle bounds into an
 * offset from the node position. Keeping the offset node-relative lets the
 * anchor follow its node while the surrounding layout moves.
 */
function measuredSourceAnchor(node: InternalNode<QueryGraphNode> | undefined, handleId: string): LayoutAnchor | undefined {
    const handle = node?.internals.handleBounds?.source?.find((candidate) => candidate.id === handleId);
    if (node === undefined || handle === undefined) return undefined;

    const x = node.internals.positionAbsolute.x + handle.x + handle.width / 2;
    const y = node.internals.positionAbsolute.y + handle.y + handle.height / 2;
    return {nodeId: node.id, offset: {x: x - node.position.x, y: y - node.position.y}};
}

/** Indexes every node's parent once, including currently collapsed children. */
function treeParents(tree: TreeDescription, nodeIds: Map<TreeNode, string>): ReadonlyMap<string, string> {
    const parents = new Map<string, string>();
    const pending: [TreeNode, string | undefined][] = [[tree.root, undefined]];
    while (pending.length > 0) {
        const [node, parentId] = pending.pop()!;
        const nodeId = nodeIds.get(node);
        assertNotNull(nodeId);
        if (parentId !== undefined) parents.set(nodeId, parentId);
        for (const child of allChildren(node)) pending.push([child, nodeId]);
    }
    return parents;
}

/**
 * Anchors each entering or exiting node at its nearest ancestor that remains
 * visible. Returns an empty map when membership is unchanged, or `undefined`
 * when a required anchor cannot be measured.
 *
 * Resolved paths and measured handles are cached, so every ancestry link is
 * followed at most once even when an entire deep subtree changes.
 */
export function transitionAnchors(
    from: AnimatedLayout,
    to: GraphLayout,
    parents: ReadonlyMap<string, string>,
    measureAnchor: (nodeId: string) => LayoutAnchor | undefined,
): TransitionAnchors | undefined {
    const anchors = new Map<string, LayoutAnchor>();
    const fromNodeIds = new Set(from.nodes.map((entry) => entry.node.id));
    const toNodeIds = new Set(to.nodes.map((node) => node.id));
    const visibleInBoth = new Set([...fromNodeIds].filter((id) => toNodeIds.has(id)));
    const resolvedAncestors = new Map<string, string | undefined>();
    const measuredAnchors = new Map<string, LayoutAnchor | undefined>();

    const addAnchor = (nodeId: string) => {
        const path: string[] = [];
        let ancestor: string | undefined = nodeId;
        while (ancestor !== undefined && !visibleInBoth.has(ancestor)) {
            if (resolvedAncestors.has(ancestor)) {
                ancestor = resolvedAncestors.get(ancestor);
                break;
            }
            path.push(ancestor);
            ancestor = parents.get(ancestor);
        }
        for (const traversed of path) resolvedAncestors.set(traversed, ancestor);
        if (ancestor === undefined) return false;

        if (!measuredAnchors.has(ancestor)) measuredAnchors.set(ancestor, measureAnchor(ancestor));
        const anchor = measuredAnchors.get(ancestor);
        if (anchor === undefined) return false;
        anchors.set(nodeId, anchor);
        return true;
    };

    for (const id of toNodeIds) if (!fromNodeIds.has(id) && !addAnchor(id)) return undefined;
    for (const id of fromNodeIds) if (!toNodeIds.has(id) && !addAnchor(id)) return undefined;
    return anchors;
}

/**
 * Computes and animates the measured query-graph layout consumed by React
 * Flow. Node measurements feed subsequent layouts; resize gestures coordinate
 * body and graph geometry, while subtree changes stage unmeasured nodes at
 * their nearest visible ancestor before animating them to the final layout.
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
    // Active entries own their target geometry and mark dimensions whose
    // final target must be preserved while React Flow reports intermediate sizes.
    const bodyResizesRef = useRef(new Map<string, BodyResize>());
    const animationRequestedRef = useRef(false);
    const animationFrameRef = useRef<number | undefined>(undefined);
    const [dimensionsState, setDimensionsState] = useState<DimensionsState>(() => dimensionsForGraph(undefined, nodeIds));
    const dimensions = useMemo<DimensionsState>(() => dimensionsForGraph(dimensionsState, nodeIds), [dimensionsState, nodeIds]);
    const parentIds = useMemo(() => treeParents(treeDescription, nodeIds), [treeDescription, nodeIds]);
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
                    const target = bodyResizesRef.current.has(nodeId)
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

    // Finish a resize by restoring CSS ownership of the body size.
    const finishBodyResize = useCallback((nodeId: string) => {
        const resize = bodyResizesRef.current.get(nodeId);
        if (resize === undefined) return;
        clearBodySize(resize.element);
        bodyResizesRef.current.delete(nodeId);
    }, []);

    const cancelLayoutFrame = useCallback(() => {
        if (animationFrameRef.current === undefined) return;
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = undefined;
    }, []);

    // Node-resize gestures measure their destination before changing the graph
    // so the ensuing render can immediately compute the correct target layout.
    const animationController = useMemo<GraphAnimationController>(
        () => ({
            animateNodeResize: (request, updateGraph) => {
                const animation = measureNodeResize(request);
                if (animation === undefined) {
                    finishBodyResize(request.nodeId);
                    animationRequestedRef.current = false;
                    updateGraph();
                    return;
                }
                finishBodyResize(animation.nodeId);
                setDimensionsState((current) => {
                    const currentDimensions = dimensionsForGraph(current, nodeIds);
                    const measured = currentDimensions.measured.has(animation.nodeId)
                        ? currentDimensions.measured
                        : new Map(currentDimensions.measured).set(animation.nodeId, animation.targetDimensions);
                    const targets = new Map(currentDimensions.targets).set(animation.nodeId, animation.targetDimensions);
                    return {nodeIds, measured, targets};
                });
                cancelLayoutFrame();
                animationRequestedRef.current = true;
                bodyResizesRef.current.set(animation.nodeId, {
                    element: animation.bodyElement,
                    target: animation.bodyTo,
                });
                animation.bodyElement.style.maxWidth = "none";
                animation.bodyElement.style.maxHeight = "none";
                animation.bodyElement.style.width = `${animation.bodyFrom.width}px`;
                animation.bodyElement.style.height = `${animation.bodyFrom.height}px`;
                updateGraph();
            },
        }),
        [cancelLayoutFrame, finishBodyResize, nodeIds],
    );

    const targetRef = useRef(target);
    const [rendered, setRendered] = useState(() => staticLayout(target));
    const renderedRef = useRef(rendered);
    const nodeIdsRef = useRef(nodeIds);
    const initialFitDoneRef = useRef(false);

    // Reconcile each computed target with the currently rendered frame. New
    // nodes are first staged invisibly for measurement; ready targets animate
    // from the current frame so interrupted transitions remain continuous.
    useLayoutEffect(() => {
        const graphChanged = nodeIdsRef.current !== nodeIds;
        const targetDataChanged = targetRef.current !== target;
        const targetChanged = graphChanged || !sameLayoutTarget(targetRef.current, target);
        const transitionAnchorMap = transitionAnchors(renderedRef.current, target, parentIds, (nodeId) =>
            measuredSourceAnchor(getInternalNode(nodeId), subtreeHandleId),
        );
        // Missing handles make origin-based interpolation worse than snapping.
        // Check reduced motion before staging new nodes invisibly for measurement.
        const subtreeChanged = !graphChanged && transitionAnchorMap !== undefined && transitionAnchorMap.size > 0;
        const animationRequested =
            transitionAnchorMap !== undefined &&
            (animationRequestedRef.current || (subtreeChanged && animationStartTime() !== undefined));
        animationRequestedRef.current = animationRequested;
        const anchors = transitionAnchorMap ?? new Map();
        const canStartAnimation = animationRequested && targetMeasured && animationFrameRef.current === undefined;
        nodeIdsRef.current = nodeIds;
        targetRef.current = target;
        renderedRef.current = refreshLayoutData(renderedRef.current, target);
        // Measurements can recompute an equivalent target. Only restart when
        // its endpoint changes or staged nodes become measurable, but still
        // publish refreshed payload data from an equivalent target.
        if (!targetChanged && !canStartAnimation) {
            if (targetDataChanged) setRendered(renderedRef.current);
            return;
        }

        cancelLayoutFrame();
        if (graphChanged) {
            initialFitDoneRef.current = false;
        }
        const settleLayout = () => {
            animationRequestedRef.current = false;
            for (const nodeId of bodyResizesRef.current.keys()) finishBodyResize(nodeId);
            const next = staticLayout(target);
            renderedRef.current = next;
            setRendered(next);
        };
        if (!animationRequested || graphChanged) {
            settleLayout();
            return;
        }

        // Newly revealed nodes have no dimensions yet. Render them invisibly at
        // the anchor so React Flow can measure them before computing the endpoint.
        if (!targetMeasured) {
            const interpolate = createLayoutInterpolator(renderedRef.current, target, anchors);
            const staged = interpolate(0);
            renderedRef.current = staged;
            setRendered(staged);
            return;
        }

        const startTime = animationStartTime();
        if (startTime === undefined) {
            settleLayout();
            return;
        }

        const start = renderedRef.current;
        // Retarget graph and body transitions from their current visual state.
        const interpolate = createLayoutInterpolator(start, target, anchors);
        const bodyTransitions = [...bodyResizesRef.current].map(([nodeId, body]) => ({
            nodeId,
            body,
            start: {width: body.element.offsetWidth, height: body.element.offsetHeight},
        }));
        const step = (now: number) => {
            const progress = graphAnimationProgress(startTime, now);
            for (const {body, start: bodyStart} of bodyTransitions) {
                body.element.style.width = `${bodyStart.width + (body.target.width - bodyStart.width) * progress}px`;
                body.element.style.height = `${bodyStart.height + (body.target.height - bodyStart.height) * progress}px`;
            }
            const interpolated = interpolate(progress);
            const next = targetRef.current === target ? interpolated : refreshLayoutData(interpolated, targetRef.current);
            renderedRef.current = next;
            setRendered(next);
            if (progress < 1) {
                animationFrameRef.current = requestAnimationFrame(step);
            } else {
                animationFrameRef.current = undefined;
                for (const {nodeId} of bodyTransitions) finishBodyResize(nodeId);
                animationRequestedRef.current = false;
            }
        };
        animationFrameRef.current = requestAnimationFrame(step);
    }, [cancelLayoutFrame, finishBodyResize, getInternalNode, nodeIds, parentIds, target, targetMeasured]);

    // Fit only after the initial graph is fully measured and any transition
    // has settled, ensuring React Flow sees final node bounds.
    useEffect(() => {
        if (
            initialFitDoneRef.current ||
            !targetMeasured ||
            animationRequestedRef.current ||
            animationFrameRef.current !== undefined
        )
            return;
        const animationFrame = requestAnimationFrame(() => {
            initialFitDoneRef.current = true;
            void fitView();
        });
        return () => cancelAnimationFrame(animationFrame);
    }, [fitView, rendered, targetMeasured]);

    // Cancel the shared animation frame and restore body sizing on unmount.
    useEffect(
        () => () => {
            cancelLayoutFrame();
            for (const nodeId of bodyResizesRef.current.keys()) finishBodyResize(nodeId);
        },
        [cancelLayoutFrame, finishBodyResize],
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
