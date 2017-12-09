/*

Hyper JSON Transformations
--------------------------

The Hyper JSON representation renders verbosely as a D3 tree; therefore, perform the following transformations.

Render a few pre-defined keys ("left", "right", "input" and a few others) always as direct input nodes.
For most other nodes, decide based on their value: if it is of a plain type (string, number, ...), show it as part
of the tooltip; otherwise show it as part of the tree.
A short list of special-cased keys (e.g., "analyze") is always displayed as part of the tooltip.
The label for a tree node is taken from the first defined property among "operator", "expression" and "mode".

*/

var common = require('./common');

// Convert Hyper JSON to a D3 tree
function convertHyper(node, parentKey) {
    if (common.toString(node) !== undefined) {
        return {
            text: common.toString(node)
        };
    } else if (typeof (node) === "object" && !Array.isArray(node)) {
        // "Object" nodes
        var children = [];
        var properties = {};

        // Take the first present tagKey as the new tag. Add all others as properties
        var tagKeys = ["operator", "expression", "mode"];
        var tag;
        tagKeys.forEach(function(key) {
            if (!node.hasOwnProperty(key)) {
                return;
            }
            if (tag === undefined) {
                tag = node[key];
            } else {
                properties[key] = common.forceToString(node[key]);
            }
        });
        if (tag === undefined) {
            tag = parentKey;
        }

        // Add the following keys as children
        var childKeys = ["input", "left", "right", "arguments", "value", "valueForComparison"];
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
            var innerNodes = convertHyper(node[key], key);
            if (!Array.isArray(innerNodes)) {
                innerNodes = [innerNodes];
            }
            children.push({tag: key, children: innerNodes});
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
        return convertedNode;
    } else if (Array.isArray(node)) {
        // "Array" nodes
        var listOfObjects = [];
        node.forEach(function(value, index) {
            var innerNode = convertHyper(value, parentKey + "." + String(index));
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
            case "comparison":
                node.name = node.properties.mode ? node.properties.mode : node.tag;
                break;
            case "iuref":
                node.name = node.properties.iu ? node.properties.iu : node.tag;
                break;
            case "attribute":
            case "condition":
            case "header":
            case "iu":
            case "name":
            case "operation":
            case "source":
            case "tableOid":
            case "tid":
            case "tupleFlags":
            case "unique":
            case "unnormalizedNames":
            case "output":
                if (node.text) {
                    node.name = node.tag + ":" + node.text;
                } else {
                    node.name = node.tag;
                }
                break;
            default:
                if (node.tag) {
                    node.name = node.tag;
                } else if (node.text) {
                    node.name = node.text;
                } else {
                    node.name = "";
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
