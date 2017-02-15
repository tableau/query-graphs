
/*

HyPer JSON Transformations
--------------------------

The HyPer JSON representation renders verbosely as a D3 tree; therefore, perform the following transformations.

Bulk Expressions
----------------

* Replace "plan", "input", "left", and "right" operator keys with the operator value and remove the operator key.

Instance Expressions
--------------------

* Convert "mode" with "attribute" and "value" keys (in same object) to mode with nested attribute and value keys.
* Convert "mode" with "left" and "right" keys to mode with nested left and right *child* keys.
* Convert "expression" with "left" and "right" keys to expression with nested left and right *child* keys.
* Convert "expression" with a single "value" key to expression with the nested value key.

Properties
----------
* Convert certain keys (see below) to a property list.

Miscellaneous
-------------
* Ignore (remove) "iuref" and "comparison" keys.

*/

// Convert HyPer JSON to a D3 tree
var convertHyPer = function(node, tag) {
    var innerNode;
    if (typeof (node) === "object" && !Array.isArray(node)) {
        // "Object" nodes
        var children = [];
        var properties;
        var text;
        var leftNode;
        var rightNode;
        var exprNode;
        var modeNode;
        var valueNode;
        var attributeNode;

        if (node === null) {
            return {
                tag: tag,
                text: node
            };
        }

        Object.keys(node).forEach(function(key, _index) {
            // Certain keys are better visualized as properties
            switch (key) {
                case "builder":
                case "cardinality":
                case "count":
                case "from":
                case "id":
                case "matchMode":
                case "operatorId":
                case "method":
                case "segment":
                    if (typeof properties === "undefined") {
                        properties = {};
                    }
                    properties[key] = node[key];
                    return;
                default:
                    break;
            }

            // Bypass explicit child inputs
            if ((key === "plan" || key === "input" || key === "left" || key === "right") && node[key].operator) {
                innerNode = convertHyPer(node[key], node[key].operator);
                if (Array.isArray(innerNode)) {
                    children = children.concat(innerNode);
                } else {
                    children.push(innerNode);
                }
                return;
            }

            // Ignore operator key used as tag above in plan, input, left, and right keys
            if (key === "operator") {
                return;
            }

            // Simplify instance expressions
            switch (key) {

                // Nodes that may be relocated in the tree
                case "left":
                    leftNode = convertHyPer(node[key], key);
                    return;
                case "right":
                    rightNode = convertHyPer(node[key], key);
                    return;
                case "attribute":
                    attributeNode = convertHyPer(node[key], key);
                    return;
                case "value":
                    valueNode = convertHyPer(node[key], key);
                    return;

                // Nodes that may not be relocated and have new child nodes added
                case "mode":
                    modeNode = convertHyPer(node[key], key);
                    children.push(modeNode);
                    return;
                case "expression":
                    // Suppress noisy expression tags
                    if (node[key] !== "iuref" && node[key] !== "comparison") {
                        exprNode = convertHyPer(node[key], key);
                        children.push(exprNode);
                    }
                    return;

                // Standard inner nodes
                default:
                    innerNode = convertHyPer(node[key], key);
                    if (Array.isArray(innerNode)) {
                        children = children.concat(innerNode);
                    } else {
                        children.push(innerNode);
                    }
                    return;
            }
        });

        // Restrictions pattern
        if (modeNode && attributeNode && valueNode) {
            modeNode.children = [];
            modeNode.children.push(attributeNode);
            modeNode.children.push(valueNode);
        } else

        // Conditions and residuals pattern
        if (modeNode && leftNode && rightNode) {
            modeNode.children = [];
            modeNode.children.push(leftNode.children[0]);
            modeNode.children.push(rightNode.children[0]);
        } else

        // Comparisons and other binary expressions pattern
        if (exprNode && leftNode && rightNode) {
            exprNode.children = [];
            exprNode.children.push(leftNode.children[0]);
            exprNode.children.push(rightNode.children[0]);
        } else

        // Unary expressions with a value pattern
        if (exprNode && valueNode) {
            exprNode.children = [];
            exprNode.children.push(valueNode);
        } else {
            // No patterns matched: push nodes not pushed in the loop above
            if (leftNode) {
                children.push(leftNode);
            }
            if (rightNode) {
                children.push(rightNode);
            }
            if (valueNode) {
                // value nodes can be arrays of values
                // todo: push valueNode that is an array, but will not be after skipping over "iuref" or "comparison"
                if (Array.isArray(valueNode)) {
                    children = children.concat(valueNode);
                } else {
                    children.push(valueNode);
                }
            }
            if (attributeNode) {
                children.push(attributeNode);
            }
        }
        return {
            tag: tag,
            properties: properties,
            text: text,
            children: children
        };
    } else if (Array.isArray(node)) {
        // "Array" nodes
        var listOfObjects = [];
        node.forEach(function(value, _index) {
            innerNode = convertHyPer(value, tag);
            // objectify nested arrays
            if (Array.isArray(innerNode)) {
                innerNode.forEach(function(value, _index) {
                    listOfObjects.push(value);
                });
            } else {
                listOfObjects.push(innerNode);
            }
        });
        return listOfObjects;
    } else if (typeof (node) === "string") {
        // "String" nodes
        return {
            tag: tag,
            text: node
        };
    } else if (typeof (node) === "number") {
        // "Number" nodes
        var numstr = node.toString();
        return {
            tag: tag,
            text: numstr
        };
    } else if (typeof (node) === "boolean") {
        // "Boolean" nodes
        var boolstr = node.toString();
        return {
            tag: tag,
            text: boolstr
        };
    }
    console.warn("Convert to JSON case not implemented");
};

exports.convertHyPer = convertHyPer;
