/*

Hyper JSON Transformations
--------------------------

The Hyper JSON representation renders verbosely as a D3 tree; therefore, perform the following transformations.

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

var common = require('./common');

// Convert Hyper JSON to a D3 tree
function convertHyper(node, tag) {
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
                innerNode = convertHyper(node[key], node[key].operator);
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
                    leftNode = convertHyper(node[key], key);
                    return;
                case "right":
                    rightNode = convertHyper(node[key], key);
                    return;
                case "attribute":
                    attributeNode = convertHyper(node[key], key);
                    return;
                case "value":
                    valueNode = convertHyper(node[key], key);
                    return;

                // Nodes that may not be relocated and have new child nodes added
                case "mode":
                    modeNode = convertHyper(node[key], key);
                    children.push(modeNode);
                    return;
                case "expression":
                    // Suppress noisy expression tags
                    if (node[key] !== "iuref" && node[key] !== "comparison") {
                        exprNode = convertHyper(node[key], key);
                        children.push(exprNode);
                    }
                    return;

                // Standard inner nodes
                default:
                    innerNode = convertHyper(node[key], key);
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
                // TODO: push valueNode that is an array, but will not be after skipping over "iuref" or "comparison"
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
            innerNode = convertHyper(value, tag);
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
}

// Function to generate nodes' display names based on their properties
function generateDisplayNames(treeData) {
    common.visit(treeData, function(node) {
        switch (node.tag) {
            case "join":
                node.name = node.tag;
                node.symbol = "inner-join-symbol";
                break;
            case "leftouterjoin":
                node.name = node.tag;
                node.symbol = "left-join-symbol";
                break;
            case "rightouterjoin":
                node.name = node.tag;
                node.symbol = "right-join-symbol";
                break;
            case "fullouterjoin":
                node.name = node.tag;
                node.symbol = "full-join-symbol";
                break;
            case "tablescan":
            case "cursorscan":
            case "tdescan":
            case "tableconstruction":
            case "virtualtable":
                node.name = node.tag;
                node.symbol = 'table-symbol';
                break;
            case "temp":
                node.name = node.tag;
                node.symbol = "temp-table-symbol";
                node.edgeClass = "link-and-arrow";
                break;
            case "expression":
                node.name = node.text;
                break;
            case "attribute":
            case "condition":
            case "header":
            case "iu":
            case "name":
            case "mode":
            case "operation":
            case "source":
            case "tableOid":
            case "tid":
            case "tupleFlags":
            case "type":
            case "unique":
            case "unnormalizedNames":
            case "value":
            case "value2":
            case "values":
            case "output":
            case "distinctValues":
                if (node.text) {
                    node.name = node.tag + ":" + node.text;
                } else {
                    node.name = node.tag;
                }
                break;
            default:
                if (node.tag) {
                    node.name = node.tag;
                } else {
                    node.name = JSON.stringify(node);
                }
                break;
        }
    }, function(n) {
        return n.children;
    });
}

function collapseNodes(treeData, graphCollapse) {
    var streamline = graphCollapse === "s" ? common.streamline : common.collapseChildren;
    var collapseChildren = common.collapseChildren;
    if (graphCollapse !== 'n') {
        common.visit(treeData, function(d) {
            if (d.name) {
                var _name = d.fullName ? d.fullName : d.name;
                switch (_name) {
                    case 'aggregates':
                    case 'builder':
                    case 'cardinality':
                    case 'condition':
                    case 'conditions':
                    case 'count':
                    case 'criterion':
                    case 'datasource':
                    case 'expressions':
                    case 'field':
                    case 'from':
                    case 'groupbys':
                    case 'header':
                    case 'imports':
                    case 'operatorId':
                    case 'matchMode':
                    case 'measures':
                    case 'metadata-record':
                    case 'metadata-records':
                    case 'method':
                    case 'output':
                    case 'orderbys':
                    case 'predicate':
                    case 'residuals':
                    case 'restrictions':
                    case 'runquery-columns':
                    case 'segment':
                    case 'selects':
                    case 'schema':
                    case 'tid':
                    case 'top':
                    case 'tuples':
                    case 'values':
                        streamline(d);
                        return;
                    default:
                        break;
                }
            }
            if (d.symbol) {
                switch (d.symbol) {
                    case 'table-symbol':
                        collapseChildren(d);
                        return;
                    default:
                        break;
                }
            }
            if (d.tag) {
                switch (d.tag) {
                    case 'header':
                    case 'values':
                    case 'tid':
                        streamline(d);
                        return;
                    default:
                        break;
                }
            }
        }, function(d) {
            return d.children && d.children.length > 0 ? d.children.slice(0) : null;
        });
    }
}

// Loads a Hyper query plan
function loadHyperPlan(graphString, graphCollapse) {
    var treeData;
    try {
        treeData = JSON.parse(graphString);
    } catch (err) {
        return {error: "JSON parse failed with '" + err + "'."};
    }
    treeData = convertHyper(treeData, "result");
    generateDisplayNames(treeData);
    common.createParentLinks(treeData);
    collapseNodes(treeData, graphCollapse);
    return treeData;
}

exports.loadHyperPlan = loadHyperPlan;
