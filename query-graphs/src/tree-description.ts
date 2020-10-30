export type GraphOrientation = "left-to-right" | "top-to-bottom" | "right-to-left" | "bottom-to-top";

export interface TreeNode {
    /// The displayed node name
    name?: string;
    /// The id of the symbol rendered for this node
    symbol?: string;
    // Additional CSS classes applied to the node
    nodeClass?: string;
    // Additional CSS classes applied to the incoming link
    edgeClass?: string;
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
    source: TreeNode;
    target: TreeNode;
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
    crosslinks?: Crosslink[];
}

// A recursive helper function for walking through all nodes
export function visitTreeNodes<T>(parent: T, visitFn: (n: T) => void, childrenFn: (n: T) => T[]) {
    if (!parent) {
        return;
    }

    visitFn(parent);

    const children = childrenFn(parent);
    for (const child of children) {
        visitTreeNodes(child, visitFn, childrenFn);
    }
}

interface TreeLike<T extends TreeLike<T>> {
    children?: T[];
    _children?: T[];
}

// Returns all children of a node, including collapsed children
export function allChildren<T extends TreeLike<T>>(n: T): T[] {
    const childrenLength = n.children?.length ?? 0;
    const _childrenLength = n._children?.length ?? 0;
    const largerArray = _childrenLength > childrenLength ? n._children : n.children;
    return largerArray ?? [];
}

// Create parent links
export function createParentLinks(tree) {
    visitTreeNodes(
        tree,
        () => {},
        d => {
            if (d.children) {
                const children = allChildren(d);
                const count = children.length;
                for (let i = 0; i < count; i++) {
                    children[i].parent = d;
                }
                return children;
            }
            return [];
        },
    );
}

// Collapse all children regardless of the current state
export function collapseAllChildren(d) {
    const children = d.children ? d.children : [];
    const _children = d._children ? d._children : [];
    d.children = [];
    d._children = children.length > _children.length ? children : _children;
    return d;
}

// Expand all children regardless of the current state
export function expandAllChildren(d) {
    const children = d.children ? d.children : [];
    const _children = d._children ? d._children : [];
    d.children = children.length > _children.length ? children : _children;
    d._children = [];
    return d;
}

// Collapse the given node in its parent node
// Requires parent links to be present (e.g., created by `createParentLinks`)
export function streamline(d) {
    if (d.parent) {
        if (d.parent._children && d.parent._children.length > 0) {
            // save all of the original children in _children one time only
        } else {
            d.parent._children = d.parent.children.slice(0);
        }
        const index = d.parent.children.indexOf(d);
        d.parent.children.splice(index, 1);
    }
}
