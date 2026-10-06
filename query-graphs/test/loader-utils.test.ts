import assert from "node:assert/strict";
import test from "node:test";
import {
    formatBytes,
    formatCount,
    formatExact,
    formatNumber,
    formatPropertyValue,
    formatSeconds,
    getNumericProperty,
    getPropertyPath,
    getScalarProperty,
    applyNumberFormats,
    inferNumberFormat,
    jsonToPropertyEntry,
    surfaceRowAttributes,
    trailPropertyGroups,
    type SurfaceRowOptions,
} from "../src/loaders/loader-utils";
import type {PropertyEntry, TreeNode} from "../src/tree-description";

const rows: SurfaceRowOptions = {
    rowProps: [
        "Plan Rows",
        ["statistics", "output-rows"],
        ["statistics", "scan-stats", "rows-matching-restrictions"],
        ["details", "r_rows"],
    ],
};

test("listed row counts are surfaced, including ones nested in groups", () => {
    const statistics = new Map<string, PropertyEntry>([
        ["output-rows", {value: 42}],
        ["memory-bytes", {value: 1024}],
        ["scan-stats", {value: new Map([["rows-matching-restrictions", {value: 7}]])}],
    ]);
    const node: TreeNode = {
        properties: new Map<string, PropertyEntry>([
            ["Plan Rows", {value: 10}],
            ["operatorId", {value: 1}],
            ["statistics", {value: statistics}],
        ]),
        children: [{properties: new Map([["details", {value: new Map([["r_rows", {value: 3}]])}]])}],
    };

    surfaceRowAttributes(node, rows);

    // The group stays complete; its row counts are additionally shown at the top level.
    assert.equal(statistics.size, 3);
    assert.deepEqual(node.properties?.get("output-rows"), {value: 42});
    assert.deepEqual(node.properties?.get("rows-matching-restrictions"), {value: 7});
    assert.ok(!node.properties?.has("memory-bytes"));
    assert.deepEqual(node.children?.[0].properties?.get("r_rows"), {value: 3});
    // Surfaced rows follow the last top-level row count, or lead when there is none.
    assert.deepEqual(
        [...(node.properties?.keys() ?? [])],
        ["Plan Rows", "output-rows", "rows-matching-restrictions", "operatorId", "statistics"],
    );
    assert.deepEqual([...(node.children?.[0].properties?.keys() ?? [])], ["r_rows", "details"]);
});

test("only the listed names are surfaced, matched exactly", () => {
    const node: TreeNode = {
        properties: new Map<string, PropertyEntry>([
            ["rowstate", {value: 5}],
            [
                "statistics",
                {
                    value: new Map([
                        ["Output-Rows", {value: 9}],
                        ["processed-rows", {value: 8}],
                    ]),
                },
            ],
        ]),
    };

    surfaceRowAttributes(node, rows);

    assert.deepEqual([...(node.properties?.keys() ?? [])], ["rowstate", "statistics"]);
});

test("surfaced row counts keep their raw value", () => {
    const statistics = new Map<string, PropertyEntry>([["output-rows", {value: 2345678901}]]);
    const node: TreeNode = {properties: new Map<string, PropertyEntry>([["statistics", {value: statistics}]])};

    surfaceRowAttributes(node, rows);

    assert.equal(node.properties?.get("output-rows")?.value, 2345678901);
    assert.equal(statistics.get("output-rows")?.value, 2345678901);
});

test("an existing top-level row count is not shadowed by a nested one of the same name", () => {
    const node: TreeNode = {
        properties: new Map<string, PropertyEntry>([
            ["output-rows", {value: 42000}],
            ["statistics", {value: new Map([["output-rows", {value: 41999}]])}],
        ]),
    };

    surfaceRowAttributes(node, rows);

    assert.equal(node.properties?.get("output-rows")?.value, 42000);
    assert.deepEqual([...(node.properties?.keys() ?? [])], ["output-rows", "statistics"]);
});

test("a listed path that names a group is not surfaced", () => {
    const node: TreeNode = {
        properties: new Map<string, PropertyEntry>([
            ["statistics", {value: new Map([["output-rows", {value: new Map([["0", {value: 1}]])}]])}],
        ]),
    };
    surfaceRowAttributes(node, rows);
    assert.deepEqual([...(node.properties?.keys() ?? [])], ["statistics"]);
});

test("JSON numbers stay numbers, other scalars become strings, objects and arrays become groups", () => {
    const entry = jsonToPropertyEntry({count: 12345, ok: true, name: "x", none: null, list: [1, "a"]});
    const group = entry.value as Map<string, PropertyEntry>;
    assert.deepEqual(group.get("count"), {value: 12345});
    assert.deepEqual(group.get("ok"), {value: "true"});
    assert.deepEqual(group.get("name"), {value: "x"});
    assert.deepEqual(group.get("none"), {value: "null"});
    assert.deepEqual(
        [...(group.get("list")?.value as Map<string, PropertyEntry>)],
        [
            ["0", {value: 1}],
            ["1", {value: "a"}],
        ],
    );
});

test("empty JSON objects and arrays become text, not empty groups", () => {
    assert.deepEqual(jsonToPropertyEntry({}), {value: "{}"});
    assert.deepEqual(jsonToPropertyEntry([]), {value: "[]"});
    const group = jsonToPropertyEntry({extra: {}, list: []}).value as Map<string, PropertyEntry>;
    assert.deepEqual(group.get("extra"), {value: "{}"});
    assert.deepEqual(group.get("list"), {value: "[]"});
});

test("scalar, numeric and nested property accessors", () => {
    const properties = new Map<string, PropertyEntry>([
        ["name", {value: "scan"}],
        ["id", {value: 7}],
        ["rows", {value: "12"}],
        ["group", {value: new Map([["inner", {value: 3}]])}],
    ]);
    assert.equal(getScalarProperty(properties, "name"), "scan");
    assert.equal(getScalarProperty(properties, "id"), "7");
    assert.equal(getScalarProperty(properties, "group"), undefined);
    assert.equal(getScalarProperty(properties, "missing"), undefined);
    assert.equal(getScalarProperty(undefined, "name"), undefined);
    assert.equal(getNumericProperty(properties, "id"), 7);
    assert.equal(getNumericProperty(properties, "rows"), 12);
    assert.equal(getNumericProperty(properties, "name"), undefined);
    assert.equal(getNumericProperty(properties, "group"), undefined);
    assert.deepEqual(getPropertyPath(properties, ["group", "inner"]), {value: 3});
    assert.equal(getPropertyPath(properties, ["name", "inner"]), undefined);
    assert.equal(getPropertyPath(properties, ["missing", "inner"]), undefined);
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

test("rounded counts use K/M/B/T suffixes", () => {
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

test("byte counts use binary units", () => {
    assert.equal(formatBytes(512), "512 B");
    assert.equal(formatBytes(1536), "1.5 KiB");
    assert.equal(formatBytes(3 * 1024 ** 3), "3.0 GiB");
    assert.equal(formatBytes(1048575), "1.0 MiB");
});

test("durations in seconds pick the largest fitting unit", () => {
    const cases: [number, string][] = [
        [0, "0µs"],
        [0.00000851, "8.51µs"],
        [0.0209, "20.9ms"],
        [0.9996, "1s"],
        [1.5, "1.5s"],
        [150, "2.5min"],
        [4320, "1.2h"],
        [59.96, "1min"],
        [3599.9, "1h"],
    ];
    for (const [input, expected] of cases) assert.equal(formatSeconds(input), expected, String(input));
});

test("exact numbers keep every digit", () => {
    assert.equal(formatExact(1234567), "1,234,567");
    assert.equal(formatExact(0.4761234), "0.4761234");
});

test("numbers without a format are shown as is", () => {
    assert.equal(formatNumber(12345, undefined), "12345");
    assert.equal(formatNumber(12345, "rounded"), "12.3K");
    assert.equal(formatNumber(12345, "exact"), "12,345");
    assert.equal(formatNumber(2048, "memory-bytes"), "2.0 KiB");
    assert.equal(formatNumber(0.5, "time-seconds"), "500ms");
});

test("property values render scalars and leave groups to the caller", () => {
    assert.equal(formatPropertyValue({value: "scan"}), "scan");
    assert.equal(formatPropertyValue({value: 5_000_000, numberFormat: "rounded"}), "5M");
    assert.equal(formatPropertyValue({value: 5_000_000}), "5000000");
    assert.equal(formatPropertyValue({value: new Map()}), undefined);
});

test("number formats are inferred from name words", () => {
    assert.equal(inferNumberFormat("output-rows"), "rounded");
    assert.equal(inferNumberFormat("Actual Rows"), "rounded");
    assert.equal(inferNumberFormat("cpu-cycles"), "rounded");
    assert.equal(inferNumberFormat("memory-bytes"), "memory-bytes");
    assert.equal(inferNumberFormat("peakMemory"), "memory-bytes");
    assert.equal(inferNumberFormat("cpu_time"), "time-seconds");
    assert.equal(inferNumberFormat("wall-clock"), "time-seconds");
    assert.equal(inferNumberFormat("peak-transaction-memory-mb"), undefined);
    assert.equal(inferNumberFormat("r_total_time_ms"), undefined);
    assert.equal(inferNumberFormat("min-rows"), "rounded");
    assert.equal(inferNumberFormat("rowstate"), undefined);
    assert.equal(inferNumberFormat("operatorId"), undefined);
});

test("number formats are set by name, and a group passes its format on", () => {
    const processed = new Map<string, PropertyEntry>([["0", {value: 5}]]);
    const node: TreeNode = {
        properties: new Map<string, PropertyEntry>([
            ["rows", {value: 1234}],
            ["id", {value: 1234}],
            ["name", {value: "scan"}],
            ["stats", {value: new Map([["time", {value: 0.5}]])}],
            ["processed-rows", {value: processed}],
            ["memory-stats", {value: new Map([["count", {value: 5}]])}],
            ["wall-clock", {value: new Map([["total_ms", {value: 12}]])}],
            ["elapsed-ms", {value: new Map([["0", {value: 12}]])}],
        ]),
        children: [{properties: new Map([["rows", {value: 7}]])}],
    };

    applyNumberFormats(node);

    assert.equal(node.properties?.get("rows")?.numberFormat, "rounded");
    assert.equal(node.properties?.get("id")?.numberFormat, undefined);
    assert.equal(node.properties?.get("name")?.numberFormat, undefined);
    assert.equal((node.properties?.get("stats")?.value as Map<string, PropertyEntry>).get("time")?.numberFormat, "time-seconds");
    assert.equal(processed.get("0")?.numberFormat, "rounded");
    assert.equal((node.properties?.get("memory-stats")?.value as Map<string, PropertyEntry>).get("count")?.numberFormat, undefined);
    // A unit in the name stops the group's format from applying.
    assert.equal(
        (node.properties?.get("wall-clock")?.value as Map<string, PropertyEntry>).get("total_ms")?.numberFormat,
        undefined,
    );
    assert.equal((node.properties?.get("elapsed-ms")?.value as Map<string, PropertyEntry>).get("0")?.numberFormat, undefined);
    assert.equal(node.children?.[0].properties?.get("rows")?.numberFormat, "rounded");
});
