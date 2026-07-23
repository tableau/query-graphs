export type IconName =
    | "run-query-symbol"
    | "filter-symbol"
    | "groupby-symbol"
    | "sort-symbol"
    | "inner-join-symbol"
    | "left-join-symbol"
    | "right-join-symbol"
    | "full-join-symbol"
    | "table-symbol"
    | "temp-table-symbol"
    | "virtual-table-symbol"
    | "const-table-symbol";

export interface TreeNode {
    // The displayed node name
    name?: string;
    // Color applied to node rects
    nodeColor?: string;
    // The name of the icon rendered for this node
    icon?: IconName;
    // The color for the icon
    iconColor?: string;
    // Rendered in the tooltip
    properties?: Map<string, string>;

    // Additional CSS classes applied to the incoming link
    edgeClass?: string;
    // Label placed on the incoming edge
    edgeLabel?: string;
    // Width of the incoming edge
    edgeWidth?: number;

    // The dominant execution pipeline color of this operator. For operators
    // shared by multiple pipelines, this is the color of the right-most pipeline
    // (see `hyper.ts` for the "right-most wins" rule). Used for the icon tint and
    // the expanded border.
    pipelineColor?: string;
    // The colors of *all* pipelines this operator belongs to, ordered
    // left-to-right. Rendered as a segmented bar under the label so that
    // operators shared by several pipelines (e.g. a UNION ALL target) visibly
    // show every pipeline they participate in.
    pipelineColors?: string[];
    // The ids of all execution pipelines this operator belongs to.
    pipelineIds?: number[];
    // Color of the incoming edge (from this node's parent). Set to the color of
    // the right-most pipeline shared by both endpoints. Left undefined when the
    // edge crosses a pipeline boundary (a "pipeline breaker") or when there is
    // no pipeline information, in which case the edge is drawn neutrally.
    edgeColor?: string;
    // Colors of *all* pipelines shared by this node and its parent (i.e. all the
    // pipelines that flow across the incoming edge), ordered left-to-right. An
    // edge can belong to several pipelines at once, e.g. the edge above a
    // UNION ALL target is executed once per input. Rendered as a segmented edge
    // and a segmented start-bar.
    edgeColors?: string[];

    // All child nodes visible by default
    children?: TreeNode[];
    // All collapsed child nodes
    collapsedChildren?: TreeNode[];
    // Whether collapsed children are shown by default
    expandedByDefault?: boolean;
}

// One merged execution unit ("pipeline"), projected onto the operator tree.
// See the `EXPLAIN (FORMAT JSON, PIPELINES)` output of Hyper.
export interface PipelineInfo {
    // Opaque, document-scoped pipeline id (the driving pipeline's id).
    id: number;
    // The color assigned to this pipeline, for the legend and node/edge coloring.
    color: string;
    // Number of tree operators that belong to this pipeline.
    operatorCount: number;
    // Optional per-pipeline runtime statistics (only present for ANALYZE).
    statistics?: Map<string, string>;
}

export interface Crosslink {
    source: TreeNode;
    target: TreeNode;
}

export interface TreeDescription {
    /// The tree root
    root: TreeNode;
    /// Metadata about the graph; displayed in the top-level tree label
    metadata?: Map<string, string>;
    /// Additional links between indirectly related nodes
    crosslinks?: Crosslink[];
    /// The merged execution pipelines, in legend/color-assignment order.
    /// Only present for plans emitted with the `PIPELINES` explain option.
    pipelines?: PipelineInfo[];
}

// A recursive helper function for walking through all nodes
export function visitTreeNodes<T>(parent: T, visitFn: (n: T) => void, childrenFn: (n: T) => T[]) {
    if (!parent) {
        return;
    }
    visitFn(parent);
    for (const child of childrenFn(parent)) {
        visitTreeNodes(child, visitFn, childrenFn);
    }
}

interface TreeLike<T extends TreeLike<T>> {
    children?: T[];
    collapsedChildren?: T[];
}

// Returns all children of a node, including collapsed children
export function allChildren<T extends TreeLike<T>>(n: T): T[] {
    return (n.children ?? []).concat(n.collapsedChildren ?? []);
}
