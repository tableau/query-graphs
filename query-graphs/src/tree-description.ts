export type GraphOrientation = "left-to-right" | "top-to-bottom" | "right-to-left" | "bottom-to-top";

export interface TreeNode {
    /// The displayed node name
    name?: string;
    /// The id of the symbol rendered for this node
    symbol?: string;
    // Additional CSS classes applied to the node
    nodeClass?: any;
    // Additional CSS classes applied to the incoming link
    edgeClass?: any;
    // EdgeLabel: label placed on the incoming edge
    edgeLabel?: string;
    // Rendered in the tooltip
    properties?: any;
    // an array containing all currently visible child nodes
    children?: TreeNode[];
    // An array containing all child nodes, including hidden nodes
    _children?: TreeNode[];
    // <most other>: displayed as part of the tooltip
    [k: string]: any;
}

export interface Crosslink {
    source: any;
    target: any;
}

export interface TreeDescription {
    /// The tree root
    root: TreeNode;
    /// Displays debugging annotations in the tree
    DEBUG?: boolean;
    /// The orientation of the graph
    graphOrientation?: GraphOrientation;
    /// Displayed in the top-level tree label
    properties?: any;
    /// Additional links between indirectly related nodes
    crosslinks?: any[];
}
