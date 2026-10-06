/*

Hyper JSON Transformations
--------------------------

Hyper plans use the shared adaptive operator/expression tree conversion plus
Hyper-specific rendering, metrics, crosslinks, and plan envelopes.

Hyper plan-format compatibility is retained for three months after a format
change. Legacy paths are marked with a dated TODO when their removal window is
known.

*/

import type {Crosslink, PropertyEntry, TreeDescription, TreeNode} from "../tree-description";
import {allChildren, visitTreeNodes} from "../tree-description";
import type {Json, JsonObject, SurfaceRowOptions} from "./loader-utils";
import {
    applyNumberFormats,
    getPropertyPath,
    hasOwnProperty,
    isJsonObject,
    jsonToPropertyEntry,
    reorderProperties,
    surfaceRowAttributes,
    tryGetPropertyPath,
    tryToNumber,
    tryToString,
} from "./loader-utils";
import type {DecoratedJsonTreeConfig, NodeRenderingConfig} from "./decorated-json-tree";
import {convertDecoratedJsonNode, createDecoratedJsonTreeState} from "./decorated-json-tree";
import type {ExecutionPipeline} from "./pipeline-coloring";
import {assignPipelineColors} from "./pipeline-coloring";
import {buildIdMap, colorRelativeNumber, resolveCrosslinks, setRelativeEdgeWidths} from "./tree-postprocessing";
import type {JsonPlanLoader, PlanLoadContext} from "./types";

const nodeRenderingConfig: Record<string, NodeRenderingConfig> = {
    "op:result-sink": {icon: "run-query-symbol"},
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
    // Various scans
    "op:scan": {displayNameKey: "type", icon: "table-symbol"},
    "op:scan:virtual-table": {displayNameKey: "type", icon: "virtual-table-symbol"},
    // Other tables
    "op:table-construction": {icon: "const-table-symbol"},
    // Temp & Explicit scan
    "op:explicit-scan": {icon: "temp-table-symbol", crosslinkSourceKey: "input"},
    "op:iteration-increment": {crosslinkSourceKey: "source"},
    // Inserts
    "op:insert": {displayNameKey: "type"},
    // Expressions
    "exp:comparison": {displayNameKey: "mode"},
    "exp:iu-ref": {displayNameKey: "iu"},
    "exp:reference": {displayNameKey: "id"},
};

// TODO(2026-12-18): Remove aliases for operator tags replaced on 2026-09-18.
const legacyNodeTags: Record<string, string> = {
    "op:execution-target": "op:result-sink",
    "op:executiontarget": "op:result-sink",
    "op:output": "op:result-sink",
    "op:select": "op:filter",
    "op:groupby": "op:group-by",
    // Joins
    "op:left-outer-join": "op:join:left-outer",
    "op:leftouterjoin": "op:join:left-outer",
    "op:right-outer-join": "op:join:right-outer",
    "op:rightouterjoin": "op:join:right-outer",
    "op:full-outer-join": "op:join:full-outer",
    "op:fullouterjoin": "op:join:full-outer",
    "op:left-anti-join": "op:join:left-anti",
    "op:leftantijoin": "op:join:left-anti",
    "op:right-anti-join": "op:join:right-anti",
    "op:rightantijoin": "op:join:right-anti",
    "op:left-semi-join": "op:join:left-semi",
    "op:leftsemijoin": "op:join:left-semi",
    "op:right-semi-join": "op:join:right-semi",
    "op:rightsemijoin": "op:join:right-semi",
    "op:left-single-join": "op:join:left-single",
    "op:leftsinglejoin": "op:join:left-single",
    "op:right-single-join": "op:join:right-single",
    "op:rightsinglejoin": "op:join:right-single",
    "op:left-mark-join": "op:join:left-mark",
    "op:leftmarkjoin": "op:join:left-mark",
    "op:right-mark-join": "op:join:right-mark",
    "op:rightmarkjoin": "op:join:right-mark",
    // Scans
    "op:table-scan": "op:scan",
    "op:tablescan": "op:scan",
    "op:arrow-scan": "op:scan",
    "op:arrowscan": "op:scan",
    "op:binary-scan": "op:scan",
    "op:binaryscan": "op:scan",
    "op:csv-scan": "op:scan",
    "op:csvscan": "op:scan",
    "op:cloud-table-scan": "op:scan",
    "op:cloudtablescan": "op:scan",
    "op:cursor-scan": "op:scan",
    "op:cursorscan": "op:scan",
    "op:iceberg-scan": "op:scan",
    "op:icebergscan": "op:scan",
    "op:parquet-scan": "op:scan",
    "op:parquetscan": "op:scan",
    "op:tde-scan": "op:scan",
    "op:tdescan": "op:scan",
    "op:tableconstruction": "op:table-construction",
    "op:virtual-table": "op:scan:virtual-table",
    "op:virtualtable": "op:scan:virtual-table",
    "op:temp": "op:explicit-scan",
    "op:explicitscan": "op:explicit-scan",
    "op:iterationincrement": "op:iteration-increment",
    // Expressions
    "exp:iuref": "exp:iu-ref",
};

function containsOperator(value: Json): boolean {
    while (Array.isArray(value) && value.length > 0) {
        value = value[0];
    }
    return isJsonObject(value) && hasOwnProperty(value, "operator");
}

// Row counts and CPU cycles, shown at an operator's top level (nested ones are
// copied there), so they read without opening any group.
const hyperRows: SurfaceRowOptions = {
    rowProps: [
        "estimated-rows",
        ["statistics", "estimated-rows"],
        ["statistics", "output-rows"],
        ["statistics", "processed-rows"],
        ["statistics", "rows-matching-restrictions"],
        ["pipeline-stats", "query-metrics", "additional-entries", "scan-stats", "rows-matching-restrictions"],
        ["pipeline-stats", "cpu-cycles"],
    ],
};

// Curated operator tooltip rows, in display order. Unlisted rows such as
// `operator-id` keep their order after these; groups always come last.
const operatorRowOrder = [
    "table-or-alias",
    "estimated-rows",
    "output-rows",
    "processed-rows",
    "rows-matching-restrictions",
    "memory-bytes",
    "cpu-cycles",
    "execution-time",
] as const;

// Read a numeric member of a converted, possibly nested statistics group.
function readStatistic(node: TreeNode, path: readonly string[]): number | undefined {
    const value = getPropertyPath(node.properties, path)?.value;
    return value instanceof Map ? undefined : tryToNumber(value);
}

// Curate an operator's rows: name, key metrics and index details on top, while
// the complete `statistics` block stays available as a group.
function enrichOperatorNode(rawNode: JsonObject, node: TreeNode): void {
    const properties = node.properties ?? new Map<string, PropertyEntry>();
    const statistics = isJsonObject(rawNode["statistics"]) ? rawNode["statistics"] : {};

    const setMetric = (key: string, value: unknown): void => {
        if (typeof value === "number" && Number.isFinite(value)) {
            properties.set(key, {value});
        }
    };

    // Identity: prefer the human-readable table or alias name over the raw dump,
    // which it then replaces. (`sqlpos` is kept: it is listed and also links to the SQL text.)
    const tableOrAlias = tryGetPropertyPath(rawNode, ["debug-name", "value"]);
    if (typeof tableOrAlias === "string") {
        properties.set("table-or-alias", {value: tableOrAlias});
        properties.delete("debug-name");
    }

    // Resource metrics, copied out of `statistics`. Row counts are surfaced
    // once the whole plan is converted (see `hyperRows`).
    setMetric("memory-bytes", statistics["memory-bytes"]);
    setMetric("cpu-cycles", statistics["cpu-cycles"]);
    setMetric("execution-time", statistics["execution-time"]);

    // Show the index-recommendation candidate only when the recommender actually suggests it.
    const recommended = ["statistics", "analyze"].some(
        (block) => tryGetPropertyPath(rawNode, [block, "index-recommender", "should-recommend-candidate"]) === true,
    );
    // Report only which index a scan used, noting a covering scan; the rest of `used-index` is not shown.
    for (const key of ["used-index", "usedIndex"]) {
        const name = tryGetPropertyPath(rawNode, [key, "name"]);
        const covered = tryGetPropertyPath(rawNode, [key, "covered"]) === true;
        properties.delete(key);
        if (typeof name === "string") {
            properties.set(`${key}.name`, {
                value: covered ? `${name} (Covered)` : name,
                informational: true,
            });
        }
    }

    for (const key of ["index-recommendation-candidate", "indexRecommendationCandidate"]) {
        const candidate = properties.get(key);
        if (candidate === undefined) continue;
        if (recommended) {
            // Kept whole, as a green group that starts expanded.
            candidate.recommended = true;
        } else {
            properties.delete(key);
        }
    }

    // Table metadata for lakehouse scans, complete, with the identifying keys first.
    const tableMetadata = rawNode["table-metadata"];
    if (isJsonObject(tableMetadata)) {
        const group = jsonToPropertyEntry(tableMetadata).value as Map<string, PropertyEntry>;
        properties.set("table-metadata", {value: reorderProperties(group, ["identifier", "partitioned-by", "sort-order"])});
    }
    node.properties = properties;
}

const hyperConfig: DecoratedJsonTreeConfig = {
    nodeTypeKeys: ["operator", "expression"],
    structuralChildKeys: ["inputs", "input", "left", "right", "value", "value-for-comparison"],
    // Shown as property groups rather than child nodes. `enrichOperatorNode`
    // then curates the index and table-metadata groups.
    alwaysPropertyKeys: [
        "debug-name",
        "statistics",
        "sqlpos",
        "table-metadata",
        "used-index",
        "index-recommendation-candidate",
        "usedIndex",
        "indexRecommendationCandidate",
    ],
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
    getDisplayName(rawNode) {
        const debugName = tryGetPropertyPath(rawNode, ["debug-name", "value"]);
        const name = hasOwnProperty(rawNode, "name") ? tryToString(rawNode["name"]) : undefined;
        return typeof debugName === "string" ? debugName : name;
    },
    getSourceLocations(rawNode, context) {
        const sqlPositions = rawNode["sqlpos"];
        const sqlSource = context.sqlSource;
        if (!Array.isArray(sqlPositions) || sqlSource === undefined) return undefined;
        const locations = sqlPositions.flatMap((range) => {
            if (!Array.isArray(range) || range.length !== 2) return [];
            const [from, to] = range;
            if (typeof from !== "number" || typeof to !== "number") return [];
            const location = sqlSource.fromUtf8Bytes(from, to);
            return location === undefined ? [] : [location];
        });
        return locations.length === 0 ? undefined : locations;
    },
    shouldCollapseChild(rawNode, _key, child) {
        // Keep operator inputs visible (including arrays of operators), while collapsing auxiliary operator data.
        return !hasOwnProperty(rawNode, "operator") || !containsOperator(child);
    },
    shouldExpandCollapsedChildren(_rawNode, nodeTypeKey) {
        // Expand expression details by default.
        return nodeTypeKey !== "operator";
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
    enrichNode(rawNode, node, nodeTypeKey) {
        if (nodeTypeKey === "operator") {
            enrichOperatorNode(rawNode, node);
        }
    },
};

// Highlight the cpu-cycles / pipeline-stats rows of hotspot operators, so the
// figure behind the node's heat color stands out.
function highlightHotspots(root: TreeNode): void {
    visitTreeNodes(
        root,
        (node) => {
            if (node.nodeColor === undefined) return;
            for (const key of ["cpu-cycles", "pipeline-stats"]) {
                const entry = node.properties?.get(key);
                if (entry !== undefined) entry.highlighted = true;
            }
            // Carried over when `surfaceRowAttributes` lifts it to the top level.
            const pipelineStats = node.properties?.get("pipeline-stats")?.value;
            const pipelineCycles = pipelineStats instanceof Map ? pipelineStats.get("cpu-cycles") : undefined;
            if (pipelineCycles !== undefined) pipelineCycles.highlighted = true;
        },
        allChildren,
    );
}

function applyLegacyOperatorStatistics(root: TreeNode): void {
    // TODO(2026-12-18): Remove operator-level CPU coloring after the pipeline-statistics compatibility window.
    const cpuCycles: {node: TreeNode; value: number}[] = [];
    visitTreeNodes(
        root,
        (node) => {
            const value = readStatistic(node, ["statistics", "cpu-cycles"]);
            if (value !== undefined) {
                cpuCycles.push({node, value});
            }
        },
        allChildren,
    );
    colorRelativeNumber(cpuCycles);
}

interface HyperPipeline extends ExecutionPipeline {
    driver?: TreeNode;
    statistics?: Json;
    running: boolean;
}

function parsePipelines(pipelinesJson: Json, operatorsById: Map<string, TreeNode>): HyperPipeline[] {
    if (!Array.isArray(pipelinesJson)) {
        return [];
    }
    const pipelines: HyperPipeline[] = [];
    for (const entry of pipelinesJson) {
        if (typeof entry !== "object" || Array.isArray(entry) || entry === null) continue;
        const id = entry["id"];
        const operators = entry["operators"];
        if (typeof id !== "number" || !Array.isArray(operators)) continue;
        const nodes = operators
            .filter((operatorId): operatorId is number => typeof operatorId === "number")
            .map((operatorId) => operatorsById.get(operatorId.toString()))
            .filter((node) => node !== undefined);
        const driverId = operators[operators.length - 1];
        const driver = typeof driverId === "number" ? operatorsById.get(driverId.toString()) : undefined;
        const statistics = tryGetPropertyPath(entry, ["statistics"]);
        const running = tryGetPropertyPath(entry, ["statistics", "running"]);
        pipelines.push({
            id,
            nodes,
            driver,
            statistics,
            running: running === true,
        });
    }
    return pipelines;
}

function applyPipelineStatistics(pipelines: HyperPipeline[], metadata: Map<string, PropertyEntry>): void {
    const cpuCycles: {node: TreeNode; value: number}[] = [];
    for (const pipeline of pipelines) {
        if (pipeline.driver !== undefined && pipeline.statistics !== undefined) {
            const properties = pipeline.driver.properties ?? new Map<string, PropertyEntry>();
            properties.set("pipeline-stats", jsonToPropertyEntry(pipeline.statistics));
            pipeline.driver.properties = properties;
            const value = tryGetPropertyPath(pipeline.statistics, ["cpu-cycles"]);
            if (typeof value === "number") {
                cpuCycles.push({node: pipeline.driver, value});
            }
        }
        for (const node of pipeline.nodes) {
            if (metadata.has("Error") && pipeline.running) {
                node.iconColor = "red";
            }
        }
    }
    colorRelativeNumber(cpuCycles);
}

// Surface, format and order each operator's statistics rows.
function curateStatisticsRows(root: TreeNode): void {
    surfaceRowAttributes(root, hyperRows);
    applyNumberFormats(root);
    visitTreeNodes(
        root,
        (node) => {
            if (node.properties !== undefined) node.properties = reorderProperties(node.properties, operatorRowOrder);
        },
        allChildren,
    );
}

function convertHyperPlan(node: Json, context: PlanLoadContext, pipelines?: Json): TreeDescription {
    const state = createDecoratedJsonTreeState();
    const errorMessage = tryGetPropertyPath(node, ["statistics", "error", "message", "original"]);
    if (errorMessage) {
        state.metadata.set("Error", jsonToPropertyEntry(errorMessage));
    }

    const root = convertDecoratedJsonNode(node, "result", state, hyperConfig, context);
    setRelativeEdgeWidths(state.edgeWidths);
    const operatorsById = buildIdMap(root, "operator-id");
    const crosslinks = resolveCrosslinks(state.crosslinks, operatorsById);
    if (pipelines !== undefined) {
        const parsedPipelines = parsePipelines(pipelines, operatorsById);
        applyPipelineStatistics(parsedPipelines, state.metadata);
        assignPipelineColors(root, parsedPipelines, crosslinks);
    } else {
        applyLegacyOperatorStatistics(root);
    }
    highlightHotspots(root);
    curateStatisticsRows(root);
    return {root, crosslinks, metadata: state.metadata, metadataHighlighted: state.metadata.has("Error") || undefined};
}

function extraProperties(object: JsonObject, excludedKeys: readonly string[]): Map<string, PropertyEntry> | undefined {
    const entries = Object.keys(object)
        .filter((key) => !excludedKeys.includes(key))
        .sort()
        .map((key) => [key, jsonToPropertyEntry(object[key])] as const);
    return entries.length === 0 ? undefined : new Map(entries);
}

function isHyperPlanRoot(json: Json): json is JsonObject {
    return (
        typeof json === "object" &&
        !Array.isArray(json) &&
        json !== null &&
        (typeof json["operator"] === "string" || typeof json["expression"] === "string")
    );
}

function convertOptimizerSteps(node: Json, context: PlanLoadContext): TreeDescription | undefined {
    if (!isJsonObject(node)) return undefined;
    if (!hasOwnProperty(node, "optimizersteps")) return undefined;
    const steps = node["optimizersteps"];
    if (!Array.isArray(steps)) return undefined;

    const crosslinks: Crosslink[] = [];
    const children: TreeNode[] = [];
    const metadata = new Map<string, PropertyEntry>();
    let metadataHighlighted = false;
    for (const step of steps) {
        if (typeof step !== "object" || Array.isArray(step) || step === null) return undefined;
        if (!hasOwnProperty(step, "name")) return undefined;
        if (!hasOwnProperty(step, "plan")) return undefined;
        const name = step["name"];
        const plan = step["plan"];
        if (typeof name !== "string") return undefined;

        const {
            root: childRoot,
            crosslinks: newCrosslinks,
            metadata: newProperties,
            metadataHighlighted: childMetadataHighlighted,
        } = convertHyperPlan(plan, context);
        crosslinks.push(...(newCrosslinks ?? []));
        metadataHighlighted ||= childMetadataHighlighted ?? false;
        children.push({name, properties: extraProperties(step, ["name", "plan"]), children: [childRoot]});
        for (const property of newProperties ?? new Map<string, PropertyEntry>()) {
            metadata.set(property[0], property[1]);
        }
    }
    return {
        root: {name: "optimizersteps", properties: extraProperties(node, ["optimizersteps"]), children},
        crosslinks,
        metadata,
        metadataHighlighted: metadataHighlighted || undefined,
    };
}

function isOptimizerStepsPlan(node: Json): boolean {
    if (typeof node !== "object" || Array.isArray(node) || node === null) return false;
    if (!hasOwnProperty(node, "optimizersteps")) return false;
    const steps = node["optimizersteps"];
    if (!Array.isArray(steps)) return false;
    return steps.every(
        (step) =>
            typeof step === "object" &&
            !Array.isArray(step) &&
            step !== null &&
            hasOwnProperty(step, "name") &&
            hasOwnProperty(step, "plan") &&
            typeof step["name"] === "string" &&
            isHyperPlanRoot(step["plan"]),
    );
}

// Detect the `{tree, pipelines}` envelope emitted for fully optimized JSON-like plans.
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

function isHyperPlan(json: Json): boolean {
    if (hasPipelineEnvelope(json)) {
        return isHyperPlanRoot(json["tree"]);
    }
    // TODO(2026-12-18): Require the {tree, pipelines} envelope and stop auto-detecting pre-2026-09-18 direct-root plans.
    return isOptimizerStepsPlan(json) || isHyperPlanRoot(json);
}

function loadHyperPlan(json: Json, context: PlanLoadContext): TreeDescription {
    if (hasPipelineEnvelope(json)) {
        return convertHyperPlan(json["tree"], context, json["pipelines"]);
    }
    // TODO(2026-12-18): Require the {tree, pipelines} envelope and stop loading pre-2026-09-18 direct-root plans.
    return convertOptimizerSteps(json, context) ?? convertHyperPlan(json, context);
}

export const hyperPlanLoader: JsonPlanLoader = {
    format: "hyper",
    sourcePropertyKeys: new Set(hyperConfig.nodeTypeKeys),
    matches: isHyperPlan,
    load: loadHyperPlan,
};
