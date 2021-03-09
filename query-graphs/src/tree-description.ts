import {assert} from "./loader-utils";

export type GraphOrientation = "left-to-right" | "top-to-bottom" | "right-to-left" | "bottom-to-top";

export interface TreeNode {
    // The displayed node name
    name?: string;
    // The id of the symbol rendered for this node
    symbol?: string;
    // Additional CSS classes applied to the node
    nodeClass?: string;
    // Color applied to node rects
    rectFill?: string;
    rectFillOpacity?: number;
    // Rendered in the tooltip
    properties?: Map<string, string>;

    // Additional CSS classes applied to the incoming link
    edgeClass?: string;
    // EdgeLabel: label placed on the incoming edge
    edgeLabel?: string;
    // Additional CSS classes applied to the label on the incoming edge
    edgeLabelClass?: string;

    // An array containing all currently visible child nodes
    children?: TreeNode[];
    // An array containing all child nodes, including hidden nodes
    _children?: TreeNode[];
    // The parent node
    parent?: TreeNode;

    // The text
    // TODO: get rid of this
    text?: string;
    // The tag
    // TODO: get rid of this
    tag?: string;
    // The "class"; Intermediate value used by the Tableau loader
    // TODO: get rid of this
    class?: string;
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
    properties?: Map<string, string>;
    /// Additional links between indirectly related nodes
    crosslinks?: Crosslink[];
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
export function createParentLinks(tree: TreeNode) {
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
export function collapseAllChildren(d: TreeNode) {
    const children = d.children ? d.children : [];
    const _children = d._children ? d._children : [];
    d.children = [];
    d._children = children.length > _children.length ? children : _children;
    return d;
}

// Expand all children regardless of the current state
export function expandAllChildren(d: TreeNode) {
    const children = d.children ? d.children : [];
    const _children = d._children ? d._children : [];
    d.children = children.length > _children.length ? children : _children;
    d._children = [];
    return d;
}

// Collapse the given node in its parent node
// Requires parent links to be present (e.g., created by `createParentLinks`)
export function streamline(d: TreeNode) {
    if (d.parent) {
        assert(d.parent.children !== undefined);
        if (!d.parent._children) {
            // Save all of the original children in _children one time only
            d.parent._children = d.parent.children.slice(0);
        }
        const index = d.parent.children.indexOf(d);
        d.parent.children.splice(index, 1);
    }
}
