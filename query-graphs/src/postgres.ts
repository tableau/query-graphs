/*

Postgres JSON Transformations
-----------------------------

The Postgres JSON representation renders verbosely as a D3 tree; therefore, perform the following transformations.

Render a few pre-defined keys ("Plan" and "Plans") always as direct input nodes.
For most other nodes, decide based on their value: if it is of a plain type (string, number, ...), show it as part
of the tooltip; otherwise show it as part of the tree.
A short list of special-cased keys (currently there are none) is always displayed as part of the tooltip.
The label for a tree node is taken from the first defined property among several, which currently only includes "Node Type".

*/

import * as treeDescription from "./tree-description";
import {TreeNode, TreeDescription, Crosslink} from "./tree-description";
import {Json, forceToString, tryToString, formatMetric, computeOrder, hasOwnProperty, hasSubOject} from "./loader-utils";

// Convert Postgres JSON to a D3 tree
function convertPostgres(node: Json, parentKey: string): TreeNode | TreeNode[] {
    if (tryToString(node) !== undefined) {
        return {
            text: tryToString(node),
        };
    } else if (typeof node === "object" && !Array.isArray(node) && node !== null) {
        // "Object" nodes
        let explicitChildren = [] as TreeNode[];
        const additionalChildren = [] as TreeNode[];
        const properties = {};

        // Take the first present tagKey as the new tag. Add all others as properties
        const tagKeys = ["Node Type"];
        let tag: string | undefined;
        for (const tagKey of tagKeys) {
            if (!node.hasOwnProperty(tagKey)) {
                continue;
            }
            if (tag === undefined) {
                tag = tryToString(node[tagKey]);
            } else {
                properties[tagKey] = forceToString(node[tagKey]);
            }
        }
        if (tag === undefined) {
            tag = parentKey;
        }

        // Add the following keys as children
        const childKeys = ["Plan", "Plans"];
        for (const key of childKeys) {
            if (!node.hasOwnProperty(key)) {
                continue;
            }
            const child = convertPostgres(node[key], key);
            if (Array.isArray(child)) {
                explicitChildren = explicitChildren.concat(child);
            } else {
                explicitChildren.push(child);
            }
        }

        // Add the following keys as children only when they refer to objects and display as properties if not
        const objectKeys = [""];
        for (const key of objectKeys) {
            if (!node.hasOwnProperty(key)) {
                continue;
            }
            if (typeof node[key] !== "object") {
                properties[key] = forceToString(node[key]);
                continue;
            }
            const child = convertPostgres(node[key], key);
            if (Array.isArray(child)) {
                explicitChildren = explicitChildren.concat(child);
            } else {
                explicitChildren.push(child);
            }
        }

        // Display these properties always as properties, even if they are more complex
        const propertyKeys = [""];
        for (const key of propertyKeys) {
            if (!node.hasOwnProperty(key)) {
                continue;
            }
            properties[key] = forceToString(node[key]);
        }

        // Display all other properties adaptively: simple expressions are displayed as properties, all others as part of the tree
        const handledKeys = tagKeys.concat(childKeys, objectKeys, propertyKeys);
        for (const key of Object.getOwnPropertyNames(node)) {
            if (handledKeys.indexOf(key) !== -1) {
                continue;
            }

            // Try to display as string property
            const str = tryToString(node[key]);
            if (str !== undefined) {
                properties[key] = str;
                continue;
            }

            // Display as part of the tree
            const innerNodes = convertPostgres(node[key], key);
            if (Array.isArray(innerNodes)) {
                additionalChildren.push({tag: key, children: innerNodes});
            } else {
                additionalChildren.push({tag: key, children: [innerNodes]});
            }
        }

        // Display the cardinality on the links between the nodes
        let edgeLabel: string | undefined = undefined;
        if (node.hasOwnProperty("Plan Rows") && typeof node["Plan Rows"] === "number") {
            edgeLabel = formatMetric(node["Plan Rows"]);
            if (node.hasOwnProperty("Actual Rows") && typeof node["Actual Rows"] === "number") {
                //const num0 = Number(node["Plan Rows"]);
                //const num1 = Number(node["Actual Rows"]);
                //if (num0 > num1 * 10 || num0 * 10 < num1) {
                const order0 = computeOrder(Number(node["Plan Rows"]));
                const order1 = computeOrder(Number(node["Actual Rows"]));
                if (order0 !== order1) {
                    edgeLabel = edgeLabel + ";";
                } else {
                    edgeLabel = edgeLabel + ",";
                }
                edgeLabel = edgeLabel + formatMetric(node["Actual Rows"]);
            }
        }

        // Collapse nodes as appropriate
        let children: TreeNode[];
        let _children: TreeNode[];
        if (node.hasOwnProperty("Triggers") || node.hasOwnProperty("Node Type")) {
            // For operators, the additionalChildren are collapsed by default
            children = explicitChildren;
            _children = explicitChildren.concat(additionalChildren);
        } else {
            // Everything else (usually expressions): display uncollapsed
            children = explicitChildren.concat(additionalChildren);
            _children = [];
        }

        // Sort properties by key
        const sortedProperties = Object.keys(properties)
            .sort()
            .reduce((a, c) => ((a[c] = properties[c]), a), {});

        // Build the converted node
        const convertedNode = {
            tag: tag,
            properties: sortedProperties,
            children: children,
            _children: _children,
            edgeLabel: edgeLabel,
        };
        return convertedNode;
    } else if (Array.isArray(node)) {
        // "Array" nodes
        const listOfObjects = [] as TreeNode[];
        for (let index = 0; index < node.length; ++index) {
            const value = node[index];
            const innerNode = convertPostgres(value, parentKey + "." + index.toString());
            // objectify nested arrays
            if (Array.isArray(innerNode)) {
                innerNode.forEach(function(value, _index) {
                    listOfObjects.push(value);
                });
            } else {
                listOfObjects.push(innerNode);
            }
        }
        return listOfObjects;
    }
    throw new Error("Invalid Postgres query plan");
}

// Function to generate nodes' display names based on their properties
function generateDisplayNames(treeRoot: TreeNode) {
    treeDescription.visitTreeNodes(
        treeRoot,
        function(node) {
            switch (node.tag) {
                case "Hash Join":
                case "Nested Loop":
                case "Merge Join":
                    switch (node["Join Type"]) {
                        case "Inner":
                            node.name = node.tag;
                            node.symbol = "inner-join-symbol";
                            break;
                        case "Full Outer":
                            node.name = node.tag;
                            node.symbol = "full-join-symbol";
                            break;
                        case "Left Outer":
                            node.name = node.tag;
                            node.symbol = "left-join-symbol";
                            break;
                        case "Right Outer":
                            node.name = node.tag;
                            node.symbol = "right-join-symbol";
                            break;
                        default:
                            node.name = node.tag;
                            node.symbol = "inner-join-symbol";
                            break;
                    }
                    break;
                case "Bitmap Heap Scan":
                case "Bitmap Index Scan":
                case "CTE Scan":
                case "Custom Scan":
                case "Foreign Scan":
                case "Function Scan":
                case "Index Only Scan":
                case "Index Scan":
                case "Named Tuplestore Scan":
                case "Sample Scan":
                case "Seq Scan":
                case "Subquery Scan":
                case "Table Function Scan":
                case "Tid Scan":
                case "Values Scan":
                case "WorkTable Scan":
                    node.name = node.tag;
                    node.symbol = "table-symbol";
                    break;
                case "Materialize":
                    node.name = node.tag;
                    node.symbol = "temp-table-symbol";
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
        },
        treeDescription.allChildren,
    );
}

// Color graph per Foreign Scan relations
function colorForeignScan(root: TreeNode) {
    treeDescription.visitTreeNodes(
        root,
        function(d) {
            if (d.tag && d.tag === "Foreign Scan") {
                // A Foreign Scan of one relation has a Schema or a Relations if multiple
                if (d.properties && d.properties.Schema) {
                    d.foreignscan = "qg-" + d.properties.Schema;
                    d.nodeClass = d.foreignscan;
                } else {
                    d.foreignscan = "qg-" + d.properties.Relations.split(/[(.]/).find(token => token !== "");
                    d.nodeClass = d.foreignscan;
                }
            } else if (d.parent && d.parent.foreignscan) {
                d.foreignscan = d.parent.foreignscan;
                d.nodeClass = d.parent.foreignscan;
            }
        },
        treeDescription.allChildren,
    );
}

// Function to add crosslinks between related nodes
function addCrosslinks(root: TreeNode): Crosslink[] {
    interface UnresolvedCrosslink {
        source: TreeNode;
        targetName: string;
    }
    const unresolvedLinks: UnresolvedCrosslink[] = [];
    const operatorsByName = new Map<string, TreeNode>();
    treeDescription.visitTreeNodes(
        root,
        function(node) {
            // Build map from potential target operator Subplan Name to node
            if (
                node.hasOwnProperty("properties") &&
                node.properties.hasOwnProperty("Subplan Name") &&
                node.properties["Subplan Name"].split(" ")[0] === "CTE"
            ) {
                operatorsByName.set(node.properties["Subplan Name"], node);
            }
            // Identify source operators
            if (node.tag === "CTE Scan" && node.hasOwnProperty("properties") && node.properties.hasOwnProperty("CTE Name")) {
                unresolvedLinks.push({
                    source: node,
                    targetName: "CTE " + node.properties["CTE Name"],
                });
            }
        },
        treeDescription.allChildren,
    );
    // Add crosslinks from source to matching target node
    const crosslinks = [] as Crosslink[];
    for (const link of unresolvedLinks) {
        const target = operatorsByName.get(link.targetName);
        if (target !== undefined) {
            crosslinks.push({source: link.source, target: target});
        }
    }
    return crosslinks;
}

// Loads a Postgres query plan
export function loadPostgresPlan(json: Json, graphCollapse: any = undefined): TreeDescription {
    // Extract top-level meta data
    const properties: any = {};
    // Skip initial array containing a single "Plan"
    if (Array.isArray(json) && json.length === 1) {
        json = json[0];
    }
    // Verify Postgres plan signature
    if (!hasSubOject(json, "Plan") || !hasOwnProperty(json.Plan, "Node Type")) {
        throw new Error("Invalid Postgres query plan");
    }
    // Load the graph with the nodes collapsed in an automatic way
    const root = convertPostgres(json, "result");
    if (Array.isArray(root)) {
        throw new Error("Invalid Postgres query plan");
    }
    generateDisplayNames(root);
    treeDescription.createParentLinks(root);
    colorForeignScan(root);
    // Adjust the graph so it is collapsed as requested by the user
    if (graphCollapse === "y") {
        treeDescription.visitTreeNodes(root, treeDescription.collapseAllChildren, treeDescription.allChildren);
    } else if (graphCollapse === "n") {
        treeDescription.visitTreeNodes(root, treeDescription.expandAllChildren, treeDescription.allChildren);
    }
    // Add crosslinks
    const crosslinks = addCrosslinks(root);
    return {root: root, crosslinks: crosslinks, properties: properties};
}

// Load a JSON tree from text
export function loadPostgresPlanFromText(graphString: string, graphCollapse): TreeDescription {
    // Parse the plan as JSON
    let json: Json;
    try {
        json = JSON.parse(graphString);
    } catch (err) {
        throw new Error("JSON parse failed with '" + err + "'.");
    }
    return loadPostgresPlan(json, graphCollapse);
}
