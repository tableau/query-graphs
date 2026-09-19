/*

Postgres JSON Transformations
-----------------------------

*/

import type {IconName, TreeDescription, TreeNode} from "../tree-description";
import type {DecoratedJsonTreeConfig} from "./decorated-json-tree";
import {convertDecoratedJsonNode, createDecoratedJsonTreeState} from "./decorated-json-tree";
import type {Json, JsonObject} from "./loader-utils";
import {hasOwnProperty, hasSubObject, tryToNonNullString, tryToNumber} from "./loader-utils";
import {buildIdMap, resolveCrosslinks, setRelativeEdgeWidths} from "./tree-postprocessing";
import type {JsonPlanLoader, PlanLoadContext} from "./types";

function getStringProperty(rawNode: JsonObject, key: string): string | undefined {
    return tryToNonNullString(rawNode[key]);
}

function getOperatorIcon(operatorType: string, rawNode: JsonObject): IconName | undefined {
    switch (operatorType) {
        case "Hash Join":
        case "Nested Loop":
        case "Merge Join": {
            const joinIcons = {
                Inner: "inner-join-symbol",
                "Full Outer": "full-join-symbol",
                "Left Outer": "left-join-symbol",
                "Right Outer": "right-join-symbol",
            };
            return joinIcons[getStringProperty(rawNode, "Join Type") ?? ""] ?? "temp-table-symbol";
        }
        case "CTE Scan":
        case "Materialize":
        case "WorkTable Scan":
            return "temp-table-symbol";
        case "Incremental Sort":
        case "Sort":
            return "sort-symbol";
        case "Result":
            return "const-table-symbol";
        case "Limit":
            return "filter-symbol";
        case "Aggregate":
            return "groupby-symbol";
        case "Function Scan":
        case "Table Function Scan":
            return undefined;
        default:
            return operatorType.endsWith(" Scan") ? "table-symbol" : undefined;
    }
}

function getOperatorDisplayName(operatorType: string, rawNode: JsonObject): string {
    switch (operatorType) {
        case "CTE Scan":
        case "WorkTable Scan":
        case "Function Scan":
        case "Table Function Scan":
            return operatorType;
        default: {
            if (!operatorType.endsWith(" Scan")) return operatorType;
            const relation = getStringProperty(rawNode, "Relation Name") ?? getStringProperty(rawNode, "Index Name");
            return relation === undefined ? operatorType : `${relation} (${operatorType})`;
        }
    }
}

const postgresConfig: DecoratedJsonTreeConfig = {
    nodeTypeKeys: ["Node Type"],
    structuralChildKeys: ["Plan", "Plans"],
    alwaysPropertyKeys: [],
    getRenderingConfig(_nodeTypeKey, operatorType, rawNode) {
        return {icon: getOperatorIcon(operatorType, rawNode)};
    },
    getDisplayName(rawNode) {
        const operatorType = getStringProperty(rawNode, "Node Type");
        return operatorType === undefined ? undefined : getOperatorDisplayName(operatorType, rawNode);
    },
    getCrosslinkTarget(rawNode) {
        if (rawNode["Node Type"] !== "CTE Scan") return undefined;
        const cteName = getStringProperty(rawNode, "CTE Name");
        return cteName === undefined ? undefined : `CTE ${cteName}`;
    },
    shouldCollapseChild(rawNode, key) {
        const isPlanChild = key === "Plan" || key === "Plans";
        return !isPlanChild && (hasOwnProperty(rawNode, "Node Type") || hasOwnProperty(rawNode, "Triggers"));
    },
    shouldExpandCollapsedChildren: () => false,
    getEstimatedCardinality(rawNode) {
        const cardinality = rawNode["Plan Rows"];
        return typeof cardinality === "number" ? cardinality : undefined;
    },
    getActualCardinality(rawNode) {
        const cardinality = rawNode["Actual Rows"];
        return typeof cardinality === "number" ? cardinality : undefined;
    },
};

// Postgres plan operators are expanded children. Collapsed children contain
// auxiliary data such as triggers and must not participate in timing math.
function planChildren(node: TreeNode): TreeNode[] {
    return node.children ?? [];
}

// Color graph per a node's relative execution time
// Actual Total Time is cumulative
// Nodes with Actual Loops > 1 record an average Actual Total Time
// Parallelized nodes have Actual Loops = Workers Launched + 1 for the leader
// Not all Postgres plans have a root Execution Time even when children have Actual Total Time
function colorRelativeExecutionTime(root: TreeNode) {
    let executionTime = tryToNumber(root.properties?.get("Execution Time"));
    if (executionTime === undefined) {
        const childExecutionTimes = planChildren(root).flatMap((child) => {
            const actualTotalTime = tryToNumber(child.properties?.get("Actual Total Time"));
            return actualTotalTime === undefined ? [] : [actualTotalTime];
        });
        executionTime = childExecutionTimes.length === 0 ? undefined : Math.max(...childExecutionTimes);
    }
    if (executionTime !== undefined && executionTime > 0) {
        for (const child of planChildren(root)) {
            colorChildRelativeExecutionRatio(child, executionTime, 1);
        }
    }
}
function colorChildRelativeExecutionRatio(node: TreeNode, executionTime: number, degreeOfParallelism: number) {
    let childrenTime = 0;
    if (node.name === "Gather" || node.name === "Gather Merge") {
        const workersLaunched = tryToNumber(node.properties?.get("Workers Launched"));
        if (workersLaunched === undefined || workersLaunched < 0) return;
        degreeOfParallelism = workersLaunched + 1; /* leader */
    }
    let childTimingsComplete = true;
    for (const child of planChildren(node)) {
        const actualTotalTime = tryToNumber(child.properties?.get("Actual Total Time"));
        const actualLoops = tryToNumber(child.properties?.get("Actual Loops"));
        if (actualTotalTime !== undefined && actualLoops !== undefined) {
            const childLoops = actualLoops / degreeOfParallelism;
            childrenTime += actualTotalTime * childLoops;
        } else {
            childTimingsComplete = false;
        }
    }
    const actualTotalTime = tryToNumber(node.properties?.get("Actual Total Time"));
    const actualLoops = tryToNumber(node.properties?.get("Actual Loops"));
    if (actualTotalTime !== undefined && actualLoops !== undefined && childTimingsComplete) {
        let nodeLoops = actualLoops;
        if (node.name !== "Gather" && node.name !== "Gather Merge") {
            nodeLoops /= degreeOfParallelism;
        }

        const relativeTotalTime = actualTotalTime * nodeLoops - childrenTime;
        const relativeExecutionRatio = relativeTotalTime / executionTime;
        // TODO: remove Actual Total Time of a CTE from referencing CTE Scan subplans
        // TODO: assert(relativeExecutionRatio >= 0, "Unexpected relative execution ratio");

        node.properties?.set("~Relative Time", relativeTotalTime.toFixed(3));
        node.properties?.set("~Relative Time Ratio", relativeExecutionRatio.toFixed(3));
        const l = (95 + (72 - 95) * relativeExecutionRatio).toFixed(3);
        node.nodeColor = relativeExecutionRatio >= 0.05 ? `hsl(309, 84%, ${l}%)` : undefined;
    }
    for (const child of planChildren(node)) {
        colorChildRelativeExecutionRatio(child, executionTime, degreeOfParallelism);
    }
}

function unwrapPostgresPlan(json: Json): Json {
    if (Array.isArray(json) && json.length === 1) {
        return json[0];
    }
    return json;
}

function isPostgresPlan(json: Json): boolean {
    json = unwrapPostgresPlan(json);
    return hasSubObject(json, "Plan") && hasOwnProperty(json.Plan, "Node Type");
}

function loadPostgresPlan(json: Json, context: PlanLoadContext): TreeDescription {
    json = unwrapPostgresPlan(json);
    const state = createDecoratedJsonTreeState();
    const root = convertDecoratedJsonNode(json, "result", state, postgresConfig, context);
    colorRelativeExecutionTime(root);
    setRelativeEdgeWidths(state.edgeWidths);
    const operatorsById = buildIdMap(root, "Subplan Name");
    const crosslinks = resolveCrosslinks(state.crosslinks, operatorsById);
    return {root, crosslinks};
}

export const postgresPlanLoader: JsonPlanLoader = {
    format: "postgres",
    sourcePropertyKeys: new Set(postgresConfig.nodeTypeKeys),
    matches: isPostgresPlan,
    load: loadPostgresPlan,
};
