/*

Hyper JSON Transformations
--------------------------

Hyper plans use the shared adaptive operator/expression tree conversion plus
Hyper-specific rendering, metrics, crosslinks, and plan envelopes.

*/

import type {Crosslink, TreeDescription, TreeNode} from "../tree-description";
import type {Json, JsonObject} from "./loader-utils";
import {forceToString, hasOwnProperty, tryGetPropertyPath, tryToString} from "./loader-utils";
import type {AdaptiveTreeConfig} from "./adaptive-plan-tree";
import {convertAdaptiveJsonNode} from "./adaptive-plan-tree";
import type {NodeRenderingConfig, RawPipeline} from "./tree-postprocessing";
import {
    assignPipelineColors,
    buildIdMap,
    colorRelativeExecutionTime,
    newConversionState,
    parsePipelines,
    resolveCrosslinks,
    setEdgeWidths,
} from "./tree-postprocessing";

const nodeRenderingConfig: Record<string, NodeRenderingConfig> = {
    "op:execution-target": {icon: "run-query-symbol"},
    "op:output": {icon: "run-query-symbol"},
    "op:filter": {icon: "filter-symbol"},
    "op:sort": {icon: "sort-symbol"},
    "op:group-by": {icon: "groupby-symbol"},
    // Joins
    "op:join": {displayNameKey: "type", icon: "inner-join-symbol", crosslinkSourceKey: "magic"},
    "op:join:inner": {displayNameKey: "type", icon: "inner-join-symbol", crosslinkSourceKey: "magic"},
    "op:join:left-outer": {displayNameKey: "type", icon: "left-join-symbol", crosslinkSourceKey: "magic"},
    "op:join:right-outer": {displayNameKey: "type", icon: "right-join-symbol", crosslinkSourceKey: "magic"},
    "op:join:full-outer": {displayNameKey: "type", icon: "full-join-symbol", crosslinkSourceKey: "magic"},
    "op:join:left-anti": {displayNameKey: "type", crosslinkSourceKey: "magic"},
    "op:join:right-anti": {displayNameKey: "type", crosslinkSourceKey: "magic"},
    "op:join:left-semi": {displayNameKey: "type", crosslinkSourceKey: "magic"},
    "op:join:right-semi": {displayNameKey: "type", crosslinkSourceKey: "magic"},
    "op:join:left-single": {displayNameKey: "type", crosslinkSourceKey: "magic"},
    "op:join:right-single": {displayNameKey: "type", crosslinkSourceKey: "magic"},
    "op:join:left-mark": {displayNameKey: "type", crosslinkSourceKey: "magic"},
    "op:join:right-mark": {displayNameKey: "type", crosslinkSourceKey: "magic"},
    "op:left-outer-join": {icon: "left-join-symbol", crosslinkSourceKey: "magic"},
    "op:right-outer-join": {icon: "right-join-symbol", crosslinkSourceKey: "magic"},
    "op:full-outer-join": {icon: "full-join-symbol", crosslinkSourceKey: "magic"},
    "op:left-anti-join": {crosslinkSourceKey: "magic"},
    "op:right-anti-join": {crosslinkSourceKey: "magic"},
    "op:left-semi-join": {crosslinkSourceKey: "magic"},
    "op:right-semi-join": {crosslinkSourceKey: "magic"},
    "op:left-single-join": {crosslinkSourceKey: "magic"},
    "op:right-single-join": {crosslinkSourceKey: "magic"},
    "op:left-mark-join": {crosslinkSourceKey: "magic"},
    "op:right-mark-join": {crosslinkSourceKey: "magic"},
    "op:early-probe": {icon: "filter-symbol", crosslinkSourceKey: "builder"},
    // Various scans
    "op:scan": {displayNameKey: "type", icon: "table-symbol"},
    "op:scan:virtual-table": {displayNameKey: "type", icon: "virtual-table-symbol"},
    "op:table-scan": {icon: "table-symbol"},
    "op:arrow-scan": {icon: "table-symbol"},
    "op:binary-scan": {icon: "table-symbol"},
    "op:csv-scan": {icon: "table-symbol"},
    "op:cloud-table-scan": {icon: "table-symbol"},
    "op:cursor-scan": {icon: "table-symbol"},
    "op:iceberg-scan": {icon: "table-symbol"},
    "op:parquet-scan": {icon: "table-symbol"},
    "op:tde-scan": {icon: "table-symbol"},
    // Other tables
    "op:table-construction": {icon: "const-table-symbol"},
    "op:virtual-table": {icon: "virtual-table-symbol"},
    // Temp & Explicit scan
    "op:explicit-scan": {icon: "temp-table-symbol", crosslinkSourceKey: "input"},
    "op:temp": {icon: "temp-table-symbol"},
    "op:iteration-increment": {crosslinkSourceKey: "source"},
    // Inserts
    "op:insert": {displayNameKey: "type"},
    // Expressions
    "exp:comparison": {displayNameKey: "mode"},
    "exp:iu-ref": {displayNameKey: "iu"},
    "exp:reference": {displayNameKey: "id"},
};

const legacyNodeTags: Record<string, string> = {
    "op:executiontarget": "op:execution-target",
    "op:select": "op:filter",
    "op:groupby": "op:group-by",
    "op:leftouterjoin": "op:left-outer-join",
    "op:rightouterjoin": "op:right-outer-join",
    "op:fullouterjoin": "op:full-outer-join",
    "op:leftantijoin": "op:left-anti-join",
    "op:rightantijoin": "op:right-anti-join",
    "op:leftsemijoin": "op:left-semi-join",
    "op:rightsemijoin": "op:right-semi-join",
    "op:leftsinglejoin": "op:left-single-join",
    "op:rightsinglejoin": "op:right-single-join",
    "op:leftmarkjoin": "op:left-mark-join",
    "op:rightmarkjoin": "op:right-mark-join",
    "op:earlyprobe": "op:early-probe",
    "op:tablescan": "op:table-scan",
    "op:arrowscan": "op:arrow-scan",
    "op:binaryscan": "op:binary-scan",
    "op:csvscan": "op:csv-scan",
    "op:cloudtablescan": "op:cloud-table-scan",
    "op:cursorscan": "op:cursor-scan",
    "op:icebergscan": "op:iceberg-scan",
    "op:parquetscan": "op:parquet-scan",
    "op:tdescan": "op:tde-scan",
    "op:tableconstruction": "op:table-construction",
    "op:virtualtable": "op:virtual-table",
    "op:explicitscan": "op:explicit-scan",
    "op:iterationincrement": "op:iteration-increment",
    "exp:iuref": "exp:iu-ref",
};

const hyperConfig: AdaptiveTreeConfig = {
    getRenderingConfig(nodeType, nodeTag, rawNode) {
        const prefix = nodeType === "operator" ? "op" : "exp";
        const configKey = legacyNodeTags[`${prefix}:${nodeTag}`] ?? `${prefix}:${nodeTag}`;
        const subtype = tryToString(rawNode["type"]);
        return (
            (subtype === undefined ? undefined : nodeRenderingConfig[`${configKey}:${subtype}`]) ??
            nodeRenderingConfig[configKey] ??
            {}
        );
    },
    alwaysPropertyKeys: ["debug-name", "statistics", "sqlpos"],
    fixedChildOrder: ["inputs", "input", "left", "right", "value", "value-for-comparison"],
    getDebugName(rawNode) {
        const debugName = tryGetPropertyPath(rawNode, ["debug-name", "value"]);
        return typeof debugName === "string" ? debugName : undefined;
    },
    isErrored(rawNode, metadata) {
        return metadata.has("Error") && tryGetPropertyPath(rawNode, ["statistics", "running"]) === true;
    },
    getExecutionTime(rawNode) {
        const executionTime = tryGetPropertyPath(rawNode, ["statistics", "cpu-cycles"]);
        return typeof executionTime === "number" ? executionTime : undefined;
    },
    getEstimatedCardinality(rawNode) {
        const internalEstimate = rawNode["estimated-rows"];
        const externalEstimate = tryGetPropertyPath(rawNode, ["statistics", "estimated-rows"]);
        return typeof internalEstimate === "number"
            ? internalEstimate
            : typeof externalEstimate === "number"
              ? externalEstimate
              : undefined;
    },
    getActualCardinality(rawNode) {
        const actualCardinality = tryGetPropertyPath(rawNode, ["statistics", "output-rows"]);
        return typeof actualCardinality === "number" ? actualCardinality : undefined;
    },
};

function parseHyperPipelines(pipelinesJson: Json): RawPipeline[] {
    return parsePipelines(pipelinesJson, (entry) => {
        const id = entry["id"];
        const operators = entry["operators"];
        if (typeof id !== "number" || !Array.isArray(operators)) {
            return undefined;
        }
        return {id, operatorIds: operators.filter((operatorId): operatorId is number => typeof operatorId === "number")};
    });
}

function convertHyperPlan(node: Json, pipelines?: Json): TreeDescription {
    const metadata = new Map<string, string>();
    const errorMessage = tryGetPropertyPath(node, ["statistics", "error", "message", "original"]);
    if (errorMessage) {
        metadata.set("Error", forceToString(errorMessage));
    }

    const state = newConversionState();
    const root = convertAdaptiveJsonNode(node, "result", state, hyperConfig, metadata);
    if (Array.isArray(root)) {
        throw new Error("Invalid Hyper query plan");
    }

    colorRelativeExecutionTime(state.runtimes);
    setEdgeWidths(state.edgeWidths);
    const operatorsById = buildIdMap(root, ["operator-id"]);
    const crosslinks = resolveCrosslinks(state.crosslinks, operatorsById);
    if (pipelines !== undefined) {
        assignPipelineColors(root, operatorsById, parseHyperPipelines(pipelines), crosslinks);
    }
    return {root, crosslinks, metadata};
}

function convertOptimizerSteps(node: Json): TreeDescription | undefined {
    if (
        typeof node !== "object" ||
        Array.isArray(node) ||
        node === null ||
        Object.getOwnPropertyNames(node).length !== 1 ||
        !node.hasOwnProperty("optimizersteps") ||
        !Array.isArray(node["optimizersteps"])
    ) {
        return undefined;
    }

    const crosslinks: Crosslink[] = [];
    const children: TreeNode[] = [];
    const metadata = new Map<string, string>();
    for (const step of node["optimizersteps"]) {
        if (
            typeof step !== "object" ||
            Array.isArray(step) ||
            step === null ||
            Object.getOwnPropertyNames(step).length !== 2 ||
            !step.hasOwnProperty("name") ||
            !step.hasOwnProperty("plan") ||
            typeof step["name"] !== "string" ||
            !isHyperPlanRoot(step["plan"])
        ) {
            return undefined;
        }
        const converted = convertHyperPlan(step["plan"]);
        crosslinks.push(...(converted.crosslinks ?? []));
        children.push({name: step["name"], children: [converted.root]});
        for (const property of converted.metadata ?? []) {
            metadata.set(property[0], property[1]);
        }
    }
    return {root: {name: "optimizersteps", children}, crosslinks, metadata};
}

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

function isHyperPlanRoot(json: Json): json is JsonObject {
    return (
        typeof json === "object" &&
        !Array.isArray(json) &&
        json !== null &&
        (hasOwnProperty(json, "operator") || hasOwnProperty(json, "expression"))
    );
}

export function loadHyperPlan(json: Json): TreeDescription {
    if (hasPipelineEnvelope(json)) {
        if (!isHyperPlanRoot(json["tree"])) {
            throw new Error("Invalid Hyper query plan");
        }
        return convertHyperPlan(json["tree"], json["pipelines"]);
    }
    const optimizerSteps = convertOptimizerSteps(json);
    if (optimizerSteps !== undefined) {
        return optimizerSteps;
    }
    if (!isHyperPlanRoot(json)) {
        throw new Error("Invalid Hyper query plan");
    }
    return convertHyperPlan(json);
}

function tryStripPrefix(value: string, prefix: string): string {
    return value.startsWith(prefix) ? value.substring(prefix.length) : value;
}

export function loadHyperPlanFromText(graphString: string): TreeDescription {
    graphString = tryStripPrefix(graphString, "plan\n");
    let json: Json;
    try {
        json = JSON.parse(graphString) as Json;
    } catch (error) {
        throw new Error("JSON parse failed with '" + error + "'.", {cause: error});
    }
    return loadHyperPlan(json);
}
