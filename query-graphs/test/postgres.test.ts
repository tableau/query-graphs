import assert from "node:assert/strict";
import test from "node:test";
import {loadPlanFromText} from "../src/loaders";
import {fixturePathsFor, loadFixture} from "./loader-test-utils";

test("Postgres examples are recognized", () => {
    for (const fixturePath of fixturePathsFor("postgres")) {
        assert.equal(loadFixture(fixturePath).format, "postgres", fixturePath);
    }
});

test("Postgres preserves plan input order and decorates scans", () => {
    const tree = loadPlanFromText(
        JSON.stringify({
            Plan: {
                "Node Type": "Append",
                Plans: [
                    {"Node Type": "Seq Scan", "Relation Name": "left_table"},
                    {"Node Type": "Index Scan", "Index Name": "right_index"},
                ],
            },
        }),
        {format: "postgres"},
    ).tree;

    assert.deepEqual(
        tree.root.children?.[0].children?.map(({name, icon}) => ({name, icon})),
        [
            {name: "left_table (Seq Scan)", icon: "table-symbol"},
            {name: "right_index (Index Scan)", icon: "table-symbol"},
        ],
    );
});

test("Postgres collapses auxiliary arrays", () => {
    const tree = loadPlanFromText('{"Plan":{"Node Type":"Seq Scan","Workers":[{"Number":0}]}}', {
        format: "postgres",
    }).tree;
    const workers = tree.root.children?.[0].collapsedChildren?.[0];

    assert.equal(workers?.name, "Workers");
    assert.equal(workers?.children, undefined);
    assert.deepEqual(
        workers?.collapsedChildren?.map((node) => node.name),
        ["Workers.0"],
    );
});

test("Postgres decorates cardinalities and CTE crosslinks", () => {
    const tree = loadPlanFromText(
        JSON.stringify({
            Plan: {
                "Node Type": "Append",
                Plans: [
                    {"Node Type": "Aggregate", "Subplan Name": "CTE cte", "Plan Rows": 1, "Actual Rows": 100},
                    {"Node Type": "CTE Scan", "CTE Name": "cte"},
                ],
            },
        }),
        {format: "postgres"},
    ).tree;
    const append = tree.root.children?.[0];
    const aggregate = append?.children?.[0];
    const cteScan = append?.children?.[1];

    assert.equal(aggregate?.edgeLabel, "100/1");
    assert.equal(aggregate?.edgeClass, "qg-label-highlighted");
    assert.deepEqual(tree.crosslinks, [{source: cteScan, target: aggregate}]);
});

test("Postgres computes relative execution time", () => {
    const tree = loadPlanFromText('{"Plan":{"Node Type":"Seq Scan","Actual Total Time":4,"Actual Loops":1},"Execution Time":5}', {
        format: "postgres",
    }).tree;
    const scan = tree.root.children?.[0];

    assert.equal(scan?.properties?.get("~Relative Time"), "4.000");
    assert.equal(scan?.properties?.get("~Relative Time Ratio"), "0.800");
    assert.notEqual(scan?.nodeColor, undefined);
});

test("Postgres keeps semantic rendering when execution metrics are incomplete", () => {
    const missingWorkers = loadPlanFromText('{"Plan":{"Node Type":"Gather","Actual Total Time":1,"Actual Loops":1,"Plans":[]}}');
    assert.equal(missingWorkers.format, "postgres");
    assert.equal(missingWorkers.tree.root.children?.[0].properties?.get("~Relative Time"), undefined);

    const missingLoops = loadPlanFromText('{"Plan":{"Node Type":"Result","Actual Total Time":1,"Plans":[]}}');
    assert.equal(missingLoops.format, "postgres");
    assert.equal(missingLoops.tree.root.children?.[0].properties?.get("~Relative Time"), undefined);

    const missingChildTime = loadPlanFromText(
        '{"Plan":{"Node Type":"Nested Loop","Actual Total Time":1,"Actual Loops":1,"Plans":[{"Node Type":"Seq Scan"}]}}',
    );
    assert.equal(missingChildTime.format, "postgres");
    assert.equal(missingChildTime.tree.root.children?.[0].properties?.get("~Relative Time"), undefined);
});

test("the Postgres loader remains permissive when explicitly selected", () => {
    const forced = loadPlanFromText('{"Plan":{}}', {format: "postgres"});
    assert.equal(forced.format, "postgres");
    assert.equal(forced.tree.root.name, "result");
});
