import assert from "node:assert/strict";
import test from "node:test";
import {loadPlanFromText} from "../src/loaders";
import {umbraPlanLoader} from "../src/loaders/umbra";
import {allChildren, visitTreeNodes, type TreeNode} from "../src/tree-description";
import {fixturePathsFor, loadFixture} from "./loader-test-utils";

function treeNodes(root: TreeNode): TreeNode[] {
    const nodes: TreeNode[] = [];
    visitTreeNodes(root, (node) => nodes.push(node), allChildren);
    return nodes;
}

test("Umbra and CedarDB examples are recognized", () => {
    for (const engine of ["umbra", "cedardb"]) {
        for (const fixturePath of fixturePathsFor(engine)) {
            assert.equal(loadFixture(fixturePath).format, "umbra", fixturePath);
        }
    }
});

test("Umbra decorates cardinalities, pipelines, and recursive crosslinks", () => {
    const recursiveCte = loadFixture("umbra/cte-recursive-analyze.plan.json").tree;
    assert.equal(recursiveCte.crosslinks?.length, 1);
    assert.ok(treeNodes(recursiveCte.root).some((node) => node.name === "iterationincrementscan"));

    const analyzedScan = loadFixture("umbra/tablescan-analyze.plan.json").tree;
    const plan = analyzedScan.root.children?.[0];
    assert.equal(analyzedScan.root.name, "select");
    assert.equal(analyzedScan.root.properties?.get("query"), "true");
    assert.equal(plan?.name, "region");
    assert.notEqual(plan?.iconColor, undefined);
    assert.equal(plan?.edgeLabel, "5/5");
    assert.ok(treeNodes(analyzedScan.root).some((node) => node.name === "analyzePlanPipelines"));
});

test("Umbra keeps operator and pipeline identifier namespaces separate", () => {
    const tree = umbraPlanLoader.load({
        plan: {
            operator: "temp",
            operatorId: 1,
            analyzePlanId: 7,
            input: {
                operator: "pipelinebreakerscan",
                operatorId: 2,
                analyzePlanId: 1,
                scannedOperator: 1,
            },
        },
        analyzePlanPipelines: [{operators: [1]}],
    });
    const plan = tree.root.children?.[0];
    const input = plan?.children?.[0];

    assert.equal(tree.root.iconColor, undefined);
    assert.notEqual(input?.iconColor, undefined);
    assert.deepEqual(tree.crosslinks, [{source: input, target: plan}]);
});

test("Umbra combines repeated records for the same pipeline", () => {
    const tree = umbraPlanLoader.load({
        plan: {
            operator: "setoperation",
            operatorId: 1,
            analyzePlanId: 0,
            arguments: [
                {operator: "tablescan", operatorId: 2, analyzePlanId: 1},
                {operator: "tablescan", operatorId: 3, analyzePlanId: 2},
            ],
        },
        analyzePlanPipelines: [
            // A set operation can report the same pipeline once for each input fragment.
            {pipelineId: 4, operators: [0, 1]},
            {pipelineId: 4, operators: [0, 2]},
        ],
    });
    const colors = treeNodes(tree.root).flatMap((node) => (node.iconColor === undefined ? [] : [node.iconColor]));

    assert.equal(new Set(colors).size, 1);
});

test("Umbra normalizes exclusive pipeline memberships at operator boundaries", () => {
    const tree = umbraPlanLoader.load({
        plan: {
            operator: "sort",
            operatorId: 1,
            analyzePlanId: 0,
            input: {operator: "tablescan", operatorId: 2, analyzePlanId: 1},
        },
        analyzePlanPipelines: [
            {pipelineId: 6, operators: [0]},
            {pipelineId: 5, operators: [1]},
        ],
    });
    const sort = tree.root.children?.[0];
    const scan = sort?.children?.[0];
    assert.ok(sort);
    assert.ok(scan);

    assert.deepEqual(tree.root.barsBelow, [sort.iconColor]);
    assert.deepEqual(sort.barsAbove, [sort.iconColor]);
    assert.deepEqual(sort.barsBelow, [scan.iconColor]);
    assert.deepEqual(scan.barsAbove, [scan.iconColor]);
});

test("Umbra normalizes exclusive pipeline memberships across crosslinks", () => {
    const tree = umbraPlanLoader.load({
        plan: {
            operator: "setoperation",
            operatorId: 1,
            analyzePlanId: 0,
            arguments: [
                {operator: "temp", operatorId: 2, analyzePlanId: 1},
                {operator: "pipelinebreakerscan", operatorId: 3, analyzePlanId: 2, scannedOperator: 2},
            ],
        },
        analyzePlanPipelines: [
            {pipelineId: 0, operators: [0]},
            {pipelineId: 1, operators: [1]},
            {pipelineId: 2, operators: [2]},
        ],
    });
    const crosslink = tree.crosslinks?.[0];
    assert.ok(crosslink);

    assert.deepEqual(crosslink.source.barsBelow, [crosslink.target.iconColor]);
});

test("Umbra applies format-specific names and icons", () => {
    const tableScan = loadFixture("umbra/tablescan-analyze.plan.json").tree;
    assert.equal(tableScan.root.children?.[0].name, "region");
    assert.equal(tableScan.root.children?.[0].icon, "table-symbol");

    const markJoin = loadFixture("umbra/markjoin-analyze.plan.json").tree;
    assert.equal(markJoin.root.children?.[0].name, "leftmark");
    assert.equal(markJoin.root.children?.[0].icon, undefined);
});

test("Umbra keeps source locations in properties instead of graph subtrees", () => {
    const tree = umbraPlanLoader.load({
        plan: {
            operator: "tablescan",
            operatorId: 1,
            sourceLocation: {startLine: 1, startColumn: 2, endLine: 1, endColumn: 7},
            restriction: {
                expression: "const",
                id: 2,
                sourceLocation: {startLine: 1, startColumn: 8, endLine: 1, endColumn: 9},
            },
        },
        ius: [
            {
                iu: "value",
                type: {type: "integer"},
                sourceLocation: {startLine: 1, startColumn: 10, endLine: 1, endColumn: 15},
            },
        ],
    });
    const nodes = treeNodes(tree.root);
    const operator = nodes.find((node) => node.properties?.get("operatorId") === "1");
    const expression = nodes.find((node) => node.properties?.get("id") === "2");
    const iu = nodes.find((node) => node.properties?.get("iu") === "value");

    assert.equal(operator?.properties?.get("sourceLocation"), '{"startLine":1,"startColumn":2,"endLine":1,"endColumn":7}');
    assert.equal(expression?.properties?.get("sourceLocation"), '{"startLine":1,"startColumn":8,"endLine":1,"endColumn":9}');
    assert.equal(iu?.properties?.get("sourceLocation"), '{"startLine":1,"startColumn":10,"endLine":1,"endColumn":15}');
    assert.ok(!treeNodes(tree.root).some((node) => node.name === "sourceLocation"));
});

test("CedarDB optimizer stages are collapsed independently", () => {
    const tree = loadFixture("cedardb/tpch/tpch-q2-steps.plan.json").tree;
    assert.equal(tree.root.name, "optimizer steps");
    assert.equal(tree.root.children?.length, 10);
    assert.equal(tree.root.children?.[0].children, undefined);
    assert.equal(tree.root.children?.[0].collapsedChildren?.length, 1);
});

test("Umbra omits crosslinks that duplicate tree edges", () => {
    // A pipeline-breaker scan can contain its producer as a `pipelineBreaker` child and also reference the
    // same operator through `scannedOperator`. Keep the crosslink only when the referenced producer is elsewhere.
    for (const engine of ["umbra", "cedardb"]) {
        for (const fixturePath of fixturePathsFor(engine)) {
            for (const crosslink of loadFixture(fixturePath).tree.crosslinks ?? []) {
                assert.ok(!allChildren(crosslink.source).includes(crosslink.target), fixturePath);
            }
        }
    }
});

test("the Umbra loader remains permissive when explicitly selected", () => {
    const malformed = {plan: {operator: {}, operatorId: "unknown"}};

    assert.equal(umbraPlanLoader.matches(malformed), false);
    assert.equal(umbraPlanLoader.load(malformed).root.name, "result");
    assert.equal(loadPlanFromText(JSON.stringify(malformed)).format, "json");
});
