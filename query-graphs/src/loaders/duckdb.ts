/*

DuckDB JSON Transformations
---------------------------

DuckDB emits explicit `children` trees. Simple plans use `name`; analyzed plans
use `operator_name` and add per-operator metrics plus a profiling envelope.

*/

import type {Crosslink, IconName, TreeDescription, TreeNode} from "../tree-description";
import {allChildren, visitTreeNodes} from "../tree-description";
import type {DecoratedJsonTreeConfig} from "./decorated-json-tree";
import {convertDecoratedJsonNode, createDecoratedJsonTreeState} from "./decorated-json-tree";
import type {Json, JsonObject} from "./loader-utils";
import {forceToString, hasOwnProperty, hasSubObject, isJsonObject, tryToNonNullString, tryToNumber} from "./loader-utils";
import {buildIdMap, colorRelativeNumber, resolveCrosslinks, setRelativeEdgeWidths} from "./tree-postprocessing";
import {InvalidPlanError, type PlanLoader} from "./types";

function getExtraInfo(rawNode: JsonObject): JsonObject | undefined {
    return hasSubObject(rawNode, "extra_info") ? rawNode["extra_info"] : undefined;
}

function normalizeOperatorName(name: string): string {
    // DuckDB's built-in operator names are often emitted in CAPS_LOCK form.
    // Preserve mixed-case names because extensions may supply their own labels.
    return name === name.toUpperCase() ? name.toLowerCase() : name;
}

function crosslinkId(namespace: "cte" | "delim", id: string): string {
    return `${namespace}:${id}`;
}

function getOperatorType(rawNode: JsonObject): string {
    return (
        tryToNonNullString(rawNode["operator_type"]) ??
        tryToNonNullString(rawNode["operator_name"]) ??
        tryToNonNullString(rawNode["name"]) ??
        "unknown"
    );
}

function getIcon(rawNode: JsonObject): IconName | undefined {
    const operatorType = getOperatorType(rawNode);
    if (operatorType.includes("JOIN") || operatorType === "CROSS_PRODUCT") {
        const joinType = tryToNonNullString(getExtraInfo(rawNode)?.["Join Type"]);
        if (joinType?.includes("LEFT")) return "left-join-symbol";
        if (joinType?.includes("RIGHT")) return "right-join-symbol";
        if (joinType?.includes("FULL")) return "full-join-symbol";
        return "inner-join-symbol";
    }
    if (operatorType.includes("GROUP_BY") || operatorType.includes("AGGREGATE")) return "groupby-symbol";
    if (operatorType.includes("ORDER_BY") || operatorType.includes("SORT") || operatorType === "TOP_N") return "sort-symbol";
    if (operatorType.includes("FILTER") || operatorType === "LIMIT") return "filter-symbol";
    if (
        operatorType.includes("CTE") ||
        operatorType.includes("DELIM_SCAN") ||
        operatorType === "DELIM_GET" ||
        operatorType === "COLUMN_DATA_SCAN"
    ) {
        return "temp-table-symbol";
    }
    if (operatorType === "DUMMY_SCAN" || operatorType === "EXPRESSION_SCAN" || operatorType === "EMPTY_RESULT") {
        return "const-table-symbol";
    }
    if (operatorType.includes("SCAN")) return "table-symbol";
    if (operatorType === "GENERATE_SERIES") return "const-table-symbol";
    if (operatorType === "INSERT") return "run-query-symbol";
    return undefined;
}

function getDisplayName(rawNode: JsonObject): string {
    const name = normalizeOperatorName(
        tryToNonNullString(rawNode["operator_name"]) ??
            tryToNonNullString(rawNode["name"]) ??
            tryToNonNullString(rawNode["operator_type"]) ??
            "unknown",
    );
    if (getOperatorType(rawNode).includes("SCAN")) {
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
        if (operatorType.includes("CTE_SCAN")) {
            const id = tryToNonNullString(getExtraInfo(rawNode)?.["CTE Index"]);
            return id === undefined ? undefined : crosslinkId("cte", id);
        }
        if (operatorType === "DELIM_SCAN") {
            const id = tryToNonNullString(getExtraInfo(rawNode)?.["Delim Index"]);
            return id === undefined ? undefined : crosslinkId("delim", id);
        }
        return undefined;
    },
    shouldExpandCollapsedChildren: () => false,
    getNodeColorValue(rawNode) {
        return tryToNumber(rawNode["operator_timing"]);
    },
    getEstimatedCardinality(rawNode) {
        return tryToNumber(getExtraInfo(rawNode)?.["Estimated Cardinality"]);
    },
    getActualCardinality(rawNode) {
        return tryToNumber(rawNode["operator_cardinality"]);
    },
};

function convertDuckPlan(rawRoot: Json, metadata?: Map<string, string>): TreeDescription {
    const state = createDecoratedJsonTreeState();
    const root = convertDecoratedJsonNode(rawRoot, "DuckDB plan", state, duckDbConfig);
    colorRelativeNumber(state.nodeColorValues);
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
            const isDelimJoin =
                operatorType === undefined ? node.name?.endsWith("delim_join") === true : operatorType.endsWith("DELIM_JOIN");
            if (isDelimJoin && id !== undefined) {
                crosslinkTargets.set(crosslinkId("delim", id), node);
            }
        },
        allChildren,
    );
    return {
        root,
        metadata,
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

function isSimpleDuckNode(value: Json): value is JsonObject {
    return hasSubObject(value, "extra_info") && typeof value["name"] === "string" && Array.isArray(value["children"]);
}

function isAnalyzedDuckNode(value: Json): value is JsonObject {
    return isJsonObject(value) && typeof value["operator_type"] === "string" && Array.isArray(value["children"]);
}

// DuckDB's JSON renderer wraps each plan's single root in an array.
function isSingletonArray(json: Json): json is [Json] {
    return Array.isArray(json) && json.length === 1;
}

function isSimplePlan(json: Json): json is [Json] {
    return isSingletonArray(json) && isSimpleDuckNode(json[0]);
}

function hasAnalyzedEnvelope(json: Json): json is JsonObject & {children: [Json]} {
    return isJsonObject(json) && typeof json["query_name"] === "string" && isSingletonArray(json["children"]);
}

function isAnalyzedPlan(json: Json): json is JsonObject & {children: [Json]} {
    return hasAnalyzedEnvelope(json) && isAnalyzedDuckNode(json["children"][0]);
}

function isExplainAnalyzeNode(value: Json): value is JsonObject & {children: Json[]} {
    return isAnalyzedDuckNode(value) && value["operator_type"] === "EXPLAIN_ANALYZE";
}

const stageNames = new Map([
    ["logical_plan", "logical plan"],
    ["logical_opt", "optimized logical plan"],
    ["physical_plan", "physical plan"],
]);

function getPlanStages(json: Json): [string, Json][] | undefined {
    if (!isJsonObject(json) || !Array.from(stageNames.keys()).every((key) => hasOwnProperty(json, key))) {
        return undefined;
    }
    const stages: [string, Json][] = [];
    for (const [key, name] of stageNames) {
        const plan = json[key];
        if (!isSingletonArray(plan)) {
            return undefined;
        }
        stages.push([name, plan[0]]);
    }
    return stages;
}

function analyzeMetadata(json: JsonObject): Map<string, string> {
    const metadata = new Map<string, string>();
    for (const key of Object.keys(json)) {
        if (key === "children") {
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
    if (isSingletonArray(json) && isDuckNode(json[0])) {
        return convertDuckPlan(json[0]);
    }
    if (hasAnalyzedEnvelope(json)) {
        let root = json["children"][0];
        if (isExplainAnalyzeNode(root)) {
            if (!isSingletonArray(root["children"])) {
                throw new InvalidPlanError("duckdb");
            }
            root = root["children"][0];
        }
        return convertDuckPlan(root, analyzeMetadata(json));
    }
    const stages = getPlanStages(json);
    if (stages !== undefined) {
        return combinePlanStages(stages);
    }
    throw new InvalidPlanError("duckdb");
}

export const duckDbPlanLoader: PlanLoader<Json> = {
    format: "duckdb",
    matches(json) {
        const stages = getPlanStages(json);
        return isSimplePlan(json) || isAnalyzedPlan(json) || stages?.every(([, root]) => isSimpleDuckNode(root)) === true;
    },
    load: loadDuckDbPlan,
};
