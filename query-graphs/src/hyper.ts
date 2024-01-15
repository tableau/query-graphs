/*

Hyper JSON Transformations
--------------------------

To perform from a Hyper JSON tree to a query-graphs tree, we apply the following heuristics:

The main steps are:

1. Convert the overall tree
    * traverse breadth-first over the tree, converting from JSON to our internal representation
    * detect the type of a node based on the `operator` or `expression` key
      For other nodes, decide based on their value: if it is of a plain type (string, number, ...), show it as part
      of the tooltip; otherwise show it as part of the tree. A few pre-defined keys (e.g., "analyze", are alsways rendered
      in the tooltip, though)
    * lookup a type-specific config which configures the icon, display name etc.
    * render children in a logically meaningful order, i.e. render "left" before "right" etc.
    * collapse tree by defautl:
        * for operators: collapse all children which are not operators
        * for expressions: don't collapse anything
2. Add additional details in a 2nd pass: edge widths, highlighting particularly long-running queries, ...

*/

import * as treeDescription from "./tree-description";
import {TreeNode, TreeDescription, Crosslink, IconName} from "./tree-description";
import {Json, JsonObject, forceToString, tryToString, formatMetric, hasOwnProperty, tryGetPropertyPath} from "./loader-utils";

interface UnresolvedCrosslink {
    source: TreeNode;
    targetOpId: string;
}

// Temporary state which we hold during converting from JSON to internal graph representation
interface ConversionState {
    operatorsById: Map<string, TreeNode>;
    crosslinks: UnresolvedCrosslink[];
    edgeWidths: {node: TreeNode; width: number}[];
    runtimes: {node: TreeNode; time: number}[];
}

// Customization points for rendering the various different
// operator and expression types
interface NodeRenderingConfig {
    displayNameKey?: string;
    crosslinkSourceKey?: string;
    icon?: IconName;
}

const nodeRenderingConfig: Record<string, NodeRenderingConfig> = {
    "op:executiontarget": {icon: "run-query-symbol"},
    "op:select": {icon: "filter-symbol"},
    "op:sort": {icon: "sort-symbol"},
    "op:groupby": {icon: "groupby-symbol"},
    // Joins
    "op:join": {icon: "inner-join-symbol", crosslinkSourceKey: "magic"},
    "op:leftouterjoin": {icon: "left-join-symbol", crosslinkSourceKey: "magic"},
    "op:rightouterjoin": {icon: "right-join-symbol", crosslinkSourceKey: "magic"},
    "op:fullouterjoin": {icon: "full-join-symbol", crosslinkSourceKey: "magic"},
    "op:leftantijoin": {crosslinkSourceKey: "magic"},
    "op:rightantijoin": {crosslinkSourceKey: "magic"},
    "op:leftsemijoin": {crosslinkSourceKey: "magic"},
    "op:rightsemijoin": {crosslinkSourceKey: "magic"},
    "op:leftsinglejoin": {crosslinkSourceKey: "magic"},
    "op:rightsinglejoin": {crosslinkSourceKey: "magic"},
    "op:leftmarkjoin": {crosslinkSourceKey: "magic"},
    "op:rightmarkjoin": {crosslinkSourceKey: "magic"},
    "op:earlyprobe": {icon: "filter-symbol", crosslinkSourceKey: "builder"},
    // Various scans
    "op:tablescan": {icon: "table-symbol"},
    "op:binaryscan": {icon: "table-symbol"},
    "op:cursorscan": {icon: "table-symbol"},
    "op:csvscan": {icon: "table-symbol"},
    "op:parquetscan": {icon: "table-symbol"},
    "op:tdescan": {icon: "table-symbol"},
    // Other tables
    "op:tableconstruction": {icon: "const-table-symbol"},
    "op:virtualtable": {icon: "virtual-table-symbol"},
    // Temp & Explicit scan
    "op:explicitscan": {icon: "temp-table-symbol", crosslinkSourceKey: "input"},
    "op:temp": {icon: "temp-table-symbol"},
    // Expressions
    "exp:comparison": {displayNameKey: "mode"},
    "exp:iuref": {displayNameKey: "iu"},
};

// Should the entry `key` from `node` always be expanded?
function isAlwaysExpanded(node: JsonObject, key: string): boolean {
    const child = node[key];
    if (node.hasOwnProperty("operator")) {
        // There might be arrays of operators. Also detect those...
        let unwrapped = child;
        while (Array.isArray(unwrapped) && unwrapped.length) {
            unwrapped = unwrapped[0];
        }
        // Subobjects which are also operators themself should be displayed
        if (typeof unwrapped === "object" && !Array.isArray(unwrapped) && unwrapped !== null) {
            return unwrapped.hasOwnProperty("operator");
        }
        // All other children should be hidden
        return false;
    }
    return false;
}

// Convert Hyper JSON to a D3 tree
function convertHyperNode(rawNode: Json, parentKey, conversionState: ConversionState): TreeNode | TreeNode[] {
    if (tryToString(rawNode) !== undefined) {
        return {
            name: tryToString(rawNode),
        };
    } else if (typeof rawNode === "object" && !Array.isArray(rawNode) && rawNode !== null) {
        // "Object" nodes
        const expandedChildren = [] as TreeNode[];
        const collapsedChildren = [] as TreeNode[];
        const properties = new Map<string, string>();

        // Figure out if this is an operator or an expression and
        // retrieve the operator-specific customizations
        let nodeType: "operator" | "expression" | undefined;
        let nodeTag: string | undefined;
        let renderingConfig: NodeRenderingConfig = {};
        if (rawNode.hasOwnProperty("operator")) {
            const val = tryToString(rawNode["operator"]);
            if (val !== undefined) {
                nodeType = "operator";
                nodeTag = val;
                renderingConfig = nodeRenderingConfig[`op:${nodeTag}`] ?? {};
            }
        } else if (rawNode.hasOwnProperty("expression")) {
            const val = tryToString(rawNode["expression"]);
            if (val !== undefined) {
                nodeType = "expression";
                nodeTag = val;
                renderingConfig = nodeRenderingConfig[`exp:${nodeTag}`] ?? {};
            }
        } else {
            // Just inherit the parent key by default
            nodeTag = parentKey;
        }

        // Display these properties always as properties, even if they are more complex
        const propertyKeys = ["debugName", "analyze", "querylocs"];
        for (const key of propertyKeys) {
            if (!rawNode.hasOwnProperty(key)) {
                continue;
            }
            properties.set(key, forceToString(rawNode[key]));
        }

        // Determine the order in which other keys are displayed.
        // For some keys, we enforce a specific order here (e.g., "left" comes before "right").
        // For all other keys, we use alphabetic order.
        const fixedOrder = ["input", "left", "right", "value", "valueForComparison"];
        const orderedKeys = Object.getOwnPropertyNames(rawNode)
            .filter(k => {
                // `propertyKeys` and `operator`/`expression` were already handled
                return k != nodeType && propertyKeys.indexOf(k) === -1;
            })
            .sort((a, b) => {
                const idx1 = fixedOrder.indexOf(a);
                const idx2 = fixedOrder.indexOf(b);
                if (idx1 != -1 || idx2 != -1) {
                    const fixed1 = idx1 == -1 ? Infinity : idx1;
                    const fixed2 = idx2 == -1 ? Infinity : idx2;
                    return fixed1 - fixed2;
                } else {
                    if (a < b) return -1;
                    if (a > b) return 1;
                    return 0;
                }
            });

        // Display all other properties adaptively: simple expressions are displayed as properties, all others as part of the tree
        for (const key of orderedKeys) {
            // Try to display as string property
            const str = tryToString(rawNode[key]);
            if (str !== undefined) {
                properties.set(key, str);
                continue;
            }

            // Display as part of the tree
            const children = isAlwaysExpanded(rawNode, key) ? expandedChildren : collapsedChildren;
            const innerNodes = convertHyperNode(rawNode[key], key, conversionState);
            const innerNodesArray = Array.isArray(innerNodes) ? innerNodes : [innerNodes];
            if (fixedOrder.indexOf(key) != -1) {
                Array.prototype.push.apply(children, innerNodesArray);
            } else {
                // Array-valued children are collapsed by default, to avoid displaying too many properties all at once.
                children.push({name: key, collapsedChildren: innerNodesArray});
            }
        }

        // Build the converted node
        const convertedNode = {
            icon: renderingConfig.icon,
            properties,
            children: expandedChildren,
            collapsedChildren,
            expandedByDefault: nodeType != "operator" && expandedChildren.length == 0
        } as TreeNode;

        // Figure out the display name
        const specificDisplayName = renderingConfig.displayNameKey ? properties.get(renderingConfig.displayNameKey) : undefined;
        const debugNameNode = tryGetPropertyPath(rawNode, ["debugName", "value"]);
        const debugName = typeof debugNameNode === "string" ? debugNameNode : undefined;
        convertedNode.name = debugName ?? specificDisplayName ?? properties?.get("name") ?? nodeTag ?? "";

        // Information on the execution time
        const execTime = tryGetPropertyPath(rawNode, ["analyze", "tuplecount"]);
        if (typeof execTime === "number") {
            conversionState.runtimes.push({node: convertedNode, time: execTime});
        }

        // Display the cardinality on the links between the nodes
        if (hasOwnProperty(rawNode, "cardinality") && typeof rawNode.cardinality === "number") {
            const estimatedCard = rawNode.cardinality;
            const actualCard = tryGetPropertyPath(rawNode, ["analyze", "tuplecount"]);
            if (typeof actualCard === "number") {
                conversionState.edgeWidths.push({node: convertedNode, width: actualCard});
                convertedNode.edgeLabel = formatMetric(actualCard) + "/" + formatMetric(estimatedCard);
                // Highlight significant differences between planned and actual rows
                if (estimatedCard > actualCard * 10 || actualCard * 10 < estimatedCard) {
                    convertedNode.edgeClass = "qg-label-highlighted";
                }
            } else {
                conversionState.edgeWidths.push({node: convertedNode, width: estimatedCard});
                convertedNode.edgeLabel = formatMetric(estimatedCard);
            }
        }

        // Add to `operatorId` map if applicable
        if (nodeType == "operator") {
            const operatorId = properties?.get("operatorId");
            if (operatorId !== undefined) {
                conversionState.operatorsById.set(operatorId, convertedNode);
            }
        }

        // Add cross links
        if (renderingConfig.crosslinkSourceKey) {
            const sourceId = properties?.get(renderingConfig.crosslinkSourceKey);
            if (sourceId !== undefined) {
                conversionState.crosslinks.push({
                    source: convertedNode,
                    targetOpId: sourceId,
                });
            }
        }

        return convertedNode;
    } else if (Array.isArray(rawNode)) {
        // "Array" nodes
        const listOfObjects = [] as TreeNode[];
        for (let index = 0; index < rawNode.length; ++index) {
            const value = rawNode[index];
            const innerNode = convertHyperNode(value, parentKey + "." + index.toString(), conversionState);
            // objectify nested arrays
            if (Array.isArray(innerNode)) {
                innerNode.forEach(value => {
                    listOfObjects.push(value);
                });
            } else {
                listOfObjects.push(innerNode);
            }
        }
        return listOfObjects;
    }
    throw new Error("Invalid Hyper query plan");
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
function colorRelativeExecutionTime(state: ConversionState) {
    const totalTime = state.runtimes.reduce((p, v) => p + v.time, 0);
    for (const op of state.runtimes) {
        const relativeExecutionRatio = op.time / totalTime;
        const l = (95 + (72 - 95) * relativeExecutionRatio).toFixed(3);
        op.node.nodeColor = relativeExecutionRatio >= 0.05 ? `hsl(309, 84%, ${l}%)` : undefined;
    }
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

interface LinkedNodes {
    root: TreeNode;
    crosslinks: Crosslink[];
}

function convertHyperPlan(node: Json): LinkedNodes {
    const conversionState = {
        operatorsById: new Map<string, TreeNode>(),
        crosslinks: [],
        edgeWidths: [],
        runtimes: [],
    } as ConversionState;
    const root = convertHyperNode(node, "result", conversionState);
    if (Array.isArray(root)) {
        throw new Error("Invalid Hyper query plan");
    }
    colorRelativeExecutionTime(conversionState);
    setEdgeWidths(conversionState);
    const crosslinks = resolveCrosslinks(conversionState);
    return {root, crosslinks};
}

function convertOptimizerSteps(node: Json): LinkedNodes | undefined {
    // Check if we have a top-level object with a single key "optimizersteps" containing an array
    if (typeof node !== "object" || Array.isArray(node) || node === null) return undefined;
    if (Object.getOwnPropertyNames(node).length != 1) return undefined;
    if (!node.hasOwnProperty("optimizersteps")) return undefined;
    const steps = node["optimizersteps"];
    if (!Array.isArray(steps)) return undefined;

    // Transform the optimizer steps
    const crosslinks: Crosslink[] = [];
    const children: TreeNode[] = [];
    for (let i = 0; i < steps.length; ++i) {
        const step = steps[i];
        // Check that our step has two subproperties: "name" and "plan"
        if (typeof step !== "object" || Array.isArray(step) || step === null) return undefined;
        if (Object.getOwnPropertyNames(step).length != 2) return undefined;
        if (!step.hasOwnProperty("name")) return undefined;
        if (!step.hasOwnProperty("plan")) return undefined;
        const name = step["name"];
        const plan = step["plan"];
        if (typeof name !== "string") return undefined;

        // Add the child
        const {root: childRoot, crosslinks: newCrosslinks} = convertHyperPlan(plan);
        crosslinks.push(...newCrosslinks);
        children.push({name: name, children: [childRoot]});
    }
    const root = {name: "optimizersteps", children: children};
    return {root, crosslinks};
}

// Loads a Hyper query plan
export function loadHyperPlan(json: Json): TreeDescription {
    // Load the graph with the nodes collapsed in an automatic way
    const {root, crosslinks} = convertOptimizerSteps(json) ?? convertHyperPlan(json);
    treeDescription.createParentLinks(root);
    // Adjust the graph so it is collapsed as requested by the user
    return {root, crosslinks};
}

function tryStripPrefix(str, pre) {
    if (str.startsWith(pre)) return str.substring(pre.length);
    return str;
}

// Load a JSON tree from text
export function loadHyperPlanFromText(graphString: string): TreeDescription {
    // Strip `plan` prefix if it exists. This is written by `sql_hyper` if output is forwarded using `\o`
    graphString = tryStripPrefix(graphString, "plan\n");

    // Parse the plan as JSON
    let json: Json;
    try {
        json = JSON.parse(graphString);
    } catch (err) {
        throw new Error("JSON parse failed with '" + err + "'.");
    }
    return loadHyperPlan(json);
}
