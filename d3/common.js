
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

// Create parent links
function createParentLinks(tree) {
    visit(tree, function() {}, function(d) {
        if (d.children) {
            var children = allChildren(d);
            var count = children.length;
            for (var i = 0; i < count; i++) {
                children[i].parent = d;
            }
            return children;
        }
        return null;
    });
}

// Collapse all children regardless of the current state
function collapseChildren(d) {
    var children = (d.children) ? d.children : null;
    var _children = (d._children) ? d._children : null;
    // all original children are in _children or none are
    if (_children === null || _children.length === 0) {
        d._children = children;
    }
    d.children = null;
    return d;
}

// Collapse all but me in my parent node
// Requires parent links to be present (e.g., created by `createParentLinks`)
// Nodes may have children and _children that were children prior to streamline
function streamline(d) {
    if (d.parent) {
        if (d.parent._children && d.parent._children !== null && d.parent._children.length > 0) {
            // save all of the original children in _chidren one time only
        } else {
            d.parent._children = d.parent.children.slice(0);
        }
        var index = d.parent.children.indexOf(d);
        d.parent.children.splice(index, 1);
    }
}

exports.visit = visit;
exports.allChildren = allChildren;
exports.createParentLinks = createParentLinks;
exports.collapseChildren = collapseChildren;
exports.streamline = streamline;
