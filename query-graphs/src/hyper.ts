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

import {TreeNode, TreeDescription, Crosslink, IconName, visitTreeNodes, allChildren} from "./tree-description";
import {Json, JsonObject, forceToString, tryToString, formatMetric, hasOwnProperty, tryGetPropertyPath} from "./loader-utils";

// A categorical color palette for execution pipelines.
// Curated for good separation and readability on a white background
// (based on the Tableau 10 palette, with the low-contrast yellow darkened).
const PIPELINE_PALETTE = [
    "#4e79a7", // blue
    "#f28e2b", // orange
    "#59a14f", // green
    "#e15759", // red
    "#b07aa1", // purple
    "#76b7b2", // teal
    "#9c6b3f", // brown
    "#ff9da7", // pink
    "#b5992b", // gold
    "#8c8c8c", // gray
];

function pipelineColor(index: number): string {
    return PIPELINE_PALETTE[index % PIPELINE_PALETTE.length];
}

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
    metadata: Map<string, string>;
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
    "op:arrowscan": {icon: "table-symbol"},
    "op:binaryscan": {icon: "table-symbol"},
    "op:csvscan": {icon: "table-symbol"},
    "op:cloudtablescan": {icon: "table-symbol"},
    "op:cursorscan": {icon: "table-symbol"},
    "op:icebergscan": {icon: "table-symbol"},
    "op:parquetscan": {icon: "table-symbol"},
    "op:tdescan": {icon: "table-symbol"},
    // Other tables
    "op:tableconstruction": {icon: "const-table-symbol"},
    "op:virtualtable": {icon: "virtual-table-symbol"},
    // Temp & Explicit scan
    "op:explicitscan": {icon: "temp-table-symbol", crosslinkSourceKey: "input"},
    "op:temp": {icon: "temp-table-symbol"},
    "op:iterationincrement": {crosslinkSourceKey: "source"},
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
        }

        // Display these properties always as properties, even if they are more complex.
        // `debugName` is the pre-kebab-case spelling of `debug-name`; we accept both for
        // backwards compatibility with plans produced before the Hyper kebab-case cutover.
        const propertyKeys = ["debug-name", "debugName", "analyze", "sqlpos"];
        for (const key of propertyKeys) {
            if (!rawNode.hasOwnProperty(key)) {
                continue;
            }
            properties.set(key, forceToString(rawNode[key]));
        }

        // Determine the order in which other keys are displayed.
        // For some keys, we enforce a specific order here (e.g., "left" comes before "right").
        // For all other keys, we use alphabetic order.
        // `value-for-comparison` / `valueForComparison`: both spellings are listed so the
        // fixed child ordering works for plans from before and after the kebab-case cutover.
        const fixedChildOrder = ["inputs", "input", "left", "right", "value", "value-for-comparison", "valueForComparison"];
        const orderedKeys = Object.getOwnPropertyNames(rawNode)
            .filter((k) => {
                // `propertyKeys` and `operator`/`expression` were already handled
                return k != nodeType && propertyKeys.indexOf(k) === -1;
            })
            .sort((a, b) => {
                const idx1 = fixedChildOrder.indexOf(a);
                const idx2 = fixedChildOrder.indexOf(b);
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
            if (fixedChildOrder.indexOf(key) != -1) {
                if (Array.isArray(innerNodes)) {
                    // Flatten the array, in case it's one of the "fixedChildOrder" keys
                    Array.prototype.push.apply(children, innerNodes);
                } else {
                    // The `key` itself is not inserted as an intermediate node.
                    if (!innerNodes.name) {
                        innerNodes.name = key;
                    }
                    children.push(innerNodes);
                }
            } else if (Array.isArray(innerNodes)) {
                // Array-valued children are collapsed by default, to avoid displaying too many properties all at once.
                children.push({name: key, collapsedChildren: innerNodes});
            } else if (!innerNodes.name) {
                // Single node without a name? Set the name and as a child.
                innerNodes.name = key;
                children.push(innerNodes);
            } else {
                // Single node which already has a name? Add as a nested node.
                children.push({name: key, children: [innerNodes]});
            }
        }

        // Figure out the display name
        const specificDisplayName = renderingConfig.displayNameKey ? properties.get(renderingConfig.displayNameKey) : undefined;
        // Accept both `debug-name` (post kebab-case cutover) and the legacy `debugName`.
        const debugNameNode =
            tryGetPropertyPath(rawNode, ["debug-name", "value"]) ?? tryGetPropertyPath(rawNode, ["debugName", "value"]);
        const debugName = typeof debugNameNode === "string" ? debugNameNode : undefined;
        const displayName = debugName ?? specificDisplayName ?? properties?.get("name") ?? nodeTag ?? "";

        // Build the converted node
        const convertedNode = {
            name: displayName,
            icon: renderingConfig.icon,
            properties,
            children: expandedChildren,
            collapsedChildren,
            expandedByDefault: nodeType != "operator" && expandedChildren.length == 0,
        } as TreeNode;

        // Highlight the node which errored out, in case the query failed
        const errored = conversionState.metadata.has("Error") && tryGetPropertyPath(rawNode, ["analyze", "running"]) === true;
        if (errored) {
            convertedNode.iconColor = "red";
        }

        // Information on the execution time
        const execTime = tryGetPropertyPath(rawNode, ["analyze", "cpu-cycles"]);
        if (typeof execTime === "number") {
            conversionState.runtimes.push({node: convertedNode, time: execTime});
        }

        // Display the cardinality on the links between the nodes
        if (hasOwnProperty(rawNode, "cardinality") && typeof rawNode.cardinality === "number") {
            const estimatedCard = rawNode.cardinality;
            const actualCard = tryGetPropertyPath(rawNode, ["analyze", "tuple-count"]);
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

        // Add to `operator-id` map if applicable.
        // `operatorId` is the legacy spelling; accept both for backwards compatibility.
        if (nodeType == "operator") {
            const operatorId = properties?.get("operator-id") ?? properties?.get("operatorId");
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
            const name = `${parentKey}.${index}`;
            let innerNode = convertHyperNode(value, name, conversionState);
            if (Array.isArray(innerNode)) {
                innerNode = {children: innerNode};
            }
            if (!innerNode.name) innerNode.name = name;
            listOfObjects.push(innerNode);
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
    const maxWidth = state.edgeWidths.reduce((p, v) => (p > v.width ? p : v.width), 0);
    const minWidth = state.edgeWidths.reduce((p, v) => (p < v.width ? p : v.width), Infinity);
    if (minWidth == maxWidth) return;
    const factor = Math.max(maxWidth - minWidth, minWidth);
    for (const edge of state.edgeWidths) {
        edge.node.edgeWidth = (edge.width - minWidth) / factor;
    }
}

function convertHyperPlan(node: Json): TreeDescription {
    const conversionState = {
        operatorsById: new Map<string, TreeNode>(),
        crosslinks: [],
        edgeWidths: [],
        runtimes: [],
        metadata: new Map<string, string>(),
    } as ConversionState;
    // Check if the query failed
    const errorMsg = tryGetPropertyPath(node, ["analyze", "error", "message", "original"]);
    if (errorMsg) {
        conversionState.metadata.set("Error", forceToString(errorMsg));
    }

    const root = convertHyperNode(node, "result", conversionState);
    if (Array.isArray(root)) {
        throw new Error("Invalid Hyper query plan");
    }
    colorRelativeExecutionTime(conversionState);
    setEdgeWidths(conversionState);
    const crosslinks = resolveCrosslinks(conversionState);
    return {root, crosslinks, metadata: conversionState.metadata};
}

// A raw pipeline entry, as parsed from the `pipelines` array of the plan.
interface RawPipeline {
    id: number;
    operatorIds: number[];
}

// Assign a horizontal ("x") rank to every tree node, mirroring how the tree is
// laid out left-to-right: leaves are numbered in depth-first order, and each
// inner node is placed at the centroid of its children. This ordering is
// layout-independent (it does not change when nodes are expanded/collapsed),
// which keeps pipeline colors stable while the user explores the plan.
function computeHorizontalRanks(root: TreeNode): Map<TreeNode, number> {
    const ranks = new Map<TreeNode, number>();
    let nextLeaf = 0;
    const assign = (node: TreeNode): number => {
        const children = node.children ?? [];
        let rank: number;
        if (children.length === 0) {
            rank = nextLeaf++;
        } else {
            let sum = 0;
            for (const child of children) sum += assign(child);
            rank = sum / children.length;
        }
        ranks.set(node, rank);
        return rank;
    };
    assign(root);
    return ranks;
}

// Parse and validate the `pipelines` array of the plan.
function parsePipelines(pipelinesJson: Json): RawPipeline[] {
    if (!Array.isArray(pipelinesJson)) {
        throw new Error("Invalid Hyper query plan: `pipelines` must be an array");
    }
    const pipelines: RawPipeline[] = [];
    for (const entry of pipelinesJson) {
        if (typeof entry !== "object" || Array.isArray(entry) || entry === null) continue;
        const id = entry["id"];
        const operators = entry["operators"];
        if (typeof id !== "number" || !Array.isArray(operators)) continue;
        const operatorIds = operators.filter((o): o is number => typeof o === "number");
        pipelines.push({id, operatorIds});
    }
    return pipelines;
}

// Project the merged execution pipelines onto the operator tree and assign colors.
//
// Coloring follows two rules requested by the visualization:
//  * Pipelines are assigned palette colors left-to-right (by their left-most
//    operator), so neighboring pipelines get visually distinct hues.
//  * An operator that belongs to several pipelines is colored by the *right-most*
//    of those pipelines. This makes the UNION ALL / fork-share cases read
//    naturally: the shared "pipeline above" a UNION ALL (executed once per input)
//    takes on the color of the right-most input pipeline, and a forked/shared
//    source keeps the color of the right-most consumer that reads from it.
function assignPipelineColors(root: TreeNode, operatorsById: Map<string, TreeNode>, pipelines: RawPipeline[]): void {
    const ranks = computeHorizontalRanks(root);
    const nodeRank = (n: TreeNode) => ranks.get(n) ?? 0;

    // Resolve each pipeline's member operators to tree nodes and compute its
    // horizontal extent (min/max rank of any member operator).
    interface ResolvedPipeline extends RawPipeline {
        nodes: TreeNode[];
        minRank: number;
        maxRank: number;
    }
    const resolved: ResolvedPipeline[] = pipelines.map((p) => {
        const nodes: TreeNode[] = [];
        for (const opId of p.operatorIds) {
            const node = operatorsById.get(opId.toString());
            if (node) nodes.push(node);
        }
        const memberRanks = nodes.map(nodeRank);
        return {
            ...p,
            nodes,
            minRank: memberRanks.length ? Math.min(...memberRanks) : Infinity,
            maxRank: memberRanks.length ? Math.max(...memberRanks) : -Infinity,
        };
    });

    // Assign palette colors in left-to-right order.
    const colorOrder = [...resolved].sort((a, b) => a.minRank - b.minRank || a.maxRank - b.maxRank || a.id - b.id);
    const colorById = new Map<number, string>();
    colorOrder.forEach((p, idx) => colorById.set(p.id, pipelineColor(idx)));

    // Record, per tree node, every pipeline it belongs to (kept local: the
    // "pipeline" concept never leaks into the presentation model, which only
    // ever sees colors).
    const nodePipelines = new Map<TreeNode, ResolvedPipeline[]>();
    for (const p of resolved) {
        for (const node of p.nodes) {
            const list = nodePipelines.get(node) ?? [];
            list.push(p);
            nodePipelines.set(node, list);
        }
    }
    // Pipelines flowing through a node, ordered left-to-right, as colors.
    const orderedColors = (ps: ResolvedPipeline[]): string[] =>
        [...ps]
            .sort((a, b) => a.minRank - b.minRank || a.maxRank - b.maxRank || a.id - b.id)
            .map((p) => colorById.get(p.id))
            .filter((c): c is string => c !== undefined);

    // Walk the tree to split each operator's pipelines into an "incoming" side
    // (shared with its children, drawn below) and an "outgoing" side (shared with
    // its parent, drawn above). Data flows leaves->root, so children feed the
    // node from below and the node feeds its parent above. A pipeline that starts
    // or ends at a node (a pipeline breaker, or a source/sink) is therefore
    // present on only one side. The incoming edge is colored to match the
    // node's outgoing (above) side, which is exactly the pipelines it shares with
    // its parent -- edges with no shared pipeline stay neutral (breakers).
    const walk = (node: TreeNode, parent: TreeNode | undefined) => {
        const nodePs = nodePipelines.get(node);
        if (nodePs) {
            // Outgoing (above): pipelines shared with the parent; at the root
            // (no parent) everything the operator drives flows out.
            const parentPs = parent ? nodePipelines.get(parent) : undefined;
            let outgoing = nodePs;
            if (parent) {
                const parentIds = parentPs ? new Set(parentPs.map((p) => p.id)) : new Set<number>();
                outgoing = nodePs.filter((p) => parentIds.has(p.id));
            }
            node.barsAbove = orderedColors(outgoing);
            if (parent && outgoing.length) node.edgeColors = orderedColors(outgoing);

            // Incoming (below): pipelines shared with any operator child; a leaf
            // (no operator children) is a source, so its pipelines originate here.
            const childIds = new Set<number>();
            let hasOperatorChild = false;
            for (const child of allChildren(node)) {
                const childPs = nodePipelines.get(child);
                if (childPs) {
                    hasOperatorChild = true;
                    for (const p of childPs) childIds.add(p.id);
                }
            }
            const incoming = hasOperatorChild ? nodePs.filter((p) => childIds.has(p.id)) : nodePs;
            node.barsBelow = orderedColors(incoming);
        }
        for (const child of allChildren(node)) walk(child, node);
    };
    walk(root, undefined);
}

// Load a Hyper plan that carries a merged execution-pipeline graph
// (`EXPLAIN (FORMAT JSON, PIPELINES, ...)`), i.e. a top-level `{tree, pipelines}`.
function convertHyperPlanWithPipelines(node: JsonObject): TreeDescription {
    const treeDescription = convertHyperPlan(node["tree"]);
    // Rebuild the operator-id map over the produced tree so pipelines can be resolved.
    const operatorsById = new Map<string, TreeNode>();
    visitTreeNodes(
        treeDescription.root,
        (n) => {
            const opId = n.properties?.get("operator-id") ?? n.properties?.get("operatorId");
            if (opId !== undefined) operatorsById.set(opId, n);
        },
        allChildren,
    );
    const pipelines = parsePipelines(node["pipelines"]);
    assignPipelineColors(treeDescription.root, operatorsById, pipelines);
    return treeDescription;
}

function convertOptimizerSteps(node: Json): TreeDescription | undefined {
    // Check if we have a top-level object with a single key "optimizersteps" containing an array
    if (typeof node !== "object" || Array.isArray(node) || node === null) return undefined;
    if (Object.getOwnPropertyNames(node).length != 1) return undefined;
    if (!node.hasOwnProperty("optimizersteps")) return undefined;
    const steps = node["optimizersteps"];
    if (!Array.isArray(steps)) return undefined;

    // Transform the optimizer steps
    const crosslinks: Crosslink[] = [];
    const children: TreeNode[] = [];
    const properties = new Map<string, string>();
    for (const step of steps) {
        // Check that our step has two subproperties: "name" and "plan"
        if (typeof step !== "object" || Array.isArray(step) || step === null) return undefined;
        if (Object.getOwnPropertyNames(step).length != 2) return undefined;
        if (!step.hasOwnProperty("name")) return undefined;
        if (!step.hasOwnProperty("plan")) return undefined;
        const name = step["name"];
        const plan = step["plan"];
        if (typeof name !== "string") return undefined;

        // Add the child
        const {root: childRoot, crosslinks: newCrosslinks, metadata: newProperties} = convertHyperPlan(plan);
        crosslinks.push(...(newCrosslinks ?? []));
        children.push({name: name, children: [childRoot]});
        for (const p of newProperties ?? new Map<string, string>()) {
            properties.set(p[0], p[1]);
        }
    }
    const root = {name: "optimizersteps", children: children};
    return {root, crosslinks, metadata: properties};
}

// Detect the `{tree, pipelines}` envelope emitted by `EXPLAIN (..., PIPELINES, ...)`.
function hasPipelineEnvelope(json: Json): json is JsonObject {
    return (
        typeof json === "object" &&
        !Array.isArray(json) &&
        json !== null &&
        hasOwnProperty(json, "tree") &&
        hasOwnProperty(json, "pipelines") &&
        typeof json["tree"] === "object"
    );
}

// Loads a Hyper query plan
export function loadHyperPlan(json: Json): TreeDescription {
    if (hasPipelineEnvelope(json)) {
        return convertHyperPlanWithPipelines(json);
    }
    return convertOptimizerSteps(json) ?? convertHyperPlan(json);
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
