/**
 * Coordinates animated query-graph changes with React Flow. `QueryGraph` passes
 * the returned nodes, edges, and `onNodesChange` callback to React Flow and
 * exposes `animateGraphChange` to nodes. Callers wrap synchronous graph updates
 * in that callback and identify persistent nodes whose bodies may resize.
 *
 * Pure layout transitions live in `animated-layout.ts`; this module coordinates
 * React state, React Flow measurements, DOM body measurements, and animation
 * frames.
 */
import type {Dimensions, InternalNode, NodeChange} from "@xyflow/react";
import {useReactFlow} from "@xyflow/react";
import type {CSSProperties} from "react";
import {createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState} from "react";
import {assertNotNull} from "../assert";
import type {TreeDescription, TreeNode} from "../tree-description";
import type {QueryGraphNode} from "./QueryNode";
import {layoutTree} from "./tree-layout";
import {animationStartTime, graphAnimationProgress} from "./animation-timing";
import type {GraphLayout, LayoutAnchor} from "./animated-layout";
import {
    createLayoutInterpolator,
    refreshLayoutData,
    sameLayoutTarget,
    staticLayout,
    transitionAnchors,
    treeParents,
} from "./animated-layout";

interface NodeResizeRequest {
    nodeId: string;
    nodeElement: HTMLElement;
}

/**
 * Animates a graph change applied synchronously by `applyChange`. List
 * persistent nodes whose bodies may resize; entering and exiting nodes are
 * inferred from the resulting layout.
 */
export type AnimateGraphChange = (applyChange: () => void, resizingNodes?: readonly NodeResizeRequest[]) => void;

/** Makes the surrounding query graph's animation callback available to nodes. */
export const AnimateGraphChangeContext = createContext<AnimateGraphChange | null>(null);

/** Returns the graph-change animator supplied by the surrounding query graph. */
export function useAnimateGraphChange(): AnimateGraphChange {
    const animateGraphChange = useContext(AnimateGraphChangeContext);
    assertNotNull(animateGraphChange);
    return animateGraphChange;
}

/** Identifies the source handle from which changed subtrees emerge or recede. */
export const subtreeHandleId = "subtree";

interface DimensionsState {
    nodeIds: Map<TreeNode, string>;
    measured: ReadonlyMap<string, Dimensions>;
    targets: ReadonlyMap<string, Dimensions>;
}

/** Discards dimensions when a new graph reuses the same string node IDs. */
function dimensionsForGraph(state: DimensionsState | undefined, nodeIds: Map<TreeNode, string>): DimensionsState {
    return state?.nodeIds === nodeIds ? state : {nodeIds, measured: new Map(), targets: new Map()};
}

/** Tests dimensions by value so unchanged measurements retain their map identity. */
function sameDimensions(left: Dimensions | undefined, right: Dimensions): boolean {
    return left?.width === right.width && left.height === right.height;
}

/**
 * Reconciles dimensions reported by React Flow. Measured dimensions describe
 * the current rendered frame; target dimensions drive the stable tree layout.
 * Active body resizes therefore retain their target until the new final size
 * is measured. When nothing changes, this returns `current`; when only one set
 * of dimensions changes, the other map is reused.
 */
export function reconcileDimensions(
    current: DimensionsState,
    nodeIds: Map<TreeNode, string>,
    updates: readonly (readonly [string, Dimensions])[],
    resizingNodeIds: Pick<ReadonlySet<string>, "has">,
): DimensionsState {
    const dimensions = dimensionsForGraph(current, nodeIds);
    let measuredDimensions: Map<string, Dimensions> | undefined;
    let targetDimensions: Map<string, Dimensions> | undefined;
    for (const [nodeId, measured] of updates) {
        if (!sameDimensions(measuredDimensions?.get(nodeId) ?? dimensions.measured.get(nodeId), measured)) {
            measuredDimensions ??= new Map(dimensions.measured);
            measuredDimensions.set(nodeId, measured);
        }
        const target = resizingNodeIds.has(nodeId)
            ? (targetDimensions?.get(nodeId) ?? dimensions.targets.get(nodeId) ?? measured)
            : measured;
        if (!sameDimensions(targetDimensions?.get(nodeId) ?? dimensions.targets.get(nodeId), target)) {
            targetDimensions ??= new Map(dimensions.targets);
            targetDimensions.set(nodeId, target);
        }
    }
    if (measuredDimensions === undefined && targetDimensions === undefined && current.nodeIds === nodeIds) return current;
    return {
        nodeIds,
        measured: measuredDimensions ?? dimensions.measured,
        targets: targetDimensions ?? dimensions.targets,
    };
}

interface BodyResize {
    nodeElement: HTMLElement;
    bodyElement: HTMLElement;
    bodyStart: Dimensions;
    bodyTarget?: Dimensions;
}

/**
 * Captures a body's current size before a graph change. `nodeElement` is a
 * descendant of the containing React Flow node, whose body supplies the
 * independently animated dimensions.
 */
function captureBodyResize({nodeElement}: NodeResizeRequest): BodyResize | undefined {
    const flowNode = nodeElement.closest<HTMLElement>(".react-flow__node");
    if (flowNode === null) return undefined;
    const bodyElement = flowNode.querySelector<HTMLElement>(".qg-graph-node-body-wrapper");
    if (bodyElement === null) return undefined;
    return {
        nodeElement: flowNode,
        bodyElement,
        bodyStart: {width: bodyElement.offsetWidth, height: bodyElement.offsetHeight},
    };
}

/**
 * Measures every post-render target before freezing any body at its captured
 * size, keeping DOM reads ahead of writes to avoid repeated layout. Mutates
 * both the resize registry and body styles. Returns `undefined` when no resize
 * is awaiting measurement.
 */
export function measurePendingBodyResizes(resizes: Map<string, BodyResize>): Map<string, Dimensions> | undefined {
    const pending = [...resizes].filter(([, resize]) => resize.bodyTarget === undefined);
    if (pending.length === 0) return undefined;

    const measurements = pending.map(([nodeId, resize]) => ({
        nodeId,
        resize,
        nodeTarget: {width: resize.nodeElement.offsetWidth, height: resize.nodeElement.offsetHeight},
        bodyTarget: {width: resize.bodyElement.offsetWidth, height: resize.bodyElement.offsetHeight},
    }));
    const targets = new Map<string, Dimensions>();
    for (const {nodeId, resize, nodeTarget, bodyTarget} of measurements) {
        if (nodeTarget.width === 0 || nodeTarget.height === 0) {
            clearBodySize(resize.bodyElement);
            resizes.delete(nodeId);
            continue;
        }
        targets.set(nodeId, nodeTarget);
        resize.bodyTarget = bodyTarget;
        resize.bodyElement.style.maxWidth = "none";
        resize.bodyElement.style.maxHeight = "none";
        resize.bodyElement.style.width = `${resize.bodyStart.width}px`;
        resize.bodyElement.style.height = `${resize.bodyStart.height}px`;
    }
    return targets;
}

/** Restores CSS control of dimensions after measuring or animating a body. */
function clearBodySize(element: HTMLElement): void {
    for (const property of ["width", "height", "max-width", "max-height"]) element.style.removeProperty(property);
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
    animateGraphChange: AnimateGraphChange;
} {
    // React Flow services used to resolve handles and fit the initial graph.
    const {fitView, getInternalNode} = useReactFlow<QueryGraphNode>();

    // Current measurements and the stable layout endpoint derived from them.
    const [dimensionsState, setDimensionsState] = useState<DimensionsState>(() => dimensionsForGraph(undefined, nodeIds));
    const dimensions = useMemo<DimensionsState>(() => dimensionsForGraph(dimensionsState, nodeIds), [dimensionsState, nodeIds]);
    const parentIds = useMemo(() => treeParents(treeDescription, nodeIds), [treeDescription, nodeIds]);
    // Intermediate measurements update the React Flow projection below, while
    // only stable target dimensions invalidate the comparatively costly layout.
    const targetLayout = useMemo(
        () => layoutTree(treeDescription, nodeIds, dimensions.targets, expandedSubtrees),
        [treeDescription, nodeIds, dimensions.targets, expandedSubtrees],
    );
    const targetLayoutMeasured = targetLayout.nodes.every((node) => dimensions.measured.has(node.id));

    // Pending body resizes and scheduling state for the shared animation clock.
    const bodyResizesRef = useRef(new Map<string, BodyResize>());
    const animationRequestedRef = useRef(false);
    const animationFrameRef = useRef<number | undefined>(undefined);
    const [graphChangeRevision, setGraphChangeRevision] = useState(0);

    // Last reconciled identities and layouts used across interrupted renders.
    const targetLayoutRef = useRef(targetLayout);
    const [renderedLayout, setRenderedLayout] = useState(() => staticLayout(targetLayout));
    const renderedLayoutRef = useRef(renderedLayout);
    const nodeIdsRef = useRef(nodeIds);
    const initialFitDoneRef = useRef(false);

    // Record dimensions reported by React Flow. During a body resize, retain
    // the known final size as the layout target while its measured size moves.
    const onNodesChange = useCallback(
        (changes: NodeChange<QueryGraphNode>[]) => {
            const updates = changes.flatMap((change) => {
                if (change.type !== "dimensions" || change.dimensions === undefined) return [];
                return [[change.id, change.dimensions] as const];
            });
            if (updates.length === 0) return;
            setDimensionsState((current) => reconcileDimensions(current, nodeIds, updates, bodyResizesRef.current));
        },
        [nodeIds],
    );

    // Finish a resize by restoring CSS ownership of the body size.
    const finishBodyResize = useCallback((nodeId: string) => {
        const resize = bodyResizesRef.current.get(nodeId);
        if (resize === undefined) return;
        clearBodySize(resize.bodyElement);
        bodyResizesRef.current.delete(nodeId);
    }, []);

    const cancelLayoutFrame = useCallback(() => {
        if (animationFrameRef.current === undefined) return;
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = undefined;
    }, []);

    // Capture resizing bodies before applying arbitrary graph state. Entering
    // and exiting nodes are inferred from the resulting layout below.
    const animateGraphChange = useCallback<AnimateGraphChange>(
        (applyChange, resizingNodes = []) => {
            const motionEnabled = animationStartTime() !== undefined;
            // Read every starting size before clearing interrupted styles.
            const resizes = new Map<string, BodyResize>(
                motionEnabled
                    ? resizingNodes.flatMap((request) => {
                          const resize = captureBodyResize(request);
                          return resize === undefined ? [] : [[request.nodeId, resize] as const];
                      })
                    : [],
            );
            cancelLayoutFrame();
            if (motionEnabled) {
                for (const {nodeId} of resizingNodes) finishBodyResize(nodeId);
                for (const [nodeId, resize] of resizes) bodyResizesRef.current.set(nodeId, resize);
            } else {
                for (const nodeId of bodyResizesRef.current.keys()) finishBodyResize(nodeId);
            }
            animationRequestedRef.current = motionEnabled;
            applyChange();
            setGraphChangeRevision((revision) => revision + 1);
        },
        [cancelLayoutFrame, finishBodyResize],
    );

    // Reconcile each computed target with the currently rendered frame. New
    // nodes are first staged invisibly for measurement; ready targets animate
    // from the current frame so interrupted transitions remain continuous.
    useLayoutEffect(() => {
        // Finish pending body measurement before reconciling the layout endpoint.
        const resizeTargets = measurePendingBodyResizes(bodyResizesRef.current);
        if (resizeTargets !== undefined && resizeTargets.size > 0) {
            setDimensionsState((current) => {
                const currentDimensions = dimensionsForGraph(current, nodeIds);
                const targets = new Map(currentDimensions.targets);
                for (const [nodeId, nodeTarget] of resizeTargets) targets.set(nodeId, nodeTarget);
                return {...currentDimensions, nodeIds, targets};
            });
            return;
        }

        // Classify the endpoint and resolve independent subtree transition origins.
        const graphChanged = nodeIdsRef.current !== nodeIds;
        const targetLayoutDataChanged = targetLayoutRef.current !== targetLayout;
        const targetLayoutChanged = graphChanged || !sameLayoutTarget(targetLayoutRef.current, targetLayout);
        const transitionAnchorMap = transitionAnchors(renderedLayoutRef.current, targetLayout, parentIds, (nodeId) =>
            measuredSourceAnchor(getInternalNode(nodeId), subtreeHandleId),
        );
        // Missing handles make origin-based interpolation worse than snapping.
        // The graph-change callback checks reduced motion before staging new nodes;
        // layout changes outside an explicit transaction settle immediately.
        const animationRequested = transitionAnchorMap !== undefined && animationRequestedRef.current;
        animationRequestedRef.current = animationRequested;
        const anchors = transitionAnchorMap ?? new Map();
        const canStartAnimation = animationRequested && targetLayoutMeasured && animationFrameRef.current === undefined;
        nodeIdsRef.current = nodeIds;
        targetLayoutRef.current = targetLayout;
        renderedLayoutRef.current = refreshLayoutData(renderedLayoutRef.current, targetLayout);
        // Publish payload-only updates without restarting equivalent geometry.
        // Staged nodes becoming measurable still need to start their animation.
        if (!targetLayoutChanged && !canStartAnimation) {
            if (targetLayoutDataChanged) setRenderedLayout(renderedLayoutRef.current);
            return;
        }

        // Choose between settling immediately, staging nodes, and animating.
        cancelLayoutFrame();
        if (graphChanged) {
            initialFitDoneRef.current = false;
        }
        const settleLayout = () => {
            animationRequestedRef.current = false;
            for (const nodeId of bodyResizesRef.current.keys()) finishBodyResize(nodeId);
            const next = staticLayout(targetLayout);
            renderedLayoutRef.current = next;
            setRenderedLayout(next);
        };
        if (!animationRequested || graphChanged) {
            settleLayout();
            return;
        }

        // Newly revealed nodes have no dimensions yet. Render them invisibly at
        // the anchor so React Flow can measure them before computing the endpoint.
        if (!targetLayoutMeasured) {
            const interpolate = createLayoutInterpolator(renderedLayoutRef.current, targetLayout, anchors);
            const staged = interpolate(0);
            renderedLayoutRef.current = staged;
            setRenderedLayout(staged);
            return;
        }

        const startTime = animationStartTime();
        if (startTime === undefined) {
            settleLayout();
            return;
        }

        const start = renderedLayoutRef.current;
        // Retarget graph and body transitions from their current visual state.
        const interpolate = createLayoutInterpolator(start, targetLayout, anchors);
        const bodyTransitions = [...bodyResizesRef.current].map(([nodeId, body]) => {
            assertNotNull(body.bodyTarget);
            return {
                nodeId,
                element: body.bodyElement,
                target: body.bodyTarget,
                start: {width: body.bodyElement.offsetWidth, height: body.bodyElement.offsetHeight},
            };
        });
        const step = (now: number) => {
            const progress = graphAnimationProgress(startTime, now);
            for (const {element, target: bodyTarget, start: bodyStart} of bodyTransitions) {
                element.style.width = `${bodyStart.width + (bodyTarget.width - bodyStart.width) * progress}px`;
                element.style.height = `${bodyStart.height + (bodyTarget.height - bodyStart.height) * progress}px`;
            }
            const interpolated = interpolate(progress);
            const next =
                targetLayoutRef.current === targetLayout ? interpolated : refreshLayoutData(interpolated, targetLayoutRef.current);
            renderedLayoutRef.current = next;
            setRenderedLayout(next);
            if (progress < 1) {
                animationFrameRef.current = requestAnimationFrame(step);
            } else {
                animationFrameRef.current = undefined;
                for (const {nodeId} of bodyTransitions) finishBodyResize(nodeId);
                animationRequestedRef.current = false;
            }
        };
        animationFrameRef.current = requestAnimationFrame(step);
    }, [
        cancelLayoutFrame,
        finishBodyResize,
        getInternalNode,
        graphChangeRevision,
        nodeIds,
        parentIds,
        targetLayout,
        targetLayoutMeasured,
    ]);

    // Fit only after the initial graph is fully measured and any transition
    // has settled, ensuring React Flow sees final node bounds.
    useEffect(() => {
        if (
            initialFitDoneRef.current ||
            !targetLayoutMeasured ||
            animationRequestedRef.current ||
            animationFrameRef.current !== undefined
        )
            return;
        const animationFrame = requestAnimationFrame(() => {
            initialFitDoneRef.current = true;
            void fitView();
        });
        return () => cancelAnimationFrame(animationFrame);
    }, [fitView, renderedLayout, targetLayoutMeasured]);

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
            nodes: renderedLayout.nodes.map(({node, position, opacity, transient}) => ({
                ...node,
                measured: dimensions.measured.get(node.id),
                position,
                style: withAnimationStyle(node.style, opacity, transient),
            })),
            edges: renderedLayout.edges.map(({edge, opacity, transient}) => ({
                ...edge,
                style: withAnimationStyle(edge.style, opacity, transient),
                labelStyle: withAnimationStyle(edge.labelStyle, opacity, transient),
                labelBgStyle: withAnimationStyle(edge.labelBgStyle, opacity, transient),
                interactionWidth: transient ? 0 : edge.interactionWidth,
                selectable: transient ? false : edge.selectable,
                focusable: transient ? false : edge.focusable,
            })),
            onNodesChange,
            animateGraphChange,
        }),
        [animateGraphChange, dimensions.measured, onNodesChange, renderedLayout],
    );
}
