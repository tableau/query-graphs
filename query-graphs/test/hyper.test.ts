import assert from "node:assert/strict";
import test from "node:test";
import {loadPlanFromText} from "../src/loaders";
import {fixturePathsFor, loadFixture, propValue} from "./loader-test-utils";

test("Hyper examples are recognized", () => {
    for (const fixturePath of fixturePathsFor("hyper")) {
        assert.equal(loadFixture(fixturePath).format, "hyper", fixturePath);
    }
});

test("Hyper error examples highlight their metadata", () => {
    const tree = loadFixture("hyper/tpch-q11-error-analyze.plan.json").tree;
    assert.equal(tree.metadata?.get("Error"), "division by zero");
    assert.equal(tree.metadataHighlighted, true);
});

test("Hyper applies rendering, ordering, metrics, and crosslinks", () => {
    const tree = loadPlanFromText(
        JSON.stringify({
            operator: "join",
            type: "left-outer",
            "operator-id": 1,
            magic: 2,
            left: {operator: "scan", type: "virtual-table", "operator-id": 2},
            right: {operator: "filter", "operator-id": 3},
            details: [{value: 42}],
            statistics: {
                "cpu-cycles": 100,
                "estimated-rows": 1,
                "output-rows": 100,
            },
        }),
        {format: "hyper"},
    ).tree;
    const [left, right] = tree.root.children ?? [];
    const details = tree.root.collapsedChildren?.[0];

    assert.equal(tree.root.name, "left-outer");
    assert.equal(tree.root.properties?.get("operator"), "join");
    assert.equal(left?.properties?.get("operator"), "scan");
    assert.equal(left?.properties?.get("type"), "virtual-table");
    assert.equal(tree.root.icon, "left-join-symbol");
    assert.equal(tree.root.nodeColor, "hsl(309, 84%, 72.000%)");
    assert.equal(tree.root.edgeLabel, "100/1");
    assert.equal(tree.root.edgeClass, "qg-label-highlighted");
    assert.deepEqual(
        [left, right].map((node) => node?.name),
        ["virtual-table", "filter"],
    );
    assert.equal(details?.name, "details");
    assert.equal(details?.children, undefined);
    assert.equal(details?.collapsedChildren?.[0].name, "details.0");
    assert.deepEqual(tree.crosslinks, [{source: tree.root, target: left}]);
    // The raw statistics group follows the scalar rows.
    assert.equal([...(tree.root.properties?.keys() ?? [])].at(-1), "statistics");
});

test("Hyper lists every property group after the scalar rows", () => {
    const tree = loadPlanFromText(
        JSON.stringify({
            operator: "tablescan",
            "operator-id": 1,
            "table-metadata": {identifier: "db.t", "sort-order": ["a"]},
            statistics: {"output-rows": 5},
        }),
        {format: "hyper"},
    ).tree;
    const properties = tree.root.properties;

    const groups = [...(properties ?? [])].filter(([, entry]) => typeof entry.value !== "string").map(([key]) => key);
    assert.deepEqual([...(properties?.keys() ?? [])].slice(-groups.length), groups);
    assert.ok(groups.includes("statistics") && groups.includes("table-metadata"));
});

test("Hyper leaves edges between disjoint pipeline memberships uncolored", () => {
    const tree = loadPlanFromText(
        JSON.stringify({
            tree: {
                operator: "explicit-scan",
                "operator-id": 1,
                input: {operator: "share", "operator-id": 2},
            },
            pipelines: [
                {id: 1, operators: [1]},
                {id: 2, operators: [2]},
            ],
        }),
        {format: "hyper"},
    ).tree;
    const producer = tree.root.children?.[0];

    assert.equal(tree.root.barsBelow, undefined);
    assert.equal(producer?.barsAbove, undefined);
    assert.equal(producer?.edgeColors, undefined);
});

test("Hyper applies pipeline-level runtime statistics to the pipeline driver", () => {
    const analyzedScan = loadFixture("hyper/tablescan-analyze.plan.json").tree;
    assert.equal(analyzedScan.root.name, "result-sink");
    assert.equal(analyzedScan.root.icon, "run-query-symbol");

    const failedPlan = loadPlanFromText(
        JSON.stringify({
            tree: {
                operator: "result-sink",
                "operator-id": 1,
                inputs: [
                    {
                        operator: "sort",
                        "operator-id": 2,
                        input: {operator: "scan", type: "native", "operator-id": 3},
                    },
                ],
                statistics: {error: {message: {original: "query failed"}}},
            },
            pipelines: [
                {
                    id: 3,
                    operators: [1, 2],
                    statistics: {
                        "cpu-cycles": 100,
                        "query-metrics": {"wall-clock": 0.25, custom: 7},
                        running: true,
                    },
                },
                {
                    id: 4,
                    operators: [3],
                    statistics: {"cpu-cycles": 25, "query-metrics": {"wall-clock": 0.1}, running: false},
                },
            ],
        }),
        {format: "hyper"},
    ).tree;
    const sort = failedPlan.root.children?.[0];
    const scan = sort?.children?.[0];
    assert.equal(failedPlan.metadata?.get("Error"), "query failed");
    assert.equal(failedPlan.metadataHighlighted, true);
    assert.equal(propValue(sort, "pipeline-stats", "cpu-cycles"), "100");
    assert.equal(propValue(sort, "pipeline-stats", "running"), "true");
    assert.equal(propValue(sort, "pipeline-stats", "query-metrics", "wall-clock"), "0.25");
    assert.equal(propValue(sort, "pipeline-stats", "query-metrics", "custom"), "7");
    assert.equal(propValue(scan, "pipeline-stats", "cpu-cycles"), "25");
    // The hotspot heat is echoed onto the driver's pipeline-stats row.
    assert.equal(sort?.properties?.get("pipeline-stats")?.highlighted, true);
    assert.equal(failedPlan.metadata?.has("Pipeline statistics"), false);
    assert.equal(failedPlan.root.iconColor, "red");
    assert.equal(sort?.iconColor, "red");
    assert.notEqual(scan?.iconColor, "red");
    assert.equal(failedPlan.root.nodeColor, undefined);
    assert.equal(sort?.nodeColor, "hsl(309, 84%, 76.600%)");
    assert.equal(scan?.nodeColor, "hsl(309, 84%, 90.400%)");
});

test("the Hyper loader remains permissive when explicitly selected", () => {
    assert.equal(loadPlanFromText('{"operator":{}}', {format: "hyper"}).format, "hyper");
    assert.equal(loadPlanFromText('[{"operator":"scan"}]', {format: "hyper"}).tree.root.name, "result");
});

test("Hyper optimizer steps preserve additional envelope fields", () => {
    const loaded = loadPlanFromText(
        JSON.stringify({
            optimizersteps: [{name: "initial", plan: {operator: "scan"}, cost: 42}],
            version: 2,
        }),
    );

    assert.equal(loaded.format, "hyper");
    assert.equal(propValue(loaded.tree.root, "version"), "2");
    assert.equal(propValue(loaded.tree.root.children?.[0], "cost"), "42");
    assert.equal(loaded.tree.root.children?.[0].children?.[0].name, "scan");
});

// Hyper positions are UTF-8 byte offsets, so preceding multibyte characters must not shift the UTF-16 editor ranges.
test("Hyper nodes link both SQL and JSON source ranges", () => {
    const sql = "EXPLAIN SELECT 'é😀', value FROM table";
    const valueStart = Buffer.byteLength("EXPLAIN SELECT 'é😀', ");
    const tableStart = Buffer.byteLength("EXPLAIN SELECT 'é😀', value FROM ");
    const loaded = loadPlanFromText(
        JSON.stringify({
            operator: "scan",
            sqlpos: [
                [valueStart, valueStart + Buffer.byteLength("value")],
                [tableStart, tableStart + Buffer.byteLength("table")],
                [valueStart + 1, valueStart + 0.5],
            ],
        }),
        {format: "hyper", sql},
    );
    const planText = loaded.tree.textDocuments?.find(({id}) => id === "plan")?.text ?? "";
    const keyFrom = planText.indexOf('"operator"');
    const valueFrom = planText.indexOf('"scan"');

    assert.deepEqual(loaded.tree.root.sourceLocations, [
        {documentId: "query", from: 22, to: 27},
        {documentId: "query", from: 33, to: 38},
        {documentId: "plan", from: keyFrom, to: valueFrom + '"scan"'.length},
    ]);
});

// A plan can be opened without its original query; raw offsets must not create links into a nonexistent document.
test("Hyper ignores SQL positions without matching SQL", () => {
    const tree = loadPlanFromText('{"operator":"scan","sqlpos":[[0,6]]}', {format: "hyper"}).tree;
    assert.deepEqual(
        tree.root.sourceLocations?.filter(({documentId}) => documentId === "query"),
        [],
    );
});

test("Hyper lists the raw SQL positions as a property group, offsets unabbreviated", () => {
    const root = loadPlanFromText('{"operator":"scan","sqlpos":[[1234,12345]]}', {format: "hyper"}).tree.root;
    assert.equal(propValue(root, "sqlpos", "0", "0"), "1234");
    assert.equal(propValue(root, "sqlpos", "0", "1"), "12345");
});

test("Hyper surfaces every index attribute as top-level rows", () => {
    const root = loadPlanFromText(
        JSON.stringify({
            operator: "tablescan",
            "available-indexes": 2,
            "used-index": {name: "Party_idx", covered: true},
            "index-recommendation-candidate": {column: "Party__c"},
            statistics: {"index-recommender": {"should-recommend-candidate": true}},
        }),
        {format: "hyper"},
    ).tree.root;

    assert.equal(propValue(root, "available-indexes"), "2");
    // Only the index name is reported, marked when the scan is covering.
    assert.equal(propValue(root, "used-index.name"), "Party_idx (Covered)");
    assert.equal(root.properties?.get("used-index.name")?.informational, true);
    assert.equal(root.properties?.has("used-index.covered"), false);
    assert.equal(root.properties?.has("used-index"), false);
    // The candidate is shown as one open, recommendation-colored group, not a flattened row.
    const candidate = root.properties?.get("index-recommendation-candidate");
    assert.equal(propValue(root, "index-recommendation-candidate", "column"), "Party__c");
    assert.equal(candidate?.recommended, true);
    assert.equal(candidate?.highlighted, undefined);
    assert.equal(root.properties?.has("index-recommendation-candidate.column"), false);
    // The recommender flag stays inside `statistics`, not repeated at the top level.
    assert.equal(root.properties?.has("index-recommender.should-recommend-candidate"), false);
    assert.equal(propValue(root, "statistics", "index-recommender", "should-recommend-candidate"), "true");
    // Index objects are tooltip properties, not collapsed child subtrees.
    assert.equal(root.collapsedChildren?.length ?? 0, 0);
});

test("Hyper reports a non-covering used index by name alone", () => {
    const root = loadPlanFromText(JSON.stringify({operator: "tablescan", "used-index": {name: "Party_idx", covered: false}}), {
        format: "hyper",
    }).tree.root;
    assert.equal(propValue(root, "used-index.name"), "Party_idx");
});

test("Hyper hides the index-recommendation candidate unless it is recommended", () => {
    const root = loadPlanFromText(
        JSON.stringify({
            operator: "tablescan",
            "index-recommendation-candidate": {column: "Party__c"},
            statistics: {"index-recommender": {"should-recommend-candidate": false}},
        }),
        {format: "hyper"},
    ).tree.root;

    assert.equal(root.properties?.has("index-recommendation-candidate"), false);
});

test("Hyper reports the complete table metadata, identifying keys first", () => {
    const root = loadPlanFromText(
        JSON.stringify({
            operator: "tablescan",
            "table-metadata": {format: "iceberg", "sort-order": ["a"], location: "s3://bucket/t", identifier: "db.t"},
        }),
        {format: "hyper"},
    ).tree.root;

    const group = root.properties?.get("table-metadata")?.value;
    assert.ok(group instanceof Map);
    // Identifying keys lead; nested groups (`sort-order`) trail the scalars, as everywhere.
    assert.deepEqual([...group.keys()], ["identifier", "format", "location", "sort-order"]);
    assert.equal(propValue(root, "table-metadata", "location"), "s3://bucket/t");
    // Listed once, as a property group, not also as a collapsed child subtree.
    assert.equal(root.collapsedChildren?.length ?? 0, 0);
});
