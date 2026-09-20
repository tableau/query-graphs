/**
 * Coordinates animated query-graph changes with React Flow.
 * Pass the returned nodes, edges, and `onNodesChange` callback to React Flow and
 * set up an `AnimateGraphChangeContext.Provider`. Via `useAnimateGraphChange`,
 * you can then request animations.
 *
 * Pure layout transitions live in `animated-layout.ts`; this module coordinates
 * React state, React Flow measurements, DOM node measurements, and animation
 * frames.
 */
import type {Dimensions, NodeChange} from "@xyflow/react";
import {useReactFlow} from "@xyflow/react";
import type {CSSProperties} from "react";
import {createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState} from "react";
import {assertNotNull} from "../assert";
import type {TreeDescription, TreeNode} from "../tree-description";
import type {QueryGraphNode} from "./QueryNode";
import {layoutTree} from "./tree-layout";
import {graphAnimationsEnabled, graphAnimationProgress} from "./animation-timing";
import type {GraphLayout} from "./animated-layout";
import {
    createLayoutInterpolator,
    refreshLayoutPayloads,
    resolveTransitionAnchors,
    sameLayoutTarget,
    staticLayout,
} from "./animated-layout";
import type {TreeParents} from "./tree-index";

interface NodeResizeRequest {
    nodeId: string;
    nodeElement: HTMLElement;
}

/**
 * Animates a graph change applied synchronously by `applyChange`. List
 * persistent nodes that may resize; entering and exiting nodes are
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
    measured: ReadonlyMap<string, Dimensions>;
    targets: ReadonlyMap<string, Dimensions>;
}

/** Tests dimensions by value so unchanged measurements retain their map identity. */
function sameDimensions(left: Dimensions | undefined, right: Dimensions): boolean {
    return left?.width === right.width && left.height === right.height;
}

/**
 * Applies dimensions reported by React Flow. Every measurement describes the
 * current rendered frame. Settled nodes also adopt it as their layout target,
 * while actively resizing nodes retain their existing target until their final
 * size is measured. Returns `current` when no values change and reuses whichever
 * map is unaffected.
 */
export function applyMeasuredDimensions(
    current: DimensionsState,
    updates: readonly (readonly [string, Dimensions])[],
    resizingNodeIds: Pick<ReadonlySet<string>, "has">,
): DimensionsState {
    let measuredDimensions: Map<string, Dimensions> | undefined;
    let targetDimensions: Map<string, Dimensions> | undefined;
    for (const [nodeId, measured] of updates) {
        if (!sameDimensions(measuredDimensions?.get(nodeId) ?? current.measured.get(nodeId), measured)) {
            measuredDimensions ??= new Map(current.measured);
            measuredDimensions.set(nodeId, measured);
        }
        const target = resizingNodeIds.has(nodeId)
            ? (targetDimensions?.get(nodeId) ?? current.targets.get(nodeId) ?? measured)
            : measured;
        if (!sameDimensions(targetDimensions?.get(nodeId) ?? current.targets.get(nodeId), target)) {
            targetDimensions ??= new Map(current.targets);
            targetDimensions.set(nodeId, target);
        }
    }
    if (measuredDimensions === undefined && targetDimensions === undefined) return current;
    return {
        measured: measuredDimensions ?? current.measured,
        targets: targetDimensions ?? current.targets,
    };
}

interface NodeResize {
    flowElement: HTMLElement;
    sizingElement: HTMLElement;
    start: Dimensions;
    target?: Dimensions;
}

/**
 * Measures every pending post-render target before freezing any sizing shell,
 * keeping all DOM reads ahead of writes. Returns the final outer dimensions
 * used to compute the target graph layout.
 */
export function preparePendingNodeResizes(resizes: Map<string, NodeResize>): Map<string, Dimensions> {
    const measurements = [...resizes]
        .filter(([, resize]) => resize.target === undefined)
        .map(([nodeId, resize]) => ({
            nodeId,
            resize,
            nodeTarget: {width: resize.flowElement.offsetWidth, height: resize.flowElement.offsetHeight},
            sizingTarget: {width: resize.sizingElement.offsetWidth, height: resize.sizingElement.offsetHeight},
        }));
    const targets = new Map<string, Dimensions>();
    for (const {nodeId, resize, nodeTarget, sizingTarget} of measurements) {
        if (nodeTarget.width === 0 || nodeTarget.height === 0) {
            resizes.delete(nodeId);
            continue;
        }
        targets.set(nodeId, nodeTarget);
        resize.target = sizingTarget;
        resize.sizingElement.classList.add("qg-resizing");
        resize.sizingElement.style.width = `${resize.start.width}px`;
        resize.sizingElement.style.height = `${resize.start.height}px`;
    }
    return targets;
}

/** Restores intrinsic sizing after measuring or animating a query-node shell. */
function clearNodeSize(element: HTMLElement): void {
    element.classList.remove("qg-resizing");
    element.style.removeProperty("width");
    element.style.removeProperty("height");
}

/** Finishes one registered resize and restores intrinsic shell sizing. */
function finishNodeResize(resizes: Map<string, NodeResize>, nodeId: string): void {
    const resize = resizes.get(nodeId);
    if (resize === undefined) return;
    clearNodeSize(resize.sizingElement);
    resizes.delete(nodeId);
}

/** Finishes every registered resize. */
function finishNodeResizes(resizes: Map<string, NodeResize>): void {
    for (const resize of resizes.values()) clearNodeSize(resize.sizingElement);
    resizes.clear();
}

/** Applies animation styles without replacing settled element styles. */
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
 * node and graph geometry, while subtree changes stage unmeasured nodes at
 * their nearest visible ancestor before animating them to the final layout.
 */
export function useAnimatedGraphLayout(
    treeDescription: TreeDescription,
    nodeIds: Map<TreeNode, string>,
    treeParents: TreeParents,
    expandedSubtrees: Record<string, boolean>,
): GraphLayout & {
    onNodesChange: (changes: NodeChange<QueryGraphNode>[]) => void;
    animateGraphChange: AnimateGraphChange;
} {
    // React Flow services used to resolve handles and fit the initial graph.
    const {fitView, getInternalNode} = useReactFlow<QueryGraphNode>();

    const [dimensions, setDimensions] = useState<DimensionsState>(() => ({measured: new Map(), targets: new Map()}));
    // Intermediate measurements update the React Flow projection below, while
    // only stable target dimensions invalidate the comparatively costly layout.
    const targetLayout = useMemo(
        () => layoutTree(treeDescription, nodeIds, dimensions.targets, expandedSubtrees),
        [treeDescription, nodeIds, dimensions.targets, expandedSubtrees],
    );
    const targetLayoutMeasured = targetLayout.nodes.every((node) => dimensions.measured.has(node.id));

    // Size our inner shells imperatively: putting animated dimensions on React
    // Flow's observed wrappers would create a ResizeObserver feedback loop.
    const nodeResizesRef = useRef(new Map<string, NodeResize>());
    const animationRequestedRef = useRef(false);
    const animationFrameRef = useRef<number | undefined>(undefined);
    const [graphChangeRevision, setGraphChangeRevision] = useState(0);

    // Last target and rendered layouts used across interrupted renders.
    const targetLayoutRef = useRef(targetLayout);
    const [renderedLayout, setRenderedLayout] = useState(() => staticLayout(targetLayout));
    const renderedLayoutRef = useRef(renderedLayout);
    const initialFitDoneRef = useRef(false);

    // Record dimensions reported by React Flow. During a node resize, retain
    // the known final size as the layout target while its measured size moves.
    const onNodesChange = useCallback((changes: NodeChange<QueryGraphNode>[]) => {
        const updates = changes.flatMap((change) => {
            if (change.type !== "dimensions" || change.dimensions === undefined) return [];
            return [[change.id, change.dimensions] as const];
        });
        if (updates.length === 0) return;
        setDimensions((current) => applyMeasuredDimensions(current, updates, nodeResizesRef.current));
    }, []);

    const cancelLayoutFrame = useCallback(() => {
        if (animationFrameRef.current === undefined) return;
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = undefined;
    }, []);

    // Capture resizing nodes before applying arbitrary graph state. Entering
    // and exiting nodes are inferred from the resulting layout below.
    const animateGraphChange = useCallback<AnimateGraphChange>(
        (applyChange, resizingNodes = []) => {
            const motionEnabled = graphAnimationsEnabled();
            // Read every starting size before clearing interrupted styles.
            const resizes = new Map<string, NodeResize>(
                motionEnabled
                    ? resizingNodes.flatMap((request) => {
                          const flowElement = request.nodeElement.closest<HTMLElement>(".react-flow__node");
                          const sizingElement = request.nodeElement.closest<HTMLElement>(".qg-graph-node");
                          if (flowElement === null || sizingElement === null) return [];
                          // Animate our complete visual shell so React Flow's
                          // observed wrapper can remain intrinsically sized.
                          return [
                              [
                                  request.nodeId,
                                  {
                                      flowElement,
                                      sizingElement,
                                      start: {width: sizingElement.offsetWidth, height: sizingElement.offsetHeight},
                                  },
                              ] as const,
                          ];
                      })
                    : [],
            );
            cancelLayoutFrame();
            if (motionEnabled) {
                for (const {nodeId} of resizingNodes) finishNodeResize(nodeResizesRef.current, nodeId);
                for (const [nodeId, resize] of resizes) nodeResizesRef.current.set(nodeId, resize);
            } else {
                finishNodeResizes(nodeResizesRef.current);
            }
            animationRequestedRef.current = motionEnabled;
            applyChange();
            setGraphChangeRevision((revision) => revision + 1);
        },
        [cancelLayoutFrame],
    );

    // Apply each computed target to the currently rendered frame. New
    // nodes are first staged invisibly for measurement; ready targets animate
    // from the current frame so interrupted transitions remain continuous.
    useLayoutEffect(() => {
        // Finish pending node measurement before updating the layout endpoint.
        const resizeTargets = preparePendingNodeResizes(nodeResizesRef.current);
        if (resizeTargets.size > 0) {
            setDimensions((current) => {
                const targets = new Map(current.targets);
                for (const [nodeId, nodeTarget] of resizeTargets) targets.set(nodeId, nodeTarget);
                return {...current, targets};
            });
            return;
        }

        // Classify the endpoint and resolve subtree transition origins.
        const targetLayoutDataChanged = targetLayoutRef.current !== targetLayout;
        const targetLayoutChanged = !sameLayoutTarget(targetLayoutRef.current, targetLayout);
        const transitionAnchorMap = resolveTransitionAnchors(renderedLayoutRef.current, targetLayout, treeParents, (nodeId) => {
            const node = getInternalNode(nodeId);
            const handle = node?.internals.handleBounds?.source?.find((candidate) => candidate.id === subtreeHandleId);
            if (node === undefined || handle === undefined) return undefined;

            // Convert the measured handle center to a node-relative offset so
            // the transition anchor follows its node as the layout moves.
            const x = node.internals.positionAbsolute.x + handle.x + handle.width / 2;
            const y = node.internals.positionAbsolute.y + handle.y + handle.height / 2;
            return {nodeId: node.id, offset: {x: x - node.position.x, y: y - node.position.y}};
        });
        // Missing handles make origin-based interpolation worse than snapping.
        // The graph-change callback checks reduced motion before staging new nodes;
        // layout changes outside an explicit transaction settle immediately.
        const animationRequested = transitionAnchorMap !== undefined && animationRequestedRef.current;
        animationRequestedRef.current = animationRequested;
        const anchors = transitionAnchorMap ?? new Map();
        const canStartAnimation = animationRequested && targetLayoutMeasured && animationFrameRef.current === undefined;
        targetLayoutRef.current = targetLayout;
        renderedLayoutRef.current = refreshLayoutPayloads(renderedLayoutRef.current, targetLayout);
        // Publish payload-only updates without restarting equivalent geometry.
        // Staged nodes becoming measurable still need to start their animation.
        if (!targetLayoutChanged && !canStartAnimation) {
            if (targetLayoutDataChanged) setRenderedLayout(renderedLayoutRef.current);
            return;
        }

        // Choose between settling immediately, staging nodes, and animating.
        cancelLayoutFrame();
        const settleLayout = () => {
            animationRequestedRef.current = false;
            finishNodeResizes(nodeResizesRef.current);
            const next = staticLayout(targetLayout);
            renderedLayoutRef.current = next;
            setRenderedLayout(next);
        };
        if (!animationRequested) {
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

        const startTime = performance.now();

        // Retarget graph and node-size transitions from their current visual state.
        const interpolate = createLayoutInterpolator(renderedLayoutRef.current, targetLayout, anchors);
        const nodeResizeTransitions = [...nodeResizesRef.current].map(([nodeId, resize]) => {
            assertNotNull(resize.target);
            return {
                nodeId,
                element: resize.sizingElement,
                target: resize.target,
                start: {width: resize.sizingElement.offsetWidth, height: resize.sizingElement.offsetHeight},
            };
        });
        const step = (now: number) => {
            const progress = graphAnimationProgress(startTime, now);
            for (const {element, target, start} of nodeResizeTransitions) {
                element.style.width = `${start.width + (target.width - start.width) * progress}px`;
                element.style.height = `${start.height + (target.height - start.height) * progress}px`;
            }
            const interpolated = interpolate(progress);
            const next =
                targetLayoutRef.current === targetLayout
                    ? interpolated
                    : refreshLayoutPayloads(interpolated, targetLayoutRef.current);
            renderedLayoutRef.current = next;
            setRenderedLayout(next);
            if (progress < 1) {
                animationFrameRef.current = requestAnimationFrame(step);
            } else {
                animationFrameRef.current = undefined;
                for (const {nodeId} of nodeResizeTransitions) finishNodeResize(nodeResizesRef.current, nodeId);
                animationRequestedRef.current = false;
            }
        };
        animationFrameRef.current = requestAnimationFrame(step);
    }, [cancelLayoutFrame, getInternalNode, graphChangeRevision, targetLayout, targetLayoutMeasured, treeParents]);

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

    // Cancel the shared animation frame on unmount.
    useEffect(
        () => () => {
            cancelLayoutFrame();
            finishNodeResizes(nodeResizesRef.current);
        },
        [cancelLayoutFrame],
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
