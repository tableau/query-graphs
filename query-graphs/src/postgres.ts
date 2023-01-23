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
import {assert, Json, forceToString, tryToString, formatMetric, hasOwnProperty, hasSubOject} from "./loader-utils";

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
        const properties = new Map<string, string>();

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
                properties.set(tagKey, forceToString(node[tagKey]));
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
                properties.set(key, forceToString(node[key]));
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
            if (node.hasOwnProperty(key)) {
                properties.set(key, forceToString(node[key]));
            }
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
                properties.set(key, str);
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
        let edgeLabelClass: string | undefined = undefined;
        if (node.hasOwnProperty("Plan Rows") && typeof node["Plan Rows"] === "number") {
            edgeLabel = formatMetric(node["Plan Rows"]);
            if (node.hasOwnProperty("Actual Rows") && typeof node["Actual Rows"] === "number") {
                edgeLabel += "," + formatMetric(node["Actual Rows"]);
                // Highlight significant differences between planned and actual rows
                const num0 = Number(node["Plan Rows"]);
                const num1 = Number(node["Actual Rows"]);
                if (num0 > num1 * 10 || num0 * 10 < num1) {
                    edgeLabelClass = "qg-link-label-highlighted";
                }
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
        const sortedProperties = new Map<string, string>();
        for (const k of Array.from(properties.keys()).sort()) {
            sortedProperties.set(k, properties.get(k) as string);
        }

        // Build the converted node
        return {
            tag: tag,
            properties: sortedProperties,
            children: children,
            _children: _children,
            edgeLabel: edgeLabel,
            edgeLabelClass: edgeLabelClass,
        };
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
                    if (node.hasOwnProperty("properties")) {
                        switch (node.properties?.get("Join Type")) {
                            case "Inner":
                                node.name = node.tag;
                                node.icon = "inner-join-symbol";
                                break;
                            case "Full Outer":
                                node.name = node.tag;
                                node.icon = "full-join-symbol";
                                break;
                            case "Left Outer":
                                node.name = node.tag;
                                node.icon = "left-join-symbol";
                                break;
                            case "Right Outer":
                                node.name = node.tag;
                                node.icon = "right-join-symbol";
                                break;
                            default:
                                node.name = node.tag;
                                node.icon = "inner-join-symbol";
                                break;
                        }
                    }
                    break;
                case "CTE Scan":
                case "Materialize":
                case "WorkTable Scan":
                    node.name = node.tag;
                    node.icon = "temp-table-symbol";
                    break;
                case "Incremental Sort":
                case "Sort":
                    node.name = node.tag;
                    node.icon = "sort-symbol";
                    break;
                case "Result":
                    node.name = node.tag;
                    node.icon = "const-table-symbol";
                    break;
                case "Limit":
                    node.name = node.tag;
                    node.icon = "filter-symbol";
                    break;
                case "Function Scan":
                case "Table Function Scan":
                    node.name = node.tag;
                    break;
                default:
                    if (node.tag?.endsWith(" Scan")) {
                        const scanName = node.properties?.get("Relation Name") ?? node.properties?.get("Index Name");
                        if (scanName) {
                            node.name = scanName + " (" + node.tag + ")";
                        } else {
                            node.name = node.tag;
                        }
                        node.icon = "table-symbol";
                    } else if (node.tag) {
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
function colorForeignScan(node: TreeNode, foreignScan?: string) {
    if (node.tag === "Foreign Scan") {
        // A Foreign Scan of one relation has a Schema or a Relations if multiple
        const schema = node.properties?.get("Schema");
        const relations = node.properties?.get("Relations");
        if (schema) {
            foreignScan = schema;
        } else if (relations) {
            foreignScan = relations.split(/[(.]/).find(token => token !== "");
        }
    }
    if (foreignScan !== undefined) {
        node.nodeClass = "qg-" + foreignScan;
    }
    for (const child of treeDescription.allChildren(node)) {
        colorForeignScan(child, foreignScan);
    }
}

// Color graph per a node's relative execution time
// Actual Total Time is cumulative
// Nodes with Actual Loops > 1 record an average Actual Total Time
// Parallelized nodes have Actual Loops = Workers Launched + 1 for the leader
// Not all Postgres plans have a root Execution Time even when children have Actual Total Time
function colorRelativeExecutionTime(root: TreeNode) {
    let executionTime = root.properties?.get("Execution Time");
    if (executionTime === undefined) {
        for (const child of treeDescription.allChildren(root)) {
            const actualTotalTime = child.properties?.get("Actual Total Time");
            if (actualTotalTime) {
                assert(executionTime === undefined, "Unexpected result child node");
                executionTime = actualTotalTime;
            }
        }
    }
    if (executionTime) {
        for (const child of treeDescription.allChildren(root)) {
            colorChildRelativeExecutionRatio(child, Number(executionTime), 1);
        }
    }
}
function colorChildRelativeExecutionRatio(node: TreeNode, executionTime: number, degreeOfParallelism: number) {
    let childrenTime = 0;
    if (node.tag === "Gather" || node.tag === "Gather Merge") {
        const workersLaunched = node.properties?.get("Workers Launched");
        assert(workersLaunched !== undefined, "Unexpected Workers Launched");
        degreeOfParallelism = Number(workersLaunched) + 1 /* leader */;
    }
    for (const child of treeDescription.allChildren(node)) {
        const actualTotalTime = child.properties?.get("Actual Total Time");
        if (actualTotalTime) {
            const actualLoops = child.properties?.get("Actual Loops");
            assert(actualLoops !== undefined, "Unexpected Actual Loops");
            const childLoops = Number(actualLoops) / degreeOfParallelism;
            childrenTime += Number(actualTotalTime) * childLoops;
        }
    }
    const actualTotalTime = node.properties?.get("Actual Total Time");
    if (actualTotalTime) {
        const nodeTotalTime = Number(actualTotalTime);
        const actualLoops = node.properties?.get("Actual Loops");
        assert(actualLoops !== undefined, "Unexpected Actual Loops");
        let nodeLoops = Number(actualLoops);
        if (node.tag !== "Gather" && node.tag !== "Gather Merge") {
            nodeLoops /= degreeOfParallelism;
        }

        const relativeTotalTime = nodeTotalTime * nodeLoops - childrenTime;
        const relativeExecutionRatio = relativeTotalTime / executionTime;
        // TODO: remove Actual Total Time of a CTE from referencing CTE Scan subplans
        // TODO: assert(relativeExecutionRatio >= 0, "Unexpected relative execution ratio");

        assert(node.properties !== undefined);
        node.properties.set("~Relative Time", relativeTotalTime.toFixed(3));
        node.properties.set("~Relative Time Ratio", relativeExecutionRatio.toFixed(3));
        const l = (95 + (72 - 95) * relativeExecutionRatio).toFixed(3);
        node.nodeColor = relativeExecutionRatio >= 0.05 ? `hsl(309, 84%, ${l}%)` : undefined;
    }
    for (const child of treeDescription.allChildren(node)) {
        colorChildRelativeExecutionRatio(child, executionTime, degreeOfParallelism);
    }
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
            const subplanName = node.properties?.get("Subplan Name");
            if (subplanName?.startsWith("CTE ")) {
                operatorsByName.set(subplanName, node);
            }
            // Identify source operators
            if (node.tag === "CTE Scan" && node.properties?.has("CTE Name")) {
                unresolvedLinks.push({
                    source: node,
                    targetName: "CTE " + node.properties.get("CTE Name"),
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
export function loadPostgresPlan(json: Json, graphCollapse: unknown = undefined): TreeDescription {
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
    colorRelativeExecutionTime(root);
    // Adjust the graph so it is collapsed as requested by the user
    if (graphCollapse === "y") {
        treeDescription.visitTreeNodes(root, treeDescription.collapseAllChildren, treeDescription.allChildren);
    } else if (graphCollapse === "n") {
        treeDescription.visitTreeNodes(root, treeDescription.expandAllChildren, treeDescription.allChildren);
    }
    // Add crosslinks
    const crosslinks = addCrosslinks(root);
    return {root: root, crosslinks: crosslinks};
}

// Load a JSON tree from text
export function loadPostgresPlanFromText(graphString: string, graphCollapse?: unknown): TreeDescription {
    // Parse the plan as JSON
    let json: Json;
    try {
        json = JSON.parse(graphString);
    } catch (err) {
        throw new Error("JSON parse failed with '" + err + "'.");
    }
    return loadPostgresPlan(json, graphCollapse);
}
