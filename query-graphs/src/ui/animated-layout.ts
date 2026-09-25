import type {layoutTree} from "./tree-layout";
import type {QueryGraphNode} from "./QueryNode";
import {findClosestVisibleAncestors} from "./tree-topology";
import type {TreeParents} from "./tree-topology";

export type GraphLayout = ReturnType<typeof layoutTree>;
type GraphEdge = GraphLayout["edges"][number];

export interface Position {
    x: number;
    y: number;
}

export interface LayoutAnchor {
    nodeId: string;
    offset: Position;
}

export type TransitionAnchors = ReadonlyMap<string, LayoutAnchor>;

export interface AnimatedNode {
    node: QueryGraphNode;
    position: Position;
    opacity: number;
    transient: boolean;
}

interface AnimatedEdge {
    edge: GraphEdge;
    opacity: number;
    transient: boolean;
}

export interface AnimatedLayout {
    nodes: AnimatedNode[];
    edges: AnimatedEdge[];
}

/**
 * Wraps a settled graph layout in the animation representation. Every element
 * starts at its final position, fully opaque and non-transient.
 */
export function staticLayout(layout: GraphLayout): AnimatedLayout {
    return {
        nodes: layout.nodes.map((node) => ({node, position: node.position, opacity: 1, transient: false})),
        edges: layout.edges.map((edge) => ({edge, opacity: 1, transient: false})),
    };
}

/**
 * Replaces node and edge payloads with their latest versions while preserving
 * animated positions, opacity, and transient state. Elements missing from the
 * latest layout keep their old payload because they may still be animating out.
 */
export function refreshLayoutPayloads(layout: AnimatedLayout, latest: GraphLayout): AnimatedLayout {
    const latestNodes = new Map(latest.nodes.map((node) => [node.id, node]));
    const latestEdges = new Map(latest.edges.map((edge) => [edge.id, edge]));
    return {
        nodes: layout.nodes.map((entry) => ({...entry, node: latestNodes.get(entry.node.id) ?? entry.node})),
        edges: layout.edges.map((entry) => ({...entry, edge: latestEdges.get(entry.edge.id) ?? entry.edge})),
    };
}

/**
 * Tests whether two layouts describe the same interpolation endpoint. Payload
 * and presentation changes are ignored because `refreshLayoutPayloads` applies
 * them without restarting the animation.
 */
export function sameLayoutTarget(left: GraphLayout, right: GraphLayout): boolean {
    if (left.nodes.length !== right.nodes.length || left.edges.length !== right.edges.length) return false;
    const rightNodes = new Map(right.nodes.map((node) => [node.id, node]));
    for (const node of left.nodes) {
        const other = rightNodes.get(node.id);
        if (other?.position.x !== node.position.x || other.position.y !== node.position.y) return false;
    }
    const rightEdgeIds = new Set(right.edges.map((edge) => edge.id));
    return left.edges.every((edge) => rightEdgeIds.has(edge.id));
}

/**
 * Anchors each entering or exiting node at its nearest ancestor that remains
 * visible. Returns an empty map when membership is unchanged, or `undefined`
 * when a required anchor cannot be measured.
 *
 * Resolved paths and measured handles are cached, so every ancestry link is
 * followed at most once even when an entire deep subtree changes.
 */
export function resolveTransitionAnchors(
    from: AnimatedLayout,
    to: GraphLayout,
    parents: TreeParents,
    measureAnchor: (nodeId: string) => LayoutAnchor | undefined,
): TransitionAnchors | undefined {
    const anchors = new Map<string, LayoutAnchor>();
    const fromNodeIds = new Set(from.nodes.map((entry) => entry.node.id));
    const toNodeIds = new Set(to.nodes.map((node) => node.id));
    const visibleInBoth = new Set([...fromNodeIds].filter((id) => toNodeIds.has(id)));
    const changedNodeIds = [...toNodeIds].filter((id) => !fromNodeIds.has(id));
    changedNodeIds.push(...[...fromNodeIds].filter((id) => !toNodeIds.has(id)));
    const visibleAncestors = findClosestVisibleAncestors(changedNodeIds, parents, visibleInBoth);
    const measuredAnchors = new Map<string, LayoutAnchor | undefined>();

    const addAnchor = (nodeId: string) => {
        const ancestor = visibleAncestors.get(nodeId);
        if (ancestor === undefined) return false;

        if (!measuredAnchors.has(ancestor)) measuredAnchors.set(ancestor, measureAnchor(ancestor));
        const anchor = measuredAnchors.get(ancestor);
        if (anchor === undefined) return false;
        anchors.set(nodeId, anchor);
        return true;
    };

    for (const id of changedNodeIds) if (!addAnchor(id)) return undefined;
    return anchors;
}

function anchorPosition(
    nodes: ReadonlyMap<string, AnimatedNode | QueryGraphNode>,
    anchor: LayoutAnchor | undefined,
): Position | undefined {
    if (anchor === undefined) return undefined;
    const position = nodes.get(anchor.nodeId)?.position;
    return position === undefined ? undefined : {x: position.x + anchor.offset.x, y: position.y + anchor.offset.y};
}

/**
 * Prepares interpolation from the currently rendered state to a settled target
 * layout. Layout indexes are built once and reused for every animation frame.
 * Existing elements move between layouts. Each entering or exiting node can
 * have its own anchor, allowing multiple subtrees to change in one transition.
 * Nodes without a supplied anchor use the origin. `progress` is expected to be
 * clamped to the inclusive range from 0 to 1.
 */
export function createLayoutInterpolator(
    from: AnimatedLayout,
    to: GraphLayout,
    anchors: TransitionAnchors,
): (progress: number) => AnimatedLayout {
    // Union both layouts: new elements emerge from the anchor, while removed
    // elements remain mounted until they reach the anchor and become transparent.
    const fromNodes = new Map(from.nodes.map((entry) => [entry.node.id, entry]));
    const toNodes = new Map(to.nodes.map((node) => [node.id, node]));
    const nodeTransitions = [...new Set([...fromNodes.keys(), ...toNodes.keys()])].map((id) => {
        const start = fromNodes.get(id);
        const target = toNodes.get(id);
        const anchor = anchors.get(id);
        return {
            node: target ?? start!.node,
            startPosition: start?.position ?? anchorPosition(fromNodes, anchor) ?? {x: 0, y: 0},
            targetPosition: target?.position ?? anchorPosition(toNodes, anchor) ?? {x: 0, y: 0},
            startOpacity: start?.opacity ?? 0,
            targetOpacity: target === undefined ? 0 : 1,
            transient: start?.transient === true || start === undefined || target === undefined,
            exiting: target === undefined,
        };
    });
    const fromEdges = new Map(from.edges.map((entry) => [entry.edge.id, entry]));
    const toEdges = new Map(to.edges.map((edge) => [edge.id, edge]));
    const edgeTransitions = [...new Set([...fromEdges.keys(), ...toEdges.keys()])].map((id) => {
        const start = fromEdges.get(id);
        const target = toEdges.get(id);
        return {
            edge: target ?? start!.edge,
            startOpacity: start?.opacity ?? 0,
            targetOpacity: target === undefined ? 0 : 1,
            transient: start?.transient === true || start === undefined || target === undefined,
            exiting: target === undefined,
        };
    });

    return (progress) => {
        const nodes: AnimatedNode[] = [];
        for (const transition of nodeTransitions) {
            if (transition.exiting && progress === 1) continue;
            nodes.push({
                node: transition.node,
                position: {
                    x: transition.startPosition.x + (transition.targetPosition.x - transition.startPosition.x) * progress,
                    y: transition.startPosition.y + (transition.targetPosition.y - transition.startPosition.y) * progress,
                },
                opacity: transition.startOpacity + (transition.targetOpacity - transition.startOpacity) * progress,
                transient: progress < 1 && transition.transient,
            });
        }

        const edges: AnimatedEdge[] = [];
        for (const transition of edgeTransitions) {
            if (transition.exiting && progress === 1) continue;
            edges.push({
                edge: transition.edge,
                opacity: transition.startOpacity + (transition.targetOpacity - transition.startOpacity) * progress,
                transient: progress < 1 && transition.transient,
            });
        }
        return {nodes, edges};
    };
}
