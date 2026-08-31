export type IconName =
    | "run-query-symbol"
    | "filter-symbol"
    | "groupby-symbol"
    | "sort-symbol"
    | "limit-symbol"
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
    // Full relevant-first column name lists for truncated column-preview properties (keyed by the same
    // property name, e.g. `columns`, `outputs`). Present only when the preview was elided; lets the UI
    // progressively reveal the hidden columns when the `... [n]` marker is clicked.
    columnLists?: Map<string, string[]>;
    // Colors the whole node based on its content so it can be spotted while collapsed, without
    // expanding to see the properties. The category (chosen by precedence: costly-scan > index-rec >
    // index-used) drives the highlight color, matching the corresponding property-row highlight.
    //
    // For loaders with `adjustableHighlights` set (Hyper), this is recomputed at render time from the
    // live thresholds (see highlight-rules.ts / deriveNodeDisplay); the loader still seeds a default
    // value so a first render before any UI interaction looks correct.
    highlightNode?: "costly-scan" | "index-rec" | "index-used";
    // Human-readable explanation of why the node is highlighted (shown as a hover tooltip).
    highlightReason?: string;
    // Raw processed-rows count for a scan node (unformatted), used to total scan volume in the
    // plan-insights summary and to rank the "top offenders" list. Undefined for non-scan nodes /
    // plans without runtime statistics.
    scanProcessedRows?: number;
    // Raw rows-matching-restrictions count for a scan node (unformatted). Paired with
    // scanProcessedRows to compute the processed-to-matching ratio in the offenders list.
    scanRowsMatching?: number;
    // The scan's source type, used for the plan-insights "Scan types" breakdown. For the newer generic
    // `scan` operator this is its `type` field (e.g. `data-lake-object`); for the older per-format
    // operators it is the operator tag itself (`tablescan`, `icebergscan`, `parquetscan`, …). Only set
    // on scan nodes.
    scanType?: string;
    // Marks a costly scan: one whose processed-rows dwarf rows-matching (low selectivity).
    // Used to highlight the costly scan's processed-rows / rows-matching property rows in light red.
    costlyScan?: boolean;
    // Proportional red shade for a costly scan's node box, darker the larger this scan's share of all
    // rows the plan's scans read (mirrors `nodeColor`'s runtime heatmap). Only set on costly scans;
    // recomputed at render time for adjustable plans. Applied as a CSS custom property so the
    // expanded/hover "white" state can still override it.
    costlyScanColor?: string;

    // --- Raw signals for adjustable highlighting (Hyper) ---
    // These carry the unformatted inputs the threshold rules compare against, so the highlight
    // decisions can be recomputed at render time when the user edits a threshold. See highlight-rules.ts.
    //
    // Measured CPU cycles for this operator (runtime-hotspot input).
    cpuTime?: number;
    // The optimizer's row estimate and the measured actual for the incoming edge (cardinality
    // misestimate input). `cardIsScan` distinguishes a scan's rows-matching "actual" from a generic
    // operator's measured output, so the recomputed edge reason reads correctly.
    cardEstimate?: number;
    cardActual?: number;
    cardIsScan?: boolean;
    // The non-threshold node category the loader determined (index recommendation / index used) and
    // its reason. Used as the fallback highlight when a node is not a costly scan under the current
    // thresholds. (Costly scan is recomputed live and takes precedence when it applies.)
    baseHighlight?: "index-rec" | "index-used";
    baseHighlightReason?: string;
    // Category membership flags, independent of `highlightNode` (which can only show one color by
    // precedence). A single scan can belong to several categories at once — e.g. a costly scan
    // that also has an index recommendation — so the plan-insights legend counts/drills off these.
    hasIndexRec?: boolean;
    hasIndexUsed?: boolean;

    // Set on a `udtablefunction` node that performs a (hybrid / vector) search, e.g. Data Cloud's
    // `hybrid_search`. Carries the key metadata surfaced by the Hyper loader so the plan-insights panel
    // can call out the search node(s) and let the user jump to them. `hybrid` is true when the search
    // also runs a keyword (lexical) retrieval leg alongside the vector one.
    vectorSearch?: {
        function?: string;
        index?: string;
        vectorDb?: string;
        embeddingModel?: string;
        hybrid?: boolean;
    };

    // Additional CSS classes applied to the incoming link
    edgeClass?: string;
    // Label placed on the incoming edge
    edgeLabel?: string;
    // Explanation shown as a hover tooltip on the incoming edge label (e.g. why it is highlighted).
    edgeReason?: string;
    // Width of the incoming edge
    edgeWidth?: number;

    // All child nodes visible by default
    children?: TreeNode[];
    // All collapsed child nodes
    collapsedChildren?: TreeNode[];
    // Whether collapsed children are shown by default
    expandedByDefault?: boolean;
}

export interface Crosslink {
    source: TreeNode;
    target: TreeNode;
}

/// Which loader produced this tree. Lets the UI make source-specific decisions (e.g. only Hyper
/// plans carry the scan-highlighting insights model) without inferring the source from an incidental
/// feature flag like `adjustableHighlights`. Loaders that don't identify themselves leave it unset.
export type PlanSource = "hyper" | "postgres" | "tableau" | "json" | "xml";

export interface TreeDescription {
    /// The tree root
    root: TreeNode;
    /// The loader that produced this tree (see `PlanSource`).
    planSource?: PlanSource;
    /// Metadata about the graph; displayed in the top-level tree label
    metadata?: Map<string, string>;
    /// Additional links between indirectly related nodes
    crosslinks?: Crosslink[];
    /// When true, this plan's threshold-based highlights (costly scan, cardinality misestimate,
    /// runtime hotspot) are recomputed at render time from adjustable thresholds, and the raw-signal
    /// fields on each node are populated. Set by the Hyper loader; other loaders bake highlights.
    adjustableHighlights?: boolean;
    /// Total CPU cycles across all operators, used to compute each operator's runtime share at render
    /// time. Only set when `adjustableHighlights` is true.
    planCpuTotal?: number;
    /// Total processed-rows across all scans, used to compute each costly scan's share (and thus its
    /// proportional red shade) at render time. Only set when `adjustableHighlights` is true.
    planProcessedTotal?: number;
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
