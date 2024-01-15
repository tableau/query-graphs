/*

Postgres JSON Transformations
-----------------------------

This is pretty much the same algorithm as the algorithm for Hyper plans

*/

import * as treeDescription from "./tree-description";
import {TreeNode, TreeDescription, Crosslink, IconName} from "./tree-description";
import {assert, Json, tryToString, formatMetric, hasOwnProperty, hasSubOject} from "./loader-utils";

interface UnresolvedCrosslink {
    source: TreeNode;
    targetOpId: string;
}

// Temporary state which we hold during converting from JSON to internal graph representation
interface ConversionState {
    operatorsById: Map<string, TreeNode>;
    crosslinks: UnresolvedCrosslink[];
    edgeWidths: {node: TreeNode; width: number}[];
}

interface OperatorRenderingDescription {
    displayName: string;
    icon?: IconName;
    crosslinkId?: string,
}

function getOperatorRendering(operatorType: string, properties: Map<string, string>): OperatorRenderingDescription {
    switch (operatorType) {
        case "Hash Join":
        case "Nested Loop":
        case "Merge Join":
            const joinIcons = {
                "Inner": "inner-join-symbol",
                "Full Outer": "full-join-symbol",
                "Left Outer": "left-join-symbol",
                "Right Outer": "right-join-symbol",
            }
            const icon = joinIcons[properties?.get("Join Type") ?? ""] ?? "inner-join-symbol";
            return {displayName: operatorType, icon};
        case "CTE Scan":
            return {
                displayName: operatorType,
                icon: "temp-table-symbol",
                crosslinkId: "CTE " + properties.get("CTE Name")};
        case "Materialize":
        case "WorkTable Scan":
            return {displayName: operatorType, icon: "temp-table-symbol"};
        case "Incremental Sort":
        case "Sort":
            return {displayName: operatorType, icon: "sort-symbol"};
        case "Result":
            return {displayName: operatorType, icon: "const-table-symbol"};
        case "Limit":
            return {displayName: operatorType, icon: "filter-symbol"};
        case "Aggregate":
            return {displayName: operatorType, icon: "groupby-symbol"};
        case "Function Scan":
        case "Table Function Scan":
            return {displayName: operatorType};
        default:
            if (operatorType?.endsWith(" Scan")) {
                let displayName = properties?.get("Relation Name") ?? properties?.get("Index Name");
                if (displayName) {
                    displayName = displayName + " (" + operatorType + ")";
                } else {
                    displayName = operatorType;
                }
                return {displayName, icon: "table-symbol"};
            } else {
                return {displayName: operatorType};
            }
    }
}

// Convert Postgres JSON to a D3 tree
function convertPostgresNode(rawNode: Json, parentKey: string, conversionState: ConversionState): TreeNode | TreeNode[] {
    if (tryToString(rawNode) !== undefined) {
        return {
            name: tryToString(rawNode),
        };
    } else if (typeof rawNode === "object" && !Array.isArray(rawNode) && rawNode !== null) {
        // "Object" nodes
        let children = [] as TreeNode[];
        let collapsedChildren = [] as TreeNode[];
        const properties = new Map<string, string>();

        // Take the first present tagKey as the new tag. Add all others as properties
        let operatorType: string | undefined;
        const operatorTypeKey = "Node Type";
        if (rawNode.hasOwnProperty(operatorTypeKey)) {
            operatorType = tryToString(rawNode[operatorTypeKey]);
        }

        // Add the following keys as children
        const childKeys = ["Plan", "Plans"];
        for (const key of childKeys) {
            if (!rawNode.hasOwnProperty(key)) {
                continue;
            }
            const child = convertPostgresNode(rawNode[key], key, conversionState);
            if (Array.isArray(child)) {
                children = children.concat(child);
            } else {
                children.push(child);
            }
        }

        // Display all other properties adaptively: simple expressions are displayed as properties, all others as part of the tree
        const handledKeys = ["Node Type"].concat(childKeys);
        for (const key of Object.getOwnPropertyNames(rawNode)) {
            if (handledKeys.indexOf(key) !== -1) {
                continue;
            }

            // Try to display as string property
            const str = tryToString(rawNode[key]);
            if (str !== undefined) {
                properties.set(key, str);
                continue;
            }

            // Display as part of the tree
            const innerNodes = convertPostgresNode(rawNode[key], key, conversionState);
            if (Array.isArray(innerNodes)) {
                collapsedChildren.push({tag: key, children: innerNodes});
            } else {
                collapsedChildren.push({tag: key, children: [innerNodes]});
            }
        }

        // Determine display name & icon
        let displayName = parentKey;
        let crosslinkId: string | undefined = undefined;
        let icon: IconName | undefined;
        if (operatorType) {
            let res = getOperatorRendering(operatorType, properties);
            displayName = res.displayName;
            icon = res.icon;
            crosslinkId = res.crosslinkId
        }

        // Collapse nodes as appropriate
        // For operators, the additionalChildren are collapsed by default.
        // Everything else (usually expressions): display uncollapsed
        if (!rawNode.hasOwnProperty("Triggers") && !rawNode.hasOwnProperty("Node Type")) {
            children = children.concat(collapsedChildren);
            collapsedChildren = [];
        }

        // Sort properties by key
        const sortedProperties = new Map<string, string>();
        for (const k of Array.from(properties.keys()).sort()) {
            sortedProperties.set(k, properties.get(k) as string);
        }

        // Build the converted node
        let convertedNode = {
            name: displayName,
            icon,
            properties: sortedProperties,
            children,
            collapsedChildren,
        } as TreeNode;

        // Display the cardinality on the links between the nodes
        if (rawNode.hasOwnProperty("Plan Rows") && typeof rawNode["Plan Rows"] === "number") {
            const estimatedCard = rawNode["Plan Rows"];
            const actualCard = rawNode.hasOwnProperty("Actual Rows") ? rawNode["Actual Rows"] : undefined;
            if (typeof actualCard === "number") {
                conversionState.edgeWidths.push({node: convertedNode, width: actualCard});
                convertedNode.edgeLabel = formatMetric(actualCard) + "/" + formatMetric(estimatedCard);
                // Highlight significant differences between planned and actual rows
                if (estimatedCard > actualCard * 10 || actualCard * 10 < estimatedCard) {
                    convertedNode.edgeClass = "qg-label-highlighted";
                }
            } else {
                conversionState.edgeWidths.push({node: convertedNode, width: estimatedCard});
                convertedNode.edgeLabel = formatMetric(rawNode["Plan Rows"]);
            }
        }

        // Add to `operatorId` map if applicable
        if (operatorType) {
            const operatorId = properties?.get("Subplan Name");
            if (operatorId !== undefined) {
                conversionState.operatorsById.set(operatorId, convertedNode);
            }
        }

        // Add cross links
        if (crosslinkId) {
            conversionState.crosslinks.push({
                source: convertedNode,
                targetOpId: crosslinkId,
            });
        }

        return convertedNode;
    } else if (Array.isArray(rawNode)) {
        // "Array" nodes
        const listOfObjects = [] as TreeNode[];
        for (let index = 0; index < rawNode.length; ++index) {
            const value = rawNode[index];
            const innerNode = convertPostgresNode(value, parentKey + "." + index.toString(), conversionState);
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
    if (node.name === "Gather" || node.name === "Gather Merge") {
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
        if (node.name !== "Gather" && node.name !== "Gather Merge") {
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

// Resolve all pending crosslinks
function resolveCrosslinks(state: ConversionState): Crosslink[] {
    const crosslinks = [] as Crosslink[];
    for (const link of state.crosslinks) {
        const target = state.operatorsById.get(link.targetOpId);
        if (target !== undefined) {
            crosslinks.push({source: link.source, target: target});
        }
    }
    return crosslinks;
}

// Sets the edge widths, relative to the number of output tuples
function setEdgeWidths(state: ConversionState) {
    let maxWidth = state.edgeWidths.reduce((p, v) => (p > v.width ? p : v.width), 0);
    const minWidth = state.edgeWidths.reduce((p, v) => (p < v.width ? p : v.width), Infinity);
    if (minWidth == maxWidth) return;
    const factor = Math.max(maxWidth - minWidth, minWidth);
    maxWidth = Math.max(maxWidth, 10);
    for (const edge of state.edgeWidths) {
        edge.node.edgeWidth = (edge.width - minWidth) / factor;
    }
}

// Loads a Postgres query plan
export function loadPostgresPlan(json: Json): TreeDescription {
    // Skip initial array containing a single "Plan"
    if (Array.isArray(json) && json.length === 1) {
        json = json[0];
    }
    // Verify Postgres plan signature
    if (!hasSubOject(json, "Plan") || !hasOwnProperty(json.Plan, "Node Type")) {
        throw new Error("Invalid Postgres query plan");
    }
    // Load the graph
    const conversionState = {
        operatorsById: new Map<string, TreeNode>(),
        crosslinks: [],
        edgeWidths: [],
        runtimes: [],
    } as ConversionState;
    const root = convertPostgresNode(json, "result", conversionState);
    if (Array.isArray(root)) {
        throw new Error("Invalid Postgres query plan");
    }
    colorRelativeExecutionTime(root);
    setEdgeWidths(conversionState);
    const crosslinks = resolveCrosslinks(conversionState);
    return {root: root, crosslinks: crosslinks};
}

// Load a JSON tree from text
export function loadPostgresPlanFromText(graphString: string): TreeDescription {
    // Parse the plan as JSON
    let json: Json;
    try {
        json = JSON.parse(graphString);
    } catch (err) {
        throw new Error("JSON parse failed with '" + err + "'.");
    }
    return loadPostgresPlan(json);
}
