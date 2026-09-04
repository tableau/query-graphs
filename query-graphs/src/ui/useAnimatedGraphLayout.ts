import type {Dimensions, NodeChange} from "@xyflow/react";
import {useReactFlow} from "@xyflow/react";
import {createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState} from "react";
import {assertNotNull} from "../assert";
import type {TreeDescription, TreeNode} from "../tree-description";
import type {QueryGraphNode} from "./QueryNode";
import {layoutTree} from "./tree-layout";
import type {GraphNodeDimensions} from "./tree-layout";
import {animationStartTime, graphAnimationProgress} from "./animation-timing";

type GraphLayout = ReturnType<typeof layoutTree>;
type GraphEdge = GraphLayout["edges"][number];

interface Position {
    x: number;
    y: number;
}

interface AnimatedNode {
    node: QueryGraphNode;
    position: Position;
    opacity: number;
    transient: boolean;
    exitPosition?: Position;
}

interface AnimatedEdge {
    edge: GraphEdge;
    opacity: number;
    transient: boolean;
}

interface AnimatedLayout {
    nodes: AnimatedNode[];
    edges: AnimatedEdge[];
}

interface LayoutAnimation {
    kind: "resize" | "subtree";
    startedAt: number;
    // Entering and exiting nodes animate from or toward this node's position.
    anchorNodeId?: string;
}

export interface NodeResizeAnimation {
    nodeId: string;
    targetDimensions: Dimensions;
    bodyElement: HTMLElement;
    bodyFrom: Dimensions;
    bodyTo: Dimensions;
}

export interface GraphAnimationController {
    animateNodeResize: (animation: NodeResizeAnimation, updateGraph: () => void) => void;
    animateSubtreeChange: (anchorNodeId: string, updateGraph: () => void) => void;
}

export const GraphAnimationContext = createContext<GraphAnimationController | null>(null);

export function useGraphAnimationController(): GraphAnimationController {
    const controller = useContext(GraphAnimationContext);
    assertNotNull(controller);
    return controller;
}

function staticLayout(layout: GraphLayout): AnimatedLayout {
    return {
        nodes: layout.nodes.map((node) => ({node, position: node.position, opacity: 1, transient: false})),
        edges: layout.edges.map((edge) => ({edge, opacity: 1, transient: false})),
    };
}

function refreshLayoutData(layout: AnimatedLayout, latest: GraphLayout): AnimatedLayout {
    const latestNodes = new Map(latest.nodes.map((node) => [node.id, node]));
    const latestEdges = new Map(latest.edges.map((edge) => [edge.id, edge]));
    return {
        nodes: layout.nodes.map((entry) => ({...entry, node: latestNodes.get(entry.node.id) ?? entry.node})),
        edges: layout.edges.map((entry) => ({...entry, edge: latestEdges.get(entry.edge.id) ?? entry.edge})),
    };
}

function sameGeometry(left: GraphLayout, right: GraphLayout): boolean {
    if (left.nodes.length !== right.nodes.length || left.edges.length !== right.edges.length) return false;
    const rightNodes = new Map(right.nodes.map((node) => [node.id, node]));
    for (const node of left.nodes) {
        const other = rightNodes.get(node.id);
        if (other?.position.x !== node.position.x || other.position.y !== node.position.y) return false;
    }
    const rightEdgeIds = new Set(right.edges.map((edge) => edge.id));
    return left.edges.every((edge) => rightEdgeIds.has(edge.id));
}

function matchesTargetGeometry(rendered: AnimatedLayout, target: GraphLayout): boolean {
    if (rendered.nodes.length !== target.nodes.length) return false;
    const targetNodes = new Map(target.nodes.map((node) => [node.id, node]));
    return rendered.nodes.every(({node, position}) => {
        const targetNode = targetNodes.get(node.id);
        return targetNode?.position.x === position.x && targetNode.position.y === position.y;
    });
}

function anchorPosition(nodes: ReadonlyMap<string, AnimatedNode | QueryGraphNode>, id: string | undefined): Position {
    const entry = id === undefined ? undefined : nodes.get(id);
    if (entry === undefined) return {x: 0, y: 0};
    const node = "node" in entry ? entry.node : entry;
    const position = entry.position;
    return {x: position.x, y: position.y + (node.measured?.height ?? 0)};
}

function interpolateLayout(
    from: AnimatedLayout,
    to: GraphLayout,
    anchorNodeId: string | undefined,
    progress: number,
): AnimatedLayout {
    // Union both layouts: new elements emerge from the anchor, while removed
    // elements remain mounted until they reach the anchor and become transparent.
    const fromNodes = new Map(from.nodes.map((entry) => [entry.node.id, entry]));
    const toNodes = new Map(to.nodes.map((node) => [node.id, node]));
    const fromAnchor = anchorPosition(fromNodes, anchorNodeId);
    const toAnchor = anchorPosition(toNodes, anchorNodeId);
    const nodes: AnimatedNode[] = [];

    for (const id of new Set([...fromNodes.keys(), ...toNodes.keys()])) {
        const start = fromNodes.get(id);
        const target = toNodes.get(id);
        if (target === undefined && progress === 1) continue;
        const fromPosition = start?.position ?? fromAnchor;
        const exitPosition = target === undefined ? (start?.exitPosition ?? toAnchor) : undefined;
        const toPosition = target?.position ?? exitPosition!;
        nodes.push({
            node: target ?? start!.node,
            position: {
                x: fromPosition.x + (toPosition.x - fromPosition.x) * progress,
                y: fromPosition.y + (toPosition.y - fromPosition.y) * progress,
            },
            opacity: (start?.opacity ?? 0) + ((target === undefined ? 0 : 1) - (start?.opacity ?? 0)) * progress,
            transient: progress < 1 && (start?.transient === true || start === undefined || target === undefined),
            exitPosition,
        });
    }

    const fromEdges = new Map(from.edges.map((entry) => [entry.edge.id, entry]));
    const toEdges = new Map(to.edges.map((edge) => [edge.id, edge]));
    const edges: AnimatedEdge[] = [];
    for (const id of new Set([...fromEdges.keys(), ...toEdges.keys()])) {
        const start = fromEdges.get(id);
        const target = toEdges.get(id);
        if (target === undefined && progress === 1) continue;
        edges.push({
            edge: target ?? start!.edge,
            opacity: (start?.opacity ?? 0) + ((target === undefined ? 0 : 1) - (start?.opacity ?? 0)) * progress,
            transient: progress < 1 && (start?.transient === true || start === undefined || target === undefined),
        });
    }
    return {nodes, edges};
}

interface DimensionsState {
    nodeIds: Map<TreeNode, string>;
    dimensions: ReadonlyMap<string, GraphNodeDimensions>;
}

interface BodyAnimation {
    element: HTMLElement;
    animationFrame?: number;
}

export function useAnimatedGraphLayout(
    treeDescription: TreeDescription,
    nodeIds: Map<TreeNode, string>,
    expandedSubtrees: Record<string, boolean>,
): GraphLayout & {
    onNodesChange: (changes: NodeChange<QueryGraphNode>[]) => void;
    animationController: GraphAnimationController;
} {
    const {fitView} = useReactFlow();
    const activeResizeNodesRef = useRef(new Set<string>());
    const bodyAnimationsRef = useRef(new Map<string, BodyAnimation>());
    const pendingAnimationRef = useRef<LayoutAnimation | undefined>(undefined);
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
            animateNodeResize: (animation, updateGraph) => {
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
                    pendingAnimationRef.current = undefined;
                    updateGraph();
                    return;
                }

                activeResizeNodesRef.current.add(animation.nodeId);
                pendingAnimationRef.current = {kind: "resize", startedAt};

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
                const startedAt = animationStartTime();
                pendingAnimationRef.current = startedAt === undefined ? undefined : {kind: "subtree", startedAt, anchorNodeId};
                updateGraph();
            },
        }),
        [nodeIds, stopBodyAnimation],
    );

    const targetRef = useRef(target);
    const [rendered, setRendered] = useState(() => staticLayout(target));
    const renderedRef = useRef(rendered);
    const nodeIdsRef = useRef(nodeIds);
    const initialFitDoneRef = useRef(false);
    const animationFrameRef = useRef<number | undefined>(undefined);

    useLayoutEffect(() => {
        const graphChanged = nodeIdsRef.current !== nodeIds;
        const geometryChanged = graphChanged || !sameGeometry(targetRef.current, target);
        const animation = pendingAnimationRef.current;
        const pendingReady = animation !== undefined && targetMeasured;
        nodeIdsRef.current = nodeIds;
        targetRef.current = target;
        renderedRef.current = refreshLayoutData(renderedRef.current, target);
        if (!geometryChanged && !pendingReady) return;

        if (animationFrameRef.current !== undefined) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = undefined;
        }
        if (graphChanged) {
            initialFitDoneRef.current = false;
            for (const nodeId of [...bodyAnimationsRef.current.keys()]) stopBodyAnimation(nodeId);
        }
        if (animation === undefined || graphChanged) {
            pendingAnimationRef.current = undefined;
            const next = staticLayout(target);
            renderedRef.current = next;
            setRendered(next);
            return;
        }

        // Newly revealed nodes have no dimensions yet. Render them invisibly at
        // the anchor so React Flow can measure them before computing the endpoint.
        if (!targetMeasured) {
            pendingAnimationRef.current = animation;
            const staged = interpolateLayout(renderedRef.current, target, animation.anchorNodeId, 0);
            renderedRef.current = staged;
            setRendered(staged);
            return;
        }

        pendingAnimationRef.current = undefined;
        const start = renderedRef.current;
        const startTime = animation.kind === "resize" ? animation.startedAt : performance.now();
        const step = (now: number) => {
            const progress = graphAnimationProgress(startTime, now);
            const next = refreshLayoutData(interpolateLayout(start, target, animation.anchorNodeId, progress), targetRef.current);
            renderedRef.current = next;
            setRendered(next);
            if (progress < 1) {
                animationFrameRef.current = requestAnimationFrame(step);
            } else {
                animationFrameRef.current = undefined;
            }
        };
        animationFrameRef.current = requestAnimationFrame(step);
    }, [nodeIds, stopBodyAnimation, target, targetMeasured]);

    useEffect(() => {
        if (initialFitDoneRef.current || !targetMeasured || !matchesTargetGeometry(rendered, target)) return;
        const animationFrame = requestAnimationFrame(() => {
            initialFitDoneRef.current = true;
            void fitView();
        });
        return () => cancelAnimationFrame(animationFrame);
    }, [fitView, rendered, target, targetMeasured]);

    useEffect(
        () => () => {
            if (animationFrameRef.current !== undefined) cancelAnimationFrame(animationFrameRef.current);
            for (const nodeId of [...bodyAnimationsRef.current.keys()]) stopBodyAnimation(nodeId);
        },
        [stopBodyAnimation],
    );

    const targetNodes = useMemo(() => new Map(target.nodes.map((node) => [node.id, node])), [target.nodes]);
    const targetEdges = useMemo(() => new Map(target.edges.map((edge) => [edge.id, edge])), [target.edges]);
    const animatedLayout = useMemo(
        () => ({
            nodes: rendered.nodes.map(({node, position, opacity, transient}) => {
                const latest = targetNodes.get(node.id) ?? node;
                return {
                    ...latest,
                    position,
                    style:
                        opacity === 1 && !transient
                            ? latest.style
                            : {
                                  ...latest.style,
                                  ...(opacity === 1 ? {} : {opacity}),
                                  ...(transient ? {pointerEvents: "none" as const} : {}),
                              },
                };
            }),
            edges: rendered.edges.map(({edge, opacity, transient}) => {
                const latest = targetEdges.get(edge.id) ?? edge;
                return {
                    ...latest,
                    style:
                        opacity === 1 && !transient
                            ? latest.style
                            : {
                                  ...latest.style,
                                  ...(opacity === 1 ? {} : {opacity}),
                                  ...(transient ? {pointerEvents: "none" as const} : {}),
                              },
                    labelStyle: {
                        ...latest.labelStyle,
                        ...(opacity === 1 ? {} : {opacity}),
                        ...(transient ? {pointerEvents: "none" as const} : {}),
                    },
                    labelBgStyle: {
                        ...latest.labelBgStyle,
                        ...(opacity === 1 ? {} : {opacity}),
                        ...(transient ? {pointerEvents: "none" as const} : {}),
                    },
                    interactionWidth: transient ? 0 : latest.interactionWidth,
                    selectable: transient ? false : latest.selectable,
                    focusable: transient ? false : latest.focusable,
                };
            }),
        }),
        [rendered, targetEdges, targetNodes],
    );
    return useMemo(
        () => ({...animatedLayout, onNodesChange, animationController}),
        [animatedLayout, animationController, onNodesChange],
    );
}
