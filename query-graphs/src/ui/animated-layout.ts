import type {layoutTree} from "./tree-layout";
import type {QueryGraphNode} from "./QueryNode";

export type GraphLayout = ReturnType<typeof layoutTree>;
type GraphEdge = GraphLayout["edges"][number];

export interface Position {
    x: number;
    y: number;
}

export interface AnimatedNode {
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

export interface AnimatedLayout {
    nodes: AnimatedNode[];
    edges: AnimatedEdge[];
}

export function staticLayout(layout: GraphLayout): AnimatedLayout {
    return {
        nodes: layout.nodes.map((node) => ({node, position: node.position, opacity: 1, transient: false})),
        edges: layout.edges.map((edge) => ({edge, opacity: 1, transient: false})),
    };
}

export function refreshLayoutData(layout: AnimatedLayout, latest: GraphLayout): AnimatedLayout {
    const latestNodes = new Map(latest.nodes.map((node) => [node.id, node]));
    const latestEdges = new Map(latest.edges.map((edge) => [edge.id, edge]));
    return {
        nodes: layout.nodes.map((entry) => ({...entry, node: latestNodes.get(entry.node.id) ?? entry.node})),
        edges: layout.edges.map((entry) => ({...entry, edge: latestEdges.get(entry.edge.id) ?? entry.edge})),
    };
}

export function sameGeometry(left: GraphLayout, right: GraphLayout): boolean {
    if (left.nodes.length !== right.nodes.length || left.edges.length !== right.edges.length) return false;
    const rightNodes = new Map(right.nodes.map((node) => [node.id, node]));
    for (const node of left.nodes) {
        const other = rightNodes.get(node.id);
        if (other?.position.x !== node.position.x || other.position.y !== node.position.y) return false;
    }
    const rightEdgeIds = new Set(right.edges.map((edge) => edge.id));
    return left.edges.every((edge) => rightEdgeIds.has(edge.id));
}

export function matchesTargetGeometry(rendered: AnimatedLayout, target: GraphLayout): boolean {
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

export function interpolateLayout(
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
