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
        if (node === null) {
            return {
                tag: tag,
                text: node
            };
        }

        // "Object" nodes
        var children = [];
        var properties = {};

        // Take the first present tagKey as the new tag. Add all others as properties
        var tagKeys = ["operator", "expression", "mode"];
        var tagOverride;
        tagKeys.forEach(function(key) {
            if (!node.hasOwnProperty(key)) {
                return;
            }
            if (tagOverride === undefined) {
                tagOverride = node[key];
            } else {
                properties[key] = node[key];
            }
        });

        // Add the following keys as children
        var childKeys = ["input", "left", "right", "attribute", "value"];
        childKeys.forEach(function(key) {
            if (!node.hasOwnProperty(key)) {
                return;
            }
            var child = convertHyper(node[key], key);
            if (Array.isArray(child)) {
                children = children.concat(child);
            } else {
                children.push(child);
            }
        });

        // Display these properties always as properties, even if they are more complex
        var propertyKeys = ["analyze"];
        propertyKeys.forEach(function(key) {
            if (!node.hasOwnProperty(key)) {
                return;
            }
            properties[key] = common.forceToString(node[key]);
        });

        // Display all other properties adaptively: simple expressions are displayed as properties, all others as part of the tree
        var handledKeys = tagKeys.concat(childKeys, propertyKeys);
        Object.getOwnPropertyNames(node).forEach(function(key, _index) {
            if (handledKeys.indexOf(key) !== -1) {
                return;
            }

            // Try to display as string property
            var str = common.toString(node[key]);
            if (str !== undefined) {
                properties[key] = str;
                return;
            }

            // Display as part of the tree
            innerNode = convertHyper(node[key], key);
            if (Array.isArray(innerNode)) {
                children = children.concat(innerNode);
            } else {
                children.push(innerNode);
            }
            return;
        });
        // Display the cardinality on the links between the nodes
        var edgeLabel = node.hasOwnProperty("cardinality") ? common.formatMetric(node.cardinality) : undefined;
        // Build the converted node
        var convertedNode = {
            tag: tag,
            properties: properties,
            children: children,
            edgeLabel: edgeLabel
        };
        if (tagOverride !== undefined) {
            convertedNode.tag = tagOverride;
            if (node.operator === undefined) {
                convertedNode = {tag: tag, children: [convertedNode]};
            }
        }
        return convertedNode;
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
    } else if (common.toString(node) !== undefined) {
        return {
            tag: tag,
            text: common.toString(node)
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
            switch (d.tag) {
                case 'aggregates':
                case 'builder':
                case 'cardinality':
                case 'condition':
                case 'criterion':
                case 'from':
                case 'header':
                case 'output':
                case 'residuals':
                case 'restrictions':
                case 'segment':
                case 'schema':
                case 'tid':
                case 'values':
                    streamline(d);
                    return;
                case "tablescan":
                case "cursorscan":
                case "tdescan":
                case "tableconstruction":
                case "virtualtable":
                    collapseChildren(d);
                    return;
                default:
                    break;
            }
        }, function(d) {
            return d.children && d.children.length > 0 ? d.children.slice(0) : null;
        });
    }
}

// Loads a Hyper query plan
function loadHyperPlan(graphString, graphCollapse) {
    var json;
    try {
        json = JSON.parse(graphString);
    } catch (err) {
        return {error: "JSON parse failed with '" + err + "'."};
    }
    var properties = {};
    if (json.hasOwnProperty("plan") && json.plan.hasOwnProperty("header")) {
        properties.columns = json.plan.header.length / 2;
    }
    var root = convertHyper(json, "result");
    generateDisplayNames(root);
    common.createParentLinks(root);
    collapseNodes(root, graphCollapse);
    return {root: root, properties: properties};
}

exports.loadHyperPlan = loadHyperPlan;
