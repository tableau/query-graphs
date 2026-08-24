import {useEffect, useLayoutEffect, useMemo, useRef, useState} from "react";
import type {QueryGraphNode} from "./QueryNode";
import type {layoutTree} from "./tree-layout";
import type {LayoutAnimation} from "./store";
import {graphAnimationProgress} from "./animation-timing";

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

function staticLayout(layout: GraphLayout): AnimatedLayout {
    return {
        nodes: layout.nodes.map((node) => ({node, position: node.position, opacity: 1, transient: false})),
        edges: layout.edges.map((edge) => ({edge, opacity: 1, transient: false})),
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

export function useAnimatedGraphLayout(
    target: GraphLayout,
    animation: LayoutAnimation | undefined,
    targetMeasured: boolean,
): GraphLayout {
    const targetRef = useRef(target);
    const [rendered, setRendered] = useState(() => staticLayout(target));
    const renderedRef = useRef(rendered);
    const previousAnimationStartRef = useRef(animation?.startedAt);
    const pendingAnimationRef = useRef<LayoutAnimation | undefined>(undefined);
    const animationFrameRef = useRef<number | undefined>(undefined);

    useLayoutEffect(() => {
        const geometryChanged = !sameGeometry(targetRef.current, target);
        const animationChanged = previousAnimationStartRef.current !== animation?.startedAt;
        const pendingReady = pendingAnimationRef.current !== undefined && targetMeasured;
        targetRef.current = target;
        if (!geometryChanged && !pendingReady) return;

        if (animationFrameRef.current !== undefined) cancelAnimationFrame(animationFrameRef.current);
        if (animation === undefined || (!animationChanged && !pendingReady)) {
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

        previousAnimationStartRef.current = animation.startedAt;
        pendingAnimationRef.current = undefined;
        const start = renderedRef.current;
        const startTime = animation.kind === "resize" ? animation.startedAt : performance.now();
        const step = (now: number) => {
            const progress = graphAnimationProgress(startTime, now);
            const next = interpolateLayout(start, target, animation.anchorNodeId, progress);
            renderedRef.current = next;
            setRendered(next);
            if (progress < 1) {
                animationFrameRef.current = requestAnimationFrame(step);
            } else {
                animationFrameRef.current = undefined;
            }
        };
        animationFrameRef.current = requestAnimationFrame(step);
    }, [animation, target, targetMeasured]);

    useEffect(
        () => () => {
            if (animationFrameRef.current !== undefined) cancelAnimationFrame(animationFrameRef.current);
        },
        [],
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
}
