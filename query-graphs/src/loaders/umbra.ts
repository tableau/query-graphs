/*

Umbra / CedarDB JSON Transformations
------------------------------------

Umbra and CedarDB use the same operator/expression plan schema. Their top-level
envelopes, identifiers, cardinalities, and execution pipelines differ from Hyper.

*/

import type {TreeDescription, TreeNode} from "../tree-description";
import {allChildren} from "../tree-description";
import type {Json, JsonObject} from "./loader-utils";
import {hasOwnProperty, tryToString} from "./loader-utils";
import type {AdaptiveTreeConfig} from "./adaptive-plan-tree";
import {convertAdaptiveJsonNode} from "./adaptive-plan-tree";
import {combinePlanStages} from "./staged-plans";
import type {NodeRenderingConfig, RawPipeline} from "./tree-postprocessing";
import {
    assignPipelineColors,
    buildIdMap,
    newConversionState,
    parsePipelines,
    resolveCrosslinks,
    setEdgeWidths,
} from "./tree-postprocessing";

const nodeRenderingConfig: Record<string, NodeRenderingConfig> = {
    "op:select": {icon: "filter-symbol"},
    "op:sort": {icon: "sort-symbol"},
    "op:groupby": {icon: "groupby-symbol"},
    "op:tablescan": {displayNameKey: "tablename", icon: "table-symbol"},
    "op:systemtablescan": {icon: "table-symbol"},
    "op:inlinetable": {icon: "const-table-symbol"},
    "op:generateseries": {icon: "const-table-symbol"},
    "op:temp": {icon: "temp-table-symbol"},
    "op:ternaryjoin": {icon: "inner-join-symbol"},
    "op:pipelinebreakerscan": {icon: "temp-table-symbol", crosslinkSourceKey: "scannedOperator"},
    "op:iterationincrementscan": {icon: "temp-table-symbol", crosslinkSourceKey: "iteration"},
    "op:earlyprobe": {icon: "filter-symbol"},
    "op:insert": {icon: "run-query-symbol"},
    "op:setoperation": {displayNameKey: "operation"},
    "exp:compare": {displayNameKey: "direction"},
    "exp:iuref": {displayNameKey: "iu"},
};

const joinIcons: Record<string, NodeRenderingConfig["icon"]> = {
    inner: "inner-join-symbol",
    leftouter: "left-join-symbol",
    rightouter: "right-join-symbol",
    fullouter: "full-join-symbol",
};

const structuralChildKeys = ["arguments", "input", "left", "right", "build0", "build1", "probe", "magic", "pipelineBreaker"];

const umbraConfig: AdaptiveTreeConfig = {
    getRenderingConfig(nodeType, tag, _rawNode, properties) {
        if (nodeType === "operator" && tag === "join") {
            return {displayNameKey: "type", icon: joinIcons[properties.get("type") ?? ""]};
        }
        const prefix = nodeType === "operator" ? "op" : "exp";
        return nodeRenderingConfig[`${prefix}:${tag}`] ?? {};
    },
    alwaysPropertyKeys: ["analyzePlanCounters"],
    fixedChildOrder: structuralChildKeys,
    shouldExpandChild(_rawNode, key) {
        return structuralChildKeys.includes(key) ? true : undefined;
    },
    getEstimatedCardinality(rawNode) {
        return typeof rawNode["cardinality"] === "number" ? rawNode["cardinality"] : undefined;
    },
    getActualCardinality(rawNode) {
        return typeof rawNode["analyzePlanCardinality"] === "number" ? rawNode["analyzePlanCardinality"] : undefined;
    },
};

function isUmbraPlanEnvelope(json: Json): json is JsonObject {
    if (
        typeof json !== "object" ||
        Array.isArray(json) ||
        json === null ||
        !hasOwnProperty(json, "plan") ||
        typeof json["plan"] !== "object" ||
        Array.isArray(json["plan"]) ||
        json["plan"] === null
    ) {
        return false;
    }
    const plan = json["plan"];
    return hasOwnProperty(plan, "operator") && hasOwnProperty(plan, "operatorId");
}

function parseUmbraPipelines(pipelinesJson: Json): RawPipeline[] {
    return parsePipelines(pipelinesJson, (entry, index) => {
        if (!Array.isArray(entry["operators"])) {
            return undefined;
        }
        const operatorIds = entry["operators"].filter((operatorId): operatorId is number => typeof operatorId === "number");
        const id = typeof entry["pipelineId"] === "number" ? entry["pipelineId"] : index;
        const duration = typeof entry["duration"] === "number" ? entry["duration"] : undefined;
        return {id, operatorIds, duration};
    });
}

function appendEnvelopeDetails(
    root: TreeNode,
    envelope: JsonObject,
    state: ReturnType<typeof newConversionState>,
    metadata: Map<string, string>,
): void {
    for (const key of Object.keys(envelope).sort()) {
        if (key === "plan") {
            continue;
        }
        const scalar = tryToString(envelope[key]);
        if (scalar !== undefined) {
            metadata.set(key, scalar);
            continue;
        }
        const converted = convertAdaptiveJsonNode(envelope[key], key, state, umbraConfig, metadata);
        let details: TreeNode;
        if (Array.isArray(converted)) {
            details = {name: key, collapsedChildren: converted};
        } else if (converted.name === "") {
            converted.name = key;
            details = converted;
        } else {
            details = {name: key, children: [converted]};
        }
        (root.collapsedChildren ??= []).push(details);
    }
}

function convertUmbraPlan(envelope: JsonObject): TreeDescription {
    const metadata = new Map<string, string>();
    const state = newConversionState();
    const root = convertAdaptiveJsonNode(envelope["plan"], "result", state, umbraConfig, metadata);
    if (Array.isArray(root)) {
        throw new Error("Invalid Umbra/CedarDB query plan");
    }
    appendEnvelopeDetails(root, envelope, state, metadata);

    setEdgeWidths(state.edgeWidths);
    const operatorIds = buildIdMap(root, ["operatorId"]);
    const crosslinks = resolveCrosslinks(state.crosslinks, operatorIds).filter(
        ({source, target}) => !allChildren(source).includes(target),
    );

    const pipelinesJson = envelope["analyzePlanPipelines"];
    if (pipelinesJson !== undefined) {
        const pipelines = parseUmbraPipelines(pipelinesJson);
        const analyzeIds = buildIdMap(root, ["analyzePlanId"]);
        assignPipelineColors(root, analyzeIds, pipelines, crosslinks);
    }
    return {root, crosslinks, metadata};
}

function getOptimizerStages(json: Json): [string, JsonObject][] | undefined {
    if (typeof json !== "object" || Array.isArray(json) || json === null) {
        return undefined;
    }
    const stages = Object.entries(json);
    if (stages.length === 0 || !stages.every(([, value]) => isUmbraPlanEnvelope(value))) {
        return undefined;
    }
    return stages as [string, JsonObject][];
}

export function loadUmbraPlan(json: Json): TreeDescription {
    if (isUmbraPlanEnvelope(json)) {
        return convertUmbraPlan(json);
    }
    const stages = getOptimizerStages(json);
    if (stages !== undefined) {
        return combinePlanStages(
            "optimizer steps",
            stages.map(([name, stage]) => [name, convertUmbraPlan(stage)]),
        );
    }
    throw new Error("Invalid Umbra/CedarDB query plan");
}

export function loadUmbraPlanFromText(graphString: string): TreeDescription {
    let json: Json;
    try {
        json = JSON.parse(graphString) as Json;
    } catch (error) {
        throw new Error("JSON parse failed with '" + error + "'.", {cause: error});
    }
    return loadUmbraPlan(json);
}
