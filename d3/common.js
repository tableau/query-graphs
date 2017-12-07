
// A recursive helper function for walking through all nodes
function visit(parent, visitFn, childrenFn) {
    if (!parent) {
        return;
    }

    visitFn(parent);

    var children = childrenFn(parent);
    if (children) {
        var count = children.length;
        for (var i = 0; i < count; i++) {
            visit(children[i], visitFn, childrenFn);
        }
    }
}

// Returns all children of a node, including collapsed children
function allChildren(n) {
    var childrenLength = n.children ? n.children.length : 0;
    var _childrenLength = n._children ? n._children.length : 0;
    return _childrenLength > childrenLength ? n._children : n.children;
}

exports.visit = visit;
exports.allChildren = allChildren;
