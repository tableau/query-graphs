/*

DuckDB JSON Transformations
---------------------------

DuckDB emits explicit `children` trees. Simple plans use `name`; analyzed plans
use `operator_name` and add per-operator metrics plus a profiling envelope.

*/

import type {Crosslink, IconName, TextDocument, TreeDescription, TreeNode} from "../tree-description";
import {allChildren, visitTreeNodes} from "../tree-description";
import type {DecoratedJsonTreeConfig} from "./decorated-json-tree";
import {convertDecoratedJsonNode, createDecoratedJsonTreeState} from "./decorated-json-tree";
import type {Json, JsonObject} from "./loader-utils";
import {forceToString, hasOwnProperty, hasSubObject, isJsonObject, tryToNonNullString, tryToNumber} from "./loader-utils";
import {buildIdMap, colorRelativeNumber, resolveCrosslinks, setRelativeEdgeWidths} from "./tree-postprocessing";
import type {PlanLoader} from "./types";

function getExtraInfo(rawNode: JsonObject): JsonObject | undefined {
    return hasSubObject(rawNode, "extra_info") ? rawNode["extra_info"] : undefined;
}

function crosslinkId(namespace: "cte" | "delim", id: string): string {
    return `${namespace}:${id}`;
}

function getOperatorType(rawNode: JsonObject): string {
    const operatorType =
        tryToNonNullString(rawNode["operator_name"]) ??
        tryToNonNullString(rawNode["name"]) ??
        tryToNonNullString(rawNode["operator_type"]) ??
        "unknown";
    // DuckDB's built-in operator names are often emitted in CAPS_LOCK form.
    // Preserve mixed-case names because extensions may supply their own labels.
    return operatorType === operatorType.toUpperCase() ? operatorType.toLowerCase() : operatorType;
}

function getIcon(rawNode: JsonObject): IconName | undefined {
    const operatorType = getOperatorType(rawNode);
    // DuckDB prefixes members of an operator family with their implementation,
    // such as HASH_JOIN, PIECEWISE_MERGE_JOIN, and PERFECT_HASH_GROUP_BY.
    if (operatorType.endsWith("_join") || operatorType === "cross_product") {
        const joinType = tryToNonNullString(getExtraInfo(rawNode)?.["Join Type"]);
        if (joinType === "LEFT") return "left-join-symbol";
        if (joinType?.startsWith("RIGHT")) return "right-join-symbol";
        if (joinType === "FULL" || joinType === "OUTER") return "full-join-symbol";
        return "inner-join-symbol";
    }
    if (
        operatorType === "group_by" ||
        operatorType.endsWith("_group_by") ||
        operatorType === "aggregate" ||
        operatorType.endsWith("_aggregate")
    ) {
        return "groupby-symbol";
    }
    if (operatorType === "order_by" || operatorType === "sort" || operatorType.endsWith("_sort") || operatorType === "top_n") {
        return "sort-symbol";
    }
    if (operatorType === "filter" || operatorType === "limit") return "filter-symbol";
    if (
        operatorType === "cte" ||
        operatorType === "rec_cte" ||
        operatorType.endsWith("cte_scan") ||
        operatorType === "delim_scan" ||
        operatorType === "delim_get" ||
        operatorType === "column_data_scan"
    ) {
        return "temp-table-symbol";
    }
    if (operatorType === "dummy_scan" || operatorType === "expression_scan" || operatorType === "empty_result") {
        return "const-table-symbol";
    }
    if (operatorType.endsWith("_scan")) return "table-symbol";
    if (operatorType === "generate_series") return "const-table-symbol";
    if (operatorType === "insert") return "run-query-symbol";
    return undefined;
}

function getDisplayName(rawNode: JsonObject): string {
    const name = getOperatorType(rawNode);
    if (name.endsWith("_scan")) {
        const table = tryToNonNullString(getExtraInfo(rawNode)?.["Table"]);
        if (table !== undefined) {
            return `${table} (${name})`;
        }
    }
    return name;
}

const duckDbConfig: DecoratedJsonTreeConfig = {
    nodeTypeKeys: ["operator_name", "name", "operator_type"],
    structuralChildKeys: ["children"],
    alwaysPropertyKeys: [],
    flattenPropertyObjectKeys: ["extra_info"],
    getRenderingConfig(_nodeTypeKey, _tag, rawNode) {
        return {icon: getIcon(rawNode)};
    },
    getDisplayName,
    getCrosslinkTarget(rawNode) {
        const operatorType = getOperatorType(rawNode);
        // Recursive scans are emitted as REC_CTE_SCAN, so match the CTE scan family.
        if (operatorType.endsWith("cte_scan")) {
            const id = tryToNonNullString(getExtraInfo(rawNode)?.["CTE Index"]);
            return id === undefined ? undefined : crosslinkId("cte", id);
        }
        if (operatorType === "delim_scan") {
            const id = tryToNonNullString(getExtraInfo(rawNode)?.["Delim Index"]);
            return id === undefined ? undefined : crosslinkId("delim", id);
        }
        return undefined;
    },
    shouldExpandCollapsedChildren: () => false,
    getEstimatedCardinality(rawNode) {
        return tryToNumber(getExtraInfo(rawNode)?.["Estimated Cardinality"]);
    },
    getActualCardinality(rawNode) {
        return tryToNumber(rawNode["operator_cardinality"]);
    },
};

function applyOperatorTimings(root: TreeNode): void {
    const timings: {node: TreeNode; value: number}[] = [];
    visitTreeNodes(
        root,
        (node) => {
            const timing = tryToNumber(node.properties?.get("operator_timing"));
            if (timing !== undefined) {
                timings.push({node, value: timing});
            }
        },
        allChildren,
    );
    colorRelativeNumber(timings);
}

function convertDuckPlan(rawRoot: Json, metadata?: Map<string, string>, textDocuments?: TextDocument[]): TreeDescription {
    const state = createDecoratedJsonTreeState();
    const root = convertDecoratedJsonNode(rawRoot, "DuckDB plan", state, duckDbConfig);
    applyOperatorTimings(root);
    setRelativeEdgeWidths(state.edgeWidths);
    const crosslinkTargets = new Map<string, TreeNode>();
    for (const [id, node] of buildIdMap(root, "Table Index")) {
        crosslinkTargets.set(crosslinkId("cte", id), node);
    }
    visitTreeNodes(
        root,
        (node) => {
            const operatorType = node.properties?.get("operator_type");
            const id = node.properties?.get("Delim Index");
            const isDelimJoin = operatorType?.endsWith("DELIM_JOIN") ?? node.name?.endsWith("delim_join") ?? false;
            if (isDelimJoin && id !== undefined) {
                crosslinkTargets.set(crosslinkId("delim", id), node);
            }
        },
        allChildren,
    );
    return {
        root,
        metadata,
        textDocuments,
        crosslinks: resolveCrosslinks(state.crosslinks, crosslinkTargets),
    };
}

function isDuckNode(value: Json): value is JsonObject {
    return (
        isJsonObject(value) &&
        (typeof value["name"] === "string" ||
            typeof value["operator_name"] === "string" ||
            typeof value["operator_type"] === "string") &&
        Array.isArray(value["children"])
    );
}

function isRecognizableDuckNode(value: Json): value is JsonObject {
    return (
        isDuckNode(value) &&
        (typeof value["operator_type"] === "string" || (typeof value["name"] === "string" && hasSubObject(value, "extra_info")))
    );
}

// DuckDB's JSON renderer wraps each plan's single root in an array.
function isSingletonArray(json: Json): json is [Json] {
    return Array.isArray(json) && json.length === 1;
}

function hasAnalyzedEnvelope(json: Json): json is JsonObject & {children: [Json]} {
    return isJsonObject(json) && typeof json["query_name"] === "string" && isSingletonArray(json["children"]);
}

const knownStageNames = ["logical_plan", "logical_opt", "physical_plan"];

function getPlanStages(json: Json): [string, Json][] | undefined {
    if (!isJsonObject(json) || !knownStageNames.some((name) => hasOwnProperty(json, name))) {
        return undefined;
    }
    return Object.entries(json).map(([name, plan]) => [name, isSingletonArray(plan) ? plan[0] : plan]);
}

function analyzeMetadata(json: JsonObject): Map<string, string> {
    const metadata = new Map<string, string>();
    for (const key of Object.keys(json)) {
        if (key === "children" || key === "query_name") {
            continue;
        }
        const value = json[key];
        if (key === "extra_info" && isJsonObject(value) && Object.keys(value).length === 0) {
            continue;
        }
        metadata.set(key, forceToString(value));
    }
    return metadata;
}

function getQueryDocument(json: JsonObject): TextDocument[] | undefined {
    const query = tryToNonNullString(json["query_name"]);
    return query === undefined ? undefined : [{id: "query", title: "Original SQL Query", text: query, language: "sql"}];
}

function combinePlanStages(stages: [string, Json][]): TreeDescription {
    const children: TreeNode[] = [];
    const crosslinks: Crosslink[] = [];
    for (const [name, root] of stages) {
        const converted = convertDuckPlan(root);
        children.push({name, collapsedChildren: [converted.root]});
        crosslinks.push(...(converted.crosslinks ?? []));
    }
    return {root: {name: "optimizer stages", children}, crosslinks};
}

function loadDuckDbPlan(json: Json): TreeDescription {
    // Plans with multiple stages (`SET explain_output='all'`)
    const stages = getPlanStages(json);
    if (stages !== undefined) {
        return combinePlanStages(stages);
    }

    // ANALYZEd plans
    if (hasAnalyzedEnvelope(json)) {
        let root = json["children"][0];
        if (isDuckNode(root) && root["operator_type"] === "EXPLAIN_ANALYZE" && isSingletonArray(root["children"])) {
            root = root["children"][0];
        }
        return convertDuckPlan(root, analyzeMetadata(json), getQueryDocument(json));
    }

    // Normal plans
    return convertDuckPlan(Array.isArray(json) && json.length > 0 ? json[0] : json);
}

export const duckDbPlanLoader: PlanLoader<Json> = {
    format: "duckdb",
    matches(json) {
        const stages = getPlanStages(json);
        return (
            (isSingletonArray(json) && isRecognizableDuckNode(json[0])) ||
            (hasAnalyzedEnvelope(json) && isRecognizableDuckNode(json["children"][0])) ||
            stages !== undefined
        );
    },
    load: loadDuckDbPlan,
};
