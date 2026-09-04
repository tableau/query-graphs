/*

MariaDB JSON Transformations
----------------------------

MariaDB represents operators as structural object keys rather than tagged
nodes. Optimizer traces use a separate decision-log schema.

*/

import type {IconName, TreeDescription, TreeNode} from "../tree-description";
import type {Json, JsonObject} from "./loader-utils";
import {formatMetric, hasOwnProperty, tryToString} from "./loader-utils";
import {colorRelativeExecutionTime, setEdgeWidths} from "./tree-postprocessing";

interface MariaConversionState {
    edgeWidths: {node: TreeNode; width: number}[];
    runtimes: {node: TreeNode; time: number}[];
}

const structuralKeys = [
    "query_block",
    "union_result",
    "recursive_union",
    "window_functions_computation",
    "read_sorted_file",
    "filesort",
    "temporary_table",
    "nested_loop",
    "block-nl-join",
    "table",
    "materialized",
    "materialization",
    "subqueries",
    "expression_cache",
    "query_specifications",
];

const collectionKeys = new Set(["query_specifications", "subqueries"]);

function getObject(value: Json | undefined): JsonObject | undefined {
    return typeof value === "object" && !Array.isArray(value) && value !== null ? value : undefined;
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

function convertTraceValue(name: string, value: Json): TreeNode {
    if (Array.isArray(value)) {
        return {
            name,
            children: value.map((entry, index) => {
                const object = getObject(entry);
                const keys = object === undefined ? [] : Object.keys(object);
                return keys.length === 1 ? convertTraceValue(keys[0], object![keys[0]]) : convertTraceValue(`${index}`, entry);
            }),
        };
    }
    const object = getObject(value);
    if (object === undefined) {
        const scalar = tryToString(value) ?? JSON.stringify(value);
        return {name, properties: new Map([["value", scalar]])};
    }

    const properties = new Map<string, string>();
    const children: TreeNode[] = [];
    for (const key of Object.keys(object)) {
        const scalar = tryToString(object[key]);
        if (scalar !== undefined) {
            properties.set(key, scalar);
        } else {
            children.push(convertTraceValue(key, object[key]));
        }
    }
    const detail = properties.get("table") ?? properties.get("transformation");
    return {name: detail === undefined ? name : `${name}: ${detail}`, properties, children};
}

function rendering(kind: string, properties: Map<string, string>): {name: string; icon?: IconName} {
    switch (kind) {
        case "query_block": {
            const operation = properties.get("operation");
            const selectId = properties.get("select_id");
            return {name: operation ?? (selectId === undefined ? "query block" : `query block ${selectId}`)};
        }
        case "table": {
            const tableName = properties.get("table_name") ?? properties.get("message") ?? "table";
            const accessType = properties.get("access_type");
            return {
                name: accessType === undefined ? tableName : `${tableName} (${accessType})`,
                icon: properties.has("table_name") ? "table-symbol" : "const-table-symbol",
            };
        }
        case "block-nl-join":
            return {name: properties.get("join_type") ?? "block nested loop", icon: "inner-join-symbol"};
        case "filesort":
        case "read_sorted_file":
            return {name: kind.replaceAll("_", " "), icon: "sort-symbol"};
        case "temporary_table":
        case "materialized":
        case "materialization":
        case "expression_cache":
            return {name: kind.replaceAll("_", " "), icon: "temp-table-symbol"};
        case "union_result":
            return {name: properties.get("table_name") ?? "union", icon: "temp-table-symbol"};
        case "recursive_union":
            return {name: properties.get("table_name") ?? "recursive union", icon: "temp-table-symbol"};
        case "window_functions_computation":
            return {name: "window functions"};
        default:
            return {name: kind.replaceAll("_", " ")};
    }
}

function convertNestedLoop(value: Json, state: MariaConversionState): TreeNode[] {
    if (!Array.isArray(value)) {
        return [convertTraceValue("nested loop", value)];
    }
    let result: TreeNode | undefined;
    for (const entry of value) {
        const object = getObject(entry);
        if (object === undefined) {
            const node = convertTraceValue("entry", entry);
            result = result === undefined ? node : {name: "nested loop", icon: "inner-join-symbol", children: [result, node]};
            continue;
        }
        const blockJoin = getObject(object["block-nl-join"]);
        if (blockJoin !== undefined) {
            const join = convertPlanNode("block-nl-join", blockJoin, state);
            const unknownEntries = Object.entries(object).filter(([key]) => key !== "block-nl-join");
            if (unknownEntries.length > 0) {
                (join.collapsedChildren ??= []).push(convertTraceValue("details", Object.fromEntries(unknownEntries)));
            }
            if (result !== undefined) {
                join.children = [result, ...(join.children ?? [])];
            }
            result = join;
            continue;
        }

        const nodes = convertStructuralObject(object, state);
        for (const node of nodes) {
            result = result === undefined ? node : {name: "nested loop", icon: "inner-join-symbol", children: [result, node]};
        }
    }
    return result === undefined ? [] : [result];
}

function convertStructuralValue(key: string, value: Json, state: MariaConversionState): TreeNode[] {
    if (key === "nested_loop") {
        return convertNestedLoop(value, state);
    }
    if (collectionKeys.has(key)) {
        if (!Array.isArray(value)) {
            return [convertTraceValue(key.replaceAll("_", " "), value)];
        }
        return value.flatMap((entry) => {
            const object = getObject(entry);
            return object === undefined
                ? [convertTraceValue(key.replaceAll("_", " "), entry)]
                : convertStructuralObject(object, state);
        });
    }
    const object = getObject(value);
    return object === undefined ? [convertTraceValue(key.replaceAll("_", " "), value)] : [convertPlanNode(key, object, state)];
}

function convertStructuralObject(object: JsonObject, state: MariaConversionState): TreeNode[] {
    const nodes: TreeNode[] = [];
    for (const key of structuralKeys) {
        if (hasOwnProperty(object, key)) {
            nodes.push(...convertStructuralValue(key, object[key], state));
        }
    }
    if (nodes.length === 0) {
        return [convertTraceValue("details", object)];
    }
    const unknownEntries = Object.entries(object).filter(([key]) => !structuralKeys.includes(key));
    if (unknownEntries.length > 0) {
        (nodes[0].collapsedChildren ??= []).push(convertTraceValue("details", Object.fromEntries(unknownEntries)));
    }
    return nodes;
}

function addMetrics(kind: string, rawNode: JsonObject, node: TreeNode, state: MariaConversionState): void {
    let estimatedRows: number | undefined;
    let actualRows: number | undefined;
    if (kind === "table") {
        const estimatedInputRows = parseNumber(rawNode["rows"]);
        const estimatedFiltered = parseNumber(rawNode["filtered"]) ?? 100;
        estimatedRows = estimatedInputRows === undefined ? undefined : (estimatedInputRows * estimatedFiltered) / 100;

        const actualInputRows = parseNumber(rawNode["r_rows"]);
        const actualFiltered = parseNumber(rawNode["r_filtered"]) ?? 100;
        actualRows = actualInputRows === undefined ? undefined : (actualInputRows * actualFiltered) / 100;
    } else if (kind === "block-nl-join") {
        const effectiveRows = parseNumber(rawNode["r_effective_rows"]);
        const actualFiltered = parseNumber(rawNode["r_filtered"]) ?? 100;
        const loops = parseNumber(rawNode["r_loops"]) ?? 1;
        actualRows = effectiveRows === undefined ? undefined : (effectiveRows * actualFiltered * loops) / 100;
    } else if (kind === "filesort") {
        actualRows = parseNumber(rawNode["r_output_rows"]);
    }
    const edgeWidth = actualRows ?? estimatedRows;
    if (edgeWidth !== undefined) {
        state.edgeWidths.push({node, width: edgeWidth});
        node.edgeLabel =
            estimatedRows !== undefined && actualRows !== undefined
                ? `${formatMetric(actualRows)}/${formatMetric(estimatedRows)}`
                : formatMetric(edgeWidth);
        if (
            estimatedRows !== undefined &&
            actualRows !== undefined &&
            (estimatedRows > actualRows * 10 || actualRows > estimatedRows * 10)
        ) {
            node.edgeClass = "qg-label-highlighted";
        }
    }

    let runtime: number | undefined;
    if (kind === "table") {
        const tableTime = parseNumber(rawNode["r_table_time_ms"]) ?? 0;
        const otherTime = parseNumber(rawNode["r_other_time_ms"]) ?? 0;
        runtime = tableTime + otherTime;
    } else if (kind === "block-nl-join") {
        const unpackTime = parseNumber(rawNode["r_unpack_time_ms"]) ?? 0;
        const otherTime = parseNumber(rawNode["r_other_time_ms"]) ?? 0;
        runtime = unpackTime + otherTime;
    }
    if (runtime !== undefined && runtime > 0) {
        state.runtimes.push({node, time: runtime});
    }
}

function convertPlanNode(kind: string, rawNode: JsonObject, state: MariaConversionState): TreeNode {
    const properties = new Map<string, string>();
    const collapsedChildren: TreeNode[] = [];
    for (const key of Object.keys(rawNode).sort()) {
        if (structuralKeys.includes(key)) {
            continue;
        }
        const scalar = tryToString(rawNode[key]);
        if (scalar !== undefined) {
            properties.set(key, scalar);
        } else {
            collapsedChildren.push(convertTraceValue(key, rawNode[key]));
        }
    }
    const rendered = rendering(kind, properties);
    const children = structuralKeys.flatMap((key) =>
        hasOwnProperty(rawNode, key) ? convertStructuralValue(key, rawNode[key], state) : [],
    );
    const node: TreeNode = {
        name: rendered.name,
        icon: rendered.icon,
        properties,
        children,
        collapsedChildren,
    };
    addMetrics(kind, rawNode, node, state);
    return node;
}

function isMariaDbPlan(json: Json): json is JsonObject {
    const object = getObject(json);
    return object !== undefined && getObject(object["query_block"]) !== undefined;
}

function isOptimizerTrace(json: Json): json is JsonObject & {steps: Json[]} {
    const object = getObject(json);
    if (object === undefined || Object.keys(object).length !== 1 || !Array.isArray(object["steps"])) {
        return false;
    }
    const stageNames = new Set(["join_preparation", "join_optimization", "join_execution"]);
    const stages = object["steps"].map((step) => {
        const stage = getObject(step);
        return stage === undefined ? [] : Object.keys(stage);
    });
    return stages.length > 0 && stages.every((keys) => keys.length === 1) && stages.some((keys) => stageNames.has(keys[0]));
}

export function loadMariaDbPlan(json: Json): TreeDescription {
    if (isMariaDbPlan(json)) {
        const state: MariaConversionState = {edgeWidths: [], runtimes: []};
        const root = convertPlanNode("query_block", json["query_block"] as JsonObject, state);
        for (const key of Object.keys(json)) {
            if (key !== "query_block") {
                (root.collapsedChildren ??= []).push(convertTraceValue(key, json[key]));
            }
        }
        const totalTime = parseNumber((json["query_block"] as JsonObject)["r_total_time_ms"]);
        if (totalTime === undefined) {
            colorRelativeExecutionTime(state.runtimes);
        } else {
            colorRelativeExecutionTime(state.runtimes, totalTime);
        }
        setEdgeWidths(state.edgeWidths);
        const metadata = new Map<string, string>();
        const queryOptimization = getObject(json["query_optimization"]);
        const rawOptimizationTime = queryOptimization?.["r_total_time_ms"];
        const optimizationTime = rawOptimizationTime === undefined ? undefined : tryToString(rawOptimizationTime);
        if (optimizationTime !== undefined) {
            metadata.set("query optimization time (ms)", optimizationTime);
        }
        return {root, metadata};
    }
    if (isOptimizerTrace(json)) {
        const trace = convertTraceValue("optimizer trace", json["steps"]);
        return {root: trace};
    }
    throw new Error("Invalid MariaDB query plan");
}

export function loadMariaDbPlanFromText(graphString: string): TreeDescription {
    let json: Json;
    try {
        json = JSON.parse(graphString) as Json;
    } catch (error) {
        throw new Error("JSON parse failed with '" + error + "'.", {cause: error});
    }
    return loadMariaDbPlan(json);
}
