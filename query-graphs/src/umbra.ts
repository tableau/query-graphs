/*

Umbra / CedarDB JSON Transformations
------------------------------------

Umbra and CedarDB (a commercial product built on top of Umbra) both emit `EXPLAIN (FORMAT JSON)`
plans that use the same "operator"/"expression" tagging convention as Hyper, so this loader reuses
the shared adaptive-conversion heuristic (see `adaptive-plan-tree.ts`) and only supplies the bits
that differ:

* icons and crosslinks for the operators worth calling out specially,
* the top-level `{plan, ius, output, analyzePlanPipelines, ...}` envelope produced by `EXPLAIN`,
* actual cardinalities and pipeline colors, both read from `analyzePlan*` fields added by
  `EXPLAIN (ANALYZE, FORMAT JSON)`.

Unlike Hyper, individual operators don't carry their own execution time. `EXPLAIN ANALYZE` reports
timing per *pipeline* (a group of fused operators) instead. We approximate a per-operator time by
splitting a pipeline's duration evenly across its operators -- imprecise, but enough to make hot
pipelines visually stand out, on top of the (exact) pipeline-membership bars.

*/

import {TreeNode, TreeDescription} from "./tree-description";
import {Json, JsonObject, hasOwnProperty} from "./loader-utils";
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
    "op:select": {icon: "filter-symbol"},
    "op:sort": {icon: "sort-symbol"},
    "op:groupby": {icon: "groupby-symbol"},
    // Scans & constant/derived "tables"
    "op:tablescan": {icon: "table-symbol"},
    "op:inlinetable": {icon: "const-table-symbol"},
    "op:generateseries": {icon: "const-table-symbol"},
    // A re-scan of an already-materialized (sub-)plan, e.g. a CTE referenced more than once.
    // `scannedOperator` points at the operator id of the materialized plan; the first occurrence
    // additionally nests it directly as `pipelineBreaker`.
    "op:pipelinebreakerscan": {icon: "temp-table-symbol", crosslinkSourceKey: "scannedOperator"},
    // The recursive step of a `WITH RECURSIVE` query scans the previous iteration's output;
    // `iteration` points at the operator id of the enclosing `iteration` operator.
    "op:iterationincrementscan": {icon: "temp-table-symbol", crosslinkSourceKey: "iteration"},
    // Expressions
    "exp:compare": {displayNameKey: "direction"},
    "exp:iuref": {displayNameKey: "iu"},
};

// Icons for `op:join`, which vary by the join's `type` property (inner/leftouter/...) rather
// than by operator tag.
const joinIcons: Record<string, NodeRenderingConfig["icon"]> = {
    inner: "inner-join-symbol",
    leftouter: "left-join-symbol",
    rightouter: "right-join-symbol",
    fullouter: "full-join-symbol",
};

const umbraConfig: AdaptiveTreeConfig = {
    getRenderingConfig(nodeType, tag, _rawNode, properties) {
        if (tag === "join") {
            return {icon: joinIcons[properties.get("type") ?? ""]};
        }
        const prefix = nodeType == "operator" ? "op" : "exp";
        return nodeRenderingConfig[`${prefix}:${tag}`] ?? {};
    },
    alwaysPropertyKeys: [],
    fixedChildOrder: ["input", "left", "right", "pipelineBreaker"],
    getActualCardinality(rawNode: JsonObject): number | undefined {
        const actualCard = rawNode["analyzePlanCardinality"];
        return typeof actualCard === "number" ? actualCard : undefined;
    },
};

function parseUmbraPipelines(pipelinesJson: Json): RawPipeline[] {
    return parsePipelines(pipelinesJson, (entry, index) => {
        const operators = entry["operators"];
        if (!Array.isArray(operators)) return undefined;
        const operatorIds = operators.filter((o): o is number => typeof o === "number");
        // Umbra assigns each pipeline a stable `pipelineId`; CedarDB doesn't, so fall back to
        // the entry's position in the array.
        const id = typeof entry["pipelineId"] === "number" ? entry["pipelineId"] : index;
        const duration = typeof entry["duration"] === "number" ? entry["duration"] : undefined;
        return {id, operatorIds, duration};
    });
}

// Approximate each pipeline's operators' individual execution time by splitting the pipeline's
// total duration evenly across them. A pipeline-breaker operator is a member of more than one
// pipeline, so its time from each pipeline it belongs to must be summed rather than overwritten
// -- `colorRelativeExecutionTime` expects at most one entry per node.
function buildRuntimesFromPipelines(
    pipelines: RawPipeline[],
    analyzeIdMap: Map<string, TreeNode>,
): {node: TreeNode; time: number}[] {
    const runtimeByNode = new Map<TreeNode, number>();
    for (const pipeline of pipelines) {
        if (pipeline.duration === undefined || pipeline.operatorIds.length === 0) continue;
        const perOperatorTime = pipeline.duration / pipeline.operatorIds.length;
        for (const opId of pipeline.operatorIds) {
            const node = analyzeIdMap.get(opId.toString());
            if (node !== undefined) runtimeByNode.set(node, (runtimeByNode.get(node) ?? 0) + perOperatorTime);
        }
    }
    return Array.from(runtimeByNode, ([node, time]) => ({node, time}));
}

// Detect the `{plan, ius, ...}` envelope emitted by `EXPLAIN (FORMAT JSON)`.
function hasUmbraPlanEnvelope(json: Json): json is JsonObject {
    return (
        typeof json === "object" &&
        !Array.isArray(json) &&
        json !== null &&
        hasOwnProperty(json, "plan") &&
        hasOwnProperty(json, "ius") &&
        typeof json["plan"] === "object" &&
        json["plan"] !== null &&
        !Array.isArray(json["plan"]) &&
        hasOwnProperty(json["plan"], "operator")
    );
}

// Loads an Umbra/CedarDB query plan
export function loadUmbraPlan(json: Json): TreeDescription {
    if (!hasUmbraPlanEnvelope(json)) {
        throw new Error("Invalid Umbra/CedarDB query plan");
    }

    const metadata = new Map<string, string>();
    const state = newConversionState();
    const root = convertAdaptiveJsonNode(json["plan"], "result", state, umbraConfig, metadata);
    if (Array.isArray(root)) {
        throw new Error("Invalid Umbra/CedarDB query plan");
    }
    setEdgeWidths(state.edgeWidths);
    const operatorIdMap = buildIdMap(root, ["operatorId"]);
    const crosslinks = resolveCrosslinks(state.crosslinks, operatorIdMap);

    const pipelinesJson = json["analyzePlanPipelines"];
    if (pipelinesJson !== undefined) {
        const analyzeIdMap = buildIdMap(root, ["analyzePlanId"]);
        const pipelines = parseUmbraPipelines(pipelinesJson);
        assignPipelineColors(root, analyzeIdMap, pipelines, crosslinks);
        colorRelativeExecutionTime(buildRuntimesFromPipelines(pipelines, analyzeIdMap));
    }

    return {root, crosslinks, metadata};
}

// Load a JSON tree from text
export function loadUmbraPlanFromText(graphString: string): TreeDescription {
    let json: Json;
    try {
        json = JSON.parse(graphString);
    } catch (err) {
        throw new Error("JSON parse failed with '" + err + "'.");
    }
    return loadUmbraPlan(json);
}
