import assert from "node:assert/strict";
import test from "node:test";
import {loadPlanFromText} from "../src/loaders";
import {fixturePathsFor, loadFixture} from "./loader-test-utils";

test("Hyper examples are recognized", () => {
    for (const fixturePath of fixturePathsFor("hyper")) {
        assert.equal(loadFixture(fixturePath).format, "hyper", fixturePath);
    }
});

test("Hyper applies rendering, ordering, metrics, errors, and crosslinks", () => {
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
                running: true,
                error: {message: {original: "query failed"}},
            },
        }),
        {format: "hyper"},
    ).tree;
    const [left, right] = tree.root.children ?? [];
    const details = tree.root.collapsedChildren?.[0];

    assert.equal(tree.root.name, "left-outer");
    assert.equal(tree.root.icon, "left-join-symbol");
    assert.equal(tree.root.iconColor, "red");
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
    assert.equal(tree.metadata?.get("Error"), "query failed");
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

test("the Hyper loader remains permissive when explicitly selected", () => {
    assert.equal(loadPlanFromText('{"operator":{}}', {format: "hyper"}).format, "hyper");
    assert.equal(loadPlanFromText('[{"operator":"scan"}]', {format: "hyper"}).tree.root.name, "result");
});
