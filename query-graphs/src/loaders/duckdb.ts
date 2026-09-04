/*

DuckDB JSON Transformations
---------------------------

DuckDB emits explicit `children` trees. Simple plans use `name`; analyzed plans
use `operator_name` and add per-operator metrics plus a profiling envelope.

*/

import type {IconName, TreeDescription, TreeNode} from "../tree-description";
import type {Json, JsonObject} from "./loader-utils";
import {forceToString, formatMetric, hasOwnProperty, tryToString} from "./loader-utils";
import {combinePlanStages} from "./staged-plans";
import {colorRelativeExecutionTime, resolveCrosslinks, setEdgeWidths, type UnresolvedCrosslink} from "./tree-postprocessing";

interface DuckConversionState {
    ctesById: Map<string, TreeNode>;
    crosslinks: UnresolvedCrosslink[];
    edgeWidths: {node: TreeNode; width: number}[];
    runtimes: {node: TreeNode; time: number}[];
}

function newDuckConversionState(): DuckConversionState {
    return {ctesById: new Map(), crosslinks: [], edgeWidths: [], runtimes: []};
}

function getObject(value: Json | undefined): JsonObject | undefined {
    return typeof value === "object" && !Array.isArray(value) && value !== null ? value : undefined;
}

function getExtraInfo(rawNode: JsonObject): JsonObject | undefined {
    return getObject(rawNode["extra_info"]);
}

function parseNumber(value: Json | undefined): number | undefined {
    if (typeof value === "number") {
        return value;
    }
    if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
}

function optionalString(value: Json | undefined): string | undefined {
    return value === undefined ? undefined : tryToString(value);
}

function getIcon(operatorType: string, properties: Map<string, string>): IconName | undefined {
    const normalized = operatorType.toUpperCase();
    if (normalized.includes("JOIN") || normalized === "CROSS_PRODUCT") {
        const joinType = properties.get("Join Type")?.toUpperCase();
        if (joinType?.includes("LEFT")) return "left-join-symbol";
        if (joinType?.includes("RIGHT")) return "right-join-symbol";
        if (joinType?.includes("FULL")) return "full-join-symbol";
        return "inner-join-symbol";
    }
    if (normalized.includes("GROUP_BY") || normalized.includes("AGGREGATE")) return "groupby-symbol";
    if (normalized.includes("ORDER_BY") || normalized.includes("SORT") || normalized === "TOP_N") return "sort-symbol";
    if (normalized.includes("FILTER") || normalized === "LIMIT") return "filter-symbol";
    if (
        normalized.includes("CTE") ||
        normalized.includes("DELIM_SCAN") ||
        normalized === "DELIM_GET" ||
        normalized === "COLUMN_DATA_SCAN"
    ) {
        return "temp-table-symbol";
    }
    if (normalized === "DUMMY_SCAN" || normalized === "EXPRESSION_SCAN" || normalized === "EMPTY_RESULT") {
        return "const-table-symbol";
    }
    if (normalized.includes("SCAN")) return "table-symbol";
    if (normalized === "GENERATE_SERIES") return "const-table-symbol";
    if (normalized === "INSERT") return "run-query-symbol";
    return undefined;
}

function collectProperties(rawNode: JsonObject): Map<string, string> {
    const properties = new Map<string, string>();
    const extraInfo = getExtraInfo(rawNode);
    for (const key of Object.keys(extraInfo ?? {}).sort()) {
        properties.set(key, forceToString(extraInfo![key]));
    }
    for (const key of Object.keys(rawNode).sort()) {
        if (["children", "extra_info", "name", "operator_name"].includes(key)) {
            continue;
        }
        const value = tryToString(rawNode[key]) ?? forceToString(rawNode[key]);
        properties.set(key, value);
    }
    return properties;
}

function displayName(rawName: string, properties: Map<string, string>): string {
    if (rawName.toUpperCase().includes("SCAN")) {
        const table = properties.get("Table");
        if (table !== undefined) {
            return `${table} (${rawName})`;
        }
    }
    return rawName;
}

function convertDuckNode(rawNode: JsonObject, state: DuckConversionState): TreeNode {
    const rawName = optionalString(rawNode["operator_name"]) ?? optionalString(rawNode["name"]) ?? "unknown";
    const properties = collectProperties(rawNode);
    const children = Array.isArray(rawNode["children"])
        ? rawNode["children"].map((child) => {
              const object = getObject(child);
              return object === undefined ? {name: forceToString(child)} : convertDuckNode(object, state);
          })
        : [];
    const node: TreeNode = {
        name: displayName(rawName, properties),
        icon: getIcon(optionalString(rawNode["operator_type"]) ?? rawName, properties),
        properties,
        children,
    };

    const estimatedCardinality = parseNumber(getExtraInfo(rawNode)?.["Estimated Cardinality"]);
    const actualCardinality = parseNumber(rawNode["operator_cardinality"]);
    const width = actualCardinality ?? estimatedCardinality;
    if (width !== undefined) {
        state.edgeWidths.push({node, width});
        node.edgeLabel =
            estimatedCardinality === undefined || actualCardinality === undefined
                ? formatMetric(width)
                : `${formatMetric(actualCardinality)}/${formatMetric(estimatedCardinality)}`;
        if (
            estimatedCardinality !== undefined &&
            actualCardinality !== undefined &&
            (estimatedCardinality > actualCardinality * 10 || actualCardinality > estimatedCardinality * 10)
        ) {
            node.edgeClass = "qg-label-highlighted";
        }
    }

    const operatorTiming = parseNumber(rawNode["operator_timing"]);
    if (operatorTiming !== undefined) {
        state.runtimes.push({node, time: operatorTiming});
    }

    const operatorType = (optionalString(rawNode["operator_type"]) ?? rawName).toUpperCase();
    const extraInfo = getExtraInfo(rawNode);
    if (operatorType === "CTE" || operatorType === "RECURSIVE_CTE") {
        const cteId = optionalString(extraInfo?.["Table Index"]);
        if (cteId !== undefined) {
            state.ctesById.set(cteId, node);
        }
    } else if (operatorType.includes("CTE_SCAN")) {
        const cteId = optionalString(extraInfo?.["CTE Index"]);
        if (cteId !== undefined) {
            state.crosslinks.push({source: node, targetId: cteId});
        }
    }
    return node;
}

function convertDuckForest(roots: JsonObject[], metadata?: Map<string, string>): TreeDescription {
    const state = newDuckConversionState();
    const children = roots.map((root) => convertDuckNode(root, state));
    const root = children.length === 1 ? children[0] : {name: "DuckDB plan", children};
    colorRelativeExecutionTime(state.runtimes);
    setEdgeWidths(state.edgeWidths);
    return {
        root,
        metadata,
        crosslinks: resolveCrosslinks(state.crosslinks, state.ctesById),
    };
}

function isDuckNode(value: Json): value is JsonObject {
    const object = getObject(value);
    return (
        object !== undefined &&
        (typeof object["name"] === "string" || typeof object["operator_name"] === "string") &&
        Array.isArray(object["children"])
    );
}

function isSimpleDuckNode(value: Json): value is JsonObject {
    const object = getObject(value);
    return (
        object !== undefined &&
        typeof object["name"] === "string" &&
        getObject(object["extra_info"]) !== undefined &&
        Array.isArray(object["children"])
    );
}

function isAnalyzedDuckNode(value: Json): value is JsonObject {
    const object = getObject(value);
    return (
        object !== undefined &&
        typeof object["operator_name"] === "string" &&
        typeof object["operator_type"] === "string" &&
        getObject(object["extra_info"]) !== undefined &&
        Array.isArray(object["children"])
    );
}

function isSimplePlan(json: Json): json is JsonObject[] {
    return Array.isArray(json) && json.length > 0 && json.every(isSimpleDuckNode);
}

function isAnalyzedPlan(json: Json): json is JsonObject & {children: Json[]} {
    const object = getObject(json);
    return (
        object !== undefined &&
        typeof object["query_name"] === "string" &&
        typeof object["latency"] === "number" &&
        Array.isArray(object["children"]) &&
        object["children"].length > 0 &&
        object["children"].every(isAnalyzedDuckNode)
    );
}

const stageNames = new Map([
    ["logical_plan", "logical plan"],
    ["logical_opt", "optimized logical plan"],
    ["physical_plan", "physical plan"],
]);

function getPlanStages(json: Json): [string, JsonObject[]][] | undefined {
    const object = getObject(json);
    if (object === undefined || !Array.from(stageNames.keys()).every((key) => hasOwnProperty(object, key))) {
        return undefined;
    }
    const stages: [string, JsonObject[]][] = [];
    for (const [key, name] of stageNames) {
        const roots = object[key];
        if (!Array.isArray(roots) || roots.length === 0 || !roots.every(isSimpleDuckNode)) {
            return undefined;
        }
        stages.push([name, roots]);
    }
    return stages;
}

function analyzeMetadata(json: JsonObject): Map<string, string> {
    const metadata = new Map<string, string>();
    for (const key of Object.keys(json)) {
        if (key === "children" || key === "extra_info") {
            continue;
        }
        const value = tryToString(json[key]);
        if (value !== undefined) {
            metadata.set(key, value);
        }
    }
    return metadata;
}

export function loadDuckDbPlan(json: Json): TreeDescription {
    if (isSimplePlan(json)) {
        return convertDuckForest(json);
    }
    if (isAnalyzedPlan(json)) {
        const roots = json["children"].filter(isDuckNode);
        const explainAnalyze = roots.length === 1 && roots[0]["operator_type"] === "EXPLAIN_ANALYZE" ? roots[0] : undefined;
        const explainChildren =
            explainAnalyze !== undefined && Array.isArray(explainAnalyze["children"]) ? explainAnalyze["children"] : undefined;
        const planRoots =
            explainChildren !== undefined && explainChildren.length > 0 && explainChildren.every(isDuckNode)
                ? explainChildren
                : roots;
        return convertDuckForest(planRoots, analyzeMetadata(json));
    }
    const stages = getPlanStages(json);
    if (stages !== undefined) {
        return combinePlanStages(
            "optimizer stages",
            stages.map(([name, roots]) => [name, convertDuckForest(roots)]),
        );
    }
    throw new Error("Invalid DuckDB query plan");
}

export function loadDuckDbPlanFromText(graphString: string): TreeDescription {
    let json: Json;
    try {
        json = JSON.parse(graphString) as Json;
    } catch (error) {
        throw new Error("JSON parse failed with '" + error + "'.", {cause: error});
    }
    return loadDuckDbPlan(json);
}
