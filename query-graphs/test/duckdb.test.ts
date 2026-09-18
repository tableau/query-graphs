import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";
import test from "node:test";
import {InvalidPlanError, loadPlanFromText} from "../src/loaders";
import {duckDbPlanLoader} from "../src/loaders/duckdb";
import type {TreeNode} from "../src/tree-description";
import {allChildren, visitTreeNodes} from "../src/tree-description";
import {examplesRoot, fixturePathsFor, loadFixture} from "./loader-test-utils";

function treeNodes(root: TreeNode): TreeNode[] {
    const nodes: TreeNode[] = [];
    visitTreeNodes(root, (node) => nodes.push(node), allChildren);
    return nodes;
}

function delimiterJoin(id: string, scanCount: number) {
    return {
        name: "LEFT_DELIM_JOIN",
        extra_info: {"Delim Index": id},
        children: [
            {
                name: "PROJECTION",
                extra_info: {},
                children: Array.from({length: scanCount}, () => ({
                    name: "DELIM_SCAN",
                    extra_info: {"Delim Index": id},
                    children: [],
                })),
            },
        ],
    };
}

test("DuckDB examples are recognized", () => {
    for (const fixturePath of fixturePathsFor("duckdb")) {
        const loaded = loadFixture(fixturePath);
        assert.equal(loaded.format, "duckdb", fixturePath);
        assert.notEqual(loaded.tree.root.name, "", fixturePath);
    }
});

test("DuckDB analyzed plans preserve metrics, metadata, and CTE crosslinks", () => {
    const analyzedScan = loadFixture("duckdb/tablescan-analyze.plan.json").tree;
    assert.equal(analyzedScan.root.name, '"temp".main.region (seq_scan)');
    assert.equal(analyzedScan.root.properties?.get("Table"), '"temp".main.region');
    assert.equal(analyzedScan.root.edgeLabel, "5/5");
    assert.notEqual(analyzedScan.root.nodeColor, undefined);
    assert.match(analyzedScan.metadata?.get("query_name") ?? "", /SELECT r_name FROM region/);

    const cte = loadFixture("duckdb/cte-analyze.plan.json").tree;
    assert.deepEqual(
        cte.crosslinks?.map(({source, target}) => [source.name, target.name]),
        [
            ["cte_scan", "cte"],
            ["cte_scan", "cte"],
        ],
    );

    const recursiveCte = loadFixture("duckdb/cte-recursive-analyze.plan.json").tree;
    assert.deepEqual(
        recursiveCte.crosslinks?.map(({source, target}) => [source.name, target.name]),
        [["rec_cte_scan", "rec_cte"]],
    );

    const actualOnly = treeNodes(loadFixture("duckdb/groupby-analyze.plan.json").tree.root).find(
        (node) => node.name === "perfect_hash_group_by",
    );
    assert.equal(actualOnly?.edgeLabel, "3/?");
});

test("DuckDB keeps CTE and delimiter crosslink identifiers separate within a plan", () => {
    const cte = {
        name: "CTE",
        extra_info: {"Table Index": "1"},
        children: [
            {name: "SEQ_SCAN", extra_info: {}, children: []},
            {name: "CTE_SCAN", extra_info: {"CTE Index": "1"}, children: []},
        ],
    };
    const tree = duckDbPlanLoader.load([
        {
            name: "UNION",
            extra_info: {},
            children: [delimiterJoin("1", 2), delimiterJoin("2", 1), cte],
        },
    ]);
    const [firstJoin, secondJoin, convertedCte] = tree.root.children ?? [];
    const [firstScan, secondScan] = firstJoin?.children?.[0].children ?? [];
    const [thirdScan] = secondJoin?.children?.[0].children ?? [];
    const cteScan = convertedCte?.children?.[1];

    assert.deepEqual(tree.crosslinks, [
        {source: firstScan, target: firstJoin},
        {source: secondScan, target: firstJoin},
        {source: thirdScan, target: secondJoin},
        {source: cteScan, target: convertedCte},
    ]);
});

test("DuckDB simple and optimizer-stage plans preserve plan structure", () => {
    const simplePlan = loadFixture("duckdb/tpch/tpch-q2.plan.json").tree;
    assert.equal(simplePlan.root.name, "top_n");
    assert.equal(simplePlan.root.icon, "sort-symbol");

    const optimizerStages = loadFixture("duckdb/tpch/tpch-q2-steps.plan.json").tree;
    assert.equal(optimizerStages.root.name, "optimizer stages");
    assert.equal(optimizerStages.root.children?.length, 3);
    assert.equal(optimizerStages.root.children?.[0].collapsedChildren?.[0].name, "limit");
});

test("DuckDB scopes delimiter indexes to individual optimizer stages", () => {
    const tree = duckDbPlanLoader.load({
        logical_plan: [delimiterJoin("1", 1)],
        logical_opt: [delimiterJoin("1", 1)],
        physical_plan: [delimiterJoin("1", 1)],
    });
    const expectedCrosslinks = (tree.root.children ?? []).map((stage) => {
        const root = stage.collapsedChildren?.[0];
        const source = root?.children?.[0].children?.[0];
        assert(root);
        assert(source);
        return {source, target: root};
    });

    assert.equal(expectedCrosslinks.length, 3);
    assert.deepEqual(tree.crosslinks, expectedCrosslinks);
});

test("DuckDB resolves analyzed delimiter targets from operator types", () => {
    const tree = duckDbPlanLoader.load({
        query_name: "select 1",
        children: [
            {
                operator_name: "LEFT_DELIM_JOIN",
                operator_type: "LEFT_DELIM_JOIN",
                extra_info: {"Delim Index": "1"},
                children: [
                    {
                        operator_name: "DELIM_SCAN",
                        operator_type: "DELIM_SCAN",
                        extra_info: {"Delim Index": "1"},
                        children: [],
                    },
                ],
            },
        ],
    });
    const source = tree.root.children?.[0];

    assert.deepEqual(tree.crosslinks, [{source, target: tree.root}]);
});

test("DuckDB lowercases only all-uppercase operator names", () => {
    const tree = duckDbPlanLoader.load([
        {
            name: "UNION",
            children: [
                {name: "CAPS_LOCK", children: []},
                {name: "CamelCase", children: []},
                {name: "Title Case", children: []},
            ],
        },
    ]);

    assert.deepEqual(
        tree.root.children?.map(({name}) => name),
        ["caps_lock", "CamelCase", "Title Case"],
    );
});

test("DuckDB rejects arrays containing multiple independent plans", () => {
    const plans = JSON.stringify([
        {name: "SEQ_SCAN", extra_info: {}, children: []},
        {name: "SEQ_SCAN", extra_info: {}, children: []},
    ]);

    assert.equal(loadPlanFromText(plans).format, "json");
    assert.throws(
        () => loadPlanFromText(plans, {format: "duckdb"}),
        (error: unknown) => error instanceof InvalidPlanError && error.format === "duckdb",
    );
});

test("the DuckDB loader degrades malformed child details", () => {
    const fixturePath = path.join(examplesRoot, "duckdb/tpch/tpch-q2.plan.json");
    const missingChildDetail = JSON.parse(readFileSync(fixturePath, "utf8"));
    delete missingChildDetail[0].children[0].extra_info;
    assert.equal(loadPlanFromText(JSON.stringify(missingChildDetail)).format, "duckdb");

    const analyzedPath = path.join(examplesRoot, "duckdb/tablescan-analyze.plan.json");
    const malformedAnalyze = JSON.parse(readFileSync(analyzedPath, "utf8"));
    malformedAnalyze.children[0].children[0] = 7;
    const degradedAnalyze = loadPlanFromText(JSON.stringify(malformedAnalyze));
    assert.equal(degradedAnalyze.format, "duckdb");
    assert.equal(degradedAnalyze.tree.root.name, "7");
});

test("the DuckDB loader accepts forced plans and optional profile fields", () => {
    const forced = loadPlanFromText('[{"name":"SEQ_SCAN","children":[]}]', {format: "duckdb"});
    assert.equal(forced.tree.root.name, "seq_scan");

    const analyzedPath = path.join(examplesRoot, "duckdb/tablescan-analyze.plan.json");
    const malformedAnalyze = JSON.parse(readFileSync(analyzedPath, "utf8"));
    delete malformedAnalyze.latency;
    const degradedAnalyze = loadPlanFromText(JSON.stringify(malformedAnalyze));
    assert.equal(degradedAnalyze.format, "duckdb");
    assert.equal(degradedAnalyze.tree.root.name, '"temp".main.region (seq_scan)');

    const futureMetadata = loadPlanFromText(
        JSON.stringify({
            query_name: "select 1",
            future_metadata: {version: 1},
            children: [{operator_name: "DUMMY_SCAN", operator_type: "DUMMY_SCAN", extra_info: {}, children: []}],
        }),
    ).tree.metadata;
    assert.equal(futureMetadata?.get("future_metadata"), '{"version":1}');
});

test("DuckDB recognition does not claim generic child trees", () => {
    const minimalProfile = JSON.stringify({
        query_name: "select 1",
        children: [
            {
                operator_type: "EXPLAIN_ANALYZE",
                children: [{operator_type: "DUMMY_SCAN", children: []}],
            },
        ],
    });
    const loadedProfile = loadPlanFromText(minimalProfile);
    assert.equal(loadedProfile.format, "duckdb");
    assert.equal(loadedProfile.tree.root.name, "dummy_scan");
    assert.equal(loadedProfile.tree.root.icon, "const-table-symbol");

    const genericTree = '{"query_name":"My saved search","children":[{"name":"Alice","children":[]}]}';
    assert.equal(loadPlanFromText(genericTree).format, "json");
    assert.equal(loadPlanFromText('{"query_name":"anything","children":[42]}').format, "json");
});
