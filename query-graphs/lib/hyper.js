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

import * as common from './common';

// Convert Hyper JSON to a D3 tree
function convertHyper(node, parentKey) {
    if (common.toString(node) !== undefined) {
        return {
            text: common.toString(node)
        };
    } else if (typeof (node) === "object" && !Array.isArray(node)) {
        // "Object" nodes
        var explicitChildren = [];
        var additionalChildren = [];
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
                explicitChildren = explicitChildren.concat(child);
            } else {
                explicitChildren.push(child);
            }
        });

        // Add the following keys as children only when they refer to objects and display as properties if not
        var objectKeys = ["source"];
        objectKeys.forEach(function(key) {
            if (!node.hasOwnProperty(key)) {
                return;
            }
            if (typeof node[key] !== "object") {
                properties[key] = common.forceToString(node[key]);
                return;
            }
            var child = convertHyper(node[key], key);
            if (Array.isArray(child)) {
                explicitChildren = explicitChildren.concat(child);
            } else {
                explicitChildren.push(child);
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
        var handledKeys = tagKeys.concat(childKeys, objectKeys, propertyKeys);
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
            additionalChildren.push({tag: key, children: innerNodes});
            return;
        });

        // Display the cardinality on the links between the nodes
        var edgeLabel = node.hasOwnProperty("cardinality") ? common.formatMetric(node.cardinality) : undefined;
        // Collapse nodes as appropriate
        var children;
        var _children;
        if (node.hasOwnProperty("plan")) {
            // The top-level plan element needs special attention: we want to hide the `header` by default
            _children = explicitChildren.concat(additionalChildren);
            var planIdx = _children.findIndex(function(n) {
                return n.tag === "plan";
            });
            children = [_children[planIdx]];
        } else if (node.hasOwnProperty("operator")) {
            // For operators, the additionalChildren are collapsed by default
            children = explicitChildren;
            _children = explicitChildren.concat(additionalChildren);
        } else {
            // Everything else (usually expressions): display uncollapsed
            children = explicitChildren.concat(additionalChildren);
        }
        // Build the converted node
        var convertedNode = {
            tag: tag,
            properties: properties,
            children: children,
            _children: _children,
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
            case "explicitscan":
                node.name = node.tag;
                node.symbol = "temp-table-symbol";
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
    }, common.allChildren);
}

// Function to add crosslinks between related nodes
function addCrosslinks(root) {
    var crosslinks = [];
    var sourcenodes = [];
    var operatorsById = [];
    var optimizerStep = 0;

    common.visit(root, function(node) {
        // Operators are only unique within an optimizer step
        if (node.tag !== undefined && node.tag.startsWith("optimizersteps")) {
            optimizerStep = parseInt(node.tag.split(".")[1], 10);
        }

        // Build map from operatorId to node
        if (node.hasOwnProperty("properties") && node.properties.hasOwnProperty("operatorId")) {
            operatorsById[[parseInt(node.properties.operatorId, 10), optimizerStep]] = node;
        }

        // Identify source operators
        switch (node.tag) {
            case "explicitscan":
                if (node.hasOwnProperty("properties") && node.properties.hasOwnProperty("source")) {
                    sourcenodes.push({node: node, operatorId: parseInt(node.properties.source, 10), optimizerStep: optimizerStep});
                }
                break;
            case "earlyprobe":
                if (node.hasOwnProperty("properties") && node.properties.hasOwnProperty("builder")) {
                    sourcenodes.push({node: node, operatorId: parseInt(node.properties.builder, 10), optimizerStep: optimizerStep});
                }
                break;
            default:
                if (node.hasOwnProperty("properties") && node.properties.hasOwnProperty("magic")) {
                    sourcenodes.push({node: node, operatorId: parseInt(node.properties.magic, 10), optimizerStep: optimizerStep});
                }
                break;
        }
    }, common.allChildren);

    // Add crosslinks from source to matching target node
    sourcenodes.forEach(function(source) {
        var targetnode = operatorsById[[source.operatorId, source.optimizerStep]];
        var entry = {source: source.node, target: targetnode};
        crosslinks.push(entry);
    });

    return crosslinks;
}

// Loads a Hyper query plan
export function loadHyperPlan(json, graphCollapse) {
    // Extract top-level meta data
    var properties = {};
    if (json.hasOwnProperty("plan") && json.plan.hasOwnProperty("header")) {
        properties.columns = json.plan.header.length / 2;
    }
    // Load the graph with the nodes collapsed in an automatic way
    var root = convertHyper(json, "result");
    generateDisplayNames(root);
    common.createParentLinks(root);
    // Adjust the graph so it is collapsed as requested by the user
    if (graphCollapse === 'y') {
        common.visit(root, common.collapseAllChildren, common.allChildren);
    } else if (graphCollapse === 'n') {
        common.visit(root, common.expandAllChildren, common.allChildren);
    }
    // Add crosslinks
    var crosslinks = addCrosslinks(root);
    return {root: root, crosslinks: crosslinks, properties: properties};
}

// Load a JSON tree from text
export function loadHyperPlanFromText(graphString, graphCollapse) {
    // Parse the plan as JSON
    var json;
    try {
        json = JSON.parse(graphString);
    } catch (err) {
        return {error: "JSON parse failed with '" + err + "'."};
    }
    return loadHyperPlan(json, graphCollapse);
}
