import assert from "node:assert/strict";
import test from "node:test";
import {
    trailPropertyGroups,
    formatCount,
    formatNumbers,
    isIndexAttribute,
    isRowAttribute,
    isSurfacedAttribute,
    surfaceRowAttributes,
} from "../src/loaders/loader-utils";
import type {PropertyEntry, TreeNode} from "../src/tree-description";

test("row attributes are recognized across naming styles", () => {
    for (const name of ["Plan Rows", "Actual Rows", "output-rows", "r_rows", "rows", "rows_returned", "outputRows"]) {
        assert.ok(isRowAttribute(name), name);
    }
    for (const name of ["rowstate", "rowsmode", "throws", "row_may_be_null", "operatorId"]) {
        assert.ok(!isRowAttribute(name), name);
    }
});

test("row attributes are surfaced, including ones nested in groups", () => {
    const statistics = new Map<string, PropertyEntry>([
        ["output-rows", {value: "42"}],
        ["memory-bytes", {value: "1024"}],
        ["scan-stats", {value: new Map([["rows-matching-restrictions", {value: "7"}]])}],
    ]);
    const node: TreeNode = {
        properties: new Map<string, PropertyEntry>([
            ["Plan Rows", {value: "10"}],
            ["operatorId", {value: "1"}],
            ["statistics", {value: statistics}],
        ]),
        children: [{properties: new Map([["details", {value: new Map([["r_rows", {value: "3"}]])}]])}],
    };

    surfaceRowAttributes(node);

    // The group stays complete; its row attributes are additionally shown at the top level.
    assert.equal(statistics.size, 3);
    assert.deepEqual(node.properties?.get("output-rows"), {value: "42"});
    assert.deepEqual(node.properties?.get("rows-matching-restrictions"), {value: "7"});
    assert.ok(!node.properties?.has("memory-bytes"));
    assert.deepEqual(node.children?.[0].properties?.get("r_rows"), {value: "3"});
    // Surfaced rows follow the last top-level row attribute, or lead when there is none.
    assert.deepEqual(
        [...(node.properties?.keys() ?? [])],
        ["Plan Rows", "output-rows", "rows-matching-restrictions", "operatorId", "statistics"],
    );
    assert.deepEqual([...(node.children?.[0].properties?.keys() ?? [])], ["r_rows", "details"]);
});

test("row counts use K/M/B/T suffixes", () => {
    const cases: [number, string][] = [
        [0, "0"],
        [57.5016, "57.5"],
        [0.4761234, "0.476"],
        [999.95, "1K"],
        [999, "999"],
        [1000, "1K"],
        [1234, "1.2K"],
        [123_456, "123K"],
        [999_950, "1M"],
        [5_000_000, "5M"],
        [2_345_678_901, "2.3B"],
        [7e12, "7T"],
    ];
    for (const [input, expected] of cases) assert.equal(formatCount(input), expected, String(input));
});

test("numeric row attributes are shown as compact counts, while groups keep exact figures", () => {
    const statistics = new Map<string, PropertyEntry>([["rows-matching-restrictions", {value: "2345678901"}]]);
    const node: TreeNode = {
        properties: new Map<string, PropertyEntry>([
            ["output-rows", {value: "5000000"}],
            ["produces-rows", {value: "true"}],
            ["statistics", {value: statistics}],
        ]),
    };

    surfaceRowAttributes(node);

    assert.equal(node.properties?.get("output-rows")?.value, "5M");
    assert.equal(node.properties?.get("produces-rows")?.value, "true");
    assert.equal(node.properties?.get("rows-matching-restrictions")?.value, "2.3B");
    assert.equal(statistics.get("rows-matching-restrictions")?.value, "2345678901");
});

test("every number in a group is formatted at any depth, and nothing is dropped", () => {
    const group = new Map<string, PropertyEntry>([
        ["cpu-cycles", {value: "2345678901"}],
        ["execution-time", {value: "0.4761234"}],
        ["column-count", {value: "3"}],
        ["name", {value: "lineitem"}],
        ["error", {value: "null"}],
        ["scan-stats", {value: new Map([["rows-matching-restrictions", {value: "5000000"}]])}],
    ]);

    formatNumbers(group);

    assert.deepEqual([...group.keys()], ["cpu-cycles", "execution-time", "column-count", "name", "error", "scan-stats"]);
    assert.equal(group.get("cpu-cycles")?.value, "2.3B");
    assert.equal(group.get("execution-time")?.value, "0.476");
    assert.equal(group.get("column-count")?.value, "3");
    assert.equal(group.get("name")?.value, "lineitem");
    assert.equal(group.get("error")?.value, "null");
    assert.equal((group.get("scan-stats")?.value as Map<string, PropertyEntry>).get("rows-matching-restrictions")?.value, "5M");
});

test("an existing top-level row attribute is not shadowed by a nested one of the same name", () => {
    const node: TreeNode = {
        properties: new Map<string, PropertyEntry>([
            ["output-rows", {value: "42K"}],
            ["statistics", {value: new Map([["output-rows", {value: "42000"}]])}],
        ]),
    };

    surfaceRowAttributes(node);

    assert.deepEqual(node.properties?.get("output-rows"), {value: "42K"});
    assert.deepEqual([...(node.properties?.keys() ?? [])], ["output-rows", "statistics"]);
});

test("every nested group is listed after the scalar rows, at any depth", () => {
    const inner = new Map<string, PropertyEntry>([
        ["deep", {value: new Map([["x", {value: "1"}]])}],
        ["leaf", {value: "2"}],
    ]);
    const node: TreeNode = {
        properties: new Map<string, PropertyEntry>([
            ["first", {value: new Map([["a", {value: "1"}]])}],
            ["name", {value: "scan"}],
            ["second", {value: inner}],
            ["id", {value: "7"}],
        ]),
    };

    trailPropertyGroups(node);

    assert.deepEqual([...(node.properties?.keys() ?? [])], ["name", "id", "first", "second"]);
    assert.deepEqual([...inner.keys()], ["leaf", "deep"]);
});

test("highlighted, recommended and informational groups lead, the rest are alphabetical, array indexes numerically", () => {
    const group = (flags: Partial<PropertyEntry> = {}): PropertyEntry => ({value: new Map([["x", {value: "1"}]]), ...flags});
    const indexed = new Map<string, PropertyEntry>([
        ["10", group()],
        ["2", group()],
        ["1", group()],
    ]);
    const node: TreeNode = {
        properties: new Map<string, PropertyEntry>([
            ["table-metadata", group()],
            ["statistics", group()],
            ["name", {value: "scan"}],
            ["pipeline-stats", group({highlighted: true})],
            ["index-recommendation-candidate", group({recommended: true})],
            ["used-index", group({informational: true})],
            ["details", {value: indexed}],
        ]),
    };

    trailPropertyGroups(node);

    assert.deepEqual(
        [...(node.properties?.keys() ?? [])],
        ["name", "index-recommendation-candidate", "pipeline-stats", "used-index", "details", "statistics", "table-metadata"],
    );
    assert.deepEqual([...indexed.keys()], ["1", "2", "10"]);
});

test("CPU cycles are surfaced like row attributes", () => {
    for (const name of ["cpu-cycles", "CPU Cycles", "cpuCycles", "output-rows"]) {
        assert.ok(isSurfacedAttribute(name), name);
    }
    assert.ok(!isSurfacedAttribute("cpu-time"));

    const stats = new Map<string, PropertyEntry>([["cpu-cycles", {value: "2345678901"}]]);
    const node: TreeNode = {
        properties: new Map<string, PropertyEntry>([
            ["output-rows", {value: "4"}],
            ["pipeline-stats", {value: stats}],
        ]),
    };

    surfaceRowAttributes(node);

    assert.deepEqual(node.properties?.get("cpu-cycles"), {value: "2.3B"});
    assert.deepEqual([...(node.properties?.keys() ?? [])], ["output-rows", "cpu-cycles", "pipeline-stats"]);
});

test("index attributes are recognized across naming styles", () => {
    for (const name of [
        "Index Name",
        "Index Cond",
        "used-index",
        "available-indexes",
        "usedIndex",
        "indexRecommendationCandidate",
    ]) {
        assert.ok(isIndexAttribute(name), name);
    }
    for (const name of ["reindexed", "operatorId", "Node Type", "Table Index", "CTE Index", "Delim Index"]) {
        assert.ok(!isIndexAttribute(name), name);
    }
});

test("nested index groups stay in their group instead of surfacing", () => {
    const node: TreeNode = {
        name: "scan",
        properties: new Map<string, PropertyEntry>([
            [
                "statistics",
                {value: new Map([["index-recommender", {value: new Map([["should-recommend-candidate", {value: "true"}]])}]])},
            ],
        ]),
    };
    surfaceRowAttributes(node);
    assert.deepEqual([...(node.properties?.keys() ?? [])], ["statistics"]);
});
