import {assert} from "./loader-utils";

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

    // All child nodes visible by default
    children?: TreeNode[];
    // All collapsed child nodes
    collapsedChildren?: TreeNode[];
    // Whether collapsed children are shown by default
    expandedByDefault?: boolean;
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
    /// Displayed in the top-level tree label
    /// XXX remove
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
    collapsedChildren?: T[];
}

// Returns all children of a node, including collapsed children
export function allChildren<T extends TreeLike<T>>(n: T): T[] {
    return (n.children ?? []).concat(n.collapsedChildren ?? []);
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

// Collapse the given node in its parent node
// Requires parent links to be present (e.g., created by `createParentLinks`)
export function streamline(d: TreeNode) {
    if (d.parent) {
        assert(d.parent.children !== undefined);
        if (!d.parent.collapsedChildren) {
            d.parent.collapsedChildren = [];
        }
        const index = d.parent.children.indexOf(d);
        d.collapsedChildren!.push(d.parent.children.splice(index, 1)[0]);
    }
}
