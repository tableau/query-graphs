import type {layoutTree} from "./tree-layout";
import type {QueryGraphNode} from "./QueryNode";

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
export function refreshLayoutData(layout: AnimatedLayout, latest: GraphLayout): AnimatedLayout {
    const latestNodes = new Map(latest.nodes.map((node) => [node.id, node]));
    const latestEdges = new Map(latest.edges.map((edge) => [edge.id, edge]));
    return {
        nodes: layout.nodes.map((entry) => ({...entry, node: latestNodes.get(entry.node.id) ?? entry.node})),
        edges: layout.edges.map((entry) => ({...entry, edge: latestEdges.get(entry.edge.id) ?? entry.edge})),
    };
}

/**
 * Tests whether two layouts describe the same interpolation endpoint. Payload
 * and presentation changes are ignored because `refreshLayoutData` applies
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

function anchorPosition(
    nodes: ReadonlyMap<string, AnimatedNode | QueryGraphNode>,
    anchor: LayoutAnchor | undefined,
): Position | undefined {
    if (anchor === undefined) return undefined;
    const position = nodes.get(anchor.nodeId)?.position;
    return position === undefined ? undefined : {x: position.x + anchor.offset.x, y: position.y + anchor.offset.y};
}

/**
 * Interpolates from the currently rendered state to a settled target layout.
 * Existing elements move between layouts. Each entering or exiting node can
 * have its own anchor, allowing multiple subtrees to change in one transition.
 * Nodes without a supplied anchor use the origin. `progress` is expected to be
 * clamped to the inclusive range from 0 to 1.
 */
export function interpolateLayout(
    from: AnimatedLayout,
    to: GraphLayout,
    anchors: TransitionAnchors,
    progress: number,
): AnimatedLayout {
    // Union both layouts: new elements emerge from the anchor, while removed
    // elements remain mounted until they reach the anchor and become transparent.
    const fromNodes = new Map(from.nodes.map((entry) => [entry.node.id, entry]));
    const toNodes = new Map(to.nodes.map((node) => [node.id, node]));
    const nodes: AnimatedNode[] = [];

    for (const id of new Set([...fromNodes.keys(), ...toNodes.keys()])) {
        const start = fromNodes.get(id);
        const target = toNodes.get(id);
        if (target === undefined && progress === 1) continue;
        const anchor = anchors.get(id);
        const fromPosition = start?.position ?? anchorPosition(fromNodes, anchor) ?? {x: 0, y: 0};
        const toPosition = target?.position ?? anchorPosition(toNodes, anchor) ?? {x: 0, y: 0};
        nodes.push({
            node: target ?? start!.node,
            position: {
                x: fromPosition.x + (toPosition.x - fromPosition.x) * progress,
                y: fromPosition.y + (toPosition.y - fromPosition.y) * progress,
            },
            opacity: (start?.opacity ?? 0) + ((target === undefined ? 0 : 1) - (start?.opacity ?? 0)) * progress,
            transient: progress < 1 && (start?.transient === true || start === undefined || target === undefined),
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
