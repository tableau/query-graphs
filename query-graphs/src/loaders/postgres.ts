/*

Postgres JSON Transformations
-----------------------------

This is pretty much the same algorithm as the algorithm for Hyper plans

*/

import * as treeDescription from "../tree-description";
import type {IconName, TreeNode, TreeDescription} from "../tree-description";
import type {Json, JsonObject} from "./loader-utils";
import {tryToString, hasOwnProperty, hasSubOject} from "./loader-utils";
import {assert} from "../assert";
import type {DecoratedJsonTreeConfig} from "./decorated-json-tree";
import {convertDecoratedJsonNode, createDecoratedJsonTreeState} from "./decorated-json-tree";
import {buildIdMap, resolveCrosslinks, setRelativeEdgeWidths} from "./tree-postprocessing";
import {InvalidPlanError, type PlanLoader} from "./types";

function getStringProperty(rawNode: JsonObject, key: string): string | undefined {
    return hasOwnProperty(rawNode, key) ? tryToString(rawNode[key]) : undefined;
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
    fixedChildOrder: ["Plan", "Plans"],
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

// Color graph per a node's relative execution time
// Actual Total Time is cumulative
// Nodes with Actual Loops > 1 record an average Actual Total Time
// Parallelized nodes have Actual Loops = Workers Launched + 1 for the leader
// Not all Postgres plans have a root Execution Time even when children have Actual Total Time
function colorRelativeExecutionTime(root: TreeNode) {
    let executionTime = root.properties?.get("Execution Time");
    if (executionTime === undefined) {
        for (const child of treeDescription.allChildren(root)) {
            const actualTotalTime = child.properties?.get("Actual Total Time");
            if (actualTotalTime) {
                assert(executionTime === undefined, "Unexpected result child node");
                executionTime = actualTotalTime;
            }
        }
    }
    if (executionTime) {
        for (const child of treeDescription.allChildren(root)) {
            colorChildRelativeExecutionRatio(child, Number(executionTime), 1);
        }
    }
}
function colorChildRelativeExecutionRatio(node: TreeNode, executionTime: number, degreeOfParallelism: number) {
    let childrenTime = 0;
    if (node.name === "Gather" || node.name === "Gather Merge") {
        const workersLaunched = node.properties?.get("Workers Launched");
        assert(workersLaunched !== undefined, "Unexpected Workers Launched");
        degreeOfParallelism = Number(workersLaunched) + 1; /* leader */
    }
    for (const child of treeDescription.allChildren(node)) {
        const actualTotalTime = child.properties?.get("Actual Total Time");
        if (actualTotalTime) {
            const actualLoops = child.properties?.get("Actual Loops");
            assert(actualLoops !== undefined, "Unexpected Actual Loops");
            const childLoops = Number(actualLoops) / degreeOfParallelism;
            childrenTime += Number(actualTotalTime) * childLoops;
        }
    }
    const actualTotalTime = node.properties?.get("Actual Total Time");
    if (actualTotalTime) {
        const nodeTotalTime = Number(actualTotalTime);
        const actualLoops = node.properties?.get("Actual Loops");
        assert(actualLoops !== undefined, "Unexpected Actual Loops");
        let nodeLoops = Number(actualLoops);
        if (node.name !== "Gather" && node.name !== "Gather Merge") {
            nodeLoops /= degreeOfParallelism;
        }

        const relativeTotalTime = nodeTotalTime * nodeLoops - childrenTime;
        const relativeExecutionRatio = relativeTotalTime / executionTime;
        // TODO: remove Actual Total Time of a CTE from referencing CTE Scan subplans
        // TODO: assert(relativeExecutionRatio >= 0, "Unexpected relative execution ratio");

        assert(node.properties !== undefined);
        node.properties.set("~Relative Time", relativeTotalTime.toFixed(3));
        node.properties.set("~Relative Time Ratio", relativeExecutionRatio.toFixed(3));
        const l = (95 + (72 - 95) * relativeExecutionRatio).toFixed(3);
        node.nodeColor = relativeExecutionRatio >= 0.05 ? `hsl(309, 84%, ${l}%)` : undefined;
    }
    for (const child of treeDescription.allChildren(node)) {
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
    return hasSubOject(json, "Plan") && hasOwnProperty(json.Plan, "Node Type");
}

function loadPostgresPlan(json: Json): TreeDescription {
    if (!isPostgresPlan(json)) {
        throw new InvalidPlanError("postgres");
    }
    json = unwrapPostgresPlan(json);
    const state = createDecoratedJsonTreeState();
    const root = convertDecoratedJsonNode(json, "result", state, postgresConfig);
    colorRelativeExecutionTime(root);
    setRelativeEdgeWidths(state.edgeWidths);
    const operatorsById = buildIdMap(root, "Subplan Name");
    const crosslinks = resolveCrosslinks(state.crosslinks, operatorsById);
    return {root, crosslinks};
}

export const postgresPlanLoader: PlanLoader<Json> = {
    format: "postgres",
    matches: isPostgresPlan,
    load: loadPostgresPlan,
};
