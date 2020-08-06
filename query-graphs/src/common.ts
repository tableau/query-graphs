// A recursive helper function for walking through all nodes
export function visit<T>(parent: T, visitFn: (n: T) => void, childrenFn: (n: T) => T[]) {
    if (!parent) {
        return;
    }

    visitFn(parent);

    const children = childrenFn(parent);
    for (const child of children) {
        visit(child, visitFn, childrenFn);
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
    visit(
        tree,
        function() {},
        function(d) {
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

// Convert to string. Return undefined if not supported.
export function toString(d: unknown): string | undefined {
    if (typeof d === "string") {
        return d;
    } else if (typeof d === "number") {
        return d.toString();
    } else if (typeof d === "boolean") {
        return d.toString();
    } else if (d === null) {
        return "null";
    } else if (d === undefined) {
        return "undefined";
    }
    return undefined;
}

// Convert to string. Returns the JSON serialization if not supported.
export function forceToString(d) {
    let str = toString(d);
    if (str === undefined) {
        str = JSON.stringify(d);
    }
    return str;
}

// Format a number using metric suffixes
export function formatMetric(x) {
    const sizes = ["", "k", "M", "G", "T", "P", "E", "Z", "Y"];
    let idx = 0;
    while (x > 1000 && idx < sizes.length - 1) {
        x /= 1000;
        ++idx;
    }
    return x.toFixed(0) + sizes[idx];
}
