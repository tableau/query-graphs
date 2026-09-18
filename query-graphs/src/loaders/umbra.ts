/*

Umbra / CedarDB JSON Transformations
------------------------------------

Umbra and CedarDB use the same operator/expression plan schema. Their top-level
statement objects, identifiers, cardinalities, and execution pipelines differ from Hyper.

*/

import type {Crosslink, TreeDescription, TreeNode} from "../tree-description";
import {allChildren} from "../tree-description";
import type {DecoratedJsonTreeConfig, NodeRenderingConfig} from "./decorated-json-tree";
import {convertDecoratedJsonNode, createDecoratedJsonTreeState} from "./decorated-json-tree";
import type {Json, JsonObject} from "./loader-utils";
import {hasOwnProperty, isJsonObject, tryToString} from "./loader-utils";
import type {ExecutionPipeline} from "./pipeline-coloring";
import {assignPipelineColors} from "./pipeline-coloring";
import {buildIdMap, resolveCrosslinks, setRelativeEdgeWidths} from "./tree-postprocessing";
import type {PlanLoader} from "./types";

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

const structuralChildKeys = [
    "plan",
    "arguments",
    "input",
    "left",
    "right",
    "build0", // input of ternary join
    "build1", // input of ternary join
    "probe", // input of ternary join
    "magic",
    "pipelineBreaker",
];

type UmbraStatement = JsonObject & {plan: JsonObject};

const umbraConfig: DecoratedJsonTreeConfig = {
    nodeTypeKeys: ["operator", "expression"],
    structuralChildKeys,
    alwaysPropertyKeys: ["analyzePlanCounters", "sourceLocation"],
    getRenderingConfig(nodeTypeKey, tag, rawNode) {
        if (nodeTypeKey === "operator" && tag === "join") {
            return {displayNameKey: "type", icon: joinIcons[tryToString(rawNode["type"]) ?? ""]};
        }
        const prefix = nodeTypeKey === "operator" ? "op" : "exp";
        return nodeRenderingConfig[`${prefix}:${tag}`] ?? {};
    },
    getDisplayName(rawNode) {
        if (!hasPlanObject(rawNode)) {
            return undefined;
        }
        return hasOwnProperty(rawNode, "type") ? tryToString(rawNode["type"]) : "result";
    },
    shouldCollapseChild(_rawNode, key) {
        return !structuralChildKeys.includes(key);
    },
    shouldExpandCollapsedChildren(_rawNode, nodeTypeKey) {
        return nodeTypeKey !== "operator";
    },
    getEstimatedCardinality(rawNode) {
        return typeof rawNode["cardinality"] === "number" ? rawNode["cardinality"] : undefined;
    },
    getActualCardinality(rawNode) {
        return typeof rawNode["analyzePlanCardinality"] === "number" ? rawNode["analyzePlanCardinality"] : undefined;
    },
};

function hasPlanObject(json: Json): json is UmbraStatement {
    return (
        typeof json === "object" &&
        !Array.isArray(json) &&
        json !== null &&
        hasOwnProperty(json, "plan") &&
        typeof json["plan"] === "object" &&
        !Array.isArray(json["plan"]) &&
        json["plan"] !== null
    );
}

function isUmbraStatement(json: Json): json is UmbraStatement {
    return hasPlanObject(json) && typeof json.plan["operator"] === "string" && typeof json.plan["operatorId"] === "number";
}

function optimizerStages(json: Json, isStage: (value: Json) => value is UmbraStatement): [string, UmbraStatement][] | undefined {
    if (typeof json !== "object" || Array.isArray(json) || json === null) {
        return undefined;
    }
    const stages = Object.entries(json);
    return stages.length > 0 && stages.every(([, value]) => isStage(value)) ? (stages as [string, UmbraStatement][]) : undefined;
}

function parsePipelines(pipelinesJson: Json, operatorsById: Map<string, TreeNode>): ExecutionPipeline[] {
    if (!Array.isArray(pipelinesJson)) {
        return [];
    }
    const operatorsByPipeline = new Map<number, Set<TreeNode>>();
    for (const [index, entry] of pipelinesJson.entries()) {
        if (typeof entry !== "object" || Array.isArray(entry) || entry === null || !Array.isArray(entry["operators"])) {
            continue;
        }
        const id = typeof entry["pipelineId"] === "number" ? entry["pipelineId"] : index;
        const nodes = operatorsByPipeline.get(id) ?? new Set<TreeNode>();
        for (const operatorId of entry["operators"]) {
            if (typeof operatorId === "number") {
                const node = operatorsById.get(operatorId.toString());
                if (node !== undefined) {
                    nodes.add(node);
                }
            }
        }
        operatorsByPipeline.set(id, nodes);
    }
    return Array.from(operatorsByPipeline, ([id, nodes]) => ({id, nodes: Array.from(nodes)}));
}

function normalizePipelineMemberships(root: TreeNode, pipelines: ExecutionPipeline[], crosslinks: Crosslink[]): void {
    const originalMemberships = new Map<TreeNode, ExecutionPipeline[]>();
    for (const pipeline of pipelines) {
        for (const node of pipeline.nodes) {
            const memberships = originalMemberships.get(node) ?? [];
            memberships.push(pipeline);
            originalMemberships.set(node, memberships);
        }
    }

    const overlapBoundary = (consumer: TreeNode, producer: TreeNode): void => {
        const consumerPipelineIds = new Set((originalMemberships.get(consumer) ?? []).map(({id}) => id));
        const producerPipelines = originalMemberships.get(producer) ?? [];
        if (producerPipelines.some(({id}) => consumerPipelineIds.has(id))) {
            return;
        }
        for (const pipeline of producerPipelines) {
            if (!pipeline.nodes.includes(consumer)) {
                pipeline.nodes.push(consumer);
            }
        }
    };

    // Umbra-format plans may list operators exclusively for the pipelines into
    // which they are producing tuples. Pipelines feeding into an operator don't
    // list that operator as part of the pipeline. We fix this up here, such that the
    // input edge is still colored, feeding into the operator. Using the original
    // memberships prevents a synthetic overlap from propagating through multiple edges.
    const visit = (node: TreeNode): void => {
        for (const child of allChildren(node)) {
            overlapBoundary(node, child);
            visit(child);
        }
    };
    visit(root);
    for (const {source, target} of crosslinks) {
        overlapBoundary(source, target);
    }
}

function convertUmbraPlan(statement: Json): TreeDescription {
    const state = createDecoratedJsonTreeState();
    const root = convertDecoratedJsonNode(statement, "result", state, umbraConfig);

    setRelativeEdgeWidths(state.edgeWidths);
    const operatorIds = buildIdMap(root, "operatorId");
    const crosslinks = resolveCrosslinks(state.crosslinks, operatorIds).filter(
        ({source, target}) => !allChildren(source).includes(target),
    );

    if (isJsonObject(statement) && statement["analyzePlanPipelines"] !== undefined) {
        const analyzeIds = buildIdMap(root, "analyzePlanId");
        const pipelines = parsePipelines(statement["analyzePlanPipelines"], analyzeIds);
        normalizePipelineMemberships(root, pipelines, crosslinks);
        assignPipelineColors(root, pipelines, crosslinks);
    }
    return {root, crosslinks};
}

function combineOptimizerStages(stages: [string, UmbraStatement][]): TreeDescription {
    const children: TreeNode[] = [];
    const crosslinks: Crosslink[] = [];
    for (const [name, stage] of stages) {
        const converted = convertUmbraPlan(stage);
        children.push({name, collapsedChildren: [converted.root]});
        crosslinks.push(...(converted.crosslinks ?? []));
    }
    return {root: {name: "optimizer steps", children}, crosslinks};
}

function loadUmbraPlan(json: Json): TreeDescription {
    if (hasPlanObject(json)) {
        return convertUmbraPlan(json);
    }
    const stages = optimizerStages(json, hasPlanObject);
    if (stages !== undefined) {
        return combineOptimizerStages(stages);
    }
    return convertUmbraPlan(json);
}

export const umbraPlanLoader: PlanLoader<Json> = {
    format: "umbra",
    matches(json) {
        return isUmbraStatement(json) || optimizerStages(json, isUmbraStatement) !== undefined;
    },
    load: loadUmbraPlan,
};
