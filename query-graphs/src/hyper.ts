/*

Hyper JSON Transformations
--------------------------

Hyper plans use the shared adaptive-conversion heuristic (see `adaptive-plan-tree.ts`) plus
Hyper-specific bits: the `nodeRenderingConfig` table below, execution-time/cardinality lookups
into the `analyze` sub-object, and the `{tree, pipelines}` / `optimizersteps` envelope formats.

*/

import {TreeNode, TreeDescription, Crosslink} from "./tree-description";
import {Json, JsonObject, forceToString, hasOwnProperty, tryGetPropertyPath} from "./loader-utils";
import {
    AdaptiveTreeConfig,
    NodeRenderingConfig,
    RawPipeline,
    buildIdMap,
    colorRelativeExecutionTime,
    convertAdaptiveJsonNode,
    newConversionState,
    parsePipelines,
    resolveCrosslinks,
    assignPipelineColors,
    setEdgeWidths,
} from "./adaptive-plan-tree";

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

const hyperConfig: AdaptiveTreeConfig = {
    getRenderingConfig(nodeType, tag) {
        const prefix = nodeType == "operator" ? "op" : "exp";
        return nodeRenderingConfig[`${prefix}:${tag}`] ?? {};
    },
    // `debugName` is the pre-kebab-case spelling of `debug-name`; we accept both for
    // backwards compatibility with plans produced before the Hyper kebab-case cutover.
    alwaysPropertyKeys: ["debug-name", "debugName", "analyze", "sqlpos"],
    // `value-for-comparison` / `valueForComparison`: both spellings are listed so the
    // fixed child ordering works for plans from before and after the kebab-case cutover.
    fixedChildOrder: ["inputs", "input", "left", "right", "value", "value-for-comparison", "valueForComparison"],
    getDebugName(rawNode: JsonObject): string | undefined {
        // Accept both `debug-name` (post kebab-case cutover) and the legacy `debugName`.
        const debugNameNode =
            tryGetPropertyPath(rawNode, ["debug-name", "value"]) ?? tryGetPropertyPath(rawNode, ["debugName", "value"]);
        return typeof debugNameNode === "string" ? debugNameNode : undefined;
    },
    isErrored(rawNode: JsonObject, metadata: Map<string, string>): boolean {
        return metadata.has("Error") && tryGetPropertyPath(rawNode, ["analyze", "running"]) === true;
    },
    getExecutionTime(rawNode: JsonObject): number | undefined {
        const execTime = tryGetPropertyPath(rawNode, ["analyze", "cpu-cycles"]);
        return typeof execTime === "number" ? execTime : undefined;
    },
    getActualCardinality(rawNode: JsonObject): number | undefined {
        const actualCard = tryGetPropertyPath(rawNode, ["analyze", "tuple-count"]);
        return typeof actualCard === "number" ? actualCard : undefined;
    },
};

// `operator-id` is the current spelling; `operatorId` the legacy one. Accept both for
// backwards compatibility with plans produced before the Hyper kebab-case cutover.
const OPERATOR_ID_KEYS = ["operator-id", "operatorId"];

function parseHyperPipelines(pipelinesJson: Json): RawPipeline[] {
    return parsePipelines(pipelinesJson, (entry) => {
        const id = entry["id"];
        const operators = entry["operators"];
        if (typeof id !== "number" || !Array.isArray(operators)) return undefined;
        const operatorIds = operators.filter((o): o is number => typeof o === "number");
        return {id, operatorIds};
    });
}

function convertHyperPlan(node: Json, pipelines?: Json): TreeDescription {
    const metadata = new Map<string, string>();
    // Check if the query failed
    const errorMsg = tryGetPropertyPath(node, ["analyze", "error", "message", "original"]);
    if (errorMsg) {
        metadata.set("Error", forceToString(errorMsg));
    }

    const state = newConversionState();
    const root = convertAdaptiveJsonNode(node, "result", state, hyperConfig, metadata);
    if (Array.isArray(root)) {
        throw new Error("Invalid Hyper query plan");
    }
    colorRelativeExecutionTime(state.runtimes);
    setEdgeWidths(state.edgeWidths);
    const idMap = buildIdMap(root, OPERATOR_ID_KEYS);
    const crosslinks = resolveCrosslinks(state.crosslinks, idMap);
    if (pipelines !== undefined) {
        assignPipelineColors(root, idMap, parseHyperPipelines(pipelines), crosslinks);
    }
    return {root, crosslinks, metadata};
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
        return convertHyperPlan(json["tree"], json["pipelines"]);
    }
    return convertOptimizerSteps(json) ?? convertHyperPlan(json);
}

function tryStripPrefix(str: string, pre: string): string {
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
