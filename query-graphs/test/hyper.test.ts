import assert from "node:assert/strict";
import test from "node:test";
import {loadPlanFromText} from "../src/loaders";
import {fixturePathsFor, loadFixture} from "./loader-test-utils";

test("Hyper examples are recognized", () => {
    for (const fixturePath of fixturePathsFor("hyper")) {
        assert.equal(loadFixture(fixturePath).format, "hyper", fixturePath);
    }
    assert.equal(loadPlanFromText('{"plan":{"operator":"scan"}}').format, "hyper");
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
    assert.equal(
        sort?.properties?.get("pipeline-stats"),
        '{"cpu-cycles":100,"query-metrics":{"wall-clock":0.25,"custom":7},"running":true}',
    );
    assert.equal(scan?.properties?.get("pipeline-stats"), '{"cpu-cycles":25,"query-metrics":{"wall-clock":0.1},"running":false}');
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
    assert.equal(loaded.tree.root.properties?.get("version"), "2");
    assert.equal(loaded.tree.root.children?.[0].properties?.get("cost"), "42");
    assert.equal(loaded.tree.root.children?.[0].children?.[0].name, "scan");
});
